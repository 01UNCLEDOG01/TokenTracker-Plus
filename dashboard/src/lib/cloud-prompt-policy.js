import { getInsforgeRemoteUrl } from "./insforge-config";

// Shared cloud-prompt state used by the settings/account hooks and the API
// error observer. This module is intentionally state-only: the fork does not
// sell or prompt for memberships, so no decision/prompt-rendering layer lives
// here (that upstream surface was removed with the rest of commercialization).
const scenes = new Set(["sync", "view", "history", "devices"]);
const accessCodes = new Set([
  "cloud_membership_required", "cloud_read_only_expired", "cloud_history_window_exceeded",
  "cloud_machine_limit", "machine_limit_exceeded", "cloud_machine_paused",
]);
const accounts = new Map();
const listeners = new Set();
let revision = 0;
function accountKey(userId) {
  return `${encodeURIComponent(getInsforgeRemoteUrl() || "unconfigured")}.${userId}`;
}

function changed() {
  revision += 1;
  for (const listener of listeners) listener();
}
export function subscribeCloudPrompts(listener) {
  if (listeners.size === 0 && typeof window !== "undefined")
    window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);
  };
}
function onStorage(event) {
  if (event.key?.startsWith("tt.cloud.prompt.")) changed();
}
export function cloudPromptRevision() { return revision; }
export function clearCloudPromptBackendState() {
  accounts.clear();
  changed();
}
export function readCloudPromptState(userId) {
  return { ...accounts.get(accountKey(userId)) };
}
export function cloudPromptOwnerFromToken(token) {
  try {
    const value = JSON.parse(atob(String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof value.sub === "string" && value.sub.length <= 128 ? value.sub : null;
  } catch { return null; }
}

export function recordCloudPromptIntent(userId, scene) {
  if (!userId || !scenes.has(scene)) return;
  const previous = accounts.get(accountKey(userId)) || {};
  accounts.set(accountKey(userId), { ...previous, intent: scene, failure: null });
  changed();
}
export function recordCloudPromptFailure(userId, code, membership, source, details = {}) {
  if (!userId || !accessCodes.has(code)) return;
  const previous = accounts.get(accountKey(userId)) || {};
  const next = { ...previous, membership: membership || previous.membership,
    failure: { code, source } };
  if (Number.isFinite(details?.machineCount)) next.machineCount = details.machineCount;
  accounts.set(accountKey(userId), next);
  changed();
}
export function clearCloudPromptFailure(userId, source) {
  const previous = accounts.get(accountKey(userId));
  if (previous?.failure?.source !== source) return;
  accounts.set(accountKey(userId), { ...previous, failure: null });
  changed();
}
