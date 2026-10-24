import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BadgeSynergyBanner } from "./BadgeSynergyBanner.jsx";

function addModuleScript(src) {
  const el = document.createElement("script");
  el.type = "module";
  el.src = src;
  document.body.appendChild(el);
  return el;
}

describe("BadgeSynergyBanner build stamp", () => {
  afterEach(() => {
    document
      .querySelectorAll('script[type="module"]')
      .forEach((el) => el.remove());
    localStorage.clear();
  });

  it("keeps the bundle stamp out of the visible text", () => {
    addModuleScript("/assets/main-CVyMlcPV.js");
    const { container } = render(React.createElement(BadgeSynergyBanner, { badges: [], resonanceTestMode: 1 }));
    const banner = container.firstChild;

    expect(banner.getAttribute("data-build")).toBe("main-CVy");
    const text = `${banner.textContent} ${banner.innerText || ""}`;
    expect(text).not.toMatch(/build/i);
    expect(text).not.toContain("main-CVy");
  });

  it("drops the attribute entirely when no bundle can be identified", () => {
    const { container } = render(React.createElement(BadgeSynergyBanner, { badges: [], resonanceTestMode: 1 }));
    expect(container.firstChild.getAttribute("data-build")).toBeNull();
  });

  it("starts collapsed and remembers the last expanded state", () => {
    const toggleOf = (view) => view.container.querySelector("button[aria-expanded]");
    const first = render(React.createElement(BadgeSynergyBanner, { badges: [], resonanceTestMode: 1 }));
    expect(toggleOf(first).getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem("tt-plus:titles-grid-open")).toBeNull();

    fireEvent.click(toggleOf(first));
    expect(toggleOf(first).getAttribute("aria-expanded")).toBe("true");
    expect(localStorage.getItem("tt-plus:titles-grid-open")).toBe("1");

    first.unmount();
    const second = render(React.createElement(BadgeSynergyBanner, { badges: [], resonanceTestMode: 1 }));
    expect(toggleOf(second).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggleOf(second));
    expect(localStorage.getItem("tt-plus:titles-grid-open")).toBe("0");
  });
});
