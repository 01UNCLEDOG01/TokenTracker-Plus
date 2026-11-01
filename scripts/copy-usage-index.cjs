#!/usr/bin/env node
/**
 * scripts/copy-usage-index.cjs
 *
 * 模板感知的文案键引用索引（2026-11-01 站主令）。
 *
 * 背景：validate:copy 的「未使用键」报告按字面 grep 计数，而 UI 大量通过
 * 模板拼键（`copy(\`achievements.badge.${id}.name\`)`）取文案——这类家族
 * 会被误报成未使用。本工具把两类引用都解析出来，对 copy.csv 的每个键给出：
 *
 *   literal   —— 键名以字符串字面量出现在代码里（含 ctaKey/bodyKey 等间接消费）
 *   template  —— 键名匹配某个模板调用的前缀+后缀形状
 *   unused    —— 两者皆无（真正的孤儿候选）
 *
 * 用法：
 *   node scripts/copy-usage-index.cjs                # 摘要
 *   node scripts/copy-usage-index.cjs --orphans OUT  # 孤儿键清单写入 OUT
 *   node scripts/copy-usage-index.cjs --json OUT     # 完整索引写入 OUT
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CSV = path.join(ROOT, "dashboard", "src", "content", "copy.csv");
const SCAN_ROOTS = ["dashboard/src", "src"];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "content") continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 模板字面量 → 匹配正则：`a.${x}.b` → ^a\.[^.]+\.b$（变量段不吃点，防跨级误配）。 */
function templateToRegExp(template) {
  const parts = template.split(/\$\{[^}]*\}/).map(escapeRegExp);
  if (parts.length === 1) return null;
  return new RegExp(`^${parts.join("[^.]+")}$`);
}

function main() {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
  const orphansOut = args.includes("--orphans") ? args[args.indexOf("--orphans") + 1] : null;

  const csv = fs.readFileSync(CSV, "utf8");
  const eol = csv.includes("\r\n") ? "\r\n" : "\n";
  const keys = csv.split(/\r?\n/).filter(Boolean).slice(1).map((line) => line.split(",")[0]);

  const literalSet = new Set();
  const templates = [];
  let files = 0;
  for (const root of SCAN_ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
      files += 1;
      let content;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch (_error) {
        continue;
      }
      // 1) 模板调用：copy(`...${...}...`) —— 记形状
      for (const match of content.matchAll(/\bcopy\(\s*`([^`]+)`/g)) {
        const regexp = templateToRegExp(match[1]);
        if (regexp) templates.push({ source: path.relative(ROOT, file), template: match[1], regexp });
      }
      // 1b) 键构建器：模板字面量赋值/传参给别处（const nameKey = `fam.${id}.name`;
      //     return `fam.${badgeId}.${slot}`;）——凡「点分命名空间开头」的模板都算。
      for (const match of content.matchAll(/`([a-z][a-z0-9_.]*)\$\{([^}]+)\}([^`]*)`/g)) {
        const template = `${match[1]}\${v}${match[3]}`;
        const regexp = templateToRegExp(template);
        if (regexp) templates.push({ source: path.relative(ROOT, file), template, regexp });
      }
      // 2) 字面量：带引号的键名（覆盖 copy("k") / ctaKey: "k" / 数组项等一切间接消费）
      for (const key of keys) {
        if (!literalSet.has(key) && (content.includes(`"${key}"`) || content.includes(`'${key}'`) || content.includes(`\`${key}\``))) {
          literalSet.add(key);
        }
      }
    }
  }

  const templateMatch = new Map();
  const unused = [];
  for (const key of keys) {
    if (literalSet.has(key)) continue;
    const hit = templates.find((t) => t.regexp.test(key));
    if (hit) templateMatch.set(key, hit);
    else unused.push(key);
  }

  console.log(`keys=${keys.length} files=${files} literal=${literalSet.size} template-only=${templateMatch.size} unused=${unused.length} templates=${templates.length}`);
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({
      totals: { keys: keys.length, literal: literalSet.size, templateOnly: templateMatch.size, unused: unused.length },
      templates: templates.map((t) => ({ source: t.source, template: t.template })),
      templateMatched: Object.fromEntries(templateMatch),
      unused,
    }, null, 2) + "\n");
    console.log(`index written: ${jsonOut}`);
  }
  if (orphansOut) {
    fs.writeFileSync(orphansOut, `${unused.join("\n")}\n`);
    console.log(`orphans written: ${orphansOut}`);
  }
  for (const [key, hit] of templateMatch) {
    console.log(`template ${key}  <-  ${hit.template}  (${hit.source})`);
  }
  if (args.includes("--list-unused")) {
    for (const key of unused) console.log(`UNUSED ${key}`);
  }
}

main();
