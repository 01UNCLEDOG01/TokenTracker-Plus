import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PET_LIMIT_ROWS,
  readPetLimitSelection,
  togglePetLimitSelection,
  writePetLimitSelection,
} from "./pet-limit-selection.js";

afterEach(() => {
  window.localStorage.clear();
});

describe("pet limit row selection", () => {
  it("migrates pre-unification label keys to the Limits page spec keys", () => {
    window.localStorage.setItem("tt.pet.limitRows", JSON.stringify([
      "antigravity::Gemini weekly",
      "codex::Credits",
      "sensenova::general-weekly",
      "qoder::Ultimate Free Calls",
      "cursor::Plan",
    ]));
    expect(readPetLimitSelection()).toEqual([
      "antigravity::gemini-weekly",
      "codex::credits",
      "sensenova::general-7d",
      "qoder::ultimate",
      "cursor::plan",
    ]);
  });

  it("migrates on write too, so the local API stores only spec keys", () => {
    writePetLimitSelection(["grok::Month", "kimi::Weekly"]);
    expect(JSON.parse(window.localStorage.getItem("tt.pet.limitRows"))).toEqual([
      "grok::month",
      "kimi::weekly",
    ]);
  });

  it("dedupes after migration instead of keeping both spellings", () => {
    writePetLimitSelection(["antigravity::Gemini weekly", "antigravity::gemini-weekly"]);
    expect(readPetLimitSelection()).toEqual(["antigravity::gemini-weekly"]);
  });

  it("refuses a seventh row and reports full", () => {
    const six = [
      "a::1", "b::2", "c::3", "d::4", "e::5", "f::6",
    ].slice(0, MAX_PET_LIMIT_ROWS);
    const result = togglePetLimitSelection(six, "g::7");
    expect(result).toEqual({ list: six, full: true });
    expect(togglePetLimitSelection(six, "a::1").full).toBe(false);
  });
});
