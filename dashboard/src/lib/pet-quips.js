/**
 * Localized "quip" pools for the floating desktop pet's speak-on-tap bubble,
 * ported 1:1 from the original macOS app's quip table. Kept as
 * a standalone data module — like Strings.swift — rather than the dashboard copy
 * registry, because the pet is a minimal standalone entry without the i18n provider.
 * (Exception, review 563: the new Ark Agent Plan rows resolve their provider name
 * and window labels through copy() so they stay in sync with the Limits page.)
 *
 * Full macOS parity: `buildQuipPool` reproduces the macOS companion's `quipPool`
 * ordering 1:1 — today data (tokens + cost + tier) → 7d/30d rolling → heatmap
 * streak/active days → top models → conversation count → personality. The native host
 * now pushes ALL of these figures (window.__ttPetStats), the same ones macOS reads from
 * its DashboardViewModel, so the Windows pet is no longer limited to today's numbers.
 * The caller rotates through the pool by index on each tap (like macOS `quipIndex`):
 * because the data-rich lines outnumber the handful of personality lines, most taps
 * surface real numbers and personality stays a natural minority — no random weighting.
 */

import { copy } from "./copy";
import { MAX_PET_LIMIT_ROWS } from "./pet-limit-selection.js";
import { formatChineseNumber } from "./format";

const QUIPS = {
  "en": {
    empty: [
      "😴 No tokens yet today", "💬 Start chatting to wake me up!", "🌙 Quiet day so far...",
      "⌨️ Waiting for your first prompt", "💤 Zzz... nothing to count", "🌅 The calm before the storm?",
      "✨ I'm ready when you are!",
    ],
    warmup: ["☕ Just warming up!", "🌱 A gentle start"],
    flow: ["🎯 Getting into the flow!", "💪 Solid progress today"],
    busy: ["🔥 Busy day!", "⚡ You're on a roll!"],
    heavy: ["🚀 Heavy usage today!", "🖨️ Token machine goes brrr"],
    massive: ["🤯 MASSIVE day!", "🔥 Token counter on fire!"],
    personality: [
      "👆 Tap me for more!", "📋 I count so you don't have to", "✨ Every token tells a story",
      "🤝 Your AI spending buddy", "👋 Hey there~",
    ],
  },
  "zh-CN": {
    empty: [
      "😴 今天还没有 tokens", "💬 发起一次对话来唤醒我！", "🌙 今天暂时很安静...",
      "⌨️ 等待你的第一个 prompt", "💤 Zzz... 还没有可统计内容", "🌅 风暴前的平静？", "✨ 我已经准备好了！",
    ],
    warmup: ["☕ 刚刚热身！", "🌱 温和开局"],
    flow: ["🎯 开始进入状态！", "💪 今天进展不错"],
    busy: ["🔥 今天很忙！", "⚡ 状态正佳！"],
    heavy: ["🚀 今天用量很高！", "🖨️ Token 机器启动"],
    massive: ["🤯 今天用量爆表！", "🔥 Token 计数器燃起来了！"],
    personality: ["👆 点我查看更多！", "📋 我来帮你计数", "✨ 每个 token 都有故事", "🤝 你的 AI 花费伙伴", "👋 你好呀~"],
  },
  "zh-TW": {
    empty: [
      "😴 今天還沒有 tokens", "💬 發起一次對話來喚醒我！", "🌙 今天暫時很安靜...",
      "⌨️ 等待你的第一個 prompt", "💤 Zzz... 還沒有可統計內容", "🌅 風暴前的平靜？", "✨ 我已經準備好了！",
    ],
    warmup: ["☕ 剛剛熱身！", "🌱 溫和開局"],
    flow: ["🎯 開始進入狀態！", "💪 今天進展不錯"],
    busy: ["🔥 今天很忙！", "⚡ 狀態正佳！"],
    heavy: ["🚀 今天用量很高！", "🖨️ Token 機器啟動"],
    massive: ["🤯 今天用量爆表！", "🔥 Token 計數器燃起來了！"],
    personality: ["👆 點我檢視更多！", "📋 我來幫你計數", "✨ 每個 token 都有故事", "🤝 你的 AI 花費夥伴", "👋 你好呀~"],
  },
  "ja": {
    empty: [
      "😴 今日はまだトークンなし", "💬 話しかけて起こして！", "🌙 今のところ静かな一日...",
      "⌨️ 最初のプロンプトを待っています", "💤 Zzz... 数えるものがありません", "🌅 嵐の前の静けさ？", "✨ いつでも準備OK！",
    ],
    warmup: ["☕ ウォームアップ中！", "🌱 穏やかな滑り出し"],
    flow: ["🎯 調子が出てきた！", "💪 今日は順調"],
    busy: ["🔥 忙しい一日！", "⚡ 絶好調！"],
    heavy: ["🚀 今日は使用量が多い！", "🖨️ トークンマシン全開"],
    massive: ["🤯 爆発的な一日！", "🔥 トークンカウンター炎上中！"],
    personality: ["👆 タップして詳細表示！", "📋 数えるのは私にお任せ", "✨ どのトークンにも物語がある", "🤝 あなたの AI 支出の相棒", "👋 やあ~"],
  },
  "ko": {
    empty: [
      "😴 오늘은 아직 토큰이 없어요", "💬 말을 걸어 깨워주세요!", "🌙 아직은 조용한 하루...",
      "⌨️ 첫 프롬프트를 기다리는 중", "💤 Zzz... 셀 게 없네요", "🌅 폭풍 전의 고요?", "✨ 준비됐어요!",
    ],
    warmup: ["☕ 이제 막 시동 중!", "🌱 잔잔한 출발"],
    flow: ["🎯 흐름을 타는 중!", "💪 오늘 순조로워요"],
    busy: ["🔥 바쁜 하루!", "⚡ 물 올랐어요!"],
    heavy: ["🚀 오늘 사용량 많네요!", "🖨️ 토큰 머신 풀가동"],
    massive: ["🤯 폭발적인 하루!", "🔥 토큰 카운터 불났어요!"],
    personality: ["👆 더 보려면 탭하세요!", "📋 세는 건 제가 할게요", "✨ 모든 토큰엔 이야기가 있죠", "🤝 당신의 AI 지출 친구", "👋 안녕하세요~"],
  },
};

