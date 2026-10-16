import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { planModeSettingsPath } from "./settings.ts";

const PLAN_ARTIFACT_DIRECTORY = "plans";
const MAX_SESSION_STEM_LENGTH = 128;

/**
 * Directory holding the per-session plan artifacts. It sits next to
 * pi-plan-mode.json inside the agent directory (normally ~/.pi/agent/plans),
 * which keeps the plans out of the working tree and out of the repo sync.
 */
export function planArtifactDirectory() {
  return join(dirname(planModeSettingsPath()), PLAN_ARTIFACT_DIRECTORY);
}

/**
 * Deterministic artifact path for a session. Because the path depends only on
 * the session id, the refinement loop, the ready menu and the implementation
 * handoff all address the same file without extra state.
 */
export function planArtifactPath(sessionId: string | undefined) {
  return join(planArtifactDirectory(), `${safeSessionStem(sessionId)}.md`);
}

/**
 * Write the approved plan to its session artifact, replacing any earlier draft
 * so a refinement round always leaves the newest plan on disk.
 */
export async function persistPlanArtifact(sessionId: string | undefined, plan: string) {
  const path = planArtifactPath(sessionId);
  const content = `${plan.trimEnd()}\n`;
  await withFileMutationQueue(path, async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, { encoding: "utf8" });
  });
  return path;
}

function safeSessionStem(sessionId: string | undefined) {
  const stem = (sessionId ?? "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, MAX_SESSION_STEM_LENGTH);
  return stem || "plan";
}
