import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import React, { useEffect } from "react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { isNativeWindowsApp } from "../../lib/native-bridge.js";
import { Badge3DCoin } from "./Badge3DCoin";
import { badgeProgress, formatBadgeValue, latestAchievedAt } from "./achievement-format";
import { BADGE_BY_ID, badgeCopyKey } from "./badge-catalog";
import { TIER_ORDER, TIER_PALETTE, tierName } from "./tier-palette";

function formatDate(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toLocaleDateString();
}

export function formatIssueNumber(value) {
  const issueNumber = Number(value);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return null;
  return String(issueNumber).padStart(6, "0");
}

export function currentBadgeIssueNumber(badge, entry, currentTierName) {
  if (entry?.scope !== "cloud" || !currentTierName) return null;
  const issueNumber = Number(badge?.serials?.[currentTierName]);
  return Number.isSafeInteger(issueNumber) && issueNumber >= 1 ? issueNumber : null;
}

/**
 * State of the dialog's tier preview: which tier face is shown, whether that
 * tier was actually reached, when, and what it required. Previewing tiers the
 * badge hasn't reached shows the face plus the threshold to get there.
 */
export function resolveTierView(badge, viewTier) {
  const currentTier = badge?.tier || 0;
  const tier = Math.min(4, Math.max(0, Math.trunc(Number(viewTier) || 0)));
  const name = tier >= 1 ? TIER_ORDER[tier - 1] : null;
  const achieved = tier >= 1 && currentTier >= tier;
  return {
    tier,
    name,
    achieved,
    viewingCurrent: tier === currentTier,
    date: achieved ? badge?.achieved?.[name] || null : null,
    threshold: tier >= 1 && Array.isArray(badge?.thresholds) ? badge.thresholds[tier - 1] : null,
  };
}

/**
 * The three lines engraved on the coin's back. The live local reading only
 * appears when the viewed tier was earned on this device. For a union-raised
 * tier the earning device's own reading rides in `badge.values` (挣到值,
 * KI-084) and shows as remoteEarnedText when present; without it the back
 * shows the bar that tier required — the same thing previewing any other
 * tier does — and never pairs 达成于 with 本机数值.
 */
export function resolveCoinBackLines({
  hiddenLocked,
  formattedIssueNumber,
  view,
  viewDate,
  valueText,
  viewThresholdText,
  name,
  previewedTierIsRemote,
  remoteEarnedText,
}) {
  if (hiddenLocked) return [copy("achievements.modal.locked"), "···", name];
  if (formattedIssueNumber) {
    return [
      copy("achievements.modal.achieved_label"),
      copy("achievements.modal.issue_number", { number: formattedIssueNumber }),
      viewDate || name,
    ];
  }
  if (view.achieved) {
    return [
      copy("achievements.modal.achieved_label"),
      view.viewingCurrent && !previewedTierIsRemote
        ? valueText
        : (previewedTierIsRemote && remoteEarnedText) || viewThresholdText || valueText,
      viewDate || name,
    ];
  }
  return [copy("achievements.modal.locked"), viewThresholdText || "···", name];
}

