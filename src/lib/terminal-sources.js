"use strict";

// 哪些来源算「终端」（`terminal_purist` / 终端原教旨主义，以及 cliTokens 列）。
//
// 判据只有一个：**这行用量是不是在终端窗口里烧掉的**（CLI 或 TUI）。
// 不看「厂商是不是也发过 CLI」—— 一个产品只要存在桌面/IDE 外壳、而那条外壳
// 写的是同一份日志，就没法证明用户当时坐在终端里，这种来源不进指标
// （宁可少算，不可错算）。id 自带 `cli` 的（gemini-cli / kiro-cli …）算
// 产品名自证，见 CLI_NAME_HINT；它只是省掉逐条登记，不是另一套判据。
//
// 三层结构（2026-10-29）：verified 计入 / excluded 明确不算 / candidate 待核实。
// 每个条目都带本机证据。要加新来源：先在本机把它的家目录形态看清，写进
// verified 或 excluded；**本机没装、拿不到形态证据的，写进 candidate**（不计入
// 也不猜，但会出现在 listUnresolvedSources() 里等审计）。完全没登记的 key 按
// 非终端处理并在开发环境打印一次提示（见 isTerminalSource）。
//
// 判定依据的两类证据：
//   ① 目录形态：终端程序的 home 是 `projects/ plugins/ mcp.json settings.json`
//      `bin/ config.yaml sessions/` 这类；桌面应用则在 `%APPDATA%/<产品名>`
//      下有自己的 Electron 缓存/数据库，且 `~/.<id>` 里往往只有锁或配置。
//   ② 路径自证：`~/.zcode/cli/db/db.sqlite` 的 `cli` 段、`~/.codely-cli` 的
//      目录名，是产品自己写下的「这是 CLI 的库」。
//
// ⚠️ 这不是「agent 视角的终端」，别按那个方向改。
// 业界（含各家大模型）常用另一套定义：**agent 能不能通过它 spawn 进程、流式读写
// stdin/stdout/stderr、拿退出码、维持 cwd/环境** —— 按那套，PTY、本地/远程 shell、
// SSH、容器交互 shell、tmux、**IDE 内嵌终端**都算终端，一次性 exec 算「受限终端」，
// 纯 API/MCP/文件/浏览器不算。那套定义本身是对的，但它回答的是「这个工具给不给
// agent 一个 shell」，而本指标问的是「用户当时是不是坐在终端里」。
// 同一个事实在两套定义下结论相反：
//   · Windows Terminal 这类 GUI 终端应用 —— 对 agent 无意义，对本指标是纯终端；
//   · Cursor/Trae/Qoder 的内嵌终端面板 —— 对 agent 是终端接口，对本指标不是
//     （人坐在 IDE 里，token 烧在编辑器窗口）。
// 2026-10-29 实测：若改按 agent 口径把带内嵌终端的 IDE 也算进来，本机达标天数
// 会从 18 天涨到 60 天（白银 30 直接跨过、逼近黄金 90），徽章就不再衡量任何习惯。
// 真要做「agent 有没有拿到 shell」那个维度，得另开一枚徽章，而且需要逐条 tool_use
// 类型的数据 —— 现在按 (source, 小时) 聚合的队列给不了这个粒度。
//
// 本指标的固有误差（写下来比假装没有好）：
//   ① 归因单位是「产生 token 的那个程序」，不是终端模拟器/传输层。Windows Terminal、
//      iTerm2、tmux、SSH 本身不产生 token，所以它们不进这张表 —— 进表的是跑在里面的
//      CLI/TUI。「SSH 终端算不算」在本指标里没有可判定的对象，只有「SSH 里跑的那个
//      CLI 算不算」。
//   ② 远端不可见：采集器只读本机文件（WSL 算本机，SSH 到别的机器不算），所以在远端
//      机器上跑的 CLI 用量进不了队列，这部分「人在终端里」的时间会被**低估**。
//   ③ 无头/后台调用分不出来：`claude -p` 被别的 agent 调起来时，按产品形态仍算终端，
//      这部分会被**高估**。source 级聚合拿不到「这一次是谁在前台」。

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
  ["copilot", "GitHub Copilot CLI：~/.copilot/otel/*.jsonl 的 OTEL 文件导出器（rollout.js 该段标题即 GitHub Copilot CLI；VS Code 扩展不写这里）"],
  ["acode", "AStudio（acode）：~/.acode 的 sessions/ + archived_sessions/ + config.toml + acode_notify 钩子，与 Codex CLI 同形"],
  ["every-code", "Every Code：rollout.js 注明「same shape as Codex, different home」，即 Codex CLI 同形的另一个 home"],
]);

// ── 非终端：IDE / 桌面应用 / 网关 ───────────────────────────────────────────
// 只列「容易被误判成终端」的那些；其余未列的按未分类处理（同样非终端）。
const NON_TERMINAL_SOURCES = new Map([
  ["agent2api", "本地网关，不是人坐在里面的工具"],
  ["magpie", "本地网关（127.0.0.1:3425），不是人坐在里面的工具"],
  ["antigravity", "IDE：%APPDATA%/Antigravity、Antigravity IDE"],
  ["cursor", "IDE：%APPDATA%/Cursor"],
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
  ["opensquilla", "桌面应用：%APPDATA%/@opensquilla/desktop-electron（CLI 版另在 ~/.opensquilla/state）"],
  ["mimo", "桌面应用：%APPDATA%/Xiaomi MiMo"],
  ["dumate", "桌面应用（DuMate 客户端）"],
  ["lmstudio", "桌面应用（LM Studio 本地模型工作台）"],
  ["unsloth", "桌面应用（Unsloth Studio 训练工作台）"],
  ["anythingllm", "桌面应用（AnythingLLM Desktop）"],
  ["zed", "编辑器（Zed Agent 是编辑器里的 agent 面板）"],
  ["cline", "VS Code 扩展（无自己的终端会话）"],
  ["roo", "VS Code 扩展（Roo Code，无自己的终端会话）"],
  ["kilo-code", "VS Code 扩展（注意与 kilo-cli 区分：后者是 CLI）"],
]);

