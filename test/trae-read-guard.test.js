"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs/promises");
const path=require("node:path");
const os=require("node:os");
const {spawn}=require("node:child_process");
const {setTimeout:wait}=require("node:timers/promises");
const {acquireTraeReadGuard}=require("../src/lib/trae-read-guard");
const {readTraeUsageRows}=require("../src/lib/trae-db");

test("TRAE shared read guard leaves ordinary WAL writes available and defers checkpoint",{skip:process.platform!=="win32"},async t=>{
  const {DatabaseSync}=require("node:sqlite");
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tt-trae-guard-"));
  const file=path.join(dir,"database.db"),db=new DatabaseSync(file);
  t.after(async()=>{db.close();await fs.rm(dir,{recursive:true,force:true});});
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; CREATE TABLE sample(n INTEGER); INSERT INTO sample VALUES(1)");
  const guard=await acquireTraeReadGuard(file);
  assert.ok(guard?.isHeld());
  try {
    db.exec("UPDATE sample SET n=2");
    assert.equal(db.prepare("SELECT n FROM sample").get().n,2);
    assert.equal(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy,1);
    assert.ok(guard.isHeld());
  } finally {await guard.release();}
  assert.equal(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy,0);
});

test("TRAE native WAL reader observes a complete usage row with its read guard",{skip:process.platform!=="win32"},async t=>{
  const {DatabaseSync}=require("node:sqlite");
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tt-trae-native-wal-"));
  const file=path.join(dir,"database.db"),db=new DatabaseSync(file);
  t.after(async()=>{db.close();await fs.rm(dir,{recursive:true,force:true});});
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE chat_turn(id INTEGER PRIMARY KEY,created_at INTEGER,context TEXT)");
  db.prepare("INSERT INTO chat_turn VALUES(1,1770000000000,?)").run(JSON.stringify({model_name:"test-model",token_usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}));
  assert.equal((await readTraeUsageRows(file))[0].usage.total_tokens,120);
  assert.equal(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy,0,"all helper locks must be released after reading");
});

test("TRAE shared read locks are released when the collecting process exits",{skip:process.platform!=="win32"},async t=>{
  const {DatabaseSync}=require("node:sqlite");
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tt-trae-guard-owner-exit-"));
  const file=path.join(dir,"database.db"),db=new DatabaseSync(file);
  t.after(async()=>{db.close();await fs.rm(dir,{recursive:true,force:true});});
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; CREATE TABLE sample(n INTEGER); INSERT INTO sample VALUES(1)");
  const script=path.join(dir,"owner.cjs");
  await fs.writeFile(script,`const {acquireTraeReadGuard}=require(${JSON.stringify(require.resolve("../src/lib/trae-read-guard"))});(async()=>{const guard=await acquireTraeReadGuard(process.argv[2]);process.exit(guard?.isHeld()?0:1)})().catch(()=>process.exit(2));`);
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,file],{windowsHide:true,stdio:"ignore"});
    child.once("error",reject);child.once("exit",resolve);
  });
  assert.equal(code,0,"the exited collector acquired a real shared lock");
  let busy=1;
  for(let i=0;i<100&&busy;i++){busy=db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy;if(busy)await wait(50);}
  assert.equal(busy,0,"EOF must release the helper's lock without a live collector");
});

test("TRAE read protection survives another client's close and reopen",{skip:process.platform!=="win32"},async t=>{
  const {DatabaseSync}=require("node:sqlite");
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"tt-trae-guard-reopen-"));
  const file=path.join(dir,"database.db");
  let db=new DatabaseSync(file);
  t.after(async()=>{db?.close();await fs.rm(dir,{recursive:true,force:true});});
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; CREATE TABLE sample(n INTEGER); INSERT INTO sample VALUES(1)");
  const guard=await acquireTraeReadGuard(file);
  try {
    db.close();db=null;
    await fs.stat(file+'-shm');
    db=new DatabaseSync(file);db.exec("PRAGMA busy_timeout=0; UPDATE sample SET n=2");
    assert.equal(db.prepare("SELECT n FROM sample").get().n,2);
    assert.equal(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy,1);
  } finally {await guard.release();}
  assert.equal(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy,0);
});
