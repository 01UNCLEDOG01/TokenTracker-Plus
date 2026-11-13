import { copy } from "./copy";

/** Canonical usage-limits provider ids (order defaults in useLimitsDisplayPrefs). */
export const LIMIT_PROVIDER_IDS = [
  "claude",
  "codex",
  "cursor",
  "gemini",
  "kimi",
  "kiro",
  "grok",
  "copilot",
  "antigravity",
  "apigoto",
  "sensenova",
  "zcode",
  "opencodeGo",
  "commandCode",
  "qoder",
  "qoderCn",
  "codingPlan",
  "agentPlan",
  "devin",
  "workbuddy",
  "workbuddyAi",
  "raccoon",
  "deepseek",
  "minimax",
  "traeMain",
  "trae",
  "codearts",
  "clinePass",
  "agentRouter",
  "opendesign",
  "mistral",
  "openaiCredits",
  "minimaxCode",
  "hark",
];

/** Keys for ProviderIcon — mono logos use inline SVG; colored logos use /brand-logos/. */
export const LIMIT_PROVIDER_ICON_KEYS = {
  claude: "CLAUDE",
  codex: "CODEX",
  cursor: "CURSOR",
  gemini: "GEMINI",
  kimi: "KIMI",
  kiro: "KIRO",
  grok: "GROK",
  copilot: "COPILOT",
  antigravity: "ANTIGRAVITY",
  // APIGOTO 的品牌图抓自面板自身的 favicon.svg。
  apigoto: "APIGOTO",
  // SenseNova (商汤日日新) — brand mark taken from the console's own asset.
  sensenova: "SENSENOVA",
  zcode: "ZCODE",
  // Reuse the existing OpenCode brand mark — same vendor, separate product
  // (Go is a paid subscription tracked via dashboard scrape).
  opencodeGo: "OPENCODE",
  // CommandCode has no standalone square brand mark; it reuses the docs
  // double-chevron glyph via the CommandCodeIcon mono component below.
  commandCode: "COMMAND-CODE",
  qoder: "QODER",
  // The CN edition ships its own green-crescent brand mark, distinct from the
  // international black double-crescent — resolved to the QODER-CN icon asset.
  qoderCn: "QODER-CN",
  // Volcano Engine Ark Coding Plan — own brand mark under /brand-logos/.
  codingPlan: "VOLCANO-ARK",
  // Volcano Engine Ark Agent Plan — shares the same Ark brand mark.
  agentPlan: "VOLCANO-ARK",
  // Devin (devin.ai) — the three-hexagon "nodes" mark under /brand-logos/.
  devin: "DEVIN",
  // WorkBuddy uses one product row for either regional edition.
  workbuddy: "WORKBUDDY",
  workbuddyAi: "WORKBUDDY",
  // 小浣熊 (Raccoon, raccoon.sensetime.com) — the gateway's own provider icon
  // (Program Files/Agent2API/_up_/ui/assets/providers/raccoon.png).
  raccoon: "RACCOON",
  // DeepSeek open platform (api.deepseek.com) balance — official logo asset.
  deepseek: "DEEPSEEK-PLATFORM",
  // MiniMax Coding Plan / API balance — inline mono brand mark.
  minimax: "MINIMAX",
  // TRAE SOLO secondary account, fed by the gateway snapshot.
  trae: "TRAE",
  // TRAE main account — same white-plate asset as the alt card.
  traeMain: "TRAE",
  // Huawei CodeArts Agent trial credits, fed by the gateway snapshot.
  codearts: "CODEARTS",
  // Cline Pass micro-credits, fed by the gateway snapshot.
  clinePass: "CLINE-PASS",
  // AgentRouter.org (New API panel) balance — official site logo.
  agentRouter: "AGENTROUTER",
  // OpenDesign subscription quota — inline mono "O" brand mark (no official
  // logo asset shipped yet; the letterform matches open-design.ai favicon).
  opendesign: "OPENDESIGN",
  // Mistral subscription quota — inline mono "M" letterform (the striped
  // official mark needs a color asset we do not ship; the letterform is
  // unambiguous next to the other provider marks).
  mistral: "MISTRAL",
  // OpenAI Platform API credits — inline mono coin mark (balance meter, not a
  // plan; the OpenAI knot needs a color asset we do not ship).
  openaiCredits: "OPENAI-CREDITS",
  // MiniMax Code quota lane shares the desktop brand mark (same convention as
  // MiniMax Code CLI sessions reusing the MiniMax icon).
  minimaxCode: "MINIMAX-CODE",
  // Hark (hark.com) quotas — inline mono comet mark from the product's own
  // icon set (currentColor path, upstream token-monitor assets/icons/hark.svg).
  hark: "HARK",
};

export function limitProviderIconKey(id) {
  return LIMIT_PROVIDER_ICON_KEYS[id] || null;
}

export function limitProviderName(id) {
  switch (id) {
    case "claude":
      return copy("limits.provider.claude");
    case "codex":
      return copy("limits.provider.codex");
    case "cursor":
      return copy("limits.provider.cursor");
    case "gemini":
      return copy("limits.provider.gemini");
    case "kimi":
      return copy("limits.provider.kimi");
    case "kiro":
      return copy("limits.provider.kiro");
    case "grok":
      return copy("limits.provider.grok");
    case "copilot":
      return copy("limits.provider.copilot");
    case "antigravity":
      return copy("limits.provider.antigravity");
    case "apigoto":
      return copy("limits.provider.apigoto");
    case "sensenova":
      return copy("limits.provider.sensenova");
    case "zcode":
      return copy("limits.provider.zcode");
    case "opencodeGo":
      return copy("limits.provider.opencode_go");
    case "commandCode":
      return copy("limits.provider.command_code");
    case "qoder":
      return copy("limits.provider.qoder");
    case "qoderCn":
      return copy("limits.provider.qoder_cn");
    case "codingPlan":
      return copy("limits.provider.ark_coding_plan");
    case "agentPlan":
      return copy("limits.provider.ark_agent_plan");
    case "devin":
      return copy("limits.provider.devin");
    case "workbuddy":
      return copy("limits.provider.workbuddy");
    case "workbuddyAi":
      return copy("limits.provider.workbuddy_ai");
    case "raccoon":
      return copy("limits.provider.raccoon");
    case "deepseek":
      return copy("limits.provider.deepseek");
    case "minimax":
      return copy("limits.provider.minimax");
    case "trae":
      return copy("limits.provider.trae");
    case "traeMain":
      return copy("limits.provider.trae_main");
    case "codearts":
      return copy("limits.provider.codearts");
    case "clinePass":
      return copy("limits.provider.cline_pass");
    case "agentRouter":
      return copy("limits.provider.agentrouter");
    case "opendesign":
      return copy("limits.provider.opendesign");
    case "mistral":
      return copy("limits.provider.mistral");
    case "openaiCredits":
      return copy("limits.provider.openai_credits");
    case "minimaxCode":
      return copy("limits.provider.minimax_code");
    case "hark":
      return copy("limits.provider.hark");
    default:
      return String(id || "");
  }
}
