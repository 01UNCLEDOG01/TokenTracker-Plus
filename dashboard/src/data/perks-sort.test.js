import { describe, expect, it } from "vitest";
import { comparePerks, getPerkSortKey } from "./perks-sort.mjs";
import { PERK_PROVIDERS } from "./perksData.js";

describe("perks bilingual brand ordering", () => {
  it("uses whichever Chinese pinyin or English brand name comes first", () => {
    expect(getPerkSortKey({ id: "zh-first", sortNames: ["SILICONFLOW", "GUIJI LIUDONG"] })).toBe("GUIJILIUDONG");
    expect(getPerkSortKey({ id: "en-first", sortNames: ["MEITUAN MIAOSHOU", "CATPAW"] })).toBe("CATPAW");
  });

  it("sorts shuffled providers by A-Z, full name and a stable id tie-breaker", () => {
    const rows = [
      { id: "z", sortNames: ["ZCODE"] },
      { id: "b", sortNames: ["AGENT ROUTER"] },
      { id: "c", sortNames: ["AGNES AI"] },
      { id: "a", sortNames: ["AGENT2API"] },
      { id: "same-b", sortNames: ["SAME BRAND"] },
      { id: "same-a", sortNames: ["SAME BRAND"] },
    ];
    expect(rows.toSorted(comparePerks).map((row) => row.id)).toEqual(["a", "b", "c", "same-a", "same-b", "z"]);
    expect(rows[0].id).toBe("z");
  });

  it("rejects missing and malformed brand names", () => {
    for (const sortNames of [undefined, [], [null], [""], ["lowercase"], ["中文"], [" AI"]]) {
      expect(() => getPerkSortKey({ id: "invalid", sortNames })).toThrow(TypeError);
    }
  });

  it("assigns mixed brand names to their earlier letter without generic descriptors", () => {
    const firstLetter = (id) => getPerkSortKey(PERK_PROVIDERS.find((row) => row.id === id))[0];
    expect(firstLetter("siliconflow")).toBe("G");
    expect(firstLetter("catpaw")).toBe("C");
    expect(firstLetter("tuanjie_cowork")).toBe("C");
    expect(firstLetter("spark")).toBe("I");
    expect(firstLetter("unisound_maas")).toBe("U");
    expect(firstLetter("workbuddy_intl")).toBe("W");
  });
});
