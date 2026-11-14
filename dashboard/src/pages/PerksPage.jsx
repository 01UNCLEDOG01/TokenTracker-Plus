import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Gift,
  Search,
  Info,
  ShieldCheck,
  SlidersHorizontal,
  ChevronLeft,
  X,
} from "lucide-react";
import { copy, getCopyLocale } from "../lib/copy";
import { getPublicVisibility, setPublicVisibility } from "../lib/api";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext.jsx";
import { cn } from "../lib/cn";
import { PERK_CATEGORIES, PERK_PROVIDERS } from "../data/perksData.js";
import { PERKS_AIHOT_PROVIDERS } from "../data/perks-aihot-map.js";
import { PERKS_CLAIM_YUAN } from "../data/perks-claim-yuan.js";
import { localizePerk } from "../data/perks-i18n-en.js";
import { comparePerks } from "../data/perks-sort.mjs";
import {
  ALBUM_PAGE_SIZE, TIER_RANK, AIHOT_PROVIDER_TO_CARD, albumBrightnessTier,
  perkDaysLeft, cardRarity, buildAihotSignal,
  readPerksClaims, writePerksClaims, buildPerksFeedbackUrl,
} from "./perks/album-data.js";
import { PerkCard } from "./perks/PerkCard.jsx";
import { AlbumStrip, AlbumVitrine, PerkTierLegend } from "./perks/AlbumCards.jsx";
import { PERK_TIER_ACCENT } from "./perks/tier-styles.js";
import {
  PERKS_CLAIMS_KEY, PERKS_LEGACY_CLAIMS_KEY, PERKS_V1_CLAIMS_KEY,
  getPerkClaimDay, nextPerkClaimDayDelay,
  getPerkClaimCycles, getPerkClaimDate, getPerkClaimStreak, isPerkClaimed, normalizePerkClaims,
  togglePerkClaim, setPerkClaimDate,
} from "../lib/perks-claims.mjs";

