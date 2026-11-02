import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { recordCloudPromptFailure } from "../../lib/cloud-prompt-policy.js";
import { useAccountProfileSettings } from "./useAccountProfileSettings.js";
const profile = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
// JWT-shaped: the profile loader readiness-checks the token shape and would
// poll forever on anything that does not decode as one. One stable hoisted
// value: a fresh context object per render would bounce getAccessToken's
// identity and re-run the load effect forever.
const authValue = vi.hoisted(() => ({
  enabled: true,
  signedIn: true,
  user: { id: "private-user", email: "" },
  getAccessToken: vi.fn(async () => `${btoa('{"alg":"HS256"}').replace(/=+$/, "")}.${btoa('{"sub":"private-user"}').replace(/=+$/, "")}.signature`),
}));
vi.mock("../../contexts/InsforgeAuthContext.jsx", () => ({ useInsforgeAuth: () => authValue }));
vi.mock("../../lib/insforge-config", () => ({ getInsforgeRemoteUrl: () => "https://private.example", isOfficialInsforgeInstance: () => false }));
vi.mock("../../lib/api", () => ({ getPublicVisibility: profile.get, setPublicVisibility: profile.set }));
afterEach(cleanup);

// TT-plus changed the contract here: the configured private backend IS this
// account's leaderboard server, so the public-profile switch applies to it
// directly and no longer waits for hosted membership gating. A free
// self-hosted instance gets the full profile editor.
it("keeps the public-profile switch available on a free self-hosted instance", async () => {
  // Seed the shared prompt state with the self-hosted membership the API
  // observer records for an account (the passive billing publisher is gone).
  recordCloudPromptFailure("private-user", "cloud_membership_required", {
    status: "self_hosted", hosting_mode: "self_hosted", can_read_cloud: true, can_upload_cloud: true,
  }, "cloud-sync");
  const { result } = renderHook(useAccountProfileSettings);
  expect(result.current.publicProfileAvailable).toBe(true);
  expect(result.current.publicProfileOn).toBe(false);
  await act(async () => { await result.current.handlePublicProfileToggle(); });
  expect(profile.set).toHaveBeenCalledTimes(1);
});
