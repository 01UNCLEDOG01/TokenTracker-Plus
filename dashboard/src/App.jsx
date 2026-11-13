import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useLocale } from "./hooks/useLocale.js";
import { copy } from "./lib/copy";
import { ThemeProvider } from "./ui/foundation/ThemeProvider.jsx";
import { useInsforgeAuth } from "./contexts/InsforgeAuthContext.jsx";
import { LoginModalProvider } from "./contexts/LoginModalContext.jsx";
import { getBackendBaseUrl, getLeaderboardBaseUrl } from "./lib/config";
import { isMockEnabled } from "./lib/mock-mode";
import { isScreenshotModeEnabled } from "./lib/screenshot-mode";
import { useCloudUsageSync } from "./hooks/use-cloud-usage-sync";
import { useAchievementWatcher } from "./hooks/use-achievements.js";
import { AppLayout } from "./ui/components/Sidebar.jsx";
import { LegalLinks } from "./ui/components/LegalLinks.jsx";
import { ToastProvider } from "./ui/components/Toast.jsx";
import {
  getLeaderboardPreloadContextKey,
  markDashboardMainContentVisible,
  preloadDashboardPageResources,
  preloadLeaderboardDefaultState,
} from "./lib/dashboard-preload.js";
// Telemetry beacons and modal/palette UI are not first-paint critical; lazy
// loading keeps them out of the eager entry chunk (which the anonymous share
// page also downloads). The providers above must stay eager.
// Every lazy import has a null fallback: after a deploy rotates chunk hashes,
// a client holding the old index.html gets 404s on the new chunks — a rejected
// lazy() would otherwise throw past the outer ErrorBoundary and blank the
// whole app. Telemetry/modals must never have that power.
const nullComponent = () => null;
const Analytics = lazy(() =>
  import("@vercel/analytics/react")
    .then((m) => ({ default: m.Analytics }))
    .catch(() => ({ default: nullComponent })),
);
const SpeedInsights = lazy(() =>
  import("@vercel/speed-insights/react")
    .then((m) => ({ default: m.SpeedInsights }))
    .catch(() => ({ default: nullComponent })),
);
const LoginModal = lazy(() =>
  import("./components/LoginModal.jsx")
    .then((m) => ({ default: m.LoginModal }))
    .catch(() => ({ default: nullComponent })),
);
const CommandPalette = lazy(() =>
  import("./ui/dashboard/components/CommandPalette.jsx")
    .then((m) => ({ default: m.CommandPalette }))
    .catch(() => ({ default: nullComponent })),
);
const SteamAchievementContainer = lazy(() =>
  import("./ui/achievements/SteamAchievementToast.jsx")
    .then((m) => ({ default: m.SteamAchievementContainer }))
    .catch(() => ({ default: nullComponent })),
);
// NativeAuthCallbackPage must be eager-imported: its module-level code
// captures the OAuth `insforge_code` query param synchronously at app
// boot, BEFORE the InsForge SDK's detectAuthCallback() strips it. Lazy
// loading delays the module until route render, by which point the
// param has already been removed — the page then falls through to the
// "Sign-in incomplete" failure state.
import { NativeAuthCallbackPage } from "./pages/NativeAuthCallbackPage.jsx";

