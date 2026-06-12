import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const CLAUDE_CONFIG_FILE = process.env.CONTEXT7_CLAUDE_CONFIG_FILE || join(homedir(), ".claude", ".claude.json");
const DEFAULT_PACKAGE = "@upstash/context7-mcp";

type Context7Config = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

let client: Client | undefined;
let transport: StdioClientTransport | undefined;
let connecting: Promise<Client> | undefined;

function loadContext7Config(): Context7Config {
  const envApiKey = process.env.CONTEXT7_API_KEY;
  if (envApiKey) {
    return {
      command: process.env.CONTEXT7_COMMAND || "npx",
      args: (process.env.CONTEXT7_ARGS ? JSON.parse(process.env.CONTEXT7_ARGS) : ["-y", DEFAULT_PACKAGE, "--api-key", envApiKey]) as string[],
      env: {},
    };
  }

  if (!existsSync(CLAUDE_CONFIG_FILE)) {
    throw new Error(`Claude config not found at ${CLAUDE_CONFIG_FILE}. Set CONTEXT7_API_KEY or CONTEXT7_CLAUDE_CONFIG_FILE.`);
  }

  const config = JSON.parse(readFileSync(CLAUDE_CONFIG_FILE, "utf8"));
  const server = config?.mcpServers?.context7;
  if (!server) {
    throw new Error(`No mcpServers.context7 entry found in ${CLAUDE_CONFIG_FILE}.`);
  }

  if (server.type && server.type !== "stdio") {
    throw new Error(`Context7 MCP server must be stdio; found type ${server.type}.`);
  }

  return {
    command: server.command || "npx",
    args: Array.isArray(server.args) ? server.args : ["-y", DEFAULT_PACKAGE],
    env: server.env || {},
  };
}

async function getClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const config = loadContext7Config();
    const nextClient = new Client({ name: "pi-context7-mcp", version: "0.1.0" }, { capabilities: {} });
    const nextTransport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env } as Record<string, string>,
    });

    await nextClient.connect(nextTransport);
    transport = nextTransport;
    client = nextClient;
    return nextClient;
  })().catch((error) => {
    client = undefined;
    transport = undefined;
    connecting = undefined;
    throw error;
  });

  return connecting;
}

async function resetClient() {
  const oldTransport = transport;
  client = undefined;
  transport = undefined;
  connecting = undefined;
  if (oldTransport) await oldTransport.close().catch(() => {});
}

function stringifyMcpResult(result: unknown): string {
  const value = result as { content?: Array<any>; isError?: boolean };
  if (!Array.isArray(value.content)) return JSON.stringify(result, null, 2);

  const body = value.content.map((item) => {
    if (item?.type === "text") return item.text ?? "";
    if (item?.type === "image") return `[image ${item.mimeType ?? "unknown mime"}; base64 omitted]`;
    if (item?.type === "resource_link") return `[resource_link ${item.name ?? item.uri}: ${item.uri}]`;
    return JSON.stringify(item, null, 2);
  }).filter(Boolean).join("\n\n");

  return value.isError ? `MCP tool returned an error:\n${body}` : body;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "context7_mcp_list_tools",
    label: "Context7 MCP tools",
    description: "List tools exposed by Context7 MCP. Uses CONTEXT7_API_KEY when set, otherwise reads Claude's mcpServers.context7 config without exposing the API key.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        return { content: [{ type: "text", text: JSON.stringify(result.tools, null, 2) }], details: result };
      } catch (error) {
        await resetClient();
        return { content: [{ type: "text", text: `Unable to connect to Context7 MCP.\n\n${error instanceof Error ? error.message : String(error)}` }], details: { error: String(error) } };
      }
    },
  });

  pi.registerTool({
    name: "context7_mcp_call_tool",
    label: "Call Context7 MCP",
    description: "Call a tool exposed by Context7 MCP. Use context7_mcp_list_tools first to discover exact tool names and schemas.",
    parameters: Type.Object({
      name: Type.String({ description: "Context7 MCP tool name." }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "JSON arguments for the MCP tool." })),
    }),
    async execute(_toolCallId, params) {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/call", params: { name: params.name, arguments: params.arguments ?? {} } }, CallToolResultSchema);
        return { content: [{ type: "text", text: stringifyMcpResult(result) }], details: result };
      } catch (error) {
        await resetClient();
        return { content: [{ type: "text", text: `Context7 MCP call failed for ${params.name}.\n\n${error instanceof Error ? error.message : String(error)}` }], details: { error: String(error) } };
      }
    },
  });

  pi.registerCommand("context7-mcp-status", {
    description: "Check whether Context7 MCP is reachable",
    handler: async (_args, ctx) => {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        ctx.ui.notify(`Context7 MCP connected: ${result.tools.length} tools available`, "info");
      } catch (error) {
        await resetClient();
        ctx.ui.notify(`Context7 MCP unavailable: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
