import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PetAtlasAnimated, petAtlasRowForState } from "./PetAtlasAnimated.jsx";

describe("PetAtlasAnimated", () => {
  it("maps live data states to distinct atlas actions", () => {
    expect(petAtlasRowForState("working-thinking")).toBe("review");
    expect(petAtlasRowForState("working-juggling")).toBe("multitask");
    expect(petAtlasRowForState("working-wizard")).toBe("running");
    expect(petAtlasRowForState("happy")).toBe("jumping");
    expect(petAtlasRowForState("sleeping")).toBe("waiting");
    expect(petAtlasRowForState("idle-living")).toBe("idle");
  });

  it("gives every picker action, the greeting and both trots their own row", () => {
    // 6 standard actions + 1 greeting + 2 directional trots = 9 rows, no sharing.
    const rows = [
      petAtlasRowForState("idle-living"),
      petAtlasRowForState("working-thinking"),
      petAtlasRowForState("working-juggling"),
      petAtlasRowForState("working-wizard"),
      petAtlasRowForState("happy"),
      petAtlasRowForState("sleeping"),
      petAtlasRowForState("waking"),
      petAtlasRowForState("running-right"),
      petAtlasRowForState("running-left"),
    ];
    expect(rows).toHaveLength(9);
    expect(new Set(rows).size).toBe(9);
  });

  it("routes offline and error feedback to the greeting row", () => {
    expect(petAtlasRowForState("disconnected")).toBe("waving");
    expect(petAtlasRowForState("error")).toBe("waving");
    expect(petAtlasRowForState("working-overheated")).toBe("waving");
  });

  it("loads the selected character's independent sprite atlas", () => {
    const { container } = render(<PetAtlasAnimated character="byte" state="happy" size={208} />);
    const sprite = container.firstElementChild;
    expect(sprite).toHaveStyle({
      width: "192px",
      height: "208px",
      backgroundImage: "url(/pets/byte/spritesheet.webp)",
      backgroundSize: "800% 900%",
    });
  });

  it("maps all 16 V2 look directions across rows 9 and 10", () => {
    const pet = {
      id: "samara-v2",
      spriteVersionNumber: 2,
      assetUrl: "/api/pets/local/samara-v2/spritesheet.webp",
    };
    const { container, rerender } = render(
      <PetAtlasAnimated character={pet.id} pet={pet} lookDirectionIndex={0} size={208} />,
    );
    expect(container.firstElementChild).toHaveStyle({
      backgroundImage: "url(/api/pets/local/samara-v2/spritesheet.webp)",
      backgroundSize: "800% 1100%",
      backgroundPosition: "0% 90%",
    });
    rerender(<PetAtlasAnimated character={pet.id} pet={pet} lookDirectionIndex={15} size={208} />);
    expect(container.firstElementChild).toHaveStyle({
      backgroundPosition: "100% 100%",
    });
    rerender(
      <PetAtlasAnimated character={pet.id} pet={pet} state="happy" lookDirectionIndex={15} size={208} />,
    );
    expect(container.firstElementChild).toHaveStyle({
      backgroundPosition: "0% 40%",
    });
  });

  it("uses the directional running row while a desktop drag is active", () => {
    const { container } = render(
      <PetAtlasAnimated
        character="byte"
        state="idle-living"
        dragState="running-left"
        size={208}
      />,
    );
    expect(container.firstElementChild).toHaveStyle({
      backgroundPosition: "0% 25%",
    });
  });
});
