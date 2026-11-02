// .ttbackup 一键备份/还原（纯本地、零外部依赖）
//
// 容器格式：gzip 压缩的 JSONL（全部内容都是文本，gzip 后体积友好）：
//   第 1 行  {"ttbackup":1,"app":"tokentracker-plus","version":"x.y.z",
//             "created":iso,"files":[{path,bytes,sha256},...]}
//   每个文件 {"path":name,"begin":true} → {"path":name,"line":"<该行>"} ×N
//            → {"path":name,"end":true}
//   逐行流转：queue.jsonl（百 MB 级）不整读进内存，还原时边解压边落盘。
//
// 备份范围：~/.tokentracker/tracker/ 下的平铺文件。排除：
//   - 子目录（app/、app-stash/ 是热更镜像，不是用户数据；本目录按平铺约定使用）
//   - *.bak / *.bak-* / *.bak.*（历史备份）、sync.lock.*（锁心跳）、*.tmp
//
// 还原安全：仅接受纯文件名（防路径穿越）；目标文件已存在时需显式 force
// （应用运行中还原有损坏风险，CLI 层负责提示先退出应用）。
// 已知取舍：CRLF 文件还原为 LF；末尾无换行符的文件会补一个换行——对
// jsonl/json 内容无影响。

const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const readline = require("readline");

const MANIFEST_MAGIC = "ttbackup";
const MANIFEST_VERSION = 1;

function defaultTrackerDir(home = os.homedir()) {
  return path.join(home, ".tokentracker", "tracker");
}

function readPkgVersion() {
  try {
    return require("../../package.json").version || "unknown";
  } catch {
    return "unknown";
  }
}

function isExcludedBackupFile(name) {
  if (name.endsWith(".bak")) return true;
  if (/\.bak[-.]/.test(name)) return true;
  if (name.startsWith("sync.lock.")) return true;
  if (name.endsWith(".tmp")) return true;
  return false;
}

function listBackupFiles(trackerDir) {
  const entries = fs.readdirSync(trackerDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue; // 子目录（app/ 热更镜像等）不进备份
    if (isExcludedBackupFile(entry.name)) continue;
    files.push(entry.name);
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function hashFile(fullPath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(fullPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function writeManifestLine(gzip, obj) {
  return new Promise((resolve, reject) => {
    gzip.write(JSON.stringify(obj) + "\n", (err) => (err ? reject(err) : resolve()));
  });
}

function waitForStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("close", resolve);
  });
}

async function exportBackup({ trackerDir = defaultTrackerDir(), outPath, version = null, log = () => {} } = {}) {
  if (!outPath) throw new Error("exportBackup requires outPath");
  if (!fs.existsSync(trackerDir)) throw new Error(`Backup source not found: ${trackerDir}`);
  const names = listBackupFiles(trackerDir);
  if (names.length === 0) throw new Error(`No backup-eligible files in ${trackerDir}`);

  log(`[backup] hashing ${names.length} file(s)…`);
  const manifestFiles = [];
  for (const name of names) {
    const full = path.join(trackerDir, name);
    manifestFiles.push({
      path: name,
      bytes: fs.statSync(full).size,
      sha256: await hashFile(full),
    });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath);
  const gzip = zlib.createGzip({ level: 6 });
  gzip.pipe(out);
  out.on("error", (err) => gzip.destroy(err));

  await writeManifestLine(gzip, {
    [MANIFEST_MAGIC]: MANIFEST_VERSION,
    app: "tokentracker-plus",
    version: version || readPkgVersion(),
    created: new Date().toISOString(),
    files: manifestFiles,
  });

  for (const name of names) {
    await writeManifestLine(gzip, { path: name, begin: true });
    const full = path.join(trackerDir, name);
    const rl = readline.createInterface({
      input: fs.createReadStream(full, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      await writeManifestLine(gzip, { path: name, line });
    }
    rl.close();
    await writeManifestLine(gzip, { path: name, end: true });
    log(`[backup] + ${name}`);
  }

  gzip.end();
  await waitForStream(out);
  return {
    outPath,
    files: manifestFiles,
    bytes: fs.statSync(outPath).size,
  };
}

function parseSafeBackupName(name) {
  if (typeof name !== "string" || name.length === 0) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  if (path.basename(name) !== name) return null;
  return name;
}

async function restoreBackup({ inPath, trackerDir = defaultTrackerDir(), force = false, log = () => {} } = {}) {
  if (!inPath) throw new Error("restoreBackup requires inPath");
  if (!fs.existsSync(inPath)) throw new Error(`Backup file not found: ${inPath}`);
  fs.mkdirSync(trackerDir, { recursive: true });

  const input = fs.createReadStream(inPath);
  const gunzip = zlib.createGunzip();
  input.pipe(gunzip);
  const rl = readline.createInterface({ input: gunzip, crlfDelay: Infinity });

  let manifest = null;
  let current = null;
  const restored = [];

  for await (const raw of rl) {
    if (raw.trim() === "") continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new Error("Corrupt backup: invalid JSON line");
    }

    if (!manifest) {
      if (obj[MANIFEST_MAGIC] !== MANIFEST_VERSION) {
        throw new Error("Not a .ttbackup file (unknown format)");
      }
      manifest = obj;
      const listed = Array.isArray(manifest.files) ? manifest.files : [];
      const conflicts = listed.filter((f) => fs.existsSync(path.join(trackerDir, f.path)));
      if (conflicts.length > 0 && !force) {
        throw new Error(
          `${conflicts.length} file(s) already exist in ${trackerDir}. ` +
            "Close the TokenTracker app, then pass { force: true } (CLI: --force) to overwrite.",
        );
      }
      continue;
    }

    const safeName = parseSafeBackupName(obj.path);
    if (!safeName) throw new Error(`Unsafe path in backup: ${JSON.stringify(obj.path)}`);

    if (obj.line !== undefined) {
      if (!current || current.name !== safeName) {
        throw new Error(`Corrupt backup: content line without begin (${safeName})`);
      }
      current.stream.write(obj.line + "\n");
    } else if (obj.begin === true) {
      if (current) throw new Error("Corrupt backup: nested begin");
      current = { name: safeName, stream: fs.createWriteStream(path.join(trackerDir, safeName)) };
      log(`[restore] -> ${safeName}`);
    } else if (obj.end === true) {
      if (!current || current.name !== safeName) {
        throw new Error(`Corrupt backup: end without begin (${safeName})`);
      }
      await new Promise((resolve) => current.stream.end(resolve));
      const expect = (manifest.files || []).find((f) => f.path === safeName);
      if (expect && expect.sha256) {
        const actual = await hashFile(path.join(trackerDir, safeName));
        if (actual !== expect.sha256) {
          throw new Error(`Integrity check failed for ${safeName}`);
        }
      }
      restored.push(safeName);
      current = null;
    } else {
      throw new Error("Corrupt backup: unrecognized record");
    }
  }

  if (!manifest) throw new Error("Corrupt backup: no manifest line");
  return { restored, created: manifest.created, version: manifest.version };
}

module.exports = {
  MANIFEST_MAGIC,
  MANIFEST_VERSION,
  defaultTrackerDir,
  isExcludedBackupFile,
  listBackupFiles,
  exportBackup,
  restoreBackup,
};
