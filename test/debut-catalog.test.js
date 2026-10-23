const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CATALOG_PATH = path.join(__dirname, "..", "src", "lib", "pricing", "model-debuts.json");
const {
  canonicalModelKey,
  identityKeyFor,
  classifyDebut,
  classifyKey,
  entryFor,
  withinWindow,
  debutWindowDays,
} = require("../src/lib/pricing/debut-catalog");

const catalog = () => JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const entry = (model) => {
  const found = entryFor(model);
  assert.ok(found, `${model} must be in the catalog for this test`);
  return found;
};

test("every catalogued debut is a real ISO date with a cited source", () => {
  const c = catalog();
  const names = Object.keys(c.debuts);
  assert.ok(names.length > 0, "the catalog must not be empty");
  for (const name of names) {
    const e = c.debuts[name];
    assert.match(e.debut, /^\d{4}-\d{2}-\d{2}$/, `${name}: debut must be YYYY-MM-DD`);
    assert.equal(Number.isNaN(Date.parse(`${e.debut}T00:00:00Z`)), false, `${name}: debut must be a real day`);
    assert.ok(e.debut <= "2026-10-23", `${name}: debut cannot be in the future`);
    assert.ok(Array.isArray(e.sources) && e.sources.length > 0, `${name}: needs at least one source URL`);
    for (const url of e.sources) {
      assert.match(url, /^https?:\/\//, `${name}: sources must be absolute URLs, got ${url}`);
    }
  }
});

test("no identity is claimed by two catalog entries", () => {
  const c = catalog();
  const owner = new Map();
  for (const [name, e] of Object.entries(c.debuts)) {
    const own = canonicalModelKey(name);
    for (const alias of [name, ...(e.also || [])]) {
      const key = canonicalModelKey(alias);
      assert.ok(key, `${alias}: normalizes to nothing, so it can never match a ledger row`);
      const prior = owner.get(key);
      assert.equal(
        prior === undefined ? own : prior,
        own,
        `${alias} resolves to ${own} but ${prior} already claims it — one model must have one debut date`,
      );
      owner.set(key, own);
    }
  }
});

test("codenames and not-models behave as declared, and never double-claim a dated model", () => {
  const c = catalog();
  const dated = new Map();
  for (const [name, e] of Object.entries(c.debuts)) {
    dated.set(canonicalModelKey(name), name);
    for (const alias of e.also || []) dated.set(canonicalModelKey(alias), name);
  }
  for (const name of c.codenames) {
    assert.equal(classifyDebut(name, "2026-10-01").status, "codename", `${name} must read as a codename`);
    const key = canonicalModelKey(name);
    if (key) assert.equal(dated.has(key), false, `${name} is both a codename and a dated model`);
  }
  for (const name of c.notModels) {
    assert.equal(classifyDebut(name, "2026-10-01").status, "not-a-model", `${name} must read as a non-model`);
    const key = canonicalModelKey(name);
    if (key) assert.equal(dated.has(key), false, `${name} is both a non-model and a dated model`);
  }
});

test("provider namespaces, quote suffixes and free tags fold onto one key", () => {
  const groups = [
    ["deepseek-ai/DeepSeek-V4-Flash", "DeepSeek-V4-Flash 正式版", "deepseek-v4-flash-free", "deepseek-v4-flash"],
    ["GLM-5.3-Flash", "GLM5.3-Flash（估算）", "b.ai/glm-5.3-flash", "GLM-5.3-Flash（积分）"],
    ["Qwen3.8-Flash（估算）", "Qwen3.8-Flash（积分）", "qwen3.8-flash"],
    ["google/gemma-4-26b-a4b-it:free", "gemma-4-26b-a4b-it"],
  ];
  for (const group of groups) {
    const keys = new Set(group.map((name) => canonicalModelKey(name)));
    assert.equal(keys.size, 1, `${group.join(" / ")} must share one key, got ${[...keys].join(" / ")}`);
  }
});

test("distinct models must not collapse onto one key", () => {
  assert.notEqual(canonicalModelKey("GLM-5.3-Flash"), canonicalModelKey("GLM-5.3-FlashX"));
  assert.notEqual(canonicalModelKey("DeepSeek-V4-Flash"), canonicalModelKey("DeepSeek-V4.1-Flash"));
  assert.notEqual(canonicalModelKey("Qwen3.7-Max"), canonicalModelKey("Qwen3.8-Max"));
  assert.notEqual(canonicalModelKey("Kimi-K2.7"), canonicalModelKey("Kimi-K2.7-Code"));
  assert.notEqual(canonicalModelKey("MiniMax-M3"), canonicalModelKey("MiniMax-M3.1-Flash"));
});

test("a revealed codename is judged by the vendor date, not by first local use", () => {
  // gfmodel / ox-alpha / x-preview-f are all GLM-5.3-Flash: one identity, one slot.
  const id = identityKeyFor("GLM-5.3-Flash");
  assert.equal(id, "glm-5-3-flash");
  for (const alias of ["gfmodel", "ox-alpha", "stealth/ox-alpha", "x-preview-f-free", "GLM5.3-Flash（估算）"]) {
    assert.equal(identityKeyFor(alias), id, `${alias} must fold into ${id}`);
  }
  assert.equal(canonicalModelKey("ox-alpha"), "ox-alpha", "the raw key and the identity key are different things");
});

test("the debut window is inclusive at +windowDays and rejects a pre-debut first use", () => {
  const { debut } = entry("GLM-5.3-Flash");
  const window = debutWindowDays();
  assert.equal(classifyDebut("GLM-5.3-Flash", debut).status, "early");
  assert.equal(classifyDebut("GLM-5.3-Flash", addDays(debut, window)).status, "early");
  assert.equal(classifyDebut("GLM-5.3-Flash", addDays(debut, window + 1)).status, "late");
  assert.equal(classifyDebut("gfmodel", addDays(debut, window + 1)).status, "late", "aliases inherit the verdict");
  assert.equal(classifyDebut("GLM-5.3-Flash", addDays(debut, -1)).status, "late", "used before the vendor shipped it");
});

test("the window is a parameter, so the catalog's windowDays is what judges", () => {
  const c = catalog();
  assert.equal(debutWindowDays(), c.windowDays, "the module must read the window from the file, not a constant");
  const { debut } = entry("GLM-5.3-Flash");
  assert.equal(withinWindow(debut, debut, 0), true, "the debut day itself is inside any window");
  assert.equal(withinWindow(addDays(debut, 7), debut, 7), true);
  assert.equal(withinWindow(addDays(debut, 7), debut, 6), false, "a narrower window must reject the same day");
  assert.equal(withinWindow(addDays(debut, 1), debut, 30), true, "a wider window must accept it");
  assert.equal(withinWindow(addDays(debut, -1), debut, 30), false, "before the vendor shipped it is never early");
  assert.equal(withinWindow("not-a-day", debut, 7), null, "an unusable date yields no verdict");
});

test("unjudged models are neither credited nor punished", () => {
  assert.equal(classifyDebut("glm-5-2-x", "2026-07-08").status, "unverified", "public-looking, no cited date");
  assert.equal(classifyDebut("codely-air", "2026-10-06").status, "codename", "vendor never claimed the slug");
  assert.equal(classifyDebut("space-bunny", "2026-09-28").status, "early", "revealed, so it left the codename list");
  assert.equal(classifyDebut("zai_auto", "2026-09-15").status, "not-a-model");
  assert.equal(classifyDebut("openrouter/free", "2026-10-12").status, "not-a-model");
  assert.equal(classifyDebut("官方云端（积分）", "2026-10-09").status, "not-a-model");
  assert.equal(classifyKey("", "2026-09-15").status, "not-a-model");
});

test("catalogued dates agree with the source-of-truth shape the badge reads", () => {
  const c = catalog();
  assert.equal(c.windowDays, 7);
  assert.equal(typeof c.debuts["MiniMax-M3.1-Flash"].debut, "string");
  assert.equal(identityKeyFor("space-bunny-free"), "minimax-m-3-1-flash");
  assert.equal(identityKeyFor("stealth/space-bunny-alpha"), "minimax-m-3-1-flash");
  assert.equal(identityKeyFor("mmodel"), "minimax-m-3", "a codename folds onto the model it was spotted as");
});
