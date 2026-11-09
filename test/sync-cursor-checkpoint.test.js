const assert = require("node:assert/strict");
const test = require("node:test");

const { createCursorCommitThrottle } = require("../src/commands/sync");

function makeClock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms) => { now += ms; },
  };
}

function makeCommitStore({ delayMs = 0, failAt = -1 } = {}) {
  const calls = [];
  let count = 0;
  const commit = async () => {
    const index = count++;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    calls.push(index);
    if (index === failAt) throw new Error("disk on fire");
  };
  return { commit, calls };
}

test("checkpoint throttles repeated calls inside the interval", async () => {
  const clock = makeClock();
  const store = makeCommitStore();
  const throttle = createCursorCommitThrottle({ commit: store.commit, intervalMs: 30_000, clock: clock.now });

  await throttle.checkpoint();
  clock.advance(10_000);
  await throttle.checkpoint();
  clock.advance(10_000);
  await throttle.checkpoint();
  assert.deepEqual(store.calls, [0], "one commit inside the 30s window");
});

test("checkpoint commits again once the interval elapses", async () => {
  const clock = makeClock();
  const store = makeCommitStore();
  const throttle = createCursorCommitThrottle({ commit: store.commit, intervalMs: 30_000, clock: clock.now });

  await throttle.checkpoint();
  clock.advance(30_001);
  await throttle.checkpoint();
  assert.deepEqual(store.calls, [0, 1]);
});

test("force bypasses the throttle", async () => {
  const clock = makeClock();
  const store = makeCommitStore();
  const throttle = createCursorCommitThrottle({ commit: store.commit, intervalMs: 30_000, clock: clock.now });

  await throttle.checkpoint();
  await throttle.checkpoint(true);
  await throttle.checkpoint(true);
  assert.deepEqual(store.calls, [0, 1, 2]);
});

test("an in-flight checkpoint serializes the next one instead of interleaving writes", async () => {
  const clock = makeClock();
  const store = makeCommitStore({ delayMs: 50 });
  const throttle = createCursorCommitThrottle({ commit: store.commit, intervalMs: 0, clock: clock.now });

  const first = throttle.checkpoint();
  const second = throttle.checkpoint();
  await Promise.all([first, second]);
  assert.deepEqual(store.calls, [0, 1], "both ran, strictly ordered");
});

test("a failed commit is swallowed and does not poison later checkpoints", async () => {
  const clock = makeClock();
  const store = makeCommitStore({ failAt: 0 });
  const throttle = createCursorCommitThrottle({ commit: store.commit, intervalMs: 0, clock: clock.now });

  await throttle.checkpoint(true); // fails internally, must not throw
  clock.advance(60_000);
  await throttle.checkpoint(); // recovers
  assert.deepEqual(store.calls, [0, 1]);
});
