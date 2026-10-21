export const PET_CHARACTER_IDS = ["clawd", "bot", "sprout", "byte", "ember"];

/**
 * How a character is drawn. Explicit because it used to be inferred from the
 * absence of a sprite atlas — which meant "no atlas" was the same thing as
 * "this is Clawd". `bot` also has no atlas (it is drawn from a vector engine),
 * so that inference had to go.
 *
 *   "clawd"  — the hand-authored per-state SVGs under /clawd/
 *   "vector" — the morphing engine in lib/bot/, see BotAnimated.jsx
 *   "atlas"  — a 192x208 sprite sheet, built in or from a pet package
 */
// Prototype-free: a package id like "constructor" would otherwise resolve to Object
// and match neither "vector" nor "atlas", falling through to the Clawd branch.
const RENDERERS = Object.assign(Object.create(null), { clawd: "clawd", bot: "vector" });

/** @returns {"clawd" | "vector" | "atlas"} */
export function petRenderer(character) {
  return RENDERERS[normalizePetCharacter(character)] || "atlas";
}

export function normalizePetCharacter(value) {
  const id = String(value || "").trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(id) ? id : "clawd";
}

/**
 * Pick an ambient scene from real usage context. Calm poses stay heavily weighted so
 * a large usage day does not leave the transparent desktop window animating at 15fps.
 */
export function pickPetAmbientState(stats = {}, random = Math.random) {
  const tokens = Number(stats.todayTokens) || 0;
  if (tokens <= 0) return "sleeping";

  const choices = ["idle-living", "idle-living", "idle-living", "idle-look"];
  if (tokens >= 200_000) choices.push("working-thinking");
  if (tokens >= 500_000) choices.push("working-juggling");
  // "working-overheated" is deliberately NOT an ambient choice: it reuses the error
  // visuals (X-eyes + red pulse), so it must only appear for the genuine rage/overheat
  // gag (see resolvePetState) — never on a healthy heavy-usage day.
  if (tokens >= 2_000_000) choices.push("working-ultrathink");
  if ((stats.topModels?.length || 0) >= 3) choices.push("working-juggling");
  if ((Number(stats.streakDays) || 0) >= 7) choices.push("working-wizard");

  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  return choices[Math.max(0, index)];
}

/** Resolve urgent/live state. Ambient state is supplied separately to keep it calm. */
export function resolvePetState({
  rage = false,
  connected = true,
  syncing = false,
  typing = false,
  celebrating = false,
  todayTokens = 0,
  ambientState = "idle-living",
} = {}) {
  if (rage) return "working-overheated";
  if (!connected) return "disconnected";
  if (syncing || typing) return "working-typing";
  if (celebrating) return "happy";
  if ((Number(todayTokens) || 0) <= 0) return "sleeping";
  return ambientState;
}

/**
 * The six lockable desktop-pet actions (PetPage「动作」picker). Ids are pet sprite
 * states — the same set the PetPage preview strip cycles, so a locked id always
 * resolves to a sprite in src/pet.jsx.
 */
export const PET_ACTION_IDS = [
  "idle-living",
  "working-thinking",
  "working-juggling",
  "working-wizard",
  "happy",
  "sleeping",
];

/**
 * Normalize an action-lock value: "auto" (the default) or a comma-joined subset of
 * the six known sprite states ("working-wizard,sleeping"). Duplicates and unknown
 * tokens are dropped, order is preserved, and selecting all six (or none) means
 * "auto" — no restriction. The single-id form from the first picker release stays
 * valid: it is just a subset of one.
 */
export function normalizePetActionLock(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "auto" || raw.length > 200) return "auto";
  const ids = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (PET_ACTION_IDS.includes(id) && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0 || ids.length === PET_ACTION_IDS.length) return "auto";
  return ids.join(",");
}

/** @returns {string[]} the allowed subset; empty = "auto", no restriction. */
export function parsePetActionLock(value) {
  const normalized = normalizePetActionLock(value);
  return normalized === "auto" ? [] : normalized.split(",");
}

// Which fallback bucket an automatic state belongs to when the user removed it
// from the rotation. Context states (typing/overheat/ultrathink/look) inherit the
// bucket of the action they visually resemble.
const PET_ACTION_BUCKETS = {
  "working-thinking": "working",
  "working-juggling": "working",
  "working-wizard": "working",
  "working-typing": "working",
  "working-overheated": "working",
  "working-ultrathink": "working",
  "idle-living": "idle",
  "idle-look": "idle",
  "idle-doze": "idle",
  happy: "happy",
  sleeping: "sleep",
  disconnected: "disconnected",
};

const PET_ACTION_BUCKET_REPRESENTATIVES = {
  working: "working-thinking",
  idle: "idle-living",
  happy: "happy",
  sleep: "sleeping",
  disconnected: "idle-living",
};

/**
 * Restrict an automatic state to the user-chosen subset: a state still in the
 * rotation passes through; a removed one falls back to the closest allowed action
 * (same bucket first, then working → idle → happy → sleep → first allowed).
 */
export function restrictPetStateToActions(state, allowed) {
  if (!allowed.length || allowed.includes(state)) return state;
  const bucket = PET_ACTION_BUCKETS[state] ?? "idle";
  const fallbackOrder = [
    bucket,
    "working",
    "idle",
    "happy",
    "sleep",
  ];
  for (const key of fallbackOrder) {
    const candidate = PET_ACTION_BUCKET_REPRESENTATIVES[key];
    if (allowed.includes(candidate)) return candidate;
  }
  return allowed[0];
}
