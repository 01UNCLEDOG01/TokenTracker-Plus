// tokentracker backup / restore —— .ttbackup 一键备份与还原
//
// 用法：
//   npx tokentracker backup [--out <path>]              打包 ~/.tokentracker/tracker 数据
//   npx tokentracker restore <file> [--force]           还原（先完全退出应用！）
//
// 备份内容：tracker 目录的平铺数据文件（config、queue.jsonl、积分/宠物偏好等），
// 不含 app/ 热更镜像与历史 .bak。还原会覆盖同名文件，故要求 --force 显式确认。

const fs = require("fs");
const path = require("path");
const os = require("os");
const { exportBackup, restoreBackup } = require("../lib/backup");

function parseFlags(args) {
  const flags = { positional: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--out") {
      flags.out = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--out=")) {
      flags.out = arg.slice("--out=".length);
    } else {
      flags.positional.push(arg);
    }
  }
  return flags;
}

function defaultBackupPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return path.join(os.homedir(), ".tokentracker", "backups", `tokentracker-backup-${stamp}.ttbackup`);
}

function fmtBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

async function cmdBackup(args) {
  const flags = parseFlags(args);
  const outPath = flags.out ? path.resolve(flags.out) : defaultBackupPath();
  const result = await exportBackup({
    outPath,
    log: (msg) => console.log(msg),
  });
  console.log("");
  console.log(`✔ 备份完成: ${result.outPath}`);
  console.log(`  文件 ${result.files.length} 个 · 压缩后 ${fmtBytes(result.bytes)}`);
  console.log("  还原方式: npx tokentracker restore <该文件>（先完全退出应用）");
}

async function cmdRestore(args) {
  const flags = parseFlags(args);
  const file = flags.positional[0];
  if (!file) {
    console.error("用法: npx tokentracker restore <backup.ttbackup> [--force]");
    process.exitCode = 1;
    return;
  }
  if (!flags.force) {
    console.log("提示: 还原会覆盖 tracker 目录中的同名文件。请先完全退出 TokenTracker 应用。");
  }
  const result = await restoreBackup({
    inPath: path.resolve(file),
    force: flags.force === true,
    log: (msg) => console.log(msg),
  });
  console.log("");
  console.log(`✔ 还原完成（备份创建于 ${result.created || "未知时间"}，格式 v${result.version || "?"}）`);
  console.log(`  恢复文件 ${result.restored.length} 个: ${result.restored.join(", ")}`);
  console.log("  重新打开 TokenTracker 即可看到全部历史数据。");
}

module.exports = { cmdBackup, cmdRestore };
