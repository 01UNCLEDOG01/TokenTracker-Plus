import { describe, expect, it, vi } from "vitest";
import { functionUrlFor, fetchFunctionResponse } from "./function-url";

// Local-first fork: no instance receives privileged routing. These are just
// ordinary configured cloud instances for the tests below.
const instance = "https://config.example.insforge.app";

describe("function transport parity", () => {
  it("an unconfigured runtime derives no function URL at all", () => {
    expect(functionUrlFor("", "tokentracker-ingest")).toBe("");
    expect(functionUrlFor(undefined as unknown as string, "tokentracker-ingest")).toBe("");
  });

  it("every configured instance keeps its own /functions/ route", () => {
    for (const base of [instance, `${instance}/`, "http://localhost:7130", "https://custom.example/api", "https://other123.us-east.insforge.app", `${instance}/other`, `${instance}.evil.example`, `https://user@config.example.insforge.app`]) {
      const root = base.replace(/\/$/, "");
      expect(functionUrlFor(base, "tokentracker-ingest")).toBe(`${root}/functions/tokentracker-ingest`);
    }
    expect(functionUrlFor(instance, "tokentracker-ingest")).toBe(`${instance}/functions/tokentracker-ingest`);
  });

  it("a GET 404 is surfaced once and never replayed to a legacy host", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 }));
    const init = { headers: { Authorization: "Bearer fixture" }, cache: "no-store" as RequestCache };
    const response = await fetchFunctionResponse(`${instance}/functions/tokentracker-account-summary?from=today`, init, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    expect(fetch.mock.calls[0][1]).toBe(init);
  });

  it("a POST 404 or ambiguous network failure cannot submit the body twice", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));
    await fetchFunctionResponse(`${instance}/functions/tokentracker-device-token-issue`, { method: "POST", body: "{}" }, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const failing = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(fetchFunctionResponse(`${instance}/functions/tokentracker-ingest`, { method: "POST" }, failing)).rejects.toThrow("timeout");
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
