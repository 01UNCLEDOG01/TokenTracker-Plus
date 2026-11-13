// Fetch code only when a user shows navigation intent. Importing a page does
// not mount it, so its data requests and polling still start on navigation.
const loaders = {
  "/dashboard": () => import("../pages/DashboardPage.jsx"),
  "/sessions": () => import("../pages/SessionsPage.jsx"),
  "/limits": () => import("../pages/LimitsPage.jsx"),
  "/leaderboard": () => import("../pages/LeaderboardPage.jsx"),
  "/global-models": () => import("../pages/GlobalModelsPage.jsx"),
  "/achievements": () => import("../pages/AchievementsPage.jsx"),
  "/widgets": () => import("../pages/WidgetsPage.jsx"),
  "/pet-settings": () => import("../pages/PetPage.jsx"),
  "/skills": () => import("../pages/SkillsPage.jsx"),
  "/ip-check": () => import("../pages/IpCheckPage.jsx"),
  "/perks": () => import("../pages/PerksPage.jsx"),
  "/service-status": () => import("../pages/ServiceStatusPage.jsx"),
  "/cloud": () => import("../pages/CloudPage.jsx"),
  "/settings": () => import("../pages/SettingsPage.jsx"),
};

const pending = new Map();

export function preloadNavigationPage(pathname) {
  if (!Object.hasOwn(loaders, pathname)) return Promise.resolve(null);
  if (!pending.has(pathname)) {
    pending.set(pathname, loaders[pathname]().catch(() => {
      // An optional preload must neither reload the app nor poison a retry.
      // Actual navigation keeps App's stale-chunk recovery behavior.
      pending.delete(pathname);
      return null;
    }));
  }
  return pending.get(pathname);
}
