import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import GlobalModelsPage from "./GlobalModelsPage.jsx";
import { copy } from "../lib/copy";

vi.mock("../ui/dashboard/components/ProviderIcon.jsx", () => ({ ProviderIcon: () => null }));
afterEach(() => vi.unstubAllGlobals());

it("shows unavailable AA metrics as dashes while preserving measured zeroes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ items: [
    { rank: 1, model: "missing", intelligence: null, input_per_million_usd: null, output_per_million_usd: null, cache_hit_per_million_usd: null, median_output_tokens_per_second: null },
    { rank: 2, model: "zero", intelligence: 0, input_per_million_usd: 0, output_per_million_usd: 0, cache_hit_per_million_usd: 0, median_output_tokens_per_second: 0 },
  ] }) })));
  render(<GlobalModelsPage />);
  const missing = (await screen.findByText("missing")).closest("tr");
  expect(within(missing).getAllByRole("cell").slice(3).map((cell) => cell.textContent)).toEqual(Array(6).fill("—"));
  const zero = screen.getByText("zero").closest("tr");
  expect(within(zero).getByText("0.0")).toBeInTheDocument();
  expect(within(zero).getAllByText(copy("global_models.price_value", { value: "0.00" }))).toHaveLength(3);
  expect(within(zero).getByText(copy("global_models.speed_value", { value: 0 }))).toBeInTheDocument();
});

it("shows unavailable AIHOT prices and evaluation coverage as dashes", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url) => ({ ok: true, json: async () =>
    String(url).includes("aihot") ? { category: "overall", items: [
      { rank: 1, model: "aihot-missing", score: null, cache_per_million_cny: null, input_per_million_cny: null, output_per_million_cny: null, eval_coverage_percent: null },
    ] } : { items: [] } })));
  render(<GlobalModelsPage />);
  fireEvent.click(screen.getByRole("tab", { name: copy("global_models.tab_aihot") }));
  const row = (await screen.findByText("aihot-missing")).closest("tr");
  expect(within(row).getAllByRole("cell").slice(3).map((cell) => cell.textContent)).toEqual(Array(6).fill("—"));
  expect(within(row).queryByText("null%")).not.toBeInTheDocument();
});
