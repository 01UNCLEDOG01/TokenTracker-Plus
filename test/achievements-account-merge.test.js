"use strict";

// 成就跨设备并集 (站主 2026-11-13): the achievements endpoint merges the
// account-wide unlock set from the instance into the locally computed wall.
// This device keeps computing locally; remote-only raises carry
// `remote_raised: true` (the dashboard floors its high-water silently instead
// of toasting for something another machine earned). A failing or missing
// instance never blocks the response: the payload stays local-only.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { mkdtemp, writeFile, mkdir } = require("node:fs/promises");
const { createHash } = require("node:crypto");

const { createLocalApiHandler } = require("../src/lib/local-api");
const { withHome } = require("./helpers/with-home");

const publicAnon = [Buffer.from('{"alg":"HS256"}').toString("base64url"),
  Buffer.from('{"role":"anon"}').toString("base64url"), "fixture-signature"].join(".");

function bindFixtureInstance(trackerDir, baseUrl, anonKey) {
  fs.writeFileSync(path.join(trackerDir, "config.json"), JSON.stringify({
    machineId: "machine-abcdef12", baseUrl, anonKey,
  }));
  fs.writeFileSync(path.join(trackerDir, "runtime-instance.json"), JSON.stringify({
    fingerprint: createHash("sha256").update(`${baseUrl}\0${anonKey}`).digest("hex"),
  }));
}

