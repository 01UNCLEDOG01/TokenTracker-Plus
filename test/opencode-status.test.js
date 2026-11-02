"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { parseOpencodeStatusPayload } = require("../src/lib/provider-status");

test("operational feed maps to indicator none with no description", () => {
  const out = parseOpencodeStatusPayload({
    updatedAt: 1793646326681,
    status: "operational",
    components: [
      { service: "console", status: "operational" },
      { service: "inference", status: "operational" },
    ],
  });
  assert.equal(out.status.indicator, "none");
  assert.equal(out.status.description, "");
  assert.equal(out.page.updated_at, new Date(1793646326681).toISOString());
});

test("a degraded component escalates the overall indicator and names the service", () => {
  const out = parseOpencodeStatusPayload({
    updatedAt: 1,
    status: "operational",
    components: [
      { service: "inference", status: "operational" },
      { service: "go", status: "degraded" },
    ],
  });
  assert.equal(out.status.indicator, "minor");
  assert.match(out.status.description, /go: degraded/);
});

test("an outage component escalates past a degraded one (worst wins)", () => {
  const out = parseOpencodeStatusPayload({
    updatedAt: 1,
    status: "operational",
    components: [
      { service: "go", status: "degraded" },
      { service: "inference", status: "major_outage" },
    ],
  });
  assert.equal(out.status.indicator, "critical");
  assert.match(out.status.description, /inference: major_outage/);
});

test("unrecognized component states degrade to minor, never fake green", () => {
  const out = parseOpencodeStatusPayload({
    updatedAt: 1,
    status: "operational",
    components: [{ service: "mystery", status: "banana" }],
  });
  assert.equal(out.status.indicator, "minor");
  assert.match(out.status.description, /mystery/);
});

test("missing component status also degrades to minor", () => {
  const out = parseOpencodeStatusPayload({
    updatedAt: 1,
    status: "operational",
    components: [{ service: "go" }],
  });
  assert.equal(out.status.indicator, "minor");
});

test("malformed payloads throw so the probe surfaces as an error", () => {
  assert.throws(() => parseOpencodeStatusPayload(null));
  assert.throws(() => parseOpencodeStatusPayload("nope"));
  assert.throws(() => parseOpencodeStatusPayload({ components: [] }));
  assert.throws(() => parseOpencodeStatusPayload([]));
});
