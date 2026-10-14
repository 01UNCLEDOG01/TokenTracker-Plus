"use strict";

// The Antigravity conversation database records the project a conversation
// belongs to only as a `file:///` URL inside trajectory_metadata_blob, framed
// by protobuf bytes on both sides. These cases pin the two failure modes that
// motivated the parser: a URL truncated at a space (inventing a project) and a
// blob that quotes several unrelated paths (inventing an ancestor).

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("node:test");

const { antigravityWorkspaceFromBlobText } = require("../src/lib/rollout");

const URL = (p) => `file:///${p.replace(/\\/g, "/")}`;
const sep = path.sep;
const win = sep === "\\";

describe("antigravityWorkspaceFromBlobText", () => {
  it("returns the workspace root when the blob also quotes files below it", () => {
    const root = win ? "f:\\Users\\Administrator\\dev\\shop" : "/Users/dev/shop";
    const text = `\x02>${URL(root)}\x03>${URL(path.join(root, "src", "index.ts"))}\x01`;
    assert.equal(antigravityWorkspaceFromBlobText(text), root);
  });

  it("keeps a space inside the path instead of truncating it", () => {
    const root = win ? "C:\\dev\\My Projects (2024)" : "/Users/dev/My Projects (2024)";
    assert.equal(antigravityWorkspaceFromBlobText(`${URL(root)}\x07`), root);
  });

  it("stops at the framing byte that follows the URL", () => {
    // The real blob writes a record-length byte after the URL; a byte above
    // 0x7e must not become part of the project name.
    const root = win ? "f:\\Users\\Administrator\\dev\\shop" : "/Users/dev/shop";
    assert.equal(antigravityWorkspaceFromBlobText(`${URL(root)}\xc4\x93\x01`), root);
  });

  it("returns null for sibling paths that share no ancestor", () => {
    const a = win ? "C:\\dev\\proj" : "/Users/dev/proj";
    const b = win ? "C:\\dev\\proj-old" : "/Users/dev/proj-old";
    assert.equal(
      antigravityWorkspaceFromBlobText(`${URL(a)}\x01${URL(path.join(b, "src", "a.ts"))}\x01`),
      null,
    );
  });

  it("returns null when the blob quotes only files", () => {
    const a = win ? "C:\\dev\\one\\x.ts" : "/Users/dev/one/x.ts";
    const b = win ? "C:\\dev\\two\\y.ts" : "/Users/dev/two/y.ts";
    assert.equal(antigravityWorkspaceFromBlobText(`${URL(a)}\x01${URL(b)}\x01`), null);
  });

  it("splits URLs written back to back with no framing byte", () => {
    const a = win ? "C:\\dev\\one\\x.ts" : "/Users/dev/one/x.ts";
    const b = win ? "C:\\dev\\two\\y.ts" : "/Users/dev/two/y.ts";
    assert.equal(antigravityWorkspaceFromBlobText(`${URL(a)}${URL(b)}`), null);
  });

  it("rejects a drive or root with fewer than two segments", () => {
    for (const shallow of win ? ["C:\\", "C:\\dev"] : ["/", "/Users"]) {
      assert.equal(antigravityWorkspaceFromBlobText(`${URL(shallow)}\x01`), null, shallow);
    }
  });

  it("ignores the percent-encoded drive form the blob also carries", () => {
    // The blob repeats each workspace as `f%3A/...`; only the plain form is
    // read, so an encoded-only text yields no project rather than a wrong one.
    const root = win ? "f:\\Users\\Administrator\\dev\\shop" : "/Users/dev/shop";
    assert.equal(antigravityWorkspaceFromBlobText(`${URL(root).replace(":", "%3A")}\x01`), null);
  });

  it("ignores empty, missing and non-string input", () => {
    for (const value of ["", null, undefined, 0, "no urls here", "file:///"]) {
      assert.equal(antigravityWorkspaceFromBlobText(value), null);
    }
  });
});
