import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  allowInsforgeSessionRestore,
  getInsforgeConfigurationError,
  getInsforgeConnectionHost,
  getOrCreateInsforgeClient,
  INSFORGE_INSTANCE_CHANGED_EVENT,
  isCloudInsforgeConfigured,
  isCurrentInsforgeClient,
  isOfficialInsforgeInstance,
  shouldRestoreInsforgeSession,
} from "../lib/insforge-config";
import { clearCloudDeviceSession, setCloudUsageReady } from "../lib/cloud-sync-prefs";
import { isLikelyExpiredAccessToken } from "../lib/auth-token";
import { getPublicVisibility, invalidateAccountResponseCache } from "../lib/api";
import { clearLocalApiAuthToken } from "../lib/local-api-auth";
import { copy } from "../lib/copy";
import { getNativeOAuthBridge, isNativeApp, isNativeEmbed, isNativeWindowsApp } from "../lib/native-bridge.js";
import { restoreInsforgeUser } from "../lib/insforge-session-recovery.mjs";
import { clearCloudPromptBackendState, cloudPromptOwnerFromToken } from "../lib/cloud-prompt-policy.js";

const InsforgeAuthContext = createContext(null);

/** Pick a human-readable name from the InsForge user object (OAuth metadata). */
function pickDisplayNameFromUser(user) {
  if (!user || typeof user !== "object") return "";
  const meta = user.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const prof = user.profile && typeof user.profile === "object" ? user.profile : {};
  const n = meta.full_name || meta.name || prof.name || meta.user_name || meta.preferred_username;
  if (typeof n === "string" && n.trim()) return n.trim();
  if (typeof user.email === "string" && user.email.includes("@")) {
    return user.email.split("@")[0].trim() || user.email.trim();
  }
  return typeof user.email === "string" ? user.email.trim() : "";
}

/** 从 refresh 响应体取 token（SDK 可能只写 http 头、或字段名/嵌套与 saveSession 不一致） */
function accessTokenFromRefreshPayload(data) {
  if (!data || typeof data !== "object") return null;
  const d = /** @type {Record<string, unknown>} */ (data);
  const session = d.session && typeof d.session === "object" ? /** @type {Record<string, unknown>} */ (d.session) : null;
  const raw =
    (typeof d.accessToken === "string" && d.accessToken) ||
    (typeof d.access_token === "string" && d.access_token) ||
    (session && typeof session.accessToken === "string" && session.accessToken) ||
    (session && typeof session.access_token === "string" && session.access_token) ||
    null;
  return raw && raw.length > 0 ? raw : null;
}

export async function resolveInsforgeClientAccessToken(client, options = {}) {
  if (!client) return null;
  const skewMs = Math.max(0, Math.floor(Number(options.skewMs) || 60_000));
  const tm = /** @type {any} */ (client).tokenManager;
  const readToken = () => tm?.getAccessToken?.() ?? tm?.getSession?.()?.accessToken ?? null;
  const firstUsableToken = (...candidates) =>
    candidates.find((candidate) => candidate && !isLikelyExpiredAccessToken(candidate, skewMs)) ?? null;

  let token = readToken();
  if (!token || isLikelyExpiredAccessToken(token, skewMs)) {
    const { data } = await client.auth.refreshSession();
    // Some SDK/storage combinations expose the old token from tokenManager for
    // a short window after refreshSession resolves. Do not let that stale JWT
    // mask the fresh token returned in the refresh payload.
    const refreshedPayloadToken = accessTokenFromRefreshPayload(data);
    token = firstUsableToken(readToken(), refreshedPayloadToken);
    if (!token && typeof client.auth.getCurrentUser === "function") {
      try {
        await client.auth.getCurrentUser();
        token = firstUsableToken(readToken(), refreshedPayloadToken);
      } catch {
        /* ignore */
      }
    }
  }

  return token || null;
}