function writeQueue(trackerDir) {
  // A RECENT hour_start: the local achievements derive achieved dates from the
  // queue, and the 挣到值 capture only records fresh unlocks (≤36h) — a stale
  // fixture row would leave the capture empty and the upload without values.
  const hourStart = new Date(Math.floor(Date.now() / 3600e3) * 3600e3 - 3600e3).toISOString();
  fs.writeFileSync(path.join(trackerDir, "queue.jsonl"), `${JSON.stringify({
    source: "codex", model: "gpt-6", hour_start: hourStart,
    input_tokens: 1000, output_tokens: 500, cached_input_tokens: 0,
    cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    total_tokens: 1500, billable_total_tokens: 1500, total_cost_usd: 0.01, conversation_count: 1,
  })}\n`);
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      Promise.resolve(handler(req, res, new URL(req.url, "http://127.0.0.1"))).catch((error) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function fetchAchievements(port, { view } = {}) {
  const suffix = view ? `?view=${view}` : "";
  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/functions/tokentracker-achievements${suffix}`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
  return JSON.parse(body);
}

test("achievements merge the account union and mark remote-only raises", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "tt-badge-merge-"));
  const trackerDir = path.join(tempHome, ".tokentracker", "tracker");
  await mkdir(trackerDir, { recursive: true });
  writeQueue(trackerDir);
  // The opt-in gate: badge sync rides the same switch as usage upload.
  await writeFile(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
  // The mint path reads the relayed refresh session, same as the auth proxy.
  await writeFile(path.join(trackerDir, "relay-cookies.json"), JSON.stringify({
    insforge_refresh_token: "insforge_refresh_token=refresh-relay-token; Path=/; HttpOnly; SameSite=Lax",
  }));

  const upstreamPosts = [];
  const remoteBadges = [
    // Winner WITHOUT a stored reading (an old client earned it earlier): the
    // merged badge must carry NO values for that tier rather than borrowing
    // another device's reading (对抗审查 F1).
    { id: "code_cannon", tier: 1, achieved: { bronze: "2026-01-05T00:00:00Z", silver: null, gold: null, diamond: null } },
    { id: "real_money", tier: 2, achieved: { bronze: "2026-01-01T00:00:00Z", silver: "2026-02-01T00:00:00Z", gold: null, diamond: null }, earned_values: { bronze: 0.5, silver: 1.25, gold: null, diamond: null } },
  ];
  const upstream = http.createServer((req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url, "http://upstream");
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (url.pathname === "/api/auth/refresh") {
        send(200, { accessToken: "minted-test-token" });
        return;
      }
      if (url.pathname === "/functions/tokentracker-badge-sync") {
        if (req.method === "POST") {
          const parsed = JSON.parse(raw || "{}");
          upstreamPosts.push(parsed);
          send(200, { ok: true, stored: parsed.badges?.length ?? 0, received: parsed.badges?.length ?? 0 });
        } else {
          send(200, { badges: remoteBadges });
        }
        return;
      }
      send(404, { error: "unexpected " + url.pathname });
    });
  });

  let restoreHome = () => {};
  const prevBase = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  const upstreamAddr = await new Promise((resolve) => upstream.listen(0, "127.0.0.1", () => resolve(upstream.address())));
  const baseUrl = `http://127.0.0.1:${upstreamAddr.port}`;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = baseUrl;
  await bindFixtureInstance(trackerDir, baseUrl, publicAnon);
  restoreHome = withHome(tempHome);

  const handler = createLocalApiHandler({ queuePath: path.join(trackerDir, "queue.jsonl") });
  const server = await startServer(handler);
  try {
    // The first response is local-only (the merge cache fills in the
    // background); poll until the union lands.
    let merged = null;
    for (let attempt = 0; attempt < 40 && !merged; attempt += 1) {
      const payload = await fetchAchievements(server.address().port);
      const raised = payload.achievements.find((badge) => badge.id === "code_cannon");
      if (raised && raised.tier === 1 && raised.remote_raised === true) merged = payload;
      else await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(merged, "the remote union must land within the poll window");
    const cannon = merged.achievements.find((badge) => badge.id === "code_cannon");
    assert.equal(cannon.tier, 1);
    assert.equal(cannon.remote_raised, true);
    assert.equal(cannon.local_tier, 0);
    assert.equal(cannon.achieved.bronze, "2026-01-05T00:00:00Z");
    // 挣到值不变式（对抗审查 F1）：远端胜者没带读数 → 该档 values 缺席，
    // 绝不拿本机捕获读数冒充更早解锁的挣到值。
    assert.equal(cannon.values, undefined);
    // A badge the local queue never lifted: the remote set raises it two tiers.
    const money = merged.achievements.find((badge) => badge.id === "real_money");
    assert.equal(money.tier, 2);
    assert.equal(money.remote_raised, true);
    assert.equal(money.achieved.bronze, "2026-01-01T00:00:00Z");
    assert.equal(money.achieved.silver, "2026-02-01T00:00:00Z");
    assert.equal(money.values.silver, 1.25);
    // The uploader posted this device's own unlocked set.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const post = upstreamPosts[upstreamPosts.length - 1];
    assert.ok(Array.isArray(post?.badges), "the local unlock set must be uploaded");
    assert.ok(post.badges.every((badge) => badge.id && badge.achieved), "entries carry id + achieved");
    // 挣到值随上传体走（本地捕获表）：只带已记录的档位。
    assert.ok(post.badges.some((badge) => badge.values && Number.isFinite(badge.values.bronze)),
      "captured local readings ride the upload");
    assert.ok(post.badges.every((badge) => badge.values === undefined
      || Object.values(badge.values).every((value) => value === null || Number.isFinite(value))),
      "value entries are numbers or nulls, never junk");

    // ?view=local (成就页「本机」页签): the same server must answer with the
    // pre-merge device wall — no union raises, no merge marker, no union
    // values — while the default scope keeps serving the union.
    const localOnly = await fetchAchievements(server.address().port, { view: "local" });
    assert.ok(localOnly.achievements.every((badge) => badge.remote_raised === undefined),
      "scope=local must not leak the union into the device wall");
    assert.ok(localOnly.achievements.every((badge) => badge.values === undefined),
      "the device wall must not carry union earning values");
    const localCannon = localOnly.achievements.find((badge) => badge.id === "code_cannon");
    assert.equal(localCannon.tier, 0);
    assert.equal(localCannon.local_tier, undefined);
    assert.equal(localOnly.badges_merged_from_account, undefined);
    const mergedAgain = await fetchAchievements(server.address().port);
    assert.equal(mergedAgain.achievements.find((badge) => badge.id === "code_cannon").tier, 1);
  } finally {
    server.close();
    upstream.close();
    fs.rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    restoreHome();
    if (prevBase === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBase;
  }
});

test("a failing instance leaves the achievements endpoint local-only", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "tt-badge-fail-"));
  const trackerDir = path.join(tempHome, ".tokentracker", "tracker");
  await mkdir(trackerDir, { recursive: true });
  writeQueue(trackerDir);
  await writeFile(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
  await writeFile(path.join(trackerDir, "relay-cookies.json"), JSON.stringify({
    insforge_refresh_token: "insforge_refresh_token=refresh-relay-token; Path=/; HttpOnly; SameSite=Lax",
  }));

  const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, "http://upstream");
    if (url.pathname === "/api/auth/refresh") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accessToken: "minted-test-token" }));
      return;
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "upstream down" }));
  });

  let restoreHome = () => {};
  const prevBase = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  const upstreamAddr = await new Promise((resolve) => upstream.listen(0, "127.0.0.1", () => resolve(upstream.address())));
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = `http://127.0.0.1:${upstreamAddr.port}`;
  await bindFixtureInstance(trackerDir, process.env.TOKENTRACKER_INSFORGE_BASE_URL, publicAnon);
  restoreHome = withHome(tempHome);

  const handler = createLocalApiHandler({ queuePath: path.join(trackerDir, "queue.jsonl") });
  const server = await startServer(handler);
  try {
    const payload = await fetchAchievements(server.address().port);
    assert.ok(Array.isArray(payload.achievements) && payload.achievements.length > 0);
    assert.ok(payload.achievements.every((badge) => badge.remote_raised === undefined),
      "no remote raise marker may leak in when the instance is down");
    // And the very next poll still answers (the backoff must not wedge the
    // endpoint), without waiting on the failing upstream.
    const startedAt = Date.now();
    const second = await fetchAchievements(server.address().port);
    assert.ok(Array.isArray(second.achievements));
    assert.ok(Date.now() - startedAt < 5000, "polls must not block on the dead instance");
  } finally {
    server.close();
    upstream.close();
    fs.rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    restoreHome();
    if (prevBase === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBase;
  }
});
