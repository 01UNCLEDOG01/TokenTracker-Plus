import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("keeps working when the snapshot write hits the storage quota (2026-11-10 incident)", async () => {
    // A full storage used to throw QuotaExceededError straight out of
    // writePetLimitSelection and crash the whole Limits page render. The
    // snapshot is best-effort; the remote authority (pet-prefs.json) must
    // still receive the save.
    const events = [];
    const onRows = (e) => events.push(e.detail);
    window.addEventListener("tt:pet-limit-rows", onRows);
    const fetchCalls = [];
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      fetchCalls.push({ input, init });
      return { ok: true, json: async () => ({}) };
    };
    // setupTests replaces globalThis.localStorage with a foreign JSDOM storage
    // instance, so instance-level spyOn does not intercept — spy the prototype
    // (see setupTests.ts comment) the same way the quota incident would bite.
    const setItemSpy = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    });
    try {
      expect(writePetLimitSelection(["codex::credits"])).toEqual(["codex::credits"]);
      expect(events).toEqual([["codex::credits"]]);
      await vi.waitFor(() => expect(fetchCalls).toHaveLength(1));
      expect(fetchCalls[0].input).toBe("/functions/tokentracker-pet-prefs");
      expect(JSON.parse(fetchCalls[0].init.body)).toEqual({ limitRows: ["codex::credits"] });
    } finally {
      setItemSpy.mockRestore();
      window.fetch = originalFetch;
      window.removeEventListener("tt:pet-limit-rows", onRows);
    }
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
