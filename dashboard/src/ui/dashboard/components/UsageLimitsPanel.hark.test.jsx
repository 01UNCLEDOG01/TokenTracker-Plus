import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageLimitsPanel } from "./UsageLimitsPanel.jsx";

// Credential POSTs are loopback mutations and need the per-process token; stub
// the helper so these tests stay about the paste box, not the auth handshake.
vi.mock("../../../lib/local-api-auth", () => ({
  getLocalApiAuthHeaders: async () => ({ "x-tokentracker-local-auth": "test-token" }),
  clearLocalApiAuthToken: () => {},
}));

const okData = {
  configured: true,
  error: null,
  plan_label: "Pro 3",
  primary_window: { used_percent: 30, reset_at: "2026-11-14T00:00:00.000Z", limit_window_seconds: 86400 },
  secondary_window: { used_percent: 13, reset_at: "2026-12-01T00:00:00.000Z" },
  feature_windows: [
    { label: "Daily Messages", used_percent: 12, reset_at: "2026-11-14T00:00:00.000Z", limit_window_seconds: 86400 },
  ],
  hark_topup: 2.5,
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text) => ({ width: String(text).length * 6 }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UsageLimitsPanel Hark card", () => {
  it("renders the plan label, daily/monthly bars, feature row and top-up line", () => {
    render(<UsageLimitsPanel order={["hark"]} displayMode="used" hark={okData} />);
    // The configured header is an expandable button carrying plan + brand.
    // This is also the regression guard for the provider reaching dataById:
    // a missing prop would leave the card on the "not connected" branch.
    expect(screen.getByRole("button", { name: /^Hark Pro 3/ })).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("13%")).toBeInTheDocument();
    expect(screen.getByText("Daily Messages")).toBeInTheDocument();
    // formatCreditAmount keeps minimumFractionDigits 0 → "2.5".
    expect(screen.getByText(/Top-up this period: \$2\.5/)).toBeInTheDocument();
  });

  it("shows the paste box when unconfigured (desktop discovery is the zero-config path)", () => {
    render(<UsageLimitsPanel order={["hark"]} displayMode="used" hark={{ configured: false, error: null }} />);
    expect(screen.getByText("Hark")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste the Hark session token/i)).toBeInTheDocument();
    expect(screen.getByText(/Hark\.app on macOS is discovered automatically/i)).toBeInTheDocument();
  });

  it("keeps the paste box reachable on the error card", () => {
    render(
      <UsageLimitsPanel
        order={["hark"]}
        displayMode="used"
        hark={{ configured: true, error: "Hark session expired or unauthorized" }}
      />,
    );
    expect(screen.getByText(/Hark session expired or unauthorized/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste the Hark session token/i)).toBeInTheDocument();
  });

  it("posts a clear request from the paste box", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ saved: true, cleared: true }) }));
    vi.stubGlobal("fetch", fetchMock);
    render(<UsageLimitsPanel order={["hark"]} displayMode="used" hark={okData} />);
    // The paste box lives inside the collapsed credential section on a
    // configured card — expand it first.
    fireEvent.click(screen.getByText(/Cookie sign-in/));
    fireEvent.click(screen.getByText("Clear saved token"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === "/functions/tokentracker-hark-cookie")).toBe(true);
    });
    const call = fetchMock.mock.calls.find(([url]) => url === "/functions/tokentracker-hark-cookie");
    expect(call[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(call[1].body)).toEqual({ clear: true });
  });
});
