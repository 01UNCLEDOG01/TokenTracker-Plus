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

function LocalAvatar({ name, avatarDataUrl, size = 28 }) {
  const initial = String(name || "?").trim().charAt(0).toUpperCase() || "?";
  const style = { width: size, height: size };
  if (avatarDataUrl) {
    return (
      <img
        src={avatarDataUrl}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover ring-1 ring-oai-gray-200 dark:ring-oai-gray-700"
      />
    );
  }
  return (
    <span
      style={style}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-oai-gray-200 text-[11px] font-semibold text-oai-gray-700 dark:bg-oai-gray-800 dark:text-oai-gray-200"
      aria-hidden
    >
      {initial}
    </span>
  );
}

/** Sidebar identity for the single-machine build: local avatar + name + ID. */
export function LocalProfileIdentity({ collapsed = false }) {
  const profile = useLocalProfile();
  const identity = useLocalMachineIdentity();
  const name = resolveLocalDisplayName(profile, identity, copy("localProfile.defaultName"));
  const id = localIdShort(identity.machineId);
  const title = [name, identity.machineId].filter(Boolean).join(" · ");

  return (
    <Link
      to="/settings"
      title={collapsed ? title : undefined}
      aria-label={copy("localProfile.openSettings", { name })}
      data-testid="local-profile-identity"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 no-underline transition-colors hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500",
        collapsed && "justify-center px-0 py-2",
      )}
    >
      <LocalAvatar name={name} avatarDataUrl={profile.avatarDataUrl} />
      {!collapsed && (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-oai-gray-800 dark:text-oai-gray-200">
            {name}
          </span>
          <span className="block truncate font-mono text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
            {id || copy("localProfile.localIdFallback")}
          </span>
        </span>
      )}
    </Link>
  );
}

export function LocalProfileAvatar({ profile, name, size = 44 }) {
  return <LocalAvatar name={name} avatarDataUrl={profile?.avatarDataUrl} size={size} />;
}

export default LocalProfileIdentity;
