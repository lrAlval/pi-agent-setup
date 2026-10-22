import { median } from "./eta.ts";
export interface HistoryRecord { estMin: number; actualMin: number; at: number }
export const FALLBACK_EST_MIN = 10;
export function velocityRatio(recs: HistoryRecord[]): number {
  if (recs.length < 3) return 1;
  const ratios = recs.filter(r => r.estMin > 0).map(r => r.actualMin / r.estMin);
  return ratios.length ? Math.min(4, Math.max(0.25, median(ratios))) : 1;
}
export function defaultEst(recs: HistoryRecord[]): number {
  return recs.length ? Math.max(1, Math.round(median(recs.map(r => r.actualMin)))) : FALLBACK_EST_MIN;
}
