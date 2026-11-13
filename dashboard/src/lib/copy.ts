import copyRegistry from "virtual:tokentracker-copy-registry";
import {
  DE_LOCALE,
  getInitialLocalePreference,
  normalizeResolvedLocale,
  resolvePreferredLocale,
  JA_LOCALE,
  KO_LOCALE,
  ZH_CN_LOCALE,
  ZH_TW_LOCALE,
} from "./locale";

// 语言包按语言拆分为独立 chunk（2026-11-13 性能批）：原来 5 种语言 + copy.csv
// 打进同一个 906KB 模块，首屏全量解析；现在 copy() 仍是同步 API，但注册表在
// 首次使用该语言时异步加载（bootstrap 会先确保默认语言就位再挂载 React，
// 语言切换走 ensureCopyLocale → setCopyLocale 两段）。
type AnyRecord = Record<string, any>;
type TranslationRegistry = Record<string, string>;

const LOCALE_LOADERS: Record<string, () => Promise<{ default: TranslationRegistry }>> = {
  [ZH_CN_LOCALE]: () => import("./i18n-registry/zh"),
  [ZH_TW_LOCALE]: () => import("./i18n-registry/zh-tw"),
  [JA_LOCALE]: () => import("./i18n-registry/ja"),
  [KO_LOCALE]: () => import("./i18n-registry/ko"),
  [DE_LOCALE]: () => import("./i18n-registry/de"),
};

const loadedRegistries: Record<string, TranslationRegistry> = {};
const pendingLoads: Record<string, Promise<TranslationRegistry>> = {};

let currentLocale = resolvePreferredLocale(getInitialLocalePreference());

/**
 * 确保某个语言包已加载（幂等、并发去重）。返回该语言的注册表。
 * 未识别的语言返回空表（copy() 会回退到 copy.csv 的英文原文）。
 */
export async function ensureCopyLocale(locale: any): Promise<TranslationRegistry> {
  const normalized = normalizeResolvedLocale(locale);
  if (loadedRegistries[normalized]) return loadedRegistries[normalized];
  const loader = LOCALE_LOADERS[normalized];
  if (!loader) return {};
  if (!pendingLoads[normalized]) {
    pendingLoads[normalized] = loader()
      .then((mod) => {
        loadedRegistries[normalized] = mod.default || {};
        return loadedRegistries[normalized];
      })
      .finally(() => {
        delete pendingLoads[normalized];
      });
  }
  return pendingLoads[normalized];
}

/** 预热（不阻塞）：用于系统语言变化等「稍后会用到」的场景。 */
export function preloadCopyLocale(locale: any) {
  void ensureCopyLocale(locale).catch(() => {});
}

function getLocaleRegistry() {
  return (loadedRegistries[currentLocale] || {}) as TranslationRegistry;
}

function getTranslatedText(key: any) {
  const value = getLocaleRegistry()[String(key)];
  return typeof value === "string" && value.trim() ? value : null;
}

function interpolate(text: any, params?: AnyRecord) {
  if (!params) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (match: string, key: string) => {
    if (params[key] == null) return match;
    return String(params[key]);
  });
}

function normalizeText(text: any) {
  return String(text).replace(/\\n/g, "\n");
}

export function setCopyLocale(locale: any) {
  currentLocale = normalizeResolvedLocale(locale);
}

// The resolved locale that copy() is currently translating into. Mirrors the
// same module-level state copy() reads, so components can localize non-string
// output (e.g. date-fns formatting) without depending on LocaleProvider context.
export function getCopyLocale() {
  return currentLocale;
}

export function copy(key: any, params?: AnyRecord) {
  const normalizedKey = String(key);
  const baseText = Object.hasOwn(copyRegistry, normalizedKey)
    ? copyRegistry[normalizedKey]
    : undefined;
  if (typeof baseText !== "string" && import.meta?.env?.DEV) {
    console.warn(`Missing copy key: ${normalizedKey}`);
  }
  const text = getTranslatedText(normalizedKey) || baseText || normalizedKey;
  return interpolate(normalizeText(text), params);
}
