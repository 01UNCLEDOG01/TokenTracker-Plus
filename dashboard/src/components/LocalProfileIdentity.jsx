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
import { useEquippedTitle, titleDisplayName, getAvatarResonanceFrame } from "../ui/achievements/title-registry";
import { EquippedTitleBadge } from "../ui/achievements/EquippedTitleBadge";

function LocalAvatar({ name, avatarDataUrl, size = 28, equippedTitle }) {
  const initial = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  const style = { width: size, height: size };
  const resonanceTier = equippedTitle?.resonanceTier || equippedTitle?.resonance?.tier || 0;
  const ringClass = equippedTitle
    ? getAvatarResonanceFrame(resonanceTier, equippedTitle.theme)
    : "ring-1 ring-oai-gray-200 dark:ring-oai-gray-700";

  if (avatarDataUrl) {
    return (
      <div className="relative shrink-0">
        <img
          src={avatarDataUrl}
          alt=""
          style={style}
          className={cn("shrink-0 rounded-full object-cover", ringClass)}
        />
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
  return (
    <div className="relative shrink-0">
      <span
        style={style}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-oai-gray-200 text-[11px] font-semibold text-oai-gray-700 dark:bg-oai-gray-800 dark:text-oai-gray-200",
          ringClass
        )}
        aria-hidden
      >
        {initial}
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

  return (
    <Link
      to="/settings"
      title={collapsed ? title : undefined}
      aria-label={copy("localProfile.openSettings", { name })}
      data-testid="local-profile-identity"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 no-underline transition-colors hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500",
        collapsed && "justify-center px-0 py-2"
      )}
    >
      <LocalAvatar name={name} avatarDataUrl={profile.avatarDataUrl} equippedTitle={equippedTitle} />
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="truncate text-[13px] font-medium text-oai-gray-800 dark:text-oai-gray-200">
              {name}
            </span>
          </span>
          {equippedTitle ? (
            <div className="mt-0.5">
              <EquippedTitleBadge title={equippedTitle} size="xs" />
            </div>
          ) : (
            <span className="block truncate font-mono text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
              {id || copy("localProfile.localIdFallback")}
            </span>
          )}
        </span>
      )}
    </Link>
  );
}

export function LocalProfileAvatar({ profile, name, size = 44, equippedTitle }) {
  return <LocalAvatar name={name} avatarDataUrl={profile?.avatarDataUrl} size={size} equippedTitle={equippedTitle} />;
}

export default LocalProfileIdentity;
