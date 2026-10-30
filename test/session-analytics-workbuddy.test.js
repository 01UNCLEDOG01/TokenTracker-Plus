"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSessionAnalytics,
  discoverSessionFiles,
  groupWorkbuddyConversationFiles,
  listSessionsForBrowser,
  resumeCommandFor,
  scanWorkbuddySession,
  sessionHash,
} = require("../src/lib/session-analytics");
const { ensurePricingLoaded } = require("../src/lib/pricing");

const SESSION = "11111111-2222-4333-8444-555555555555";
const TS = Date.parse("2026-09-02T03:04:05.000Z");

function tempHome(prefix) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return home;
}

function transcriptPath(home, edition, cwdSlug, sessionId) {
  return path.join(home, edition, "projects", cwdSlug, `${sessionId}.jsonl`);
}

function writeTranscript(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${records.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return filePath;
}

function userTurn(text, extra = {}) {
  return {
    type: "message",
    role: "user",
    timestamp: TS,
    sessionId: SESSION,
    cwd: "D:/work/site",
    content: [{ type: "input_text", text }],
    ...extra,
  };
}

function assistantTurn({ text = "", messageId, model = "hy3", rawUsage, parentId, sessionId = SESSION, cwd = "D:/work/site" }) {
  return {
    type: "message",
    role: "assistant",
    timestamp: TS + 1000,
    sessionId,
    cwd,
    content: text ? [{ type: "output_text", text }] : [],
    providerData: { messageId, model, rawUsage },
    ...(parentId ? { parentId } : {}),
  };
}

function subAgentTitle(title) {
  return { type: "ai-title", aiTitle: title, timestamp: TS + 3000, sessionId: "SUB-AGENT", cwd: "D:/other" };
}

function toolCall({ name, messageId, model = "hy3", rawUsage, args }) {
  return {
    type: "function_call",
    name,
    timestamp: TS + 2000,
    sessionId: SESSION,
    cwd: "D:/work/site",
    arguments: typeof args === "string" ? args : JSON.stringify(args || {}),
    providerData: { messageId, model, rawUsage },
  };
}

// Anthropic-shaped mirror: cache reads and writes are separate fields.
const ANTHROPIC_USAGE = {
  prompt_tokens: 1000,
  completion_tokens: 200,
  total_tokens: 1200,
  cache_read_input_tokens: 600,
  cache_creation_input_tokens: 100,
  completion_tokens_details: { reasoning_tokens: 50 },
  credit: 3.5,
};
// DeepSeek/OpenAI-shaped mirror: the cache hit sits inside prompt_tokens_details
// and this upstream reports no cache write and no reasoning split, so the same
// 1000/200 round trip lands on different fields than the Anthropic mirror.
const OPENAI_USAGE = {
  prompt_tokens: 1000,
  completion_tokens: 200,
  total_tokens: 1200,
  prompt_tokens_details: { cached_tokens: 600 },
  prompt_cache_hit_tokens: 400,
  credit: 1.25,
};

test("the vendor envelope translates into the totals the hourly collector books", async () => {
  const home = tempHome("tt-wb-scan-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  writeTranscript(file, [
    userTurn("rename the button label"),
    assistantTurn({ text: "done", messageId: "resp-1", rawUsage: ANTHROPIC_USAGE }),
    // Each mirror bills a 1000-prompt / 200-completion round trip, so the
    // combined expectation is checkable without trusting either branch.
    toolCall({ name: "Edit", messageId: "resp-2", rawUsage: OPENAI_USAGE }),
  ]);
  await ensurePricingLoaded();
  const row = await scanWorkbuddySession([file]);

  assert.equal(row.source, "workbuddy");
  assert.equal(row.session_id, SESSION);
  assert.deepEqual(row.tokens, {
    input_tokens: 700,
    cached_input_tokens: 1200,
    cache_creation_input_tokens: 100,
    output_tokens: 350,
    reasoning_output_tokens: 50,
    total_tokens: 2400,
  });
  assert.equal(row.total_tokens, 2400);
  // The record that carries no rawUsage still counts as the reply it belongs to.
  assert.equal(row.turns, 1);
  assert.equal(row.edit_turns, 1, "an Edit tool call makes the turn productive");
  assert.equal(row.credits, 4.75);
  assert.equal(row.cost_usd > 0, true, "a metered conversation prices above zero");
  assert.equal(row.project_ref, "D:/work/site");
});

