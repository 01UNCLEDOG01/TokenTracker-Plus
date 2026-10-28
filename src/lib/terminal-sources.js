"use strict";

// 哪些来源算「终端」（`terminal_purist` / 终端原教旨主义，以及 cliTokens 列）。
//
// 判据只有一个：**这行用量是不是在终端窗口里烧掉的**（CLI 或 TUI）。
// 不是「id 里有没有 cli」，也不是「厂商是不是也发过 CLI」—— 一个产品只要
// 存在桌面/IDE 外壳、而那条外壳写的是同一份日志，就没法证明用户当时坐在
// 终端里，这种来源不进指标（宁可少算，不可错算）。
//
// 每个条目都带本机证据（2026-10-29 实测）。要加新来源：先在本机把它的
// 家目录形态看清，写进表里再提交；**不要**把未知来源默认当终端 —— 未分类
// 的一律非终端，并在开发环境打印一次提示（见 isTerminalSource）。
//
// 判定依据的两类证据：
//   ① 目录形态：终端程序的 home 是 `projects/ plugins/ mcp.json settings.json`
//      `bin/ config.yaml sessions/` 这类；桌面应用则在 `%APPDATA%/<产品名>`
//      下有自己的 Electron 缓存/数据库，且 `~/.<id>` 里往往只有锁或配置。
//   ② 路径自证：`~/.zcode/cli/db/db.sqlite` 的 `cli` 段、`~/.codely-cli` 的
//      目录名，是产品自己写下的「这是 CLI 的库」。

// ── 终端：CLI / TUI ────────────────────────────────────────────────────────
const TERMINAL_SOURCES = new Map([
  ["claude", "Claude Code CLI：~/.claude/projects/**.jsonl 是 CLI 自己的转录"],
  ["codex", "Codex CLI：~/.codex/sessions/**/rollout-*.jsonl"],
  ["opencode", "OpenCode TUI：~/.local/share/opencode/opencode.db（桌面壳另在 %APPDATA%/ai.opencode.desktop）"],
  ["zcode", "ZCode CLI：~/.zcode/cli/db/db.sqlite，路径里的 cli 段自证"],
  ["kimi", "Kimi Code CLI：~/.kimi（桌面版另在 %APPDATA%/kimi-desktop）"],
  ["kimi-code", "Kimi Code CLI：~/.kimi-code"],
  ["dsh", "DeepSeek Harness CLI：~/.dsh/sessions + ~/.dsh/dsh-win32/busybox64.exe（harness 自带的终端工具链）"],
  ["tuanjie-cowork", "团结 Cowork CLI：~/.codely-cli（oauth_creds/model-config/tmp 形态；桌面壳在 %APPDATA%/TuanjieHub）"],
  ["codebuddy", "CodeBuddy CLI：~/.codebuddy（projects/plugins/mcp.json/settings.json，Claude-Code 式 CLI home；IDE 版是 %APPDATA%/CodeBuddy CN）"],
  ["minimax-code", "MiniMax Code CLI：~/.minimax（bin/ config.yaml agents/ run/，无 Electron 缓存）"],
]);

// ── 非终端：IDE / 桌面应用 / 网关 ───────────────────────────────────────────
// 只列「容易被误判成终端」的那些；其余未列的按未分类处理（同样非终端）。
const NON_TERMINAL_SOURCES = new Map([
  ["agent2api", "本地网关，不是人坐在里面的工具"],
  ["antigravity", "IDE：%APPDATA%/Antigravity、Antigravity IDE"],
  ["cursor", "IDE：%APPDATA%/Cursor"],
  ["copilot", "VS Code 扩展（不是终端程序，无自己的 CLI home）"],
  ["codearts", "CodeArts IDE（华为 IDE，不是终端程序）"],
  ["trae", "IDE：%APPDATA%/Trae"],
  ["trae-cn", "IDE：%APPDATA%/Trae CN、TRAE SOLO CN"],
  ["qoder", "IDE：%APPDATA%/Qoder"],
  ["qoder-cn", "IDE：%APPDATA%/QoderCN、QoderWork"],
  ["workbuddy", "桌面应用：%APPDATA%/WorkBuddy"],
  ["workbuddy-ai", "桌面应用：%APPDATA%/WorkBuddy AI"],
  ["raccoon", "桌面应用：%APPDATA%/office-raccoon（商汤小浣熊）"],
  ["autoclaw", "桌面应用：%APPDATA%/AutoClaw-official，内嵌 OpenCode 运行时（CLI 血统，但外壳是 GUI）"],
  ["cola", "桌面应用：%APPDATA%/Cola + ~/.cola 的 chat-history.db/apps/bookmarks"],
  ["loomy", "桌面应用：%APPDATA%/Loomy，内嵌 OpenCode 数据库"],
  ["reasonix", "桌面应用：%APPDATA%/reasonix + reasonix-desktop.exe（~/.reasonix 只剩 locks）"],
  ["mimo", "桌面应用：%APPDATA%/Xiaomi MiMo"],
  ["dumate", "桌面应用（DuMate 客户端）"],
  ["lmstudio", "桌面应用（LM Studio 本地模型工作台）"],
  ["unsloth", "桌面应用（Unsloth Studio 训练工作台）"],
  ["anythingllm", "桌面应用（AnythingLLM Desktop）"],
  ["acode", "IDE（AStudio，移动端/桌面编辑器）"],
  ["zed", "编辑器（Zed Agent 是编辑器里的 agent 面板）"],
  ["cline", "VS Code 扩展（无自己的终端会话）"],
  ["roo", "VS Code 扩展（Roo Code，无自己的终端会话）"],
  ["kilo-code", "VS Code 扩展（注意与 kilo-cli 区分：后者是 CLI）"],
]);

// 产品名自证：`gemini-cli` / `devin-cli` / `kilo-cli` / `kiro-cli` / `command-code`
// 这类 id 直接把「我是 CLI」写在名字里，不必逐条维护。
const CLI_NAME_HINT = /(?:^|[-_])cli(?:$|[-_])|cli$/;

const warnedUnknown = new Set();

function isTerminalSource(sourceKey, options = {}) {
  const src = String(sourceKey || "").toLowerCase().trim();
  if (!src) return false;
  if (TERMINAL_SOURCES.has(src)) return true;
  if (NON_TERMINAL_SOURCES.has(src)) return false;
  if (CLI_NAME_HINT.test(src)) return true;
  // 未分类：按非终端处理（宁少不算错），但让开发环境知道该补表了。
  if (!options.quiet && !warnedUnknown.has(src) && !process.env.NODE_TEST_CONTEXT) {
    warnedUnknown.add(src);
    console.warn(`[terminal-sources] unclassified source "${src}" treated as non-terminal — add it to src/lib/terminal-sources.js`);
  }
  return false;
}

function classifySource(sourceKey) {
  const src = String(sourceKey || "").toLowerCase().trim();
  if (TERMINAL_SOURCES.has(src)) return { terminal: true, evidence: TERMINAL_SOURCES.get(src) };
  if (NON_TERMINAL_SOURCES.has(src)) return { terminal: false, evidence: NON_TERMINAL_SOURCES.get(src) };
  if (CLI_NAME_HINT.test(src)) return { terminal: true, evidence: "id 自带 cli 后缀" };
  return { terminal: false, evidence: "未分类（按非终端处理）" };
}

function resetTerminalSourceWarningsForTests() {
  warnedUnknown.clear();
}

module.exports = {
  TERMINAL_SOURCES,
  NON_TERMINAL_SOURCES,
  isTerminalSource,
  classifySource,
  resetTerminalSourceWarningsForTests,
};
