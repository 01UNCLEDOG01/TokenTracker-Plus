import { useCallback, useEffect, useState } from "react";

// Opt-in toggle for the Claude IP Check sidebar entry. Default OFF = the nav
// item is hidden (站主 2026-11-15); the page itself stays reachable at
// /ip-check via direct link. Persisted under the tt.* localStorage namespace
// alongside tt.sidebarCollapsed etc. The Labs toggle lives on a different
// route than the Sidebar, so both the storage event and a same-tab custom
// event keep them in sync.
export const IP_CHECK_NAV_PREF_KEY = "tt.nav.ipCheck.enabled";
export const IP_CHECK_NAV_PREF_EVENT = "tt:nav-ipcheck-changed";

function readEnabled() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(IP_CHECK_NAV_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function useIpCheckNavPref() {
  const [enabled, setEnabledState] = useState(readEnabled);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onStorage = (e) => {
      if (e.key === null || e.key === IP_CHECK_NAV_PREF_KEY) setEnabledState(readEnabled());
    };
    const onCustom = () => setEnabledState(readEnabled());
    window.addEventListener("storage", onStorage);
    window.addEventListener(IP_CHECK_NAV_PREF_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(IP_CHECK_NAV_PREF_EVENT, onCustom);
    };
  }, []);

  const toggle = useCallback(() => {
    setEnabledState((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(IP_CHECK_NAV_PREF_KEY, next ? "1" : "0");
          window.dispatchEvent(new Event(IP_CHECK_NAV_PREF_EVENT));
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { enabled, toggle };
}
