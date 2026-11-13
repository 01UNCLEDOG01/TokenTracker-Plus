// 按语言拆包的 i18n 注册表（2026-11-13 性能批）：每个语言一个动态 chunk，
// copy.ts 只在需要时加载当前语言——首屏不再背着 5 种语言的 906KB 单包。
// 新增/修改文案仍走 copy.csv + content/i18n/<locale>/*.json，此处只做聚合。
import core from "../../content/i18n/zh/core.json";
import dashboard from "../../content/i18n/zh/dashboard.json";
import marketing from "../../content/i18n/zh/marketing.json";

export default { ...core, ...dashboard, ...marketing } as Record<string, string>;
