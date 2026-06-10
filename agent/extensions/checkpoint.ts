import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "git-checkpoint";

type CheckpointRecord = {
  id: string;
  name?: string;
  repoRoot: string;
  head: string;
  stashRef?: string;
  createdAt: string;
};

async function execGit(pi: ExtensionAPI, repoRoot: string, args: string[], timeout = 30000) {
  const result = await pi.exec("git", args, { cwd: repoRoot, timeout });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string) {
  return execGit(pi, cwd, ["rev-parse", "--show-toplevel"], 5000);
}

async function createCheckpoint(pi: ExtensionAPI, cwd: string, name?: string): Promise<CheckpointRecord> {
  const repoRoot = await getRepoRoot(pi, cwd);
  const head = await execGit(pi, repoRoot, ["rev-parse", "HEAD"], 5000);
  const stashRef = await execGit(pi, repoRoot, ["stash", "create"], 30000);

  return {
    id: `cp_${randomUUID().slice(0, 8)}`,
    name: name?.trim() || undefined,
    repoRoot,
    head,
    stashRef: stashRef || undefined,
    createdAt: new Date().toISOString(),
  };
}

function getCheckpoints(ctx: { sessionManager: any }): CheckpointRecord[] {
  const entries = ctx.sessionManager.getEntries();
  const latestClear = [...entries]
    .reverse()
    .find((entry: any) => entry.type === "custom" && entry.customType === `${ENTRY_TYPE}-clear` && entry.data?.clearedAt)
    ?.data?.clearedAt as string | undefined;

  return entries
    .filter((entry: any) => entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data)
    .map((entry: any) => entry.data as CheckpointRecord)
    .filter((checkpoint: CheckpointRecord) => checkpoint.id && checkpoint.repoRoot && checkpoint.head)
    .filter((checkpoint: CheckpointRecord) => !latestClear || checkpoint.createdAt > latestClear)
    .sort((a: CheckpointRecord, b: CheckpointRecord) => b.createdAt.localeCompare(a.createdAt));
}

function formatCheckpoint(checkpoint: CheckpointRecord) {
  const name = checkpoint.name ? ` ${checkpoint.name}` : "";
  const dirty = checkpoint.stashRef ? "dirty" : "clean";
  return `${checkpoint.id}${name} — ${dirty} — ${checkpoint.head.slice(0, 8)} — ${checkpoint.createdAt} — ${checkpoint.repoRoot}`;
}

function parseArgs(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return { action: "create", rest: "" };
  const [action, ...rest] = trimmed.split(/\s+/);
  return { action, rest: rest.join(" ").trim() };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("checkpoint", {
    description: "Create/list/diff/restore manual git checkpoints for safe rollback",
    handler: async (rawArgs, ctx) => {
      await ctx.waitForIdle();
      const { action, rest } = parseArgs(rawArgs ?? "");

      try {
        if (action === "help") {
          ctx.ui.notify(
            "Usage:\n/checkpoint [name]\n/checkpoint create [name]\n/checkpoint list\n/checkpoint diff <id>\n/checkpoint restore <id>\n/checkpoint clear",
            "info",
          );
          return;
        }

        if (action === "create" || (action && !["list", "diff", "restore", "clear"].includes(action))) {
          const name = action === "create" ? rest : rawArgs.trim();
          const checkpoint = await createCheckpoint(pi, ctx.cwd, name);
          pi.appendEntry(ENTRY_TYPE, checkpoint);
          ctx.ui.notify(`Created checkpoint:\n${formatCheckpoint(checkpoint)}`, "info");
          return;
        }

        if (action === "list") {
          const checkpoints = getCheckpoints(ctx);
          ctx.ui.notify(checkpoints.length ? checkpoints.map(formatCheckpoint).join("\n") : "No checkpoints in this session.", "info");
          return;
        }

        if (action === "diff") {
          if (!rest) {
            ctx.ui.notify("Usage: /checkpoint diff <id>", "warning");
            return;
          }
          const checkpoint = getCheckpoints(ctx).find((item) => item.id === rest);
          if (!checkpoint) {
            ctx.ui.notify(`No checkpoint found with id ${rest}`, "warning");
            return;
          }
          const diff = await execGit(pi, checkpoint.repoRoot, ["diff", "--stat", checkpoint.head, "--"], 30000);
          const nameStatus = await execGit(pi, checkpoint.repoRoot, ["diff", "--name-status", checkpoint.head, "--"], 30000);
          ctx.ui.notify(`Diff since ${checkpoint.id}:\n${diff || "No tracked diff."}\n${nameStatus ? `\nFiles:\n${nameStatus}` : ""}`, "info");
          return;
        }

        if (action === "restore") {
          if (!rest) {
            ctx.ui.notify("Usage: /checkpoint restore <id>", "warning");
            return;
          }
          const checkpoint = getCheckpoints(ctx).find((item) => item.id === rest);
          if (!checkpoint) {
            ctx.ui.notify(`No checkpoint found with id ${rest}`, "warning");
            return;
          }

          const ok = await ctx.ui.confirm(
            "Restore checkpoint?",
            [
              `Restore tracked files in ${checkpoint.repoRoot} to ${checkpoint.id}?`,
              "This runs git reset --hard to the checkpoint HEAD, then reapplies the checkpoint's tracked working-tree snapshot if one exists.",
              "Untracked files are not deleted by this command.",
            ].join("\n\n"),
          );
          if (!ok) {
            ctx.ui.notify("Checkpoint restore cancelled", "info");
            return;
          }

          await execGit(pi, checkpoint.repoRoot, ["reset", "--hard", checkpoint.head], 30000);
          if (checkpoint.stashRef) {
            await execGit(pi, checkpoint.repoRoot, ["stash", "apply", checkpoint.stashRef], 30000);
          }
          ctx.ui.notify(`Restored tracked files to checkpoint ${checkpoint.id}`, "info");
          return;
        }

        if (action === "clear") {
          pi.appendEntry(`${ENTRY_TYPE}-clear`, { clearedAt: new Date().toISOString() });
          ctx.ui.notify("Cleared checkpoint list for this session view. Existing session history entries remain on disk.", "info");
          return;
        }
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
