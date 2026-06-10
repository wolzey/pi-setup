import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

type Scope = "global" | "project";

type MemoryRecord = {
  id: string;
  scope: Scope;
  projectRoot?: string;
  text: string;
  tags: string[];
  createdAt: string;
  updatedAt?: string;
  source?: string;
};

const MEMORY_DIR = path.join(os.homedir(), ".pi", "agent");
const MEMORY_PATH = path.join(MEMORY_DIR, "memory.jsonl");
const STATUS_KEY = "memory";

function words(input: string) {
  return input.toLowerCase().match(/[a-z0-9_.:/-]+/g) ?? [];
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0).map((tag) => tag.trim().toLowerCase()))];
}

async function loadMemories(): Promise<MemoryRecord[]> {
  try {
    const text = await readFile(MEMORY_PATH, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryRecord)
      .filter((memory) => memory.id && memory.text && memory.scope);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function saveMemories(memories: MemoryRecord[]) {
  await mkdir(MEMORY_DIR, { recursive: true });
  await writeFile(MEMORY_PATH, memories.map((memory) => JSON.stringify(memory)).join("\n") + (memories.length ? "\n" : ""), "utf8");
}

async function getProjectRoot(pi: ExtensionAPI, cwd: string) {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 });
  return result.code === 0 ? result.stdout.trim() : cwd;
}

function visibleInProject(memory: MemoryRecord, projectRoot: string) {
  return memory.scope === "global" || memory.projectRoot === projectRoot;
}

function scoreMemory(memory: MemoryRecord, query: string) {
  const queryWords = words(query);
  if (queryWords.length === 0) return 1;

  const haystack = words(`${memory.text} ${memory.tags.join(" ")}`);
  const haystackSet = new Set(haystack);
  let score = 0;
  for (const term of queryWords) {
    if (haystackSet.has(term)) score += 3;
    else if (haystack.some((word) => word.includes(term) || term.includes(word))) score += 1;
  }
  return score;
}

function formatMemory(memory: MemoryRecord) {
  const tags = memory.tags.length ? ` tags=${memory.tags.join(",")}` : "";
  const scope = memory.scope === "project" ? `project:${memory.projectRoot ?? "unknown"}` : "global";
  return `- ${memory.id} [${scope}${tags}] ${memory.text}`;
}

