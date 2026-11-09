/**
 * 宠物悬浮窗要显示哪几行限额：用户在「限额」页逐行勾选。
 *
 * 权威存储是本地 API 的 `POST/GET /functions/tokentracker-pet-prefs`
 * （`~/.tokentracker/tracker/pet-prefs.json`）：宠物窗口是独立的 WebView2
 * 用户数据目录，localStorage 与 storage 事件都跨不过去（旧注释曾假设能跨，
 * 导致勾选后悬浮卡永远不更新）。localStorage 只作同窗口快照与浏览器
 * （非内嵌）环境的兜底。没勾选过＝默认取限额页顺序的前 6 行；勾满了
 * 就不允许再勾。
 */
export const PET_LIMIT_ROWS_KEY = "tt.pet.limitRows";
export const MAX_PET_LIMIT_ROWS = 6;

export function petLimitRowKey(providerId, windowKey) {
  return `${providerId}::${windowKey}`;
}

function normalize(list) {
  if (!Array.isArray(list)) return null;
  const seen = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.includes("::")) continue;
    const migrated = migrateLegacyKey(item);
    if (seen.includes(migrated)) continue;
    seen.push(migrated);
  }
  return seen;
}

// Before the row keys were unified with the Limits page's spec keys, the pet
// builder used its display labels as keys ("antigravity::Gemini weekly",
// "codex::Credits", …). Without this map an upgraded selection would silently
// match nothing — and with 6 stale keys the picker locks up (nothing checked,
// everything disabled). Keys produced from localized labels have no stable
// mapping; they are dropped and the user re-picks once.
const LEGACY_PET_ROW_KEYS = {
  claude: { Opus: "opus" },
  codex: { Credits: "credits", "Spark 5h": "spark-5h", "Spark 7d": "spark-7d" },
  cursor: { Plan: "plan", Auto: "auto", API: "api" },
  gemini: { Pro: "pro", Flash: "flash", Lite: "lite" },
  kimi: { Weekly: "weekly", Total: "total" },
  kiro: { Month: "month", Bonus: "bonus" },
  grok: { Month: "month", "On-demand": "ondemand" },
  copilot: { Premium: "premium", Chat: "chat" },
  antigravity: {
    "Gemini weekly": "gemini-weekly",
    "Gemini 5h": "gemini-5h",
    "Claude weekly": "claude-weekly",
    "Claude 5h": "claude-5h",
  },
  sensenova: { "general-weekly": "general-7d" },
  zcode: { Weekly: "weekly", Tools: "tools", "GLM-5.2": "glm52", "GLM-5 Turbo": "glm5t" },
  opencodeGo: { Weekly: "weekly", Month: "monthly" },
  qoder: { Credits: "credits", "Ultimate Free Calls": "ultimate" },
  codingPlan: { Week: "weekly", Month: "monthly" },
};

function migrateLegacyKey(item) {
  const at = item.indexOf("::");
  const providerId = item.slice(0, at);
  const key = item.slice(at + 2);
  const remap = LEGACY_PET_ROW_KEYS[providerId];
  const nextKey = remap && Object.hasOwn(remap, key) ? remap[key] : key;
  return `${providerId}::${nextKey}`;
}

/** `null` = 用户从没勾过，调用方走默认（前 6 行）。 */
export function readPetLimitSelection() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(PET_LIMIT_ROWS_KEY);
    if (!raw) return null;
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePetLimitSelection(list) {
  if (typeof window === "undefined" || !window.localStorage) return list;
  const next = normalize(list) || [];
  // 快照写入必须自吞异常：权威存储是本地 API（见上），localStorage 一旦被
  // 响应缓存塞满，这里抛 QuotaExceededError 会把整个限额页渲染崩掉
  // （2026-11-10 事故：勾选即「这个视图渲染失败了」）。
  try {
    window.localStorage.setItem(PET_LIMIT_ROWS_KEY, JSON.stringify(next));
  } catch {
    // 快照丢失可接受：远程保存照常发起，重载后由权威存储回填。
  }
  // The pet window lives in a separate WebView2 profile: neither localStorage
  // nor the storage event reaches it (this used to be assumed otherwise, which
  // is why picked rows never showed up on the floating card). The local API is
  // the meeting point both windows can reach; localStorage stays as the
  // same-window fast path and browser (non-embed) fallback.
  window.dispatchEvent(new CustomEvent("tt:pet-limit-rows", { detail: next }));
  void savePetLimitSelectionRemote(next);
  return next;
}

export async function savePetLimitSelectionRemote(list) {
  try {
    await fetch("/functions/tokentracker-pet-prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limitRows: normalize(list) || [] }),
    });
  } catch {
    // Best effort: the pet keeps its last known selection until the next save.
  }
}

/** `null` = nothing stored yet; the pet then falls back to its default rows. */
export async function fetchPetLimitSelectionRemote() {
  try {
    const res = await fetch("/functions/tokentracker-pet-prefs", { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    return normalize(body?.limitRows);
  } catch {
    return null;
  }
}

/** 勾/取消。超过 6 条时返回原列表并带 `full: true`，调用方负责提示。 */
export function togglePetLimitSelection(current, key) {
  const list = Array.isArray(current) ? current : [];
  if (list.includes(key)) {
    return { list: list.filter((item) => item !== key), full: false };
  }
  if (list.length >= MAX_PET_LIMIT_ROWS) {
    return { list, full: true };
  }
  return { list: [...list, key], full: false };
}