// Usage-aware "today data" quips — ported 1:1 from the macOS companion's quipPool
// (tokensToday / tokensSpentToday / aiInvestedToday / billToday / aiTabToday). The
// `{tokens}` / `{cost}` placeholders are filled with the SAME formatted figures the
// hover bubble shows. `tokens` is always eligible; the `cost` lines only when today's
// cost rounds above zero (matching macOS, which skips them at $0.00).
const TODAY_QUIPS = {
  "en": {
    tokens: ["📊 Today: {tokens} tokens"],
    cost: [
      "📈 {tokens} tokens — {cost} spent today",
      "💰 {cost} invested in AI so far",
      "🧾 Today's bill: {cost} for {tokens} tokens",
      "💳 AI tab today: {cost}",
    ],
  },
  "zh-CN": {
    tokens: ["📊 今日：{tokens} tokens"],
    cost: [
      "📈 今日 {tokens} tokens，花费 {cost}",
      "💰 今日 AI 投入：{cost}",
      "🧾 今日账单：{cost}，{tokens} tokens",
      "💳 今日 AI 账单：{cost}",
    ],
  },
  "zh-TW": {
    tokens: ["📊 今日：{tokens} tokens"],
    cost: [
      "📈 今日 {tokens} tokens，花費 {cost}",
      "💰 今日 AI 投入：{cost}",
      "🧾 今日賬單：{cost}，{tokens} tokens",
      "💳 今日 AI 賬單：{cost}",
    ],
  },
  "ja": {
    tokens: ["📊 今日：{tokens} tokens"],
    cost: [
      "📈 今日 {tokens} tokens、{cost} 使用",
      "💰 これまでの AI 投資：{cost}",
      "🧾 今日の請求：{cost}（{tokens} tokens）",
      "💳 今日の AI 利用料：{cost}",
    ],
  },
  "ko": {
    tokens: ["📊 오늘: {tokens} tokens"],
    cost: [
      "📈 오늘 {tokens} tokens, {cost} 지출",
      "💰 지금까지 AI 투자: {cost}",
      "🧾 오늘 청구: {cost}, {tokens} tokens",
      "💳 오늘 AI 비용: {cost}",
    ],
  },
};

// Rolling / heatmap / top-model / conversation quips — ported 1:1 from the macOS
// companion's quipPool (Strings.sevenDayTotal / activeDaysThisWeek / perfectStreak /
// thirtyDayTotal / averagingPerDay / streakDays / activeDaysAllTime / topModel /
// runnerUp / modelCount / multiToolSetup / conversationsToday / busyTalker). The native
// host pushes these figures (window.__ttPetStats) — the same ones macOS reads from its
// DashboardViewModel. Placeholders: {tokens} compact token count, {n} a count, {name}
// model name, {percent} share (one decimal, no % — matching macOS), {names} provider
// list, {s} English plural suffix.
const STATS_QUIPS = {
  "en": {
    sevenDayTotal: "📅 7-day total: {tokens} tokens",
    activeDaysThisWeek: "{n} active days this week",
    perfectStreak: "🏆 7/7 active days — perfect streak!",
    thirtyDayTotal: "📆 30-day total: {tokens} tokens",
    averagingPerDay: "📊 Averaging ~{tokens}/day this month",
    streakDays: "🔥 {n}-day streak! Keep it going",
    activeDaysAllTime: "📈 {n} active days all-time!",
    topModel: "🥇 Top model: {name} ({percent})",
    runnerUp: "🥈 Runner-up: {name} at {percent}",
    modelCount: "🧰 Using {n} different models",
    multiToolSetup: "🔀 Multi-tool setup: {names}",
    conversationsToday: "💬 {n} conversation{s} today",
    busyTalker: "🗣️ {n} chats! Busy talker today",
  },
  "zh-CN": {
    sevenDayTotal: "📅 7 天总计：{tokens} tokens",
    activeDaysThisWeek: "本周 {n} 个活跃日",
    perfectStreak: "🏆 7/7 活跃日，完美连续！",
    thirtyDayTotal: "📆 30 天总计：{tokens} tokens",
    averagingPerDay: "📊 本月平均约 {tokens}/天",
    streakDays: "🔥 连续 {n} 天！继续保持",
    activeDaysAllTime: "📈 累计 {n} 个活跃日！",
    topModel: "🥇 最常用模型：{name}（{percent}）",
    runnerUp: "🥈 第二名：{name}，{percent}",
    modelCount: "🧰 使用了 {n} 个不同模型",
    multiToolSetup: "🔀 多工具组合：{names}",
    conversationsToday: "💬 今日 {n} 次对话",
    busyTalker: "🗣️ {n} 次聊天，今天很忙",
  },
  "zh-TW": {
    sevenDayTotal: "📅 7 天總計：{tokens} tokens",
    activeDaysThisWeek: "本週 {n} 個活躍日",
    perfectStreak: "🏆 7/7 活躍日，完美連續！",
    thirtyDayTotal: "📆 30 天總計：{tokens} tokens",
    averagingPerDay: "📊 本月平均約 {tokens}/天",
    streakDays: "🔥 連續 {n} 天！繼續保持",
    activeDaysAllTime: "📈 累計 {n} 個活躍日！",
    topModel: "🥇 最常用模型：{name}（{percent}）",
    runnerUp: "🥈 第二名：{name}，{percent}",
    modelCount: "🧰 使用了 {n} 個不同模型",
    multiToolSetup: "🔀 多工具組合：{names}",
    conversationsToday: "💬 今日 {n} 次對話",
    busyTalker: "🗣️ {n} 次聊天，今天很忙",
  },
  "ja": {
    sevenDayTotal: "📅 7日間合計：{tokens} tokens",
    activeDaysThisWeek: "今週 {n} アクティブ日",
    perfectStreak: "🏆 7/7 アクティブ日 — 完璧な連続記録！",
    thirtyDayTotal: "📆 30日間合計：{tokens} tokens",
    averagingPerDay: "📊 今月は平均約 {tokens}/日",
    streakDays: "🔥 {n}日連続！この調子で",
    activeDaysAllTime: "📈 累計 {n} アクティブ日！",
    topModel: "🥇 最も使用したモデル：{name}（{percent}）",
    runnerUp: "🥈 2位：{name}（{percent}）",
    modelCount: "🧰 {n} 種類のモデルを使用中",
    multiToolSetup: "🔀 マルチツール構成：{names}",
    conversationsToday: "💬 今日 {n} 件の会話",
    busyTalker: "🗣️ {n} 回のチャット！今日はおしゃべり",
  },
  "ko": {
    sevenDayTotal: "📅 7일 합계: {tokens} tokens",
    activeDaysThisWeek: "이번 주 활동일 {n}일",
    perfectStreak: "🏆 7/7 활동일 — 완벽한 연속 기록!",
    thirtyDayTotal: "📆 30일 합계: {tokens} tokens",
    averagingPerDay: "📊 이번 달 하루 평균 ~{tokens}",
    streakDays: "🔥 {n}일 연속! 계속 가요",
    activeDaysAllTime: "📈 누적 활동일 {n}일!",
    topModel: "🥇 최다 사용 모델: {name} ({percent})",
    runnerUp: "🥈 2위: {name}, {percent}",
    modelCount: "🧰 서로 다른 모델 {n}개 사용 중",
    multiToolSetup: "🔀 멀티 툴 구성: {names}",
    conversationsToday: "💬 오늘 대화 {n}건",
    busyTalker: "🗣️ 채팅 {n}회! 오늘 수다스럽네요",
  },
};

