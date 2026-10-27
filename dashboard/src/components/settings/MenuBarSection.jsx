import React from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, Download } from "lucide-react";
import { useNativeSettings } from "../../hooks/use-native-settings.js";
import { useLocale } from "../../hooks/useLocale.js";
import { ConfirmModal } from "../../ui/components";
import { showToast } from "../../ui/components/Toast.jsx";
import { STATUSPAGE_URL, LATEST_RELEASE_API_URL } from "../../lib/config";
import { copy } from "../../lib/copy";
import { isNativeWindowsApp } from "../../lib/native-bridge.js";
import { SectionCard, SettingsRow, ToggleSwitch } from "./Controls.jsx";
import { Button } from "../../ui/components/Button.jsx";

export function MenuBarSection() {
  const { available, settings, setSetting, runAction } = useNativeSettings();
  if (!available) return null;
  const isWindows = isNativeWindowsApp();

  // showStats + animatedIcon live on the Widgets page (Menu Bar section) where
  // they sit next to the live preview. This section keeps only the system-level
  // toggles + actions that don't have a visual analogue.
  const launchAtLogin = Boolean(settings?.launchAtLogin);
  const toastOnReset = settings?.toastOnReset !== false;
  const confettiOnReset = settings?.confettiOnReset !== false;
  const launchAtLoginSupported = settings?.launchAtLoginSupported !== false;
  const updateStatus = settings?.updateStatus || null;
  const updateBusy = Boolean(settings?.updateBusy);

  return (
    <SectionCard title={copy("settings.section.menubar")}>
      {!isWindows ? (
        <>
          <SettingsRow
            label={copy("settings.menubar.appearance")}
            hint={copy("settings.menubar.appearanceHint")}
            control={
              <Button
                as={Link}
                to="/widgets"
                variant="secondary"
                size="sm"
                className="gap-1.5 no-underline"
              >
                <span>{copy("settings.menubar.appearanceLink")}</span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Button>
            }
          />
          <SettingsRow
            label={copy("settings.menubar.toastOnReset")}
            hint={copy("settings.menubar.toastOnResetHint")}
            control={
              <ToggleSwitch
                checked={toastOnReset}
                onChange={() => setSetting("toastOnReset", !toastOnReset)}
                ariaLabel={copy("settings.menubar.toastOnReset")}
              />
            }
          />
          <SettingsRow
            label={copy("settings.menubar.confettiOnReset")}
            hint={copy("settings.menubar.confettiOnResetHint")}
            control={
              <ToggleSwitch
                checked={confettiOnReset}
                onChange={() => setSetting("confettiOnReset", !confettiOnReset)}
                ariaLabel={copy("settings.menubar.confettiOnReset")}
              />
            }
          />
        </>
      ) : null}
      {launchAtLoginSupported ? (
        <SettingsRow
          label={copy("settings.menubar.launchAtLogin")}
          hint={copy("settings.menubar.launchAtLoginHint")}
          control={
            <ToggleSwitch
              checked={launchAtLogin}
              onChange={() => setSetting("launchAtLogin", !launchAtLogin)}
              ariaLabel={copy("settings.menubar.launchAtLogin")}
            />
          }
        />
      ) : null}
      <SettingsRow
        label={copy("settings.menubar.updates")}
        hint={updateStatus || undefined}
        control={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runAction("checkForUpdates")}
            disabled={updateBusy}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            <span>{copy("settings.menubar.checkUpdates")}</span>
          </Button>
        }
      />
    </SectionCard>
  );
}

function hasUpdate(current, latest) {
  function parseParts(v) {
    // Release tags here carry a name prefix (`plus-v1.2.0`), not just `v`, so
    // take the dotted number run out of the middle instead of stripping a
    // leading v — the old version parsed "plus-v1" to NaN and only compared
    // correctly by accident.
    const match = String(v || "").match(/(\d+(?:\.\d+)*)/);
    return match ? match[1].split(".").map(Number) : [];
  }
  const currParts = parseParts(current);
  const lateParts = parseParts(latest);
  for (let i = 0; i < Math.max(currParts.length, lateParts.length); i++) {
    const curr = currParts[i] || 0;
    const late = lateParts[i] || 0;
    if (curr < late) return true;
    if (curr > late) return false;
  }
  return false;
}

