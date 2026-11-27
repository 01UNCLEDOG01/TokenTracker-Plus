"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { Agent, EnvHttpProxyAgent, WebSocket } = require("undici");
const { writeJsonAtomicSync } = require("./atomic-json");

const APP_SERVER_URL = "wss://codex-cloud-backend.chatgpt.com/";
const THREAD_SOURCES = new Map([
  ["codex_work_cca", "aeon_child"],
  ["codex_work_web", "user"],
]);
const ORIGINATORS = Object.freeze([...THREAD_SOURCES.keys()]);
const EVENT_NAME = "codex_local_work_usage";

function hashAccountKey(seed) {
  const raw = String(seed || "").trim();
  if (!raw) return "";
  return `sha256:${crypto.createHash("sha256").update("codex-local-work\0").update(raw).digest("hex")}`;
}

function decodeJwtPayload(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return {};
    return JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function codexAuthContext(auth) {
  const tokens = auth?.tokens && typeof auth.tokens === "object" ? auth.tokens : auth || {};
  const accessToken = String(tokens.access_token || tokens.accessToken || auth?.access_token || "").trim();
  const idToken = String(tokens.id_token || tokens.idToken || auth?.id_token || "").trim();
  const payload = decodeJwtPayload(idToken);
  const nested = payload["https://api.openai.com/auth"] || {};
  const accountId = String(
    tokens.account_id
    || tokens.accountId
    || auth?.account_id
    || auth?.accountId
    || payload.chatgpt_account_id
    || nested.chatgpt_account_id
    || "",
  ).trim().toLowerCase();
  return {
    accessToken,
    accountId,
    accountKey: hashAccountKey(accountId || accessToken),
  };
}

function readCodexAuth({ home = os.homedir(), env = process.env } = {}) {
  const codexHome = env.CODEX_HOME || path.join(home, ".codex");
  try {
    return codexAuthContext(JSON.parse(fs.readFileSync(path.join(codexHome, "auth.json"), "utf8")));
  } catch {
    return null;
  }
}

function executorIdsFromProcesses(text) {
  const ids = new Set();
  const assignment = String.raw`(?:[A-Za-z0-9_.-]+=(?:\\"|[^\s"']|"(?:[^"\\]|\\.)*"|'[^']*')+|"[A-Za-z0-9_.-]+=(?:[^"\\]|\\.)*"|'[A-Za-z0-9_.-]+=[^']*')`;
  const executor = new RegExp(`^\\s*(?:"(?:[^"]*[\\\\/])?codex(?:\\.exe)?"|(?:[^\\s"]*[\\\\/])?codex(?:\\.exe)?)(?:\\s+(?:-c|--config)\\s+${assignment})*\\s+exec-server\\s+`);
  for (const line of String(text || "").split(/\r?\n/)) {
    const command = line.match(executor);
    if (!command) continue;
    const id = line.slice(command[0].length).match(/(?:^|\s)--environment-id\s+"?([A-Za-z0-9_-]+)(?:"|\s|$)/)?.[1];
    if (id) ids.add(id);
  }
  return ids;
}

function localExecutorIds({ platform = process.platform, spawnImpl = spawn, signal } = {}) {
  const args = platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name = 'codex.exe'" | ForEach-Object { $_.CommandLine }`]
    : ["-axo", "args="];
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    let child;
    try {
      child = spawnImpl(platform === "win32" ? "powershell.exe" : "ps", args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return resolve(null);
    }
    let text = "";
    let failed = false;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => {
      failed = true;
      try { child.kill(); } catch { /* best effort */ }
      finish(null);
    };
    const timer = setTimeout(abort, platform === "win32" ? 15000 : 2500);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout?.on("data", (chunk) => {
      if (failed || done) return;
      text += chunk.toString("utf8");
      if (text.length > 4 * 1024 * 1024) abort();
    });
    child.on("error", () => {
      failed = true;
      finish(null);
    });
    child.on("close", (code) => {
      finish(!failed && code === 0 ? executorIdsFromProcesses(text) : null);
    });
    if (signal?.aborted) abort();
  });
}

