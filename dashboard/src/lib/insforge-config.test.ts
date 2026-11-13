import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@insforge/sdk", () => ({ createClient: sdk.create }));
const anon = (name: string) => `${btoa('{"alg":"HS256"}').replace(/=+$/, "")}.${btoa(JSON.stringify({ role: "anon", sub: name })).replace(/=+$/, "")}.signature`;
beforeEach(() => {
  vi.resetModules();
  sdk.create.mockReset().mockImplementation((config) => ({ config, tokenManager: { clearSession: vi.fn() } }));
  localStorage.clear(); sessionStorage.clear();
  delete window.__TOKENTRACKER_RUNTIME_CONFIG__;
  for (const key of ["VITE_INSFORGE_BASE_URL", "VITE_INSFORGE_ANON_KEY", "VITE_TOKENTRACKER_BACKEND_BASE_URL", "VITE_TOKENTRACKER_BACKEND_ANON_KEY"]) vi.stubEnv(key, "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); delete window.__TOKENTRACKER_RUNTIME_CONFIG__; });

describe("instance-bound frontend SDK", () => {
  it("keeps the SDK singleton and OAuth callback behavior for an explicitly configured deployment", async () => {
    // Local-first: no bundled official fallback — pin an explicit build
    // deployment so the singleton behavior is exercised without runtime
    // overrides.
    vi.stubEnv("VITE_INSFORGE_BASE_URL", "https://build.example");
    vi.stubEnv("VITE_INSFORGE_ANON_KEY", anon("build"));
    const config = await import("./insforge-config");
    const client = (await config.ensureInsforgeClient());
    expect((await config.ensureInsforgeClient())).toBe(client);
    expect(sdk.create).toHaveBeenCalledTimes(1);
    expect(sdk.create.mock.calls[0][0].auth.detectOAuthCallback).toBe(true);
  });
  it("uses the synchronous runtime descriptor over build values and fails closed on its error", async () => {
    vi.stubEnv("VITE_INSFORGE_BASE_URL", "https://build.example");
    vi.stubEnv("VITE_INSFORGE_ANON_KEY", anon("build"));
    window.__TOKENTRACKER_RUNTIME_CONFIG__ = { baseUrl: "https://runtime.example", anonKey: anon("runtime") };
    const config = await import("./insforge-config");
    expect(config.getInsforgeRemoteUrl()).toBe("https://runtime.example");
    expect(config.getInsforgeConnectionHost()).toBe("runtime.example");
    window.__TOKENTRACKER_RUNTIME_CONFIG__ = { baseUrl: "https://runtime.example", configurationError: "missing anon" };
    expect(config.getInsforgeRemoteUrl()).toBe("");
    expect(config.getInsforgeAnonKey()).toBe("");
    expect(config.isCloudInsforgeConfigured()).toBe(false);
    expect(config.getInsforgeConnectionHost()).toBeNull();
    expect((await config.ensureInsforgeClient())).toBeNull();
  });
  it("treats the CLI's local-only runtime descriptor as a valid no-cloud state", async () => {
    // Exact payload the CLI serves for an offline / single-machine run
    // (src/lib/local-api.js, /api/runtime-config.js): no backend URL, no
    // configuration error, `localOnly: true`. This must not raise the
    // "instance connection is not configured safely" banner.
    window.__TOKENTRACKER_RUNTIME_CONFIG__ = {
      baseUrl: "", anonKey: null, dashboardUrl: "", configurationError: null,
      localHistory: true, localOnly: true,
    } as any;
    const config = await import("./insforge-config");
    expect(config.getInsforgeConfiguration()).toMatchObject({ baseUrl: "", anonKey: "", errorCode: null, source: "runtime" });
    expect(config.getInsforgeConfigurationError()).toBeNull();
    expect(config.isCloudInsforgeConfigured()).toBe(false);
    expect(config.isOfficialInsforgeInstance()).toBe(false);
    expect(config.getInsforgeRemoteUrl()).toBe("");
    expect(config.getInsforgeAnonKey()).toBe("");
    expect(config.getInsforgeConnectionHost()).toBeNull();
    expect((await config.ensureInsforgeClient())).toBeNull();
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("still surfaces a genuinely broken self-hosted runtime descriptor", async () => {
    const config = await import("./insforge-config");
    const descriptors = [
      // Malformed persisted config (the CLI marks local config invalid).
      { baseUrl: "", anonKey: null, configurationError: "invalid_local_config", localOnly: true },
      // A descriptor that claims a deployment but carries no usable URL.
      { baseUrl: "", anonKey: "", configurationError: "invalid_insforge_base_url", localOnly: true },
      { baseUrl: "", anonKey: "", localOnly: false },
      { baseUrl: "", anonKey: "" },
    ] as any[];
    for (const descriptor of descriptors) {
      window.__TOKENTRACKER_RUNTIME_CONFIG__ = descriptor;
      expect(config.getInsforgeConfigurationError()).toBe("runtime_configuration_error");
      expect(config.isCloudInsforgeConfigured()).toBe(false);
      expect(config.isOfficialInsforgeInstance()).toBe(false);
      expect(config.getInsforgeConnectionHost()).toBeNull();
      expect((await config.ensureInsforgeClient())).toBeNull();
    }
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("keeps a configured self-hosted runtime instance usable even though the CLI is local-only", async () => {
    // The local CLI descriptor always sets `localOnly` (this origin is the local
    // server), but an explicitly configured backend must still validate and
    // produce a client.
    window.__TOKENTRACKER_RUNTIME_CONFIG__ = {
      baseUrl: "https://self-host.example", anonKey: anon("self-host"), localOnly: true,
    } as any;
    const config = await import("./insforge-config");
    expect(config.isCloudInsforgeConfigured()).toBe(true);
    expect(config.isOfficialInsforgeInstance()).toBe(false);
    expect(config.getInsforgeConnectionHost()).toBe("self-host.example");
    expect(config.getInsforgeConfigurationError()).toBeNull();
    expect((await config.ensureInsforgeClient())).not.toBeNull();
  });
  it("does not expose the official key when custom VITE deployment forgot its key", async () => {
    vi.stubEnv("VITE_INSFORGE_BASE_URL", "https://custom.example");
    const config = await import("./insforge-config");
    expect(config.getInsforgeConfigurationError()).toBe("missing_backend_anon_key");
    expect(config.getInsforgeAnonKey()).toBe("");
    expect((await config.ensureInsforgeClient())).toBeNull();
    expect(sdk.create).not.toHaveBeenCalled();
  });
  it("clears only SDK auth/PKCE when the instance changes and refuses stale clients", async () => {
    vi.stubEnv("VITE_INSFORGE_BASE_URL", "https://build.example");
    vi.stubEnv("VITE_INSFORGE_ANON_KEY", anon("build"));
    const config = await import("./insforge-config");
    const original: any = (await config.ensureInsforgeClient());
    sessionStorage.setItem("insforge_pkce_verifier", "old-pkce");
    localStorage.setItem("insforge_auth", "old-auth");
    localStorage.setItem("tt.providerPrefs", "keep");
    localStorage.setItem("tt.local.history", "keep");
    window.__TOKENTRACKER_RUNTIME_CONFIG__ = { baseUrl: "https://other.example", anonKey: anon("other") };
    const replacement = (await config.ensureInsforgeClient());
    expect(replacement).not.toBe(original);
    expect(original.tokenManager.clearSession).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("insforge_pkce_verifier")).toBeNull();
    expect(localStorage.getItem("insforge_auth")).toBeNull();
    expect(localStorage.getItem("tt.providerPrefs")).toBe("keep");
    expect(localStorage.getItem("tt.local.history")).toBe("keep");
    expect(config.isCurrentInsforgeClient(original)).toBe(false);
    expect(config.isCurrentInsforgeClient(replacement)).toBe(true);
    expect(config.shouldRestoreInsforgeSession()).toBe(false);
  });
  it("marks only same-origin runtime proxies and never adds that header to direct remote calls", async () => {
    window.__TOKENTRACKER_RUNTIME_CONFIG__ = { baseUrl: "https://private.example", anonKey: anon("private") };
    const config = await import("./insforge-config");
    (await config.ensureInsforgeClient());
    const transport = sdk.create.mock.calls[0][0].fetch;
    const request = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", request);
    await transport(`${window.location.origin}/api/auth/refresh`, { headers: { Accept: "application/json" } });
    expect(new Headers(request.mock.calls[0][1].headers).get("x-tokentracker-instance")).toBe("https://private.example");
    await transport("https://private.example/functions/example", { headers: { Accept: "application/json" } });
    expect(new Headers(request.mock.calls[1][1].headers).has("x-tokentracker-instance")).toBe(false);
  });
});
