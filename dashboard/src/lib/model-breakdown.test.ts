import { describe, expect, it } from "vitest";
import {
  applyTraeEstimatedCosts,
  buildAllModels,
  buildFleetData,
  buildTraeCostInterval,
  buildTopModels,
  hasModelTokenSplits,
  modelTokenSplitsTotal,
} from "./model-breakdown";

describe("buildFleetData", () => {
  it("keeps two decimal places for small provider percentages", () => {
    const fleet = buildFleetData({
      sources: [
        {
          source: "claude",
          totals: { billable_total_tokens: 999_600 },
          models: [{ model_id: "claude-sonnet", totals: { billable_total_tokens: 999_600 } }],
        },
        {
          source: "antigravity",
          totals: { billable_total_tokens: 400 },
          models: [{ model_id: "gemini-pro", totals: { billable_total_tokens: 400 } }],
        },
        {
          source: "grok",
          totals: { billable_total_tokens: 1 },
          models: [{ model_id: "grok-code", totals: { billable_total_tokens: 1 } }],
        },
      ],
    });

    expect(fleet.map(({ source, totalPercent }) => [source, totalPercent])).toEqual([
      ["claude", "99.96"],
      ["antigravity", "0.04"],
      ["grok", "0.00"],
    ]);
    expect(fleet[2].totalPercentValue).toBeGreaterThan(0);
    expect(fleet[2].totalPercentValue).toBeLessThan(0.01);
  });

  it("folds the deprecated deepseek source alias into dsh and merges models", () => {
    const fleet = buildFleetData({
      sources: [
        {
          source: "deepseek",
          totals: { billable_total_tokens: 100, total_cost_usd: "1.00" },
          models: [
            { model_id: "deepseek-v4-pro", totals: { billable_total_tokens: 70 } },
            { model_id: "deepseek-v4-flash", totals: { billable_total_tokens: 30 } },
          ],
        },
        {
          source: "dsh",
          totals: { billable_total_tokens: 400, total_cost_usd: "4.00" },
          models: [
            { model_id: "deepseek-v4-pro", totals: { billable_total_tokens: 300 } },
            { model_id: "deepseek-v4-flash", totals: { billable_total_tokens: 100 } },
          ],
        },
      ],
    });

    expect(fleet.map(({ source }) => source)).toEqual(["dsh"]);
    expect(fleet[0].usage).toBe(500);
    expect(fleet[0].usd).toBe(5);
    const byId = Object.fromEntries(fleet[0].models.map((m: any) => [m.id, m.usage]));
    expect(byId).toEqual({ "deepseek-v4-pro": 370, "deepseek-v4-flash": 130 });
  });

  it("ignores malformed non-array model collections while preserving source totals", () => {
    expect(() => buildFleetData({
      sources: [{
        source: "dsh",
        totals: { billable_total_tokens: 42 },
        models: { model_id: "not-an-array" },
      }],
    })).not.toThrow();
  });

  it("uses raw AStudio service IDs as model display names", () => {
    const response = {
      sources: [
        {
          source: "acode",
          totals: { billable_total_tokens: 150 },
          models: [
            {
              model: "xopdeepseekv4flash0731",
              model_id: "xopdeepseekv4flash0731",
              totals: { billable_total_tokens: 100 },
            },
            {
              model: "xopglm52",
              model_id: "xopglm52",
              totals: { billable_total_tokens: 40 },
            },
            {
              model: "custom-service-id",
              model_id: "custom-service-id",
              totals: { billable_total_tokens: 10 },
            },
          ],
        },
        {
          source: "codex",
          totals: { billable_total_tokens: 5 },
          models: [
            {
              model: "xopglm52",
              model_id: "xopglm52",
              totals: { billable_total_tokens: 5 },
            },
          ],
        },
      ],
    };

    const fleet = buildFleetData(response);
    expect(fleet[0].models.map(({ id, name }: any) => ({ id, name }))).toEqual([
      { id: "xopdeepseekv4flash0731", name: "xopdeepseekv4flash0731" },
      { id: "xopglm52", name: "xopglm52" },
      { id: "custom-service-id", name: "custom-service-id" },
    ]);
    expect(fleet[1].models[0]).toMatchObject({ id: "xopglm52", name: "xopglm52" });
    expect(buildTopModels(response, { limit: 4 }).map(({ name }: any) => name)).toEqual([
      "xopdeepseekv4flash0731",
      "xopglm52",
      "custom-service-id",
    ]);
  });
});

