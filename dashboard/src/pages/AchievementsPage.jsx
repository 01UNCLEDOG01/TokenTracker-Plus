import React, { useMemo, useState } from "react";
import { useAchievements } from "../hooks/use-achievements.js";
import { copy } from "../lib/copy";
import { AchievementsSection } from "../ui/achievements/AchievementsSection.jsx";
import { BADGE_CATALOG, BADGE_CATEGORIES, BADGE_CATEGORY_MAP, badgeCopyKey } from "../ui/achievements/badge-catalog.js";
import { BadgeSynergyBanner } from "../ui/achievements/BadgeSynergyBanner.jsx";
import { TitleDetailModal } from "../ui/achievements/TitleDetailModal.jsx";
import { AchievementShareModal } from "../ui/achievements/AchievementShareModal.jsx";
import { triggerAchievementNotification } from "../ui/achievements/SteamAchievementToast.jsx";
import { Share2, Volume2, Sparkles, Layers, RotateCcw } from "lucide-react";
import { TITLES_REGISTRY, getActiveTitleId } from "../ui/achievements/title-registry.js";

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
  // Every badge the local queue can judge is computed on this machine; no
  // account, network call, or sign-in gate is involved. The two cross-user
  // badges (trendsetter / podium) stay locked offline and say so in the note.
  const local = useAchievements();
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [selectedTitleInfo, setSelectedTitleInfo] = useState(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [tierTestIndex, setTierTestIndex] = useState(1);
  const [tierTestBadgeIndex, setTierTestBadgeIndex] = useState(0);
  const [resonanceTestMode, setResonanceTestMode] = useState(0);
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeSortBy, setActiveSortBy] = useState("earned");
  const loading = local.status === "loading";
  // One merged wall: the local endpoint is now the only source, but keeping
  // the `merged` name also keeps the UI-hardcode scanner's existing token.
  const merged = Array.isArray(local.achievements) ? local.achievements : [];
  const earnedCount = useMemo(
    () => merged.filter((b) => (b?.tier || 0) >= 1).length,
    [merged],
  );
  const total = BADGE_CATALOG.length;

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          {/* Header section with title and stats */}
          <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-baseline sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
                {copy("achievements.page.title")}
              </h1>
              <p className="mt-1.5 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("achievements.page.local_note")}
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
                    onClick={() => {
                      const allBadges = BADGE_CATALOG;
                      const randomBadge = allBadges[Math.floor(Math.random() * allBadges.length)];
                      const bName = copy(badgeCopyKey(randomBadge.id, "name"));
                      const bDesc = copy(badgeCopyKey(randomBadge.id, "desc"));
                      triggerAchievementNotification({
                        badge: randomBadge,
                        tier: 1,
                        isTierUp: false,
                        name: bName,
                        desc: bDesc,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 bg-white px-2 py-1 text-xs font-medium text-oai-gray-600 shadow-sm transition hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    title={copy("achievements.action.test_unlock")}
                  >
                    <Volume2 className="h-3 w-3 text-amber-500" />
                    {copy("achievements.action.test_unlock")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextTier = (tierTestIndex % 4) + 1;
                      setTierTestIndex(nextTier);
                      const testBadge = BADGE_CATALOG[tierTestBadgeIndex % BADGE_CATALOG.length];
                      if (nextTier === 4) {
                        setTierTestBadgeIndex((prev) => prev + 1);
                      }
                      const bName = copy(badgeCopyKey(testBadge.id, "name"));
                      const bDesc = copy(badgeCopyKey(testBadge.id, "desc"));
                      triggerAchievementNotification({
                        badge: testBadge,
                        tier: nextTier,
                        isTierUp: nextTier > 1,
                        name: bName,
                        desc: bDesc,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 bg-white px-2 py-1 text-xs font-medium text-oai-gray-600 shadow-sm transition hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    title={copy("achievements.action.test_tier_up")}
                  >
                    <Sparkles className="h-3 w-3 text-cyan-500" />
                    {copy("achievements.action.test_tier_up")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextMode = (resonanceTestMode + 1) % 6;
                      setResonanceTestMode(nextMode);
                      const currentActiveId = getActiveTitleId();
                      const activeTitle = TITLES_REGISTRY.find((t) => t.id === currentActiveId) || TITLES_REGISTRY[0];
                      const modeTier = nextMode === 5 ? 4 : Math.max(1, nextMode);
                      triggerAchievementNotification({
                        badge: {
                          id: "synergy_resonance",
                          art: activeTitle.art,
                        },
                        tier: modeTier,
                        isTierUp: nextMode > 1,
                        name: activeTitle.name,
                        desc: activeTitle.desc,
                      });
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 bg-white px-2 py-1 text-xs font-medium text-oai-gray-600 shadow-sm transition hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    title={copy("achievements.action.test_resonance")}
                  >
                    <Layers className="h-3 w-3 text-purple-400" />
                    {copy("achievements.action.test_resonance")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 shadow-sm transition hover:bg-amber-500/20 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-400"
                  >
                    <Share2 className="h-3 w-3" />
                    {copy("achievements.action.export_card")}
                  </button>
                  {resonanceTestMode !== 0 && (
                    <>
                      <span className="inline-flex items-center rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-xs font-semibold text-violet-600 dark:text-violet-300">
                        {resonanceTestMode}/5
                      </span>
                      <button
                        type="button"
                        onClick={() => setResonanceTestMode(0)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 shadow-sm transition hover:bg-emerald-500/20 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-400"
                        title={copy("achievements.action.reset_real")}
                      >
                        <RotateCcw className="h-3 w-3" />
                        {copy("achievements.action.reset_real")}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Synergies & Titles banner */}
          {!loading && (
            <BadgeSynergyBanner
              badges={merged}
              resonanceTestMode={resonanceTestMode}
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
                    onClick={() => setActiveSortBy(activeSortBy === "earned" ? "difficulty" : "earned")}
                    className="inline-flex items-center gap-1 rounded-md border border-oai-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-oai-gray-700 shadow-sm transition hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    title={activeSortBy === "earned" ? copy("achievements.sort.to_difficulty") : copy("achievements.sort.to_tier")}
                  >
                    {activeSortBy === "earned" ? copy("achievements.sort.tier") : copy("achievements.sort.difficulty")}
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
                  href="https://github.com/xiufengsun/TokenTracker/issues"
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
