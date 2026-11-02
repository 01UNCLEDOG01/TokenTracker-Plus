"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  fetchAihotModels,
  parseAihotBoard,
  stripTags,
  cachePath,
  CACHE_TTL_MS,
  SCHEMA,
} = require("../src/lib/aihot-models");

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-aihot-models-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

// AIHOT server-renders one <tr data-slug=...> per model with eight cells:
// rank / model+provider / release date / eval coverage / three ¥ prices / score.
function rowHtml({
  slug, rank, name, provider, date = "2026-09-22", evals = 55, coverage = 100,
  cachePrice = "¥1.33", inputPrice = "¥26.61", outputPrice = "¥133.06", score = 73.8,
}) {
  return `<tr data-slug="${slug}" class="group cursor-pointer border-b border-line">`
    + `<td class="py-2.5"><span class="mono">${rank}</span></td>`
    + `<td class="px-2"><span><a href="/leaderboard/${slug}"><strong>${name}</strong></a></span>`
    + `<small class="hidden side:block">${provider}</small>`
    + `<small class="block side:hidden">${provider} · 9月22日 上线</small></td>`
    + `<td class="hidden side:table-cell"><time dateTime="${date}">${date}</time></td>`
    + `<td class="hidden"><span class="num">${evals} 项评测</span><span>覆盖 ${coverage}%</span></td>`
    + `<td class="mono hidden side:table-cell">${cachePrice}</td>`
    + `<td class="mono hidden wide:table-cell">${inputPrice}</td>`
    + `<td class="mono hidden wide:table-cell">${outputPrice}</td>`
    + `<td class="mono">${score} 覆盖 ${coverage}%</td></tr>`;
}

function boardHtml(rows) {
  return `<html><body><table><tbody>${rows.join("")}</tbody></table></body></html>`;
}

test("stripTags removes markup and decodes common entities", () => {
  assert.equal(stripTags("<strong>A &amp; B</strong>  x"), "A & B x");
});

test("parseAihotBoard reads every field from the server-rendered rows", () => {
  const rows = parseAihotBoard(boardHtml([
    rowHtml({ slug: "claude-opus-5-5", rank: "01", name: "Claude Opus 5.5", provider: "Anthropic", score: 73.8 }),
    rowHtml({ slug: "gpt-6-astra", rank: "02", name: "GPT-6 Astra", provider: "OpenAI", date: "2026-09-03", evals: 50, coverage: 95, cachePrice: "¥6.65", inputPrice: "¥66.53", outputPrice: "¥332.64", score: 71.6 }),
  ]));

  assert.equal(rows.length, 2);
  const [first, second] = rows;
  assert.equal(first.rank, 1);
  assert.equal(first.model, "claude-opus-5-5");
  assert.equal(first.display_name, "Claude Opus 5.5");
  assert.equal(first.provider, "Anthropic");
  assert.equal(first.score, 73.8);
  assert.equal(first.release_date, "2026-09-22");
  assert.equal(first.eval_count, 55);
  assert.equal(first.eval_coverage_percent, 100);
  assert.equal(first.cache_per_million_cny, 1.33);
  assert.equal(first.input_per_million_cny, 26.61);
  assert.equal(first.output_per_million_cny, 133.06);
  assert.equal(second.provider, "OpenAI");
  assert.equal(second.release_date, "2026-09-03");
  assert.equal(second.eval_coverage_percent, 95);
  assert.equal(second.input_per_million_cny, 66.53);
});

test("parseAihotBoard sorts by score and re-ranks, skipping unscored rows", () => {
  const rows = parseAihotBoard(boardHtml([
    rowHtml({ slug: "lower", rank: "01", name: "Lower Score", provider: "A", score: 50 }),
    rowHtml({ slug: "higher", rank: "02", name: "Higher Score", provider: "B", score: 80 }),
    // A row without a score (page under maintenance cell, etc.) must not rank.
    `<tr data-slug="broken"><td>03</td><td><strong>Broken</strong></td></tr>`,
  ]));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, "higher");
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].model, "lower");
  assert.equal(rows[1].rank, 2);
});

test("parseAihotBoard throws when the markup no longer matches (stale-cache path)", () => {
  assert.throws(() => parseAihotBoard("<html><body>maintenance</body></html>"));
});

test("fetchAihotModels caches by TTL, serves stale on fetch failure, and honors force", async () => {
  const home = sandbox();
  try {
    const goodHtml = boardHtml([rowHtml({ slug: "m-1", rank: "01", name: "Model One", provider: "L1", score: 70 })]);
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return { ok: true, status: 200, text: async () => goodHtml };
      throw new Error("network down");
    };

    const first = await fetchAihotModels({ home, fetchImpl });
    assert.equal(first.stale, false);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].display_name, "Model One");
    assert.equal(first.source_url, "https://aihot.news/leaderboard");
    assert.equal(calls, 1);

    // Within the TTL the cache answers without a network call.
    const cached = await fetchAihotModels({ home, fetchImpl });
    assert.equal(cached.stale, false);
    assert.equal(cached.items.length, 1);
    assert.equal(calls, 1);
    assert.equal(CACHE_TTL_MS, 6 * 60 * 60 * 1000);

    // Force refresh with a failing network serves the cached snapshot as stale.
    const stale = await fetchAihotModels({ home, fetchImpl, force: true });
    assert.equal(stale.stale, true);
    assert.equal(stale.items.length, 1);
    assert.equal(stale.schema, SCHEMA);
    assert.ok(fs.existsSync(cachePath(home)));
  } finally {
    cleanup(home);
  }
});

test("fetchAihotModels reports an empty board with an error when nothing is cached", async () => {
  const home = sandbox();
  try {
    const result = await fetchAihotModels({ home, fetchImpl: async () => { throw new Error("down"); } });
    assert.equal(result.available !== false, true);
    assert.equal(Array.isArray(result.items), true);
    assert.equal(result.items.length, 0);
    assert.equal(result.stale, false);
    assert.match(result.error, /down/);
  } finally {
    cleanup(home);
  }
});