describe("modelTokenSplitsTotal / hasModelTokenSplits", () => {
  it("sums splits and reports expandability", () => {
    expect(modelTokenSplitsTotal(undefined)).toBe(0);
    expect(modelTokenSplitsTotal({})).toBe(0);
    expect(
      modelTokenSplitsTotal({ input: 10, output: 5, cached: 0, cacheCreate: 0, reasoning: 0 }),
    ).toBe(15);
    expect(hasModelTokenSplits({ tokens: { input: 1 } })).toBe(true);
    expect(hasModelTokenSplits({})).toBe(false);
    expect(hasModelTokenSplits(null)).toBe(false);
  });
});

describe("buildAllModels", () => {
  it("combines the same model across tools and ranks every personal model", () => {
    const models = buildAllModels([
      {
        label: "CODEX",
        models: [
          { id: "gpt-5.6", name: "GPT-5.6", usage: 70, cost: 0.7 },
          { id: "gpt-5.5", name: "gpt-5.5", usage: 20, cost: 0.2 },
        ],
      },
      {
        label: "CURSOR",
        models: [
          { id: "gpt-5.6", name: "gpt-5.6", usage: 30, cost: 0.3 },
          { id: "claude", name: "claude-sonnet", usage: 80, cost: null },
        ],
      },
    ]);

    expect(models).toEqual([
      {
        id: "gpt-5.6",
        name: "GPT-5.6",
        usage: 100,
        requests: 0,
        cost: 1,
        tokens: { input: 0, output: 0, cached: 0, cacheCreate: 0, reasoning: 0 },
        share: 50,
      },
      {
        id: "claude-sonnet",
        name: "claude-sonnet",
        usage: 80,
        requests: 0,
        cost: null,
        tokens: { input: 0, output: 0, cached: 0, cacheCreate: 0, reasoning: 0 },
        share: 40,
      },
      {
        id: "gpt-5.5",
        name: "gpt-5.5",
        usage: 20,
        requests: 0,
        cost: 0.2,
        tokens: { input: 0, output: 0, cached: 0, cacheCreate: 0, reasoning: 0 },
        share: 10,
      },
    ]);
  });

  it("keeps a token-derived Qoder credit model in All models", () => {
    const models = buildAllModels([
      {
        label: "QODER",
        models: [
          {
            id: "Qwen3.8-Flash（积分）",
            name: "Qwen3.8-Flash（积分）",
            usage: 11_600_000,
            cost: 0.42,
          },
        ],
      },
    ]);

    expect(models).toEqual([
      {
        id: "qwen3.8-flash（积分）",
        name: "Qwen3.8-Flash（积分）",
        usage: 11_600_000,
        requests: 0,
        cost: 0.42,
        tokens: { input: 0, output: 0, cached: 0, cacheCreate: 0, reasoning: 0 },
        share: 100,
      },
    ]);
  });

  it("combines per-model token-type splits across tools", () => {
    const models = buildAllModels([
      {
        label: "CODEX",
        models: [
          {
            id: "gpt-5.6",
            name: "gpt-5.6",
            usage: 100,
            cost: 1,
            tokens: { input: 10, output: 5, cached: 80, cacheCreate: 4, reasoning: 1 },
          },
        ],
      },
      {
        label: "CURSOR",
        models: [
          {
            id: "gpt-5.6",
            name: "gpt-5.6",
            usage: 50,
            cost: 0.5,
            tokens: { input: 20, output: 10, cached: 15, cacheCreate: 5, reasoning: 0 },
          },
        ],
      },
    ]);

    expect(models).toEqual([
      {
        id: "gpt-5.6",
        name: "gpt-5.6",
        usage: 150,
        requests: 0,
        cost: 1.5,
        tokens: { input: 30, output: 15, cached: 95, cacheCreate: 9, reasoning: 1 },
        share: 100,
      },
    ]);
  });

  it("carries API token totals through buildFleetData provider models", () => {
    const fleet = buildFleetData({
      sources: [
        {
          source: "opencode",
          totals: { billable_total_tokens: 300 },
          models: [
            {
              model_id: "gpt-6.1-sol-fast",
              totals: {
                billable_total_tokens: 300,
                input_tokens: 100,
                output_tokens: 20,
                cached_input_tokens: 170,
                cache_creation_input_tokens: 5,
                reasoning_output_tokens: 5,
              },
            },
          ],
        },
      ],
    });

    expect(fleet[0].models).toEqual([
      {
        id: "gpt-6.1-sol-fast",
        name: "gpt-6.1-sol-fast",
        share: 100,
        usage: 300,
        requests: 0,
        cost: 0,
        tokens: { input: 100, output: 20, cached: 170, cacheCreate: 5, reasoning: 5, cacheObservedInput: null, cacheObservedHitRate: null },
        // Input-side cache hit rate: 170/(100+170+5) = 61.8 -> 62.
        cacheHitRate: 62,
        pricing: null,
        costSource: null,
      },
    ]);
  });
});

