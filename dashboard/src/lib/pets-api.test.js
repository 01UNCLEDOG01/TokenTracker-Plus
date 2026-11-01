import { afterEach, describe, expect, it, vi } from "vitest";
import { listPets } from "./pets-api.js";

describe("pets api catalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the atlas-less built-ins and filters bundled pets hidden by the local runtime", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      pets: [{
        id: "community-pet",
        displayName: "Community Pet",
        custom: true,
      }],
      // clawd and bot are listed to prove they cannot be hidden: neither has an
      // atlas to reclaim, so neither is removable.
      hiddenBuiltinIds: ["byte", "ember", "clawd", "bot", "unknown"],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const pets = await listPets();

    expect(pets.map((pet) => pet.id)).toEqual([
      "clawd",
      "bot",
      "sprout",
      // TT-plus 自有角色，默认不隐藏
      "gengxu",
      "yeacat",
      "community-pet",
    ]);
  });

  it("versions bundled atlas URLs so a corrected sprite can replace an immutable cache", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ pets: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const pets = await listPets();
    const atlased = pets.filter((pet) => pet.assetUrl?.startsWith("/pets/"));

    expect(atlased.length).toBeGreaterThan(0);
    for (const pet of atlased) {
      expect(pet.assetUrl).toMatch(/^\/pets\/[a-z0-9-]+\/spritesheet\.webp\?v=.+$/);
    }
  });
});
