import {computeEta,formatEta,type EtaTask} from "./eta.ts";
import type {TaskStatus} from "./state.ts";
export interface WidgetInput {tasks:EtaTask[];nowMs:number;velocity:number}
export interface BgBadge {available:boolean;running:number}
const BAR_LEN=10;
function bar(done:number,total:number):string {if(!total)return "░".repeat(BAR_LEN);const n=Math.round(done/total*BAR_LEN);return "▓".repeat(n)+"░".repeat(BAR_LEN-n)}
export function buildWidgetLines(input:WidgetInput):string[]{const r=computeEta(input.tasks,input.nowMs,input.velocity);if(!r.total)return ["ETA: no plan yet - ask the agent to create todos"];const head=`ETA ${formatEta(r.remainingMin)} · ${r.done}/${r.total} ${bar(r.done,r.total)}`;if(!r.current)return [head];const state=r.current.overMin>=1?`over by ${Math.floor(r.current.overMin)}m`:`${r.current.elapsedMin<1?"<1m":Math.floor(r.current.elapsedMin)+"m"} elapsed`;return [head,`now: ${r.current.subject.slice(0,47)} (${state})`]}
export function buildStatusLine(input:WidgetInput,bg?:BgBadge):string {const r=computeEta(input.tasks,input.nowMs,input.velocity),badge=bg?.available&&bg.running>0?` · bg ${bg.running} run`:"";return r.total?`ETA ${formatEta(r.remainingMin)} · ${r.done}/${r.total}${badge}`:`ETA: no plan${badge}`}
export function statusGlyph(status:TaskStatus):string{return ({pending:"○",in_progress:"◐",blocked:"◌",failed:"✗",completed:"●",deleted:"✕"} as Record<TaskStatus,string>)[status]}
