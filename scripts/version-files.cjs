const fs = require('fs');
const path = require('path');

const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function assertReleaseVersion(version, label = 'Version') {
  if (typeof version !== 'string' || !RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(`${label} must be a stable x.y.z version, got ${JSON.stringify(version)}`);
  }
  return version;
}

const VERSION_FILES = [
  {
    label: 'package.json',
    read(content) { return JSON.parse(content).version; },
    write(content, version) {
      const json = JSON.parse(content);
      json.version = version;
      return `${JSON.stringify(json, null, 2)}\n`;
    },
  },
  {
    label: 'TokenTrackerWin/TokenTrackerWin.csproj',
    read(content) {
      const matches = [...content.matchAll(/<Version>([^<]+)<\/Version>/g)];
      if (matches.length !== 1) throw new Error('Expected exactly one <Version> entry in TokenTrackerWin/TokenTrackerWin.csproj');
      return matches[0][1];
    },
    write(content, version) { return replaceExactlyOne(content, /(<Version>)[^<]+(<\/Version>)/g, `$1${version}$2`, 'TokenTrackerWin/TokenTrackerWin.csproj <Version>'); },
  },
];

function readFile(root, label) {
  return fs.readFileSync(path.join(root, label), 'utf8');
}

function replaceExactlyOne(content, pattern, replacement, description) {
  const matches = [...content.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${description} entry`);
  return content.replace(pattern, replacement);
}

function readCanonicalVersion(root) {
  const version = VERSION_FILES[0].read(readFile(root, VERSION_FILES[0].label));
  if (typeof version !== 'string' || version.length === 0) throw new Error('Root package.json must contain a version');
  return version;
}

function collectVersionEntries(root) {
  return VERSION_FILES.map(({ label, read }) => ({ label, version: read(readFile(root, label)) }));
}

function syncVersions(root, version) {
  if (typeof version !== 'string' || version.length === 0) throw new Error('Version must be a non-empty string');
  const changed = [];
  for (const file of VERSION_FILES.slice(1)) {
    const filename = path.join(root, file.label);
    const content = fs.readFileSync(filename, 'utf8');
    const updated = file.write(content, version);
    if (updated !== content) {
      fs.writeFileSync(filename, updated, 'utf8');
      changed.push(file.label);
    }
  }
  return changed;
}

function findVersionMismatches(root, version) {
  return collectVersionEntries(root)
    .filter((entry) => entry.version !== version)
    .map(({ label, version: actual }) => ({ label, expected: version, actual }));
}

module.exports = {
  assertReleaseVersion,
  readCanonicalVersion,
  collectVersionEntries,
  syncVersions,
  findVersionMismatches,
};
