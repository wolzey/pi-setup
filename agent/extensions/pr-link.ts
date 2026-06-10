import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const WIDGET_ID = "open-pr-link";
const POLL_MS = 60_000;
const CACHE_TTL_MS = 30_000;

type PrInfo = {
  provider: "github" | "azure";
  url: string;
  title?: string;
};

type CacheEntry = {
  key: string;
  checkedAt: number;
  info: PrInfo | null;
};

let cache: CacheEntry | undefined;
let timer: NodeJS.Timeout | undefined;
let refreshInFlight = false;
let sessionGeneration = 0;

async function run(cmd: string, args: string[], cwd: string, timeout = 8_000): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const text = String(stdout).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

async function git(args: string[], cwd: string): Promise<string | null> {
  return run("git", args, cwd, 5_000);
}

function isAzureRemote(remote: string | null): boolean {
  if (!remote) return false;
  return /dev\.azure\.com|\.visualstudio\.com/i.test(remote);
}

function parseAzureRemote(remote: string | null): { organization?: string; project?: string; repository?: string } {
  if (!remote) return {};

  const devAzure = remote.match(/dev\.azure\.com[/:]([^/]+)\/([^/]+)\/_git\/([^/]+)/i);
  if (devAzure) {
    const [, org, project, repo] = devAzure;
    return {
      organization: `https://dev.azure.com/${decodeURIComponent(org)}`,
      project: decodeURIComponent(project),
      repository: decodeURIComponent(repo.replace(/\.git$/i, "")),
    };
  }

  const visualStudio = remote.match(/https?:\/\/([^/@]+)(?:@[^/]+)?\.visualstudio\.com\/([^/]+)\/_git\/([^/]+)/i);
  if (visualStudio) {
    const [, org, project, repo] = visualStudio;
    return {
      organization: `https://${decodeURIComponent(org)}.visualstudio.com`,
      project: decodeURIComponent(project),
      repository: decodeURIComponent(repo.replace(/\.git$/i, "")),
    };
  }

  const visualStudioSsh = remote.match(/(?:[^@]+@)?vs-ssh\.visualstudio\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/i);
  if (visualStudioSsh) {
    const [, org, project, repo] = visualStudioSsh;
    return {
      organization: `https://${decodeURIComponent(org)}.visualstudio.com`,
      project: decodeURIComponent(project),
      repository: decodeURIComponent(repo.replace(/\.git$/i, "")),
    };
  }

  return {};
}

