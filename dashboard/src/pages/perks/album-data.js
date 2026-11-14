// 卡册数据层（从 PerksPage.jsx 拆出的纯逻辑，2026-11-14）：
// 领取账本的 localStorage 读写/迁移链、AIHOT 快照信号、卡册排序权重与
// 稀有度/亮度档。只放可独立测试的纯函数与常量；卡片 UI 留在 PerksPage.jsx。
import {
  PERKS_CLAIMS_KEY, PERKS_LEGACY_CLAIMS_KEY, PERKS_V1_CLAIMS_KEY,
  normalizePerkClaims, migrateLegacyPerkClaims,
} from "../../lib/perks-claims.mjs";
import { PERK_PROVIDERS } from "../../data/perksData.js";
import { PERKS_AIHOT_PROVIDERS } from "../../data/perks-aihot-map.js";

export function readPerksClaims() {
  try {
    const raw = window?.localStorage?.getItem(PERKS_CLAIMS_KEY);
    if (raw != null) {
      const parsed = normalizePerkClaims(JSON.parse(raw), PERK_PROVIDERS);
      // 损坏的 v3 载荷解析为空时仍尝试迁移链，别把旧记录静默清掉。
      if (Object.keys(parsed).length) return parsed;
    }
    // Migration chain: v2 ({cycle: date}) first, then the older v1 ({id: date}).
    for (const legacyKey of [PERKS_LEGACY_CLAIMS_KEY, PERKS_V1_CLAIMS_KEY]) {
      const legacy = window?.localStorage?.getItem(legacyKey);
      if (legacy != null) {
        const migrated = migrateLegacyPerkClaims(JSON.parse(legacy), PERK_PROVIDERS);
        if (Object.keys(migrated).length) return migrated;
      }
    }
    return raw != null ? {} : null;
  } catch {
    return null;
  }
}

export function writePerksClaims(claims) {
  try {
    window?.localStorage?.setItem(PERKS_CLAIMS_KEY, JSON.stringify({ schema: 3, providers: claims }));
    return true;
  } catch {
    // 私密模式等存储不可用时静默降级：标记仅本次会话生效
    return false;
  }
}

// 「反馈口径变动」一键 Issue：把卡片现口径预填进 GitHub new-issue，让社区用户
// 发现福利变了能一键上报（站主逐张端内实测的维护负担太重，需要社区帮盯）。
// 用裸 new-issue + title/body 预填（不用 YAML 表单模板——表单不吃 URL 预填）。
export function buildPerksFeedbackUrl(item) {
  const title = `[福利口径反馈] ${item.name}（${item.id}）`;
  const body = [
    "## 卡片口径反馈",
    "",
    `- 卡片：${item.name}（id: ${item.id}）`,
    `- 当前徽标：${item.badge || "（无）"}`,
    `- 卡片核对日期：${item.checkedAt || "未标注"}`,
    `- 卡片来源页：${item.sourceUrl || "未标注"}`,
    "",
    "### 你核实到的现行口径",
    "",
    "（请填写你在官方页面或端内看到的现状）",
    "",
    "### 证据",
    "",
    "（请附官方页面链接或端内截图，感谢！）",
  ].join("\n");
  return `https://github.com/01UNCLEDOG01/TokenTracker-Plus/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export function beijingDate(iso) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}

// AIHOT 快照 → 卡片角标信号：日期取该卡映射的所有 AIHOT provider 里最新一次
// 核对；「已无在架」要求映射的全部 provider 都从最新快照消失且出现在
// dropped_providers（快照里上一轮还在、这一轮没了）——缺席本身不算下架，
// AIHOT 没覆盖的家不打任何标。
export function buildAihotSignal(item, aihotIndex) {
  const providers = PERKS_AIHOT_PROVIDERS[item.id];
  if (!providers || !aihotIndex) return null;
  let latest = "";
  let endsAt = "";
  for (const provider of providers) {
    const deal = aihotIndex.byProvider.get(provider);
    if (deal && (deal.verified_at || "") > latest) latest = deal.verified_at || "";
    // 截止日取映射 deals 里**最早**的非空 ends_at（最先失效的那个福利决定卡面警示）
    if (deal?.ends_at) {
      const t = Date.parse(deal.ends_at);
      if (Number.isFinite(t) && (!endsAt || t < Date.parse(endsAt))) endsAt = deal.ends_at;
    }
  }
  // 下架提示独立于在架日期：全部 provider 上轮在架、本轮消失也要出信号。
  const dropped = providers.every((provider) => !aihotIndex.byProvider.has(provider)) && providers.every((provider) => aihotIndex.dropped.has(provider));
  if (!latest && !dropped) return null;
  return { date: latest ? beijingDate(latest) : "", dropped, endsAt };
}

export const ALBUM_PAGE_SIZE = 18;

// 价值档位排序权重（站主 2026-11-12：卡册按档位色从琥珀排到灰，不管领取状态）。
export const TIER_RANK = { amber: 5, rose: 4, purple: 3, blue: 2, success: 1, neutral: 0 };

// AIHOT provider slug → 我们卡册的卡 id（反查表）：统计「今天还能领」时
// 判断快照 deal 是否已被我们领掉用。多卡映射同一 provider 时取首个。
export const AIHOT_PROVIDER_TO_CARD = (() => {
  const map = new Map();
  for (const [cardId, providers] of Object.entries(PERKS_AIHOT_PROVIDERS)) {
    for (const provider of providers) if (!map.has(provider)) map.set(provider, cardId);
  }
  return map;
})();

export function albumBrightnessTier(streak) {
  if (!Number.isFinite(streak) || streak <= 0) return 0;
  if (streak >= 30) return 4;
  if (streak >= 15) return 3;
  if (streak >= 7) return 2;
  return 1;
}

// 活动截止倒计时：endsAt 两种格式都收——自家数据是北京时间自然日（YYYY-MM-DD，
// 当日 23:59 失效）；AIHOT 快照是完整 ISO 时间戳（含 T/Z，直接 parse）。
// 只给写明截止日的卡显示，没写的不编。
export function perkDaysLeft(endsAt, nowMs = Date.now()) {
  if (!endsAt) return null;
  const end = Date.parse(endsAt.includes("T") ? endsAt : `${endsAt}T23:59:59+08:00`);
  if (!Number.isFinite(end)) return null;
  const ms = end - nowMs;
  return { ended: ms <= 0, days: Math.max(0, Math.ceil(ms / 86400000)) };
}

// 卡册稀有度（站主 2026-11-12 拍板五档）：蓝→铜→银→金→闪。
// 每天能领的累计 7/15/30/60/90 天；每月能领的 1/2/3/4/5 次；
// 只能领一次的看这一次价值 ¥1/10/20/50/100。基础卡背青色。
export function cardRarity(cycleCounts, dealYuan) {
  const RANKS = ["blue", "bronze", "silver", "gold", "holo"];
  let best = 0;
  const bump = (level) => { best = Math.max(best, level); };
  const step = (count, thresholds) => {
    let level = 0;
    for (const t of thresholds) if (count >= t) level += 1;
    bump(level);
  };
  for (const [cycle, count] of Object.entries(cycleCounts || {})) {
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    if (cycle === "daily") step(count, [7, 15, 30, 60, 90]);
    else if (cycle === "monthly") step(count, [1, 2, 3, 4, 5]);
    else if (cycle === "once" && dealYuan != null && Number.isFinite(dealYuan)) {
      step(dealYuan, [1, 10, 20, 50, 100]);
    }
  }
  return best > 0 ? RANKS[best - 1] : null;
}
