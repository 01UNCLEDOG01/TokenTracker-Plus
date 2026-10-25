"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { antigravityBlobTitleFromBuffer } = require("../src/lib/session-analytics");

// Hand-encoded protobuf: varint + length-delimited fields, no schema needed.
function varint(n) {
  const out = [];
  let v = n;
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return Buffer.from(out);
}
function field(num, payload) {
  return Buffer.concat([varint((num << 3) | 2), varint(payload.length), payload]);
}

test("extracts the Chinese user prompt from a nested metadata blob", () => {
  // Blob shape from the live probe (2026-10-25): repeated field-1 message
  // entries; the prompt text sits in a nested subtree (field 3 here).
  const entry = Buffer.concat([
    field(1, Buffer.from("msg-uuid-1234")),
    field(3, Buffer.from("帮我把登录页的按钮改成渐变蓝色，并适配移动端的小屏", "utf8")),
  ]);
  const blob = field(1, entry);
  assert.equal(antigravityBlobTitleFromBuffer(blob), "帮我把登录页的按钮改成渐变蓝色，并适配移动端的小屏");
});

test("prefers CJK over noise, skips paths and trivial prompts", () => {
  const entry = Buffer.concat([
    field(2, Buffer.from("file:///d:/some/workspace")),
    field(4, Buffer.from("https://github.com/xiufengsun/TokenTracker.git")),
    field(3, Buffer.from("如图这个报错是什么意思，怎么修？", "utf8")),
  ]);
  const blob = Buffer.concat([field(1, entry), field(2, Buffer.from("trajectory-meta"))]);
  assert.equal(antigravityBlobTitleFromBuffer(blob), "如图这个报错是什么意思，怎么修？");
});

test("falls back to a sentence-like ASCII run and returns null for junk", () => {
  const asciiEntry = field(1, field(3, Buffer.from("please refactor the auth flow to use cookies instead")));
  assert.equal(antigravityBlobTitleFromBuffer(asciiEntry), "please refactor the auth flow to use cookies instead");
  const junk = Buffer.concat([field(1, Buffer.from("abc")), field(2, Buffer.from([1, 2, 3]))]);
  assert.equal(antigravityBlobTitleFromBuffer(junk), null);
  const trivial = field(1, field(3, Buffer.from("继续")));
  assert.equal(antigravityBlobTitleFromBuffer(trivial), null);
  assert.equal(antigravityBlobTitleFromBuffer(Buffer.alloc(0)), null);
});
