"use strict";
// KI-031 model-name canonicalization (2026-10-25, 站主批准).
//
// Two layers, strictly separated:
//  - CANONICAL_ALIASES (SKU layer): variant -> canonical model name. Every
//    mapping was verified empirically (scripts/audit/model-alias-verification.cjs):
//    identical rate fingerprints on every source where both variants appear
//    (站主规则: 使用时间 × 来源 × 当时价格, 价格一致才合并). Case/separator/
//    namespace/-free/channel-prefix variants only.
//  - NEVER_MERGE: pairs that look alike but are different SKUs (different rates
//    or different versions) - recorded so nobody "fixes" them back in.
//
// Preview suffixes and cross-version pairs are different SKUs and never merge
// (MiniMax-M3.1-Flash-Preview, glm-5.2 vs glm-5.3, deepseek-v4 vs v4.1, ...).

const CANONICAL_ALIASES = {
  // deepseek-v4.1 family (0.3/1.2/0.006/0.3 across 8 sources; sn- channel priced identically)
  "DeepSeek-V4.1-Flash": "deepseek-v4.1-flash",
  "deepseek-v4-1-flash": "deepseek-v4.1-flash",
  "deepseek/deepseek-v4.1-flash": "deepseek-v4.1-flash",
  "deepseek-v4.1-flash-free": "deepseek-v4.1-flash",
  "sn-deepseek-v4-1-flash": "deepseek-v4.1-flash",
  // deepseek-v4 family (0.3/1.2/0.006/0.3; the 正式版 spellings are the same SKU)
  "DeepSeek-V4-Flash 正式版": "deepseek-v4-flash",
  "deepseek-v4-flash-正式版": "deepseek-v4-flash",
  "deepseek-v4-flash-free": "deepseek-v4-flash",
  "deepseek-ai/DeepSeek-V4-Flash": "deepseek-v4-flash",
  // glm flash family (0.15/0.5/0.03/0)
  "GLM-5.3-Flash": "glm-5.3-flash",
  "GLM5.3-Flash（估算）": "glm-5.3-flash",
  // glm non-flash: case variant + the zaicoding channel prefix (1.4/4.4/0.26/0 everywhere)
  "GLM-5.2": "glm-5.2",
  "zaicoding_glm-5.3": "GLM-5.3",
  // qwen (0.3333/1.3333/0.0667/0.4167 on trae-cn)
  "qwen-3.7-plus": "Qwen3.7-Plus",
  "qwen3.7-plus": "Qwen3.7-Plus",
  // kimi (0.95/4/0.19/0 and 0.95/4/0.16/0 on their sources)
  "kimi-k2.7-code": "Kimi-K2.7-Code",
  "Kimi-K2.6": "kimi-k2.6",
  // gemini: the -n / -tiered suffixed strings are the same SKU (KI-025 follow-up)
  "gemini-3.8-flash-n": "gemini-3.8-flash",
  "gemini-3.8-flash-tiered": "gemini-3.8-flash",
  // claude dot/hyphen variants (3/15/0.3/3.75 and 5/25/0.5/6.25)
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-opus-4.6": "claude-opus-4-6",
};

// Documented non-merges (verify before ever touching these):
//  kimi-k2.7 (0.6/2)            vs kimi-k2.7-code (0.95/4)   - different SKU
//  GLM-5.3 (1.4/4.4)            vs glm-5.3-flash (0.15/0.5)  - different tier
//  glm-5.2 (1.4/4.4)            vs glm-5.3* - different version, same price
//  deepseek-v4-flash vs deepseek-v4.1-flash - same price, different version
//  MiniMax-M3.1-Flash-Preview   vs MiniMax-M3.1-Flash        - preview = own SKU
//  kimi-k3-1 - awaits an official K3.1 standard rate

function canonicalModelName(model) {
  const raw = String(model || "");
  return Object.prototype.hasOwnProperty.call(CANONICAL_ALIASES, raw) ? CANONICAL_ALIASES[raw] : raw;
}

module.exports = { CANONICAL_ALIASES, canonicalModelName };