export function InsforgeAuthProvider({ children }) {
  const [client, setClient] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // 用户主动退出登录后，回焦补检不得把会话又恢复回来。
  const explicitlySignedOutRef = useRef(false);

  useEffect(() => {
    const changed = () => {
      setUser(null);
      setClient(null);
      setLoading(false);
      invalidateAccountResponseCache();
      clearCloudDeviceSession();
      clearLocalApiAuthToken();
      clearCloudPromptBackendState();
    };
    window.addEventListener(INSFORGE_INSTANCE_CHANGED_EVENT, changed);
    return () => window.removeEventListener(INSFORGE_INSTANCE_CHANGED_EVENT, changed);
  }, []);

  useEffect(() => {
    invalidateAccountResponseCache();
  }, [user?.id]);

  useEffect(() => {
    if (!isCloudInsforgeConfigured()) {
      setClient(null);
      setUser(null);
      setLoading(false);
      return;
    }
    setClient(getOrCreateInsforgeClient());
  }, []);

  useEffect(() => {
    if (!client) return;
    if (!shouldRestoreInsforgeSession()) {
      setUser(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await restoreInsforgeUser(client.auth, { isActive: () => active });
        if (!active) return;
        if (error) {
          setUser(null);
          return;
        }
        setUser(data?.user ?? null);
      } catch {
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [client]);

  // 冷启动竞态兜底（站主 2026-11-13：Mac 开面板每次都要重输邮箱密码）。上面的
  // 恢复链只在挂载时跑一次；本地服务还在起、或自托管实例一时不可达时那一次会
  // 落空，于是"未登录"被钉在整个窗口生命周期里——其实刷新令牌一直好着。首次恢复
  // 结束后，启动补检 + 窗口回焦/页面可见都再问一遍，恢复成功就静默登上。
  // 三条约束：①不跟首次恢复并行（否则两条链各发一次刷新，白烧一次轮换）；
  // ②自动补检按 15s→30s→60s→120s 退避且最多 6 次，实例始终不可达也不会被打爆；
  // ③明确点过「退出登录」后不再自动恢复（否则回焦等于把用户又登回去）。
  useEffect(() => {
    if (!client || user || loading) return;
    if (!shouldRestoreInsforgeSession()) return;
    const MAX_AUTO_ATTEMPTS = 6;
    const FOCUS_COALESCE_MS = 15_000;
    let active = true;
    let inFlight = false;
    let lastAttemptAt = 0;
    let failures = 0;
    let timer = null;
    const schedule = (delayMs) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; attempt(); }, delayMs);
    };
    const attempt = async () => {
      if (!active || inFlight || explicitlySignedOutRef.current) return;
      // 回焦/可见性事件会连发；一次尝试本身已带重试预算，15 秒内不重复发车。
      if (Date.now() - lastAttemptAt < FOCUS_COALESCE_MS) return;
      lastAttemptAt = Date.now();
      inFlight = true;
      let signedIn = false;
      try {
        const { data } = await restoreInsforgeUser(client.auth, { isActive: () => active });
        if (active && data?.user && !explicitlySignedOutRef.current && isCurrentInsforgeClient(client)) {
          signedIn = true;
          setUser(data.user);
        }
      } catch {
        /* stay signed out until the next attempt */
      } finally {
        inFlight = false;
      }
      if (!active || signedIn) return;
      failures += 1;
      if (failures < MAX_AUTO_ATTEMPTS) schedule(Math.min(120_000, 15_000 * 2 ** (failures - 1)));
    };
    // 用户主动回到面板：算新的一轮，清空自动补检的退避计数。
    const onWake = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      failures = 0;
      attempt();
    };
    window.addEventListener("focus", onWake);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onWake);
    // 首次恢复刚结束，嵌入式服务（以及它背后的实例）可能还没就绪。
    schedule(4000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onWake);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onWake);
    };
  }, [client, user, loading]);

  const refreshUser = useCallback(async () => {
    if (!client || !isCurrentInsforgeClient(client)) return;
    try {
      let { data, error } = await client.auth.getCurrentUser();
      if (!error && !data?.user) {
        await new Promise((r) => setTimeout(r, 150));
        const again = await client.auth.getCurrentUser();
        data = again.data;
        error = again.error;
      }
      if (error) {
        if (isCurrentInsforgeClient(client)) setUser(null);
        return;
      }
      if (isCurrentInsforgeClient(client)) setUser(data?.user ?? null);
    } catch {
      if (isCurrentInsforgeClient(client)) setUser(null);
    }
  }, [client]);

  const signInWithOAuth = useCallback(
    async (provider, redirectToOverride) => {
      if (!client || !isCurrentInsforgeClient(client)) return { error: new Error(copy("instance.configuration.changed")) };
      const nativeBridge = getNativeOAuthBridge();
      if (typeof nativeBridge?.postMessage !== "function"
        && (isNativeApp() || isNativeEmbed() || isNativeWindowsApp())) {
        return { error: new Error(copy("login.oauth.desktop_start_failed")) };
      }
      if (nativeBridge) {
        // The native receiver returns the code to this WebView's current local
        // origin. PKCE stays here; self-hosted codes never visit a hosted relay.
        const result = await client.auth.signInWithOAuth({
          provider,
          redirectTo: "tokentracker://auth/callback",
          // @ts-expect-error - skipBrowserRedirect is supported but not in types
          skipBrowserRedirect: true,
        });
        if (!isCurrentInsforgeClient(client)) {
          return { error: new Error(copy("instance.configuration.changed")) };
        }
        if (result.data?.url) {
          try {
            // Linux's Tauri command rejects when the system browser can't be opened.
            await nativeBridge.postMessage(result.data.url);
          } catch (err) {
            return { error: err instanceof Error ? err : new Error(String(err)) };
          }
        }
        return result;
      }
      const redirectTo =
        typeof redirectToOverride === "string" && redirectToOverride.trim()
          ? redirectToOverride.trim()
          : typeof window !== "undefined"
            ? `${window.location.origin}/dashboard`
            : undefined;
      const result = await client.auth.signInWithOAuth({
        provider,
        redirectTo,
      });
      return result;
    },
    [client],
  );

  const signInWithPassword = useCallback(
    async (request) => {
      if (!client || !isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
      const { data, error } = await client.auth.signInWithPassword(request);
      if (!isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
      if (data?.user) { explicitlySignedOutRef.current = false; allowInsforgeSessionRestore(); setUser(data.user); }
      return { data, error };
    },
    [client],
  );

  const signUp = useCallback(
    async (request) => {
      if (!client || !isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
      const { data, error } = await client.auth.signUp(request);
      if (!isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
      if (data?.user && data?.accessToken) { explicitlySignedOutRef.current = false; allowInsforgeSessionRestore(); setUser(data.user); }
      return { data, error };
    },
    [client],
  );

  const sendResetPasswordEmail = useCallback(
    async (request) => {
      if (!client || !isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
      return client.auth.sendResetPasswordEmail(request);
    },
    [client],
  );

  const exchangeResetPasswordToken = useCallback(
    async (request) => {
      if (!client || !isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
      return client.auth.exchangeResetPasswordToken(request);
    },
    [client],
  );

  const resetPassword = useCallback(
    async (request) => {
      if (!client || !isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
      return client.auth.resetPassword(request);
    },
    [client],
  );

  const getPublicAuthConfig = useCallback(async () => {
    if (!client || !isCurrentInsforgeClient(client)) return { data: null, error: new Error(copy("instance.configuration.changed")) };
    return client.auth.getPublicAuthConfig();
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    explicitlySignedOutRef.current = true;
    invalidateAccountResponseCache();
    await client.auth.signOut();
    clearCloudDeviceSession();
    // Sign-out clears session readiness, while the explicit sync preference
    // survives for the next login. Local views stay immediate without a session.
    setCloudUsageReady(false);
    // Refresh same-tab account scope after clearing readiness. This does not
    // change or mirror the saved preference.
    window.dispatchEvent(new Event("tt.cloudSyncChanged"));
    clearLocalApiAuthToken();
    setUser(null);
  }, [client]);

  const getAccessToken = useCallback(async () => {
    if (!client || !isCurrentInsforgeClient(client)) return null;
    const token = await resolveInsforgeClientAccessToken(client);
    if (!isCurrentInsforgeClient(client)) return null;
    if (user?.id && cloudPromptOwnerFromToken(token) !== user.id) return null;
    return token;
  }, [client, user?.id]);

  // Unified display name: cloud custom name > OAuth provider name.
  // Fetched once when user signs in; updated via refreshDisplayName().
  const [cloudDisplayName, setCloudDisplayName] = useState(null);
  // 自定义头像（设置页上传/保存后即时传播给侧栏头像，2026-11-12）。
  const [customAvatarUrl, setCustomAvatarUrl] = useState(null);
  const [displayNameResolved, setDisplayNameResolved] = useState(false);
  const authDisplayName = useMemo(() => pickDisplayNameFromUser(user), [user]);

  // 头像同源回填（2026-11-12）：登录/整页刷新后内存 customAvatarUrl 已
  // 清零，而 SDK user 对象不带 avatar——侧栏头像要从 public-visibility
  // 恢复。不能挂在下面的 displayName effect 里：那个 effect 被
  // isOfficialInsforgeInstance() 门住（上游付费云的会员语义），自托管
  // 实例永远 early-return，头像就永远回不来。
  useEffect(() => {
    if (!user || !client) {
      setCustomAvatarUrl(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const token = await resolveInsforgeClientAccessToken(client);
        if (!active || !token) return;
        const data = await getPublicVisibility({ accessToken: token });
        if (active) setCustomAvatarUrl(data?.avatar_url || null);
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, [user, client]);

  useEffect(() => {
    if (!user || !client || !isOfficialInsforgeInstance()) {
      setCloudDisplayName(null);
      setDisplayNameResolved(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const token = await resolveInsforgeClientAccessToken(client);
        if (!active || !token) { if (active) setDisplayNameResolved(true); return; }
        const data = await getPublicVisibility({ accessToken: token });
        if (active && data?.display_name) setCloudDisplayName(data.display_name);
      } catch { /* ignore */ }
      if (active) setDisplayNameResolved(true);
    })();
    return () => { active = false; };
  }, [user, client]);

  // Don't flash the OAuth name before cloud name resolves
  const displayName = displayNameResolved
    ? (cloudDisplayName || authDisplayName)
    : "";

  const refreshDisplayName = useCallback(async () => {
    if (!client) return;
    try {
      const token = await resolveInsforgeClientAccessToken(client);
      if (!token) return;
      const data = await getPublicVisibility({ accessToken: token });
      if (data?.display_name) setCloudDisplayName(data.display_name);
    } catch { /* ignore */ }
  }, [client]);

  const value = useMemo(() => {
    if (!isCloudInsforgeConfigured() || !client) {
      return {
        enabled: false,
        configurationError: getInsforgeConfigurationError(),
        connectionHost: getInsforgeConnectionHost(),
        client: null,
        user: null,
        signedIn: false,
        loading: isCloudInsforgeConfigured() && loading,
        displayName: "",
        refreshUser: async () => {},
        refreshDisplayName: async () => {},
        signInWithOAuth: async () => ({ error: new Error("InsForge not configured") }),
        signInWithPassword: async () => ({ data: null, error: new Error("InsForge not configured") }),
        signUp: async () => ({ data: null, error: new Error("InsForge not configured") }),
        sendResetPasswordEmail: async () => ({ data: null, error: new Error("InsForge not configured") }),
        exchangeResetPasswordToken: async () => ({ data: null, error: new Error("InsForge not configured") }),
        resetPassword: async () => ({ data: null, error: new Error("InsForge not configured") }),
        getPublicAuthConfig: async () => ({ data: null, error: new Error("InsForge not configured") }),
        signOut: async () => {},
        getAccessToken: async () => null,
      };
    }
    return {
      enabled: true,
      configurationError: null,
      connectionHost: getInsforgeConnectionHost(),
      client,
      user,
      signedIn: Boolean(user),
      loading,
      displayName,
      customAvatarUrl,
      setCustomAvatarUrl,
      refreshUser,
      refreshDisplayName,
      signInWithOAuth,
      signInWithPassword,
      signUp,
      sendResetPasswordEmail,
      exchangeResetPasswordToken,
      resetPassword,
      getPublicAuthConfig,
      signOut,
      getAccessToken,
    };
  }, [
    client,
    user,
    loading,
    displayName,
    customAvatarUrl,
    refreshUser,
    refreshDisplayName,
    signInWithOAuth,
    signInWithPassword,
    signUp,
    sendResetPasswordEmail,
    exchangeResetPasswordToken,
    resetPassword,
    getPublicAuthConfig,
    signOut,
    getAccessToken,
  ]);

  return <InsforgeAuthContext.Provider value={value}>{children}</InsforgeAuthContext.Provider>;
}

export function useInsforgeAuth() {
  return useContext(InsforgeAuthContext);
}
