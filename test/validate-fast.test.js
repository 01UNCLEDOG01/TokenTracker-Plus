const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const { STEPS } = require("../scripts/validate-fast.cjs");

// 2026-11-13: validate:fast 从 10 层 `npm run` 收成 scripts/validate-fast.cjs 一条
// 单进程链。这里锁两件事，防止「加了新校验器但只登记在 package.json」或「顺序被
// 随手重排」——链的顺序有依赖（art/docs 依赖前面语言包与 copy 注册表状态）。
const EXPECTED = [
  "validate:readme",
  "validate:copy",
  "validate:locale",
  "validate:ui-hardcode",
  "validate:guardrails",
  "validate:versions",
  "validate:retros",
  "validate:art",
  "validate:docs",
  "validate:perks",
];

test("validate:fast 的步骤顺序与清单被锁住", () => {
  assert.deepEqual(STEPS.map(([name]) => name), EXPECTED);
});

test("每一步都指向真实存在的校验器，并与 package.json 的单项脚本一致", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  assert.equal(pkg.scripts["validate:fast"], "node scripts/validate-fast.cjs");
  for (const [name, script] of STEPS) {
    const file = path.join(repo, script);
    assert.ok(fs.existsSync(file), `${name} 指向的 ${script} 不存在`);
    assert.equal(
      pkg.scripts[name],
      `node ${script}`,
      `${name} 的单跑脚本与 validate-fast 清单不一致（package.json: ${pkg.scripts[name]}）`,
    );
  }
});

test("validate:fast 不重复跑同一个校验器", () => {
  const scripts = STEPS.map(([, script]) => script);
  assert.equal(new Set(scripts).size, scripts.length);
});
