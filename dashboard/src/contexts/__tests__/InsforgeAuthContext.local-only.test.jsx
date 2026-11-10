/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InsforgeAuthProvider, useInsforgeAuth } from "../InsforgeAuthContext.jsx";

vi.mock("../../lib/insforge-session-recovery.mjs", () => ({ restoreInsforgeUser: vi.fn() }));
vi.mock("../../lib/local-api-auth", () => ({ clearLocalApiAuthToken: vi.fn(), getLocalApiAuthHeaders: async () => ({}) }));

function AuthStateProbe() {
  const auth = useInsforgeAuth();
  return (
    <>
      <span data-testid="enabled">{String(auth.enabled)}</span>
      <span data-testid="error">{String(auth.configurationError ?? "none")}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
    </>
  );
}

function renderAuth() {
  return render(<InsforgeAuthProvider><AuthStateProbe /></InsforgeAuthProvider>);
}

beforeEach(() => { delete window.__TOKENTRACKER_RUNTIME_CONFIG__; });
afterEach(() => { cleanup(); delete window.__TOKENTRACKER_RUNTIME_CONFIG__; });

it("stays silently local-only for the CLI's no-cloud runtime descriptor", async () => {
  // The banner copy (instance.configuration.invalid) is rendered from
  // insforge.configurationError in App.jsx / LoginCard / LoginPage / LoginModal.
  window.__TOKENTRACKER_RUNTIME_CONFIG__ = {
    baseUrl: "", anonKey: null, dashboardUrl: "", configurationError: null,
    localHistory: true, localOnly: true,
  };
  renderAuth();
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
  expect(screen.getByTestId("enabled").textContent).toBe("false");
  expect(screen.getByTestId("error").textContent).toBe("none");
});

it("still reports a genuinely broken self-hosted runtime descriptor", async () => {
  window.__TOKENTRACKER_RUNTIME_CONFIG__ = {
    baseUrl: "", anonKey: null, dashboardUrl: "", configurationError: "invalid_local_config",
    localHistory: true, localOnly: true,
  };
  renderAuth();
  await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
  expect(screen.getByTestId("enabled").textContent).toBe("false");
  expect(screen.getByTestId("error").textContent).toBe("runtime_configuration_error");
});
