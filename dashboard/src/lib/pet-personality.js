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

  // 平静 only gets two slots now (it used to get four). On a heavy day the pet sat
  // in the calm pose ~44% of the time, which made the animated rows feel like dead
  // weight — and 平静 is the one pose that looks identical whether or not it moves.
  const choices = ["idle-living", "idle-look"];
  if (tokens >= 200_000) choices.push("working-thinking");
  // "working-overheated" is deliberately NOT an ambient choice: it reuses the error
  // visuals (X-eyes + red pulse), so it must only appear for the genuine rage/overheat
  // gag (see resolvePetState) — never on a healthy heavy-usage day.
  // 10M is the "super heavy" tier: users who burn that much in a day get the
  // deepest working pose on top of everything else.
  if (tokens >= 10_000_000) choices.push("working-ultrathink");
  // Trotting is NOT an ambient choice: rows 1/2 belong to dragging only. It used to
  // be pushed into this pool so the row was not dead weight, which made the pet
  // sprint in place for no reason — the drag handler in pet.jsx is the only caller.
  // 多模型 owns its own atlas row (row5), so it is keyed on the model count alone.
  // It used to be pushed a second time by the token threshold as well, which
  // doubled its weight in the pool and made one pose twice as likely as the rest.
  if ((stats.topModels?.length || 0) >= 3) choices.push("working-juggling");
  // 新增用量 (上香) also shows up on its own between real usage events, so the
  // celebration pose is not limited to the 3s burst that follows a token increase.
  if (tokens >= 1_000_000) choices.push("happy");
  // 连续活跃 gets a double slot: it is the 摇六爻 pose, the one worth seeing most,
  // and the only ambient state that rewards a long streak. Kept last so the
  // existing "last candidate" assertion in pet-personality.test.js still holds.
  if ((Number(stats.streakDays) || 0) >= 7) choices.push("working-wizard", "working-wizard");

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
  // Trotting is deliberately absent: rows 1/2 are the directional pair driven only
  // by dragging, so it cannot be locked. The picker still lists it, disabled.
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
  "running-right": "run",
  "running-left": "run",
};

const PET_ACTION_BUCKET_REPRESENTATIVES = {
  working: "working-thinking",
  idle: "idle-living",
  happy: "happy",
  sleep: "sleeping",
  disconnected: "idle-living",
  run: "running-right",
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
    "run",
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
