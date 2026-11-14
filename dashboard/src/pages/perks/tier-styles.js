// 福利价值六档（灰→绿→蓝→紫→粉→琥珀）：卡片 badge 与页首图例共用这一套色，
// 改口径时只动这里与 perksData.js 头注释，避免「卡片一个色、图例另一个色」。
export const PERK_TIER_STYLES = {
  neutral: "bg-oai-gray-100 text-oai-gray-700 border-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:border-oai-gray-700",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:bg-emerald-500/30 dark:text-emerald-200 dark:border-emerald-400/50",
  blue: "bg-sky-500/10 text-sky-700 border-sky-500/20 dark:bg-sky-500/30 dark:text-sky-200 dark:border-sky-400/50",
  purple: "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:bg-purple-500/30 dark:text-purple-200 dark:border-purple-400/50",
  rose: "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:bg-rose-500/30 dark:text-rose-200 dark:border-rose-400/50",
  amber: "bg-amber-500/15 text-amber-700 border-amber-500/25 dark:bg-amber-500/30 dark:text-amber-200 dark:border-amber-400/60",
};

// 卡册小卡底条、筛选 chip 与页首图例共用同一套实色（-500）：卡片 badge 的半透明底
// 在 10px 直径下几乎看不出差别，所以「色」只在 badge 以外的三处用实色。
export const PERK_TIER_ACCENT = {
  neutral: "bg-oai-gray-400 dark:bg-oai-gray-500",
  success: "bg-emerald-500",
  blue: "bg-sky-500",
  purple: "bg-purple-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
};

export const getBadgeStyle = (type) => PERK_TIER_STYLES[type] || PERK_TIER_STYLES.neutral;
