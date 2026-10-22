import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { applyTaskMutation, type Mutation, type Task } from "./state.ts";
import { resolveEstMinutes } from "./estimate.ts";
export type TaskRow = Task & { branch:string };
export function resolveDbPath():string { return process.env.PI_TODO_ETA_DB ?? join(homedir(),".pi","agent","pi-todo-eta.db"); }
export function openFileDb(path=resolveDbPath(),opts:{readonly?:boolean}={}):DatabaseSync {
 try { if(Number(process.versions.node.split(".")[0])<22 || (Number(process.versions.node.split(".")[0])===22 && Number(process.versions.node.split(".")[1])<5)) throw Error(); }
 catch { throw Error(`node >= 22.5 required, found ${process.version}`); }
 try { if(path!==":memory:") mkdirSync(dirname(path),{recursive:true}); const db=new DatabaseSync(path,{readOnly:opts.readonly??false});
  db.exec("PRAGMA busy_timeout=2500"); if(!opts.readonly){db.exec("PRAGMA journal_mode=DELETE"); db.exec("PRAGMA auto_vacuum=INCREMENTAL"); db.exec("PRAGMA foreign_keys=ON");} return db;
 } catch(e) { if(String(e).includes("node:sqlite")) throw Error(`node >= 22.5 required, found ${process.version}`,{cause:e}); throw e; }
}
export function migrate(db:DatabaseSync,opts:{legacyPath?:string|null}={}):{schemaVersion:number} {
 db.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT); CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,est_min REAL NOT NULL,actual_min REAL NOT NULL); CREATE TABLE IF NOT EXISTS tasks(branch TEXT NOT NULL,id INTEGER NOT NULL,subject TEXT NOT NULL,description TEXT,active_form TEXT,status TEXT NOT NULL CHECK(status IN ('pending','in_progress','blocked','failed','completed','deleted')),est_min REAL,started_at INTEGER,touched_at INTEGER NOT NULL,PRIMARY KEY(branch,id)); CREATE INDEX IF NOT EXISTS tasks_branch_status ON tasks(branch,status); INSERT OR REPLACE INTO meta(k,v) VALUES('schema_version','1');`);
 const imported=db.prepare("SELECT v FROM meta WHERE k='json_imported'").get() as {v?:string}|undefined;
 if(!imported){ const path=opts.legacyPath===null?undefined:opts.legacyPath??join(homedir(),".pi","agent","pi-eta-history.json"); const txn=db; txn.exec("BEGIN"); try { if(path&&existsSync(path)){const data=JSON.parse(readFileSync(path,"utf8")); if(Array.isArray(data)){const ins=db.prepare("INSERT INTO history(at,est_min,actual_min) VALUES(?,?,?)"); for(const r of data.slice(-1000)) if(r&&Number.isFinite(r.estMin)&&Number.isFinite(r.actualMin)&&Number.isFinite(r.at)) ins.run(r.at,r.estMin,r.actualMin); }} db.prepare("INSERT OR REPLACE INTO meta(k,v) VALUES('json_imported','1')").run(); txn.exec("COMMIT"); if(path&&existsSync(path)) renameSync(path,path+".imported"); } catch(e){txn.exec("ROLLBACK");throw e;} }
 return {schemaVersion:1};
}
export function loadTasks(db:DatabaseSync,branch:string):TaskRow[] { return db.prepare("SELECT branch,id,subject,description,active_form AS activeForm,status,est_min AS est_minutes,started_at,touched_at FROM tasks WHERE branch=? ORDER BY id").all(branch) as unknown as TaskRow[]; }
export function applyTodoMutation(db:DatabaseSync,branch:string,params:Mutation,nowMs:number):{tasks:TaskRow[];op:string;nextId:number} {
 const before=loadTasks(db,branch), pure=before.map(({branch:_b,...t})=>t);
 const existing=params.id===undefined?undefined:before.find(t=>t.id===params.id);
 const mutation={...params,...(["create","update"].includes(params.action??"")||params.subject!==undefined||params.id!==undefined?{est_minutes:resolveEstMinutes(params,existing,loadHistory(db))}: {})};
 const result=applyTaskMutation(pure,mutation,nowMs);
 if(["create","update","delete"].includes(result.op)){const tx=db;tx.exec("BEGIN IMMEDIATE");try{db.prepare("DELETE FROM tasks WHERE branch=?").run(branch);const ins=db.prepare("INSERT INTO tasks(branch,id,subject,description,active_form,status,est_min,started_at,touched_at) VALUES(?,?,?,?,?,?,?,?,?)");for(const t of result.state)ins.run(branch,t.id,t.subject,t.description??null,t.activeForm??null,t.status,t.est_minutes??null,t.started_at??null,t.touched_at??nowMs);const hist=db.prepare("INSERT INTO history(at,est_min,actual_min) VALUES(?,?,?)");for(const t of result.state){const prev=before.find(x=>x.id===t.id);if(prev?.status==="in_progress"&&t.status==="completed"&&prev.started_at!==undefined&&prev.est_minutes)hist.run(nowMs,prev.est_minutes,Math.max(0,(nowMs-prev.started_at)/60000));}tx.exec("COMMIT");}catch(e){tx.exec("ROLLBACK");throw e;}}
 return {tasks:loadTasks(db,branch),op:result.op,nextId:result.nextId};
}
export function enforceBudget(db:DatabaseSync,nowMs:number):{historyTrimmed:number;tasksTrimmed:number;bytesFreed:number} {
 const old=db.prepare("DELETE FROM history WHERE at < ?").run(nowMs-180*86400000).changes;
 const tomb=db.prepare("DELETE FROM tasks WHERE status='deleted' AND touched_at < ?").run(nowMs-30*86400000).changes;
 let h=Number(old), t=Number(tomb); const size=()=>Number((db.prepare("PRAGMA page_count").get() as {page_count:number}).page_count)*(db.prepare("PRAGMA page_size").get() as {page_size:number}).page_size;
 let before=size(); if(before>7.5*1024*1024){const n=db.prepare("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY at DESC,id DESC LIMIT 1000)").run().changes;h+=Number(n);db.exec("PRAGMA incremental_vacuum");if(size()>8*1024*1024) db.exec("VACUUM");}
 const after=size(), bytesFreed=Math.max(0,before-after); if(h||t) console.log(`[pi-todo-eta] pruned history=${h} tombstones=${t} bytes_freed=${bytesFreed}`); return {historyTrimmed:h,tasksTrimmed:t,bytesFreed};
}
export function staleSweep(db:DatabaseSync,branch:string,nowMs:number,windowMs=4*3600000):number {return Number(db.prepare("UPDATE tasks SET status='blocked',touched_at=? WHERE branch=? AND status='in_progress' AND touched_at < ?").run(nowMs,branch,nowMs-windowMs).changes);}
export function loadHistory(db:DatabaseSync):{estMin:number;actualMin:number;at:number}[]{return db.prepare("SELECT est_min AS estMin,actual_min AS actualMin,at FROM history ORDER BY at").all() as {estMin:number;actualMin:number;at:number}[];}
