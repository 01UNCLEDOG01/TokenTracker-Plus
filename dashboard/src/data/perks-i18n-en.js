/**
 * English overlay for the perks guide — ONLY for cards with an international
 * / global site (the ones international users can actually sign up for).
 * Pure-China cards stay Chinese-only by design; zh locale never reads this
 * file's content (localizePerk returns the original item untouched).
 *
 * Fields are optional per card — anything omitted falls back to the Chinese
 * source in perksData.js. Keep every number/fact identical to the source;
 * translations must be updated together with perksData.js edits.
 */

export const PERKS_EN = {
  agnes: {
    badge: "In-house text/image/video free tier",
    description:
      "In-house free-tier model refresh: text agnes-2.5-flash and agnes-3-flash; image agnes-image-2.0 / 2.1 / 2.5-flash; video Agnes Video 2.5 Flash (720p). Per the official 2026-09-23 notice, free- and enterprise-tier rate limits were each cut by 50% — now 10 RPM for free and 20 RPM for enterprise. Both the China site (agnes-ai.cn) and the international site (www.agnes-ai.com) work, neither with an invite program; for the daily-login credit web app see the separate \u201cAgnes AI Web\u201d card.",
    tips:
      "Early sign-ups got a $0.10 credit; whether that still applies is unverified — your in-site balance prevails. To connect, pick a custom provider and fill in the endpoint.",
    tags: ["Free-tier models", "Free 10 RPM", "Long context", "Multimodal"],
  },
  autoclaw_intl: {
    name: "AutoClaw International (Z.AI)",
    badge: "Daily check-in: 500 credits (international)",
    description:
      "The international build of AutoClaw — Zhipu AI's zero-setup, one-click local OpenClaw agent client — ships 50+ skills and AutoGLM browser automation. Verified by testing: a normal daily check-in grants 500 credits (valid 7 days), often stacked with bonus events; new-user starter quota is shown in-app. The China and international editions cannot coexist — install only one.",
    tips:
      "The international site (autoclaw.z.ai) and the China site (autoclaw.zhipuai.cn) keep separate accounts with mutually exclusive installs; no invite program verified for the international edition — in-app perks prevail.",
    tags: ["By Zhipu", "One-click agent install", "Daily 500 check-in", "Standalone intl site"],
  },
  bigmodel: {
    name: "Zhipu Open Platform (BigModel / Z.AI)",
    badge: "All Flash models free (until deprecation) + new-user credits",
    description:
      "Sign up with just a phone number, no heavy verification. The GLM Flash series (GLM-4.7-Flash, GLM-4.5-Flash, GLM-4-Flash-250414, etc.) is free — officially free until the models are deprecated, not a forever promise; new-user starter packs follow the in-site credit center (the officially published figure is 20M GLM-4.5-Air tokens for each side of an invite).",
    tips:
      "China site bigmodel.cn and international site z.ai both serve the free GLM Flash series; granted credits also work on GLM flagship paid models.",
    tags: ["Major CN lab", "All Flash free", "Direct access", "OpenAI-compatible"],
  },
  cursor: {
    name: "Cursor (AI Code Editor)",
    badge: "Free tier, no time limit · monthly capped Agent/Tab usage",
    description:
      "An AI-first code editor by Anysphere. The Hobby plan is $0/month — no credit card, no time limit — with a monthly capped number of Agent requests and Tab completions, usable with their in-house models; official numbers are unpublished, actual quota shows on your in-app usage page. New pricing tiers since 2026-10: Plus $8 / Premium $30 / Super $100 / Ultra $200 per month.",
    tips:
      "Free-tier usage lives on the in-app usage page and resets next monthly cycle when exhausted — or upgrade to a paid plan. Pricing details always defer to cursor.com/pricing.",
    tags: ["Anysphere", "AI-first IDE", "Free tier", "Agent coding"],
  },
  deepseek: {
    name: "DeepSeek Official API Platform",
    badge: "Official, very low pricing (new-user credits unconfirmed)",
    description:
      "DeepSeek's official API platform with OpenAI-compatible endpoints. Input pricing follows the official docs in real time (cache-hit prices sit far below cache-miss). Whether new users get starter credits is not officially stated — the console's credit center holds the current policy.",
    tips:
      "There is no third-party invite program — register directly in the official console. If official top-ups or capacity get congested, a third-party aggregator route works as an availability hot spare.",
    tags: ["Official", "Top-tier reasoning", "Low unit price", "Open-source leader"],
  },
  opencode: {
    badge: "Zen limited-free API (client required)",
    description:
      "A terminal-first AI coding platform. The Zen program offers time-limited free API access — OpenAI-compatible and rotating several coding-optimized open-source models. Officially, free models are meant to be consumed through the OpenCode client; using them as a generic API may not be supported. The free tier also carries usage and rate limits; the official schedule and in-app notices prevail.",
    tips:
      "Sign in with a GitHub or Google account to get a key. Free models rotate periodically — confirm the current lineup before wiring up.",
    tags: ["Coding-focused", "Limited-free models", "OpenAI-compatible", "Client required"],
  },
  openrouter: {
    badge: "A dozen-plus :free models",
    description:
      "A leading global unified model router. By the official live model count, a dozen-plus models carry the :free tag (Llama, DeepSeek, Qwen and other open weights), callable without binding any payment method; the free list shifts as upstream models come and go.",
    tips:
      "With a zero balance, the free tier is rate-limited per day (about 50 requests/day per the official docs) — fine for light testing and cost-free exploration.",
    tags: ["Global router", "No card required", "Standing free tier", "Direct overseas access"],
  },
  qoder: {
    name: "Qoder (International)",
    badge: "Claim 100 credits daily after 10:00",
    description:
      "A full-lifecycle AI coding tool for professional developers. Every day after 10:00 you must claim 100 credits in-app (it is not auto-granted on login); each grant expires 30 days from arrival. New users get a starter quota sized in-app. Three-tier referral rewards: a friend who registers and downloads, then completes one chat or task within 7 days, earns you 50 credits; a friend completing chats/tasks on 3 separate days within 7 days of registering earns you 100 credits; a friend's first subscription within 30 days earns you 1,000 credits (the friend also gets 500). A limited-time \u201cbuy 1 get 1 free\u201d first-purchase credits offer runs in-app — see the events page for the current window.",
    tips:
      "Miss the 10:00 window and it is gone for the day — no make-ups, no accumulation. Compare the quota breakdown with TokenTracker's Qoder card on the client usage page.",
    tags: ["AI coding", "Daily manual claim", "30-day validity", "Multi-model"],
  },
  siliconflow: {
    name: "SiliconFlow",
    badge: "Referral program: \u00a516 voucher per verified invitee",
    description:
      "Aggregates DeepSeek, Qwen and other mainstream open-source models; some small-parameter models stay free with concurrent access. Referral program (verified 2026-11-01): real-name-verified users can refer others; once an invitee completes registration and verification, the inviter gets one \u00a516 platform-wide voucher per invite — no cap on invites or rewards, credited instantly and trackable. The current new-user signup bonus is unverified (earlier it was \u00a514); your in-site balance prevails.",
    tips:
      "Vouchers work across all platform models and services; mind the expiry and spend them in time (remaining balance/expiry shown on the in-site billing page). Works with third-party clients, and top-ups often carry tiered rebates (see in-site announcements).",
    tags: ["Major aggregator", "20M tokens gift", "Fast inference", "Small models free"],
  },
  trae: {
    name: "TRAE (International)",
    badge: "Free tier: $1/month + 5,000 autocompletes",
    description:
      "The international edition (trae.ai) of ByteDance's AI coding platform TRAE, with accounts fully separate from TRAE CN. The free tier includes $1 of monthly model usage and 5,000 autocompletions, resetting monthly; no invite program.",
    tips:
      "Usage and reset timing live on the in-app Usage page; for the China edition's (trae.cn) newcomer points and check-in perks see its own card — the two accounts do not interoperate.",
    tags: ["By ByteDance", "International", "Monthly free quota", "Autocomplete"],
  },
  vyceai: {
    badge: "$50 on signup · $10 daily check-in · $10 for both via invite",
    description:
      "An overseas aggregation gateway (signup needs some network access), OpenAI- and Anthropic-protocol compatible — point any client/IDE's base URL at https://vyceai.com/v1 and go, with one-click setup guides for OpenCode/Cursor/Cline. Verified by testing: signup grants $50 in trial credit, and the daily check-in adds $10. Free users get 4 models (billed at list price, drawing down signup/check-in credit): Claude Sonnet 4.6, DeepSeek V4.1 Flash and Agnes 3.0 Flash with no daily cap; GPT 6 Luna alone carries a 50M daily cap. A Promotional Allowance adds a shared 10M daily quota (GLM 5.3 Flash, Beam 1.0, Nemotron; $0; resets 00:00 UTC). Referrals: a friend registering via your link credits $10 to both sides instantly.",
    tips:
      "The free tier bills at list price against signup/check-in credit; paid Lite/Pro unlock DeepSeek 4.1 Flash 1017, GPT 5.6 Sol/Terra, GPT 6 Astra (under maintenance) and Claude Sonnet 4.6 Pro. Pricing note: in-site prices are reseller prices well above official list (gpt-6-luna: $2/M in-site vs $0.10/M official — roughly a 20x markup), so trial credit burns faster; TokenTracker's panel amounts are converted at official list and will differ from Vyce's own bills. The model list changes in real time — check the Models page before wiring up.",
    tags: ["Overseas platform", "Dual-protocol", "OpenCode ready", "Referral bonus"],
  },
  workbuddy_intl: {
    name: "WorkBuddy AI (International)",
    badge: "100 points on the 1st monthly + 30 the day after each chat day",
    description:
      "WorkBuddy international (workbuddy.ai), with accounts fully separate from the China edition (workbuddy.cn). Current perks: 100 points granted on the 1st of each month, and 30 points auto-credited the next day for each day you chat (verified 2026-11-01); the earlier \u201c100M daily free deepseek-v4.1-flash quota\u201d campaign ended 2026-10-31.",
    tips:
      "Accounts and points are not shared with the China edition (workbuddy.cn); points validity follows the in-app terms, with usage and grant history on the in-site balance & usage page.",
    tags: ["AI client", "International", "Separate accounts"],
  },
  zcode: {
    name: "ZCode (Z.AI Coding Agent)",
    badge: "Friday evenings often grant a 300M GLM-5.3-Flash quota",
    description:
      "Z.ai's official coding agent client — direct GLM model access, ready on login. Long-term observation: Friday-evening logins often surface a limited-time 300M-token GLM-5.3-Flash quota drop; exact amounts and windows follow in-app announcements.",
    tips:
      "These limited-time drops come and go — check the client every Friday evening; TokenTracker Plus's ZCode usage card cross-checks granted quotas and generation rates in real time.",
    tags: ["By Zhipu", "Coding agent", "Friday-evening perks", "Limited 300M quota"],
  },
};

/**
 * Returns the display item for `locale`. zh (or any locale without an overlay)
 * gets the original object back untouched. Only cards present in PERKS_EN are
 * overlaid — pure-China cards intentionally stay Chinese.
 */
export function localizePerk(item, locale) {
  if (locale !== "en") return item;
  const en = PERKS_EN[item.id];
  if (!en) return item;
  return { ...item, ...en };
}
