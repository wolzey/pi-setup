import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const FIGMA_MCP_URL = process.env.FIGMA_MCP_URL || "http://127.0.0.1:3845/mcp";

let client: Client | undefined;
let transport: StreamableHTTPClientTransport | undefined;
let connecting: Promise<Client> | undefined;

async function getClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    const nextClient = new Client({ name: "pi-figma-mcp", version: "0.1.0" });
    const nextTransport = new StreamableHTTPClientTransport(new URL(FIGMA_MCP_URL));
    await nextClient.connect(nextTransport);
    client = nextClient;
    transport = nextTransport;
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
  if (oldTransport) {
    try {
      await oldTransport.close();
    } catch {
      // Ignore close failures; reconnect will create a fresh session.
    }
  }
}

function stringifyMcpResult(result: unknown): string {
  const value = result as { content?: Array<any>; isError?: boolean };
  if (!Array.isArray(value.content)) return JSON.stringify(result, null, 2);

  const parts = value.content.map((item) => {
    if (item?.type === "text") return item.text ?? "";
    if (item?.type === "image") return `[image ${item.mimeType ?? "unknown mime"}; ${item.data ? "base64 omitted" : "no data"}]`;
    if (item?.type === "resource_link") return `[resource_link ${item.name ?? item.uri}: ${item.uri}]`;
    return JSON.stringify(item, null, 2);
  });

  const body = parts.filter(Boolean).join("\n\n");
  return value.isError ? `MCP tool returned an error:\n${body}` : body;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "figma_mcp_list_tools",
    label: "Figma MCP tools",
    description: `List tools exposed by the Figma MCP server at ${FIGMA_MCP_URL}. Requires the Figma desktop MCP server to be running, or FIGMA_MCP_URL to point at a reachable Figma MCP endpoint.`,
    parameters: Type.Object({}),
    async execute() {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        return {
          content: [{ type: "text", text: JSON.stringify(result.tools, null, 2) }],
          details: result,
        };
      } catch (error) {
        await resetClient();
        return {
          content: [{ type: "text", text: `Unable to reach Figma MCP at ${FIGMA_MCP_URL}. Open Figma Desktop, enable the MCP server, then try again.\n\n${error instanceof Error ? error.message : String(error)}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  pi.registerTool({
    name: "figma_mcp_call_tool",
    label: "Call Figma MCP",
    description: "Call a tool exposed by the Figma MCP server. Use figma_mcp_list_tools first to discover exact tool names and input schemas.",
    parameters: Type.Object({
      name: Type.String({ description: "Figma MCP tool name, for example get_code, get_image, get_variable_defs, or get_code_connect_map." }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "JSON object of arguments to pass to the MCP tool." })),
    }),
    async execute(_toolCallId, params) {
      try {
        const c = await getClient();
        const result = await c.request(
          { method: "tools/call", params: { name: params.name, arguments: params.arguments ?? {} } },
          CallToolResultSchema,
        );
        return {
          content: [{ type: "text", text: stringifyMcpResult(result) }],
          details: result,
        };
      } catch (error) {
        await resetClient();
        return {
          content: [{ type: "text", text: `Figma MCP call failed for ${params.name}.\n\n${error instanceof Error ? error.message : String(error)}` }],
          details: { error: String(error) },
        };
      }
    },
  });

  pi.registerCommand("figma-mcp-status", {
    description: "Check whether the Figma MCP server is reachable",
    handler: async (_args, ctx) => {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        ctx.ui.notify(`Figma MCP connected: ${result.tools.length} tools available`, "info");
      } catch (error) {
        await resetClient();
        ctx.ui.notify(`Figma MCP unavailable at ${FIGMA_MCP_URL}: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
