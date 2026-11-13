import "@testing-library/jest-dom/vitest";
import { JSDOM } from "jsdom";

// Node 26 ships an experimental global `localStorage` that is undefined
// unless --localstorage-file is provided, and it shadows the one jsdom
// injects (assignment to it silently fails). Redefine it with a real
// storage so lib/hook tests keep working under the jsdom environment.
// The instance's prototype is aligned with the current window's Storage
// so tests that spy on Storage.prototype keep intercepting writes.
const dom = new JSDOM("", { url: "http://localhost/" });
const storage = dom.window.localStorage;
Object.setPrototypeOf(storage, window.Storage.prototype);
Object.defineProperty(globalThis, "localStorage", {
  value: storage,
  configurable: true,
});

// 语言包已按语言拆 chunk（生产环境异步加载）：测试里预载默认语言，保证 copy()
// 在用例开始前就能同步返回中文，断言与旧行为一致。
const { ensureCopyLocale } = await import("../lib/copy");
// 测试里预载全部语言：生产是按语言按需加载，但用例大量同步 setCopyLocale + 断言，
// 预载后与旧行为一致（每个语言包只有几十 KB，测试内存无压力）。
await Promise.all(["zh-CN", "zh-TW", "ja", "ko", "de"].map((locale) => ensureCopyLocale(locale)));
