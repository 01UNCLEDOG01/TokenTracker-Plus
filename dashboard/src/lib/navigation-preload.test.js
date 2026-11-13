import { describe, expect, it, vi } from "vitest";
import { preloadNavigationPage } from "./navigation-preload.js";

vi.mock("../pages/SkillsPage.jsx", () => ({ SkillsPage: () => null }));

describe("navigation code preload", () => {
  it("shares the in-flight import and reuses the loaded module", async () => {
    const first = preloadNavigationPage("/skills");
    expect(preloadNavigationPage("/skills")).toBe(first);
    expect(await first).toHaveProperty("SkillsPage");
    expect(preloadNavigationPage("/skills")).toBe(first);
  });

  it("ignores unknown destinations and inherited object keys", async () => {
    expect(await preloadNavigationPage("/not-a-page")).toBeNull();
    expect(await preloadNavigationPage("constructor")).toBeNull();
  });
});