// A credits-only source reports money and no token counts. Both the source
// filter and the model filter used to require tokens > 0, which erased the whole
// card - Qoder international bills credits and records no tokens anywhere.
describe("buildFleetData with a credits-only source", () => {
  // Typed loosely on purpose: the guardrail tsc pass would otherwise demand a
  // full response interface for a fixture whose point is one field shape.
  const response = (): any => ({
    sources: [
      {
        source: "claude",
        totals: { billable_total_tokens: 1000, input_tokens: 1000, total_cost_usd: "2.00" },
        models: [{ model_id: "sonnet", totals: { billable_total_tokens: 1000, total_cost_usd: "2.00" } }],
      },
      {
        source: "qoder",
        totals: { billable_total_tokens: 0, total_tokens: 0, total_cost_usd: "3.57" },
        models: [
          {
            model_id: "official-cloud",
            model: "official-cloud",
            totals: { billable_total_tokens: 0, total_tokens: 0, total_cost_usd: "3.57" },
            cost_source: "provider_reported",
          },
          {
            model_id: "nothing-to-show",
            model: "nothing-to-show",
            totals: { billable_total_tokens: 0, total_cost_usd: "0" },
          },
        ],
      },
    ],
  });
  const card = (fleet: any, source: string) => fleet.find((entry: any) => entry.source === source);

  it("keeps a money-bearing source that reports no tokens", () => {
    const fleet = buildFleetData(response());
    const qoder = card(fleet, "qoder");
    expect(qoder).toBeTruthy();
    expect(qoder.usage).toBe(0);
    expect(qoder.usd).toBeCloseTo(3.57, 6);
    expect(qoder.totalPercent).toBe("0.00");
    // The token-ranked card next to it is unchanged.
    expect(card(fleet, "claude").totalPercent).toBe("100.00");
  });

  it("keeps the model row that carries the money and drops the empty one", () => {
    const fleet = buildFleetData(response());
    const models = card(fleet, "qoder").models;
    expect(models.map((model: any) => model.id)).toEqual(["official-cloud"]);
    expect(models[0].usage).toBe(0);
    expect(models[0].cost).toBeCloseTo(3.57, 6);
    expect(models[0].costSource).toBe("provider_reported");
  });

  it("still drops a source with neither tokens nor money", () => {
    const empty = response();
    empty.sources[1] = {
      source: "qoder",
      totals: { billable_total_tokens: 0, total_cost_usd: "0" },
      models: [{ model_id: "official-cloud", totals: { billable_total_tokens: 0, total_cost_usd: "0" } }],
    };
    const fleet = buildFleetData(empty);
    expect(fleet.map((entry: any) => entry.source)).toEqual(["claude"]);
  });
});