// 热更轮换 chunk hash 后，持旧 index.html 的会话会按旧文件名拉 chunk → 404
// （2026-11-13 站主截图定谳：「这个视图渲染失败了 / Failed to fetch dynamically
// imported module」）。第一次失败自动整页重载一次（带 _r cache-bust 拿新
// index.html），本会话只自动恢复一次防刷新循环；成功加载后清掉标记，下次热更
// 还能再恢复。真错误重载后仍失败才落到 ErrorBoundary 弹窗。
function recoverFromStaleChunkOnce() {
  try {
    if (sessionStorage.getItem("tt:chunk-recovered")) return false;
    sessionStorage.setItem("tt:chunk-recovered", "1");
  } catch {
    return false; // 存储不可用（隐私模式等）就不自动刷新，交给弹窗
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_r", String(Date.now()));
  window.location.replace(url.href);
  return true;
}
// 页面级懒加载统一入口：chunk 404 先走一次自动恢复。
const lazyPage = (loader) =>
  lazy(() =>
    loader()
      .then((m) => {
        try {
          sessionStorage.removeItem("tt:chunk-recovered");
        } catch {
          /* 忽略：标记清不掉也只是少一次自动恢复 */
        }
        return m;
      })
      .catch((err) => {
        if (recoverFromStaleChunkOnce()) {
          // 整页重载已在路上：短暂渲染空组件顶住这一帧。
          return { default: nullComponent };
        }
        throw err;
      }),
  );

// Pages are lazy-loaded so each route ships in its own chunk; keeps the
// initial main bundle small (was 1.9 MB before splitting, all 11 pages
// were bundled together). Routes are mutually exclusive, so only one
// chunk loads per navigation.
const DashboardPage = lazyPage(() =>
  import("./pages/DashboardPage.jsx").then((m) => ({ default: m.DashboardPage })),
);
const IpCheckPage = lazyPage(() => import("./pages/IpCheckPage.jsx"));
const PerksPage = lazyPage(() => import("./pages/PerksPage.jsx"));

// 福利指南首访时 chunk 还在路上：给一屏骨架，别让 Suspense fallback=null 白屏几秒。
function PerksRouteSkeleton() {
  return (
    <div className="flex flex-1 flex-col px-4 pt-8 sm:px-6" aria-busy="true">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6 h-8 w-40 animate-pulse rounded-lg bg-oai-gray-200/80 dark:bg-oai-gray-800" />
        <div className="mb-6 flex flex-col gap-4 lg:flex-row">
          <div className="h-40 w-full animate-pulse rounded-2xl bg-oai-gray-100 dark:bg-oai-gray-900/70 sm:w-52" />
          <div className="h-40 flex-1 animate-pulse rounded-2xl bg-oai-gray-100 dark:bg-oai-gray-900/70" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, idx) => (
            <div key={idx} className="h-44 animate-pulse rounded-2xl bg-oai-gray-100 dark:bg-oai-gray-900/70" />
          ))}
        </div>
      </div>
    </div>
  );
}
const ServiceStatusPage = lazyPage(() => import("./pages/ServiceStatusPage.jsx"));
const AchievementsPage = lazyPage(() => import("./pages/AchievementsPage.jsx"));
const GlobalModelsPage = lazyPage(() => import("./pages/GlobalModelsPage.jsx"));
const LandingPage = lazyPage(() =>
  import("./pages/LandingPage.jsx").then((m) => ({ default: m.LandingPage })),
);
const LeaderboardPage = lazyPage(() =>
  import("./pages/LeaderboardPage.jsx").then((m) => ({ default: m.LeaderboardPage })),
);
const LeaderboardProfilePage = lazyPage(() =>
  import("./pages/LeaderboardProfilePage.jsx").then((m) => ({ default: m.LeaderboardProfilePage })),
);
const LimitsPage = lazyPage(() =>
  import("./pages/LimitsPage.jsx").then((m) => ({ default: m.LimitsPage })),
);
const LoginPage = lazyPage(() =>
  import("./pages/LoginPage.jsx").then((m) => ({ default: m.LoginPage })),
);
const ResetPasswordPage = lazyPage(() =>
  import("./pages/ResetPasswordPage.jsx").then((m) => ({ default: m.ResetPasswordPage })),
);
const DevicePage = lazyPage(() => import("./pages/DevicePage.jsx"));
const WrappedPage = lazyPage(() => import("./pages/WrappedPage.jsx"));
const SettingsPage = lazyPage(() =>
  import("./pages/SettingsPage.jsx").then((m) => ({ default: m.SettingsPage })),
);
const SelfHostPage = lazyPage(() =>
  import("./pages/SelfHostPage.jsx").then((m) => ({ default: m.SelfHostPage })),
);
const CloudPage = lazyPage(() =>
  import("./pages/CloudPage.jsx").then((m) => ({ default: m.CloudPage })),
);
const SkillsPage = lazyPage(() =>
  import("./pages/SkillsPage.jsx").then((m) => ({ default: m.SkillsPage })),
);
const SessionsPage = lazyPage(() =>
  import("./pages/SessionsPage.jsx").then((m) => ({ default: m.SessionsPage })),
);
const WidgetsPage = lazyPage(() =>
  import("./pages/WidgetsPage.jsx").then((m) => ({ default: m.WidgetsPage })),
);
const PetPage = lazyPage(() =>
  import("./pages/PetPage.jsx").then((m) => ({ default: m.PetPage })),
);

