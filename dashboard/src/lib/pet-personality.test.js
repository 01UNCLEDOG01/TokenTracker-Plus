import { describe, expect, it } from "vitest";
import {
  normalizePetActionLock,
  normalizePetCharacter,
  pickPetAmbientState,
  resolvePetState,
  PET_ACTION_IDS,
} from "./pet-personality";

describe("pet personality", () => {
  it("accepts package slugs and rejects unsafe character ids", () => {
    expect(normalizePetCharacter("BYTE")).toBe("byte");
    expect(normalizePetCharacter("community-pet")).toBe("community-pet");
    expect(normalizePetCharacter("../unsafe")).toBe("clawd");
  });

  it("resolves live states in a stable priority order", () => {
    expect(resolvePetState({ rage: true, connected: false })).toBe("working-overheated");
    expect(resolvePetState({ connected: false, syncing: true })).toBe("disconnected");
    expect(resolvePetState({ syncing: true, celebrating: true })).toBe("working-typing");
    expect(resolvePetState({ celebrating: true, todayTokens: 10 })).toBe("happy");
    expect(resolvePetState({ todayTokens: 0, ambientState: "working-wizard" })).toBe("sleeping");
  });

  it("adds data-specific ambient actions without making them permanent", () => {
    const rich = { todayTokens: 2_500_000, streakDays: 8, topModels: [{}, {}, {}] };
    expect(pickPetAmbientState(rich, () => 0)).toBe("idle-living");
    expect(pickPetAmbientState(rich, () => 0.999)).toBe("working-wizard");
    expect(pickPetAmbientState({ todayTokens: 0 }, () => 0.5)).toBe("sleeping");
  });

});

describe("normalizePetActionLock", () => {
  it("passes through the six lockable actions and pins nothing else", () => {
    for (const id of PET_ACTION_IDS) {
      expect(normalizePetActionLock(id)).toBe(id);
      expect(PET_ACTION_IDS.includes(normalizePetActionLock(id.toUpperCase()))).toBe(true);
    }
    expect(normalizePetActionLock("working-overheated")).toBe("auto");
    expect(normalizePetActionLock("mini-sleep")).toBe("auto");
  });

  it("treats missing, empty and auto values as usage-driven switching", () => {
    expect(normalizePetActionLock(undefined)).toBe("auto");
    expect(normalizePetActionLock(null)).toBe("auto");
    expect(normalizePetActionLock("")).toBe("auto");
    expect(normalizePetActionLock("  ")).toBe("auto");
    expect(normalizePetActionLock("auto")).toBe("auto");
  });
});
