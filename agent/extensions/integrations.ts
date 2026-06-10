import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SCRIPTS = {
  linear: "/Users/ethanwolz/.claude/skills/linear/scripts/linear.sh",
  jira: "/Users/ethanwolz/.claude/skills/jira/scripts/jira.sh",
  todo: "/Users/ethanwolz/.claude/skills/todo/scripts/todo.sh",
  launchdarkly: "/Users/ethanwolz/.claude/skills/launchdarkly/bin/ld.sh",
} as const;

const USAGE = {
  linear: `Linear — /linear <command> [args]\n\nExamples:\n  /linear me\n  /linear issues list --assignee me --state-type started\n  /linear issues get ENG-123\n  /linear issues create --title "Flaky test" --team ENG --priority high`,
  jira: `Jira — /jira <command> [args]\n\nExamples:\n  /jira me\n  /jira issue get OP-123\n  /jira issue search --jql 'project = OP ORDER BY updated DESC'\n  /jira comments add OP-123 --body "Fixed in PR #456"`,
  todo: `Todo — /todo <command> [args]\n\nExamples:\n  /todo init\n  /todo add "Ship pooling canary" --project DEVX --priority high\n  /todo list --priority-lte high\n  /todo done DEVX-001`,
  launchdarkly: `LaunchDarkly — /ld <command> [args]\n\nExamples:\n  /ld me\n  /ld flag list --env staging\n  /ld flag get my-flag\n  /ld flag on my-flag --env staging`,
  auth0: `Auth0 — /auth0 <action> [args]\n\nExamples:\n  /auth0 login\n  /auth0 tenants\n  /auth0 users search 'email:"foo@example.com"'\n  /auth0 apps list --number 50`,
} as const;

type RunResult = { stdout: string; stderr: string; exitCode: number };

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runExecutable(executable: string, args: string[], env?: Record<string, string>): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, args, {
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...env },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err?.stdout ?? "",
      stderr: err?.stderr ?? err?.message ?? String(err),
      exitCode: typeof err?.code === "number" ? err.code : 1,
    };
  }
}

async function runShell(command: string, env?: Record<string, string>): Promise<RunResult> {
  return runExecutable("/bin/bash", ["-lc", command], env);
}

function formatResult(label: string, result: RunResult): string {
  const parts = [`${label} exited ${result.exitCode}`];
  if (result.stdout.trim()) parts.push(`\nstdout:\n${result.stdout.trim()}`);
  if (result.stderr.trim()) parts.push(`\nstderr:\n${result.stderr.trim()}`);
  return parts.join("\n");
}

async function notifyCommand(label: string, result: RunResult, ctx: ExtensionCommandContext, pi?: ExtensionAPI) {
  const text = formatResult(label, result);
  const displayText = text.length > 12000 ? `${text.slice(0, 12000)}\n… truncated` : text;
  if (pi) {
    pi.sendMessage({
      customType: "integration-command-result",
      content: displayText,
      display: true,
      details: { label, exitCode: result.exitCode },
    });
  } else {
    ctx.ui.notify(displayText.length > 4000 ? `${displayText.slice(0, 4000)}\n… truncated` : displayText, result.exitCode === 0 ? "info" : "error");
  }
}

const LINEAR_PRIORITY: Record<string, string> = {
  none: "0",
  urgent: "1",
  high: "2",
  medium: "3",
  low: "4",
};

function normalizeLinearPriority(value: string): string {
  return LINEAR_PRIORITY[value.toLowerCase()] ?? value;
}

function preprocessLinearArgs(args: string[]): string[] {
  const out = [...args];
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === "--priority" || out[i] === "--priority-lte") {
      out[i + 1] = normalizeLinearPriority(out[i + 1]);
    }
  }
  return out;
}

function preprocessLinearCommandArgs(args: string): string {
  return args.replace(/(--priority(?:-lte)?\s+)(urgent|high|medium|low|none)(?=\s|$)/gi, (_m, prefix, priority) => {
    return `${prefix}${normalizeLinearPriority(priority)}`;
  });
}

function registerScriptIntegration(
  pi: ExtensionAPI,
  opts: { command: string; tool: string; label: string; script: string; usage: string; promptSnippet: string; promptGuidelines: string[] },
) {
  pi.registerCommand(opts.command, {
    description: opts.promptSnippet,
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify(opts.usage, "info");
        return;
      }
      const commandArgs = opts.tool === "linear_cli" ? preprocessLinearCommandArgs(args) : args;
      const result = await runShell(`${shQuote(opts.script)} ${commandArgs}`);
      await notifyCommand(opts.label, result, ctx, pi);
    },
  });

  pi.registerTool({
    name: opts.tool,
    label: opts.label,
    description: opts.promptSnippet,
    promptSnippet: opts.promptSnippet,
    promptGuidelines: opts.promptGuidelines,
    parameters: Type.Object({
      args: Type.Array(Type.String(), { description: `Arguments to pass to ${opts.script}` }),
      env: Type.Optional(Type.Record(Type.String(), Type.String(), { description: "Optional environment variables for this invocation" })),
    }),
    async execute(_toolCallId, params) {
      const toolArgs = opts.tool === "linear_cli" ? preprocessLinearArgs(params.args) : params.args;
      const result = await runExecutable(opts.script, toolArgs, params.env);
      return {
        content: [{ type: "text", text: formatResult(opts.label, result) }],
        details: result,
        isError: result.exitCode !== 0,
      };
    },
  });
}

