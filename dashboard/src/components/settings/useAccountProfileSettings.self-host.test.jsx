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

it("头像上传：选图即压缩成 data URL 直接保存，不再要求贴链接", async () => {
  // jsdom 没有 canvas：stub 出最小实现，验证「选图→data URL→直接保存」的链路
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} });
  HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64," + "A".repeat(600);
  try {
    profile.get.mockResolvedValue({ avatar_url: null });
    const { result } = renderHook(useAccountProfileSettings);
    await act(async () => { await Promise.resolve(); });
    const file = new File(["pretend-image-bytes"], "me.png", { type: "image/png" });
    // Image 解码在 jsdom 不可用：stub URL.createObjectURL 与 Image
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:stub";
    URL.revokeObjectURL = () => {};
    const OriginalImage = window.Image;
    class StubImage {
      set src(v) { setTimeout(() => this.onload && this.onload(), 0); }
    }
    window.Image = StubImage;
    try {
      await act(async () => { await result.current.avatar.handleAvatarFile(file); });
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      window.Image = OriginalImage;
    }
    // mutateProfile 可能拆字段调用：在所有 set 参数里递归找 data URL
    const flat = JSON.stringify(profile.set.mock.calls);
    expect(flat).toContain("data:image/jpeg;base64,");
  } finally {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toDataURL = originalToDataURL;
  }
});
