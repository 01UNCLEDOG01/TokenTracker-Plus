/**
 * TRAE CN merged-app local database parser test.
 *
 * The unified Trae CN IDE keeps its turns in a SQLCipher store that the SOLO
 * CN cloud bill never covers (zero session-id overlap, verified on the real
 * store). parseTraeCnLocalIncremental consumes projected rows (the caller owns
 * the decrypt) and feeds both the hourly queue and the project queue. This
 * suite verifies, with the reader injected:
 *   - hourly rows land under source "trae-cn" with half-hour buckets
 *   - project attribution joins absolute_path → a real git checkout
 *   - the rowid watermark advances and a re-run adds nothing
 *   - rows without a resolvable project are counted hourly but stay out of
 *     the project queue
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { parseTraeCnLocalIncremental, parseTraeCnApiIncremental } = require("../src/lib/rollout");

const T0 = Math.floor(Date.UTC(2026, 9, 18, 10) / 1000); // seconds, like the store

function row(id, { model = "doubao-seed-1.6", path: absolutePath = null, prompt = 100, completion = 50, session = "sess-1" } = {}) {
  return {
    id: String(id),
    session_id: session,
    created_at: T0 + id * 60,
    updated_at: T0 + id * 60,
    model,
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    project_id: absolutePath ? "proj-1" : null,
    absolute_path: absolutePath,
  };
}

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-trae-cn-local-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "proj");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "config"),
    '[remote "origin"]\n\turl = https://github.com/example/trae-cn-project.git\n',
  );
  const dbPath = path.join(dir, "database.db");
  fs.writeFileSync(dbPath, "");
  return {
    dir,
    project,
    dbPath,
    cursors: {},
    queuePath: path.join(dir, "queue.jsonl"),
    projectQueuePath: path.join(dir, "project.queue.jsonl"),
    publicRepoResolver: async ({ projectRef }) => ({
      status: "public_verified",
      projectKey: "example/trae-cn-project",
      projectRef,
    }),
  };
}

function readRows(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("TRAE CN local rows feed hourly and project queues with a rowid watermark", async (t) => {
  const f = await fixture(t);
  const rows = [
    row(34, { path: f.project }),
    row(35, { path: f.project }),
    row(36, { path: null }), // no project directory — hourly only
  ];
  let calls = 0;
  const readRowsImpl = async (dbPath, { lastId }) => {
    calls += 1;
    return rows.filter((r) => Number(r.id) > lastId);
  };
  const args = {
    dbPath: f.dbPath,
    cursors: f.cursors,
    queuePath: f.queuePath,
    projectQueuePath: f.projectQueuePath,
    publicRepoResolver: f.publicRepoResolver,
    readRowsImpl,
  };

  const res1 = await parseTraeCnLocalIncremental(args);
  assert.equal(res1.recordsProcessed, 3);
  assert.equal(res1.eventsAggregated, 3);
  assert.equal(res1.projectBucketsQueued, 1, "both turns share one project half-hour bucket");
  assert.equal(f.cursors.traeCnLocal.lastId, 36, "watermark advanced to the max rowid");

  const hourly = readRows(f.queuePath).filter((r) => r.source === "trae-cn");
  assert.equal(hourly.length, 1, "all three turns land in the same half-hour bucket");
  assert.equal(hourly[0].total_tokens, 450);

  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "trae-cn");
  assert.equal(projectRows.length, 1);
  assert.equal(projectRows[0].project_key, "example/trae-cn-project");
  assert.equal(projectRows[0].total_tokens, 300, "only the two attributable turns");
});

test("TRAE CN local feed skips unchanged stores and only books changed contributions", async (t) => {
  const f = await fixture(t);
  const rows = [row(34, { path: f.project }), row(35, { path: f.project })];
  let lastId = 0;
  const readRowsImpl = async (dbPath, { lastId: watermark }) => {
    lastId = watermark;
    return rows.filter((r) => Number(r.id) > watermark);
  };
  const args = {
    dbPath: f.dbPath,
    cursors: f.cursors,
    queuePath: f.queuePath,
    projectQueuePath: f.projectQueuePath,
    publicRepoResolver: f.publicRepoResolver,
    readRowsImpl,
  };

  await parseTraeCnLocalIncremental(args);
  assert.equal(lastId, 0, "first read starts from zero");

  // Same file signature + watermark consumed: the GB-scale decrypt is skipped.
  const res2 = await parseTraeCnLocalIncremental(args);
  assert.equal(res2.recordsProcessed, 0);

  // A changed store re-observes old rows too; only its new contribution books.
  rows.push(row(36, { path: f.project, prompt: 10, completion: 5 }));
  fs.appendFileSync(f.dbPath, "x");
  const res3 = await parseTraeCnLocalIncremental(args);
  assert.equal(res3.recordsProcessed, 3);
  assert.equal(res3.eventsAggregated, 1);
  assert.equal(lastId,0,"rowid must not hide a late correction to an old row");
  assert.equal(res3.projectBucketsQueued, 1);
  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "trae-cn");
  assert.equal(projectRows.length, 2, "new half-hour bucket appended");
  assert.equal(f.cursors.traeCnLocal.lastId, 36);
});

test("TRAE CN local feed notices WAL-only writes and invalidates legacy signatures without recounting", async (t) => {
  const f = await fixture(t);
  const rows = [row(34), row(35)];
  let reads = 0;
  const args = {
    dbPath: f.dbPath, cursors: f.cursors, queuePath: f.queuePath,
    readRowsImpl: async (_, { lastId }) => { reads++; return rows.filter(r => Number(r.id) > lastId); },
  };
  await parseTraeCnLocalIncremental(args);
  const base = fs.statSync(f.dbPath);
  f.cursors.traeCnLocal.signature = `${base.size}:${base.mtimeMs}`;
  await parseTraeCnLocalIncremental(args);
  assert.equal(reads, 2, "legacy DB-only signatures must be invalidated");
  assert.equal(f.cursors.traeCnLocal.lastId, 35);
  assert.equal(readRows(f.queuePath).length, 1, "invalidation does not recount old rows");

  rows.push(row(36, { prompt: 10, completion: 5 }));
  fs.writeFileSync(`${f.dbPath}-wal`, "first WAL commit");
  await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.lastId, 36);
  assert.equal(readRows(f.queuePath).at(-1).total_tokens, 315);
  await parseTraeCnLocalIncremental(args);
  assert.equal(reads, 3, "unchanged DB and WAL stay cheap");

  rows.push(row(37, { prompt: 10, completion: 5 }));
  fs.writeFileSync(`${f.dbPath}-wal`, "other WAL commit");
  fs.utimesSync(`${f.dbPath}-wal`, new Date(1000), new Date(2000));
  await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.lastId, 37);
  assert.equal(readRows(f.queuePath).at(-1).total_tokens, 330);
  assert.equal(fs.statSync(f.dbPath).mtimeMs, base.mtimeMs, "main DB never changed");
});

test("TRAE CN revisits an unfinished old row after a newer row was consumed", async (t) => {
  const f = await fixture(t);
  const pending = {...row(34), usage:{}};
  const rows = [pending, row(35)];
  const args = {dbPath:f.dbPath,cursors:f.cursors,queuePath:f.queuePath,
    readRowsImpl:async (_, {lastId})=>rows.filter(r=>Number(r.id)>lastId)};
  await parseTraeCnLocalIncremental(args);
  assert.equal(readRows(f.queuePath).at(-1).total_tokens,150);
  Object.assign(pending,row(34,{prompt:20,completion:10}));
  fs.appendFileSync(f.dbPath,"late usage");
  await parseTraeCnLocalIncremental(args);
  assert.equal(readRows(f.queuePath).at(-1).total_tokens,180,"late token fields must be counted exactly once");
  const before=fs.readFileSync(f.queuePath,"utf8");
  fs.appendFileSync(f.dbPath,"unrelated write");
  await parseTraeCnLocalIncremental(args);
  assert.equal(fs.readFileSync(f.queuePath,"utf8"),before);
});

test("TRAE CN corrects an already counted row and retracts its old model and project bucket", async (t) => {
  const f = await fixture(t);
  const rows = [row(34,{path:f.project})];
  const args = {...f,readRowsImpl:async (_, {lastId})=>rows.filter(r=>Number(r.id)>lastId)};
  await parseTraeCnLocalIncremental(args);
  rows[0]={...row(34,{model:"qwen3-coder",prompt:20,completion:10}),created_at:T0+3600};
  fs.appendFileSync(f.dbPath,"correction");
  await parseTraeCnLocalIncremental(args);
  const latest=new Map(readRows(f.queuePath).map(r=>[r.model+'|'+r.hour_start,r]));
  assert.equal([...latest.values()].reduce((sum,r)=>sum+r.total_tokens,0),30);
  assert.equal(readRows(f.projectQueuePath).at(-1).total_tokens,0,"old project attribution must be retracted");
});

test("TRAE CN migrates legacy local totals while retaining pruned cloud observations", async (t) => {
  const f=await fixture(t);
  const cloud={session_id:"cloud-1",model_name:"cloud-model",usage_time:T0,
    extra_info:{input_token:20,output_token:10}};
  await parseTraeCnApiIncremental({sessions:[cloud],cursors:f.cursors,queuePath:f.queuePath});
  const rows=[row(34,{path:f.project})];
  const args={...f,readRowsImpl:async (_, {lastId})=>rows.filter(r=>Number(r.id)>lastId)};
  await parseTraeCnLocalIncremental(args);
  f.cursors.traeCnLocal={lastId:34,signature:"legacy"};
  f.cursors.traeCn.sessions={};
  f.cursors.traeCn.prunedBeforeMs=T0*1000+60*60*1000;
  rows[0]=row(34,{model:"qwen3-coder",path:f.project,prompt:20,completion:10});
  fs.appendFileSync(f.dbPath,"legacy correction");
  await parseTraeCnLocalIncremental(args);
  const latest=new Map(readRows(f.queuePath).filter(r=>!r.kind).map(r=>[r.model+'|'+r.hour_start,r]));
  assert.equal([...latest.values()].reduce((n,r)=>n+r.total_tokens,0),60,"30 cloud + 30 corrected local, not their old 150");
  assert.equal(f.cursors.traeCnLocal.version,2);
  const before=fs.readFileSync(f.queuePath,"utf8");
  fs.appendFileSync(f.dbPath,"unchanged contribution");
  await parseTraeCnLocalIncremental(args);
  assert.equal(fs.readFileSync(f.queuePath,"utf8"),before);
});

test("TRAE CN does not mutate cursor state when project enqueue fails after a correction", async (t) => {
  const f=await fixture(t),rows=[row(34,{path:f.project})];
  const args={...f,readRowsImpl:async()=>rows};
  await parseTraeCnLocalIncremental(args);
  const before=structuredClone(f.cursors);
  rows[0]=row(34,{path:f.project,prompt:200,completion:20});
  fs.appendFileSync(f.dbPath,"correction");
  const append=fs.promises.appendFile.bind(fs.promises);
  const failure=new Error("synthetic project enqueue failure");
  const mock=t.mock.method(fs.promises,"appendFile",async(file,...rest)=>{
    if(file===f.projectQueuePath)throw failure;
    return append(file,...rest);
  });
  await assert.rejects(parseTraeCnLocalIncremental(args),e=>e===failure);
  assert.deepEqual(f.cursors,before,"both attribution and watermark must remain retryable");
  mock.mock.restore();
  await parseTraeCnLocalIncremental(args);
  assert.equal(readRows(f.queuePath).at(-1).total_tokens,220);
  assert.equal(readRows(f.projectQueuePath).at(-1).total_tokens,220);
});

test("TRAE CN catches project attribution up after hourly-only corrections", async (t) => {
  const f=await fixture(t),rows=[row(34,{path:f.project})];
  const args={...f,readRowsImpl:async()=>rows};
  await parseTraeCnLocalIncremental(args);
  rows[0]={...row(34,{path:f.project,prompt:20,completion:10}),created_at:T0+3600};
  fs.appendFileSync(f.dbPath,"hourly-only correction");
  await parseTraeCnLocalIncremental({...args,projectQueuePath:undefined});
  assert.equal(readRows(f.projectQueuePath).at(-1).total_tokens,150);
  await parseTraeCnLocalIncremental(args);
  const latest=new Map(readRows(f.projectQueuePath).map(r=>[r.project_key+'|'+r.hour_start,r]));
  assert.equal([...latest.values()].reduce((n,r)=>n+r.total_tokens,0),30);
});

test("TRAE CN rejects corrupt stored billing contributions before any queue or cursor mutation", async (t) => {
  const f=await fixture(t),args={...f,readRowsImpl:async()=>[row(34)]};
  await parseTraeCnLocalIncremental(args);
  const contribution=Object.values(f.cursors.traeCnLocal.turns)[0];
  contribution.totals.billable_total_tokens=-1;
  const before=structuredClone(f.cursors),queue=fs.readFileSync(f.queuePath,"utf8");
  await assert.rejects(parseTraeCnLocalIncremental(args),/billing metadata is malformed/);
  assert.deepEqual(f.cursors,before);
  assert.equal(fs.readFileSync(f.queuePath,"utf8"),queue);
});

test("TRAE CN rebuilds when an older collector updated a newer ledger's v2 signature", async (t) => {
  const f=await fixture(t),rows=[row(34)],args={...f,readRowsImpl:async()=>rows};
  await parseTraeCnLocalIncremental(args);
  const bucket=Object.values(f.cursors.hourly.buckets)[0];
  for(const field of ["input_tokens","output_tokens","total_tokens","billable_total_tokens"])bucket.totals[field]*=2;
  f.cursors.traeCnLocal.signature="v2:legacy-writer";
  fs.appendFileSync(f.dbPath,"older collector wrote again");
  await parseTraeCnLocalIncremental(args);
  assert.equal(readRows(f.queuePath).at(-1).total_tokens,150,"legacy app usage must not stack on the retained newer ledger");
});

test("TRAE CN does not resurrect orphaned account observations into current local totals", async (t) => {
  const f=await fixture(t),rows=[row(34)],args={...f,readRowsImpl:async()=>rows};
  await parseTraeCnLocalIncremental(args);
  await fs.promises.appendFile(f.queuePath,JSON.stringify({kind:"account_session_state",source:"trae-cn",
    session_id:"uncommitted-old-observation",model:"old-cloud-model",bucket_start:new Date(T0*1000).toISOString(),
    input_tokens:1000000000,cached_input_tokens:0,cache_creation_input_tokens:0,
    output_tokens:0,reasoning_output_tokens:0,total_tokens:1000000000,snapshot_verified_at:new Date(T0*1000).toISOString()})+'\n');
  f.cursors.traeCnLocal={lastId:34,signature:"legacy"};
  rows[0]=row(34,{prompt:20,completion:10});
  await parseTraeCnLocalIncremental(args);
  const latest=new Map(readRows(f.queuePath).filter(r=>!r.kind).map(r=>[r.model+'|'+r.hour_start,r]));
  assert.equal([...latest.values()].reduce((n,r)=>n+r.total_tokens,0),30);
});

test("TRAE CN preserves earlier sessions when a recreated store reuses a rowid", async (t) => {
  const f=await fixture(t),rows=[row(34,{session:"old-session"})],args={...f,readRowsImpl:async()=>rows};
  await parseTraeCnLocalIncremental(args);
  rows[0]=row(34,{session:"new-session",prompt:20,completion:10});
  fs.appendFileSync(f.dbPath,"replacement session");
  await parseTraeCnLocalIncremental(args);
  assert.equal(readRows(f.queuePath).at(-1).total_tokens,180,"a new session is not a correction to an unrelated old session");
});
test("TRAE CN retires the legacy ledger after two consecutive empty syncs and re-derives from sources", async (t) => {
  const f = await fixture(t), rows = [row(34, { path: f.project })];
  const args = { ...f, readRowsImpl: async () => rows };
  await parseTraeCnLocalIncremental(args);
  // Downgrade to the pre-1.18 rowid ledger, then the store reads empty.
  f.cursors.traeCnLocal = { lastId: 34, signature: "legacy" };
  rows.length = 0;
  // First empty sync holds: the legacy cursor stays, nothing is booked.
  const held = await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.version, undefined, "the first empty read holds instead of retiring");
  assert.equal(f.cursors.traeCnLocal.traeCnEmptyStreak, 1);
  assert.equal(f.cursors.traeCnLocal.lastId, 34, "the hold keeps the legacy watermark");
  assert.equal(f.cursors.traeCnLocal.signature, "legacy", "the hold keeps the legacy signature");
  assert.equal(held.bucketsQueued, 0, "the hold queues nothing");
  // Second consecutive empty sync retires through the normal migration:
  // booked trae-cn buckets reset and nothing re-books (no cloud, no rows).
  await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.version, 2, "retired");
  assert.equal(f.cursors.traeCnLocal.traeCnEmptyStreak, undefined, "retirement drops the streak");
  const booked = () => Object.entries(f.cursors.hourly.buckets)
    .filter(([key]) => key.startsWith("trae-cn|")).reduce((sum, [, b]) => sum + b.totals.total_tokens, 0);
  assert.equal(booked(), 0, "retirement re-derives from sources; nothing is double-counted");
  // A verbatim restore of the old store re-books its rows exactly once.
  rows.push(row(34, { path: f.project }));
  fs.appendFileSync(f.dbPath, "store restored from backup");
  await parseTraeCnLocalIncremental(args);
  assert.equal(booked(), 150, "restored rows re-book once");
  // And the retired cursor skips unchanged stores afterwards.
  const before = fs.readFileSync(f.queuePath, "utf8");
  await parseTraeCnLocalIncremental(args);
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), before);
});

test("TRAE CN holds a transient empty sync and migrates normally when rows return", async (t) => {
  const f = await fixture(t), rows = [row(34, { path: f.project })];
  const args = { ...f, readRowsImpl: async () => rows };
  await parseTraeCnLocalIncremental(args);
  f.cursors.traeCnLocal.signature = "v2:legacy-writer";
  rows.length = 0;
  await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.traeCnEmptyStreak, 1);
  assert.equal(f.cursors.traeCnLocal.version, 2, "the v2 ledger keeps its version during the hold");
  // Rows come back the next cycle (schema drift repaired, backup restored).
  rows.push(row(34, { path: f.project }));
  fs.appendFileSync(f.dbPath, "rows visible again");
  await parseTraeCnLocalIncremental(args);
  const booked = () => Object.entries(f.cursors.hourly.buckets)
    .filter(([key]) => key.startsWith("trae-cn|")).reduce((sum, [, b]) => sum + b.totals.total_tokens, 0);
  assert.equal(booked(), 150, "a non-empty read migrates through the normal path — no double count");
  assert.equal(f.cursors.traeCnLocal.traeCnEmptyStreak, undefined, "the streak clears once rows migrate");
});
