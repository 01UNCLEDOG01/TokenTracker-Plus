import { beforeEach, describe, expect, it, vi } from "vitest";
import { PET_SNAPSHOT_KEY, readPetSnapshot, writePetSnapshot } from "./pet-window-snapshot.mjs";

describe("pet window snapshot (restart first-frame fallback)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("merges patches and keeps unrelated keys", () => {
    writePetSnapshot({ character: "bot" });
    writePetSnapshot({ botColor: "blue" });
    expect(readPetSnapshot()).toEqual({ character: "bot", botColor: "blue" });
  });

  it("returns an empty object when nothing was stored", () => {
    expect(readPetSnapshot()).toEqual({});
  });

  it("treats corrupt payloads as absent instead of throwing at mount", () => {
    window.localStorage.setItem(PET_SNAPSHOT_KEY, "{not json");
    expect(readPetSnapshot()).toEqual({});
    window.localStorage.setItem(PET_SNAPSHOT_KEY, "[1,2]");
    expect(readPetSnapshot()).toEqual({});
  });

  it("survives storage failures without throwing (first frame only depends on it)", () => {
    // jsdom 每次访问 window.localStorage 都可能给出新实例，spy 必须落在原型上。
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      expect(writePetSnapshot({ character: "bot" })).toBe(false);
      expect(readPetSnapshot()).toEqual({});
    } finally {
      spy.mockRestore();
    }
  });
});