function azurePrWebUrl(azure: { organization?: string; project?: string; repository?: string }, pullRequestId: string): string | null {
  if (!azure.organization || !azure.project || !azure.repository) return null;

  const org = azure.organization
    .replace(/^https:\/\/dev\.azure\.com\//i, "")
    .replace(/^https:\/\//i, "")
    .replace(/\.visualstudio\.com\/?$/i, "")
    .replace(/\/$/, "");

  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(azure.project)}/_git/${encodeURIComponent(azure.repository)}/pullrequest/${encodeURIComponent(pullRequestId)}`;
}

async function getRepoKey(cwd: string): Promise<string | null> {
  const root = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!root) return null;

  const branch = await git(["branch", "--show-current"], root);
  if (!branch) return null;

  const remote =
    (await git(["config", `branch.${branch}.remote`], root)) ??
    (await git(["remote"], root))?.split(/\r?\n/)[0] ??
    "origin";
  const remoteUrl = await git(["remote", "get-url", remote], root);

  return `${root}\n${branch}\n${remoteUrl ?? ""}`;
}

async function findGitHubPr(cwd: string): Promise<PrInfo | null> {
  const json = await run(
    "gh",
    ["pr", "view", "--json", "url,title", "--jq", "[.url, .title] | @tsv"],
    cwd,
  );
  if (!json) return null;
  const [url, title] = json.split("\t");
  if (!url?.startsWith("http")) return null;
  return { provider: "github", url, title };
}

async function findAzurePr(cwd: string): Promise<PrInfo | null> {
  const branch = await git(["branch", "--show-current"], cwd);
  if (!branch) return null;

  const remote =
    (await git(["config", `branch.${branch}.remote`], cwd)) ??
    (await git(["remote"], cwd))?.split(/\r?\n/)[0] ??
    "origin";
  const remoteUrl = await git(["remote", "get-url", remote], cwd);
  const azure = parseAzureRemote(remoteUrl);
  const scopeArgs = [
    ...(azure.organization ? ["--organization", azure.organization] : []),
    ...(azure.project ? ["--project", azure.project] : []),
    ...(azure.repository ? ["--repository", azure.repository] : []),
  ];

  const json = await run(
    "az",
    [
      "repos",
      "pr",
      "list",
      ...scopeArgs,
      "--source-branch",
      branch,
      "--status",
      "active",
      "--query",
      "[0].{id:pullRequestId,title:title}",
      "-o",
      "tsv",
    ],
    cwd,
    12_000,
  );
  if (!json) return null;

  const [id, title] = json.split("\t");
  if (!id) return null;

  const url = azurePrWebUrl(azure, id);
  if (!url) return null;
  return { provider: "azure", url, title };
}

async function findPr(cwd: string): Promise<PrInfo | null> {
  const root = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!root) return null;

  const branch = await git(["branch", "--show-current"], root);
  if (!branch) return null;

  const remote =
    (await git(["config", `branch.${branch}.remote`], root)) ??
    (await git(["remote"], root))?.split(/\r?\n/)[0] ??
    "origin";
  const remoteUrl = await git(["remote", "get-url", remote], root);

  if (isAzureRemote(remoteUrl)) {
    return (await findAzurePr(root)) ?? (await findGitHubPr(root));
  }

  return (await findGitHubPr(root)) ?? (await findAzurePr(root));
}

function terminalLink(text: string, url: string): string {
  return `\u001b]8;;${url}\u0007${text}\u001b]8;;\u0007`;
}

function widgetLine(info: PrInfo): string {
  const label = info.provider === "azure" ? "Azure PR" : "GitHub PR";
  const title = info.title ? ` — ${info.title}` : "";
  return `↗ ${label}: ${terminalLink("open pull request", info.url)}${title}`;
}

function safeSetWidget(ctx: ExtensionContext, generation: number, lines: string[] | undefined) {
  if (generation !== sessionGeneration) return;

  try {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(WIDGET_ID, lines, { placement: "belowEditor" });
  } catch (error) {
    if (!String(error).includes("ctx is stale")) {
      throw error;
    }
  }
}

async function refresh(ctx: ExtensionContext, force = false, generation = sessionGeneration) {
  if (generation !== sessionGeneration || refreshInFlight) return;
  refreshInFlight = true;
  try {
    const cwd = ctx.cwd;
    const key = await getRepoKey(cwd);
    if (generation !== sessionGeneration) return;

    if (!key) {
      safeSetWidget(ctx, generation, undefined);
      cache = undefined;
      return;
    }

    const now = Date.now();
    if (!force && cache?.key === key && now - cache.checkedAt < CACHE_TTL_MS) {
      safeSetWidget(ctx, generation, cache.info ? [widgetLine(cache.info)] : undefined);
      return;
    }

    const info = await findPr(cwd);
    if (generation !== sessionGeneration) return;

    cache = { key, checkedAt: now, info };
    safeSetWidget(ctx, generation, info ? [widgetLine(info)] : undefined);
  } finally {
    refreshInFlight = false;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const generation = ++sessionGeneration;
    await refresh(ctx, true, generation);
    if (timer) clearInterval(timer);
    timer = setInterval(() => void refresh(ctx, false, generation), POLL_MS);
    timer.unref?.();
  });

  pi.on("agent_end", async (_event, ctx) => {
    await refresh(ctx, true, sessionGeneration);
  });

  pi.on("input", async (_event, ctx) => {
    void refresh(ctx, false, sessionGeneration);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ++sessionGeneration;
    refreshInFlight = false;
    if (timer) clearInterval(timer);
    timer = undefined;
    safeSetWidget(ctx, sessionGeneration, undefined);
  });
}
