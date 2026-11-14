/** Canonical usage-limits provider ids (order defaults in useLimitsDisplayPrefs). */
export declare const LIMIT_PROVIDER_IDS: readonly string[];

/** ProviderIcon key per limits provider (mono inline SVG or /brand-logos/). */
export declare const LIMIT_PROVIDER_ICON_KEYS: Readonly<Record<string, string>>;

export declare function limitProviderIconKey(id: string): string | null;

export declare function limitProviderName(id: string): string;
