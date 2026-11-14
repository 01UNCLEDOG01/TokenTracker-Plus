/**
 * 宠物窗口本地快照（2026-11-14，站主报告「每次重启先出现默认 Claude 宠物再切换」）。
 *
 * 壳（PetWindow.cs）的设置快照经 ExecuteScriptAsync 在页面加载完成后才注入，而
 * React 挂载时 window.__ttPet* 尚未就位——默认形象会先渲染一帧。宠物窗口是独立
 * WebView2 profile，localStorage 跨重启保留：把最后已知的形象设置同步落在这里，
 * 挂载时直接兜底首帧；壳快照到达后仍以壳为准，本地只是影子，不参与权威判定。
 */
export const PET_SNAPSHOT_KEY = "tokentracker.pet.window.snapshot.v1";

export function readPetSnapshot() {
  try {
    const raw = window.localStorage.getItem(PET_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writePetSnapshot(patch) {
  try {
    window.localStorage.setItem(PET_SNAPSHOT_KEY, JSON.stringify({ ...readPetSnapshot(), ...patch }));
    return true;
  } catch {
    // 存储不可用（隐私模式/写满）只影响下次重启的首帧形象，不打断当前渲染。
    return false;
  }
}
