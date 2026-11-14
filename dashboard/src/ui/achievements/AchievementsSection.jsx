import { HardDrive } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import React from "react";
import { copy } from "../../lib/copy";
import { AchievementBadge } from "./AchievementBadge";
import { badgeProgress } from "./achievement-format";
import { BADGE_CATALOG, BADGE_CATEGORY_MAP, BADGE_DIFFICULTY, badgeCopyKey, sortBadges } from "./badge-catalog";
import { tierName, TIER_PALETTE } from "./tier-palette";

// 解锁时间排序的时间源：四级时间戳里最早的一个（= 首次解锁那一刻）。
// 从未记录时间戳的早期解锁返回 null（排序时垫尾，弹窗显示「未记录」）。
function earliestUnlockAt(record) {
  const stamps = [];
  for (const at of Object.values(record?.achieved || {})) {
    if (typeof at !== "string" || !at) continue;
    const parsed = Date.parse(at);
    if (Number.isFinite(parsed)) stamps.push(parsed);
  }
  return stamps.length ? Math.min(...stamps) : null;
}

/**
 * Achievements badge wall (page-scale surfaces: /achievements, /u/:userId).
 * - isOwn: full catalog — earned first (tier desc), locked tail after.
 * - !isOwn: earned badges only; renders null when there is nothing to show.
 *
 * Layout: content-width columns + justify-between so the outer columns sit on
 * the container edges; the negative horizontal margin cancels the cells' own
 * inner padding so the COIN GRAPHICS (not the invisible boxes) optically
 * align with the page header. `columns="wide"` adds a 6-across tier for the
 * standalone page; the /u/ profile column keeps 3/4.
 *
 * animateIn: staggered rise-and-settle entrance for the standalone page (the
 * profile modal opens with its own transition — a second entrance there would
 * double-animate). Disabled under prefers-reduced-motion.
 */
