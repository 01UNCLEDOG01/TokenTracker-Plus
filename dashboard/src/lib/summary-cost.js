// Main-card cost presentation (upstream #1142): the hero shows the plain
// amount — the ≥ lower-bound glyph lives in CostAnalysisModal only, where the
// user opted into the uncertainty disclosure. Only an all-unpriced zero total
// keeps the unpriced label, so the card never claims a free total implicitly.
export function formatSummaryCost({ hasUnpricedUsage, totalUsd }) {
  const raw = Number(totalUsd);
  if (hasUnpricedUsage && Number.isFinite(raw) && raw === 0) {
    return { kind: "unpriced_label" };
  }
  return { kind: "amount", value: Number.isFinite(raw) ? raw : totalUsd };
}
