import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const commandName = "pr-worktree";
const editorCommand = process.env.PI_PR_WORKTREE_EDITOR ?? "nvim";

type PullRequestTarget = {
  provider: "github" | "azure";
  number: string;
  url?: string;
};

function parseTarget(input: string): PullRequestTarget | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const githubMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i);
  if (githubMatch?.[1]) {
    return { provider: "github", number: githubMatch[1], url: trimmed };
  }

  const azureMatch = trimmed.match(/(?:pullrequest|pullRequest)\/(\d+)/i) ?? trimmed.match(/[?&]pullRequestId=(\d+)/i);
  if (azureMatch?.[1]) {
    return { provider: "azure", number: azureMatch[1], url: trimmed };
  }

  const numberMatch = trimmed.match(/^#?(\d+)$/);
  if (numberMatch?.[1]) {
    return { provider: "github", number: numberMatch[1] };
  }

  return undefined;
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function editorArgs() {
  return editorCommand.split(/\s+/).filter(Boolean).concat(".");
}

async function execRequired(pi: ExtensionAPI, command: string, args: string[], cwd: string, timeout = 30000) {
  const result = await pi.exec(command, args, { cwd, timeout });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string) {
  return execRequired(pi, "git", ["rev-parse", "--show-toplevel"], cwd, 5000);
}

async function fetchGitHubPr(pi: ExtensionAPI, target: PullRequestTarget, repoRoot: string) {
  await execRequired(pi, "git", ["fetch", "origin", `pull/${target.number}/head`], repoRoot);
  return `pr/github-${target.number}`;
}

async function fetchAzurePr(pi: ExtensionAPI, target: PullRequestTarget, repoRoot: string) {
  const sourceRef = await execRequired(pi, "az", [
    "repos",
    "pr",
    "show",
    "--id",
    target.number,
    "--query",
    "sourceRefName",
    "-o",
    "tsv",
  ], repoRoot);

  if (!sourceRef) {
    throw new Error(`Could not resolve Azure PR ${target.number} source branch`);
  }

  await execRequired(pi, "git", ["fetch", "origin", sourceRef], repoRoot);
  return `pr/azure-${target.number}`;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand(commandName, {
    description: "Create a git worktree for a GitHub/Azure PR and open it in Neovim in a right WezTerm pane",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const target = parseTarget(args);
      if (!target) {
        ctx.ui.notify(`Usage: /${commandName} <github-pr-url|azure-pr-url|pr-number>`, "warning");
        return;
      }

      try {
        const repoRoot = await getRepoRoot(pi, ctx.cwd);
        const repoName = path.basename(repoRoot);
        const branchName = target.provider === "github"
          ? await fetchGitHubPr(pi, target, repoRoot)
          : await fetchAzurePr(pi, target, repoRoot);
        const worktreePath = path.join(path.dirname(repoRoot), `${repoName}-worktrees`, safeName(`${target.provider}-pr-${target.number}`));

        await execRequired(pi, "mkdir", ["-p", path.dirname(worktreePath)], repoRoot, 5000);
        await execRequired(pi, "git", ["worktree", "add", "-B", branchName, worktreePath, "FETCH_HEAD"], repoRoot);

        const weztermResult = await pi.exec("wezterm", [
          "cli",
          "split-pane",
          "--right",
          "--cwd",
          worktreePath,
          "--",
          ...editorArgs(),
        ], { cwd: worktreePath, timeout: 5000 });

        if (weztermResult.code !== 0) {
          ctx.ui.notify(weztermResult.stderr.trim() || `Created ${worktreePath}, but failed to open WezTerm pane`, "error");
          return;
        }

        ctx.ui.notify(`Created worktree ${worktreePath} and opened ${editorCommand}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}
