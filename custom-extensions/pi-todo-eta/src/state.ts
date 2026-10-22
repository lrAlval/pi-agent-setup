export type TaskStatus = "pending" | "in_progress" | "blocked" | "failed" | "completed" | "deleted";
export type TaskAction = "list" | "get" | "create" | "update" | "delete";
export interface Task { id:number; subject:string; description?:string; activeForm?:string; status:TaskStatus; est_minutes?:number; started_at?:number; touched_at?:number }
export interface Mutation { action?:TaskAction; id?:number; subject?:string; description?:string; activeForm?:string; status?:TaskStatus; est_minutes?:number }
const allowed: Record<TaskStatus, TaskStatus[]> = {
 pending:["in_progress","blocked","failed","completed","deleted"],
 in_progress:["pending","blocked","failed","completed","deleted"],
 blocked:["pending","in_progress","failed","completed","deleted"],
 failed:["pending","deleted"], completed:[], deleted:[]
};
export function inferAction(p: Mutation): TaskAction {
 if (p.action) return p.action;
 if (p.id !== undefined && p.subject !== undefined) throw Error("Cannot combine id and subject without action");
 if (p.subject !== undefined) return "create";
 if (p.id !== undefined && Object.keys(p).some(k => ["status","description","activeForm","est_minutes"].includes(k))) return "update";
 return p.id !== undefined ? "get" : "list";
}
export function applyTaskMutation(tasks: Task[], params: Mutation, nowMs: number): {state:Task[];op:TaskAction;nextId:number} {
 const op = inferAction(params), state = tasks.map(t => ({...t}));
 if (op === "list" || op === "get") { if (op === "get" && !state.some(t=>t.id===params.id)) throw Error(`Unknown todo id ${params.id}`); return {state:op === "get" ? state.filter(t=>t.id===params.id):state,op,nextId:Math.max(0,...state.map(t=>t.id))+1}; }
 if (op === "create") {
  if (!params.subject?.trim()) throw Error("Todo subject is required");
  const id = Math.max(0,...state.map(t=>t.id))+1;
  state.push({id,subject:params.subject,description:params.description,activeForm:params.activeForm,status:"pending",est_minutes:params.est_minutes,touched_at:nowMs});
 } else {
  const t=state.find(x=>x.id===params.id); if(!t) throw Error(`Unknown todo id ${params.id}`);
  if(op === "delete") { if(!allowed[t.status].includes("deleted")) throw Error(`Cannot transition ${t.status} to deleted`); t.status="deleted"; }
  else if(params.status && params.status!==t.status) { if(!allowed[t.status].includes(params.status)) throw Error(`Cannot transition ${t.status} to ${params.status}`); t.status=params.status; }
  if(params.status === "in_progress" && t.started_at===undefined) t.started_at=nowMs;
  if(params.subject!==undefined)t.subject=params.subject; if(params.description!==undefined)t.description=params.description;
  if(params.activeForm!==undefined)t.activeForm=params.activeForm; if(params.est_minutes!==undefined)t.est_minutes=params.est_minutes;
  t.touched_at=nowMs;
 }
 return {state,op,nextId:Math.max(0,...state.map(t=>t.id))+1};
}
export function iconFor(status:TaskStatus, opts:{overrun?:boolean;stale?:boolean;themeGlyph?:(s:string)=>boolean}={}):{glyph:string;color?:string} {
 const glyph:Record<TaskStatus,string>={pending:"○",in_progress:"◐",blocked:"◌",failed:"✗",completed:"●",deleted:"✕"};
 const g=glyph[status]; if(!g) throw Error(`Unknown todo status: ${status}`);
 return {glyph:opts.themeGlyph && !opts.themeGlyph(g) ? "=-=" : g, ...(status==="in_progress"&&(opts.overrun||opts.stale)?{color:"red"}:{})};
}