async function searchMemories(pi: ExtensionAPI, cwd: string, query: string, opts?: { scope?: Scope | "all"; limit?: number; tags?: string[] }) {
  const projectRoot = await getProjectRoot(pi, cwd);
  const memories = await loadMemories();
  const requiredTags = opts?.tags ?? [];

  return memories
    .filter((memory) => visibleInProject(memory, projectRoot))
    .filter((memory) => !opts?.scope || opts.scope === "all" || memory.scope === opts.scope)
    .filter((memory) => requiredTags.every((tag) => memory.tags.includes(tag.toLowerCase())))
    .map((memory) => ({ memory, score: scoreMemory(memory, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.memory.createdAt.localeCompare(a.memory.createdAt))
    .slice(0, opts?.limit ?? 10)
    .map(({ memory }) => memory);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "retain",
    label: "Retain Memory",
    description: "Store a durable global or project-scoped memory for future Pi sessions.",
    promptSnippet: "Save stable user preferences, repo conventions, and recurring workflow facts to durable memory.",
    promptGuidelines: [
      "Use retain only for stable facts that will be useful in future sessions, not transient task state.",
      "Prefer project scope for repo-specific conventions and global scope for user preferences.",
      "Keep memories concise, factual, and non-sensitive.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "Concise durable fact to remember." }),
      scope: StringEnum(["global", "project"] as const),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional lowercase tags for filtering/search." })),
      source: Type.Optional(Type.String({ description: "Optional source/context for this memory." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const projectRoot = params.scope === "project" ? await getProjectRoot(pi, ctx.cwd) : undefined;
      const memories = await loadMemories();
      const memory: MemoryRecord = {
        id: `mem_${randomUUID().slice(0, 8)}`,
        scope: params.scope,
        projectRoot,
        text: params.text.trim(),
        tags: parseTags(params.tags),
        createdAt: new Date().toISOString(),
        source: params.source,
      };
      memories.push(memory);
      await saveMemories(memories);
      return { content: [{ type: "text", text: `Retained memory: ${formatMemory(memory)}` }], details: memory };
    },
  });

  pi.registerTool({
    name: "recall",
    label: "Recall Memory",
    description: "Search durable global and project-scoped memories relevant to the current workspace.",
    promptSnippet: "Search durable memory for user preferences, repo conventions, and recurring workflow facts.",
    promptGuidelines: [
      "Use recall when prior user preferences or repo conventions could materially affect the answer.",
      "Project memories are visible only within the same git repository; global memories are visible everywhere.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query." }),
      scope: Type.Optional(StringEnum(["global", "project", "all"] as const)),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags that all returned memories must include." })),
      limit: Type.Optional(Type.Number({ description: "Maximum results. Defaults to 10.", minimum: 1, maximum: 50 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const results = await searchMemories(pi, ctx.cwd, params.query, {
        scope: params.scope ?? "all",
        tags: parseTags(params.tags),
        limit: params.limit ?? 10,
      });
      return {
        content: [{ type: "text", text: results.length ? results.map(formatMemory).join("\n") : "No matching memories." }],
        details: { results },
      };
    },
  });

  pi.registerCommand("memory", {
    description: "Manage durable memory: /memory add <text>, /memory search <query>, /memory list, /memory forget <id>",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const [action, ...rest] = args.trim().split(/\s+/);
      const body = rest.join(" ").trim();

      if (!action || action === "help") {
        ctx.ui.notify("Usage:\n/memory add <text>\n/memory add-global <text>\n/memory search <query>\n/memory list\n/memory forget <id>", "info");
        return;
      }

      if (action === "add" || action === "add-global") {
        if (!body) {
          ctx.ui.notify(`Usage: /memory ${action} <text>`, "warning");
          return;
        }
        const projectRoot = action === "add" ? await getProjectRoot(pi, ctx.cwd) : undefined;
        const memories = await loadMemories();
        const memory: MemoryRecord = {
          id: `mem_${randomUUID().slice(0, 8)}`,
          scope: action === "add" ? "project" : "global",
          projectRoot,
          text: body,
          tags: [],
          createdAt: new Date().toISOString(),
          source: "slash-command",
        };
        memories.push(memory);
        await saveMemories(memories);
        ctx.ui.notify(`Added memory:\n${formatMemory(memory)}`, "info");
        return;
      }

      if (action === "search" || action === "list") {
        const query = action === "list" ? "" : body;
        const results = await searchMemories(pi, ctx.cwd, query, { scope: "all", limit: 25 });
        ctx.ui.notify(results.length ? results.map(formatMemory).join("\n") : "No matching memories.", "info");
        return;
      }

      if (action === "forget") {
        if (!body) {
          ctx.ui.notify("Usage: /memory forget <id>", "warning");
          return;
        }
        const memories = await loadMemories();
        const kept = memories.filter((memory) => memory.id !== body);
        if (kept.length === memories.length) {
          ctx.ui.notify(`No memory found with id ${body}`, "warning");
          return;
        }
        await saveMemories(kept);
        ctx.ui.notify(`Forgot memory ${body}`, "info");
        return;
      }

      ctx.ui.notify(`Unknown /memory action: ${action}`, "warning");
    },
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const projectRoot = await getProjectRoot(pi, ctx.cwd);
    const memories = (await loadMemories())
      .filter((memory) => visibleInProject(memory, projectRoot))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12);

    ctx.ui.setStatus(STATUS_KEY, memories.length ? `memory: ${memories.length}` : undefined);
    if (memories.length === 0) return;

    return {
      systemPrompt: `${event.systemPrompt}\n\nDurable memory available for this session:\n${memories.map(formatMemory).join("\n")}\n\nUse recall for targeted searches before relying on memory not shown here. Use retain only for stable, future-useful, non-sensitive facts.`,
    };
  });
}
