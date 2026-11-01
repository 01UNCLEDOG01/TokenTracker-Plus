import { describe, expect, it } from "vitest";
import {
  CLAWD_VISUAL_SCALE,
  petCardTintHex,
  petPillDotColor,
  petVisualScale,
} from "./pet-appearance.js";

describe("petVisualScale", () => {
  it("normalizes tightly cropped Clawd without shrinking atlas pets", () => {
    expect(CLAWD_VISUAL_SCALE).toBe(0.84);
    expect(petVisualScale("clawd")).toBe(0.84);
    expect(petVisualScale("sprout")).toBe(1);
    expect(petVisualScale("byte")).toBe(1);
    expect(petVisualScale("ember")).toBe(1);
  });
});

describe("petPillDotColor", () => {
  it("themes every built-in pet by its art and falls back to null elsewhere", () => {
    expect(petPillDotColor("clawd")).toMatch(/^#[0-9a-f]{6}$/);
    expect(petPillDotColor("byte")).toMatch(/^#[0-9a-f]{6}$/);
    expect(petPillDotColor("sprout")).toMatch(/^#[0-9a-f]{6}$/);
    expect(petPillDotColor("ember")).toMatch(/^#[0-9a-f]{6}$/);
    expect(petPillDotColor("yeacat")).toMatch(/^#[0-9a-f]{6}$/);
    expect(petPillDotColor("bot")).toBe(null);
    expect(petPillDotColor("not-a-pet")).toBe(null);
  });
});

describe("petCardTintHex", () => {
  it("derives card tints from the pill-dot table and greys unknown pets", () => {
    expect(petCardTintHex("byte")).toBe(petPillDotColor("byte"));
    expect(petCardTintHex("yeacat")).toBe(petPillDotColor("yeacat"));
    expect(petCardTintHex("bot")).toMatch(/^#[0-9a-f]{6}$/);
    expect(petCardTintHex("not-a-pet")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
