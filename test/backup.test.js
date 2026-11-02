// .ttbackup 备份/还原单元测试：容器往返、排除规则、防路径穿越、完整性校验。
// 用临时目录构造假的 tracker 数据，不触碰真实 ~/.tokentracker。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const { exportBackup, restoreBackup, listBackupFiles, isExcludedBackupFile } = require("../src/lib/backup");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, name, content) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
  return path.join(dir, name);
}

function readFirstGzipLine(file) {
  const buf = fs.readFileSync(file);
  const json = zlib.gunzipSync(buf).toString("utf8");
  return json.split("\n")[0];
}

test("listBackupFiles 只收平铺数据文件，排除子目录/历史备份/锁文件", () => {
  const dir = makeTempDir("ttb-list-");
  writeFile(dir, "config.json", "{}\n");
  writeFile(dir, "queue.jsonl", "a\nb\n");
  writeFile(dir, "queue.jsonl.bak-20261031", "old\n");
  writeFile(dir, "config.json.bak.20261014001952", "{}\n");
  writeFile(dir, "sync.lock.heartbeat.abc", "x");
  writeFile(dir, "pet-prefs.json.tmp", "{}");
  writeFile(path.join(dir, "app"), "mirror.exe", "binary");

  const names = listBackupFiles(dir);
  assert.deepEqual(names, ["config.json", "queue.jsonl"]);
  assert.equal(isExcludedBackupFile("queue.jsonl.bak-pre-repair"), true);
  assert.equal(isExcludedBackupFile("sync.lock.stale.30308.x"), true);
  assert.equal(isExcludedBackupFile("config.json"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("export→restore 完整往返：多行/空行/内容逐字还原，排除文件不进包", async () => {
  const srcDir = makeTempDir("ttb-src-");
  const outDir = makeTempDir("ttb-out-");
  const restoreDir = makeTempDir("ttb-restore-");
  writeFile(srcDir, "config.json", '{\n  "a": 1,\n  "b": "两行\\"引号\\""\n}\n');
  writeFile(srcDir, "queue.jsonl", 'line1 {"tokens":1}\n\nline3 with 中文\n');
  writeFile(srcDir, "queue.jsonl.bak-20261031", "should-not-backup\n");
  writeFile(path.join(srcDir, "app"), "keep.exe", "mirror");

  const outPath = path.join(outDir, "test.ttbackup");
  const result = await exportBackup({ trackerDir: srcDir, outPath, version: "9.9.9" });
  assert.ok(fs.existsSync(outPath));
  assert.deepEqual(result.files.map((f) => f.path), ["config.json", "queue.jsonl"]);

  const manifest = JSON.parse(readFirstGzipLine(outPath));
  assert.equal(manifest.ttbackup, 1);
  assert.equal(manifest.version, "9.9.9");
  assert.equal(manifest.files.length, 2);
  assert.ok(manifest.files[0].sha256.length === 64);

  // 未加 force 时，空目录可以直接还原
  const restored = await restoreBackup({ inPath: outPath, trackerDir: restoreDir });
  assert.deepEqual(restored.restored, ["config.json", "queue.jsonl"]);
  assert.equal(
    fs.readFileSync(path.join(restoreDir, "config.json"), "utf8"),
    '{\n  "a": 1,\n  "b": "两行\\"引号\\""\n}\n',
  );
  assert.equal(
    fs.readFileSync(path.join(restoreDir, "queue.jsonl"), "utf8"),
    'line1 {"tokens":1}\n\nline3 with 中文\n',
  );
  assert.ok(!fs.existsSync(path.join(restoreDir, "queue.jsonl.bak-20261031")));
  assert.ok(!fs.existsSync(path.join(restoreDir, "app")));

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

test("还原遇到同名文件时拒绝，force 才覆盖", async () => {
  const srcDir = makeTempDir("ttb-src2-");
  const outDir = makeTempDir("ttb-out2-");
  const restoreDir = makeTempDir("ttb-restore2-");
  writeFile(srcDir, "config.json", "{}\n");
  const outPath = path.join(outDir, "test.ttbackup");
  await exportBackup({ trackerDir: srcDir, outPath });

  writeFile(restoreDir, "config.json", "current-live-data\n");
  await assert.rejects(
    () => restoreBackup({ inPath: outPath, trackerDir: restoreDir }),
    /already exist.*--force/,
  );
  assert.equal(fs.readFileSync(path.join(restoreDir, "config.json"), "utf8"), "current-live-data\n");

  await restoreBackup({ inPath: outPath, trackerDir: restoreDir, force: true });
  assert.equal(fs.readFileSync(path.join(restoreDir, "config.json"), "utf8"), "{}\n");

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

test("非 .ttbackup 文件与路径穿越都会被拒绝", async () => {
  const outDir = makeTempDir("ttb-bad-");
  const restoreDir = makeTempDir("ttb-restore3-");

  const notBackup = path.join(outDir, "not-backup.ttbackup");
  fs.writeFileSync(notBackup, zlib.gzipSync(Buffer.from(JSON.stringify({ hello: 1 }) + "\n")));
  await assert.rejects(
    () => restoreBackup({ inPath: notBackup, trackerDir: restoreDir }),
    /Not a \.ttbackup/,
  );

  // 构造带穿越路径的容器（模拟恶意包）
  const evil = path.join(outDir, "evil.ttbackup");
  const lines = [
    JSON.stringify({ ttbackup: 1, files: [{ path: "../evil.txt", bytes: 5 }] }),
    JSON.stringify({ path: "../evil.txt", begin: true }),
    JSON.stringify({ path: "../evil.txt", line: "boom" }),
    JSON.stringify({ path: "../evil.txt", end: true }),
  ].join("\n");
  fs.writeFileSync(evil, zlib.gzipSync(Buffer.from(lines)));
  await assert.rejects(
    () => restoreBackup({ inPath: evil, trackerDir: restoreDir }),
    /Unsafe path/,
  );
  assert.ok(!fs.existsSync(path.join(restoreDir, "..", "evil.txt")));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});

test("内容被篡改时完整性校验失败", async () => {
  const srcDir = makeTempDir("ttb-src3-");
  const outDir = makeTempDir("ttb-out3-");
  const restoreDir = makeTempDir("ttb-restore4-");
  writeFile(srcDir, "config.json", "{}\n");
  const outPath = path.join(outDir, "test.ttbackup");
  await exportBackup({ trackerDir: srcDir, outPath });

  // 解包、篡改清单里的 sha256、重新压缩（内容本身合法，触发完整性校验失败）
  const json = zlib.gunzipSync(fs.readFileSync(outPath)).toString("utf8");
  const tampered = json.replace(/"sha256":"[0-9a-f]{64}"/, '"sha256":"' + "0".repeat(64) + '"');
  const tamperedPath = path.join(outDir, "tampered.ttbackup");
  fs.writeFileSync(tamperedPath, zlib.gzipSync(Buffer.from(tampered)));

  await assert.rejects(
    () => restoreBackup({ inPath: tamperedPath, trackerDir: restoreDir }),
    /Integrity check failed/,
  );

  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(restoreDir, { recursive: true, force: true });
});