describe("request-only providers (issue 948)", () => {
  it("keeps zero-token sources with conversation activity, sunk below token-backed providers", () => {
    const fleet = buildFleetData({
      sources: [
        {
          source: "claude",
          totals: { billable_total_tokens: 1000 },
          models: [{ model_id: "claude-sonnet", totals: { billable_total_tokens: 1000 } }],
        },
        {
          source: "qoder",
          totals: { conversation_count: 19 },
          models: [{ model_id: "qfmodel", totals: { conversation_count: 19 } }],
        },
        {
          source: "qoder-cn",
          totals: { conversation_count: 100 },
          models: [{ model_id: "qfmodel", totals: { conversation_count: 100 } }],
        },
      ],
    });

    expect(fleet.map(({ source }: any) => source)).toEqual(["claude", "qoder-cn", "qoder"]);
    expect(fleet[0].totalPercent).toBe("100.00");
    expect(fleet[1]).toMatchObject({ usage: 0, requests: 100, usd: 0 });
    expect(fleet[1].models[0]).toMatchObject({
      id: "qfmodel",
      usage: 0,
      requests: 100,
      share: 0,
      cost: null,
    });
  });

  it("still drops sources that carry neither tokens nor conversation activity", () => {
    const fleet = buildFleetData({
      sources: [
        { source: "qoder", totals: {}, models: [{ model_id: "qfmodel", totals: {} }] },
      ],
    });
    expect(fleet).toEqual([]);
  });

  it("sums conversation_count when an alias merge folds two request-only sources", () => {
    const fleet = buildFleetData({
      sources: [
        {
          source: "deepseek",
          totals: { conversation_count: 5 },
          models: [{ model_id: "dsh-model", totals: { conversation_count: 5 } }],
        },
        {
          source: "dsh",
          totals: { conversation_count: 7 },
          models: [{ model_id: "dsh-model", totals: { conversation_count: 7 } }],
        },
      ],
    });
    expect(fleet).toHaveLength(1);
    expect(fleet[0].requests).toBe(12);
    expect(fleet[0].models[0]).toMatchObject({ id: "dsh-model", usage: 0, requests: 12 });
  });

  it("keeps a zero-token model row beside token-backed siblings of a mixed source", () => {
    const fleet = buildFleetData({
      sources: [
        {
          source: "mixed",
          totals: { billable_total_tokens: 900, conversation_count: 12 },
          models: [
            { model_id: "paid-model", totals: { billable_total_tokens: 900 } },
            { model_id: "qfmodel", totals: { conversation_count: 12 } },
          ],
        },
      ],
    });
    expect(fleet[0].models.find((m: any) => m.id === "qfmodel")).toMatchObject({
      usage: 0,
      requests: 12,
      share: 0,
      cost: null,
    });
    // The fork's credits-only rule still gives a token-backed row without an
    // explicit cost the endpoint's literal 0 (merged totals default).
    expect(fleet[0].models.find((m: any) => m.id === "paid-model")).toMatchObject({
      usage: 900,
      cost: 0,
    });
  });

  it("aggregates request counts into buildAllModels while shares stay token-based", () => {
    const models = buildAllModels([
      {
        label: "CLAUDE",
        models: [{ id: "sonnet", name: "sonnet", usage: 100, cost: 1, requests: 0 }],
      },
      {
        label: "QODER",
        models: [{ id: "qfmodel", name: "qfmodel", usage: 0, cost: null, requests: 19 }],
      },
    ]);
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ id: "sonnet", usage: 100, requests: 0, share: 100 });
    expect(models[1]).toMatchObject({
      id: "qfmodel",
      usage: 0,
      requests: 19,
      share: 0,
      cost: null,
    });
  });

  it("keeps request-only models out of the hero top-models token ranking", () => {
    const top = buildTopModels({
      sources: [
        { source: "qoder", models: [{ model_id: "qfmodel", totals: { conversation_count: 19 } }] },
      ],
    });
    expect(top).toEqual([]);
  });
});

