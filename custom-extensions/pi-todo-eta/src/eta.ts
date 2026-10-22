export interface EtaTask { id: number; subject: string; status: string; estMin: number; startedAtMs?: number }
export interface EtaCurrent { subject: string; elapsedMin: number; estMin: number; overMin: number }
export interface EtaResult { total: number; done: number; remainingMin: number; current?: EtaCurrent }
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function isDone(status: string): boolean { return status === "completed" || status === "deleted" || status === "failed"; }
export function computeEta(tasks: EtaTask[], nowMs: number, velocity: number): EtaResult {
  let remainingMin = 0, done = 0, current: EtaCurrent | undefined;
  for (const t of tasks) {
    if (isDone(t.status)) { done++; continue; }
    const full = Math.max(t.estMin, 0) * velocity;
    if (t.status === "in_progress" && t.startedAtMs !== undefined) {
      const elapsed = Math.max(0, (nowMs - t.startedAtMs) / 60000);
      remainingMin += Math.max(full - elapsed, 0);
      if (!current) current = { subject: t.subject, elapsedMin: elapsed, estMin: full, overMin: Math.max(elapsed - full, 0) };
    } else remainingMin += full;
  }
  return { total: tasks.length, done, remainingMin, current };
}
export function formatEta(min: number): string {
  if (min < 1) return "<1m";
  if (min < 60) return "~" + Math.round(min) + "m";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m === 0 ? "~" + h + "h" : "~" + h + "h" + m + "m";
}
