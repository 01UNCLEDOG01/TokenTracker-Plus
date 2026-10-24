const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const CATALOG_PATH = path.join(
  ROOT,
  "dashboard",
  "src",
  "ui",
  "achievements",
  "badge-catalog.js",
);
const TITLE_REGISTRY_PATH = path.join(
  ROOT,
  "dashboard",
  "src",
  "ui",
  "achievements",
  "title-registry.js",
);

const MINTED_HOUSE_COINS = new Set([
  "closed-source-loyalist.png",
  "frugal-architect.png",
  "offgrid-sovereign.png",
  "megacontext-voyager.png",
  "cache-miser.png",
  "code-cannon.png",
  "buzzer-beater.png",
  "zen-balancer.png",
  "swarm-commander.png",
  "terminal-purist.png",
  "refactor-titan.png",
  "deep-thinker.png",
  "heart-model.png",
  "claude-survivor.png",
  "wishing-well.png",
  "zhipu-sage.png",
  "moonshot-voyager.png",
  "minimax-abyss.png",
  "north-america-doubao.png",
  "hyperspeed-grok.png",
  "qwen-dynasty.png",
  "flash-immortal.png",
  "seedance-master.png",
  "token-arbitrageur.png",
]);

test("every achievement uses an original badge-id artwork file", () => {
  const catalog = fs.readFileSync(CATALOG_PATH, "utf8");
  const rows = [...catalog.matchAll(/id: "([a-z_]+)"[^\n]+art: "\/achievements\/([^"?]+)/g)];

  assert.ok(rows.length >= 15, "expected the full achievement artwork catalog");

  for (const [, id, filename] of rows) {
    const expected = `${id.replaceAll("_", "-")}.png`;
    assert.equal(filename, expected, `${id} still references non-original artwork`);

    const artworkPath = path.join(ROOT, "dashboard", "public", "achievements", filename);
    const png = fs.readFileSync(artworkPath);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${filename} is not a PNG`);
    assert.equal(png.readUInt32BE(16), 256, `${filename} must be 256px wide`);
    assert.equal(png.readUInt32BE(20), 256, `${filename} must be 256px tall`);
    assert.ok(png.includes(Buffer.from("tRNS")), `${filename} must retain transparency`);

    // Minted house coins must retain strict 2-level binary alpha (no semi-transparent halo)
    if (MINTED_HOUSE_COINS.has(filename)) {
      const trnsIdx = png.indexOf(Buffer.from("tRNS"));
      assert.ok(trnsIdx !== -1, `${filename} must include tRNS chunk`);
      const len = png.readUInt32BE(trnsIdx - 4);
      const trnsData = png.subarray(trnsIdx + 4, trnsIdx + 4 + len);
      const semiCount = [...trnsData].filter((a) => a > 0 && a < 255).length;
      assert.equal(semiCount, 0, `${filename} must have 0 semi-transparent pixels (binary alpha)`);
    }
  }
});

// Upstream's hand-painted medallions keep their soft edges; every coin minted
// in this fork must fill the same disc so the UI tier ring renders evenly.
const UPSTREAM_PAINTED = new Set([
  "token-titan.png", "big-day.png", "wordsmith.png", "marathoner.png", "streak.png",
  "weekend-warrior.png", "momentum.png", "polyglot.png", "trendsetter.png", "multitool.png",
  "podium.png", "veteran.png", "project-hopper.png", "project-devotion.png", "night-owl.png",
]);

test("minted coins fill the standard 237px disc with binary alpha", () => {
  const { PNG } = require("pngjs");
  const catalog = fs.readFileSync(CATALOG_PATH, "utf8");
  const files = [...catalog.matchAll(/art: "\/achievements\/([^"?]+)/g)].map((m) => m[1]);

  for (const filename of files) {
    if (UPSTREAM_PAINTED.has(filename)) continue;
    const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, "dashboard", "public", "achievements", filename)));
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, semi = 0;
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        const a = png.data[(y * png.width + x) * 4 + 3];
        if (a > 0 && a < 255) semi++;
        if (a === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    assert.equal(semi, 0, `${filename} must have binary alpha`);
    assert.deepEqual([x0, y0, x1, y1], [9, 9, 245, 245], `${filename} coin must span pixels 9..245 on both axes`);
  }
});

test("every synergy title uses an original 3D crest artwork file with binary alpha", () => {
  const registry = fs.readFileSync(TITLE_REGISTRY_PATH, "utf8");
  const matches = [...registry.matchAll(/art:\s*"\/achievements\/titles\/([^"?]+)/g)];
  // One `en:` line per title, and only per title: badge entries carry no
  // English name. Deriving the expected count from the registry keeps this
  // gate from needing an edit every time a title is added.
  const titleCount = [...registry.matchAll(/^\s+en:\s*"/gm)].length;

  assert.ok(titleCount >= 11, `the registry must parse as a title list, saw ${titleCount}`);
  assert.equal(matches.length, titleCount, "every title needs its own crest");

  for (const [, filename] of matches) {
    const artworkPath = path.join(ROOT, "dashboard", "public", "achievements", "titles", filename);
    assert.ok(fs.existsSync(artworkPath), `${filename} must exist`);

    const png = fs.readFileSync(artworkPath);
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${filename} is not a PNG`);
    assert.equal(png.readUInt32BE(16), 256, `${filename} must be 256px wide`);
    assert.equal(png.readUInt32BE(20), 256, `${filename} must be 256px tall`);

    const trnsIdx = png.indexOf(Buffer.from("tRNS"));
    assert.ok(trnsIdx !== -1, `${filename} must include tRNS chunk`);
    const len = png.readUInt32BE(trnsIdx - 4);
    const trnsData = png.subarray(trnsIdx + 4, trnsIdx + 4 + len);
    const semiCount = [...trnsData].filter((a) => a > 0 && a < 255).length;
    assert.equal(semiCount, 0, `${filename} must have 0 semi-transparent pixels (binary alpha)`);
  }
});
