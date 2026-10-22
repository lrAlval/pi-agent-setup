import { readdir, readFile, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.dirname(fileURLToPath(import.meta.url));
function usage(){console.error("Usage: node gates/runner.mjs --project <dir> [--gate <name>|all] [--json] [--out <path>]");process.exit(2)}
const args=process.argv.slice(2); let project=process.cwd(), selected="all", json=false, out;
for(let i=0;i<args.length;i++){if(args[i]==="--project"&&args[i+1])project=path.resolve(args[++i]);else if(args[i]==="--gate"&&args[i+1])selected=args[++i];else if(args[i]==="--out"&&args[i+1])out=path.resolve(args[++i]);else if(args[i]==="--json")json=true;else usage()}
try{await access(project)}catch{console.error(`Project does not exist: ${project}`);process.exit(2)}
const uix=path.join(project,".uix"); await mkdir(uix,{recursive:true});
const uiFile=path.join(uix,"ui.json");
try{await access(uiFile)}catch{await writeFile(uiFile,JSON.stringify({urls:[]},null,2)+"\n");console.error(`Missing ${uiFile}. Add {"urls":["file:///..."]} then rerun.`);process.exit(2)}
let ui;try{ui=JSON.parse(await readFile(uiFile,"utf8"))}catch(e){console.error(`Invalid .uix/ui.json: ${e.message}`);process.exit(2)}
let contract;try{contract=JSON.parse(await readFile(path.join(root,"contract.yaml"),"utf8"))}catch(e){console.error(`Cannot load gates/contract.yaml: ${e.message}`);process.exit(2)}
const names=contract.gates.map(g=>g.name); const targets=selected==="all"?names:[selected];
if(targets.some(n=>!names.includes(n))){console.error(`Unknown gate '${selected}'. See gates/contract.yaml.`);process.exit(2)}
const ctx={project,ui,resolve:p=>path.resolve(project,p),logger:{log:console.log}};
const gates=[];
for(const name of targets){const def=contract.gates.find(g=>g.name===name);try{const mod=await import(path.join(root,def.script));const result=await mod.default(ctx);gates.push({...result,name,severity:def.severity})}catch(e){gates.push({name,severity:def.severity,passed:false,evidence:{raw:e.stack||String(e)},failures:[{msg:"Gate threw an exception",got:String(e),want:"successful gate execution"}]})}}
const report={run:{ts:new Date().toISOString(),ui,nodeVersion:process.version,project},gates};
const reportPath=out||path.join(uix,`report-${report.run.ts.replaceAll(":","-")}.json`); await mkdir(path.dirname(reportPath),{recursive:true}); await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");
if(json)console.log(JSON.stringify(report,null,2));else{console.log("Gate                 Result  Severity");for(const g of gates)console.log(`${g.name.padEnd(21)} ${g.passed?"PASS":"FAIL"}   ${g.severity}`);console.log(`Evidence: ${reportPath}`)}
process.exit(gates.some(g=>!g.passed&&g.severity==="BLOCK")?1:0);