test("a cache write named only by the OpenAI-style field bills as a cache write", async () => {
  const home = tempHome("tt-wb-cache-write-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  // DeepSeek-shaped upstream: the write never reaches cache_creation_input_tokens.
  writeTranscript(file, [
    userTurn("hi"),
    assistantTurn({
      text: "ok",
      messageId: "r1",
      rawUsage: {
        prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200,
        prompt_cache_write_tokens: 600, credit: 2,
      },
    }),
  ]);
  const row = await scanWorkbuddySession([file]);
  assert.deepEqual(row.tokens, {
    input_tokens: 400,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 600,
    output_tokens: 200,
    reasoning_output_tokens: 0,
    total_tokens: 1200,
  });
});

test("WorkBuddy's own ai-title record names the conversation, the prompt body never does", async () => {
  const home = tempHome("tt-wb-title-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  writeTranscript(file, [
    userTurn("SECRET-DO-NOT-USE-AS-TITLE"),
    { type: "ai-title", aiTitle: "Rename the checkout button", timestamp: TS, sessionId: SESSION, cwd: "D:/work/site" },
    assistantTurn({ text: "ok", messageId: "resp-1", rawUsage: ANTHROPIC_USAGE }),
  ]);
  const row = await scanWorkbuddySession([file]);
  assert.equal(row.title, "Rename the checkout button");
});

test("a tool call's usage is booked once even when the reply shares its response id", async () => {
  const home = tempHome("tt-wb-dedup-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  writeTranscript(file, [
    assistantTurn({ text: "editing", messageId: "resp-1", rawUsage: ANTHROPIC_USAGE }),
    toolCall({ name: "Edit", messageId: "resp-1", rawUsage: ANTHROPIC_USAGE }),
  ]);
  const row = await scanWorkbuddySession([file]);
  assert.equal(row.tokens.total_tokens, 1200, "one round trip, not two");
  assert.equal(row.credits, 3.5);
});

