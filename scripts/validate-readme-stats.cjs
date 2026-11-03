#!/usr/bin/env node
/**
 * scripts/validate-readme-stats.cjs
 *
 * README 文档真值门禁：
 * 自动化核验六语 README 中的核心量测数据与共同功能入口
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
const limitsSource = fs.readFileSync(path.join(ROOT, 'dashboard/src/lib/limits-providers.js'), 'utf8');
const limitsBlock = limitsSource.match(/export const LIMIT_PROVIDER_IDS = \[([\s\S]*?)\];/);
if (!limitsBlock) throw new Error('LIMIT_PROVIDER_IDS declaration not found');
const actualLimitCount = [...limitsBlock[1].matchAll(/^\s*"([^"]+)",?$/gm)].length;

console.log(`[README-GATE] Code Truth: ${actualBadgeCount} badges, ${actualTitleCount} titles.`);

// 2. 校验文件清单（2026-10-25 六语结构：主 README.md = 简体中文；新语种
//    ja/ko/pt-BR 用各自语言的关键句校验，见 requiredFor）
const readmes = [
  { file: 'README.md', lang: 'zh-CN' },
  { file: 'README.en.md', lang: 'en' },
  { file: 'README.zh-TW.md', lang: 'zh-TW' },
  { file: 'README.ja.md', lang: 'ja' },
  { file: 'README.ko.md', lang: 'ko' },
  { file: 'README.pt-BR.md', lang: 'pt-BR' }
];

// 各语言「成就/称号」关键句；en 同时兼容两处（特性行与 30 秒清单）。
const requiredFor = {
  en: [
    `${actualBadgeCount} Offline Achievements`,
    `${actualTitleCount} 3D Synergy Title Crests`,
    `${actualBadgeCount} offline achievements`
  ],
  'zh-CN': [
    `${actualBadgeCount} 枚成就与 ${actualTitleCount} 大 3D 称号殿堂`,
    `${actualBadgeCount} 枚成就全量离线判定`,
    `${actualTitleCount} 大 3D 称号殿堂`
  ],
  'zh-TW': [
    `${actualBadgeCount} 枚成就全量離線判定`,
    `${actualTitleCount} 大 3D 稱號殿堂`
  ],
  ja: [`${actualBadgeCount} 種 + 称号 ${actualTitleCount} 種`],
  ko: [`${actualBadgeCount}종 + 칭호 ${actualTitleCount}종`],
  'pt-BR': [`${actualBadgeCount} conquistas + ${actualTitleCount} títulos`]
};

let hasErrors = false;
const limitsPhrase = {
  'zh-CN': `${actualLimitCount} 项配额/余额来源`,
  'zh-TW': `${actualLimitCount} 項配額/餘額來源`,
  en: `${actualLimitCount} quota/balance sources`,
  ja: `${actualLimitCount} のクォータ/残高ソース`,
  ko: `${actualLimitCount}개 쿼터/잔액 소스`,
  'pt-BR': `${actualLimitCount} fontes de cota/saldo`,
};

for (const { file, lang } of readmes) {
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`[README-GATE] ❌ Missing file: ${file}`);
    hasErrors = true;
    continue;
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  if (!content.includes(limitsPhrase[lang])) {
    console.error(`[README-GATE] ❌ ${file} does not describe ${actualLimitCount} quota/balance sources`);
    hasErrors = true;
  }
  for (const feature of ['Artificial Analysis', 'AIHOT', 'Cursor', 'OpenCode', 'WorkBuddy', 'Standard / Fast / Ultrafast', 'A–Z', '.ttbackup', 'TokenTracker-Setup.exe']) {
    if (!content.includes(feature)) {
      console.error(`[README-GATE] ❌ ${file} is missing current feature: ${feature}`);
      hasErrors = true;
    }
  }

  // Check badges/titles: the file must mention the code truth in at least one
  // of the accepted phrasings for its language.
  const phrases = requiredFor[lang] || [];
  if (phrases.length && !phrases.some((phrase) => content.includes(phrase))) {
    console.error(`[README-GATE] ❌ ${file} does not mention '${phrases.join("' or '")}'!`);
    hasErrors = true;
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
