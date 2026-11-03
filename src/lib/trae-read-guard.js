"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {spawn}=require("node:child_process");

async function acquireTraeReadGuard(dbPath) {
  if(process.platform!=="win32")return null;
  const shmPath=`${dbPath}-shm`;
  try {if(!fs.statSync(shmPath).isFile())return null;}
  catch(err){if(err.code==="ENOENT"||err.code==="ENOTDIR")return null;throw err;}
  const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-File",
    path.join(__dirname,"trae-read-guard.ps1"),"-Path",shmPath],
    {windowsHide:true,stdio:["pipe","pipe","pipe"]});
  let held=false,output="";
  child.stdin.on("error",()=>{});
  child.stderr.resume();
  await new Promise((resolve,reject)=>{
    // A startup timeout is deliberately NOT transient: a half-started helper
    // may already hold locks, so retrying could double-hold. The caller
    // degrades to a guard-less read instead — the cost on a PowerShell-hung
    // machine is one 10s wait per read, still better than failing outright.
    const timer=setTimeout(()=>{child.kill();reject(new Error("TRAE read guard startup timed out."));},10000);
    const fail=(transient=false)=>{clearTimeout(timer);reject(Object.assign(new Error("TRAE shared read guard could not be acquired."),{transient}));};
    child.once("error",()=>fail());
    child.once("exit",code=>{held=false;if(!output.includes("READY"))fail(code===3);});
    child.stdout.on("data",chunk=>{
      output+=chunk;
      if(output.includes("READY")&&!held){held=true;clearTimeout(timer);resolve();}
    });
  });
  return {
    isHeld:()=>held,
    async release(){
      if(child.exitCode!==null||child.killed)return;
      child.stdin.end();
      await new Promise(resolve=>{
        const timer=setTimeout(()=>{child.kill();resolve();},5000);
        child.once("exit",()=>{clearTimeout(timer);resolve();});
      });
    },
  };
}
module.exports={acquireTraeReadGuard};
