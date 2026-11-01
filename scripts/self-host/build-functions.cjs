const fs=require("node:fs/promises");
const path=require("node:path");
const {createRequire}=require("node:module");
const {build}=require("esbuild");
const {builtinModules}=require("node:module");
const {root,privateFunctions}=require("./manifest.cjs");
async function buildFunctions(directory) {
  await fs.mkdir(directory,{recursive:true});
  const entries=[];
  for(const slug of privateFunctions) {
    const source=path.join(root,"dashboard/edge-patches",slug+".ts");
    const runtimeImports=new Set();
    const ownDashboard={name:"self-host-device-origin",setup(builder){
      builder.onResolve({filter:/^npm:/},args=>{
        const specifier=args.path==="npm:@insforge/sdk"?"npm:@insforge/sdk@1.4.5":args.path;
        if(specifier!=="npm:@insforge/sdk@1.4.5")throw Error("Review the new self-host runtime dependency: "+specifier);
        runtimeImports.add(specifier);
        return {path:specifier,external:true};
      });
      builder.onResolve({filter:/^[^./]/},async args=>{
        if(!args.importer.startsWith(root+path.sep))return;
        if(args.path.startsWith("node:")||builtinModules.includes(args.path)) {
          const specifier=args.path.startsWith("node:")?args.path:"node:"+args.path;
          runtimeImports.add(specifier);return {path:specifier,external:true};
        }
        // Handwritten edge-patch sources only import @insforge/sdk; anything
        // else is an unreviewed new runtime dependency for the self-host
        // sandbox and must be reviewed before it ships.
        const name=args.path.startsWith("@")?args.path.split("/").slice(0,2).join("/"):args.path.split("/")[0];
        if(name!=="@insforge/sdk")throw Error("Unreviewed self-host runtime dependency: "+name);
        const resolve=createRequire(args.importer);
        let packageDirectory=path.dirname(resolve.resolve(name));let info;
        while(packageDirectory.startsWith(root+path.sep)) {
          try {const candidate=JSON.parse(await fs.readFile(path.join(packageDirectory,"package.json"),"utf8"));
            const candidatePath=path.relative(root,packageDirectory).split(path.sep).join("/");
            if(candidate.name===name){info=candidate;break;}}catch {}
          packageDirectory=path.dirname(packageDirectory);
        }
        const version=info?.version;
        const packagePath=path.relative(root,packageDirectory).split(path.sep).join("/");
        if(!version||version!=="1.4.5")throw Error("Installed @insforge/sdk differs from the pinned runtime: "+name);
        const specifier="npm:"+name+"@"+version+args.path.slice(name.length);
        runtimeImports.add(specifier);return {path:specifier,external:true};
      });
      builder.onLoad({filter:/tokentracker-device-flow-authorize\.ts$/},async args=>{
        let contents=await fs.readFile(args.path,"utf8");
        const anchor="  const client = createClient({";
        const uri='verification_uri: "https://www.example-dashboard.com/device",';
        const complete='verification_uri_complete: `https://www.example-dashboard.com/device?user_code=${encodeURIComponent(user_code)}`,';
        if(!contents.includes(anchor)||!contents.includes(uri)||!contents.includes(complete))throw Error("Device authorization source changed; review its self-host origin adaptation");
        contents=contents.replace(anchor,`  let verificationUri: string;
  try {
    const dashboard = new URL(Deno.env.get("TOKENTRACKER_DASHBOARD_URL") || "");
    if (dashboard.username || dashboard.password ||
      (dashboard.protocol !== "https:" && !(dashboard.protocol === "http:" && ["localhost","127.0.0.1"].includes(dashboard.hostname)))) {
      return json({error:"self-host dashboard URL must use HTTPS"},500);
    }
    verificationUri = new URL("/device",dashboard).toString();
  } catch { return json({error:"self-host dashboard URL is required"},500); }
`+anchor).replaceAll(uri,"verification_uri: verificationUri,")
          .replaceAll(complete,'verification_uri_complete: verificationUri + "?user_code=" + encodeURIComponent(user_code),');
        return {contents,loader:"ts",resolveDir:path.dirname(args.path)};
      });
    }};
    const output=await build({entryPoints:[source],write:false,bundle:true,format:"iife",globalName:"__selfHostHandler",
      // The self-host worker serializes responses with text(), including binary gzip.
      define:slug==="tokentracker-account-model-breakdown"?{CompressionStream:"undefined"}:{},
      platform:"neutral",target:"es2022",plugins:[ownDashboard],logLevel:"silent"});
    const imports=Array.from(runtimeImports).sort().map(specifier=>`${JSON.stringify(specifier)}: { __esModule: true, ...await import(${JSON.stringify(specifier)}) }`).join(",\n");
    const code=`module.exports = async function(req) {
  return await (async (__selfHostPlatformDeno) => {
    const Deno = { env: { get(key) {
      if (key === "INSFORGE_BASE_URL") return __selfHostPlatformDeno.env.get("INSFORGE_INTERNAL_URL") || __selfHostPlatformDeno.env.get(key);
      if (key === "INSFORGE_SERVICE_ROLE_KEY") return __selfHostPlatformDeno.env.get(key) || __selfHostPlatformDeno.env.get("API_KEY");
      return __selfHostPlatformDeno.env.get(key);
    } } };
    const __selfHostModules = { ${imports} };
    const require = specifier => {
      if (!Object.hasOwn(__selfHostModules,specifier)) throw new Error("Unknown self-host runtime module: " + specifier);
      return __selfHostModules[specifier];
    };
    ${output.outputFiles[0].text}
    return await __selfHostHandler.default(req);
  })(Deno);
};\n`;
    await fs.writeFile(path.join(directory,slug+".js"),code);
    entries.push({slug,file:slug+".js",public:slug==="tokentracker-device-flow-authorize" || slug==="tokentracker-device-flow-poll"});
  }
  const manifest={schemaVersion:1,mode:"self_hosted",functions:entries,
    serverSecrets:["INSFORGE_BASE_URL","INSFORGE_SERVICE_ROLE_KEY","ANON_KEY","JWT_SECRET or JWT_PUBLIC_KEY","TOKENTRACKER_DASHBOARD_URL"],
    dashboardBuildVariables:["VITE_INSFORGE_BASE_URL","VITE_INSFORGE_ANON_KEY"],
    excluded:["official community publishing","payment provider webhooks","billing merchant credentials"]};
  await fs.writeFile(path.join(directory,"functions.json"),JSON.stringify(manifest,null,2)+"\n");
  return manifest;
}
if(require.main===module) {
  const directory=path.resolve(process.argv[2]||path.join(root,".tmp/self-host-functions"));
  buildFunctions(directory).then(manifest=>console.log(`Built ${manifest.functions.length} private self-host functions in ${directory}`))
    .catch(error=>{console.error(error.message);process.exitCode=1});
}
module.exports={buildFunctions};
