import { describe, expect, it } from "vitest";
import {
  normalizePetActionLock,
  normalizePetCharacter,
  parsePetActionLock,
  pickPetAmbientState,
  restrictPetStateToActions,
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
  it("keeps whitelisted subsets, drops unknown tokens and dedupes", () => {
    expect(normalizePetActionLock("working-wizard,sleeping")).toBe("working-wizard,sleeping");
    expect(normalizePetActionLock("SLEEPING, working-wizard ,sleeping")).toBe("sleeping,working-wizard");
    expect(normalizePetActionLock("happy,nonsense,sleeping")).toBe("happy,sleeping");
    expect(normalizePetActionLock("nonsense")).toBe("auto");
    expect(normalizePetActionLock("working-overheated")).toBe("auto");
    expect(normalizePetActionLock("mini-sleep")).toBe("auto");
  });

  it("collapses empty, complete and oversized selections to auto", () => {
    expect(normalizePetActionLock(undefined)).toBe("auto");
    expect(normalizePetActionLock(null)).toBe("auto");
    expect(normalizePetActionLock("")).toBe("auto");
    expect(normalizePetActionLock("auto")).toBe("auto");
    expect(normalizePetActionLock(PET_ACTION_IDS.join(","))).toBe("auto");
    expect(normalizePetActionLock(`${PET_ACTION_IDS.join(",")},,x`.repeat(30))).toBe("auto");
  });

  it("still accepts the single-id form from the first picker release", () => {
    expect(normalizePetActionLock("working-wizard")).toBe("working-wizard");
    expect(parsePetActionLock("working-wizard")).toEqual(["working-wizard"]);
  });

  it("parse returns the allowed subset, empty for auto", () => {
    expect(parsePetActionLock("auto")).toEqual([]);
    expect(parsePetActionLock("sleeping,happy")).toEqual(["sleeping", "happy"]);
    expect(parsePetActionLock(undefined)).toEqual([]);
  });
});

describe("restrictPetStateToActions", () => {
  it("passes kept states through untouched", () => {
    expect(restrictPetStateToActions("working-wizard", ["working-wizard", "sleeping"])).toBe("working-wizard");
  });

  it("maps removed actions to the closest kept bucket", () => {
    const kept = ["working-thinking", "sleeping"];
    expect(restrictPetStateToActions("working-typing", kept)).toBe("working-thinking");
    expect(restrictPetStateToActions("working-overheated", kept)).toBe("working-thinking");
    expect(restrictPetStateToActions("idle-living", kept)).toBe("working-thinking");
    expect(restrictPetStateToActions("happy", kept)).toBe("working-thinking");
    expect(restrictPetStateToActions("disconnected", kept)).toBe("working-thinking");
    expect(restrictPetStateToActions("sleeping", kept)).toBe("sleeping");
  });

  it("falls back to the first allowed action as the last resort", () => {
    expect(restrictPetStateToActions("working-typing", ["sleeping"])).toBe("sleeping");
    expect(restrictPetStateToActions("sleeping", ["idle-living"])).toBe("idle-living");
  });

  it("leaves everything alone for the auto (empty) rotation", () => {
    expect(restrictPetStateToActions("working-typing", [])).toBe("working-typing");
    expect(restrictPetStateToActions("disconnected", [])).toBe("disconnected");
  });
});
