import React, { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { copy } from "../../lib/copy";
import {
  readAvatarFile,
  resolveLocalDisplayName,
  useLocalMachineIdentity,
  useLocalProfile,
  writeLocalProfile,
} from "../../lib/local-profile";
import { Button } from "../../ui/components/Button.jsx";
import { LocalProfileAvatar } from "../LocalProfileIdentity.jsx";
import { SectionCard, SettingsRow } from "./Controls.jsx";

const NAME_MAX_LENGTH = 40;

function avatarErrorMessage(error) {
  switch (error?.message) {
    case "invalid_type":
      return copy("localProfile.avatar.invalidType");
    case "too_large":
      return copy("localProfile.avatar.tooLarge");
    case "unsupported":
      return copy("localProfile.avatar.unsupported");
    default:
      return copy("localProfile.avatar.failed");
  }
}

function CopyIdButton({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const handleCopy = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(value);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={handleCopy} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span>{copied ? copy("settings.account.copied") : copy("settings.account.copy")}</span>
    </Button>
  );
}

/** Editable local identity for the single-machine build. No cloud account. */
export function LocalProfileSection() {
  const profile = useLocalProfile();
  const identity = useLocalMachineIdentity();
  const [nameInput, setNameInput] = useState(profile.displayName);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const displayName = resolveLocalDisplayName(profile, identity, copy("localProfile.defaultName"));
  const dirty = nameInput.trim() !== profile.displayName;

  useEffect(() => {
    setNameInput(profile.displayName);
  }, [profile.displayName]);

  const handleSaveName = () => {
    writeLocalProfile({ ...profile, displayName: nameInput });
    setError("");
    setSaved(true);
    globalThis.setTimeout(() => setSaved(false), 1500);
  };

  const handleAvatarFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const avatarDataUrl = await readAvatarFile(file);
      writeLocalProfile({ ...profile, avatarDataUrl });
      setError("");
    } catch (err) {
      setError(avatarErrorMessage(err));
    }
  };

  return (
    <SectionCard
      title={copy("settings.section.account")}
      subtitle={copy("settings.section.account.localDescription")}
    >
      <SettingsRow
        label={copy("settings.account.avatar")}
        hint={copy("settings.account.avatarLocalHint")}
        control={
          <div className="flex items-center gap-3">
            <LocalProfileAvatar profile={profile} name={displayName} />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarFile}
            />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
              {copy("settings.account.uploadAvatar")}
            </Button>
            {profile.avatarDataUrl ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => writeLocalProfile({ ...profile, avatarDataUrl: null })}
              >
                {copy("settings.account.removeAvatar")}
              </Button>
            ) : null}
          </div>
        }
      />
      <SettingsRow
        label={copy("settings.account.displayName")}
        hint={copy("settings.account.localNameHint")}
        control={
          <div className="flex items-center gap-2">
            <input
              value={nameInput}
              maxLength={NAME_MAX_LENGTH}
              onChange={(event) => { setNameInput(event.target.value); setSaved(false); }}
              onKeyDown={(event) => { if (event.key === "Enter") handleSaveName(); }}
              placeholder={identity.deviceName || copy("localProfile.defaultName")}
              aria-label={copy("settings.account.displayName")}
              className="h-9 w-[min(16rem,45vw)] rounded-md border border-oai-gray-200 bg-white px-3 text-sm text-oai-gray-900 outline-none transition-colors placeholder:text-oai-gray-400 focus:border-oai-gray-400 focus:ring-2 focus:ring-oai-brand-500/30 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100 dark:placeholder:text-oai-gray-500"
            />
            <Button variant="secondary" size="sm" onClick={handleSaveName} disabled={!dirty}>
              {copy(saved ? "settings.account.saved" : "settings.account.save")}
            </Button>
          </div>
        }
      />
      <SettingsRow
        label={copy("settings.account.localId")}
        hint={<span className="break-all font-mono">{identity.machineId || "—"}</span>}
        control={<CopyIdButton value={identity.machineId} />}
      />
      {error ? (
        <p role="alert" className="px-4 pb-3 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </SectionCard>
  );
}

export default LocalProfileSection;
