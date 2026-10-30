"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const VALIDATOR = path.join(ROOT, "scripts", "validate-perks-data.cjs");

const HEAD = `export const PERK_CATEGORIES = [
  { "id": "all", "label": "全部服务商" },
  { "id": "featured", "label": "主力推荐" },
  { "id": "free_tier", "label": "永久/每日免费" },
  { "id": "big_quota", "label": "赠送大额额度" },
  { "id": "client", "label": "客户端/工作台" }
];

export const PERK_PROVIDERS = [`;
const TAIL = `\n];\n`;

const GOOD_ROW = `{
  "id": "acme",
  "name": "Acme AI",
  "provider": "acme",
  "category": ["free_tier"],
  "badge": "每日 100 积分",
  "badgeType": "blue",
  "tags": ["每日签到"],
  "description": "注册后每日登录领 100 积分。",
  "tips": "活动期 2026-10-24 至 2026-11-30，以站内为准。",
  "officialUrl": "https://acme.example",
  "hasInvite": false,
  "checkedAt": "2026-10-31",
  "sourceUrl": "https://acme.example/pricing"
}`;

function run(rowText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-perks-"));
  const file = path.join(dir, "perksData.js");
  fs.writeFileSync(file, `${HEAD}\n${rowText}\n${TAIL}`, "utf8");
  const res = spawnSync(process.execPath, [VALIDATOR, file], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: res.status, out: `${res.stdout || ""}${res.stderr || ""}` };
}

test("线上福利数据通过门禁（每行都有核对时间与来源）", () => {
  const res = spawnSync(process.execPath, [VALIDATOR], { encoding: "utf8", cwd: ROOT });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(res.stdout, /行福利条目全部带核对时间与来源/);
});

test("门禁挡住编造信号", () => {
  const cases = [
    ["缺 sourceUrl", GOOD_ROW.replace(/\n\s*"sourceUrl": "https:\/\/acme\.example\/pricing"/, "")],
    ["缺 checkedAt", GOOD_ROW.replace(/,\n\s*"checkedAt": "2026-10-31"/, "")],
    ["相对时间措辞", GOOD_ROW.replace("注册后每日登录领 100 积分。", "注册后今晚登录领 100 积分。")],
    ["中文日期缺年份", GOOD_ROW.replace("2026-11-30", "11 月 30 日")],
    ["邀请链串到别家", GOOD_ROW.replace('"hasInvite": false', '"hasInvite": true,\n  "inviteUrl": "https://evil.example/acme"')],
    ["hasInvite 与 inviteUrl 不一致", GOOD_ROW.replace('"hasInvite": false', '"hasInvite": false,\n  "inviteUrl": "https://acme.example/go"')],
    ["badgeType 越界", GOOD_ROW.replace('"badgeType": "blue"', '"badgeType": "rainbow"')],
    ["category 越界", GOOD_ROW.replace('"category": ["free_tier"]', '"category": ["unlimited"]')],
    ["http 来源", GOOD_ROW.replace("https://acme.example/pricing", "http://acme.example/pricing")]
  ];
  for (const [label, rowText] of cases) {
    assert.notEqual(rowText, GOOD_ROW, `${label}：fixture 替换没命中，测的是空操作`);
    const res = run(rowText);
    assert.equal(res.status, 1, `${label} 本应被门禁挡住，却通过了：${res.out}`);
  }
});

test("门禁对合规的邀请链与同主域放绿", () => {
  const res = run(
    GOOD_ROW.replace(
      '"hasInvite": false',
      '"inviteUrl": "https://www.acme.example/go?aff=ABCD",\n  "inviteCode": "ABCD",\n  "hasInvite": true'
    )
  );
  assert.equal(res.status, 0, res.out);
});

test("checkedAt 过期只提醒不判红", () => {
  const res = run(GOOD_ROW.replace("2026-10-31", "2020-01-01"));
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /已超过 45 天/);
});

test("门禁挡住重复条目（同一官网主机出现两次）", () => {
  const dupe = `${GOOD_ROW},
${GOOD_ROW
  .replace('"id": "acme"', '"id": "acme-intl"')
  .replace('"name": "Acme AI"', '"name": "Acme AI 国际站"')}`;
  const res = run(dupe);
  assert.equal(res.status, 1, res.out);
  assert.match(res.out, /officialUrl 主机/);
});