test("an unmetered record that shares a response id never hides the metered one", async () => {
  const home = tempHome("tt-wb-unmetered-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  // WorkBuddy appends the streamed reply first (no usage yet) and the same
  // response id with rawUsage afterwards. Tagging the first record with the id
  // would make the dedup swallow the row that actually carries the tokens.
  writeTranscript(file, [
    assistantTurn({ text: "streaming…", messageId: "resp-1" }),
    toolCall({ name: "Bash", messageId: "resp-1", rawUsage: ANTHROPIC_USAGE }),
  ]);
  const row = await scanWorkbuddySession([file]);
  assert.equal(row.tokens.total_tokens, 1200);
  assert.equal(row.credits, 3.5);
});

test("a sub-agent transcript folds into the conversation that spawned it", async () => {
  const home = tempHome("tt-wb-subagent-");
  const main = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  const sub = path.join(
    home, ".workbuddy", "projects", "d-work-site", SESSION, "subagents", "agent-abc.jsonl",
  );
  writeTranscript(main, [
    userTurn("add tests"),
    { type: "ai-title", aiTitle: "Add regression tests", timestamp: TS, sessionId: SESSION, cwd: "D:/work/site" },
    toolCall({ name: "Agent", messageId: "resp-1", rawUsage: ANTHROPIC_USAGE, args: { subagent_type: "tester" } }),
  ]);
  // A real sub-agent transcript names itself a different session, works in its
  // own project, and titles itself — none of which belongs to the parent.
  writeTranscript(sub, [
    subAgentTitle("SUBAGENT TITLE MUST NOT LEAK"),
    userTurn("write them", { sessionId: "99999999-8888-7777-6666-555555555555", cwd: "D:/other" }),
    assistantTurn({
      text: "done",
      messageId: "resp-2",
      rawUsage: OPENAI_USAGE,
      parentId: "p1",
      model: "deepseek-v4-pro",
      sessionId: "99999999-8888-7777-6666-555555555555",
      cwd: "D:/other",
    }),
  ]);
  const groups = groupWorkbuddyConversationFiles([main, sub]);
  assert.equal(groups.length, 1, "two files, one conversation");
  assert.deepEqual(groups[0].map((p) => path.basename(p)), [`${SESSION}.jsonl`, "agent-abc.jsonl"]);

  const row = await scanWorkbuddySession(groups[0]);
  assert.equal(row.tokens.total_tokens, 2400, "the sub-agent's round trips bill to its parent");
  assert.equal(row.session_id, SESSION, "the conversation keeps the main transcript's id");
  assert.equal(row.title, "Add regression tests", "a sub-agent title cannot rename the conversation");
  assert.equal(row.project_ref, "D:/work/site", "and a sub-agent cwd cannot move it");
  assert.equal(row.subagent_calls, 1);
  assert.deepEqual(row.subagent_types, { tester: 1 });
  assert.equal(row.credits, 4.75);
});

test("the international edition books its own source and never collides with the same id at home", async () => {
  const home = tempHome("tt-wb-editions-");
  const cn = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  const intl = transcriptPath(home, ".workbuddy-ai", "d-work-site", SESSION);
  for (const file of [cn, intl]) {
    writeTranscript(file, [userTurn("hi"), assistantTurn({ text: "yo", messageId: "r1", rawUsage: ANTHROPIC_USAGE })]);
  }
  const discovered = await discoverSessionFiles(home, { HOME: home }, {});
  assert.equal(discovered.workbuddy.length, 2, "one conversation per edition home");

  await ensurePricingLoaded();
  const rows = await Promise.all(discovered.workbuddy.map((group) => scanWorkbuddySession(group)));
  const sources = rows.map((row) => row.source).sort();
  assert.deepEqual(sources, ["workbuddy", "workbuddy-ai"]);
  assert.equal(new Set(rows.map((row) => row.session_hash)).size, 2,
    "the same session id under two editions is two conversations");
  assert.equal(rows.find((row) => row.source === "workbuddy").session_hash,
    sessionHash("workbuddy", SESSION));
  assert.equal(resumeCommandFor("workbuddy", SESSION), null,
    "WorkBuddy is a desktop app; no CLI resume command may be invented");
});

test("a project folder that merely contains .workbuddy-ai stays domestic", async () => {
  const home = tempHome("tt-wb-slug-");
  const file = path.join(home, ".workbuddy", "projects", "my-.workbuddy-ai-app", `${SESSION}.jsonl`);
  writeTranscript(file, [userTurn("hi"), assistantTurn({ text: "yo", messageId: "r1", rawUsage: ANTHROPIC_USAGE })]);
  const row = await scanWorkbuddySession([file]);
  assert.equal(row.source, "workbuddy", "the edition comes from the data dir, not the project name");
});

test("discovery reads the home it was given, never the ambient one", async () => {
  const callerHome = tempHome("tt-wb-home-a-");
  const ambientHome = tempHome("tt-wb-home-b-");
  writeTranscript(
    transcriptPath(callerHome, ".workbuddy", "d-work-site", SESSION),
    [userTurn("hi"), assistantTurn({ text: "yo", messageId: "r1", rawUsage: ANTHROPIC_USAGE })],
  );
  writeTranscript(
    transcriptPath(ambientHome, ".workbuddy", "d-other", SESSION),
    [userTurn("hi"), assistantTurn({ text: "yo", messageId: "r1", rawUsage: ANTHROPIC_USAGE })],
  );
  const discovered = await discoverSessionFiles(callerHome, { HOME: ambientHome }, {});
  const paths = discovered.workbuddy.flat();
  assert.equal(paths.length, 1, "a scan of one home must not pick up another machine user's logs");
  assert.equal(path.dirname(paths[0]), path.join(callerHome, ".workbuddy", "projects", "d-work-site"));
});

test("a record naming no model falls back to its own edition's settings, not the machine's", async () => {
  const home = tempHome("tt-wb-default-model-");
  const editionHome = path.join(home, ".workbuddy");
  fs.mkdirSync(editionHome, { recursive: true });
  fs.writeFileSync(path.join(editionHome, "settings.json"), JSON.stringify({ model: "glm-own-edition" }));
  // A different edition's settings must not be able to answer for this one.
  const otherEdition = path.join(home, ".workbuddy-ai");
  fs.mkdirSync(otherEdition, { recursive: true });
  fs.writeFileSync(path.join(otherEdition, "settings.json"), JSON.stringify({ model: "glm-other-edition" }));
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  writeTranscript(file, [
    userTurn("hi"),
    {
      type: "message",
      role: "assistant",
      timestamp: TS,
      sessionId: SESSION,
      cwd: "D:/work/site",
      content: [{ type: "output_text", text: "ok" }],
      providerData: { messageId: "r1", rawUsage: { ...ANTHROPIC_USAGE } },
    },
  ]);
  const row = await scanWorkbuddySession([file]);
  assert.equal(row.model, "glm-own-edition");
});

test("a conversation's credits arrive rounded, not as float noise", async () => {
  const home = tempHome("tt-wb-credit-round-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  // Three tenths of a credit: the sum is 0.30000000000000004 in binary floats,
  // which the row used to print verbatim.
  writeTranscript(file, [
    userTurn("one"),
    toolCall({ name: "Read", messageId: "r1", rawUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, credit: 0.1 } }),
    toolCall({ name: "Read", messageId: "r2", rawUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, credit: 0.1 } }),
    toolCall({ name: "Read", messageId: "r3", rawUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, credit: 0.1 } }),
  ]);
  await ensurePricingLoaded();
  const sessions = await buildSessionAnalytics({ home, force: true });
  const browser = listSessionsForBrowser(sessions, {});
  const row = browser.sessions.find((session) => session.source === "workbuddy");
  assert.equal(row.credits, 0.3);
});

