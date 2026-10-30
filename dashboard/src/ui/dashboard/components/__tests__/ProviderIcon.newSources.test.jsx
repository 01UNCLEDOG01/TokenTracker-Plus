import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderIcon } from "../ProviderIcon.jsx";

describe("brand marks for the newly added sources", () => {
  // The asset identity is what these assert, not the cache-busting suffix:
  // `?v=` is mandatory by repo rule whenever a brand logo is replaced, so an
  // exact-equality assertion goes red on every legitimate version bump
  // (that is how the cola.png?v=3 batch shipped a red test on 2026-10-30).
  it("AutoClaw renders the mark taken from its own app bundle", () => {
    const { container } = render(<ProviderIcon provider="autoclaw" size={32} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toMatch(/^\/brand-logos\/autoclaw\.png(\?v=\d+)?$/);
  });

  it("Cola renders the mark taken from its own resources", () => {
    const { container } = render(<ProviderIcon provider="cola" size={32} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toMatch(/^\/brand-logos\/cola\.png(\?v=\d+)?$/);
  });
});