"use strict";

// Mutation self-test for test/cowork-sessions.test.js.
//
// A test that cannot fail is not a test, so each mutation below breaks ONE of
// the reader's load-bearing decisions and asserts the corresponding expectation
// then goes red. Two properties are required of a mutation here, both of which
// failed silently in past gates:
//
//   1. it must be PROVEN to have reached the module under test - otherwise
//      "the assertion did not go red" and "the mutation never arrived" look
//      identical, which are opposite conclusions;
//   2. the mutant must stay syntactically valid - a mutation that deletes a
//      whole line can leave an empty `if` that throws in the vm and masks the
//      thing actually under test.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const LIB = path.join(__dirname, "..", "src", "lib", "cowork-sessions.js");

function loadMutant(tag, from, to) {
  const original = fs.readFileSync(LIB, "utf8");
  assert.ok(original.includes(from), `mutation ${tag}: anchor not found - the source moved`);
  const mutated = original.replace(from, to);
  assert.notEqual(mutated, original, `mutation ${tag}: replace was a no-op`);
  assert.ok(mutated.includes(to), `mutation ${tag}: the change did not land`);

  const file = path.join(path.dirname(LIB), `__cowork_mutant_${tag}.js`);
  fs.writeFileSync(file, mutated, "utf8");
  try {
    // require() by absolute path: the module's own lazy require of
    // ./session-analytics stays unused because no test here calls scanCoworkChat.
    delete require.cache[require.resolve(file)];
    const mod = require(file);
    // Property 2: loading it proves the syntax is still valid.
    assert.equal(typeof mod.toCoworkSessionRecord, "function", `mutation ${tag}: mutant is not loadable`);
    return mod;
  } finally {
    delete require.cache[require.resolve(file)];
    fs.rmSync(file, { force: true });
  }
}

const line = (tokens, id = "m-1") =>
  JSON.stringify({ msg: { id, model: "codely-core", timestamp: "2026-10-06T04:59:19.577Z", tokens } });

test("M1. adding cached on top of input instead of splitting it out goes red", () => {
  const mod = loadMutant("m1",
    "input_tokens: input - cacheRead,",
    "input_tokens: input,");
  const u = mod.toCoworkSessionRecord(JSON.parse(
    line({ input: 7150, output: 12, cached: 6800, thoughts: 0, tool: 0, total: 7162 })
  )).message.usage;
  // The un-mutated reader asserts 350 here.
  assert.notEqual(u.input_tokens, 350, "the split-out expectation must now be violated");
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens;
  assert.equal(total, 13962, "and the record inflates by exactly the cached amount");
  assert.notEqual(total, 7162, "the file's own total is no longer reproduced");
});

test("M2. dropping the round-trip id goes red (the source reads as zero, not as 2x)", () => {
  const mod = loadMutant("m2",
    "id: typeof msg.id === \"string\" && msg.id ? msg.id : undefined,",
    "id: undefined,");
  // The scan loop's real rule (rollout.js): an id that is not a non-empty string
  // is SKIPPED, not counted twice. So losing the key does not double the total -
  // it drops every record, and the card would read zero.
  const scannerKeeps = (rec, seen) => {
    const id = rec && rec.message ? rec.message.id : undefined;
    if (typeof id !== "string" || !id || seen.has(id)) return false;
    seen.add(id);
    return true;
  };

  const tokens = { input: 7150, output: 12, cached: 6800, thoughts: 0, tool: 0, total: 7162 };
  const mutated = mod.toCoworkSessionRecord(JSON.parse(line(tokens, "b0bd9440")));
  assert.equal(mutated.message.id, undefined, "the dedup key is gone");
  // ONE shared Set across both copies - a fresh Set per iteration would make the
  // dedup a no-op and "prove" a wrong number.
  const mutatedSeen = new Set();
  const mutatedCount = [mutated, mutated].filter((r) => scannerKeeps(r, mutatedSeen)).length;
  assert.equal(mutatedCount, 0, "every record is skipped - the source totals zero");

  // The un-mutated reader keeps exactly one of the doubled write.
  const real = require("../src/lib/cowork-sessions");
  const kept = real.toCoworkSessionRecord(JSON.parse(line(tokens, "b0bd9440")));
  const realSeen = new Set();
  const realCount = [kept, kept].filter((r) => scannerKeeps(r, realSeen)).length;
  assert.equal(realCount, 1, "the expectation the mutant violates");
  assert.equal(realSeen.size, 1, "and exactly one id was registered");
});

test("M3. reading every jsonl instead of only chats/ goes red", () => {
  const mod = loadMutant("m3",
    "path.basename(path.dirname(full)).toLowerCase() === \"chats\"",
    "true");
  const os = require("node:os");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-mut-"));
  try {
    const inst = path.join(home, ".codely-cli", "tmp", "abc");
    fs.mkdirSync(path.join(inst, "chats"), { recursive: true });
    fs.mkdirSync(path.join(inst, "tasks", "s1"), { recursive: true });
    fs.writeFileSync(path.join(inst, "chats", "c.jsonl"), line({ input: 1, output: 1, total: 2 }) + "\n");
    fs.writeFileSync(path.join(inst, "tasks", "s1", "t.jsonl"), "{}\n");
    assert.equal(mod.resolveCoworkChatFiles({ env: {}, home }).length, 2,
      "the un-mutated reader returns exactly the 1 chats file, never the 110 tasks files");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("M4. dropping the clamp goes red on a cached > input record", () => {
  const mod = loadMutant("m4",
    "const cacheRead = Math.min(cached, input);",
    "const cacheRead = cached;");
  const u = mod.toCoworkSessionRecord(JSON.parse(
    line({ input: 10, output: 5, cached: 99, thoughts: 0, tool: 0, total: 15 })
  )).message.usage;
  assert.equal(u.cache_read_input_tokens, 99, "no longer clamped");
  assert.equal(u.input_tokens, -89, "fresh input goes negative - the value the clamp exists to stop");
});

test("M5. folding thoughts into output goes red", () => {
  const mod = loadMutant("m5",
    "output_tokens: output,",
    "output_tokens: output + thoughts,");
  const u = mod.toCoworkSessionRecord(JSON.parse(
    line({ input: 100, output: 20, cached: 0, thoughts: 7, tool: 0, total: 120 })
  )).message.usage;
  assert.equal(u.output_tokens, 27, "reasoning added on the side");
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens;
  assert.equal(total, 127, "the verified total === input + output invariant is broken");
});

test("M6. the mutants are gone from the tree afterwards", () => {
  const leftovers = fs.readdirSync(path.dirname(LIB)).filter((f) => f.startsWith("__cowork_mutant_"));
  assert.deepEqual(leftovers, [], "a mutant left on disk would be a real source file");
});