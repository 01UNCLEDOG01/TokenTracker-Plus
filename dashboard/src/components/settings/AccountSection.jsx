import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, LogOut } from "lucide-react";
import { copy } from "../../lib/copy";
import { useAccountProfileSettings } from "./useAccountProfileSettings.js";
import { PublicProfileFields, SignedOutAccountSection } from "./AccountSectionParts.jsx";
import { SectionCard, SettingsRow, ToggleSwitch } from "./Controls.jsx";
import { Button } from "../../ui/components/Button.jsx";

export function AccountSection({ settings } = {}) {
  return settings ? <AccountProfileSection settings={settings} /> : <StandaloneAccountSection />;
}

function StandaloneAccountSection() {
  const settings = useAccountProfileSettings();
  return <AccountProfileSection settings={settings} />;
}

function AccountProfileSection({ settings }) {
  if (!settings.enabled) return null;
  if (!settings.signedIn) { return <SignedOutAccountSection />; }

  return (
    <SectionCard
      title={copy("settings.section.account")}
      subtitle={settings.email || (settings.name.customDisplayName || settings.name.displayName)}
      action={<SignOutButton onSignOut={settings.signOut} />}
    >
      <UserIdRow userId={settings.userId} />
      <PublicProfileToggleRow
        checked={settings.publicProfileOn}
        disabled={settings.profileLoading || settings.profileSaving || settings.publicProfileAvailable === false}
        onChange={settings.handlePublicProfileToggle}
        unavailable={settings.publicProfileAvailable === false}
      />
      <PublicProfileDetails visible={settings.publicProfileOn} name={settings.name} github={settings.github} avatar={settings.avatar} />
      <CloudSyncRow settings={settings} />
    </SectionCard>
  );
}

// 2026-11-16 恢复：云同步开关的渲染层在设置重构时被删（useCloudSyncControl 成了
// 死代码，本机宿主下两端都没有任何 UI 能开同步——mac 端新装因此永远不上传）。
// 按 v1.10.5 之前 CloudSection.jsx 的旧行为最小复植进账号区，文案键新登记。
function CloudSyncRow({ settings }) {
  if (!settings.showLocalCloudSync) return null;
  return (
    <>
      <SettingsRow
        label={copy("settings.account.cloudSync")}
        hint={copy(settings.cloudSyncOn ? "settings.account.cloudSyncOnHint" : "settings.account.cloudSyncOffHint")}
        control={
          <ToggleSwitch
            checked={settings.cloudSyncOn}
            disabled={settings.cloudSyncPending}
            onChange={() => (settings.cloudSyncOn ? settings.handleCloudSyncDisable() : settings.handleCloudSyncToggle())}
            ariaLabel={copy("settings.account.cloudSync")}
          />
        }
      />
      {settings.cloudSyncOn && settings.cloudSyncPending ? (
        <p role="status" className="pb-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.account.cloudSyncPending")}
        </p>
      ) : null}
      {settings.cloudSyncOn && settings.cloudSyncError && !settings.cloudSyncPending ? (
        <p role="alert" className="pb-2 text-xs text-red-600 dark:text-red-400">
          {copy("settings.account.cloudSyncError")}
          <button
            type="button"
            onClick={settings.handleCloudSyncRetry}
            className="ml-2 underline underline-offset-2"
          >
            {copy("settings.account.cloudSyncRetry")}
          </button>
        </p>
      ) : null}
    </>
  );
}

function UserIdRow({ userId }) {
  const [copied, setCopied] = React.useState(false);
  if (!userId) return null;

  const handleCopy = async () => {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(userId);
      setCopied(true);
      globalThis.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <SettingsRow
      label={copy("settings.account.userId")}
      hint={<span className="font-mono">{userId}</span>}
      control={
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          aria-label={copy("settings.account.copyUserId")}
          className="gap-1.5"
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          <span>{copied ? copy("settings.account.copied") : copy("settings.account.copy")}</span>
        </Button>
      }
    />
  );
}

function SignOutButton({ onSignOut }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onSignOut()}
      className="!h-7 !px-2 text-xs text-oai-gray-500 hover:text-oai-gray-700 dark:hover:text-oai-gray-300"
    >
      <LogOut className="h-3.5 w-3.5 mr-1.5" aria-hidden />
      <span>{copy("settings.account.signOut")}</span>
    </Button>
  );
}

function PublicProfileToggleRow({ checked, disabled, onChange, unavailable }) {
  return (
    <SettingsRow
      label={copy("settings.account.publicProfile")}
      hint={copy(unavailable ? "cloud.self_host.public_profile_disabled" : "settings.account.publicProfileHint")}
      control={
        <ToggleSwitch
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          ariaLabel={copy("settings.account.publicProfile")}
        />
      }
    />
  );
}

function PublicProfileDetails({ visible, name, github, avatar }) {
  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          key="public-profile-fields"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
            opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
          }}
          style={{ overflow: "hidden" }}
          className="divide-y divide-oai-gray-200/60 dark:divide-oai-gray-800/60"
        >
          <PublicProfileFields name={name} github={github} avatar={avatar} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