function localThreadEnvironment(thread, executorIds) {
  const expectedSource = THREAD_SOURCES.get(thread?.originator);
  if (!expectedSource || thread.threadSource !== expectedSource
    || thread.path || thread.ephemeral || typeof thread.id !== "string" || !thread.id
    || typeof thread.model !== "string" || !thread.model) return null;
  const environments = thread.environments;
  if (!Array.isArray(environments) || environments.length !== 1) return null;
  const environment = environments[0];
  if (!executorIds.has(environment?.environmentId)
    || typeof environment.cwd !== "string"
    || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(environment.cwd)) return null;
  return { environmentId: environment.environmentId, cwd: environment.cwd };
}

function usageCounters(value) {
  if (!value || typeof value !== "object") return null;
  const fields = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"];
  if (fields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0)) return null;
  const cacheWrite = value.cacheWriteInputTokens ?? 0;
  if (!Number.isSafeInteger(cacheWrite) || cacheWrite < 0
    || value.cachedInputTokens + cacheWrite > value.inputTokens
    || value.reasoningOutputTokens > value.outputTokens
    || value.totalTokens !== value.inputTokens + value.outputTokens) return null;
  return {
    input: value.inputTokens - value.cachedInputTokens - cacheWrite,
    cacheRead: value.cachedInputTokens,
    cacheWrite,
    output: value.outputTokens,
    reasoning: value.reasoningOutputTokens,
    total: value.totalTokens,
  };
}

function localWorkPaths(trackerDir) {
  return {
    state: path.join(trackerDir, "codex-local-work-state.json"),
    events: path.join(trackerDir, "codex-local-work.events.jsonl"),
    checkpoint: path.join(trackerDir, "codex-local-work.events.checkpoint.json"),
  };
}

function readState(statePath) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return {
      version: 1,
      threads: state?.threads && typeof state.threads === "object" ? state.threads : {},
      buckets: state?.buckets && typeof state.buckets === "object" ? state.buckets : {},
    };
  } catch {
    return { version: 1, threads: {}, buckets: {} };
  }
}

function writeState(statePath, state) {
  writeJsonAtomicSync(statePath, {
    ...state,
    version: 1,
    updatedAt: new Date().toISOString(),
  });
}

function observationForEvent({
  accountKey,
  thread,
  environmentId,
  cwd,
  turnId,
  tokenUsage,
  baselineOnly,
  state,
  now,
}) {
  const total = usageCounters(tokenUsage?.total);
  let last = usageCounters(tokenUsage?.last);
  if (!accountKey || !thread?.id || !turnId || !thread.model || !last || !total
    || Object.keys(last).some((key) => last[key] > total[key])) return null;
  const key = `${accountKey}\0${thread.id}`;
  const previous = state.threads[key] || null;
  const previousTotal = previous?.total || null;
  if (previousTotal && total.total <= previousTotal.total) return null;
  if (previousTotal && ["input", "cacheRead", "cacheWrite", "output", "reasoning"]
    .some((field) => total[field] < previousTotal[field])) return null;
  if (previousTotal && total.total - previousTotal.total < last.total) {
    const delta = Object.fromEntries(Object.keys(total).map((field) => [field, total[field] - previousTotal[field]]));
    if (Object.keys(delta).some((field) => delta[field] > last[field])) return null;
    last = delta;
  }
  state.threads[key] = {
    threadId: thread.id,
    title: String(thread.name || "").trim(),
    model: thread.model,
    environmentId,
    cwd,
    total,
    turnEnded: thread.status?.type === "idle",
    observedAt: now,
  };
  if (baselineOnly || last.total <= 0) return null;
  const bucket = `${thread.id}\0${Math.floor(Date.parse(now) / 1_800_000)}`;
  const conversationCount = state.buckets[bucket] ? 0 : 1;
  state.buckets[bucket] = now;
  const keys = Object.keys(state.buckets);
  if (keys.length > 4096) for (const stale of keys.slice(0, keys.length - 4096)) delete state.buckets[stale];
  return {
    kind: EVENT_NAME,
    eventId: crypto.randomUUID(),
    observedAt: now,
    threadId: thread.id,
    turnId,
    model: thread.model,
    cwd,
    title: String(thread.name || "").trim(),
    conversationCount,
    usage: last,
  };
}

async function appendObservation(eventsPath, observation) {
  if (!observation) return false;
  await fsp.mkdir(path.dirname(eventsPath), { recursive: true, mode: 0o700 });
  await fsp.appendFile(eventsPath, `${JSON.stringify(observation)}\n`, { encoding: "utf8", mode: 0o600 });
  return true;
}

