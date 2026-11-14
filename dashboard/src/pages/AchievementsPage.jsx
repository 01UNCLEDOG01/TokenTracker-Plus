import React, { useMemo, useState } from "react";
import { useAchievements, useLocalAchievements } from "../hooks/use-achievements.js";
import { copy } from "../lib/copy";
import { AchievementsSection } from "../ui/achievements/AchievementsSection.jsx";
import { BADGE_CATALOG, BADGE_CATEGORIES, BADGE_CATEGORY_MAP, badgeCopyKey } from "../ui/achievements/badge-catalog.js";
import { BadgeSynergyBanner } from "../ui/achievements/BadgeSynergyBanner.jsx";
import { TitleDetailModal } from "../ui/achievements/TitleDetailModal.jsx";
import { AchievementShareModal } from "../ui/achievements/AchievementShareModal.jsx";
import { Share2 } from "lucide-react";

// Lazy: 3D coin + dialog ship only when a badge is clicked.
const BadgeDetailModal = React.lazy(() => import("../ui/achievements/BadgeDetailModal.jsx"));

function GridSkeleton() {
  // Mirrors AchievementsSection's wide layout 1:1 so content pops in with
  // zero shift.
  return (
    <div
      className="mx-0 grid animate-pulse grid-cols-[repeat(3,max-content)] justify-between gap-y-7 sm:-mx-2 sm:grid-cols-[repeat(4,max-content)] lg:grid-cols-[repeat(5,max-content)]"
      aria-hidden
    >
      {Array.from({ length: BADGE_CATALOG.length }).map((_, index) => (
        <div key={index} className="flex w-[6.75rem] flex-col items-center px-0 pb-3 pt-4 sm:w-[7.75rem]">
          <div className="h-[108px] w-[108px] rounded-full bg-oai-gray-200 dark:bg-oai-gray-800" />
          <div className="mt-3 h-3 w-16 rounded bg-oai-gray-200 dark:bg-oai-gray-800" />
          <div className="mt-2 h-2 w-10 rounded bg-oai-gray-100 dark:bg-oai-gray-800/60" />
        </div>
      ))}
    </div>
  );
}

