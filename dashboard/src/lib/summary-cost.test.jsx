import { describe, expect, it } from "vitest";
import { formatSummaryCost } from "./summary-cost";

describe("summary cost main-card presentation (upstream #1142)", () => {
  it("shows the plain amount when unpriced usage exists — no lower-bound glyph here", () => {
    const r = formatSummaryCost({ hasUnpricedUsage: true, totalUsd: 276.06 });
    expect(r.kind).toBe("amount");
    expect(r.value).toBeCloseTo(276.06);
  });

  it("keeps the unpriced label only for an all-unpriced zero total", () => {
    expect(formatSummaryCost({ hasUnpricedUsage: true, totalUsd: 0 }).kind).toBe("unpriced_label");
  });

  it("a zero total without unpriced usage stays an amount, never claims free implicitly", () => {
    const r = formatSummaryCost({ hasUnpricedUsage: false, totalUsd: 0 });
    expect(r.kind).toBe("amount");
    expect(r.value).toBe(0);
  });

  it("null/missing totals coerce to a 0 amount for the formatter", () => {
    const r = formatSummaryCost({ hasUnpricedUsage: false, totalUsd: null });
    expect(r.kind).toBe("amount");
    expect(r.value).toBe(0);
  });
});
