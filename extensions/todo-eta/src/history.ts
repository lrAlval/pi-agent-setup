import { createHash } from "node:crypto";
import { link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CompletedObservation } from "./tasks.ts";
import type { Observation } from "./eta.ts";

export interface StoredObservation extends Observation {}

export function historyDir(): string {
  const override = process.env.PI_TODO_ETA_STATE_DIR;
  if (override) return override;
  const root = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(root, "pi-todo-eta", "history-v1");
}

export function observationId(obs: CompletedObservation): string {
  return createHash("sha256").update(`${obs.taskId}|${obs.completedTs}|${obs.estimateMs}|${obs.actualMs}`).digest("hex").slice(0, 12);
}

export async function publishObservation(obs: CompletedObservation, dir = historyDir()): Promise<"created" | "duplicate"> {
  await mkdir(dir, { recursive: true });
  const id = observationId(obs);
  const target = join(dir, `${id}.json`);
  try {
    await readFile(target, "utf8");
    return "duplicate";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temp = join(dir, `.${id}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, JSON.stringify({ id, ts: obs.completedTs, estimateMs: obs.estimateMs, actualMs: obs.actualMs }) + "\n", { flag: "wx" });
  try {
    await link(temp, target);
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "duplicate";
    throw error;
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function loadRecentObservations(limit = 200, dir = historyDir()): Promise<StoredObservation[]> {
  if (limit <= 0) return [];
  let files: string[];
  try { files = await readdir(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows: StoredObservation[] = [];
  for (const file of files.filter((name) => /^[a-f0-9]{12}\.json$/.test(name))) {
    const raw = JSON.parse(await readFile(join(dir, file), "utf8")) as StoredObservation;
    if (raw.id === file.slice(0, 12) && Number.isFinite(raw.ts) && raw.estimateMs > 0 && raw.actualMs > 0) rows.push(raw);
  }
  return rows.sort((a, b) => a.ts - b.ts).slice(-Math.max(0, limit));
}