async function confirmDangerousAuth0(args: string, ctx: ExtensionContext): Promise<boolean> {
  const normalized = args.toLowerCase();
  const dangerous =
    normalized.includes("users delete") ||
    normalized.includes("apps delete") ||
    normalized.includes("--force") ||
    normalized.includes("users block") ||
    normalized.includes("--reveal-secrets");
  if (!dangerous) return true;
  if (!ctx.hasUI) return false;
  return ctx.ui.confirm("Confirm Auth0 action", `Run potentially sensitive Auth0 command?\n\nauth0 ${args}`);
}

function registerAuth0(pi: ExtensionAPI) {
  pi.registerCommand("auth0", {
    description: "Manage Auth0 via the auth0 CLI",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify(USAGE.auth0, "info");
        return;
      }
      if (!(await confirmDangerousAuth0(args, ctx))) {
        ctx.ui.notify("Auth0 command cancelled", "warning");
        return;
      }
      const normalized = args
        .replace(/^tenants\b/, "tenants list")
        .replace(/^users\b(?!\s+(list|search|get|create|update|block|unblock|delete|show))/, "users list")
        .replace(/^apps\b(?!\s+(list|get|create|update|delete|show))/, "apps list")
        .replace(/^users get\b/, "users show")
        .replace(/^apps get\b/, "apps show");
      const result = await runShell(`auth0 ${normalized}`);
      await notifyCommand("Auth0", result, ctx, pi);
    },
  });

  pi.registerTool({
    name: "auth0_cli",
    label: "Auth0 CLI",
    description: "Run Auth0 CLI commands. Destructive/sensitive operations require confirm=true.",
    promptSnippet: "Manage Auth0 users, apps, tenants, and searches through the auth0 CLI",
    promptGuidelines: [
      "Use auth0_cli for Auth0 user, application, and tenant management.",
      "For auth0_cli, never delete users/apps, block users, force operations, or reveal secrets unless the user explicitly requested it; set confirm=true only after explicit confirmation.",
      "For auth0_cli, use --json when structured parsing is needed.",
    ],
    parameters: Type.Object({
      args: Type.Array(Type.String(), { description: "Arguments to pass to the auth0 CLI, excluding the leading auth0" }),
      confirm: Type.Optional(Type.Boolean({ description: "Set true only after explicit user confirmation for destructive/sensitive actions" })),
    }),
    async execute(_toolCallId, params) {
      const joined = params.args.join(" ").toLowerCase();
      const dangerous = joined.includes("delete") || joined.includes("--force") || joined.includes("--reveal-secrets") || joined.includes("blocked=true");
      if (dangerous && !params.confirm) {
        return {
          content: [{ type: "text", text: "Refusing sensitive Auth0 operation without confirm=true after explicit user confirmation." }],
          details: { blocked: true },
          isError: true,
        };
      }
      const result = await runExecutable("auth0", params.args);
      return {
        content: [{ type: "text", text: formatResult("Auth0", result) }],
        details: result,
        isError: result.exitCode !== 0,
      };
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerScriptIntegration(pi, {
    command: "linear",
    tool: "linear_cli",
    label: "Linear",
    script: SCRIPTS.linear,
    usage: USAGE.linear,
    promptSnippet: "Interact with Linear issues, projects, teams, users, labels, cycles, and GraphQL search",
    promptGuidelines: [
      "Use linear_cli when the user asks to create, search, inspect, update, comment on, or transition Linear issues/projects.",
      "For linear_cli ticket creation, ask for missing title/team and priority unless a Linear default priority is configured.",
      "For linear_cli, issue identifiers like ENG-123 are accepted anywhere an issue id is needed.",
    ],
  });

  registerScriptIntegration(pi, {
    command: "jira",
    tool: "jira_cli",
    label: "Jira",
    script: SCRIPTS.jira,
    usage: USAGE.jira,
    promptSnippet: "Interact with Jira Cloud issues, comments, labels, projects, transitions, and JQL search",
    promptGuidelines: [
      "Use jira_cli when the user asks to create, search, inspect, update, comment on, assign, link, or transition Jira issues.",
      "For jira_cli, use JQL for searching and pass it with issue search --jql.",
      "For jira_cli, comment bodies are plain text/minimal ADF; do not assume markdown conversion.",
    ],
  });

  registerScriptIntegration(pi, {
    command: "todo",
    tool: "todo_cli",
    label: "Todo",
    script: SCRIPTS.todo,
    usage: USAGE.todo,
    promptSnippet: "Manage local personal todos, milestones, projects, priorities, due dates, subtasks, and workspaces",
    promptGuidelines: [
      "Use todo_cli when the user asks to add, list, complete, reopen, edit, search, prioritize, or organize local todos.",
      "For todo_cli, identifiers are TODO-NNN, project-prefixed TAG-NNN, milestone M-NNN, and project tags like DEVX.",
      "For todo_cli, use --json when structured parsing is needed.",
    ],
  });

  registerScriptIntegration(pi, {
    command: "ld",
    tool: "launchdarkly_cli",
    label: "LaunchDarkly",
    script: SCRIPTS.launchdarkly,
    usage: USAGE.launchdarkly,
    promptSnippet: "Manage LaunchDarkly projects, environments, feature flags, toggles, statuses, and rollouts",
    promptGuidelines: [
      "Use launchdarkly_cli when the user asks to create, list, inspect, update, delete, toggle, check status, or roll out LaunchDarkly feature flags.",
      "For launchdarkly_cli, flag keys should be kebab-case; backend-only flags conventionally end in -be.",
      "After creating a LaunchDarkly flag, ask whether to wire it into the repo before editing code.",
    ],
  });

  registerAuth0(pi);

}
