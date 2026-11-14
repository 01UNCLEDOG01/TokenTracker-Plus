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
      "DeepSeek's official API platform with OpenAI-compatible endpoints. Input pricing follows the official docs in real time (cache-hit prices sit far below cache-miss). Whether new users get starter credits is not officially stated — the console's credit center holds the current policy. AIHOT's 2026-11-11 note says new users who first sign in to DSH (DeepSeek's harness desktop client) get roughly \u00a56 of trial credit; that belongs to DSH rather than this API platform, and the official API docs only acknowledge a \u201cgift balance\u201d alongside the top-up balance (spent first), with no published signup amount.",
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
      "An overseas aggregation gateway (signup needs some network access), OpenAI- and Anthropic-protocol compatible — point any client/IDE's base URL at https://vyceai.com/v1 and go, with one-click setup guides for OpenCode/Cursor/Cline. Verified by testing: signup grants $50 in trial credit, and the daily check-in adds $10. Free users get 4 models (billed at list price, drawing down signup/check-in credit): Claude Sonnet 4.6, DeepSeek V4.1 Flash and Agnes 3.0 Flash with no daily cap; GPT 6 Luna alone carries a 50M daily cap. A Promotional Allowance adds a shared 10M daily quota (GLM 5.3 Flash, Beam 1.0, Nemotron; $0; resets 00:00 UTC). Referrals: a friend registering via your link credits $10 to both sides instantly. Stability note (checked 2026-11-11): the service has been unstable lately \u2014 models repeatedly unavailable or returning gateway errors \u2014 and it requires an overseas network, so expect more variance than similarly priced gateways; the tier is lowered accordingly, best kept as a backup route.",
    tips:
      "The free tier bills at list price against signup/check-in credit; paid Lite/Pro unlock DeepSeek 4.1 Flash 1017, GPT 5.6 Sol/Terra, GPT 6 Astra (under maintenance) and Claude Sonnet 4.6 Pro. Pricing note: in-site prices are reseller prices well above official list (gpt-6-luna: $2/M in-site vs $0.10/M official — roughly a 20x markup), so trial credit burns faster; TokenTracker's panel amounts are converted at official list and will differ from Vyce's own bills. The model list changes in real time — check the Models page before wiring up.",
    tags: ["Overseas platform", "Dual-protocol", "OpenCode ready", "Referral bonus"],
  },
  workbuddy_intl: {
    name: "WorkBuddy AI (International)",
    badge: "100 points on the 1st monthly + 30 the day after each chat day",
    description:
      "WorkBuddy international (workbuddy.ai), with accounts fully separate from the China edition (workbuddy.cn). Current perks: 100 points granted on the 1st of each month, and 30 points auto-credited the next day for each day you chat (verified 2026-11-01). DeepSeek-V4.1-Flash free calls ended (owner verified on 2026-11-02); HY3 remains available for free. Daily caps and campaign windows follow the in-app terms. Invite program (in-app invite dialog, 2026-11-11): a friend who signs up through your link and completes a first question earns you 100 points, and the friend receives 350 (100 invite + 250 new-user). Note the China edition has switched to a 100-point daily check-in \u2014 the two editions differ.",
    tips:
      "Accounts and points are not shared with the China edition (workbuddy.cn); points validity follows the in-app terms, with usage and grant history on the in-site balance & usage page.",
    tags: ["AI client", "International", "Separate accounts", "Free HY3"],
  },
  zcode: {
    name: "ZCode (Z.AI Coding Agent)",
    badge: "300M GLM-5.3-Flash nightly in-app (current promo)",
    description:
      "Z.ai's official coding agent client — direct GLM model access, ready on login. New accounts linked to BigModel get 5 days of free use from first use: 3M GLM-5.3 + 5M GLM-5.3-Flash tokens per day (separate buckets, refreshed daily, verified on the official docs 2026-11-10). As of 2026-11-11 the in-app campaign grants a nightly 300M-token GLM-5.3-Flash quota in both the China and international clients \u2014 a current campaign, not a standing benefit; earlier windows were sporadic drops plus a larger Friday-evening grant (500M class). Windows and amounts follow in-app announcements; the official docs don't list this campaign. An invite program is live: inviting new users, plus weekly tiers at 2 and 10 invites, grants login-card rewards (card types follow the in-app rewards center).",
    tips:
      "These limited-time drops come and go — check the client every Friday evening; TokenTracker Plus's ZCode usage card cross-checks granted quotas and generation rates in real time. Invite progress lives in the in-app rewards center.",
    tags: ["By Zhipu", "Coding agent", "Friday-evening perks", "Limited 300M quota", "Invite rewards"],
  },

  amd_token_factory: {
    badge: "15 free model APIs, ready to call (18 on site)",
    description:
      "AMD Radeon Cloud\u2019s Token Factory (BETA): sign in with an AMD developer account, grab a key, and call the 15 models under \u201cPublic Free Model APIs\u201d (18 on the whole site) \u2014 DeepSeek-V4.1-Flash-1017 / DeepSeek-V4-Flash-0731, GLM-5.3-Flash, Qwen3.8-Flash-Next / Qwen3.8-27B, Gemma-4-31B-IT, MiMo-V2.6-Flash, the MiniCPM-V-4.7 family, d3 / d3-flash decision models and more (owner-verified 2026-11-03). OpenAI-compatible /v1 endpoints plug into any compatible client; mainland-China phone numbers can register and the site is reachable from mainland China. Model cards show live load bars (Busy/Idle); free-tier limits and quotas are governed by the site.",
    tips:
      "On a BETA service the free model list and limited-time events can change anytime \u2014 the site is authoritative; check each model\u2019s load and remaining capacity before calling, Busy periods may queue; no invite program.",
    tags: ["AMD official", "OpenAI-compatible /v1", "DeepSeek/Qwen/GLM", "CN phone sign-up"],
  },
  cloudflare_workers_ai: {
    badge: "10,000 neurons of free compute daily",
    description:
      "Cloudflare Workers AI: the free plan includes 10,000 neurons per day (Cloudflare\u2019s unified AI compute unit, model-dependent, refreshed daily) across LLMs (Llama etc.), image, speech transcription and embedding models, callable via REST / OpenAI-compatible interfaces; on the free tier, requests beyond the daily allowance simply fail with no charge. The paid Workers plan ($5/mo) also includes 10,000 free neurons per day, then roughly $0.011 per 1,000 neurons.",
    tips:
      "Neuron consumption varies a lot per model \u2014 each model page lists neurons per input/output and there is an official calculator; the free tier is hard-capped and card-free; reaching Cloudflare from mainland China requires an overseas network.",
    tags: ["Cloudflare official", "Daily refresh", "No credit card", "Overseas network"],
  },
  google_ai_studio: {
    badge: "Free API keys with per-model rate limits",
    description:
      "Google AI Studio (the Gemini developer platform): sign in with a Google account and create free API keys \u2014 the free tier ships per-model rate limits (RPM / TPM / RPD differ per model, see the console Rate limits page) so you can call Gemini models at zero cost. Note: free-tier data may be used to improve Google products (including training); pick the paid tier if that matters. Accessing from mainland China requires an overseas network.",
    tips:
      "Free-tier limits and available models change over time \u2014 the console is authoritative; free and paid tiers have different data policies, keep sensitive workloads on paid.",
    tags: ["Google official", "Gemini family", "Free-tier data trains models", "Overseas network"],
  },
  groq: {
    badge: "Free tier with per-model rate limits and blazing speed",
    description:
      "Groq: an overseas platform built on LPU ultra-fast inference \u2014 sign up and the free tier works immediately. There is no fixed credit grant; instead each model gets its own rate limits (requests per minute/day differ per model, see the console Rate Limits page), letting you call open models like Llama and GPT-OSS for free through an OpenAI-compatible API.",
    tips:
      "The free tier is rate-based, not credit-based \u2014 watch per-model quotas for bulk jobs; requires an overseas network from mainland China.",
    tags: ["LPU speed", "Llama / GPT-OSS", "OpenAI-compatible", "Overseas network"],
  },
  nvidia_nim: {
    badge: "All models free to prototype \u00b7 40 RPM limit",
    description:
      "NVIDIA Build (build.nvidia.com): the current official line is that every catalog model is free to prototype against, limited by rate instead of billed per token, with no credit card \u2014 you only need an NVIDIA account and an API key from settings (verified against the official FAQ/llms.txt on 2026-11-11). Limits: up to 40 RPM for most models plus a 10,000-requests/day cap noted in the site config; per-model limits vary and your ceiling shows in the dashboard (429 beyond it). OpenAI-compatible: point the base URL at https://integrate.api.nvidia.com/v1. The 2024-09 NVIDIA-staff forum answer mentioned 1,000 API credits and a 5,000 catalog cap (+4,000 via a 90-day enterprise license); the credit-to-token conversion was never published and the current site no longer displays credits, so this card quotes no fixed amount.",
    tips:
      "When trial credits run out you can move to pay-as-you-go; whether a specific model has free trial capacity and how fast it burns is governed by the site; requires an overseas network from mainland China.",
    tags: ["NVIDIA official", "Many open models", "OpenAI-compatible", "Overseas network"],
  },

  cerebras: {
    badge: "1,000,000 tokens of free capacity daily",
    description:
      "Cerebras Inference: an overseas platform built on wafer-scale engines for extreme-speed inference. Per the official announcement every developer gets 1,000,000 free tokens per day (single-response output capped at ~8,192 tokens, plus free-tier rate limits — the console is authoritative), covering open models like Llama, GPT-OSS and Qwen. OpenAI-compatible: point the base URL at it from any compatible client; real-world output commonly runs at several hundred tokens per second.",
    tips:
      "The daily allowance refreshes and overflows into paid capacity; free- vs paid-tier rate policies can change — the official Pricing page is authoritative; requires an overseas network from mainland China.",
    tags: ["Wafer-scale speed", "OpenAI-compatible", "Llama / GPT-OSS / Qwen", "Overseas network"],
  },
  modelscope: {
    badge: "2,000 free API-Inference calls per day",
    description:
      "ModelScope’s API-Inference grants 2,000 free calls per day (refreshed daily) across mainstream open models — Qwen3-Coder, the Qwen family, GLM, DeepSeek and more — reachable from mainland China without an overseas network. OpenAI-compatible: bind a ModelScope access token and point any compatible client at it; the international site offers the same.",
    tips:
      "The free tier counts calls, not total tokens; which models and parameters each request may use is governed by the platform docs; some models may require opt-in or throttling — the site is authoritative.",
    tags: ["Alibaba family", "CN direct access", "Qwen full lineup", "OpenAI-compatible"],
  },
  hark: {
    badge: "Free to use · ad-free (free-tier AI quota undisclosed)",
    description:
      "Personal AI assistant (hark.com, desktop app and web): manages orders, email, scheduled tasks and other life admin. Official pricing stance is **Free to use. Never see ads.** — free to use, no ads (checked on the official pricing page, 2026-11-14); the free tier’s concrete model quota / credits allowance has no published numeric terms — in-app terms prevail. This app’s limits card reads the hark.com billing-summary endpoint (requires a signed-in session cookie; the macOS desktop session can be discovered automatically).",
    tips:
      "Limits-card integration lives on the Limits page (save a session cookie or paste a session token). Site: https://hark.com.",
    tags: ["Personal AI agent", "Free to use", "Ad-free", "macOS client"],
  },
  muse_ai: {
    badge: "Invite: both sides get 1B tokens (redeem within 48h of signup)",
    description:
      "Meta’s personal AI agent (muse.ai, app and web): **new accounts can enter an invite code within 48 hours of signup, and both sides get 1B tokens** (verified in-client by the owner, 2026-11-14; redemption path: app Settings → Redeem token, or muse.ai → Settings → Usage → redeem code). **Each invite code can be used up to 30 times** — 1B from your own signup + 30 × 1B from a fully-used code = up to **31B permanent tokens** per account, plus a weekly-resetting free allowance (amount per in-app terms). Tokens are consumable only inside Muse; burn rate and equivalent value have no public pricing — in-app terms prevail.",
    tips:
      "Owner’s invite code: 14TGK4 (27 uses left as of 2026-11-14); the 48-hour window cannot be extended. Site: https://muse.ai.",
    tags: ["Personal AI agent", "In-app use only", "Invite rewards"],
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
