#!/usr/bin/env node
/**
 * scripts/validate-readme-stats.cjs
 *
 * README 文档真值门禁：
 * 自动化核验 README.md、README.zh-CN.md、README.zh-TW.md 中的核心量测数据
 * （成就总数、称号总数等）是否与代码实际注册值 100% 一致。
 * 防止任何 AI 或开发者在更新成就/称号后遗漏文档更新。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 1. 获取代码实际真值
const badgeCatalogFile = path.join(ROOT, 'dashboard/src/ui/achievements/badge-catalog.js');
const badgeContent = fs.readFileSync(badgeCatalogFile, 'utf8');
const badgeIds = [...badgeContent.matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
const actualBadgeCount = badgeIds.length;

const titleRegistryFile = path.join(ROOT, 'dashboard/src/ui/achievements/title-registry.js');
const titleContent = fs.readFileSync(titleRegistryFile, 'utf8');
const titleIds = [];
const titleRegex = /{\s*id:\s*"([^"]+)",\s*difficulty:\s*[0-9.]+/g;
let match;
while ((match = titleRegex.exec(titleContent)) !== null) {
  titleIds.push(match[1]);
}
const actualTitleCount = titleIds.length;

console.log(`[README-GATE] Code Truth: ${actualBadgeCount} badges, ${actualTitleCount} titles.`);

// 2. 校验文件清单
const readmes = [
  { file: 'README.md', lang: 'en' },
  { file: 'README.zh-CN.md', lang: 'zh-CN' },
  { file: 'README.zh-TW.md', lang: 'zh-TW' }
];

let hasErrors = false;

for (const { file, lang } of readmes) {
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`[README-GATE] ❌ Missing file: ${file}`);
    hasErrors = true;
    continue;
  }
  const content = fs.readFileSync(fullPath, 'utf8');

  // Check badges
  if (lang === 'en') {
    if (!content.includes(`${actualBadgeCount} offline achievements`)) {
      console.error(`[README-GATE] ❌ ${file} does not mention '${actualBadgeCount} offline achievements'!`);
      hasErrors = true;
    }
    if (!content.includes(`${actualTitleCount} synergy titles`)) {
      console.error(`[README-GATE] ❌ ${file} does not mention '${actualTitleCount} synergy titles'!`);
      hasErrors = true;
    }
  } else if (lang === 'zh-CN') {
    if (!content.includes(`${actualBadgeCount} 枚成就全量离线判定`)) {
      console.error(`[README-GATE] ❌ ${file} does not mention '${actualBadgeCount} 枚成就全量离线判定'!`);
      hasErrors = true;
    }
    if (!content.includes(`${actualTitleCount} 大 3D 称号殿堂`)) {
      console.error(`[README-GATE] ❌ ${file} does not mention '${actualTitleCount} 大 3D 称号殿堂'!`);
      hasErrors = true;
    }
  } else if (lang === 'zh-TW') {
    if (!content.includes(`${actualBadgeCount} 枚成就全量離線判定`)) {
      console.error(`[README-GATE] ❌ ${file} does not mention '${actualBadgeCount} 枚成就全量離線判定'!`);
      hasErrors = true;
    }
    if (!content.includes(`${actualTitleCount} 大 3D 稱號殿堂`)) {
      console.error(`[README-GATE] ❌ ${file} does not mention '${actualTitleCount} 大 3D 稱號殿堂'!`);
      hasErrors = true;
    }
  }

  // Check for stale numbers
  const stalePatterns = [
    '42 枚成就',
    '42 枚全量成就',
    '8 大 3D 称号',
    '8 大 3D 稱號',
    '51 offline achievements',
    '11 synergy titles'
  ];
  for (const stale of stalePatterns) {
    if (content.includes(stale)) {
      console.error(`[README-GATE] ❌ ${file} contains stale pattern: "${stale}"!`);
      hasErrors = true;
    }
  }
}

if (hasErrors) {
  console.error('\n[README-GATE] FAILED: README files are out of sync with code truth.');
  process.exit(1);
}

console.log('[README-GATE] ✅ PASSED: All README files are in sync with code truth.\n');