export default function AchievementsPage() {
  // Two scopes over one catalog (站主 2026-11-14 拍板：页内页签，默认云端):
  //   cloud = 本机计算 + 账号级并集（任一设备解锁全设备显示，等级取最高、
  //           解锁时间取最早）—— 打开页面的默认口径;
  //   local = 这台设备自己挣到的墙（scope=local，服务端跳过并集合并）。
  // The two cross-user badges (trendsetter / podium) stay locked on the local
  // scope and say so in the note.
  const cloud = useAchievements();
  const local = useLocalAchievements();
  const [scope, setScope] = useState("cloud");
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [selectedTitleInfo, setSelectedTitleInfo] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeSortBy, setActiveSortBy] = useState("earned");
  const activeView = scope === "local" ? local : cloud;
  const loading = activeView.status === "loading";
  // One merged wall per scope: keeping the `merged` name also keeps the
  // UI-hardcode scanner's existing token.
  const merged = Array.isArray(activeView.achievements) ? activeView.achievements : [];
  const earnedCount = useMemo(
    () => merged.filter((b) => (b?.tier || 0) >= 1).length,
    [merged],
  );
  const cloudEarned = useMemo(
    () => (Array.isArray(cloud.achievements) ? cloud.achievements : []).filter((b) => (b?.tier || 0) >= 1).length,
    [cloud.achievements],
  );
  const localEarned = useMemo(
    () => (Array.isArray(local.achievements) ? local.achievements : []).filter((b) => (b?.tier || 0) >= 1).length,
    [local.achievements],
  );
  const total = BADGE_CATALOG.length;

  // 切口径即换数据源：已打开的详情弹窗是旧口径的对象快照，直接关掉，
  // 不允许「云端页签打开的弹窗停在本机页签上」的混合状态。
  const switchScope = (next) => {
    if (next === scope) return;
    setScope(next);
    setSelectedBadge(null);
    setSelectedTitleInfo(null);
  };

  return (
    <div className="tt-achievements-page flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Header section with title and stats */}
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
                {copy("achievements.page.title")}
              </h1>
              <p className="mt-1.5 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy(scope === "local" ? "achievements.page.local_note" : "achievements.page.cloud_note")}
              </p>
            </div>
            {!loading && (
              <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                <div className="font-mono text-2xl font-semibold leading-none tabular-nums text-oai-black dark:text-white">
                  {earnedCount}
                  <span className="text-oai-gray-400 dark:text-oai-gray-600">/{total}</span>
                </div>
                <div className="h-1 w-24 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-800">
                  <div
                    className="h-full rounded-full bg-oai-brand-600 transition-[width] duration-500"
                    style={{ width: `${Math.round((earnedCount / total) * 100)}%` }}
                  />
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 shadow-sm transition hover:bg-amber-500/20 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400"
                  >
                    <Share2 className="h-3 w-3" />
                    {copy("achievements.action.export_card")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Scope tabs: 云端并集（默认）/ 本机 — same chip language as the
              category row below, one step larger so the two rows read as
              different levels. Toggle buttons with aria-pressed (no tablist
              machinery) match the page's existing chip patterns. Counts stay
              hidden until each wall is ready. */}
          <div
            className="mb-5 flex items-center gap-1.5"
            role="group"
            aria-label={copy("achievements.page.scope_aria")}
          >
            {[
              { key: "cloud", label: copy("achievements.page.scope_cloud"), count: cloudEarned, ready: cloud.status === "ready" },
              { key: "local", label: copy("achievements.page.scope_local"), count: localEarned, ready: local.status === "ready" },
            ].map((tab) => {
              const isActive = scope === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => switchScope(tab.key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-oai-gray-900 text-white dark:bg-white dark:text-oai-gray-950 shadow-sm"
                      : "text-oai-gray-600 hover:bg-oai-gray-100 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800/60"
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.ready ? (
                    <span className={`text-xs tabular-nums ${isActive ? "opacity-75" : "text-oai-gray-400 dark:text-oai-gray-500"}`}>
                      {tab.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Synergies & Titles banner */}
          {!loading && (
            <BadgeSynergyBanner
              badges={merged}
              onSelectBadge={(id) => {
                const badge = merged.find((b) => b.id === id);
                if (badge) setSelectedBadge(badge);
              }}
              onOpenTitleDetail={(title, resonance) => {
                setSelectedTitleInfo({ title, resonance });
              }}
            />
          )}

          {loading ? (
            <GridSkeleton />
          ) : (
            <>
              {/* Category filter & Sorting controls */}
              <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-oai-gray-200/70 pb-4 dark:border-oai-gray-800/60">
                <div className="flex flex-wrap items-center gap-1.5">
                  {BADGE_CATEGORIES.map((cat) => {
                    const count = cat.key === "all" ? BADGE_CATALOG.length : (BADGE_CATEGORY_MAP[cat.key]?.size || 0);
                    const isActive = activeCategory === cat.key;
                    return (
                      <button
                        key={cat.key}
                        type="button"
                        onClick={() => setActiveCategory(cat.key)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-oai-gray-900 text-white dark:bg-white dark:text-oai-gray-950 shadow-sm"
                            : "text-oai-gray-600 hover:bg-oai-gray-100 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800/60"
                        }`}
                      >
                        <span>{copy(`achievements.filter.${cat.key}`)}</span>
                        <span className={`text-[10px] tabular-nums ${isActive ? "opacity-75" : "text-oai-gray-400 dark:text-oai-gray-500"}`}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <span className="text-xs text-oai-gray-400 dark:text-oai-gray-500">{copy("achievements.sort.label")}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveSortBy(
                        activeSortBy === "earned" ? "difficulty" : activeSortBy === "difficulty" ? "unlock" : "earned",
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-oai-gray-700 shadow-sm transition hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    title={activeSortBy === "earned" ? copy("achievements.sort.to_difficulty") : activeSortBy === "difficulty" ? copy("achievements.sort.to_unlock") : copy("achievements.sort.to_tier")}
                  >
                    {activeSortBy === "earned"
                      ? copy("achievements.sort.tier")
                      : activeSortBy === "difficulty"
                        ? copy("achievements.sort.difficulty")
                        : copy("achievements.sort.unlock")}
                  </button>
                </div>
              </div>

              <AchievementsSection
                achievements={merged}
                isOwn
                columns="wide"
                size="lg"
                animateIn
                onSelect={setSelectedBadge}
                category={activeCategory}
                sortBy={activeSortBy}
              />
              <p className="mt-10 text-center text-xs text-oai-gray-400 dark:text-oai-gray-500">
                {copy("achievements.page.suggest")}{" "}
                <a
                  href="https://github.com/01UNCLEDOG01/TokenTracker-plus/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-oai-gray-300 underline-offset-2 transition-colors hover:text-oai-gray-700 hover:decoration-oai-gray-500 dark:decoration-oai-gray-600 dark:hover:decoration-oai-gray-300"
                >
                  {copy("achievements.page.suggest_link")}
                </a>
              </p>
            </>
          )}
        </div>
      </main>

      {/* Steam achievement toast notifications container */}

      {/* Share report card modal */}
      <AchievementShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        badges={merged}
      />

      {selectedBadge && (
        <React.Suspense fallback={null}>
          <BadgeDetailModal badge={selectedBadge} onClose={() => setSelectedBadge(null)} />
        </React.Suspense>
      )}

      {selectedTitleInfo && (
        <TitleDetailModal
          title={selectedTitleInfo.title}
          resonance={selectedTitleInfo.resonance}
          badgeMap={new Map(merged.map((b) => [b.id, b]))}
          onClose={() => setSelectedTitleInfo(null)}
          onSelectBadge={(id) => {
            const badge = merged.find((b) => b.id === id);
            if (badge) setSelectedBadge(badge);
          }}
        />
      )}
    </div>
  );
}