describe("buildTraeCostInterval", () => {
  const traeCard = {
    source: "trae",
    usd: 16.2,
    models: [
      // DeepSeek: TRAE reports no cache fields, so all input is uncached-billed.
      { id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", cost: 16.2, usage: 62_000_000, tokens: { input: 60_000_000, cached: 0 } },
    ],
  };
  const peers = [
    // DeepSeek direct observes the same model with a real hit rate.
    { source: "deepseek", models: [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", cost: 5, cacheHitRate: 90 }] },
    // WorkBuddy observes it too; median of [90, 94] = 92.
    { source: "workbuddy", models: [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", cost: 8, cacheHitRate: 94 }] },
    // TRAE CN observes it too but is the same product family — excluded from
    // its own peer pool (its figure during a dry spell is itself an estimate,
    // and letting a provider testify for itself is circular).
    { source: "trae-cn", models: [{ id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", cost: 3, cacheHitRate: 80 }] },
  ];

  it("builds an interval from the same model's median hit rate at other sources", () => {
    const interval = buildTraeCostInterval(traeCard, [traeCard, ...peers]);
    if (!interval) throw new Error("expected an interval for TRAE with peer evidence");
    // trae-cn is family-excluded: median of [90, 94] = 92 ->
    // low = 16.2 * (0.08 + 0.92 * (0.006/0.3))
    expect(interval.high).toBeCloseTo(16.2, 5);
    expect(interval.low).toBeCloseTo(16.2 * (0.08 + 0.92 * 0.02), 5);
    expect(interval.low).toBeLessThan(interval.high);
    // The median hit rate that produced the lower bound: median of [90,94].
    expect(interval.medianHitRate).toBe(92);
  });

  it("returns null when no other source observed the model (no fabricated floor)", () => {
    const lonely = buildTraeCostInterval(traeCard, [traeCard]);
    expect(lonely).toBeNull();
  });

  it("treats a peer that reports cache reads without uncached input as unknown evidence (no degenerate 100%)", () => {
    // Adversarial guard: a peer with cached>0 but input=cacheCreate=0 would
    // read as a 100% hit rate; if that was really a "input_tokens not
    // reported" data gap it would pull the TRAE lower bound down (exaggerated
    // savings). Such a row must not count as evidence.
    const response = {
      pricing: { pricing_mode: "usd" },
      sources: [
        {
          source: "trae",
          totals: { total_cost_usd: 10, input_tokens: 50_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 10, input_tokens: 50_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
        {
          source: "deepseek",
          totals: { total_cost_usd: 5, input_tokens: 0, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 5, input_tokens: 0, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
      ],
    };
    const fleet = buildFleetData(response);
    const peer = fleet.find((f: any) => f.source === "dsh")?.models?.[0];
    expect(peer?.cacheHitRate).toBeNull();
    const traeProvider = fleet.find((f: any) => String(f.source).toLowerCase() === "trae");
    if (!traeProvider) throw new Error("expected a TRAE provider in the fleet");
    expect(buildTraeCostInterval(traeProvider, fleet)).toBeNull();
  });

  it("builds an interval through the real buildFleetData path (per-model cacheHitRate attached)", () => {
    // Regression: buildFleetData did not attach a per-model cacheHitRate, so
    // every peer model was skipped and the interval was always null in
    // production — TRAE stayed at its all-uncached ceiling. This exercises the
    // exact production shape (raw API response -> buildFleetData -> interval)
    // instead of hand-constructing peers that already carry cacheHitRate.
    const response = {
      pricing: { pricing_mode: "usd" },
      sources: [
        {
          source: "trae",
          totals: { total_cost_usd: 16.2, input_tokens: 60_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 16.2, input_tokens: 60_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
        {
          source: "deepseek",
          totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
      ],
    };
    const fleet = buildFleetData(response);
    const traeProvider = fleet.find((f: any) => String(f.source).toLowerCase() === "trae");
    if (!traeProvider) throw new Error("expected a TRAE provider in the fleet");
    // The DeepSeek peer must carry a computed per-model hit rate: 9M/(1M+9M)=90%.
    // (buildFleetData folds the "deepseek" source alias into "dsh".)
    const peerModel = fleet.find((f: any) => f.source === "dsh")?.models?.[0];
    expect(peerModel?.cacheHitRate).toBe(90);
    const interval = buildTraeCostInterval(traeProvider, fleet);
    if (!interval) throw new Error("expected an interval via the real buildFleetData path");
    expect(interval.high).toBeCloseTo(16.2, 5);
    expect(interval.low).toBeCloseTo(16.2 * (0.1 + 0.9 * 0.02), 5);
    expect(interval.low).toBeLessThan(interval.high);
    expect(interval.medianHitRate).toBe(90);
  });

  it("ignores non-TRAE providers and models without an entry in the discount table", () => {
    const deepseekCard = { source: "deepseek", usd: 5, models: traeCard.models };
    expect(buildTraeCostInterval(deepseekCard, [deepseekCard, ...peers])).toBeNull();
    // longcat has no cache-read discount entry: floor would be fabricated.
    const longcatCard = {
      source: "trae",
      usd: 3,
      models: [{ id: "longcat-2.5", name: "longcat-2.5", cost: 3, usage: 1_000_000, tokens: { input: 900_000, cached: 0 } }],
    };
    expect(buildTraeCostInterval(longcatCard, [longcatCard, ...peers])).toBeNull();
  });
});

describe("applyTraeEstimatedCosts", () => {
  // Raw API shape -> buildFleetData -> apply, i.e. the exact production path.
  const rawResponse = () => ({
    pricing: { pricing_mode: "usd" },
    sources: [
      {
        source: "trae",
        totals: { total_cost_usd: 19.2, input_tokens: 61_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 5 },
        models: [
          { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 16.2, input_tokens: 60_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 5 } },
          { model_id: "longcat-2.5", name: "longcat-2.5", totals: { total_cost_usd: 3, input_tokens: 1_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 2 } },
        ],
      },
      {
        source: "deepseek",
        totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 },
        models: [
          { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 } },
        ],
      },
    ],
  });
  const traeOf = (fleet: any[]) => fleet.find((f: any) => String(f.source).toLowerCase() === "trae");

  it("prices TRAE's unknown-cache model at the peer-median fold and preserves the ceiling", () => {
    const fleet = applyTraeEstimatedCosts(buildFleetData(rawResponse()));
    const trae = traeOf(fleet);
    if (!trae) throw new Error("expected a TRAE provider");
    const ds = trae.models.find((m: any) => m.name === "deepseek-v4.1-flash");
    // Peer median 90% -> folded = 16.2 * (0.1 + 0.9 * 0.02).
    expect(ds.cost).toBeCloseTo(16.2 * 0.118, 5);
    expect(ds.ceilingCost).toBeCloseTo(16.2, 5);
    // longcat has no discount entry: keeps its ceiling, no marker.
    const lc = trae.models.find((m: any) => m.name === "longcat-2.5");
    expect(lc.cost).toBeCloseTo(3, 5);
    expect(lc.ceilingCost).toBeUndefined();
    // Provider totals switch to the estimate, ceiling kept for the notice.
    expect(trae.usd).toBeCloseTo(16.2 * 0.118 + 3, 5);
    expect(trae.ceilingUsd).toBeCloseTo(19.2, 5);
    expect(trae.traeEstimate.medianHitRate).toBe(90);
    expect(trae.traeEstimate.covered).toBe(1);
    // Source-line cache stats are estimated the same way (owner ruling): the
    // covered model contributes input*H cache reads (60M*0.9=54M) against its
    // whole input-side volume; longcat keeps its real (zero) cache.
    expect(trae.cacheReusedTokens).toBeCloseTo(54_000_000, 0);
    expect(trae.cacheInputTokens).toBeCloseTo(61_000_000, 0);
    expect(trae.cacheHitRate).toBe(89);
    // Non-TRAE providers are untouched.
    const dsh = fleet.find((f: any) => f.source === "dsh");
    expect(dsh.traeEstimate).toBeUndefined();
    expect(dsh.ceilingUsd).toBeUndefined();
  });

  it("leaves TRAE untouched when no peer evidence exists (nothing fabricated)", () => {
    const lonely = {
      pricing: { pricing_mode: "usd" },
      sources: [rawResponse().sources[0]],
    };
    const fleet = applyTraeEstimatedCosts(buildFleetData(lonely));
    const trae = traeOf(fleet);
    expect(trae.traeEstimate).toBeUndefined();
    expect(trae.ceilingUsd).toBeUndefined();
    const ds = trae.models.find((m: any) => m.name === "deepseek-v4.1-flash");
    expect(ds.cost).toBeCloseTo(16.2, 5);
    expect(ds.ceilingCost).toBeUndefined();
  });

  it("is idempotent — re-applying never double-folds", () => {
    const fleet = applyTraeEstimatedCosts(buildFleetData(rawResponse()));
    const trae = traeOf(fleet);
    const once = trae.usd;
    const onceModelCost = trae.models[0].cost;
    applyTraeEstimatedCosts(fleet);
    expect(traeOf(fleet).usd).toBe(once);
    expect(trae.models[0].cost).toBe(onceModelCost);
    // The aggregate interval wrapper reads the stored estimate, not a re-fold.
    const interval = buildTraeCostInterval(traeOf(fleet), fleet);
    if (!interval) throw new Error("expected the stored estimate as an interval");
    expect(interval.high).toBeCloseTo(19.2, 5);
    expect(interval.low).toBe(once);
  });

  it("estimates TRAE CN cache and cost when the client stopped reporting cache fields", () => {
    const cnResponse = {
      pricing: { pricing_mode: "usd" },
      sources: [
        {
          source: "trae-cn",
          totals: { total_cost_usd: 18, input_tokens: 60_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, conversation_count: 600 },
          models: [
            {
              model_id: "deepseek-v4.1-flash",
              name: "deepseek-v4.1-flash",
              pricing: { input: 0.3, output: 1.2, cache_read: 0.006, cache_write: 0.3 },
              totals: { total_cost_usd: 18, input_tokens: 60_000_000, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, conversation_count: 600 },
            },
          ],
        },
        {
          source: "deepseek",
          totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
      ],
    };
    const fleet = applyTraeEstimatedCosts(buildFleetData(cnResponse));
    const cn = fleet.find((f: any) => f.source === "trae-cn");
    if (!cn) throw new Error("expected a TRAE CN provider");
    const model = cn.models[0];
    // Peer median 90% and cache_read/input = 0.006/0.3 = 2%.
    expect(model.cost).toBeCloseTo(18 * (0.1 + 0.9 * 0.02), 5);
    expect(model.ceilingCost).toBeCloseTo(18, 5);
    // The token columns are estimated too, so the card and its detail agree.
    expect(model.tokens.cached).toBeCloseTo(54_000_000, 0);
    expect(model.tokens.input).toBeCloseTo(6_000_000, 0);
    expect(model.cacheHitRate).toBe(90);
    expect(model.cacheEstimated).toBe(true);
    expect(cn.traeEstimate.medianHitRate).toBe(90);
  });

  it("folds a below-gate sprinkle of measured rows instead of trusting it as 'measured'", () => {
    // Production shape 2026-11-07: the client writes the cache fields only on
    // a few small requests (44k measured against 74.2M input ≈ 0.06%), so the
    // old any-measured-row gate kept the whole card at the uncached ceiling.
    // Below the 50% coverage gate the peer-median fold must take over and the
    // estimate must absorb the sprinkle (volume-conserving).
    const sprinkle = {
      pricing: { pricing_mode: "usd" },
      sources: [
        {
          source: "trae-cn",
          totals: { total_cost_usd: 18, input_tokens: 74_176_000, cached_input_tokens: 44_000, cache_creation_input_tokens: 0, conversation_count: 174 },
          models: [
            {
              model_id: "deepseek-v4.1-flash",
              name: "deepseek-v4.1-flash",
              pricing: { input: 0.3, output: 1.2, cache_read: 0.006, cache_write: 0.3 },
              totals: { total_cost_usd: 18, input_tokens: 74_176_000, cached_input_tokens: 44_000, cache_creation_input_tokens: 0, output_tokens: 0, conversation_count: 174, cache_observed_input_tokens: 44_000 },
            },
          ],
        },
        {
          source: "deepseek",
          totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
      ],
    };
    const fleet = applyTraeEstimatedCosts(buildFleetData(sprinkle));
    const cn = fleet.find((f: any) => f.source === "trae-cn");
    if (!cn) throw new Error("expected a TRAE CN provider");
    const model = cn.models[0];
    // Coverage 44k/74.22M = 0.06% < 50% gate -> peer median 90% folds the cost.
    expect(model.cost).toBeCloseTo(18 * (0.1 + 0.9 * 0.02), 5);
    expect(model.cacheEstimated).toBe(true);
    // Volume-conserving rewrite: the 44k measured sprinkle is absorbed — the
    // volume (74.176M + 44k) splits 90/10, not stacked on top of the estimate.
    const volume = 74_176_000 + 44_000;
    expect(model.tokens.cached).toBeCloseTo(volume * 0.9, 0);
    expect(model.tokens.input).toBeCloseTo(volume * 0.1, 0);
    expect(model.cacheHitRate).toBe(90);
    expect(cn.traeEstimate.medianHitRate).toBe(90);
  });

  it("keeps a pre-v5 model (no observed signal) untouched even when a peer exists", () => {
    // The sprinkle fixture WITHOUT its observed signal = a pre-v5 bucket:
    // coverage is genuinely unknown (the hit rate cannot stand in for it), so
    // the conservative stance wins and nothing is folded.
    const preV5 = {
      pricing: { pricing_mode: "usd" },
      sources: [
        {
          source: "trae-cn",
          totals: { total_cost_usd: 18, input_tokens: 74_176_000, cached_input_tokens: 44_000, cache_creation_input_tokens: 0, conversation_count: 174 },
          models: [
            {
              model_id: "deepseek-v4.1-flash",
              name: "deepseek-v4.1-flash",
              pricing: { input: 0.3, output: 1.2, cache_read: 0.006, cache_write: 0.3 },
              totals: { total_cost_usd: 18, input_tokens: 74_176_000, cached_input_tokens: 44_000, cache_creation_input_tokens: 0, output_tokens: 0, conversation_count: 174 },
            },
          ],
        },
        {
          source: "deepseek",
          totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
      ],
    };
    const fleet = applyTraeEstimatedCosts(buildFleetData(preV5));
    const cn = fleet.find((f: any) => f.source === "trae-cn");
    const model = cn.models[0];
    expect(model.cost).toBeCloseTo(18, 5);
    expect(model.cacheEstimated).toBeUndefined();
    expect(cn.traeEstimate).toBeUndefined();
  });

  it("estimates from the model's own fielded history when the period has no same-model peer", () => {
    // Production shape (owner ruling 2026-11-07): a day view where no other
    // source observed the model — the peer pool is empty, but TRAE CN's own
    // fielded history (Sep/Oct: 95-97% measured) is real evidence. The fold
    // runs with the self-observed rate instead of leaving a measured 0%.
    const dayView = {
      pricing: { pricing_mode: "usd" },
      sources: [
        {
          source: "trae-cn",
          totals: { total_cost_usd: 18, input_tokens: 74_176_000, cached_input_tokens: 44_000, cache_creation_input_tokens: 0, conversation_count: 174 },
          models: [
            {
              model_id: "deepseek-v4.1-flash",
              name: "deepseek-v4.1-flash",
              pricing: { input: 0.3, output: 1.2, cache_read: 0.006, cache_write: 0.3 },
              cache_observed_hit_rate: 95.2,
              totals: { total_cost_usd: 18, input_tokens: 74_176_000, cached_input_tokens: 44_000, cache_creation_input_tokens: 0, output_tokens: 0, conversation_count: 174, cache_observed_input_tokens: 44_000 },
            },
          ],
        },
      ],
    };
    const fleet = applyTraeEstimatedCosts(buildFleetData(dayView));
    const cn = fleet.find((f: any) => f.source === "trae-cn");
    if (!cn) throw new Error("expected a TRAE CN provider");
    const model = cn.models[0];
    // Coverage 0.06% < 50% gate -> fold with the self-observed 95.2%:
    // cost = 18 * (0.048 + 0.952 * 0.02).
    expect(model.cost).toBeCloseTo(18 * (0.048 + 0.952 * 0.02), 5);
    expect(model.cacheEstimated).toBe(true);
    const volume = 74_176_000 + 44_000;
    expect(model.tokens.cached).toBeCloseTo(volume * 0.952, 0);
    expect(model.cacheHitRate).toBe(95);
    expect(cn.traeEstimate.medianHitRate).toBe(95.2);
  });

  it("never replaces measured cache with an estimate (no observed signal: pre-v5 ledger keeps the conservative stance)", () => {
    const measured = {
      pricing: { pricing_mode: "usd" },
      sources: [
        {
          source: "trae-cn",
          totals: { total_cost_usd: 8, input_tokens: 5_000_000, cached_input_tokens: 45_000_000, cache_creation_input_tokens: 0, conversation_count: 100, cache_observed_input_tokens: 50_000_000 },
          models: [
            {
              model_id: "deepseek-v4.1-flash",
              name: "deepseek-v4.1-flash",
              pricing: { input: 0.3, output: 1.2, cache_read: 0.006, cache_write: 0.3 },
              totals: { total_cost_usd: 8, input_tokens: 5_000_000, cached_input_tokens: 45_000_000, cache_creation_input_tokens: 0, conversation_count: 100, cache_observed_input_tokens: 50_000_000 },
            },
          ],
        },
        {
          source: "deepseek",
          totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 },
          models: [
            { model_id: "deepseek-v4.1-flash", name: "deepseek-v4.1-flash", totals: { total_cost_usd: 5, input_tokens: 1_000_000, cached_input_tokens: 9_000_000, cache_creation_input_tokens: 0, conversation_count: 5 } },
          ],
        },
      ],
    };
    const fleet = applyTraeEstimatedCosts(buildFleetData(measured));
    const cn = fleet.find((f: any) => f.source === "trae-cn");
    const model = cn.models[0];
    expect(model.cost).toBeCloseTo(8, 5);
    expect(model.tokens.cached).toBe(45_000_000);
    expect(model.cacheEstimated).toBeUndefined();
    expect(cn.traeEstimate).toBeUndefined();
  });
});