// Shown (and used for tap quips) while a sync is in progress — ported from the
// macOS app's syncingQuips.
const SYNCING_QUIPS = {
  "en": ["⏳ Crunching numbers...", "📡 Fetching latest data!", "🔄 One moment, syncing...", "🧮 Counting your tokens~"],
  "zh-CN": ["⏳ 正在计算数据...", "📡 正在获取最新数据！", "🔄 稍等，正在同步...", "🧮 正在统计 tokens~"],
  "zh-TW": ["⏳ 正在計算資料...", "📡 正在獲取最新資料！", "🔄 稍等，正在同步...", "🧮 正在統計 tokens~"],
  "ja": ["⏳ 計算中...", "📡 最新データを取得中！", "🔄 少々お待ちを、同期中...", "🧮 トークンを数えています~"],
  "ko": ["⏳ 계산 중...", "📡 최신 데이터 가져오는 중!", "🔄 잠시만요, 동기화 중...", "🧮 토큰을 세는 중~"],
};

// Hover-bubble labels (the dynamic usage line is composed in pet.jsx).
const PET_LABELS = {
  "en": { today: "Today", newUsage: "New usage", noUsage: "No usage yet today", offline: "Offline · can't reach the server", syncing: "Syncing…" },
  "zh-CN": { today: "今日", newUsage: "新增用量", noUsage: "今天还没有用量", offline: "离线 · 连不上服务", syncing: "正在同步…" },
  "zh-TW": { today: "今日", newUsage: "新增用量", noUsage: "今天還沒有用量", offline: "離線 · 連不上服務", syncing: "正在同步…" },
  "ja": { today: "今日", newUsage: "新しい使用量", noUsage: "今日はまだ使用なし", offline: "オフライン · サーバーに接続できません", syncing: "同期中…" },
  "ko": { today: "오늘", newUsage: "새 사용량", noUsage: "오늘 사용 없음", offline: "오프라인 · 서버에 연결할 수 없음", syncing: "동기화 중…" },
};

/** Localized hover-bubble labels for the given locale. */
export function petLabels(locale) {
  return PET_LABELS[normalizePetLocale(locale)] || PET_LABELS.en;
}

function tierFor(tokens) {
  if (tokens <= 0) return "empty";
  if (tokens < 50_000) return "warmup";
  if (tokens < 200_000) return "flow";
  if (tokens < 500_000) return "busy";
  if (tokens < 2_000_000) return "heavy";
  return "massive";
}

/** Map any locale tag / preference to one of the supported quip locales. */
export function normalizePetLocale(raw) {
  const tag = String(raw || "").toLowerCase();
  if (!tag || tag === "system") return systemPetLocale();
  if (tag.startsWith("zh")) {
    return /(tw|hk|mo|hant)/.test(tag) ? "zh-TW" : "zh-CN";
  }
  if (tag.startsWith("ja")) return "ja";
  if (tag.startsWith("ko")) return "ko";
  return "en";
}

function systemPetLocale() {
  try {
    return normalizePetLocale(navigator.language || "en");
  } catch {
    return "en";
  }
}