export function NativeAppFooter() {
  const { available, settings, runAction } = useNativeSettings();
  const showNativeInfo = available && settings?.version;
  const nativePlatform = settings?.platform || "macos";
  const [checking, setChecking] = React.useState(false);
  const [updateModal, setUpdateModal] = React.useState({
    notes: "",
    open: false,
    latestVersion: "",
    htmlUrl: "",
  });
  const { resolvedLocale } = useLocale();
  const currentVersion = import.meta.env.VITE_APP_VERSION || "0.64.2";

  const handleCheckUpdates = async () => {
    setChecking(true);
    try {
      const res = await fetch(LATEST_RELEASE_API_URL);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const latestVersion = data.tag_name;

      if (hasUpdate(currentVersion, latestVersion)) {
        setUpdateModal({
          open: true,
          latestVersion,
          htmlUrl: data.html_url,
          // Information-only: the modal shows the upstream release and
          // what changed; installing stays a deliberate, out-of-band act.
          notes: typeof data.body === "string" ? data.body.slice(0, 1200) : "",
        });
      } else {
        showToast({
          title: copy("settings.menubar.updates.upToDate"),
        });
      }
    } catch (err) {
      console.error("Check updates failed:", err);
      showToast({
        title: copy("settings.menubar.updates.failed"),
      });
    } finally {
      setChecking(false);
    }
  };

  const modalTitle = copy("settings.menubar.updates.modalTitle");
  const modalDescription = copy("settings.menubar.updates.modalDescription", {
    version: updateModal.latestVersion,
  });
  const modalConfirm = copy("settings.menubar.updates.modalConfirm");
  const modalCancel = copy("settings.menubar.updates.modalCancel");

  return (
    <div className="mt-6 flex flex-col items-center justify-center gap-4 text-xs text-oai-gray-500 dark:text-oai-gray-500">
      <div className="flex flex-wrap items-center justify-center gap-2">
        {showNativeInfo ? (
          <>
            <span>
              {nativePlatform === "windows"
                ? copy("settings.menubar.updates.footerCore", { version: settings.version })
                : copy("settings.menubar.updates.footerCombined", {
                    barVersion: settings.version,
                    coreVersion: currentVersion,
                  })}
            </span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => runAction("openAbout")}
              className="underline-offset-2 transition-colors hover:text-oai-gray-700 hover:underline dark:hover:text-oai-gray-300"
            >
              GitHub
            </button>
            <span aria-hidden>·</span>
          </>
        ) : (
          <>
            <span>{copy("settings.menubar.updates.footerCore", { version: currentVersion })}</span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={handleCheckUpdates}
              disabled={checking}
              className="underline-offset-2 transition-colors hover:text-oai-gray-700 hover:underline dark:hover:text-oai-gray-300 disabled:opacity-50"
            >
              {checking ? copy("settings.menubar.updates.checking") : copy("settings.menubar.checkUpdates")}
            </button>
            <span aria-hidden>·</span>
          </>
        )}
        <a
          href={STATUSPAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 underline-offset-2 transition-colors hover:text-oai-gray-700 hover:underline dark:hover:text-oai-gray-300"
        >
          <Activity className="h-3.5 w-3.5" aria-hidden />
          {copy("settings.footer.statusPage")}
        </a>
      </div>

      {updateModal.open && updateModal.notes ? (
        <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-oai-gray-200 bg-oai-gray-50 p-3 text-left text-xs text-oai-gray-600 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300">
          {updateModal.notes}
        </pre>
      ) : null}
      <ConfirmModal
        open={updateModal.open}
        title={modalTitle}
        description={modalDescription}
        confirmLabel={modalConfirm}
        cancelLabel={modalCancel}
        onConfirm={() => {
          window.open(updateModal.htmlUrl, "_blank");
          setUpdateModal((prev) => ({ ...prev, open: false }));
        }}
        onCancel={() => setUpdateModal((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