// 价值等级筛选：label 用函数包一层字面量 copy()，这样切语言时实时生效、
// 又不会因为拼串 key 让 copy 注册表误判成「未使用」。
const PERK_TIER_FILTER_OPTIONS = [
  { id: "neutral", accent: PERK_TIER_ACCENT.neutral, label: () => copy("perks.legend.neutral") },
  { id: "success", accent: PERK_TIER_ACCENT.success, label: () => copy("perks.legend.success") },
  { id: "blue", accent: PERK_TIER_ACCENT.blue, label: () => copy("perks.legend.blue") },
  { id: "purple", accent: PERK_TIER_ACCENT.purple, label: () => copy("perks.legend.purple") },
  { id: "rose", accent: PERK_TIER_ACCENT.rose, label: () => copy("perks.legend.rose") },
  { id: "amber", accent: PERK_TIER_ACCENT.amber, label: () => copy("perks.legend.amber") },
];
export function PerksPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const locale = getCopyLocale();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [claims, setClaims] = useState(() => readPerksClaims() ?? {});
  const [claimDay, setClaimDay] = useState(getPerkClaimDay);
  const unsavedClaims = useRef(null);
  // 领取记录绑定账号（站主 2026-11-12）：登录态下与服务端同步。
  const auth = useInsforgeAuth();
  const claimsSyncAdopted = useRef(false);
  const claimsSyncBusy = useRef(false);

  const pushClaimsToServer = (next) => {
    if (!auth?.signedIn || !auth?.getAccessToken || claimsSyncBusy.current) return;
    claimsSyncBusy.current = true;
    (async () => {
      try {
        const token = await auth.getAccessToken();
        if (!token) return;
        await setPublicVisibility({ accessToken: token, perks_claims: { schema: 3, providers: next } });
      } catch { /* 静默：本地已保存 */ } finally {
        claimsSyncBusy.current = false;
      }
    })();
  };

  useEffect(() => {
    if (!auth?.signedIn || !auth?.getAccessToken || claimsSyncAdopted.current) return;
    let alive = true;
    (async () => {
      try {
        const token = await auth.getAccessToken();
        if (!token || !alive) return;
        const data = await getPublicVisibility({ accessToken: token });
        const serverClaims = data?.perks_claims;
        if (!alive || !serverClaims || typeof serverClaims !== "object") return;
        const normalized = normalizePerkClaims(serverClaims, PERK_PROVIDERS);
        if (!Object.keys(normalized).length) return;
        claimsSyncAdopted.current = true;
        setClaims(normalized);
        writePerksClaims(normalized);
      } catch { /* 服务端不可达时保持本地 */ }
    })();
    return () => { alive = false; };
  }, [auth?.signedIn]);
  const [claimFilter, setClaimFilter] = useState("all");
  // 价值等级（六色）筛选：与页首图例、卡片徽标同一套口径。
  const [tierFilter, setTierFilter] = useState("all");
  // 卡册（AIHOT 式，常驻页首）：albumPage 记卡牌带翻页位置。
  const [albumPage, setAlbumPage] = useState(0);
  // 卡册小卡 → 下方详情卡的点击联动：目标卡平滑滚动 + 边框闪烁高亮。
  // AIHOT 快照只做后台对时：页面先用静态数据整页渲染，快照回来后才补角标，
  // 任何失败都静默保持原样（信源挂了不影响福利指南本身）。
  const [aihotData, setAihotData] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/functions/tokentracker-aihot-free-tokens", { cache: "no-store" })
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data && Array.isArray(data.items)) setAihotData(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const aihotIndex = useMemo(() => {
    const byProvider = new Map();
    for (const deal of aihotData?.items || []) {
      const prev = byProvider.get(deal.provider);
      if (!prev || (deal.verified_at || "") > (prev.verified_at || "")) byProvider.set(deal.provider, deal);
    }
    return { byProvider, dropped: new Set(aihotData?.dropped_providers || []) };
  }, [aihotData]);

  // 「今天还能领」按 AIHOT 全目录口径（站主 2026-11-12：我们的 ¥6 vs AIHOT ¥583 =
  // 只统计了映射卡）；「本月已领到 / 累计领取」按**自家审计价**（站主 2026-11-13：
  // AIHOT 定价不再是标准——他们的快照 2026-11-13 起 56 条 deal 只有 17 条带 ¥，
  // 恰好我们映射的卡全被摘价，两列因此归零）。AIHOT 有单 deal 精确价的仍优先用。
  const aihotSums = useMemo(() => {
    const DEAL_KIND_CYCLE = { daily: "daily", monthly: "monthly", once: "once", limited: "once" };
    let claimable = 0;
    for (const [provider, deal] of aihotIndex.byProvider) {
      if (aihotIndex.dropped.has(provider)) continue;
      const cardId = AIHOT_PROVIDER_TO_CARD.get(provider);
      const item = cardId ? PERK_PROVIDERS.find((row) => row.id === cardId) : null;
      if (item && isPerkClaimed(item, claims, claimDay, "all")) continue;
      const cycle = DEAL_KIND_CYCLE[deal.kind] || "once";
      const aiYuan = Number.isFinite(deal.yuan) ? deal.yuan : null;
      const ours = item ? PERKS_CLAIM_YUAN[item.id]?.[cycle] : null;
      const price = aiYuan ?? (Number.isFinite(ours) ? ours : 0);
      claimable += price;
    }
    let monthly = 0;
    let totalClaimed = 0;
    for (const item of PERK_PROVIDERS) {
      const row = claims?.[item.id];
      if (!row) continue;
      for (const cycle of getPerkClaimCycles(item)) {
        const count = row[cycle]?.count || 0;
        const price = PERKS_CLAIM_YUAN[item.id]?.[cycle];
        if (!Number.isFinite(price)) continue;
        totalClaimed += price * count;
        if (cycle === "monthly" && getPerkClaimDate(item, claims, "monthly", claimDay)) monthly += price;
      }
    }
    return { claimable, monthly, totalClaimed };
  }, [aihotIndex, claims, claimDay]);

  useEffect(() => {
    document.title = `${copy("perks.title")} | TokenTracker`;
  }, []);

  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      const now = Date.now();
      setClaimDay(getPerkClaimDay(now));
      const stored = unsavedClaims.current ?? readPerksClaims();
      if (stored != null) setClaims(stored);
      timer = setTimeout(refresh, nextPerkClaimDayDelay(now));
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const storage = (event) => {
      if (event.key == null || event.key === PERKS_CLAIMS_KEY || event.key === PERKS_LEGACY_CLAIMS_KEY || event.key === PERKS_V1_CLAIMS_KEY) refresh();
    };
    try {
      const hasLegacy = window.localStorage.getItem(PERKS_LEGACY_CLAIMS_KEY) != null
        || window.localStorage.getItem(PERKS_V1_CLAIMS_KEY) != null;
      if (window.localStorage.getItem(PERKS_CLAIMS_KEY) == null && hasLegacy) {
        const migrated = readPerksClaims();
        if (migrated != null) writePerksClaims(migrated);
      }
    } catch { /* unavailable storage keeps the in-memory selection */ }
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  // 弹窗详情（站主 2026-11-13 拍板②：卡册小卡点击弹窗，替代「跳下去再跳回来」
  // 的来回滚动——弹窗里可直接点注册链接/标记已领取，标记后自动关闭并原地翻牌）。
  const [previewItem, setPreviewItem] = useState(null);
  // ⑤ 「未领取」筛选下领取的卡会立刻被筛走，翻面没有落点——刚领的那张在卡册里
  // 多留 1.6s（足够翻完 0.58s 动画）再移除。
  const [keepClaimedKey, setKeepClaimedKey] = useState(null);
  // 连击翻面计数（per 卡）：翻面重播由 scheduleFlip 显式调度（站主 2026-11-13：
  // 详情卡/弹窗领取也要看到翻牌特效）。放主组件层——翻页容器按页 key 重建时
  // 组件内定时器会被清掉（教训）。
  const pendingScrollId = useRef(null);
  const [flipKeys, setFlipKeys] = useState({});
  // 绝版卡弹窗：玻璃柜里的卡点击后展示已下线福利的详情（站主 2026-11-12）。
  const [sealedDetail, setSealedDetail] = useState(null);

  const scheduleFlip = (key, delay) => {
    window.setTimeout(() => {
      setFlipKeys((current) => ({ ...current, [key]: (current[key] || 0) + 1 }));
    }, delay);
  };

  const toggleClaim = (item, cycle, opts = {}) => {
    const day = getPerkClaimDay();
    const wasClaimed = isPerkClaimed(item, claims, claimDay, selectedCategory);
    const next = togglePerkClaim(unsavedClaims.current ?? readPerksClaims() ?? claims, item, cycle, day);
    setClaimDay(day);
    setClaims(next);
    unsavedClaims.current = writePerksClaims(next) ? null : next;
    pushClaimsToServer(next);
    if (!wasClaimed) {
      const key = `${item.id}:${cycle}`;
      setKeepClaimedKey(key);
      window.setTimeout(() => setKeepClaimedKey(null), 1600);
      if (opts.fromModal) {
        // 弹窗路径：关窗即回到卡册视野，350ms 后原地翻牌。
        scheduleFlip(key, 350);
        setPreviewItem(null);
      } else {
        // 行内详情卡路径（站主 2026-11-13 ③）：领完平滑滚回卡册对应小卡，
        // 到位后再翻牌——否则详情卡在列表中部，翻牌发生在屏幕外看不见。
        pendingScrollId.current = item.id;
        scheduleFlip(key, 900);
      }
    }
  };

  // 补记实际领取日（站主 2026-11-13）：月领/一次性卡的日期可回改到真实领取日
  // （月领限本月内），计数与连击不变——只修日期，不修次数。
  const adjustClaimDate = (item, cycle, date) => {
    const day = getPerkClaimDay();
    const next = setPerkClaimDate(unsavedClaims.current ?? readPerksClaims() ?? claims, item, cycle, date, day);
    if (next === (unsavedClaims.current ?? claims)) return;
    setClaimDay(day);
    setClaims(next);
    unsavedClaims.current = writePerksClaims(next) ? null : next;
    pushClaimsToServer(next);
  };

  const categoryCounts = useMemo(() => {
    const counts = { all: PERK_PROVIDERS.length };
    for (const cat of PERK_CATEGORIES) {
      if (cat.id === "all") continue;
      counts[cat.id] = PERK_PROVIDERS.filter((item) => item.category?.includes(cat.id)).length;
    }
    return counts;
  }, []);

  const tierCounts = useMemo(() => {
    const counts = { all: PERK_PROVIDERS.length };
    for (const item of PERK_PROVIDERS) {
      counts[item.badgeType] = (counts[item.badgeType] || 0) + 1;
    }
    return counts;
  }, []);

  const matchedItems = useMemo(() => {
    return PERK_PROVIDERS.filter((item) => {
      // Category Filter
      if (selectedCategory !== "all") {
        if (!item.category.includes(selectedCategory)) {
          return false;
        }
      }
      // Value-tier Filter（灰/绿/蓝/紫/粉/琥珀）
      if (tierFilter !== "all" && item.badgeType !== tierFilter) {
        return false;
      }
      // Search Query — 两层（站主 2026-11-14 两次定谳）：
      //   短 ASCII 查询（<3 字符，纯字母数字）只搜**名称**（中英）——"to"/"ag"
      //   是前缀搜索意图，badge/tags 里的 "token"/"Agent" 之类词内子串不算命中
      //   （"ag" 撞 AutoClaw 的「一键安装Agent」即翻车案例）；
      //   其余查询（≥3 字符或含 CJK）搜名称+徽章+标签+描述全文——中文 2 字词
      //   （"签到"/"免费"）不会撞英文词内部，保持全文召回。
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const shown = localizePerk(item, locale);
        const shortAscii = query.length < 3 && /^[a-z0-9_-]+$/.test(query);
        const zhName = item.name.toLowerCase();
        const zhRest = `${item.badge} ${item.tags.join(" ")} ${item.description}`.toLowerCase();
        const isEn = shown !== item;
        const enName = isEn ? shown.name.toLowerCase() : "";
        const enRest = isEn ? `${shown.badge} ${shown.tags.join(" ")} ${shown.description}`.toLowerCase() : "";
        if (zhName.includes(query) || enName.includes(query)) return true;
        if (shortAscii) return false;
        return zhRest.includes(query) || enRest.includes(query);
      }
      return true;
    });
  }, [locale, searchQuery, selectedCategory, tierFilter]);

  const claimedCount = matchedItems.filter((item) => isPerkClaimed(item, claims, claimDay, selectedCategory)).length;
  const filteredItems = matchedItems.filter((item) => {
    const claimed = isPerkClaimed(item, claims, claimDay, selectedCategory);
    return claimFilter === "all" || (claimFilter === "claimed" ? claimed : !claimed);
  });

  // 卡册排序：已收亮卡 > 累计亮度档 > A-Z 稳定序（AIHOT「越亮的越靠前」，
  // 截图里第一行亮卡第二行暗卡）。面值/折算值取映射 provider 的最新 AIHOT deal。
  const albumItems = useMemo(() => {
    // 每周期独立成卡（站主 2026-11-12）：同一软件有几种可领周期就出几张卡，
    // 每张卡的稀有度/次数只看自己那个周期。详情卡保持一张（领取按钮分行）。
    const expanded = [];
    for (const item of filteredItems) {
      for (const cycle of getPerkClaimCycles(item)) {
        expanded.push({ item, cycle });
      }
    }
    // ⑤ 刚领取的卡在「未领取」筛选下会立刻被筛走、翻面没有落点——暂时留 1.6s。
    if (keepClaimedKey) {
      const sep = keepClaimedKey.lastIndexOf(":");
      const keepId = keepClaimedKey.slice(0, sep);
      const keepCycle = keepClaimedKey.slice(sep + 1);
      const kept = expanded.some((entry) => entry.item.id === keepId && entry.cycle === keepCycle);
      const keepItem = kept ? null : PERK_PROVIDERS.find((row) => row.id === keepId);
      if (keepItem) expanded.push({ item: keepItem, cycle: keepCycle });
    }
    const ranked = expanded.map(({ item, cycle }) => {
      const streak = getPerkClaimStreak(item, claims, cycle);
      const claimedNow = Boolean(getPerkClaimDate(item, claims, cycle, claimDay));
      const cycleCounts = {};
      cycleCounts[cycle] = claims?.[item.id]?.[cycle]?.count || 0;
      const deal = (() => {
        const providers = PERKS_AIHOT_PROVIDERS[item.id];
        if (!providers) return null;
        let best = null;
        for (const provider of providers) {
          const candidate = aihotIndex.byProvider.get(provider);
          if (candidate && (!best || (candidate.verified_at || "") > (best.verified_at || ""))) best = candidate;
        }
        return best;
      })();
      const monthlyClaimed = cycle === "monthly" && Boolean(getPerkClaimDate(item, claims, "monthly", claimDay));
      // AIHOT 截止联动（站主 2026-11-14：AIHOT 列表有红字「还剩 N 天」，我们有
      // ends_at 却只印 MM-DD 日期）：自家人工 endsAt 优先，映射 deal 的最早非空
      // ends_at 兜底——perkDaysLeft 双格式兼容。绝版判定暂不联动 AIHOT ends_at
      // （口径是 AIHOT 的非站主核对，挂账观察）。
      const endsRaw = item.endsAt || (() => {
        const providers = PERKS_AIHOT_PROVIDERS[item.id];
        if (!providers) return "";
        let best = "";
        for (const provider of providers) {
          const candidate = aihotIndex.byProvider.get(provider)?.ends_at;
          if (candidate && (!best || Date.parse(candidate) < Date.parse(best))) best = candidate;
        }
        return best;
      })();
      const endsDeadline = perkDaysLeft(endsRaw);
      // 绝版 = 活动结束（站主 2026-11-12 口径）：AIHOT 把该 provider 标记为
      // dropped（下线活动，如 workbuddy 国际版 DeepSeek 免费调用）、或数据里
      // 写了 endsAt 且已过期、或显式 retired 标记——与是否领取过无关。
      const sealed = item.retired === true
        || Boolean(perkDaysLeft(item.endsAt)?.ended)
        || (() => {
          const providers = PERKS_AIHOT_PROVIDERS[item.id];
          return Boolean(providers && providers.some((provider) => aihotIndex.dropped.has(provider)));
        })();
      return {
        item,
        cycle,
        streak,
        claimedNow,
        tier: albumBrightnessTier(streak),
        rarity: cardRarity(
          cycleCounts,
          deal && Number.isFinite(deal.yuan) ? deal.yuan : (PERKS_CLAIM_YUAN[item.id]?.once ?? null),
        ),
        collected: streak > 0,
        sealed,
        endsLabel: endsDeadline ? (endsDeadline.ended ? "已结束" : `还剩 ${endsDeadline.days} 天`) : "",
        endsHot: Boolean(endsDeadline && !endsDeadline.ended && endsDeadline.days <= 3),
        faceValue: deal?.label || null,
        // 「今天还能领」= 该卡映射 deal 的折算值（今日尚未领取时计入合计），
        // 与 AIHOT 顶部口径一致：所有 counted 估值都算今天可领。
        dealYuanPending: deal && Number.isFinite(deal.yuan) && !claimedNow ? deal.yuan : 0,
        dealYuanMonthlyClaimed: deal && Number.isFinite(deal.yuan) && monthlyClaimed ? deal.yuan : 0,
      };
    });
    const CYCLE_RANK = { daily: 0, monthly: 1, once: 2 };
    ranked.sort((a, b) =>
      (TIER_RANK[b.item.badgeType] ?? 0) - (TIER_RANK[a.item.badgeType] ?? 0)
      || comparePerks(a.item, b.item)
      || (CYCLE_RANK[a.cycle] ?? 9) - (CYCLE_RANK[b.cycle] ?? 9),
    );
    return ranked;
  }, [filteredItems, claims, claimDay, selectedCategory, aihotIndex, keepClaimedKey]);

  // 绝版展示柜（站主 2026-11-12：绝版卡「封装到玻璃柜」，和还能领的卡不混在
  // 一起）：只陈列领到过的绝版卡，没领过的绝版按 AIHOT 规则不放出来。
  // 主卡册 = 全量卡（绝版卡的日常形态也在卡册里——站主 2026-11-12 定谳：
  // 玻璃柜是同一张卡的「绝版形态」副本，日常卡仍可照常领取）。
  const stripItems = albumItems;
  // 玻璃柜独立于页面筛选（站主 2026-11-12：切换领取/分类筛选不应让绝版卡消失）。
  const vitrineItems = useMemo(() => {
    const items = [];
    for (const item of PERK_PROVIDERS) {
      const providers = PERKS_AIHOT_PROVIDERS[item.id];
      const sealed = item.retired === true
        || Boolean(perkDaysLeft(item.endsAt)?.ended)
        || Boolean(providers && providers.some(function (provider) { return aihotIndex.dropped.has(provider); }));
      if (!sealed) continue;
      const streak = Math.max(...getPerkClaimCycles(item).map(function (cycle) { return getPerkClaimStreak(item, claims, cycle); }), 0);
      if (streak <= 0) continue;
      items.push({
        item,
        collected: true,
        tier: albumBrightnessTier(streak),
        rarity: null,
        streak,
        claimedNow: isPerkClaimed(item, claims, claimDay, "all"),
        sealed: true,
        faceValue: null,
      });
    }
    return items;
  }, [claims, claimDay, aihotIndex]);

  // 行内领取后把视口带回卡册那张小卡（翻牌目标在页首）。
  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    pendingScrollId.current = null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.querySelector(`.perk-mini[data-perk-id="${id}"]`)
          ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }),
    );
  }, [albumItems]);

  // 弹窗 Esc 关闭 + 打开时锁背景滚动（站主 2026-11-13 ② 弹窗详情）。
  useEffect(() => {
    if (!previewItem) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setPreviewItem(null);
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [previewItem]);

  // 卡册翻页随筛选结果收缩回合法范围，避免「清除筛选后跳回旧页码」。
  useEffect(() => {
    setAlbumPage((current) => {
      const maxPage = Math.max(0, Math.ceil(stripItems.length / ALBUM_PAGE_SIZE) - 1);
      return current > maxPage ? maxPage : current;
    });
  }, [stripItems.length]);

  return (
    <div className="tt-perks-page flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-16 pt-8 sm:pb-20 sm:pt-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {/* Header Banner */}
          <div className="mb-8 flex flex-col justify-between gap-4 border-b border-oai-gray-200/80 pb-6 sm:flex-row sm:items-end dark:border-oai-gray-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                  <Gift className="h-4 w-4" aria-hidden />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {copy("perks.title")}
                </h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm text-oai-gray-500 dark:text-oai-gray-300">
                {copy("perks.subtitle")}
              </p>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-oai-gray-400 dark:text-oai-gray-500">
                {copy("perks.credit_aihot")}
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-300">
              <span className="inline-flex items-center gap-1 rounded-md bg-oai-gray-100 px-2 py-1 font-medium text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>{copy("perks.count", { count: PERK_PROVIDERS.length })}</span>
              </span>
            </div>
          </div>

          {/* AIHOT 式卡册：统计头 + 扑克卡牌带，常驻页首（站主 2026-11-11 拍板照做） */}
          <AlbumStrip
            items={albumItems}
            stripItems={stripItems}
            claimDay={claimDay}
            page={albumPage}
            onPageChange={setAlbumPage}
            onPreview={setPreviewItem}
            flipKeys={flipKeys}
            aihotSums={aihotSums}
            vitrineCount={vitrineItems.length}
          />

          {/* 绝版展示柜：独立于主卡册（站主 2026-11-12 玻璃柜方案） */}
          <AlbumVitrine entries={vitrineItems} flipKeys={flipKeys} onSealedClick={setSealedDetail} />

          {sealedDetail ? (
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
              role="dialog"
              aria-modal="true"
              aria-label={copy("perks.album.vitrine_detail")}
              onClick={() => setSealedDetail(null)}
            >
              <div
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-oai-gray-200 dark:bg-oai-gray-950 dark:ring-oai-gray-800"
                onClick={function (event) { event.stopPropagation(); }}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-oai-black dark:text-white">
                    {sealedDetail.name}
                    <span className="perk-seal ml-2 inline-block rounded px-1 py-0.5 align-middle text-[9px] font-extrabold tracking-wider">
                      {copy("perks.album.sealed")}
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={function () { setSealedDetail(null); }}
                    aria-label={copy("perks.album.vitrine_close")}
                    className="rounded-md px-2 py-1 text-sm text-oai-gray-500 transition hover:bg-oai-gray-100 hover:text-oai-black dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                {sealedDetail.retiredDeal ? (
                  <div className="mt-3 space-y-2 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">
                    <p className="font-semibold text-oai-black dark:text-white">{sealedDetail.retiredDeal.label}</p>
                    <p>{sealedDetail.retiredDeal.detail}</p>
                    {sealedDetail.endsAt ? (
                      <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("perks.album.retired_until", { date: sealedDetail.endsAt })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* 弹窗详情（站主 2026-11-13 ②）：卡册小卡点击弹出这张卡——可直接点
              注册链接或标记已领取；标记后自动关闭并在卡册原地翻牌，不再上下跳转。
              站主 2026-11-14：弹窗改垂直居中（my-auto 模式——内容矮于视口时居中，
              高于视口时自动贴顶保持可滚动，不再固定 pt-10 顶置）。 */}
          {previewItem ? (
            <div
              className="fixed inset-0 z-[90] flex justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-[2px]"
              role="dialog"
              aria-modal="true"
              aria-label={previewItem.name}
              onClick={() => setPreviewItem(null)}
            >
              <div
                className="relative my-auto w-full max-w-lg"
                onClick={function (event) { event.stopPropagation(); }}
              >
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  aria-label={copy("perks.album.vitrine_close")}
                  className="absolute -right-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white text-oai-gray-500 shadow-md ring-1 ring-oai-gray-200 transition hover:text-oai-black dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:ring-oai-gray-700 dark:hover:text-white"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
                <PerkCard
                  item={localizePerk(previewItem, locale)}
                  claims={claims}
                  claimDay={claimDay}
                  onToggleClaim={(item, cycle) => toggleClaim(item, cycle, { fromModal: true })}
                  onAdjustClaimDate={adjustClaimDate}
                  aihot={buildAihotSignal(previewItem, aihotIndex)}
                />
              </div>
            </div>
          ) : null}

          {/* 六色图例：把色阶含义摆在页面上（站主 2026-11-11 要求） */}
          <PerkTierLegend />

          {/* Top Disclaimer / Notice Banner */}
          <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-900/90 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="flex-1">
              {copy("perks.disclaimer")}
            </p>
          </div>

          {/* Invite / Official-link transparency notice — kept at the top so
              it is actually read (owner call 2026-11-01: a footer notice
              scrolls out of sight). */}
          <div className="mb-6 rounded-2xl border border-oai-gray-200/70 bg-oai-gray-50/60 p-5 text-xs text-oai-gray-500 dark:border-oai-gray-800/60 dark:bg-oai-gray-950/40 dark:text-oai-gray-300">
            <h4 className="font-semibold text-oai-black dark:text-white">
              {copy("perks.notice.title")}
            </h4>
            <p className="mt-1 leading-relaxed">
              {copy("perks.notice.desc")}
            </p>
          </div>

          {/* Filters & Search Toolbar */}
          <div className="mb-6 space-y-2.5">
            {/* Value-tier Row：六色筛选（站主 2026-11-12：放第一行），颜色口径与页首图例一致 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-oai-gray-500 dark:text-oai-gray-400">
                {copy("perks.legend.title")}
              </span>
              <button
                type="button"
                aria-pressed={tierFilter === "all"}
                onClick={() => setTierFilter("all")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                  tierFilter === "all"
                    ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                    : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                )}
              >
                <span>{copy("perks.tier.all")}</span>
                <span className="text-[10px] tabular-nums opacity-80">{tierCounts.all ?? 0}</span>
              </button>
              {PERK_TIER_FILTER_OPTIONS.map((opt) => {
                const active = tierFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTierFilter(active ? "all" : opt.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                      active
                        ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                        : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", opt.accent)} aria-hidden />
                    <span>{opt.label()}</span>
                    <span className="text-[10px] tabular-nums opacity-80">{tierCounts[opt.id] ?? 0}</span>
                  </button>
                );
              })}
            </div>

            {/* Top Row: Core Platform Categories */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PERK_CATEGORIES.slice(0, 4).map((cat) => {
                const active = selectedCategory === cat.id;
                const label = copy(`perks.cat.${cat.id}`) || cat.label;
                const count = categoryCounts[cat.id] ?? 0;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                        : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    )}
                  >
                    <span>{label}</span>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        active ? "opacity-75" : "text-oai-gray-600 dark:text-oai-gray-300"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>


            {/* Bottom Row: Benefit Form Categories (left) + Claim-state filter & Search Input aligned together (right) */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                {PERK_CATEGORIES.slice(4).map((cat) => {
                  const active = selectedCategory === cat.id;
                  const label = copy(`perks.cat.${cat.id}`) || cat.label;
                  const count = categoryCounts[cat.id] ?? 0;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                        active
                          ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                          : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                      )}
                    >
                      <span>{label}</span>
                      <span
                        className={cn(
                          "text-[10px] tabular-nums",
                          active ? "opacity-75" : "text-oai-gray-600 dark:text-oai-gray-300"
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Claim-state filter + Search Input in the same row */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "all", label: copy("perks.filter.all") },
                    { id: "claimed", label: copy("perks.filter.claimed") },
                    { id: "unclaimed", label: copy("perks.filter.unclaimed") },
                  ].map((opt) => {
                    const active = claimFilter === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setClaimFilter(opt.id)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          active
                            ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                            : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                        }`}
                      >
                        <span>{opt.label}</span>
                        <span className="text-[10px] tabular-nums opacity-90">
                          {opt.id === "all"
                            ? matchedItems.length
                            : opt.id === "claimed"
                              ? claimedCount
                              : matchedItems.length - claimedCount}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Search Input + 视图切换 */}
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                  <div className="relative w-full sm:w-60">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oai-gray-400"
                      aria-hidden
                    />
                    <input
                      type="text"
                      aria-label={copy("perks.search_placeholder")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={copy("perks.search_placeholder")}
                      className="h-9 w-full rounded-xl border border-oai-gray-200 bg-white pl-8 pr-3 text-xs text-oai-black placeholder-oai-gray-400 transition focus:border-emerald-500 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 dark:border-oai-gray-500 dark:bg-oai-gray-900 dark:text-white dark:placeholder-oai-gray-300"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Provider Cards Grid。三块 && 条件渲染而非三元链：ui-hardcode 扫描器会把
              顶层比较符与自闭合标签间的代码误报成 JSX 文本（仓库已知坑），条件用 === / !== */}
          {filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-oai-gray-200 py-16 text-center dark:border-oai-gray-800">
              <SlidersHorizontal className="h-8 w-8 text-oai-gray-400" />
              <p className="mt-2 text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("perks.empty.title")}
              </p>
              <p className="text-xs text-oai-gray-400">
                {copy("perks.empty.desc")}
              </p>
            </div>
          )}
          {filteredItems.length !== 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => (
                <PerkCard
                  key={item.id}
                  item={localizePerk(item, locale)}
                  claims={claims}
                  claimDay={claimDay}
                  onToggleClaim={toggleClaim}
                  onAdjustClaimDate={adjustClaimDate}
                  aihot={buildAihotSignal(item, aihotIndex)}
                />
              ))}
            </div>
          )}

        </div>
      </main>
      {/* 长列表跳转：一屏一屏翻太慢，给「回到顶部 / 回到底部」两个常驻按钮 */}
      <div className="pointer-events-none sticky bottom-6 z-20 flex justify-end px-4 sm:px-6">
        <div className="pointer-events-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label={copy("perks.scroll.top")}
            title={copy("perks.scroll.top")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-oai-gray-200 bg-white/90 text-oai-gray-600 shadow-md backdrop-blur transition hover:bg-white hover:text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900/90 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4 rotate-90" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}
            aria-label={copy("perks.scroll.bottom")}
            title={copy("perks.scroll.bottom")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-oai-gray-200 bg-white/90 text-oai-gray-600 shadow-md backdrop-blur transition hover:bg-white hover:text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900/90 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4 -rotate-90" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

export default PerksPage;
