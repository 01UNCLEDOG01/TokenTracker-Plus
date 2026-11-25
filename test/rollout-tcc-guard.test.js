'use strict';
// macOS TCC guard for the project-discovery walk (rollout.js) and the
// freshness re-stat of persisted .git/config paths (2026-11-25 owner report:
// "TokenTracker-plus.app 想访问「文稿」文件夹中的文件" fired right after every
// reinstall, because recorded sessions pointed into ~/Documents and the walk
// stat-ed for .git/config on the way up with no TCC skip).
//
// The guard is a pure string check (no filesystem access), so the tests stub
// os.homedir() to a temp home and spy on fs.stat calls to prove that nothing
// under the protected directories is ever touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { isTccProtectedPath } = require('../src/lib/git-outcomes');
const { resolveProjectMetaForPath, isProjectFileContextFresh } = require('../src/lib/rollout');

async function withStubbedHome(home, run) {
  const originalHome = os.homedir;
  const originalStat = fsPromises.stat;
  const statCalls = [];
  try {
    os.homedir = () => home;
    fsPromises.stat = async (target, ...rest) => {
      statCalls.push(String(target));
      return originalStat.call(fsPromises, target, ...rest);
    };
    return await run(statCalls);
  } finally {
    os.homedir = originalHome;
    fsPromises.stat = originalStat;
  }
}

async function makeGitRepo(rootDir) {
  await fsPromises.mkdir(path.join(rootDir, '.git'), { recursive: true });
  await fsPromises.writeFile(
    path.join(rootDir, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/acme/repo.git\n',
    'utf8',
  );
}

test('project discovery refuses TCC-protected directories without touching the filesystem', async () => {
  const home = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tt-tcc-home-'));
  try {
    const repo = path.join(home, 'Documents', 'ChatGPT', 'some-repo');
    await makeGitRepo(repo);
    const sessionDir = path.join(repo, 'sub', 'session');
    await fsPromises.mkdir(sessionDir, { recursive: true });

    await withStubbedHome(home, async (statCalls) => {
      const meta = await resolveProjectMetaForPath(sessionDir, new Map());
      assert.equal(meta, null, 'protected startDir must yield null meta, not repo identity');
      assert.equal(
        statCalls.filter((p) => p.startsWith(home + path.sep + 'Documents')).length,
        0,
        'no stat may reach the protected subtree',
      );
      // The pure string check also refuses the protected roots themselves.
      // (Inside the stub: the guard derives the home boundary from os.homedir().)
      assert.equal(isTccProtectedPath(path.join(home, 'Documents')), true);
      assert.equal(isTccProtectedPath(path.join(home, 'Desktop', 'x')), true);
      assert.equal(isTccProtectedPath(path.join(home, 'Projects', 'some-repo')), false);
      assert.equal(isTccProtectedPath('/Volumes/usb/repo'), true);
      assert.equal(isTccProtectedPath('/etc'), false);
    });
  } finally {
    await fsPromises.rm(home, { recursive: true, maxRetries: 3 });
  }
});

test('project discovery still resolves real repos outside protected directories', async () => {
  const home = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tt-tcc-home-'));
  try {
    const repo = path.join(home, 'Projects', 'real-repo');
    await makeGitRepo(repo);
    await withStubbedHome(home, async () => {
      const meta = await resolveProjectMetaForPath(path.join(repo, 'src'), new Map());
      assert.ok(meta, 'unprotected repo must still resolve');
      assert.equal(meta.configPath, path.join(repo, '.git', 'config'));
      assert.ok(
        String(meta.projectRef).includes('github.com/acme/repo'),
        `unexpected projectRef: ${meta.projectRef}`,
      );
    });
  } finally {
    await fsPromises.rm(home, { recursive: true, maxRetries: 3 });
  }
});

test('persisted configPath under a protected directory goes stale without a stat', async () => {
  const home = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tt-tcc-home-'));
  try {
    // A context recorded before the guard existed — the repo even still
    // exists on disk, but the guard must refuse to stat it.
    const staleConfigPath = path.join(home, 'Documents', 'ChatGPT', 'old-repo', '.git', 'config');
    await makeGitRepo(path.join(home, 'Documents', 'ChatGPT', 'old-repo'));
    const context = {
      configPath: staleConfigPath,
      configMtimeMs: (await fsPromises.stat(staleConfigPath)).mtimeMs,
      configSize: 64,
    };

    await withStubbedHome(home, async (statCalls) => {
      const fresh = await isProjectFileContextFresh({ configs: [context] });
      assert.equal(fresh, false, 'protected persisted context must report stale');
      assert.equal(
        statCalls.filter((p) => p === staleConfigPath || p.startsWith(home + path.sep + 'Documents')).length,
        0,
        'the persisted protected configPath must never be stat-ed',
      );
    });
  } finally {
    await fsPromises.rm(home, { recursive: true, maxRetries: 3 });
  }
});

test('unprotected persisted configPath keeps its normal freshness behavior', async () => {
  const home = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tt-tcc-home-'));
  try {
    const repo = path.join(home, 'Projects', 'fresh-repo');
    await makeGitRepo(repo);
    const st = await fsPromises.stat(path.join(repo, '.git', 'config'));
    const context = {
      configPath: path.join(repo, '.git', 'config'),
      configMtimeMs: st.mtimeMs,
      configSize: st.size,
    };
    await withStubbedHome(home, async () => {
      assert.equal(await isProjectFileContextFresh({ configs: [context] }), true);
    });
  } finally {
    await fsPromises.rm(home, { recursive: true, maxRetries: 3 });
  }
});

test('the opt-in flag reopens protected directories for probes', async () => {
  const home = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'tt-tcc-home-'));
  try {
    await withStubbedHome(home, async () => {
      process.env.TOKENTRACKER_GIT_ATTRIBUTION_PROTECTED_DIRS = '1';
      try {
        assert.equal(isTccProtectedPath(path.join(home, 'Documents', 'repo')), false);
      } finally {
        delete process.env.TOKENTRACKER_GIT_ATTRIBUTION_PROTECTED_DIRS;
      }
      assert.equal(isTccProtectedPath(path.join(home, 'Documents', 'repo')), true);
    });
  } finally {
    await fsPromises.rm(home, { recursive: true, maxRetries: 3 });
  }
});