/** Fill {key} placeholders from a vars map; unmatched braces are left as-is. */
function fillVars(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Capitalize the first letter (matches macOS `String.capitalized` for single words). */
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Compact token formatter (1 decimal K/M/B) — matches the tray's UsagePoller.FormatTokens
 * and the macOS TokenFormatter.formatCompact so every surface reads the same number.
 */
export function formatCompactTokens(n, { unitSystem } = {}) {
  if (unitSystem === "chinese") return formatChineseNumber(n, { decimals: 1 });
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

const PET_LIMIT_PROVIDER_NAMES = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
  kimi: "Kimi",
  kiro: "Kiro",
  grok: "Grok",
  copilot: "GitHub Copilot",
  antigravity: "Antigravity",
  apigoto: "APIGOTO",
  sensenova: "SenseNova",
  zcode: "ZCode",
  opencodeGo: "OpenCode Go",
  qoder: "Qoder",
  codingPlan: "Ark Coding Plan",
  // 小浣熊 (Raccoon) — balance-only card, no windows: the name map entry keeps
  // quips that mention the provider consistent with the Limits page title.
  raccoon: "Raccoon",
  deepseek: "DeepSeek",
  trae: "Trae",
  codearts: "CodeArts",
  clinePass: "Cline Pass",
  agentRouter: "AgentRouter",
};

// Ark Agent Plan and Command Code resolve through the copy registry (reviews
// 563 / 594) so the pet row always matches the Limits page naming.
const PET_LIMIT_PROVIDER_COPY_NAME_KEYS = {
  agentPlan: "limits.provider.ark_agent_plan",
  commandCode: "limits.provider.command_code",
  devin: "limits.provider.devin",
  workbuddy: "limits.provider.workbuddy",
  workbuddyAi: "limits.provider.workbuddy_ai",
  qoderCn: "limits.provider.qoder_cn",
  minimax: "limits.provider.minimax",
  traeMain: "limits.provider.trae_main",
};

// Qoder's three credit pools, named the way the official usage panel names
// them (mirrors usage-limits-provider-specs.js — the pet cannot import from
// the components tree without dragging the panel bundle into pet.html).
const QODER_POOL_LABEL_KEYS = {
  plan: "limits.label.qoder_pool_plan",
  resourcePackage: "limits.label.qoder_pool_resource",
  dedicated: "limits.label.qoder_pool_dedicated",
};

// Unix timestamps are normally seconds; values above this order of magnitude
// are treated as milliseconds. Keep the cutoff semantic and local to the pet
// formatter so it cannot be mistaken for an achievement threshold literal.
const PET_LIMIT_MS_CUTOFF = 10 ** 10;

function petLimitResetDate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    // The Codex endpoint reports Unix seconds; tolerate milliseconds too so a
    // future provider cannot turn the reset label into a date in 1970.
    return new Date(value > PET_LIMIT_MS_CUTOFF ? value : value * 1000);
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function petLimitResetDistance(value) {
  const date = petLimitResetDate(value);
  if (!date) return null;
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

/** Read every configured provider window from the limits payload. */
/**
 * ZCode windows as [label, window] pairs, mirroring the limits panel: coding plans use
 * 5h / Weekly / Tools, start plans use the server-labelled buckets (daily allowances
 * and promotional grants), and payloads without bucket labels keep the fixed GLM labels.
 */
function zcodeQuipWindows(zcode) {
  if (zcode?.plan_kind === "coding-plan") {
    return [["5h", zcode.primary_window, "5h"], ["Weekly", zcode.secondary_window, "weekly"], ["Tools", zcode.tertiary_window, "tools"]];
  }
  const labeled = Array.isArray(zcode?.buckets) ? zcode.buckets.filter((b) => b?.label && b.window) : [];
  if (labeled.length) return labeled.map((b, i) => [b.label, b.window, `bucket-${b.entitlement_id || i}`]);
  return [["GLM-5.2", zcode?.primary_window, "glm52"], ["GLM-5 Turbo", zcode?.secondary_window, "glm5t"]];
}

// The owner pins these to the top of the hover card, in this exact order;
// every other provider follows by urgency (most used first). Keys are the
// Limits page's spec keys (usage-limits-provider-specs.js) — the pet picker
// writes exactly these keys, so the picker and this card can never drift.
const PET_PINNED_LIMIT_ROWS = [
  ["antigravity", "gemini-weekly"],
  ["antigravity", "gemini-5h"],
  ["antigravity", "claude-weekly"],
  ["apigoto", "weekly"],
  // SenseNova's general-pool windows. Keyed by spec key, so a localized label
  // can never unpin a row.
  ["sensenova", "general-5h"],
  ["sensenova", "general-7d"],
];
const isPinnedPetLimitRow = (providerId, windowKey) =>
  PET_PINNED_LIMIT_ROWS.some(([p, k]) => p === providerId && k === windowKey);
const petLimitProviderName = (providerId) =>
  PET_LIMIT_PROVIDER_COPY_NAME_KEYS[providerId]
    ? copy(PET_LIMIT_PROVIDER_COPY_NAME_KEYS[providerId])
    : PET_LIMIT_PROVIDER_NAMES[providerId] || providerId;
const GROK_PRODUCT_LABEL_KEYS = {
  GrokBuild: "limits.label.grok_build",
  GrokBot: "limits.label.grok_bot",
  GrokChat: "limits.label.grok_chat",
  GrokImagine: "limits.label.grok_imagine",
  GrokVoice: "limits.label.grok_voice",
  Cursor: "limits.label.grok_cursor",
};

/** Limits-page label for a Grok product share. Known ids use copy(); a new id uses the server label. */
function grokProductPetLabel(entry) {
  const product = typeof entry?.product === "string" ? entry.product : "";
  const key = GROK_PRODUCT_LABEL_KEYS[product];
  if (key) return copy(key);
  return typeof entry?.label === "string" ? entry.label.trim() : "";
}

function collectPetLimitRows(limits) {
  if (!limits || typeof limits !== "object") return [];

  const rows = [];
  // `windowLabel` is what the card prints; `windowKey` is the stable identifier
  // pinned rows match on, so translating a label can never unpin a row.
  // `extra` (upstream Grok product rows) is spread into the row when passed.
  const addWindow = (providerId, windowLabel, provider, window, getUsed, getReset = (w) => w?.reset_at, windowKey = windowLabel, extra = null) => {
    if (provider?.configured !== true || provider?.error != null) return;
    const raw = window == null ? NaN : Number(getUsed(window));
    // Pinned rows are the owner's fixed dashboard: a missing bucket (e.g. a
    // freshly reset window before its first data point lands) still shows as
    // 0% instead of silently dropping off the card.
    if (!Number.isFinite(raw)) {
      if (isPinnedPetLimitRow(providerId, windowKey)) {
        rows.push({
          provider: petLimitProviderName(providerId),
          providerId,
          window: windowLabel,
          windowKey,
          usedPercent: 0,
          resetAt: null,
        });
      }
      return;
    }
    rows.push({
      provider: petLimitProviderName(providerId),
      providerId,
      window: windowLabel,
      windowKey,
      usedPercent: Math.min(100, Math.max(0, raw)),
      resetAt: getReset(window),
      ...(extra && typeof extra === "object" ? extra : {}),
    });
  };
  const addGeneric = (providerId, provider, windows) => {
    for (const [label, window, key] of windows) {
      addWindow(providerId, label, provider, window, (w) => w?.used_percent, (w) => w?.reset_at, key ?? label);
    }
  };

  const claude = limits.claude;
  addWindow("claude", "5h", claude, claude?.five_hour, (w) => w?.utilization, (w) => w?.resets_at, "5h");
  addWindow("claude", "7d", claude, claude?.seven_day, (w) => w?.utilization, (w) => w?.resets_at, "7d");
  addWindow("claude", "Opus", claude, claude?.seven_day_opus, (w) => w?.utilization, (w) => w?.resets_at, "opus");
  if (claude?.configured === true && claude?.error == null && Array.isArray(claude.weekly_scoped)) {
    for (const window of claude.weekly_scoped) {
      const label = window?.label || "weekly";
      // Key template must match the panel spec (`scoped-${w.label}`) byte for byte.
      addWindow("claude", label, claude, window, (w) => w?.utilization, (w) => w?.resets_at, `scoped-${window?.label}`);
    }
  }

  const codex = limits.codex;
  addWindow("codex", "5h", codex, codex?.primary_window, (w) => w?.used_percent, undefined, "5h");
  addWindow("codex", "7d", codex, codex?.secondary_window, (w) => w?.used_percent, undefined, "7d");
  addWindow("codex", "Credits", codex, codex?.credit_window, (w) => w?.used_percent, undefined, "credits");
  addWindow("codex", "Spark 5h", codex, codex?.spark_primary_window, (w) => w?.used_percent, undefined, "spark-5h");
  addWindow("codex", "Spark 7d", codex, codex?.spark_secondary_window, (w) => w?.used_percent, undefined, "spark-7d");

  // Window keys below are the Limits page's spec keys (usage-limits-provider-specs.js):
  // the pet picker stores `<providerId>::<spec.key>`, so a label change can
  // never silently unmatch a picked row. Labels stay display-only.
  addGeneric("cursor", limits.cursor, [["Plan", limits.cursor?.primary_window, "plan"], ["Auto", limits.cursor?.secondary_window, "auto"], ["API", limits.cursor?.tertiary_window, "api"], [copy("limits.label.cursor_grok_bot"), limits.cursor?.quaternary_window, "grok-bot"]]);
  addGeneric("gemini", limits.gemini, [["Pro", limits.gemini?.primary_window, "pro"], ["Flash", limits.gemini?.secondary_window, "flash"], ["Lite", limits.gemini?.tertiary_window, "lite"]]);
  addGeneric("kimi", limits.kimi, [["Weekly", limits.kimi?.primary_window, "weekly"], ["5h", limits.kimi?.secondary_window, "5h"], ["Total", limits.kimi?.tertiary_window, "total"]]);
  addGeneric("kiro", limits.kiro, [["Month", limits.kiro?.primary_window, "month"], ["Bonus", limits.kiro?.secondary_window, "bonus"]]);
  // Grok's pool row key follows the billing period exactly like the panel spec
  // (week/day/month); products are shares of that pool, not separate quotas.
  if (limits.grok?.configured === true && limits.grok?.error == null) {
    const grokPeriod = limits.grok?.period_type === "weekly" ? "week" : limits.grok?.period_type === "daily" ? "day" : "month";
    const grokLabel = grokPeriod === "week" ? copy("limits.label.grok_week") : grokPeriod === "day" ? copy("limits.label.grok_day") : copy("limits.label.grok_month");
    addWindow("grok", grokLabel, limits.grok, limits.grok?.primary_window, (w) => w?.used_percent, (w) => w?.reset_at, grokPeriod);
  }
  addGeneric("grok", limits.grok, [["On-demand", limits.grok?.secondary_window, "ondemand"]]);
  if (limits.grok?.configured === true && limits.grok?.error == null && Array.isArray(limits.grok.products)) {
    for (const entry of limits.grok.products) {
      const label = grokProductPetLabel(entry);
      if (!label) continue;
      addWindow("grok", label, limits.grok, entry?.window, (w) => w?.used_percent, (w) => w?.reset_at, undefined, { share: true });
    }
  }
  addGeneric("copilot", limits.copilot, [["Premium", limits.copilot?.primary_window, "premium"], ["Chat", limits.copilot?.secondary_window, "chat"]]);
  addGeneric("antigravity", limits.antigravity, [
    ["Gemini weekly", limits.antigravity?.tertiary_window, "gemini-weekly"],
    ["Gemini 5h", limits.antigravity?.quaternary_window, "gemini-5h"],
    ["Claude weekly", limits.antigravity?.primary_window, "claude-weekly"],
    ["Claude 5h", limits.antigravity?.secondary_window, "claude-5h"],
  ]);
  addGeneric("apigoto", limits.apigoto, [
    ["weekly", limits.apigoto?.primary_window, "weekly"],
    [copy("limits.label.apigoto_subscription"), limits.apigoto?.secondary_window, "subscription"],
  ]);
  // SenseNova (商汤日日新): both pools, 5h + 7d each, mirroring the panel spec.
  addGeneric("sensenova", limits.sensenova, [
    [copy("limits.label.sensenova_general_5h"), limits.sensenova?.primary_window, "general-5h"],
    [copy("limits.label.sensenova_general_weekly"), limits.sensenova?.secondary_window, "general-7d"],
    [copy("limits.label.sensenova_flash_lite_5h"), limits.sensenova?.tertiary_window, "flash-lite-5h"],
    [copy("limits.label.sensenova_flash_lite_weekly"), limits.sensenova?.quaternary_window, "flash-lite-7d"],
  ]);
  addGeneric("zcode", limits.zcode, zcodeQuipWindows(limits.zcode));
  addGeneric("opencodeGo", limits.opencodeGo, [["5h", limits.opencodeGo?.primary_window, "5h"], ["Weekly", limits.opencodeGo?.secondary_window, "weekly"], ["Month", limits.opencodeGo?.tertiary_window, "monthly"]]);
  // Same split as the panel spec: when the provider reports named pools
  // (套餐内/资源包/SOTA) the rows are keyed by pool.key, otherwise by the
  // summed windows — a picked row must match whichever shape arrived.
  const qoderPools = Array.isArray(limits.qoder?.pools) ? limits.qoder.pools.filter((pool) => Number(pool.limit) > 0) : [];
  if (qoderPools.length) {
    for (const pool of qoderPools) {
      addWindow("qoder", copy(QODER_POOL_LABEL_KEYS[pool.key] || "limits.label.qoder_credits"), limits.qoder, {
        used_percent: pool.percent,
        used_credits: pool.used,
        limit_credits: pool.limit,
        remaining_credits: pool.remaining,
        unit: pool.unit,
      }, (w) => w?.used_percent, (w) => w?.expires_at ?? null, pool.key);
    }
  } else {
    addGeneric("qoder", limits.qoder, [["Credits", limits.qoder?.primary_window, "credits"], [copy("limits.label.qoder_addon_credits"), limits.qoder?.tertiary_window, "addon"], ["Ultimate Free Calls", limits.qoder?.secondary_window, "ultimate"]]);
  }
  // Qoder CN mirrors the panel spec (credits / add-on / ultimate); pools with a
  // 0 limit are not drawn there either, so they are skipped here.
  addGeneric("qoderCn", limits.qoderCn, [
    [copy("limits.label.qoder_cn_credits"), limits.qoderCn?.primary_window, "credits"],
    [copy("limits.label.qoder_cn_addon_credits"), limits.qoderCn?.tertiary_window, "addon"],
    [copy("limits.label.qoder_cn_ultimate"), limits.qoderCn?.secondary_window, "ultimate"],
  ].filter(([, window]) => Number(window?.limit_credits) > 0));
  addGeneric("commandCode", limits.commandCode, [
    [copy("limits.label.command_code_5h"), limits.commandCode?.primary_window, "5h"],
    [copy("limits.label.command_code_weekly"), limits.commandCode?.secondary_window, "weekly"],
  ]);
  addGeneric("codingPlan", limits.codingPlan, [["5h", limits.codingPlan?.primary_window, "5h"], ["Week", limits.codingPlan?.secondary_window, "weekly"], ["Month", limits.codingPlan?.tertiary_window, "monthly"]]);
  addGeneric("agentPlan", limits.agentPlan, [
    ["5h", limits.agentPlan?.primary_window, "5h"],
    [copy("limits.label.ark_agent_plan_weekly"), limits.agentPlan?.secondary_window, "weekly"],
    [copy("limits.label.ark_agent_plan_monthly"), limits.agentPlan?.tertiary_window, "monthly"],
  ]);
  addGeneric("devin", limits.devin, [
    [copy("limits.label.devin_daily"), limits.devin?.primary_window, "daily"],
    [copy("limits.label.devin_weekly"), limits.devin?.secondary_window, "weekly"],
  ]);
  addGeneric("minimax", limits.minimax, [
    [copy("limits.label.minimax_5h"), limits.minimax?.primary_window, "5h"],
    [copy("limits.label.minimax_weekly"), limits.minimax?.secondary_window, "weekly"],
  ]);
  addGeneric("workbuddy", limits.workbuddy, [
    [copy("limits.label.workbuddy_plan"), limits.workbuddy?.primary_window, "plan"],
    [copy("limits.label.workbuddy_reward"), limits.workbuddy?.reward_window, "reward"],
  ]);
  addGeneric("workbuddyAi", limits.workbuddyAi, [
    [copy("limits.label.workbuddy_plan"), limits.workbuddyAi?.primary_window, "plan"],
    [copy("limits.label.workbuddy_reward"), limits.workbuddyAi?.reward_window, "reward"],
  ]);

  // Wallet rows (Trae/CodeArts credits, AgentRouter balance) carry the
  // REMAINING percent — that is what the page's wallet bar shows — and only
  // ever surface when picked on the Limits page: a nearly full wallet is not
  // "urgent", so they stay out of the default pool. The math mirrors the
  // panel's wallet summaries; keep the two in step.
  const walletRemaining = (providerId, compute) => {
    const provider = limits[providerId];
    if (provider?.configured !== true || provider?.error != null) return null;
    return compute(provider);
  };
  const pushWalletRow = (providerId, label, remainingPct, windowKey, resetAt = null) => {
    if (remainingPct == null || !Number.isFinite(remainingPct)) return;
    rows.push({
      provider: petLimitProviderName(providerId),
      providerId,
      window: label,
      windowKey,
      usedPercent: Math.max(0, Math.min(100, remainingPct)),
      resetAt,
      wallet: true,
    });
  };
  const traeWalletPct = (data) => {
    const available = Number(data.trae_available_points);
    const grants = Array.isArray(data.trae_grants) ? data.trae_grants : [];
    const grantTotal = grants.reduce((sum, grant) => sum + Number(grant?.total || 0), 0);
    const total = Number.isFinite(Number(data.trae_total_points)) ? Number(data.trae_total_points) : grantTotal;
    return total > 0 && Number.isFinite(available)
      ? Math.max(0, Math.min(100, (available / total) * 100))
      : null;
  };
  for (const providerId of ["trae", "traeMain"]) {
    const data = limits[providerId];
    if (data?.configured !== true || data?.error != null) continue;
    pushWalletRow(
      providerId,
      copy("limits.label.wallet_credits"),
      walletRemaining(providerId, traeWalletPct),
      "credits",
      typeof data.trae_nearest_expire_at === "string" ? data.trae_nearest_expire_at : null,
    );
  }
  pushWalletRow("codearts", copy("limits.label.wallet_credits"), walletRemaining("codearts", (data) => {
    const available = Number(data.codearts_available_credits) || 0;
    const total = Number(data.codearts_package?.total) || 0;
    return total ? Math.max(0, Math.min(100, (available / total) * 100)) : null;
  }), "credits");
  pushWalletRow("agentRouter", copy("limits.label.wallet_balance"), walletRemaining("agentRouter", (data) => {
    const balance = Number(data.agentrouter_balance_usd);
    const used = Number(data.agentrouter_used_usd);
    if (!Number.isFinite(balance) || !Number.isFinite(used)) return null;
    const total = balance + used;
    return total ? Math.max(0, Math.min(100, (balance / total) * 100)) : null;
  }), "balance");

  const rank = (row) => {
    const i = PET_PINNED_LIMIT_ROWS.findIndex(([p, k]) => row.providerId === p && row.windowKey === k);
    return i === -1 ? PET_PINNED_LIMIT_ROWS.length : i;
  };
  rows.sort((a, b) => {
    const ka = rank(a);
    const kb = rank(b);
    if (ka !== kb) return ka - kb;
    if (b.usedPercent !== a.usedPercent) return b.usedPercent - a.usedPercent;
    const aReset = petLimitResetDate(a.resetAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bReset = petLimitResetDate(b.resetAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    return aReset - bReset;
  });
  return rows;
}

/**
 * Return all active, not-yet-full provider windows for the desktop pet. Empty
 * windows and saturated 100% windows stay on the full Limits page instead of
 * taking over the small conversation bubble. The card is capped at six rows:
 * the pinned dashboard takes them first, and urgency rows fill what is left.
 */
export function buildPetLimitSummaries(limits, selection = null) {
  const rows = collectPetLimitRows(limits);
  const picked = Array.isArray(selection) && selection.length > 0 ? selection : null;
  const pickedAt = (row) => {
    if (!picked) return -1;
    return picked.indexOf(`${row.providerId}::${row.windowKey}`);
  };
  // Pinned rows are the owner's fixed dashboard: show them even at 0% (a
  // freshly reset window is still worth watching), unlike the urgency rows.
  // A row picked on the Limits page always shows too — an explicitly chosen
  // 0% window is a watching request, not noise — and picked rows lead the
  // card in the order they were picked. Wallet rows (remaining-% based) only
  // ever surface when picked: a nearly full wallet is not "urgent".
  const kept = rows.filter((row) =>
    pickedAt(row) !== -1
    || (!row.wallet && (isPinnedPetLimitRow(row.providerId, row.windowKey)
      || (row.usedPercent > 0 && row.usedPercent < 100))));
  const rank = (row) => {
    const i = PET_PINNED_LIMIT_ROWS.findIndex(([p, k]) => row.providerId === p && row.windowKey === k);
    return i === -1 ? PET_PINNED_LIMIT_ROWS.length : i;
  };
  return kept
    .sort((a, b) => {
      const ia = pickedAt(a);
      const ib = pickedAt(b);
      if (ia !== -1 || ib !== -1) {
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        if (ia !== ib) return ia - ib;
      }
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (b.usedPercent !== a.usedPercent) return b.usedPercent - a.usedPercent;
      const aReset = petLimitResetDate(a.resetAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      const bReset = petLimitResetDate(b.resetAt)?.getTime() ?? Number.POSITIVE_INFINITY;
      return aReset - bReset;
    })
    .slice(0, MAX_PET_LIMIT_ROWS);
}

/** Keep the compact tap-quip API for callers that only need the first row. */
export function buildPetLimitSummary(limits) {
  return buildPetLimitSummaries(limits)[0] || null;
}

/**
 * Turn a raw percentage into a human status. Percentages are useful in the full
 * Limits page, but they read like noisy telemetry in a tiny desktop dialogue.
 * The pet therefore says what needs attention and leaves the exact value to the
 * Limits page.
 */
export function getPetLimitDisplay(locale, reading, displayMode = "used") {
  if (!reading) return null;
  const loc = normalizePetLocale(locale);
  // Wallet rows carry the REMAINING percent; invert here so every row on the
  // card speaks "used" and the status words keep one meaning.
  const usedPct = Number(reading.usedPercent) || 0;
  const raw = Math.min(100, Math.max(0, reading.wallet ? 100 - usedPct : usedPct));
  // A product share stays the used percent. 13 points of the pool is not 87 left.
  const remaining = displayMode === "remaining" && reading.share !== true;
  const value = Math.round(remaining ? 100 - raw : raw);
  const copy = {
    en: {
      atLimit: "at limit", nearLimit: "near limit", watch: "watch", available: "available",
      depleted: "depleted", low: "low", someLeft: "some left",
    },
    "zh-CN": {
      atLimit: "已达上限", nearLimit: "接近上限", watch: "注意", available: "充足",
      depleted: "已用尽", low: "余量偏低", someLeft: "还有余量",
    },
    "zh-TW": {
      atLimit: "已達上限", nearLimit: "接近上限", watch: "注意", available: "充足",
      depleted: "已用盡", low: "餘量偏低", someLeft: "還有餘量",
    },
    ja: {
      atLimit: "上限到達", nearLimit: "上限間近", watch: "注意", available: "余裕あり",
      depleted: "使い切り", low: "残りわずか", someLeft: "残りあり",
    },
    ko: {
      atLimit: "한도 도달", nearLimit: "한도 임박", watch: "주의", available: "여유 있음",
      depleted: "소진됨", low: "얼마 안 남음", someLeft: "남아 있음",
    },
  }[loc] || null;
  const labels = copy || {
    atLimit: "at limit", nearLimit: "near limit", watch: "watch", available: "available",
    depleted: "depleted", low: "low", someLeft: "some left",
  };

  let statusKey;
  let tone;
  if (remaining) {
    if (value <= 0) {
      statusKey = "depleted";
      tone = "danger";
    } else if (value <= 20) {
      statusKey = "low";
      tone = "warning";
    } else if (value <= 50) {
      statusKey = "someLeft";
      tone = "warning";
    } else {
      statusKey = "available";
      tone = "good";
    }
  } else if (value >= 100) {
    statusKey = "atLimit";
    tone = "danger";
  } else if (value >= 80) {
    statusKey = "nearLimit";
    tone = "warning";
  } else if (value >= 50) {
    statusKey = "watch";
    tone = "warning";
  } else {
    statusKey = "available";
    tone = "good";
  }

  return {
    usedPercent: raw,
    value,
    statusKey,
    tone,
    label: labels[statusKey],
    resetText: petLimitResetDistance(reading.resetAt),
  };
}

/** Format the selected limit as a short localized dialogue line. */
export function formatPetLimitSummary(locale, reading, displayMode = "used") {
  if (!reading) return "";
  const loc = normalizePetLocale(locale);
  const display = getPetLimitDisplay(loc, reading, displayMode);
  if (!display) return "";
  const reset = display.resetText;
  const resetSuffix = {
    en: (value) => ` · in ${value}`,
    "zh-CN": (value) => ` · ${value}后重置`,
    "zh-TW": (value) => ` · ${value}後重置`,
    ja: (value) => ` · ${value}でリセット`,
    ko: (value) => ` · ${value} 후 초기화`,
  }[loc] || ((value) => ` · in ${value}`);
  let text = `${reading.provider} ${reading.window} · ${display.label}`;
  if (reset) text += resetSuffix(reset);
  return text;
}

/**
 * Build the full tap-quip pool for the given locale — a faithful port of the macOS
 * companion's `quipPool` (ClawdCompanionView.swift): today data → 7d/30d rolling →
 * heatmap streak/active → top models → conversations → personality. The caller rotates
 * through the returned list by index on each tap (matching macOS `quipIndex`), so the
 * data-rich lines (the majority of the pool) dominate and the generic personality lines
 * stay a natural minority — no random down-weighting needed.
 *
 * `ctx` (all optional): tokens, tokensText, costText, costValue, limitText, isSyncing (today);
 * conversations; last7dTokens, last7dActiveDays; last30dTokens, last30dAvgPerDay;
 * streakDays, activeDaysAllTime; topModels [{ name, percent, source }].
 */
export function buildQuipPool(locale, ctx = {}) {
  const {
    tokens = 0, tokensText = "", costText = "", costValue = 0, limitText = "", isSyncing = false,
    conversations = 0,
    last7dTokens = 0, last7dActiveDays = 0,
    last30dTokens = 0, last30dAvgPerDay = 0,
    streakDays = 0, activeDaysAllTime = 0,
    topModels = [],
    unitSystem,
  } = ctx;
  const loc = normalizePetLocale(locale);
  if (isSyncing) return SYNCING_QUIPS[loc] || SYNCING_QUIPS.en;

  const pool = QUIPS[loc] || QUIPS.en;
  const today = TODAY_QUIPS[loc] || TODAY_QUIPS.en;
  const stats = STATS_QUIPS[loc] || STATS_QUIPS.en;
  const todayVars = { tokens: tokensText, cost: costText };
  const out = [];

  // === Today data ===
  if (tokens <= 0) {
    out.push(...pool.empty);
  } else {
    out.push(...today.tokens.map((t) => fillVars(t, todayVars)));
    if (costValue >= 0.005) out.push(...today.cost.map((t) => fillVars(t, todayVars)));
    out.push(...(pool[tierFor(tokens)] || []));
  }

  // Limits are deliberately a first-class line in the conversation. It is the
  // most constrained usable provider window, so the bubble stays readable while
  // still surfacing the quota that needs attention first.
  if (limitText) out.push(limitText);

  // === 7-day / 30-day rolling ===
  if (last7dTokens > 0) {
    out.push(fillVars(stats.sevenDayTotal, { tokens: formatCompactTokens(last7dTokens, { unitSystem }) }));
    if (last7dActiveDays > 0) {
      // macOS prepends the 🗓️ at the call site, not in the string.
      out.push("🗓️ " + fillVars(stats.activeDaysThisWeek, { n: last7dActiveDays }));
      if (last7dActiveDays >= 7) out.push(stats.perfectStreak);
    }
  }
  if (last30dTokens > 0) {
    out.push(fillVars(stats.thirtyDayTotal, { tokens: formatCompactTokens(last30dTokens, { unitSystem }) }));
    if (last30dAvgPerDay > 0) {
      out.push(fillVars(stats.averagingPerDay, { tokens: formatCompactTokens(last30dAvgPerDay, { unitSystem }) }));
    }
  }

  // === Heatmap (streak / all-time active days) ===
  if (streakDays > 1) out.push(fillVars(stats.streakDays, { n: streakDays }));
  if (activeDaysAllTime > 30) out.push(fillVars(stats.activeDaysAllTime, { n: activeDaysAllTime }));

  // === Top models ===
  if (topModels.length > 0) {
    const top = topModels[0];
    out.push(fillVars(stats.topModel, { name: top.name, percent: top.percent }));
    if (topModels.length >= 2) {
      out.push(fillVars(stats.runnerUp, { name: topModels[1].name, percent: topModels[1].percent }));
    }
    if (topModels.length >= 3) out.push(fillVars(stats.modelCount, { n: topModels.length }));
    const sources = [...new Set(topModels.map((m) => m.source).filter(Boolean))];
    if (sources.length >= 2) {
      out.push(fillVars(stats.multiToolSetup, { names: sources.map(cap).sort().join(" + ") }));
    }
  }

  // === Conversation count ===
  if (conversations > 0) {
    out.push(fillVars(stats.conversationsToday, { n: conversations, s: conversations === 1 ? "" : "s" }));
    if (conversations >= 10) out.push(fillVars(stats.busyTalker, { n: conversations }));
  }

  // === Personality (always) ===
  out.push(...pool.personality);

  return out.length ? out : pool.personality;
}
