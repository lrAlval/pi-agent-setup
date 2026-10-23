/**
 * agent-hub — fullscreen read-only task roster (v1).
 *
 * /hub or Alt+A (fallback Ctrl+Alt+H) opens HubScreen fed by TaskBridge:
 * last pi-background-tasks host frame merged with a .pi/tasks snapshot
 * scan. Read-only: kill/steer deferred, use /kill <id>.
 * No-UI-safe: custom component only opens in tui mode.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { TaskBridge } from "./bridge.ts";
import { HubScreen } from "./hub-component.ts";

function tasksDirs(cwd: string): string[] {
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
  return [join(resolve(cwd), ".pi", "tasks"), join(agentDir, ".pi", "tasks")];
}

export default function agentHub(pi: ExtensionAPI): void {
  const cwd = resolve(".");
  const bridge = new TaskBridge(pi.events, tasksDirs(cwd));
  let hubOpen = false;

  const unsub = bridge.subscribe(() => {
    // Frames refresh the roster lazily on next hub open / refresh key.
  });

  async function openHub(ctx: ExtensionContext): Promise<void> {
    if (ctx.mode !== "tui") {
      const tasks = bridge.list();
      const text =
        tasks.length === 0
          ? "[hub] 0 tasks — pi-background-tasks not loaded or no tasks yet"
          : `[hub]\n${tasks.map((t) => `- ${t.id.slice(0, 8)} ${t.status} ${t.name}`).join("\n")}`;
      try {
        ctx.ui.notify(text, "info");
      } catch {
        // notify unavailable outside TUI; fall through to stdout
      }
      console.log(text);
      return;
    }
    if (hubOpen) return; // one-instance rule: ctx.ui.custom resolves first
    hubOpen = true;
    try {
      await ctx.ui.custom<void>((_tui, theme, _keys, done) => {
        const screen = new HubScreen(bridge, theme, () => done());
        return screen as never;
      });
    } finally {
      hubOpen = false;
    }
  }

  pi.registerCommand("hub", {
    description: "Open the background-task roster (read-only)",
    handler: async (_args, ctx) => openHub(ctx),
  });

  const shortcutOpts = {
    description: "Open the background-task roster",
    handler: (ctx: ExtensionContext) => openHub(ctx),
  };
  try {
    pi.registerShortcut("alt+a", shortcutOpts);
  } catch {
    try {
      pi.registerShortcut("ctrl+alt+h", shortcutOpts);
    } catch {
      // shortcuts unavailable: /hub still works
    }
  }

  pi.on("session_shutdown", () => {
    unsub();
  });
}
