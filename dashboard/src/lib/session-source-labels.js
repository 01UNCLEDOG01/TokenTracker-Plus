// 会话源 → 显示名。命名基准=SessionsPage.jsx 的 SOURCE_FILTERS（两处保持
// 同名；SessionsPage 的筛选项挂 copy()，这里只放静态品牌名，供限额页用量
// 缺口横幅等非筛选器场景复用）。未知源回退原始 id——新源接入没登记标签时
// 横幅仍可读，不会渲染成空白。
const SESSION_SOURCE_LABELS = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  loomy: "Loomy",
  grok: "Grok",
  workbuddy: "WorkBuddy",
  "workbuddy-ai": "WorkBuddy AI",
  dsh: "DeepSeek Harness",
  qoder: "Qoder",
  "qoder-cn": "Qoder CN",
  zcode: "ZCode",
  autoclaw: "AutoClaw",
  cola: "Cola",
  "tuanjie-cowork": "Tuanjie Cowork",
  raccoon: "SenseTime Raccoon",
  kimi: "Kimi",
  omp: "oh-my-pi",
  pi: "Pi",
  trae: "Trae",
  "trae-cn": "Trae CN",
  "minimax-code": "MiniMax Code",
  devin: "Devin",
};

export function sessionSourceLabel(source) {
  const key = String(source || "");
  return SESSION_SOURCE_LABELS[key] || key;
}

// YYYY-MM-DD → MM-DD（横幅短日期，与卡面「MM-DD 截止小字」惯例一致）；
// 非预期形态原样返回，绝不渲染出 undefined。
export function shortUsageDay(dayKey) {
  const key = String(dayKey || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key.slice(5) : key;
}
