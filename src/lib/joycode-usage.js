"use strict";

// JoyCode (京东 JoyCoder editor) keeps one task_history JSON per AI task under
// %APPDATA%\JoyCode\User\workspaceStorage\<hash>\JoyCode.joycoder-editor\.
// The API transcript has no usage rows, but the task history carries the
// provider-reported input/output totals. Turn those into queue-shaped rows so
// the usage cards and the 京东 achievement see the same numbers.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function joycodeWorkspaceRoots({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (platform !== "win32") return [];
  const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
  const root = path.join(appData, "JoyCode", "User", "workspaceStorage");
  if (!fs.existsSync(root)) return [];
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, "JoyCode.joycoder-editor"))
      .filter((dir) => fs.existsSync(path.join(dir, "task_history")));
  } catch {
    return [];
  }
}

function joycodeModelForTask(taskDir) {
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(taskDir, "api_conversation_history.json"), "utf8"));
    for (const row of rows) {
      if (typeof row?._model_id === "string" && row._model_id.trim()) return row._model_id.trim();
    }
  } catch {
    // Older/deleted tasks have no transcript; fall back to the editor's model.
  }
  return "JoyAI-Code-1.5";
}

function joycodeTaskRows({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const rows = [];
  const seen = new Set();
  for (const storageRoot of joycodeWorkspaceRoots({ home, env, platform })) {
    let files = [];
    try {
      files = fs.readdirSync(path.join(storageRoot, "task_history"))
        .filter((name) => name.endsWith(".json"));
    } catch {
      continue;
    }
    for (const name of files) {
      let task;
      try {
        task = JSON.parse(fs.readFileSync(path.join(storageRoot, "task_history", name), "utf8"));
      } catch {
        continue;
      }
      const id = String(task?.id || "").trim();
      const ts = Number(task?.ts);
      if (!id || !Number.isFinite(ts) || ts <= 0 || seen.has(id)) continue;
      const input = Math.max(0, Math.floor(Number(task?.tokensIn) || 0));
      const cachedRead = Math.max(0, Math.floor(Number(task?.cacheReads) || 0));
      const cacheWrite = Math.max(0, Math.floor(Number(task?.cacheWrites) || 0));
      const output = Math.max(0, Math.floor(Number(task?.tokensOut) || 0));
      const total = input + cachedRead + cacheWrite + output;
      if (total <= 0) continue;
      seen.add(id);
      const taskDir = String(task?.taskDirPath || "");
      rows.push({
        source: "joycode",
        model: taskDir ? joycodeModelForTask(taskDir) : "JoyAI-Code-1.5",
        hour_start: new Date(ts).toISOString(),
        input_tokens: input,
        cached_input_tokens: cachedRead,
        cache_creation_input_tokens: cacheWrite,
        output_tokens: output,
        reasoning_output_tokens: 0,
        total_tokens: total,
        total_cost_usd: 0,
        cost_usd: 0,
        conversation_count: 1,
        session_id: id,
        project_key: task?.workspacePath ? path.basename(String(task.workspacePath)) : null,
        usage_precision: "reported",
      });
    }
  }
  return rows.sort((a, b) => String(a.hour_start).localeCompare(String(b.hour_start)));
}

module.exports = { joycodeTaskRows, joycodeWorkspaceRoots };
