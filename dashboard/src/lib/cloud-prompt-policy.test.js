import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCloudPromptBackendState,
  clearCloudPromptFailure,
  cloudPromptOwnerFromToken,
  cloudPromptRevision,
  readCloudPromptState,
  recordCloudPromptFailure,
  recordCloudPromptIntent,
  subscribeCloudPrompts,
} from "./cloud-prompt-policy.js";

const free = { status: "free", can_read_cloud: false, can_upload_cloud: false };
const selfHosted = { status: "self_hosted", hosting_mode: "self_hosted", can_read_cloud: true, can_upload_cloud: true };

beforeEach(() => {
  clearCloudPromptBackendState();
});

describe("cloud prompt failure observation", () => {
  it("keeps access failures scoped to the reporting owner", () => {
    recordCloudPromptFailure("owner-one", "cloud_membership_required", free, "account-hourly");

    const state = readCloudPromptState("owner-one");
    expect(state.failure).toEqual({ code: "cloud_membership_required", source: "account-hourly" });
    expect(state.membership).toBe(free);
    expect(readCloudPromptState("owner-two").membership).toBeUndefined();
    expect(readCloudPromptState("owner-two").failure).toBeUndefined();
  });

  it("ignores non-access codes and unknown owners", () => {
    for (const code of ["cloud_ok", "network_down", ""]) {
      recordCloudPromptFailure("owner-one", code, free, "account-hourly");
      expect(readCloudPromptState("owner-one").failure).toBeUndefined();
    }
    recordCloudPromptFailure(null, "cloud_membership_required", free, "account-hourly");
    expect(readCloudPromptState("owner-two").failure).toBeUndefined();
  });

  it("records machine-count context from the rejected response", () => {
    recordCloudPromptFailure("owner-one", "cloud_machine_limit", free, "account-hourly", { machineCount: 4 });
    expect(readCloudPromptState("owner-one").machineCount).toBe(4);
    recordCloudPromptFailure("owner-one", "cloud_machine_limit", free, "account-hourly", { machineCount: "4" });
    expect(readCloudPromptState("owner-one").machineCount).toBe(4);
  });

  it("clears only the failure reported by the same source", () => {
    recordCloudPromptFailure("owner-one", "cloud_membership_required", free, "account-hourly");

    clearCloudPromptFailure("owner-one", "account-summary");
    expect(readCloudPromptState("owner-one").failure).toBeTruthy();
    clearCloudPromptFailure("owner-other", "account-hourly");
    expect(readCloudPromptState("owner-one").failure).toBeTruthy();
    clearCloudPromptFailure("owner-one", "account-hourly");
    expect(readCloudPromptState("owner-one").failure).toBeNull();
    expect(readCloudPromptState("owner-one").membership).toBe(free);
  });
});

describe("cloud prompt intents", () => {
  it("records a known scene and drops a stale failure", () => {
    recordCloudPromptFailure("owner-one", "cloud_membership_required", free, "account-hourly");
    recordCloudPromptIntent("owner-one", "history");
    const state = readCloudPromptState("owner-one");
    expect(state.intent).toBe("history");
    expect(state.failure).toBeNull();
  });

  it("ignores unknown scenes and missing owners", () => {
    recordCloudPromptIntent("owner-one", "leaderboard");
    expect(readCloudPromptState("owner-one").intent).toBeUndefined();
    recordCloudPromptIntent("", "history");
    expect(readCloudPromptState("owner-one").intent).toBeUndefined();
  });
});

describe("cloud prompt subscriptions", () => {
  it("notifies subscribers and bumps the revision on every change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCloudPrompts(listener);
    const start = cloudPromptRevision();

    recordCloudPromptIntent("owner-one", "sync");
    recordCloudPromptFailure("owner-two", "cloud_membership_required", free, "account-daily");
    clearCloudPromptFailure("owner-two", "account-daily");

    expect(listener).toHaveBeenCalledTimes(3);
    expect(cloudPromptRevision()).toBe(start + 3);
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCloudPrompts(listener);
    unsubscribe();
    recordCloudPromptIntent("owner-one", "sync");
    expect(listener).not.toHaveBeenCalled();
  });

  it("reacts to cross-tab storage events for its namespace", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCloudPrompts(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: "other.key" }));
    expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: "tt.cloud.prompt.owner-one" }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("clears every observed account on backend reset", () => {
    recordCloudPromptFailure("owner-one", "cloud_membership_required", free, "account-hourly");
    clearCloudPromptBackendState();
    expect(readCloudPromptState("owner-one").failure).toBeUndefined();
    expect(readCloudPromptState("owner-one").membership).toBeUndefined();
  });
});

describe("cloud prompt owner parsing", () => {
  const tokenFor = (payload) => `${btoa('{"alg":"HS256"}')}.${btoa(JSON.stringify(payload))}.signature`;

  it("reads the owner from the JWT subject", () => {
    expect(cloudPromptOwnerFromToken(tokenFor({ sub: "owner-one" }))).toBe("owner-one");
  });

  it("rejects missing, malformed and oversized subjects", () => {
    expect(cloudPromptOwnerFromToken(undefined)).toBeNull();
    expect(cloudPromptOwnerFromToken("not-a-token")).toBeNull();
    expect(cloudPromptOwnerFromToken("a.@@@.c")).toBeNull();
    expect(cloudPromptOwnerFromToken(tokenFor({ sub: "x".repeat(129) }))).toBeNull();
    expect(cloudPromptOwnerFromToken(tokenFor({ sub: 42 }))).toBeNull();
  });
});
