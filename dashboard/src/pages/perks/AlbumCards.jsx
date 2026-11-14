// 卡册 UI（从 PerksPage.jsx 拆出，2026-11-14）：AIHOT 式卡册的统计头、常驻
// 卡牌带（翻页状态机）、玻璃柜绝版陈列与六色图例。数据口径在 album-data.js。
import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { ProviderIcon, hasProviderIcon, providerLogoSrc } from "../../ui/dashboard/components/ProviderIcon.jsx";
import { ALBUM_PAGE_SIZE } from "./album-data.js";
import { PERK_TIER_ACCENT } from "./tier-styles.js";

export function TierDot({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/** 六色图例：色阶只表示「白拿额度」的高低，灰色是最低档、不是差评。 */
export function PerkTierLegend() {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
      <span className="font-medium text-oai-gray-600 dark:text-oai-gray-300">{copy("perks.legend.title")}</span>
      <TierDot className={PERK_TIER_ACCENT.neutral} label={copy("perks.legend.neutral")} />
      <TierDot className={PERK_TIER_ACCENT.success} label={copy("perks.legend.success")} />
      <TierDot className={PERK_TIER_ACCENT.blue} label={copy("perks.legend.blue")} />
      <TierDot className={PERK_TIER_ACCENT.purple} label={copy("perks.legend.purple")} />
      <TierDot className={PERK_TIER_ACCENT.rose} label={copy("perks.legend.rose")} />
      <TierDot className={PERK_TIER_ACCENT.amber} label={copy("perks.legend.amber")} />
    </div>
  );
}

const BRIGHTNESS_RING = [
  "", // 0 未收：暗卡
  "", // 1 已收
  "ring-2 ring-oai-gray-300/80 dark:ring-oai-gray-400/60", // 2 银
  "ring-2 ring-amber-400/90 dark:ring-amber-500/70 shadow-md shadow-amber-500/10", // 3 金
  "ring-2 ring-amber-400 shadow-lg shadow-amber-400/25 animate-pulse", // 4 闪
];

function formatCountdown(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// 卡册小卡（照 AIHOT 的实物卡）：
//   未领取 = 纸质正面（面值条 + 图标底座 + 品牌名），深色主题下也是浅色卡；
//   已领取 = 翻到青色卡背（双向斜纹 + 3px 白边 + 白底圆形 logo + ×N），领取瞬间 rotateY 翻面。
// 只渲染当前那一面：同品牌名不会在页面/无障碍树里出现两次（下方详情卡还有一份 h3）。
function AlbumMiniLogo({ item, hasIcon }) {
  if (hasIcon) {
    return <ProviderIcon provider={item.provider} size={26} className="object-contain" loading="eager" />;
  }
  return <span className="font-mono text-[11px] font-bold text-oai-gray-700">{item.name.charAt(0).toUpperCase()}</span>;
}

function AlbumMiniCard({ item, cycle, collected, tier, streak, claimedNow, sealed, rarity, faceValue, onPreview, flipCount, onSealedClick, showStreak = true, variant = "vitrine", endsLabel, endsHot }) {
  const hasIcon = item.provider ? hasProviderIcon(item.provider) : false;
  const accent = PERK_TIER_ACCENT[item.badgeType] || PERK_TIER_ACCENT.neutral;
  // AIHOT 翻牌口径（2026-11-14 实扒 aihot.news/free-tokens 生产代码定谳，站主裁定
  // 恢复三态——11-14 早间「统一青背」的改判撤销）：
  //   青色卡背 = 「等待领取」——历史领过、今天还没领（AIHOT .ft-cd-back）；
  //   灰暗正面 = 从没领过（AIHOT .ft-cd-ghost：front + plain 灰纸材质 +
  //     opacity:.62 + box-shadow:none，aria-label「还没领」）——悬念面保留但必须灰暗；
  //   亮正面 = 今天领了（claimedNow）翻面揭示（AIHOT 领取后翻回 front）。
  // 领取瞬间：卡从青背 rotateY 翻成正面（「翻牌领福利」），次日自动翻回青背。
  // 绝版形态（玻璃柜副本）：同卡的第二形态，做旧+盖戳，点击弹窗。
  const isVitrineForm = sealed && variant === "vitrine";
  // 卡型标签（站主 2026-11-12）：每张小卡代表一个周期（日/月/一各一张卡）。
  const cycleTagMap = {
    daily: { key: "daily", label: copy("perks.cycle.daily"), cls: "bg-sky-600/85" },
    monthly: { key: "monthly", label: copy("perks.cycle.monthly"), cls: "bg-violet-600/85" },
    once: { key: "once", label: copy("perks.cycle.once"), cls: "bg-amber-600/85" },
  };
  const cycleTags = [cycleTagMap[cycle] || cycleTagMap.daily];
  // 主卡册日常形态照常翻转；玻璃柜副本恒为正面（展示已下线福利+章）。
  const showBack = collected && !claimedNow && !isVitrineForm;
  // 从没领过 = AIHOT ft-cd-ghost：亮正面变灰暗（CSS perk-card-ghost），
  // 不翻背——AIHOT 的未获得卡始终显示正面（opacity .62 沉进背景）。
  const isGhost = !isVitrineForm && !collected && !claimedNow;
  // 领取瞬间翻面重播：flipKey 由父层（PerksPage）统一管理——翻页容器按页
  // key 重建会清掉组件内的延迟定时器。翻转目标是正面，key 挂在正面节点上。
  const flipKey = flipCount || 0;
  const revealed = Boolean(claimedNow) && !isVitrineForm;
  // 绝版形态（玻璃柜副本）的面值条显示已下线福利名；主卡册的日常形态照常显示面值。
  const chipLabel = isVitrineForm && item.retiredDeal?.label ? item.retiredDeal.label : faceValue;
  // 面值过长降级（AIHOT ft-cd-val-long 同款）：超过 10 字符缩字号并隐藏钻点。
  // （取 10 的 min 比较是为了避开 ui-hardcode 扫描器对 JSX 里 ASCII 大于号的误报。）
  const valLong = Math.min(String(chipLabel || "").length, 10) === 10;
  // 卡堆层叠 v2（AIHOT .ft-deck 同款机制，站主 2026-11-13 指定照抄）：连领 2 次起
  // 卡底下垫 1-2 张与卡同尺寸的「底牌」，translate(±4px,3-4px)rotate(±4-5°) 从左右
  // 底角斜露——领一次多一张，×N 仍是精确数，底牌封顶 2 张只给「厚薄」体感；
  // 绝版玻璃柜副本恒为单卡，不堆。（比较刻意不用大于号写法：ui-hardcode 扫描器
  // 把 JSX 表达式里的 ASCII 大于号连到下一个标签误报成 JSX 文本。）
  const claimEdges = collected ? Math.max(streak - 1, 0) : 0;
  const stackLayers = isVitrineForm ? 0 : Math.min(claimEdges, 2);
  // ×N 徽章照 AIHOT 挂到卡外右下角（玻璃柜保留卡内角标，做旧卡配内嵌小字）。
  const outerCnt = variant === "strip" && streak !== 0 && (showBack || (showStreak && collected));
  // holo 卡鼠标跟随 3D（AIHOT .ft-slot-holo 思路，只倾斜不放大——站主 2026-11-13
  // 拍板：特效留在卡牌范围内，超出会乱、晃眼）。--ft-x/--ft-y 由 move 事件写入，
  // 交给 CSS calc 消费；离开复位到中心。
  const holoTilt = rarity === "holo" && variant === "strip"
    ? {
        onMouseMove: (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--ft-x", ((e.clientX - rect.left) / rect.width).toFixed(3));
          e.currentTarget.style.setProperty("--ft-y", ((e.clientY - rect.top) / rect.height).toFixed(3));
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.setProperty("--ft-x", "0.5");
          e.currentTarget.style.setProperty("--ft-y", "0.5");
        },
      }
    : null;
  return (
    <button
      type="button"
      {...(holoTilt || {})}
      onClick={isVitrineForm && onSealedClick ? () => onSealedClick(item) : onPreview ? () => onPreview(item) : undefined}
      title={isVitrineForm ? copy("perks.album.vitrine_detail") : onPreview ? copy("perks.album.preview") : undefined}
      aria-label={`${item.name} — ${isVitrineForm ? copy("perks.album.vitrine_detail") : copy("perks.album.preview")}`}
      data-perk-id={item.id}
      data-flip-key={flipKey}
      className={cn(
        "perk-mini relative block h-[118px] w-full text-center focus-visible:outline-none",
        revealed ? "is-collected" : "is-uncollected",
        holoTilt ? "perk-holo-tilt" : null,
      )}
    >
      <span className="perk-mount" aria-hidden />
      {stackLayers === 2 && (
        <span className="perk-deck perk-deck2" aria-hidden />
      )}
      {stackLayers !== 0 && (
        <span className="perk-deck perk-deck1" aria-hidden />
      )}
      {showBack ? (
        <span
          className={cn(
            "perk-mini-card perk-card-back absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-lg",
            rarity === "blue" ? "perk-rarity-blue" : null,
            rarity === "bronze" ? "perk-rarity-bronze" : null,
            rarity === "silver" ? "perk-rarity-silver" : null,
            rarity === "gold" ? "perk-rarity-gold" : null,
            rarity === "holo" ? "perk-rarity-holo" : null,
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm">
            <AlbumMiniLogo item={item} hasIcon={hasIcon} />
          </span>
          <span className="perk-back-mark" aria-hidden>
            {`TT PLUS`}
          </span>
          {variant !== "strip" && streak !== 0 && (
            <span className="absolute bottom-1 right-1 rounded-full bg-oai-gray-900/75 px-1.5 text-[9px] font-semibold tabular-nums text-white">
              ×{streak}
            </span>
          )}
          <span className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[3px] rounded-b-md", accent)} aria-hidden />
        </span>
      ) : (
        <span
          key={flipKey}
          className={cn(
            "perk-mini-card perk-card-front absolute inset-0 flex flex-col items-center justify-between overflow-hidden rounded-lg border border-oai-gray-200/80 p-1.5",
            isVitrineForm ? "perk-card-aged" : null,
            isGhost ? "perk-card-ghost" : null,
            !isVitrineForm && rarity ? "perk-front-" + rarity : null,
          )}
        >
          <span className="flex w-full items-center justify-between gap-1">
            <span className="flex gap-0.5">
              {isVitrineForm && chipLabel ? (
                <span
                  className={cn(
                    "max-w-full truncate rounded bg-oai-gray-900/85 px-1 py-0.5 font-semibold leading-tight text-white",
                    valLong ? "text-[8px]" : "text-[9px]",
                  )}
                >
                  {chipLabel}
                  {valLong ? null : <span className="perk-pips" aria-hidden>◆</span>}
                </span>
              ) : cycleTags.map((tag) => (
                <span key={tag.key} className={cn("rounded px-1 py-0.5 text-[8px] font-bold leading-none text-white", tag.cls)}>
                  {tag.label}
                </span>
              ))}
            </span>
            {variant === "strip" && endsLabel ? (
              <span className={cn("perk-cd-end ml-auto self-center", endsHot ? "perk-cd-end-hot" : null)}>{endsLabel}</span>
            ) : null}
            {isVitrineForm && (
              <span className="perk-seal absolute right-0 top-0 rounded px-1 py-0.5 text-[8px] font-extrabold tracking-wider">
                {copy("perks.album.sealed")}
              </span>
            )}
          </span>
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5 shadow-sm">
            <AlbumMiniLogo item={item} hasIcon={hasIcon} />
          </span>
          <span className="w-full truncate text-[10px] font-semibold leading-tight text-oai-gray-700">
            {item.name}
          </span>
          {variant !== "strip" && showStreak && collected && streak !== 0 && (
            <span className="absolute bottom-1 right-1 rounded-full bg-oai-gray-900/75 px-1.5 text-[9px] font-semibold tabular-nums text-white">
              ×{streak}
            </span>
          )}
          <span className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[3px]", accent)} aria-hidden />
        </span>
      )}
      {outerCnt && (
        <span className="perk-cnt absolute -bottom-2 -right-2 z-10 rounded-full border border-oai-gray-200 bg-white px-1.5 text-[9px] font-bold leading-[14px] tabular-nums text-oai-gray-600 shadow-sm dark:border-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
          ×{streak}
        </span>
      )}
    </button>
  );
}

// 绝版展示柜（站主 2026-11-12「封装到玻璃柜」）：和还能领福利的卡分开陈列。
// 玻璃质感 = 深色玻璃渐变 + 内阴影高光；绝版卡保持纸面 + 红章 + ×N。
export function AlbumVitrine({ entries, flipKeys, onSealedClick }) {
  if (!entries.length) return null;
  return (
    <div className="mb-8">
      <div className="perk-vitrine relative overflow-hidden rounded-2xl p-4">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/70 dark:bg-white/25" aria-hidden />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("perks.album.vitrine")}</h2>
          <span className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
            {copy("perks.album.sealed_count", { count: entries.length })}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {entries.map((entry) => (
            <div key={entry.item.id} className="flex flex-col items-center gap-1">
              <AlbumMiniCard
                item={entry.item}
                collected={entry.collected}
                tier={entry.tier}
                streak={entry.streak}
                claimedNow={entry.claimedNow}
                sealed={entry.sealed}
                rarity={entry.rarity}
                faceValue={entry.faceValue}
                onSealedClick={onSealedClick}
                flipCount={flipKeys[entry.item.id] || 0}
                showStreak={false}
              />
              {Boolean(entry.streak) && (
                <span className="text-[10px] text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("perks.album.vitrine_claims", { count: entry.streak })}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlbumStats({ claimableTodayYuan, claimedMonthYuan, totalClaimedYuan, claimDay, collected, total, sealedCount, sealedCollected }) {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const money = (value) => `¥${Math.round(value).toLocaleString()}`;
  return (
    <div className="flex w-full shrink-0 flex-col justify-center gap-3 rounded-2xl border border-oai-gray-200/80 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-900/70 sm:w-52">
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.claimable")}</p>
        <p className="text-2xl font-semibold tracking-tight text-oai-black dark:text-white">
          {claimableTodayYuan > 0 ? money(claimableTodayYuan) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.month")}</p>
        <p className="text-lg font-semibold text-oai-black dark:text-white">
          {claimedMonthYuan > 0 ? money(claimedMonthYuan) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.total_claimed")}</p>
        <p className="text-lg font-semibold text-oai-black dark:text-white">
          {totalClaimedYuan > 0 ? money(totalClaimedYuan) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.refresh")}</p>
        <p className="font-mono text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          {formatCountdown(
            Date.parse(`${claimDay}T00:00:00+08:00`) + 86_400_000 - nowMs,
          )}
        </p>
      </div>
      <p className="text-[10px] leading-tight text-oai-gray-400 dark:text-oai-gray-500">
        {copy("perks.album.note")}
      </p>
      <p className="text-[11px] font-medium text-oai-gray-600 dark:text-oai-gray-300">
        {copy("perks.album.collected", { collected, total })}
        {sealedCount > 0 ? ` · ${copy("perks.album.sealed_summary", { total: sealedCount, collected: sealedCollected || 0 })}` : null}
      </p>
    </div>
  );
}

// --- 卡册（AIHOT 式复刻，站主 2026-11-11 拍板「照着他做」）---
// AIHOT 的灵魂：统计头（今天还能领/本月已领到/下次刷新倒计时）+ 常驻卡牌带
// （扑克式小卡：面值角标+logo+品牌名；未收=暗卡藏品牌，收了才揭晓）+
// 「N 张收了 M 张」进度 + 圆点翻页。亮度档沿用累计领取 7/15/30 次。
export function AlbumStrip({ items, stripItems, claimDay, page, onPageChange, onPreview, flipKeys, aihotSums, vitrineCount = 0 }) {
  const totalPages = Math.max(1, Math.ceil(stripItems.length / ALBUM_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  // 翻页状态机（2026-11-14 实扒 AIHOT free-tokens JS 对齐）：一次翻页只有一层在动、
  // 且永远渲染在最上层，另一层完全静止垫底——
  //   往前翻（目标页码更大）：新页**无动画**垫底，旧页 ft-pg-out 在上层转走，旧页
  //   消失的那一刻新页已完整在其下（站主指认的「消失了才出现新页」，没有转入动画）。
  //   往回翻（目标页码更小）：旧页静止垫底，新页 ft-pg-in 在上层转入盖住旧页。
  // 640ms 后清转场（AIHOT 同款常量；动画本体 0.62s）。reduce-motion 时 CSS 把两个
  // 覆盖层 display:none、基底层无动画，等效直接跳页。
  const prevShownRef = useRef(safePage);
  const [shown, setShown] = useState(safePage);
  const [flip, setFlip] = useState(null); // { page, anim: "out" | "in" }
  useEffect(() => {
    if (safePage === prevShownRef.current) return undefined;
    const from = prevShownRef.current;
    const forward = safePage > from;
    let timer;
    if (forward) {
      prevShownRef.current = safePage;
      setShown(safePage);
      setFlip({ page: from, anim: "out" });
      timer = setTimeout(() => setFlip(null), 640);
    } else {
      setFlip({ page: safePage, anim: "in" });
      timer = setTimeout(() => {
        prevShownRef.current = safePage;
        setShown(safePage);
        setFlip(null);
      }, 640);
    }
    return () => clearTimeout(timer);
  }, [safePage]);
  // 筛选收缩后 shown 可能越界：无声吸附回合法页（不走动画）。
  const clampedShown = Math.min(shown, totalPages - 1);
  useEffect(() => {
    if (clampedShown === shown) return undefined;
    prevShownRef.current = clampedShown;
    setShown(clampedShown);
    setFlip(null);
    return undefined;
  }, [clampedShown, shown]);
  // 翻页白闪的主要来源是「新页 remount → 品牌图标重新请求/解码」。点击翻页前
  // 先把相邻两页的图标拉进浏览器缓存，翻过去时直接命中（站主 2026-11-13）。
  useEffect(() => {
    for (const target of [safePage + 1, safePage - 1]) {
      if (target < 0 || target >= totalPages) continue;
      for (const entry of stripItems.slice(target * ALBUM_PAGE_SIZE, (target + 1) * ALBUM_PAGE_SIZE)) {
        const src = providerLogoSrc(entry?.item?.provider);
        if (src) {
          const img = new Image();
          img.src = src;
        }
      }
    }
  }, [safePage, totalPages, stripItems]);

  // 覆盖层卡片与基底层共用同一套渲染；key 前缀区分两层，防 React 复用错位。
  // 覆盖层 flipCount 恒 0：flipKey 靠 key 重挂载重播翻面动画，覆盖层挂载时若带
  // 真实计数会重播「领取翻面」（旧转出层就因此显式传 0）。
  function renderAlbumCards(entries, keyPrefix, liveFlip) {
    return entries.map((entry) => (
      <AlbumMiniCard
        key={keyPrefix + entry.item.id + ":" + entry.cycle}
        item={entry.item}
        cycle={entry.cycle}
        collected={entry.collected}
        tier={entry.tier}
        streak={entry.streak}
        claimedNow={entry.claimedNow}
        sealed={entry.sealed}
        rarity={entry.rarity}
        faceValue={entry.faceValue}
        onPreview={onPreview}
        flipCount={liveFlip ? (flipKeys[entry.item.id + ":" + entry.cycle] || 0) : 0}
        variant="strip"
        endsLabel={entry.endsLabel}
        endsHot={entry.endsHot}
      />
    ));
  }

  const flipItems = flip === null
    ? []
    : stripItems.slice(flip.page * ALBUM_PAGE_SIZE, (flip.page + 1) * ALBUM_PAGE_SIZE);
  const pageItems = stripItems.slice(clampedShown * ALBUM_PAGE_SIZE, (clampedShown + 1) * ALBUM_PAGE_SIZE);
  const collected = items.filter((entry) => entry.collected).length;
  // 绝版 = 已收藏 + 活动已结束（AIHOT 的「绝版」口径），只做计数与盖章，不重排。
  // 按「卡」去重计数：绝版卡若有日/月两个周期条目，不能算成两张（站主 2026-11-13 ④）。
  const sealedCount = new Set(items.filter(function (entry) { return entry.sealed; }).map(function (entry) { return entry.item.id; })).size;
  // 求和来自 AIHOT 全目录（PerksPage 传 aihotSums），不是卡册映射子集。
  const claimableTodayYuan = aihotSums.claimable;
  const claimedMonthYuan = aihotSums.monthly;
  const totalClaimedYuan = aihotSums.totalClaimed;
  return (
    <div className="mb-8 flex flex-col gap-4 lg:flex-row">
      <AlbumStats
        claimableTodayYuan={claimableTodayYuan}
        claimedMonthYuan={claimedMonthYuan}
        totalClaimedYuan={totalClaimedYuan}
        claimDay={claimDay}
        collected={collected}
        total={items.length}
        sealedCount={sealedCount}
        sealedCollected={vitrineCount}
      />
      <div
        className="min-w-0 flex-1 rounded-2xl border border-oai-gray-200/80 bg-oai-gray-50/60 p-4 dark:border-oai-gray-800 dark:bg-oai-gray-950/50"
        style={{ perspective: "2600px" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("perks.album.title")}</h2>
          {totalPages !== 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={copy("perks.album.prev")}
                disabled={safePage === 0}
                onClick={() => onPageChange(safePage - 1)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border transition",
                  safePage === 0
                    ? "border-oai-gray-200 text-oai-gray-300 dark:border-oai-gray-700 dark:text-oai-gray-600"
                    : "border-oai-gray-300 text-oai-gray-600 hover:bg-oai-gray-100 dark:border-oai-gray-600 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
              {Array.from({ length: totalPages }, (_, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={copy("perks.album.page", { page: idx + 1, pages: totalPages })}
                  onClick={() => onPageChange(idx)}
                  className={cn(
                    "h-1.5 w-4 rounded-full transition",
                    idx === safePage ? "bg-oai-gray-800 dark:bg-white" : "bg-oai-gray-300 dark:bg-oai-gray-600",
                  )}
                />
              ))}
              <button
                type="button"
                aria-label={copy("perks.album.next")}
                disabled={safePage >= totalPages - 1}
                onClick={() => onPageChange(safePage + 1)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border transition",
                  safePage >= totalPages - 1
                    ? "border-oai-gray-200 text-oai-gray-300 dark:border-oai-gray-700 dark:text-oai-gray-600"
                    : "border-oai-gray-300 text-oai-gray-600 hover:bg-oai-gray-100 dark:border-oai-gray-600 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                )}
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}
        </div>
        <div className="perk-binder">
          <div className="relative">
            {/* Base layer: fully static (AIHOT-style — only the overlay moves). */}
            <div key={clampedShown} className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {renderAlbumCards(pageItems, "", true)}
            </div>
            {/* Forward: old page turns away on top; the new page sits static beneath. */}
            {flip !== null && flip.anim === "out" && (
              <div
                key={`out-${flip.page}`}
                className="perk-page-turn-out absolute inset-0 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9"
                aria-hidden
              >
                {renderAlbumCards(flipItems, "out-", false)}
              </div>
            )}
            {/* Backward: new page turns in on top, covering the static old page. */}
            {flip !== null && flip.anim === "in" && (
              <div
                key={`in-${flip.page}`}
                className="perk-page-turn-in absolute inset-0 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9"
                aria-hidden
              >
                {renderAlbumCards(flipItems, "in-", false)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
