import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderIcon } from "../ProviderIcon.jsx";

describe("brand marks for the newly added sources", () => {
  it("AutoClaw renders the mark taken from its own app bundle", () => {
    const { container } = render(<ProviderIcon provider="autoclaw" size={32} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("/brand-logos/autoclaw.png");
  });

  it("Cola renders the mark taken from its own resources", () => {
    const { container } = render(<ProviderIcon provider="cola" size={32} />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("/brand-logos/cola.png");
  });
});