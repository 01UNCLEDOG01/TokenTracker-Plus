import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsforgeUserHeaderControls, isCurrentProAccount } from "./InsforgeUserHeaderControls.jsx";

const mocks = vi.hoisted(() => ({
  auth: {}, request: vi.fn(), navigate: vi.fn(), login: vi.fn(), backend: "hosted-instance", official: true,
}));
vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({ useInsforgeAuth: () => mocks.auth }));
vi.mock("../contexts/LoginModalContext.jsx", () => ({ useLoginModal: () => ({ openLoginModal: mocks.login }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("../hooks/useLocale.js", () => ({ useLocale: () => {} }));
vi.mock("../lib/native-bridge.js", () => ({ isNativeApp: () => false }));
vi.mock("../lib/cloud-billing", () => ({ cloudBillingRequest: mocks.request }));
vi.mock("../lib/insforge-config", () => ({
  getInsforgeInstanceFingerprint: () => mocks.backend,
  isOfficialInsforgeInstance: () => mocks.official,
  INSFORGE_INSTANCE_CHANGED_EVENT: "tt.insforgeInstanceChanged",
}));

const now = Date.parse("2026-10-10T12:00:00Z");
const end = "2026-10-11T12:00:00Z";
const pro = (source = "payment") => ({ environment: "live", membership: {
  environment: "live", phase: "active", hosting_mode: "hosted", status: "active", access_source: source, expires_at: end,
}, payments: [], gifts: [] });

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  mocks.auth = { enabled: true, loading: false, signedIn: true, user: { id: "fixture-owner", user_metadata: { avatar_url: "https://avatar.example/photo.png" } }, displayName: "Ada Lovelace", getAccessToken: vi.fn() };
  mocks.official = true;
  mocks.backend = "hosted-instance";
  mocks.request.mockReset().mockResolvedValue(pro());
  mocks.navigate.mockReset(); mocks.login.mockReset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("current server Cloud identity", () => {
  it.each(["payment", "gift", "mixed"])("accepts authoritative current %s access even without capped history", (source) => {
    expect(isCurrentProAccount(pro(source), now)).toBe(true);
  });
  it("keeps Cloud when the visible capped history contains only future periods", () => {
    const paid = pro(); paid.payments = Array.from({ length: 20 }, () => ({ starts_at: end, ends_at: "2027-01-01T00:00:00Z" }));
    expect(isCurrentProAccount(paid, now)).toBe(true);
    const gifted = pro("gift"); gifted.gifts = Array.from({ length: 100 }, () => ({ state: "pending", starts_at: end, ends_at: "2027-01-01T00:00:00Z" }));
    expect(isCurrentProAccount(gifted, now)).toBe(true);
  });
  it("keeps legitimate partially refunded access when the server still grants payment access", () => {
    const value = pro(); value.payments = [{ amount_cents: 499, refunded_cents: 100 }];
    expect(isCurrentProAccount(value, now)).toBe(true);
  });
  it("supports the existing hosted response without an optional hosting_mode field", () => {
    const value = pro(); delete value.membership.hosting_mode;
    expect(isCurrentProAccount(value, now)).toBe(true);
  });
  it.each(["legacy_free", "trial", "transition", "expired", "free", "self_hosted", undefined])("rejects %s membership", (status) => {
    const value = pro(); value.membership.status = status;
    expect(isCurrentProAccount(value, now)).toBe(false);
  });
  it.each([
    { environment: "sandbox" }, { environment: undefined }, { phase: "preview" }, { phase: undefined },
    { hosting_mode: "self_hosted" }, { hosting_mode: "unknown" }, { access_source: "none" }, { access_source: undefined },
    { expires_at: null }, { expires_at: 2049 }, { expires_at: "invalid" }, { expires_at: "2026-10-10T12:00:00Z" },
  ])("rejects unavailable authoritative field %j", (change) => {
    const value = pro(); Object.assign(value.membership, change);
    expect(isCurrentProAccount(value, now)).toBe(false);
  });
  it("rejects missing, future-only and fully refunded server entitlement", () => {
    expect(isCurrentProAccount(null, now)).toBe(false);
    const future = pro("none"); future.membership.status = "free";
    future.gifts = [{ state: "pending", starts_at: end, ends_at: "2027-01-01T00:00:00Z" }];
    expect(isCurrentProAccount(future, now)).toBe(false);
    const refunded = pro("none"); refunded.membership.status = "expired";
    refunded.payments = [{ amount_cents: 499, refunded_cents: 499 }];
    expect(isCurrentProAccount(refunded, now)).toBe(false);
    expect(isCurrentProAccount({ ...pro(), environment: "sandbox" }, now)).toBe(false);
  });
});
