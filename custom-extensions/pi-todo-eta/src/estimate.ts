import { defaultEst, type HistoryRecord } from "./history.ts";
import type { TaskRow } from "./db.ts";
export function resolveEstMinutes(params:{est_minutes?:number;metadata?:{est_minutes?:number}},existing:TaskRow|undefined,history:HistoryRecord[]):number|undefined {
 const value=params.est_minutes ?? existing?.est_minutes ?? params.metadata?.est_minutes;
 return typeof value==="number"&&Number.isFinite(value)&&value>0?value:defaultEst(history);
}