test("credits and per-conversation money reach the session browser payload", async () => {
  const home = tempHome("tt-wb-browser-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  writeTranscript(file, [
    userTurn("ship it"),
    toolCall({ name: "Write", messageId: "r1", rawUsage: ANTHROPIC_USAGE }),
  ]);
  await ensurePricingLoaded();
  const sessions = await buildSessionAnalytics({ home, force: true });
  assert.equal(sessions.filter((row) => row.source === "workbuddy").length, 1);
  const browser = listSessionsForBrowser(sessions, { from: "2026-09-01", to: "2026-09-30" });
  const row = browser.sessions.find((session) => session.source === "workbuddy");
  assert.ok(row, "the conversation is listed");
  assert.equal(row.total_tokens, 1200);
  assert.equal(row.credits, 3.5);
  assert.equal(row.cost_usd > 0, true);
  assert.equal(row.title, null, "a conversation with no ai-title record stays untitled");
});

test("the wall-clock rate denominator excludes idle between usage records", async () => {
  const home = tempHome("tt-wb-speed-");
  const file = transcriptPath(home, ".workbuddy", "d-work-site", SESSION);
  writeTranscript(file, [
    userTurn("first"),
    { ...assistantTurn({ text: "a", messageId: "r1", rawUsage: ANTHROPIC_USAGE }), timestamp: TS },
    // Ten minutes later: the cap books five minutes of working time.
    { ...assistantTurn({ text: "b", messageId: "r2", rawUsage: ANTHROPIC_USAGE }), timestamp: TS + 600_000 },
    // One minute after that: the real gap counts in full.
    { ...assistantTurn({ text: "c", messageId: "r3", rawUsage: ANTHROPIC_USAGE }), timestamp: TS + 660_000 },
  ]);
  const row = await scanWorkbuddySession([file]);
  // qoder precedent: 1s seed for the first usage record, then each gap
  // capped at five minutes — 1000 + 300000 + 60000.
  assert.equal(row.speed_active_ms, 361_000);
  // The display span keeps the wall clock (all gaps inside IDLE_GAP_MS).
  assert.equal(row.active_ms, 660_000);
});
