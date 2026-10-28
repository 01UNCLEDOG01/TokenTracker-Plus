const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  readCanonicalVersion,
  collectVersionEntries,
  syncVersions,
  findVersionMismatches,
} = require('../scripts/version-files.cjs');

// Only two managed files are left after the macOS/Linux clients were removed
// on 2026-10-28: the root package.json and the Windows desktop csproj.
function writeFixture(root, canonical = '2.3.4', stale = '0.0.1') {
  const files = {
    'package.json': JSON.stringify({ name: 'tokentracker-plus-cli', version: canonical }, null, 2),
    'TokenTrackerWin/TokenTrackerWin.csproj': `<Project><PropertyGroup><Version>${stale}</Version></PropertyGroup></Project>`,
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

function fixture(canonical, stale) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tokentracker-version-sync-'));
  writeFixture(root, canonical, stale);
  return root;
}

test('syncVersions updates the Windows csproj from the root package version', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const version = readCanonicalVersion(root);
  assert.equal(version, '2.3.4');

  syncVersions(root, version);

  const csproj = fs.readFileSync(path.join(root, 'TokenTrackerWin/TokenTrackerWin.csproj'), 'utf8');
  assert.match(csproj, /<Version>2\.3\.4<\/Version>/);
  assert.deepEqual(findVersionMismatches(root, version), []);
});

test('collectVersionEntries tracks exactly the root package and the csproj', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const labels = collectVersionEntries(root).map((entry) => entry.label).sort();
  assert.deepEqual(labels, ['TokenTrackerWin/TokenTrackerWin.csproj', 'package.json']);
});

test('findVersionMismatches reports the stale csproj without touching files', (t) => {
  const root = fixture('2.3.4', '0.0.1');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const before = fs.readFileSync(path.join(root, 'TokenTrackerWin/TokenTrackerWin.csproj'), 'utf8');
  const mismatches = findVersionMismatches(root, '2.3.4');

  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].label, 'TokenTrackerWin/TokenTrackerWin.csproj');
  assert.equal(mismatches[0].actual, '0.0.1');
  assert.equal(
    fs.readFileSync(path.join(root, 'TokenTrackerWin/TokenTrackerWin.csproj'), 'utf8'),
    before,
  );
});