function TierTrack({ badge, viewTier, onSelect }) {
  return (
    <div className="flex items-center gap-1">
      {TIER_ORDER.map((name, index) => {
        const reached = (badge.tier || 0) >= index + 1;
        const selected = viewTier === index + 1;
        const at = formatDate(badge.achieved?.[name]);
        const palette = TIER_PALETTE[name];
        return (
          <button
            key={name}
            type="button"
            onClick={() => onSelect(index + 1)}
            aria-pressed={selected}
            aria-label={copy(`achievements.tier.${name}`)}
            title={at ? `${copy(`achievements.tier.${name}`)} · ${at}` : copy(`achievements.tier.${name}`)}
            className={cn(
              "inline-flex h-3 w-9 cursor-pointer rounded-full border-0 bg-transparent p-0 transition-transform hover:scale-110",
              selected && "ring-2 ring-oai-gray-400 ring-offset-1 ring-offset-white dark:ring-oai-gray-300 dark:ring-offset-oai-gray-950",
            )}
            style={
              reached
                ? {
                    background: `linear-gradient(120deg, ${palette.rim[0]} 0%, ${palette.ring} 55%, ${palette.rim[1]} 100%)`,
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4), 0 0 0 1px rgba(10,15,12,0.05)",
                  }
                : undefined
            }
          >
            {!reached && (
              <span className="h-full w-full rounded-full bg-oai-gray-200 dark:bg-oai-gray-800" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function BadgeDetailBody({ badge, onClose }) {
  const entry = BADGE_BY_ID.get(badge.id);
  const currentTier = badge.tier || 0;
  // Hidden badge still locked: the whole dialog stays anonymous — name,
  // description, face and metrics all mask out until any tier is earned.
  const hiddenLocked = Boolean(entry?.hidden) && currentTier < 1;
  const name = hiddenLocked ? copy("achievements.hidden.name") : copy(badgeCopyKey(badge.id, "name"));
  const desc = hiddenLocked ? copy("achievements.hidden.desc") : copy(badgeCopyKey(badge.id, "desc"));
  // The dialog previews one tier at a time — defaults to the earned/current
  // one; clicking a segment in the tier track switches the face, the
  // threshold line and that tier's achieved date.
  const [viewTier, setViewTier] = React.useState(currentTier);
  const view = resolveTierView(badge, viewTier);

  const earned = currentTier >= 1;
  // 云端并集视图：remote_raised 表示当前等级是别的设备抬上来的。此时
  // metric_value 是本机实时读数，与并集等级无关——数值行必须换成「本机数值」，
  // 预览到 union 抬上来的等级时再补一行来源标注，否则会读成
  // 「钻石条件 100 但当前数值 6」的矛盾（站主 2026-11-14 点名）。
  const remoteRaised = Boolean(badge?.remote_raised);
  const localTier = Number(badge?.local_tier ?? currentTier);
  const previewedTierIsRemote = remoteRaised && view.achieved && view.tier > localTier;
  // 挣到值（KI-084）：并集合并后的 payload 会带各档挣到值（时间戳胜者设备
  // 的实测读数）。仅当预览的等级确实是远端抬上来的才展示，取不到就回落到
  // 门槛值（旧数据没有这一列）。
  const remoteEarnedValue = previewedTierIsRemote ? Number(badge?.values?.[view.name]) : NaN;
  const remoteEarnedText = Number.isFinite(remoteEarnedValue)
    ? formatBadgeValue(entry?.format, remoteEarnedValue)
    : null;
  const tName = earned ? tierName(currentTier) : null;
  const achievedDate = formatDate(
    earned ? badge.achieved?.[tName] || (latestAchievedAt(badge) ? new Date(latestAchievedAt(badge)).toISOString() : null) : null,
  );
  const valueText = hiddenLocked ? "???" : formatBadgeValue(entry?.format, badge.metric_value);
  const progress = hiddenLocked ? 0 : badgeProgress(badge);
  const nextTierName = currentTier < 4 ? tierName(currentTier + 1) : null;
  // Coin back side reflects the previewed tier: mint number (cloud), current
  // value or the previewed tier's threshold, and that tier's date.
  const viewIssueNumber = view.achieved ? currentBadgeIssueNumber(badge, entry, view.name) : null;
  const formattedIssueNumber = formatIssueNumber(viewIssueNumber);
  const viewDate = formatDate(view.date);
  const viewThresholdText =
    !hiddenLocked && view.threshold != null ? formatBadgeValue(entry?.format, view.threshold) : null;
  const backLines = resolveCoinBackLines({
    hiddenLocked,
    formattedIssueNumber,
    view,
    viewDate,
    valueText,
    viewThresholdText,
    name,
    previewedTierIsRemote,
    remoteEarnedText,
  });

  return (
    <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
      <div className="flex w-full items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-left">
          <h2 className="truncate text-lg font-semibold tracking-tight text-oai-black dark:text-white">{name}</h2>
          <p className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {desc}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy("achievements.modal.close")}
          className="shrink-0 rounded-md p-1.5 text-oai-gray-400 transition-colors hover:bg-oai-gray-100 hover:text-oai-gray-700 dark:hover:bg-oai-gray-900 dark:hover:text-oai-gray-200"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-5 mb-7">
        <Badge3DCoin
          badgeId={badge.id}
          tier={view.tier}
          locked={view.tier < 1}
          hidden={hiddenLocked}
          backLines={backLines}
          label={copy("achievements.modal.coin_aria", { name })}
        />
      </div>

      <div className="flex items-center gap-2">
        {/* Same metallic ramp as the tier-history segments — one visual
            language for "tier" everywhere in this dialog. Shows the tier
            being previewed; gray "locked" for tiers not yet reached. */}
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
          style={
            view.achieved
              ? {
                  background: `linear-gradient(120deg, ${TIER_PALETTE[view.name].rim[0]} 0%, ${TIER_PALETTE[view.name].ring} 55%, ${TIER_PALETTE[view.name].rim[1]} 100%)`,
                  color: TIER_PALETTE[view.name].glyph,
                  textShadow: "0 1px 0 rgba(255,255,255,0.35)",
                  boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4), 0 0 0 1px rgba(10,15,12,0.06)",
                }
              : { background: "rgba(128,134,130,0.75)", color: "rgba(250,250,250,0.95)" }
          }
        >
          {view.achieved ? copy(`achievements.tier.${view.name}`) : copy("achievements.modal.locked")}
        </span>
        {view.achieved && viewDate ? (
          <span className="text-xs tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
            {viewDate}
          </span>
        ) : null}
      </div>
      {previewedTierIsRemote ? (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {remoteEarnedText
            ? copy("achievements.modal.remote_tier_note_value", { value: remoteEarnedText })
            : copy("achievements.modal.remote_tier_note")}
        </p>
      ) : null}

      <dl className="mt-5 w-full space-y-3 border-t border-oai-gray-200/70 pt-4 text-left dark:border-oai-gray-800/60">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <dt className="text-oai-gray-500 dark:text-oai-gray-400">
            {remoteRaised
              ? copy("achievements.modal.local_value_label")
              : copy("achievements.modal.value_label")}
          </dt>
          <dd className="font-mono font-semibold tabular-nums text-oai-black dark:text-white">{valueText}</dd>
        </div>
        {earned ? (
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-oai-gray-500 dark:text-oai-gray-400">{copy("achievements.modal.unlock_date")}</dt>
            <dd className="font-mono font-semibold tabular-nums text-oai-black dark:text-white">
              {achievedDate || copy("achievements.modal.unlock_date_unrecorded")}
            </dd>
          </div>
        ) : null}
        {view.tier >= 1 && viewThresholdText ? (
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-oai-gray-500 dark:text-oai-gray-400">
              {copy("achievements.modal.tier_threshold", { tier: copy(`achievements.tier.${view.name}`) })}
            </dt>
            <dd className="font-mono font-semibold tabular-nums text-oai-black dark:text-white">
              {viewThresholdText}
            </dd>
          </div>
        ) : null}
        {view.viewingCurrent && !hiddenLocked && (
          <div>
            <div className="flex items-baseline justify-between gap-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              <span>
                {currentTier >= 4
                  ? copy("achievements.modal.max_tier")
                  : copy(
                      remoteRaised ? "achievements.modal.progress_to_next_local" : "achievements.modal.progress_to_next",
                      {
                        tier: copy(`achievements.tier.${nextTierName}`),
                      },
                    )}
              </span>
              {currentTier < 4 && badge.next_threshold != null ? (
                <span className="font-mono tabular-nums">
                  {/* rank counts DOWN toward the next tier — an arrow reads as
                      direction, "/" would read as a fraction */}
                  {valueText} {badge.lower_is_better ? "→" : "/"}{" "}
                  {formatBadgeValue(entry?.format, badge.next_threshold)}
                </span>
              ) : null}
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-800">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.round((currentTier >= 4 ? 1 : progress) * 100)}%`,
                  background: earned
                    ? `linear-gradient(90deg, ${TIER_PALETTE[tName].rim[0]} 0%, ${TIER_PALETTE[tName].ring} 55%, ${TIER_PALETTE[tName].rim[1]} 100%)`
                    : "rgba(128,134,130,0.75)",
                  boxShadow: earned ? "inset 0 1px 1px rgba(255,255,255,0.35)" : undefined,
                }}
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          <span>{copy("achievements.modal.tier_history")}</span>
          <TierTrack badge={badge} viewTier={view.tier} onSelect={setViewTier} />
        </div>
      </dl>
    </div>
  );
}

const POPUP_CLASS = cn(
  "relative w-full max-w-[380px] flex flex-col",
  "rounded-2xl bg-white dark:bg-oai-gray-950",
  "shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_60px_-10px_rgba(0,0,0,0.65)]",
  "ring-1 ring-oai-gray-200 dark:ring-oai-gray-800 overflow-hidden",
  "dark:border-t dark:border-white/[0.08]",
);

/**
 * Badge detail dialog with the rotatable 3D coin.
 *
 * Web/macOS: base-ui Dialog portaled to <body> — REQUIRED because the opener
 * may live inside the profile modal's `cost-modal-popup`, whose transform
 * would otherwise turn a fixed overlay into a clipped, popup-relative box.
 * z-[110]/z-[120] stack above the profile modal (z-100/z-[101]).
 *
 * Windows WebView2: body portals with position:fixed break the transparent
 * composition (see TrendMonitorZoomModal), so render inline. Inside the
 * profile popup the transformed ancestor then bounds the overlay to the
 * popup box — acceptable there; on the achievements page it covers the
 * viewport.
 */
export function BadgeDetailModal({ badge, onClose }) {
  const inline = isNativeWindowsApp();
  const isOpen = Boolean(badge);

  useEffect(() => {
    if (!inline || !isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [inline, isOpen, onClose]);

  if (!isOpen) return null;

  if (inline) {
    return (
      <div className="tt-achievements-modal fixed inset-0 z-[120] flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          onClick={onClose}
          aria-hidden
        />
        <div className={POPUP_CLASS}>
          <BadgeDetailBody key={badge.id} badge={badge} onClose={onClose} />
        </div>
      </div>
    );
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="cost-modal-backdrop z-[110]" />
        <Dialog.Viewport className="tt-achievements-modal fixed inset-0 z-[120] flex items-center justify-center p-4">
          <Dialog.Popup className={cn("cost-modal-popup", POPUP_CLASS)}>
            <Dialog.Title render={<h2 className="sr-only" />}>
              {(BADGE_BY_ID.get(badge.id)?.hidden && (badge.tier || 0) < 1)
                ? copy("achievements.hidden.name")
                : copy(badgeCopyKey(badge.id, "name"))}
            </Dialog.Title>
            <BadgeDetailBody key={badge.id} badge={badge} onClose={onClose} />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default BadgeDetailModal;