export function AchievementsSection({
  achievements,
  isOwn = false,
  scope,
  onSelect,
  size = "xl",
  columns = "default",
  animateIn = false,
  className = "",
  category = "all",
  sortBy = "earned",
}) {
  const reducedMotion = useReducedMotion();
  const animated = animateIn && !reducedMotion;
  const byId = new Map();
  for (const a of Array.isArray(achievements) ? achievements : []) {
    if (a && a.id) byId.set(a.id, a);
  }

  let catalog = scope ? BADGE_CATALOG.filter((b) => b.scope === scope) : BADGE_CATALOG;
  if (category && category !== "all" && BADGE_CATEGORY_MAP[category]) {
    const filterSet = BADGE_CATEGORY_MAP[category];
    catalog = catalog.filter((b) => filterSet.has(b.id));
  }

  let cells;
  if (isOwn) {
    const all = catalog.map((entry) => ({
      entry,
      record: byId.get(entry.id) || { id: entry.id, tier: 0 },
    }));
    // 已解锁/未解锁分区只算一次（三种排序共用；重复的 filter 模式会让
    // ui-hardcode 的 rawText 出现次数翻倍——按出现次数计数，非去重集合）。
    const earnedCells = all.filter((c) => (c.record.tier || 0) >= 1);
    const lockedCells = all.filter((c) => (c.record.tier || 0) < 1);
    if (sortBy === "unlock") {
      // 解锁时间排序（站主 2026-11-14）：已解锁的按解锁时间倒序（最新在前），
      // 无时间戳的早期解锁垫在已解锁组末尾；未解锁照旧排尾。
      earnedCells.sort((a, b) => {
        const ta = earliestUnlockAt(a.record);
        const tb = earliestUnlockAt(b.record);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta;
      });
      cells = [...earnedCells, ...lockedCells];
    } else if (sortBy === "difficulty") {
      cells = [...all].sort((a, b) => {
        const diffA = BADGE_DIFFICULTY[a.entry.id] ?? 5;
        const diffB = BADGE_DIFFICULTY[b.entry.id] ?? 5;
        return diffA - diffB;
      });
    } else {
      cells = [
        ...sortBadges(earnedCells.map((c) => ({ ...c, id: c.entry.id, tier: c.record.tier }))),
        ...lockedCells,
      ];
    }
  } else {
    const list = catalog
      .map((entry) => ({ entry, record: byId.get(entry.id) }))
      .filter((c) => c.record && (c.record.tier || 0) >= 1);
    if (sortBy === "unlock") {
      list.sort((a, b) => {
        const ta = earliestUnlockAt(a.record);
        const tb = earliestUnlockAt(b.record);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta;
      });
      cells = list;
    } else if (sortBy === "difficulty") {
      cells = list.sort((a, b) => {
        const diffA = BADGE_DIFFICULTY[a.entry.id] ?? 5;
        const diffB = BADGE_DIFFICULTY[b.entry.id] ?? 5;
        return diffA - diffB;
      });
    } else {
      cells = sortBadges(
        list.map((c) => ({ ...c, id: c.entry.id, tier: c.record.tier })),
      ).map(({ entry, record }) => ({ entry, record }));
    }
  }

  if (cells.length === 0) return null;

  const gridCols =
    columns === "wide"
      ? "grid-cols-[repeat(3,max-content)] sm:grid-cols-[repeat(4,max-content)] lg:grid-cols-[repeat(5,max-content)]"
      : "grid-cols-[repeat(3,max-content)] sm:grid-cols-[repeat(4,max-content)]";
  // Optical alignment: cancel exactly the gap between the cell edge and the
  // coin graphic so the coins (not the boxes) sit on the container edges.
  const optical = size === "lg" ? "mx-0 sm:-mx-2" : "-mx-2 sm:-mx-4";
  const cellPadding = size === "lg" ? "px-0" : "px-1";

  return (
    <div className={`${optical} grid justify-between gap-y-7 ${gridCols} ${className}`}>
      {cells.map(({ entry, record }, index) => {
        const earned = (record.tier || 0) >= 1;
        // Hidden badges stay anonymous until any tier is earned — even on
        // the owner's own wall. The flag lives in the catalog (which mirrors
        // the SQL catalog's hidden column).
        const hiddenLocked = Boolean(entry.hidden) && !earned;
        const name = hiddenLocked ? copy("achievements.hidden.name") : copy(badgeCopyKey(entry.id, "name"));
        const tName = earned ? tierName(record.tier) : null;
        const progress = hiddenLocked ? 0 : badgeProgress(record);
        return (
          <motion.button
            key={entry.id}
            type="button"
            // Entrance leaves an inline transform behind, which beats the CSS
            // active:scale class — whileTap keeps the press feedback alive.
            initial={animated ? { opacity: 0, y: 16, scale: 0.9 } : false}
            animate={animated ? { opacity: 1, y: 0, scale: 1 } : undefined}
            whileTap={animated ? { scale: 0.97 } : undefined}
            transition={{ delay: 0.05 + index * 0.035, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            onClick={onSelect ? () => onSelect({ ...record, id: entry.id }) : undefined}
            className={`group flex w-[6.75rem] flex-col items-center rounded-xl ${cellPadding} pb-3 pt-4 text-center transition-[background-color,transform] duration-200 ease-out hover:bg-oai-gray-50 active:scale-[0.97] dark:hover:bg-oai-gray-900/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand/60 sm:w-[7.75rem]`}
            aria-label={copy("achievements.badge.aria", {
              name,
              tier: tName ? copy(`achievements.tier.${tName}`) : copy("achievements.modal.locked"),
            })}
          >
            <AchievementBadge
              badgeId={entry.id}
              tier={record.tier}
              locked={!earned}
              hidden={hiddenLocked}
              size={size}
              className="transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-105"
            />
            <span className="mt-2.5 flex w-full items-center justify-center gap-1">
              <span
                title={hiddenLocked ? undefined : name}
                className="min-w-0 truncate text-xs font-medium leading-tight text-oai-gray-800 dark:text-oai-gray-200"
              >
                {name}
              </span>
              {entry.scope === "local" && (
                <span
                  title={copy("achievements.page.local_note")}
                  aria-label={copy("achievements.scope.local")}
                  className="inline-flex shrink-0 text-oai-gray-400 dark:text-oai-gray-500"
                >
                  <HardDrive size={11} strokeWidth={2} aria-hidden />
                </span>
              )}
            </span>
            {/* Meta row has a fixed height so every cell aligns whether it
                shows a tier label, a progress bar, or nothing. */}
            <span className="mt-1 flex h-4 w-full items-center justify-center">
              {earned ? (
                <span
                  className="text-[10px] font-semibold uppercase tracking-[0.08em]"
                  style={{ color: TIER_PALETTE[tName]?.label }}
                >
                  {copy(`achievements.tier.${tName}`)}
                </span>
              ) : isOwn ? (
                <span className="h-[3px] w-14 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-800">
                  <span
                    className="block h-full rounded-full bg-oai-brand/70"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </span>
              ) : null}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

export default AchievementsSection;
