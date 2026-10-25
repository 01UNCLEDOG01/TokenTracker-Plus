import { render, screen, waitFor } from "@testing-library/react";
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
    ...extra,
  };
}

async function renderNotices(qoderCn) {
  resetLedgerNoticesCacheForTests();
  vi.stubGlobal("fetch", vi.fn(async () => {
    return limitsResponse(qoderCn);
  }));
  const view = <QoderCnOfficialSpend from="2030-07-01" to="2030-07-31" />;
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

  it("labels a carried-forward snapshot with the date it was captured", async () => {
    await renderNotices({
      configured: true,
      source: "cli-api",
      primary_window: { used_credits: 0, limit_credits: 0, remaining_credits: 0, unit: "credits" },
      spend: liveSpend(),
      spend_stale: true,
      spend_cached_at: "2030-07-28T09:27:00.000Z",
    });

    await waitFor(() => {
      expect(screen.getByText(/snapshot from 2030-07-28 09:27/i)).toBeTruthy();
    });
  });

  it("does not claim a snapshot when the spend is live", async () => {
    await renderNotices({
      configured: true,
      source: "provider-api",
      primary_window: { used_credits: 10, limit_credits: 100, remaining_credits: 90, unit: "credits" },
      spend: liveSpend(),
      spend_stale: false,
    });

    await waitFor(() => {
      expect(screen.getByText(/Official cloud:/i)).toBeTruthy();
    });
    expect(screen.queryByText(/snapshot from/i)).toBeNull();
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
