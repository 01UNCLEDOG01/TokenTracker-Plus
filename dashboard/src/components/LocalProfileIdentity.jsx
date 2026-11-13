import React from "react";
import { Link } from "react-router-dom";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";
import {
  localIdShort,
  resolveLocalDisplayName,
  useLocalMachineIdentity,
  useLocalProfile,
} from "../lib/local-profile";
import {
  useEquippedTitle,
  titleDisplayName,
  getAvatarResonanceFrame,
  getAvatarFramePulseClass,
} from "../ui/achievements/title-registry";
import { EquippedTitleBadge } from "../ui/achievements/EquippedTitleBadge";

function LocalAvatar({ name, avatarDataUrl, size = 28, equippedTitle }) {
  const initial = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  const style = { width: size, height: size };
  const resonanceTier = equippedTitle?.resonanceTier || equippedTitle?.resonance?.tier || 0;
  const ringClass = equippedTitle
    ? getAvatarResonanceFrame(resonanceTier, equippedTitle.theme)
    : "ring-1 ring-oai-gray-200 dark:ring-oai-gray-700";
  // 闪烁只挂独立叠层，头像本体不动（站主 2026-11-13）。
  const pulseClass = equippedTitle ? getAvatarFramePulseClass(resonanceTier) : null;

  return (
    <div className="relative shrink-0">
      <span style={style} className={cn("relative flex items-center justify-center rounded-full", ringClass)}>
        {avatarDataUrl ? (
          <img
            src={avatarDataUrl}
            alt=""
            style={style}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span
            style={style}
            className="inline-flex h-full w-full shrink-0 items-center justify-center rounded-full bg-oai-gray-200 text-[11px] font-semibold text-oai-gray-700 dark:bg-oai-gray-800 dark:text-oai-gray-200"
            aria-hidden
          >
            {initial}
          </span>
        )}
        {pulseClass && (
          <span
            aria-hidden
            className={cn("pointer-events-none absolute -inset-0.5 rounded-full", pulseClass)}
          />
        )}
      </span>
      {equippedTitle && (
        <img
          src={equippedTitle.art}
          alt={equippedTitle.name}
          className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full object-contain filter drop-shadow-sm ring-1 ring-black"
        />
      )}
    </div>
  );
}

/** Sidebar identity for the single-machine build: local avatar + name + ID + equipped title. */
export function LocalProfileIdentity({ collapsed = false }) {
  const profile = useLocalProfile();
  const identity = useLocalMachineIdentity();
  const equippedTitle = useEquippedTitle();
  const name = resolveLocalDisplayName(profile, identity, copy("localProfile.defaultName"));
  const id = localIdShort(identity.machineId);
  const titleParts = [name, equippedTitle ? `【${titleDisplayName(equippedTitle)}】` : null, identity.machineId].filter(Boolean);
  const title = titleParts.join(" · ");

  if (collapsed) {
    return (
      <Link
        to="/settings?section=account"
        title={title}
        aria-label={copy("localProfile.openSettings", { name })}
        data-testid="local-profile-identity"
        className="flex min-w-0 items-center justify-center rounded-md px-0 py-2 no-underline transition-colors hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
      >
        <LocalAvatar name={name} avatarDataUrl={profile.avatarDataUrl} equippedTitle={equippedTitle} />
      </Link>
    );
  }

  return (
    <div
      data-testid="local-profile-identity"
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800"
    >
      {/* 头像/名字 → 设置·账户；称号徽章单独跳成就页（两者不能嵌套，故并列）。 */}
      <Link
        to="/settings?section=account"
        aria-label={copy("localProfile.openSettings", { name })}
        className="shrink-0 rounded-full no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
      >
        <LocalAvatar name={name} avatarDataUrl={profile.avatarDataUrl} equippedTitle={equippedTitle} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to="/settings?section=account"
          className="block truncate rounded text-left text-[13px] font-medium text-oai-gray-800 no-underline dark:text-oai-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
        >
          {name}
        </Link>
        {equippedTitle ? (
          <Link
            to="/achievements"
            aria-label={copy("nav.achievements")}
            title={`${copy("nav.achievements")} · ${titleDisplayName(equippedTitle)}`}
            className="mt-0.5 inline-flex max-w-full rounded-full no-underline align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
          >
            <EquippedTitleBadge title={equippedTitle} size="xs" showIcon={false} />
          </Link>
        ) : (
          <span className="block truncate font-mono text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
            {id || copy("localProfile.localIdFallback")}
          </span>
        )}
      </div>
    </div>
  );
}

export function LocalProfileAvatar({ profile, name, size = 44, equippedTitle }) {
  return <LocalAvatar name={name} avatarDataUrl={profile?.avatarDataUrl} size={size} equippedTitle={equippedTitle} />;
}

export default LocalProfileIdentity;
