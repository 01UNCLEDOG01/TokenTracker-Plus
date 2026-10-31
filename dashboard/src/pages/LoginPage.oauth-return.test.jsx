/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://ttplus.example"} */
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setCopyLocale } from "../lib/copy";
import { LoginPage } from "./LoginPage.jsx";

const state = vi.hoisted(() => ({
  bridge: null,
  auth: {
    enabled: true, loading: false, signedIn: false,
    refreshUser: vi.fn(async () => undefined),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    getPublicAuthConfig: vi.fn(async () => ({ data: { oAuthProviders: ["github"] } })),
  },
}));
vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({ useInsforgeAuth: () => state.auth }));
vi.mock("../lib/native-bridge.js", () => ({ getNativeOAuthBridge: () => state.bridge }));
vi.mock("../hooks/useLocale.js", () => ({ useLocale: () => ({ resolvedLocale: "en" }) }));

beforeEach(() => {
  setCopyLocale("en");
  state.bridge = null;
  state.auth.signInWithOAuth.mockClear();
  sessionStorage.clear();
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

async function startOAuth(next) {
  const path = "/login?next=" + encodeURIComponent(next);
  window.history.replaceState(null, "", path);
  render(<MemoryRouter initialEntries={[path]}><LoginPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: /GitHub/ }));
}

it("pins desktop OAuth to the exact native scheme", async () => {
  state.bridge = { postMessage: vi.fn() };
  await startOAuth("/dashboard");
  expect(state.auth.signInWithOAuth).toHaveBeenCalledWith("github", "tokentracker://auth/callback");
});

it("does not turn a foreign return destination into an OAuth redirect", async () => {
  await startOAuth("//foreign.example/checkout");
  expect(state.auth.signInWithOAuth).toHaveBeenCalledWith("github", "https://ttplus.example/");
});
