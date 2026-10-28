/**
 * 宠物悬浮窗要显示哪几行限额：用户在「限额」页逐行勾选。
 *
 * 存 localStorage 的 `tt.pet.limitRows`，形如 ["qoder::credits", "trae::wallet"]。
 * 与宠物页（pet.html）同源（同样的 origin），所以那边能直接读到，不用改宿主。
 * 没勾选过（键不存在）＝默认取限额页顺序的前 6 行；勾满了就不允许再勾。
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
    if (seen.includes(item)) continue;
    seen.push(item);
  }
  return seen;
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
  window.localStorage.setItem(PET_LIMIT_ROWS_KEY, JSON.stringify(next));
  // 宠物窗口与设置页是不同 window，storage 事件会跨窗口派发；
  // 同窗口消费者用自定义事件兜底。
  window.dispatchEvent(new CustomEvent("tt:pet-limit-rows", { detail: next }));
  return next;
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
