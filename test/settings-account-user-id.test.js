"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("Settings account section exposes the signed-in user id for README badges", () => {
  const hookSrc = read("dashboard/src/components/settings/useAccountProfileSettings.js");
  const sectionSrc = read("dashboard/src/components/settings/AccountSection.jsx");
  const copyCsv = read("dashboard/src/content/copy.csv");

  assert.match(hookSrc, /userId: state\.userId/, "expected account settings hook to expose userId");
  assert.match(sectionSrc, /<UserIdRow userId=\{settings\.userId\}/, "expected account section to render user id row");
  // 2026-11-16 站主报两端都没有云同步开关后，开关按 v1.10.5 前旧行为最小复植进
  // 账号区（d5227dd）——旧的「归属专门分区」守卫随那个分区的删除一起作废，改为
  // 钉住新位置：账号区必须渲染 CloudSyncRow（渲染细节由
  // AccountSection.cloudsync.test.jsx 守）。
  assert.match(sectionSrc, /<CloudSyncRow settings=\{settings\} \/>/, "expected cloud sync toggle back in the account section (owner report 2026-11-16)");
  assert.match(sectionSrc, /navigator\.clipboard\.writeText\(userId\)/, "expected copy button to copy userId");
  assert.match(copyCsv, /settings\.account\.userId,/, "expected user id label in copy registry");
  assert.match(copyCsv, /settings\.account\.copyUserId,/, "expected copy aria label in copy registry");
});
