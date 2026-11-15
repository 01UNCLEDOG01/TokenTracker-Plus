// README 对外计数门禁（2026-11-15 站主令：数字漂移不允许再靠人眼抓）。
// 三个「对外宣称」的数字必须与代码真值一致，任何一个 README 落后即红：
//   - 福利指南家数 = dashboard/src/data/perksData.js 的 PERK_PROVIDERS.length
//   - 限额来源数 = dashboard/src/lib/limits-providers.js 的 LIMIT_PROVIDER_IDS.length
//     （面板可见注册表；src/lib/usage-limits.js 的 union 多一个 server-only vyceai，
//      见该文件 :95 注释——门禁只认用户看得到的面板注册表）
//   - AI 工具数 = src/commands/init.js 的 SUPPORTED_PROVIDERS.length
// 另断言 README 引用的截图文件真实存在。
// 措辞变了导致正则不中也是红：这既是同步检查，也是「别悄悄改口径」的锁。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function countArrayStrings(source, arrayName) {
  const start = source.indexOf(`${arrayName} = [`);
  if (start < 0) throw new Error(`array ${arrayName} not found`);
  const end = source.indexOf("];", start);
  const block = source.slice(start, end);
  return (block.match(/"([^"]+)"/g) || []).length;
}

function readPerkProviderCount() {
  const { PERK_PROVIDERS } = require(path.join(ROOT, "dashboard", "src", "data", "perksData.js"));
  return PERK_PROVIDERS.length;
}

function readQuotaSourceCount() {
  const s = fs.readFileSync(path.join(ROOT, "dashboard", "src", "lib", "limits-providers.js"), "utf8");
  return countArrayStrings(s, "LIMIT_PROVIDER_IDS");
}

function readToolCount() {
  const s = fs.readFileSync(path.join(ROOT, "src", "commands", "init.js"), "utf8");
  return countArrayStrings(s, "SUPPORTED_PROVIDERS");
}

// 每个 README 的计数断言模式（键=文件名）。措辞改了改这里，别绕过门禁。
const README_PATTERNS = [
  {
    file: "README.md",
    perks: /(\d+)\s*家服务商/,
    quota: /(\d+)\s*项配额\/余额来源/,
    tools: /(\d+)\s*款 AI 编码工具/,
  },
  {
    file: "README.en.md",
    perks: /(\d+)\s*providers/,
    quota: /(\d+)\s*sources? in total|(\d+)\s*quota\/balance sources?/,
    tools: /(\d+)\s*AI (?:coding tools|coding tools·IDE|coding tools and IDEs)/,
  },
  {
    file: "README.zh-TW.md",
    perks: /(\d+)\s*家服務商/,
    quota: /(\d+)\s*個限額來源|(\d+)\s*項配額/,
    tools: /(\d+)\s*款 AI/,
  },
  {
    file: "README.ja.md",
    perks: /(\d+)\s*のサービス・クライアント/,
    quota: /(\d+)\s*のクォータ\/残高ソース/,
    tools: /(\d+)\s*(?:ツール|の AI コーディングツール)/,
  },
  {
    file: "README.ko.md",
    perks: /(\d+)개 서비스와?\s*클라이언트|(\d+)개 서비스와 클라이언트/,
    quota: /(\d+)개 쿼터\/잔액 소스/,
    tools: /(\d+)개 AI 코딩 도구|(\d+)종\(국내외/,
  },
  {
    file: "README.pt-BR.md",
    perks: /(\d+)\s*serviços e clientes/,
    quota: /(\d+)\s*fontes de cota\/saldo|(\d+)\s*fontes no total/,
    tools: /(\d+)\s*(?:ferramentas de IA|ferramentas)/,
  },
];

test("perks provider count in every README matches perksData", () => {
  const count = readPerkProviderCount();
  assert.ok(count > 0, "perksData must resolve");
  for (const { file, perks } of README_PATTERNS) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const m = text.match(perks);
    assert.ok(m, `${file}: perks count pattern not found — update README_PATTERNS and the README together`);
    const claimed = Number(m[1] ?? m[2]);
    assert.equal(claimed, count, `${file}: perks provider count drifted from code truth (${count})`);
  }
});

test("quota source count in every README matches the panel registry", () => {
  const count = readQuotaSourceCount();
  assert.ok(count > 0, "limits-providers registry must resolve");
  for (const { file, quota } of README_PATTERNS) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const m = text.match(quota);
    assert.ok(m, `${file}: quota count pattern not found — update README_PATTERNS and the README together`);
    const claimed = Number(m[1] ?? m[2]);
    assert.equal(claimed, count, `${file}: quota source count drifted from the panel registry (${count})`);
  }
});

test("AI tool count in every README matches init.js SUPPORTED_PROVIDERS", () => {
  const count = readToolCount();
  assert.ok(count > 0, "init.js SUPPORTED_PROVIDERS must resolve");
  for (const { file, tools } of README_PATTERNS) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const m = text.match(tools);
    assert.ok(m, `${file}: tool count pattern not found — update README_PATTERNS and the README together`);
    const claimed = Number(m[1] ?? m[2]);
    assert.equal(claimed, count, `${file}: AI tool count drifted from init.js (${count})`);
  }
});

test("every screenshot referenced by a README exists on disk", () => {
  for (const { file } of README_PATTERNS) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const refs = [...text.matchAll(/\.\/(docs\/screenshots\/[\w.-]+\.png)/g)].map((m) => m[1]);
    for (const rel of refs) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${file} references missing screenshot ${rel}`);
    }
  }
});
