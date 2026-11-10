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
  plan_label: "Pro",
  primary_window: { used_percent: 0, reset_at: null, limit_window_seconds: 18000 },
  secondary_window: { used_percent: 25, reset_at: "2026-11-09T00:00:00.000Z", limit_window_seconds: 604800 },
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

describe("UsageLimitsPanel OpenDesign card", () => {
  it("renders the 5h and weekly windows with the plan label", () => {
    render(<UsageLimitsPanel order={["opendesign"]} displayMode="used" opendesign={okData} />);
    // The configured header is an expandable button carrying plan + brand.
    expect(screen.getByRole("button", { name: /^OpenDesign Pro/ })).toBeInTheDocument();
    // The weekly window shows its measured 25%.
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows the manual-credential hint and the cookie paste box when unconfigured", () => {
    render(<UsageLimitsPanel order={["opendesign"]} displayMode="used" opendesign={{ configured: false, error: null }} />);
    // Unlinked cards render a plain header (no expand toggle) — assert the
    // three informative pieces instead of a role.
    expect(screen.getByText("OpenDesign")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText(/Manual entry required: the open-design\.ai session cookie/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/open-design\.ai/i)).toBeInTheDocument();
  });

  it("renders the fetch error state with the paste box for recovery", () => {
    render(
      <UsageLimitsPanel
        order={["opendesign"]}
        displayMode="used"
        opendesign={{ configured: true, error: "OpenDesign session expired or unauthorized" }}
      />,
    );
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/open-design\.ai/i)).toBeInTheDocument();
  });

  it("posts the pasted cookie to the local endpoint and confirms the save", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      expect(url).toBe("/functions/tokentracker-opendesign-cookie");
      expect(JSON.parse(init.body)).toEqual({ cookie: "session=abc; other=1" });
      return { ok: true, json: async () => ({ saved: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <UsageLimitsPanel
        order={["opendesign"]}
        displayMode="used"
        opendesign={{ configured: false, error: null }}
      />,
    );
    const input = screen.getByPlaceholderText(/open-design\.ai/i);
    fireEvent.change(input, { target: { value: "session=abc; other=1" } });
    fireEvent.click(screen.getByText("Save cookie").closest("button"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/functions/tokentracker-opendesign-cookie",
        expect.objectContaining({ method: "POST" }),
      );
    });
    // Saved confirmation; the input is cleared (the cookie is never echoed).
    expect(screen.getByText(/Saved/i)).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("surfaces the save failure without clearing the paste box", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    render(
      <UsageLimitsPanel
        order={["opendesign"]}
        displayMode="used"
        opendesign={{ configured: false, error: null }}
      />,
    );
    const input = screen.getByPlaceholderText(/open-design\.ai/i);
    fireEvent.change(input, { target: { value: "session=abc" } });
    fireEvent.click(screen.getByText("Save cookie").closest("button"));
    await waitFor(() => {
      expect(screen.getByText(/Could not save/i)).toBeInTheDocument();
    });
    expect(input).toHaveValue("session=abc");
  });
});
