import React, { createContext, useCallback, useLayoutEffect, useMemo, useState } from "react";
import { ensureCopyLocale, preloadCopyLocale, setCopyLocale } from "../../lib/copy";
import {
  getInitialLocalePreference,
  normalizeLocalePreference,
  persistLocalePreference,
  resolvePreferredLocale,
  SYSTEM_LOCALE,
} from "../../lib/locale";
import { isNativeEmbed, setNativeSetting } from "../../lib/native-bridge.js";

export const LocaleContext = createContext(null);

function getInitialResolvedLocale() {
  return resolvePreferredLocale(getInitialLocalePreference());
}

function applyDocumentLanguage(locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

function syncResolvedLocale(locale, setResolvedLocale) {
  setCopyLocale(locale);
  setResolvedLocale((prev) => (prev === locale ? prev : locale));
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(getInitialLocalePreference);
  const [resolvedLocale, setResolvedLocale] = useState(getInitialResolvedLocale);

  useLayoutEffect(() => {
    applyDocumentLanguage(resolvedLocale);
  }, [resolvedLocale]);

  useLayoutEffect(() => {
    if (!isNativeEmbed()) return;
    setNativeSetting("locale", locale);
  }, [locale]);

  useLayoutEffect(() => {
    if (locale !== SYSTEM_LOCALE || typeof window === "undefined") return undefined;
    const handleChange = () => {
      const next = resolvePreferredLocale(SYSTEM_LOCALE);
      void ensureCopyLocale(next).then(() => syncResolvedLocale(next, setResolvedLocale));
    };
    window.addEventListener("languagechange", handleChange);
    return () => window.removeEventListener("languagechange", handleChange);
  }, [locale]);

  const setLocale = useCallback((value) => {
    const next = normalizeLocalePreference(value);
    const resolved = resolvePreferredLocale(next);
    setLocaleState(next);
    persistLocalePreference(next);
    if (isNativeEmbed()) {
      setNativeSetting("locale", next);
    }
    // 语言包按需加载：先预热新语言，加载完再应用（期间界面保持旧语言）。
    preloadCopyLocale(resolved);
    void ensureCopyLocale(resolved).then(() => syncResolvedLocale(resolved, setResolvedLocale));
  }, []);

  const contextValue = useMemo(
    () => ({ locale, setLocale, resolvedLocale }),
    [locale, resolvedLocale, setLocale],
  );

  return <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>;
}