function createCodexLocalWorkWatcher({
  trackerDir,
  home = os.homedir(),
  env = process.env,
  pollMs = 5000,
  requestTimeoutMs = 15000,
  makeSocket,
  findExecutorIds,
  authReader,
  onDiagnostic = () => {},
} = {}) {
  if (!trackerDir) throw new Error("trackerDir is required");
  const paths = localWorkPaths(trackerDir);
  const state = readState(paths.state);
  const abortController = new AbortController();
  const threads = new Map();
  const pending = new Map();
  const subscribing = new Set();
  let executorIds = new Set();
  let connection = null;
  let timer = null;
  let requestId = 0;
  let stopped = false;
  let retryAt = 0;
  let failures = 0;

  const socketFactory = makeSocket || ((auth) => {
    const hasProxy = Boolean(env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY);
    const dispatcher = hasProxy ? new EnvHttpProxyAgent() : new Agent({ connect: { timeout: 15000 } });
    const socket = new WebSocket(APP_SERVER_URL, {
      protocols: ["codex-app-server", "codex-client.desktop", `openai-bearer.${auth.accessToken}`],
      headers: {
        "X-OpenAI-Product-Sku": "codex",
        originator: "token-tracker-plus",
        "User-Agent": "TokenTracker-Plus/codex-local-work",
        "ChatGPT-Account-Id": auth.accountId,
      },
      dispatcher,
    });
    return { socket, destroy: () => dispatcher.destroy().catch(() => {}) };
  });
  const readAuth = authReader || (() => readCodexAuth({ home, env }));
  const scanExecutors = findExecutorIds || (() => localExecutorIds({
    platform: process.platform,
    signal: abortController.signal,
  }));

  function disconnect(code = null) {
    const previous = connection;
    connection = null;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Codex local Work connection closed"));
    }
    pending.clear();
    threads.clear();
    subscribing.clear();
    if (previous) {
      try { previous.socket.close(); } catch { /* dispatcher closes it */ }
      previous.destroy?.();
    }
    if (code) {
      failures += 1;
      retryAt = Date.now() + Math.min(60000, pollMs * 2 ** Math.min(failures, 4));
      onDiagnostic(code);
    }
  }

  function request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!connection || connection.socket.readyState !== 1) {
        reject(new Error("Codex local Work disconnected"));
        return;
      }
      const id = ++requestId;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Codex local Work request timed out"));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer: timeout });
      try {
        connection.socket.send(JSON.stringify({ id, method, params }));
      } catch {
        clearTimeout(timeout);
        pending.delete(id);
        reject(new Error("Codex local Work request failed"));
      }
    });
  }

  async function unsubscribe(threadId, current) {
    const entry = threads.get(threadId);
    if (!entry || entry.retiring || connection !== current) return;
    entry.retiring = true;
    try {
      await request("thread/unsubscribe", { threadId });
      if (connection === current && threads.get(threadId) === entry) threads.delete(threadId);
    } catch {
      if (connection === current) disconnect("codex-local-work-unsubscribe-failed");
    }
  }

  async function subscribe(thread, current, auth) {
    if (connection !== current) return;
    const local = localThreadEnvironment(thread, executorIds);
    if (!local) {
      if (thread?.id && threads.has(thread.id)) await unsubscribe(thread.id, current);
      return;
    }
    const previous = threads.get(thread.id);
    if (previous) {
      previous.thread = thread;
      previous.local = local;
      if (thread.status?.type !== "active") await unsubscribe(thread.id, current);
      return;
    }
    if (thread.status?.type !== "active" || subscribing.has(thread.id)) return;
    subscribing.add(thread.id);
    threads.set(thread.id, {
      thread,
      local,
      auth,
      baselinePending: true,
      turnModels: new Map(),
    });
    try {
      await request("thread/resume", { threadId: thread.id, excludeTurns: true });
      if (connection === current) {
        const entry = threads.get(thread.id);
        if (entry) entry.resumed = true;
      }
    } catch {
      if (connection === current) await unsubscribe(thread.id, current);
    } finally {
      if (connection === current) subscribing.delete(thread.id);
    }
  }

  async function discover(current, auth) {
    let cursor = null;
    const cursors = new Set();
    do {
      const page = await request("thread/list", {
        archived: false,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        originators: ORIGINATORS,
        ...(cursor ? { cursor } : {}),
      });
      if (connection !== current) return;
      const candidates = Array.isArray(page.data) ? page.data : [];
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
        while (connection === current && index < candidates.length) {
          await subscribe(candidates[index++], current, auth);
        }
      }));
      cursor = page.nextCursor || null;
      if (cursor && cursors.has(cursor)) throw new Error("Codex local Work pagination repeated");
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }

  async function notification(message, current) {
    const params = message.params || {};
    if (message.method === "thread/started") {
      await subscribe(params.thread, current, current.auth);
      return;
    }
    const entry = threads.get(params.threadId);
    if (!entry || entry.retiring) return;
    const turnId = params.turnId || params.turn?.id;
    if (message.method === "model/rerouted" && turnId && typeof params.toModel === "string" && params.toModel.trim()) {
      entry.turnModels.set(turnId, params.toModel.trim());
      if (entry.turnModels.size > 32) entry.turnModels.delete(entry.turnModels.keys().next().value);
    } else if (message.method === "thread/tokenUsage/updated") {
      const observation = observationForEvent({
        accountKey: entry.auth.accountKey,
        thread: { ...entry.thread, model: entry.turnModels.get(turnId) || "unknown" },
        environmentId: entry.local.environmentId,
        cwd: entry.local.cwd,
        turnId,
        tokenUsage: params.tokenUsage,
        baselineOnly: entry.baselinePending,
        state,
        now: new Date().toISOString(),
      });
      if (observation) await appendObservation(paths.events, observation);
      writeState(paths.state, state);
      entry.baselinePending = false;
    } else if (message.method === "turn/started" || message.method === "turn/completed") {
      entry.thread.status = { type: message.method === "turn/completed" ? "idle" : "active" };
    } else if (message.method === "thread/name/updated") {
      entry.thread.name = params.threadName || "";
    }
  }

  function connect(auth) {
    const current = socketFactory(auth);
    current.auth = auth;
    connection = current;
    const socket = current.socket;
    const active = () => !stopped && connection === current;
    socket.addEventListener("open", () => {
      if (!active()) return;
      request("initialize", {
        clientInfo: { name: "token_tracker_plus", version: "1" },
        capabilities: { experimentalApi: true },
      }).then(async () => {
        if (!active()) return;
        socket.send(JSON.stringify({ method: "initialized", params: {} }));
        failures = 0;
        retryAt = 0;
        await discover(current, auth);
      }).catch(() => active() && disconnect("codex-local-work-discovery-failed"));
    });
    socket.addEventListener("message", (event) => {
      if (!active() || typeof event.data !== "string") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id != null) {
        if (message.method) return;
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        clearTimeout(item.timer);
        if (message.error) item.reject(new Error("Codex local Work RPC rejected"));
        else item.resolve(message.result);
        return;
      }
      void notification(message, current).catch(() => disconnect("codex-local-work-store-failed"));
    });
    socket.addEventListener("close", () => active() && disconnect("codex-local-work-disconnected"));
    socket.addEventListener("error", () => active() && disconnect("codex-local-work-connect-failed"));
  }

  async function poll() {
    if (stopped) return;
    try {
      const auth = readAuth();
      if (!auth?.accessToken || !auth.accountId) {
        disconnect();
        return;
      }
      const ids = await scanExecutors();
      if (ids) executorIds = ids;
      if (!executorIds.size) {
        disconnect();
        return;
      }
      if (!connection && Date.now() >= retryAt) connect(auth);
    } catch {
      disconnect("codex-local-work-poller-failed");
    } finally {
      if (!stopped) timer = setTimeout(() => void poll(), executorIds.size ? pollMs : 30000);
    }
  }

  return {
    paths,
    start() {
      if (!stopped && !timer) void poll();
    },
    stop() {
      stopped = true;
      abortController.abort();
      if (timer) clearTimeout(timer);
      timer = null;
      disconnect();
    },
  };
}

module.exports = {
  APP_SERVER_URL,
  EVENT_NAME,
  ORIGINATORS,
  THREAD_SOURCES,
  codexAuthContext,
  createCodexLocalWorkWatcher,
  executorIdsFromProcesses,
  localExecutorIds,
  localThreadEnvironment,
  localWorkPaths,
  observationForEvent,
  readCodexAuth,
  usageCounters,
};
