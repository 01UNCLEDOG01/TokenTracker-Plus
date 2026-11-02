import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  QoderCnOfficialSpend,
  QoderIntlCreditsNote,
  WorkbuddyCreditSpend,
  resetLedgerNoticesCacheForTests,
} from "./LedgerNotices.jsx";

// The point of these cases: an unreachable Qoder CN feed and an idle account
// must not render the same thing. `if (!spend) return null` made a failed fetch
// disappear from the panel entirely, which is indistinguishable from "you used
// nothing today" - and that silence is what hid the dead feed for two days.
//
// The component memoises the limits response in a module-level cache with a 60s
// TTL, so each case calls resetLedgerNoticesCacheForTests() first. Without it
// the first payload leaks into the rest of the file.

function limitsResponse(qoderCn) {
  return { ok: true, json: async () => ({ data: { qoderCn } }) };
}

// Mirrors the real spend block. est_anchor is not optional in practice: without
// it the token estimate is NaN * messages, which is what these two cases were
// tripping over before they got realistic payloads.
function liveSpend(extra = {}) {
  return {
    credits_total: 85.31,
    cost_total: 1.2,
    messages_total: 106,
    daily: [{ date: "2030-07-20", credits: 85.31, cost: 1.2, messages: 106 }],
    est_anchor: { tokens: 36907, messages: 1 },
    realtime_today: true,
    credits_today: 85.31,
    cost_today: 1.2,
    messages_today: 106,
    today: "2030-07-20",
    ...extra,
  };
}

// KI-030: the backend attaches the three-value summary at serve time; the
// banner renders cash paid / official / freeloading as separate lines.
function valueSummary() {
  return {
    credit_tiers_captured_at: "2026-10-25",
    daily_deduped: { days: 31, removed: 2 },
    official_cost_cny: 118.62,
    cash_paid_cny: 80.93,
    freeloading: {
      messages: 24118,
      tokens_est: 890286826,
      cny_low: 236.55,
      cny_high: 251.06,
      tokens_per_msg: 36907,
      cny_per_mtok_band: [0.2657, 0.282],
      estimate_kind: "interval",
    },
  };
}

async function renderNotices(qoderCn) {
  resetLedgerNoticesCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async () => {
    return limitsResponse(qoderCn);
  }));
  const view = (
    <MemoryRouter>
      <QoderCnOfficialSpend from="2030-07-01" to="2030-07-31" />
    </MemoryRouter>
  );
  render(view);
}