// ── 待核实：形态像终端程序，但本机没装、拿不到证据 ─────────────────────────
// 这一层不是"排除"，是**待办**：不计入指标（不猜），但也不许静默消失 ——
// 它们会出现在 listUnresolvedSources() 里，审计时逐个定性后再挪进上面两张表。
// 2026-10-29 实测：这 18 个 key 都能被采集器产出，本机除 joycode 外都没安装。
const CANDIDATE_SOURCES = new Map([
  ["command-code", "Command Code —— 产品名是 CLI agent，本机未安装、无日志形态证据"],
  ["grok", "Grok Build —— 走 ~/.grok 的 CLI，本机未安装"],
  ["omp", "oh-my-pi —— TUI agent（~/.omp），本机未安装"],
  ["omo", "OmO —— pi 系 TUI，本机未安装"],
  ["pi", "pi —— TUI agent，本机未安装"],
  ["prime-agent", "Prime Agent —— CLI agent，本机未安装"],
  ["openclaw", "OpenClaw —— CLI agent（~/.openclaw），本机未安装；注意与 autoclaw 桌面版区分"],
  ["craft-agents", "Craft Agents —— CLI agent，本机未安装"],
  ["hermes-agent", "Hermes Agent —— CLI agent，本机未安装"],
  ["kilo", "kilo —— 与 kilo-cli / kilo-code 的对应关系未定，本机未安装"],
  ["droid", "Factory Droid —— CLI agent，本机未安装"],
  ["goose", "Goose —— 同时有 CLI 与桌面版，本机未安装，形态未定"],
  ["qwen-code", "Qwen Code —— CLI agent，本机未安装"],
  ["joycode", "JoyCode —— ~/.joycode 有 agent.json，但同目录还有 remote_binary_ide，IDE 还是 CLI 未定"],
  ["claudescience", "Claude Science —— 产品形态未知，本机未安装"],
  ["dots", "Dots —— 桌面端还是 CLI 未定，本机未安装"],
  ["muse", "Muse Code —— 桌面端还是 CLI 未定，本机未安装"],
]);

// 产品名自证：`gemini-cli` / `devin-cli` / `kilo-cli` / `kiro-cli` 这类 id
// 这类 id 直接把「我是 CLI」写在名字里，不必逐条维护。
const CLI_NAME_HINT = /(?:^|[-_])cli(?:$|[-_])|cli$/;

const warnedUnknown = new Set();

function isTerminalSource(sourceKey, options = {}) {
  const src = String(sourceKey || "").toLowerCase().trim();
  if (!src) return false;
  if (TERMINAL_SOURCES.has(src)) return true;
  if (NON_TERMINAL_SOURCES.has(src)) return false;
  if (CLI_NAME_HINT.test(src)) return true;
  // candidate 已登记，不计入但也不再重复告警（它已经躺在待审计清单里）。
  if (CANDIDATE_SOURCES.has(src)) return false;
  // 完全未知：按非终端处理（宁少算不错算），并让开发环境知道该补表了。
  if (!options.quiet && !warnedUnknown.has(src) && !process.env.NODE_TEST_CONTEXT) {
    warnedUnknown.add(src);
    console.warn(`[terminal-sources] unclassified source "${src}" treated as non-terminal — add it to src/lib/terminal-sources.js`);
  }
  return false;
}

function classifySource(sourceKey) {
  const src = String(sourceKey || "").toLowerCase().trim();
  if (TERMINAL_SOURCES.has(src)) return { layer: "verified", terminal: true, evidence: TERMINAL_SOURCES.get(src) };
  if (NON_TERMINAL_SOURCES.has(src)) return { layer: "excluded", terminal: false, evidence: NON_TERMINAL_SOURCES.get(src) };
  if (CLI_NAME_HINT.test(src)) return { layer: "verified", terminal: true, evidence: "id 自带 cli 后缀" };
  if (CANDIDATE_SOURCES.has(src)) return { layer: "candidate", terminal: false, evidence: CANDIDATE_SOURCES.get(src) };
  return { layer: "unknown", terminal: false, evidence: "未分类（按非终端处理）" };
}

// 审计入口：列出所有还没定性的 source（candidate 登记过的 + 运行时撞见的未知）。
function listUnresolvedSources() {
  return [...new Set([...CANDIDATE_SOURCES.keys(), ...warnedUnknown])].sort();
}

function resetTerminalSourceWarningsForTests() {
  warnedUnknown.clear();
}

module.exports = {
  TERMINAL_SOURCES,
  NON_TERMINAL_SOURCES,
  CANDIDATE_SOURCES,
  isTerminalSource,
  classifySource,
  listUnresolvedSources,
  resetTerminalSourceWarningsForTests,
};