export default function App() {
  // Subscribing to locale here makes App rerender on language switch, which
  // rebuilds every child element reference and triggers copy() re-evaluation
  // across the tree — without unmounting lazy-loaded pages.
  const { resolvedLocale } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const insforge = useInsforgeAuth();
  useCloudUsageSync();
  const dashboardMainContentVisibleRef = useRef(false);
  const dashboardResourcePreloadStartedRef = useRef(false);
  const leaderboardStatePreloadContextKeysRef = useRef(new Set());
  const mockEnabled = isMockEnabled();
  const screenshotMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isScreenshotModeEnabled(window.location.search);
  }, []);
  const pathname = location?.pathname || "/";
  const pageUrl = new URL(window.location.href);
  const sharePathname = pageUrl.pathname.replace(/\/+$/, "") || "/";
  const shareMatch = sharePathname.match(/^\/share\/([^/?#]+)$/i);
  const tokenFromPath = shareMatch?.[1] || null;
  const tokenFromQuery = pageUrl.searchParams.get("token") || null;
  const publicToken = tokenFromPath || tokenFromQuery;
  const publicMode =
    sharePathname === "/share" ||
    sharePathname === "/share.html" ||
    sharePathname.startsWith("/share/");

  const isLocalMode =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  useAchievementWatcher({ enabled: isLocalMode });

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const isDashboardDefaultPath = normalizedPath === "/" || normalizedPath === "/dashboard";
  const isLeaderboardPath = normalizedPath === "/leaderboard";
  const isGlobalModelsPath = normalizedPath === "/global-models";
  // Standalone shareable profile page: /u/:userId (public, anonymous-visible).
  const profileMatch = normalizedPath.match(/^\/u\/([^/]+)$/i);
  const profileUserId = profileMatch ? profileMatch[1] : null;

  const cloudAuthSignedIn = Boolean(insforge.enabled && insforge.signedIn);
  const signedIn = isLocalMode || cloudAuthSignedIn;
  const sessionSoftExpired = false;
  const baseUrl = getBackendBaseUrl();
  const isAuthGateTriggered = !signedIn && !mockEnabled && !isLocalMode;
  const leaderboardAccessMode = mockEnabled
    ? "mock"
    : insforge.loading
      ? "unavailable"
      : cloudAuthSignedIn
        ? "cloud"
        : signedIn
          ? "local"
          : "unavailable";

  const tryPreloadLeaderboardDefaultState = useCallback(() => {
    if (!dashboardMainContentVisibleRef.current) return;
    if (!mockEnabled && insforge.loading) return;
    if (!mockEnabled && !signedIn) return;
    const preloadOptions = {
      accessMode: leaderboardAccessMode,
      baseUrl: getLeaderboardBaseUrl(),
      mockEnabled,
      signedIn,
      authLoading: Boolean(insforge.loading),
      userId: cloudAuthSignedIn ? insforge.user?.id || null : null,
      getAccessToken: () => insforge.getAccessToken(),
    };
    const contextKey = getLeaderboardPreloadContextKey(preloadOptions);
    if (leaderboardStatePreloadContextKeysRef.current.has(contextKey)) return;
    leaderboardStatePreloadContextKeysRef.current.add(contextKey);
    void preloadLeaderboardDefaultState(preloadOptions);
  }, [
    cloudAuthSignedIn,
    insforge.loading,
    insforge.user?.id,
    leaderboardAccessMode,
    mockEnabled,
    signedIn,
  ]);

  const handleDashboardMainContentVisible = useCallback(() => {
    if (!isDashboardDefaultPath) return;
    if (!dashboardMainContentVisibleRef.current) {
      dashboardMainContentVisibleRef.current = true;
      markDashboardMainContentVisible();
    }
    if (!dashboardResourcePreloadStartedRef.current) {
      dashboardResourcePreloadStartedRef.current = true;
      void preloadDashboardPageResources();
    }
    tryPreloadLeaderboardDefaultState();
  }, [
    isDashboardDefaultPath,
    tryPreloadLeaderboardDefaultState,
  ]);

  useEffect(() => {
    tryPreloadLeaderboardDefaultState();
  }, [tryPreloadLeaderboardDefaultState]);

  const authObject = useMemo(() => {
    if (!insforge.enabled || !cloudAuthSignedIn) return null;
    return {
      getAccessToken: () => insforge.getAccessToken(),
      name: insforge.displayName || "",
      userId: insforge.user?.id || null,
    };
  }, [cloudAuthSignedIn, insforge]);

  let gate = isLocalMode || mockEnabled || screenshotMode ? "dashboard" : "landing";
  if (normalizedPath === "/landing") gate = "landing";
  if (normalizedPath === "/dashboard") gate = "dashboard";
  if (isLeaderboardPath || isGlobalModelsPath) gate = "dashboard";
  if (profileUserId) gate = "dashboard";

  const isLimitsPath = normalizedPath === "/limits";
  const isSettingsPath = normalizedPath === "/settings";
  const isSelfHostPath = normalizedPath === "/self-host";
  const isCloudPath = normalizedPath === "/cloud";
  const isSkillsPath = normalizedPath === "/skills";
  const isSessionsPath = normalizedPath === "/sessions";
  const isWidgetsPath = normalizedPath === "/widgets";
  const isPetPath = normalizedPath === "/pet-settings";
  const isIpCheckPath = normalizedPath === "/ip-check";
  const isPerksPath = normalizedPath === "/perks";
  const isServiceStatusPath = normalizedPath === "/service-status";
  const isAchievementsPath = normalizedPath === "/achievements";
  if (isLimitsPath || isSettingsPath || isSelfHostPath || isSkillsPath || isSessionsPath || isWidgetsPath || isPetPath || isIpCheckPath || isPerksPath || isServiceStatusPath || isCloudPath || isAchievementsPath) gate = "dashboard";

  let PageComponent = DashboardPage;
  if (profileUserId) {
    PageComponent = LeaderboardProfilePage;
  } else if (normalizedPath === "/leaderboard") {
    PageComponent = LeaderboardPage;
  } else if (isGlobalModelsPath) {
    PageComponent = GlobalModelsPage;
  } else if (isLimitsPath) {
    PageComponent = LimitsPage;
  } else if (isSettingsPath) {
    PageComponent = SettingsPage;
  } else if (isCloudPath) {
    PageComponent = CloudPage;
  } else if (isSelfHostPath) {
    PageComponent = SelfHostPage;
  } else if (isSkillsPath) {
    PageComponent = SkillsPage;
  } else if (isSessionsPath) {
    PageComponent = SessionsPage;
  } else if (isWidgetsPath) {
    PageComponent = WidgetsPage;
  } else if (isPetPath) {
    PageComponent = PetPage;
  } else if (isIpCheckPath) {
    PageComponent = IpCheckPage;
  } else if (isPerksPath) {
    PageComponent = PerksPage;
  } else if (isServiceStatusPath) {
    PageComponent = ServiceStatusPage;
  } else if (isAchievementsPath) {
    PageComponent = AchievementsPage;
  }

  const showSidebar =
    !publicMode &&
    (!isAuthGateTriggered || isSelfHostPath) &&
    (normalizedPath === "/dashboard" ||
      normalizedPath === "/" ||
      isLeaderboardPath ||
      isGlobalModelsPath ||
      isLimitsPath ||
      isSettingsPath ||
      isSelfHostPath ||
      isCloudPath ||
      isSkillsPath ||
      isSessionsPath ||
      isWidgetsPath ||
      isPetPath ||
      isIpCheckPath ||
      isPerksPath ||
      isServiceStatusPath ||
      isAchievementsPath);

  // Public-host gating: when the dashboard is served from a host with no local
  // CLI :7680 to fall back to, dashboard / settings / etc. require a
  // signed-in user. publicMode (shared link) and the loading state are
  // exceptions that handle themselves.
  const publicHostNeedsLogin =
    !isLocalMode &&
    !cloudAuthSignedIn &&
    !publicMode &&
    !insforge.loading &&
    gate === "dashboard" &&
    // Public-readable routes must stay reachable for signed-out visitors:
    // /leaderboard and /u/:userId profiles are deliberate no-auth reads
    // (see api.ts getLeaderboard + LeaderboardProfilePage). Without these
    // exclusions the gate would bounce anonymous share-link traffic to /login.
    !isLeaderboardPath &&
    !isSelfHostPath &&
    !profileUserId &&
    normalizedPath !== "/perks" &&
    normalizedPath !== "/login" &&
    normalizedPath !== "/reset-password" &&
    normalizedPath !== "/landing" &&
    normalizedPath !== "/auth/callback" &&
    normalizedPath !== "/auth/native-callback";
  if (publicHostNeedsLogin) {
    const params = new URLSearchParams(location.search);
    for (const key of ["insforge_code", "code", "state", "access_token", "refresh_token"]) params.delete(key);
    const query = params.toString();
    const next = encodeURIComponent(location.pathname + (query ? `?${query}` : ""));
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  let content = null;
  let hasLandingFooter = false;
  if (normalizedPath === "/auth/callback" || normalizedPath === "/auth/native-callback") {
    content = <NativeAuthCallbackPage />;
  } else if (normalizedPath === "/login") {
    content = <LoginPage />;
  } else if (normalizedPath === "/reset-password") {
    content = <ResetPasswordPage />;
  } else if (normalizedPath === "/device") {
    // Headless-CLI device-flow approval page. Standalone (no sidebar) so
    // unsigned visitors hit the embedded sign-in CTA without sidebar nav
    // confusion. Auth check happens inside DevicePage itself.
    content = <DevicePage />;
  } else if (normalizedPath === "/wrapped") {
    // Year-end Wrapped page. Reads from /functions/tokentracker-wrapped
    // (provided by the local CLI server) — no auth required.
    content = <WrappedPage />;
  } else if (gate === "landing") {
    content = <LandingPage signInUrl="/login" signUpUrl="/login" />;
    hasLandingFooter = true;
  } else {
    const pageNode = (<>
      {insforge.configurationError ? (
        <p role="alert" className="mx-auto w-full max-w-7xl px-4 py-4 text-sm leading-6 text-oai-gray-700 dark:text-oai-gray-300 sm:px-6">
          {copy("instance.configuration.invalid")}
        </p>
      ) : null}
      <PageComponent
        key={resolvedLocale}
        baseUrl={baseUrl}
        auth={authObject}
        signedIn={signedIn}
        sessionSoftExpired={sessionSoftExpired}
        signOut={() => (insforge.enabled ? insforge.signOut() : Promise.resolve())}
        publicMode={publicMode}
        publicToken={publicToken}
        userId={profileUserId}
        signInUrl="/login"
        signUpUrl="/login"
        onMainContentVisible={handleDashboardMainContentVisible}
      />
    </>);
    if (showSidebar) {
      content = (
        <AppLayout>
          {pageNode}
          {!isLocalMode && <footer className="px-4 py-6"><LegalLinks /></footer>}
        </AppLayout>
      );
    } else {
      content = pageNode;
    }
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <LoginModalProvider>
            <Suspense fallback={isPerksPath ? <PerksRouteSkeleton /> : null}>{content}</Suspense>
            {!isLocalMode && !showSidebar && !hasLandingFooter && (
              <footer className="px-4 py-6"><LegalLinks /></footer>
            )}
            <Suspense fallback={null}>
              {showSidebar ? <CommandPalette /> : null}
              <LoginModal />
              <SteamAchievementContainer />
              <Analytics />
              <SpeedInsights />
            </Suspense>
          </LoginModalProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