describe("QoderCnOfficialSpend freshness", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says the fetch failed when there is no spend at all", async () => {
    await renderNotices({
      configured: true,
      source: "disk-cache",
      primary_window: { used_credits: 0, limit_credits: 0, remaining_credits: 0, unit: "credits" },
      spend: null,
    });

    // Must render something. Before the fix this returned null and the whole
    // block vanished, which reads as "no news" rather than "the fetch failed".
    await waitFor(() => {
      expect(screen.getByText(/could not be fetched/i)).toBeTruthy();
    });
    expect(screen.getByText(/not zero usage/i)).toBeTruthy();
  });

  it("labels a carried-forward snapshot with the date the data is from, not when it was cached", async () => {
    await renderNotices({
      configured: true,
      source: "cli-api",
      primary_window: { used_credits: 0, limit_credits: 0, remaining_credits: 0, unit: "credits" },
      // The data's own date (today) is the truthful label; spend_cached_at is
      // only when we refreshed the cache and must not masquerade as freshness.
      spend: liveSpend({ today: "2030-07-20" }),
      spend_stale: true,
      spend_cached_at: "2030-07-28T09:27:00.000Z",
    });

    // Methodology details collapse by default; open them first.
    fireEvent.click(await screen.findByRole("button", { name: /Methodology details/i }));
    await waitFor(() => {
      expect(screen.getByText(/snapshot from 2030-07-20/i)).toBeTruthy();
    });
    // The cache refresh time must not be presented as the data date.
    expect(screen.queryByText(/2030-07-28/i)).toBeNull();
  });

  it("does not claim a snapshot or a local measurement without a local anchor", async () => {
    await renderNotices({
      configured: true,
      source: "provider-api",
      primary_window: { used_credits: 10, limit_credits: 100, remaining_credits: 90, unit: "credits" },
      spend: liveSpend(),
      spend_stale: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: /Methodology details/i }));
    await waitFor(() => {
      expect(screen.getByText(/Official cloud:/i)).toBeTruthy();
    });
    expect(screen.queryByText(/snapshot from/i)).toBeNull();
    // No est_anchor.source means the fork-default anchor: the "locally
    // measured" claim would be false on this machine, so the generic line shows.
    expect(screen.queryByText(/locally measured 2026-07/i)).toBeNull();
    expect(screen.getByText(/official per-model estimates/i)).toBeTruthy();
  });

  it("claims the local measurement only when the anchor is machine-local", async () => {
    await renderNotices({
      configured: true,
      source: "provider-api",
      primary_window: { used_credits: 10, limit_credits: 100, remaining_credits: 90, unit: "credits" },
      spend: liveSpend({ est_anchor: { tokens: 17235393, messages: 467, from: "2026-07-20", to: "2026-07-22", source: "local-queue" } }),
      spend_stale: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: /Methodology details/i }));
    await waitFor(() => {
      expect(screen.getByText(/locally measured 2026-07/i)).toBeTruthy();
    });
    expect(screen.queryByText(/official per-model estimates/i)).toBeNull();
  });

  it("renders the three-value summary and the freeloading interval as separate lines", async () => {
    await renderNotices({
      configured: true,
      source: "provider-api",
      primary_window: { used_credits: 10, limit_credits: 100, remaining_credits: 90, unit: "credits" },
      spend: liveSpend({ value_summary: valueSummary() }),
      spend_stale: false,
    });

    // Collapsed by default: the small print must not be in the DOM yet.
    expect(screen.queryByText(/never merged/i)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Methodology details/i }));

    await waitFor(() => {
      expect(screen.getByText(/never merged/i)).toBeTruthy();
    });
    expect(screen.getByText(/¥80\.93/)).toBeTruthy();
    expect(screen.getByText(/¥118\.62/)).toBeTruthy();
    const freeload = screen.getByText(/0× freeloading estimate/i);
    expect(freeload.textContent).toContain("¥237");
    expect(freeload.textContent).toContain("251");
    expect(freeload.textContent).toContain("24,118");
  });

  it("shows a prominent banner when the saved cookie expired but numbers remain", async () => {
    await renderNotices({
      configured: true,
      source: "cli-api",
      primary_window: { used_credits: 0, limit_credits: 0, remaining_credits: 0, unit: "credits" },
      spend: liveSpend({ today: "2030-07-20" }),
      spend_stale: true,
      saved_session_expired: true,
    });

    // Banner must be visible without opening the methodology details.
    await waitFor(() => {
      expect(screen.getByText(/credential has expired/i)).toBeTruthy();
    });
    expect(screen.getByText(/update on the limits page/i)).toBeTruthy();
    // The carried figures still render; open the details to read the true
    // data date on the snapshot line.
    fireEvent.click(await screen.findByRole("button", { name: /Methodology details/i }));
    await waitFor(() => {
      expect(screen.getByText(/snapshot from 2030-07-20/i)).toBeTruthy();
    });
  });

  it("still explains an expired cookie when even the fallback has no spend", async () => {
    await renderNotices({
      configured: false,
      saved_session_expired: true,
      spend: null,
    });

    await waitFor(() => {
      expect(screen.getByText(/credential has expired/i)).toBeTruthy();
    });
    // The failure line must not masquerade as "no usage": both show together.
    expect(screen.getByText(/could not be fetched/i)).toBeTruthy();
  });
});

// The domestic and international WorkBuddy editions are separate sources with
// separate cards. Each card must show only its own ledger line: passing
// edition={null} from the domestic card made the WorkBuddy AI line render
// there too, double-showing credits the AI card already carries.
function workbuddyLedger() {
  return {
    editions: [
      {
        id: "cn",
        name: "WorkBuddy",
        symbol: "¥",
        credits_total: 21585.87,
        cost: 1079.29,
        since: "2026-06-24",
        per_day: [{ date: "2030-07-20", credits: 3591.91 }],
      },
      {
        id: "intl",
        name: "WorkBuddy AI",
        symbol: "$",
        credits_total: 327.63,
        cost: 3.28,
        since: "2026-10-01",
        per_day: [{ date: "2030-07-20", credits: 327.63 }],
      },
    ],
  };
}

async function renderWorkbuddy(edition) {
  resetLedgerNoticesCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: { workbuddyCredits: workbuddyLedger() } }),
  })));
  render(<WorkbuddyCreditSpend from="2030-07-01" to="2030-07-31" edition={edition} />);
}

describe("WorkbuddyCreditSpend edition split", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("domestic card shows only the cn ledger line", async () => {
    await renderWorkbuddy("cn");
    await waitFor(() => {
      expect(screen.getByText(/WorkBuddy \(local credit ledger\)/i)).toBeTruthy();
    });
    expect(screen.queryByText(/WorkBuddy AI \(local credit ledger\)/i)).toBeNull();
  });

  it("international card shows only the intl ledger line", async () => {
    await renderWorkbuddy("intl");
    await waitFor(() => {
      expect(screen.getByText(/WorkBuddy AI \(local credit ledger\)/i)).toBeTruthy();
    });
    expect(screen.queryByText(/^WorkBuddy \(local credit ledger\)/i)).toBeNull();
  });
});

describe("QoderIntlCreditsNote", () => {
  it("states the credit basis instead of staying silent next to the CN notice", () => {
    render(<QoderIntlCreditsNote />);
    expect(screen.getByText(/published Pro rate/i)).toBeTruthy();
    expect(screen.getByText(/back-derived estimates/i)).toBeTruthy();
  });
});
