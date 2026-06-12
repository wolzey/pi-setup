import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

const FIGMA_MCP_URL = process.env.FIGMA_MCP_URL || "https://mcp.figma.com/mcp";
const CALLBACK_PORT = Number(process.env.FIGMA_MCP_CALLBACK_PORT || 8097);
const CALLBACK_URL = process.env.FIGMA_MCP_CALLBACK_URL || `http://localhost:${CALLBACK_PORT}/callback`;
const TOKEN_FILE = process.env.FIGMA_MCP_TOKEN_FILE || join(homedir(), ".pi", "agent", "figma-mcp-oauth.json");

type OAuthState = {
  clientInformation?: unknown;
  tokens?: unknown;
  codeVerifier?: string;
};

class PersistentOAuthProvider {
  private state: OAuthState;
  private onRedirect?: (url: URL) => void;

  constructor(onRedirect?: (url: URL) => void) {
    this.onRedirect = onRedirect;
    this.state = loadOAuthState();
  }

  get redirectUrl() {
    return CALLBACK_URL;
  }

  get clientMetadata() {
    return {
      client_name: "Pi Figma MCP",
      redirect_uris: [CALLBACK_URL],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }

  clientInformation() {
    return this.state.clientInformation as any;
  }

  saveClientInformation(clientInformation: any) {
    this.state.clientInformation = clientInformation;
    saveOAuthState(this.state);
  }

  tokens() {
    return this.state.tokens as any;
  }

  saveTokens(tokens: any) {
    this.state.tokens = tokens;
    saveOAuthState(this.state);
  }

  redirectToAuthorization(authorizationUrl: URL) {
    this.onRedirect?.(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string) {
    this.state.codeVerifier = codeVerifier;
    saveOAuthState(this.state);
  }

  codeVerifier() {
    if (!this.state.codeVerifier) throw new Error("No OAuth code verifier saved");
    return this.state.codeVerifier;
  }
}

let client: Client | undefined;
let transport: StreamableHTTPClientTransport | undefined;
let connecting: Promise<Client> | undefined;

function loadOAuthState(): OAuthState {
  try {
    if (!existsSync(TOKEN_FILE)) return {};
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as OAuthState;
  } catch {
    return {};
  }
}

function saveOAuthState(state: OAuthState) {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function openBrowser(url: string) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => {});
}

async function waitForOAuthCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    let server: Server;
    server = createServer((req, res) => {
      const parsedUrl = new URL(req.url || "", CALLBACK_URL);
      if (parsedUrl.pathname !== new URL(CALLBACK_URL).pathname) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = parsedUrl.searchParams.get("code");
      const error = parsedUrl.searchParams.get("error");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Figma MCP authorization complete</h1><p>You can close this window and return to Pi.</p>");
        resolve(code);
        setTimeout(() => server.close(), 500);
      } else {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(`<h1>Figma MCP authorization failed</h1><p>${error || "No authorization code received"}</p>`);
        reject(new Error(error || "No authorization code received"));
        setTimeout(() => server.close(), 500);
      }
    });

    server.on("error", reject);
    server.listen(CALLBACK_PORT, "127.0.0.1");
  });
}

async function connectWithOAuth(onAuthUrl?: (url: URL) => void): Promise<Client> {
  const oauthProvider = new PersistentOAuthProvider(onAuthUrl);
  const nextClient = new Client({ name: "pi-figma-mcp", version: "0.1.0" }, { capabilities: {} });
  const nextTransport = new StreamableHTTPClientTransport(new URL(FIGMA_MCP_URL), { authProvider: oauthProvider });

  try {
    await nextClient.connect(nextTransport);
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    const callbackPromise = waitForOAuthCallback();
    const code = await callbackPromise;
    await nextTransport.finishAuth(code);
    await nextTransport.close().catch(() => {});

    const authedClient = new Client({ name: "pi-figma-mcp", version: "0.1.0" }, { capabilities: {} });
    const authedTransport = new StreamableHTTPClientTransport(new URL(FIGMA_MCP_URL), { authProvider: oauthProvider });
    await authedClient.connect(authedTransport);
    transport = authedTransport;
    return authedClient;
  }

  transport = nextTransport;
  return nextClient;
}

async function getClient(): Promise<Client> {
  if (client) return client;
  if (connecting) return connecting;
  connecting = connectWithOAuth((url) => openBrowser(url.toString()))
    .then((c) => (client = c))
    .catch((error) => {
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
    name: "figma_mcp_list_tools",
    label: "Figma MCP tools",
    description: `List tools exposed by Figma MCP at ${FIGMA_MCP_URL}. If not authenticated, this starts OAuth in your browser using callback ${CALLBACK_URL}.`,
    parameters: Type.Object({}),
    async execute() {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        return { content: [{ type: "text", text: JSON.stringify(result.tools, null, 2) }], details: result };
      } catch (error) {
        await resetClient();
        return { content: [{ type: "text", text: `Unable to connect/authenticate Figma MCP at ${FIGMA_MCP_URL}.\n\n${error instanceof Error ? error.message : String(error)}` }], details: { error: String(error) } };
      }
    },
  });

  pi.registerTool({
    name: "figma_mcp_call_tool",
    label: "Call Figma MCP",
    description: "Call a tool exposed by Figma MCP. Use figma_mcp_list_tools first to discover exact tool names and schemas.",
    parameters: Type.Object({
      name: Type.String({ description: "Figma MCP tool name." }),
      arguments: Type.Optional(Type.Record(Type.String(), Type.Any(), { description: "JSON arguments for the MCP tool." })),
    }),
    async execute(_toolCallId, params) {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/call", params: { name: params.name, arguments: params.arguments ?? {} } }, CallToolResultSchema);
        return { content: [{ type: "text", text: stringifyMcpResult(result) }], details: result };
      } catch (error) {
        await resetClient();
        return { content: [{ type: "text", text: `Figma MCP call failed for ${params.name}.\n\n${error instanceof Error ? error.message : String(error)}` }], details: { error: String(error) } };
      }
    },
  });

  pi.registerCommand("figma-mcp-login", {
    description: "Sign in to Figma MCP with OAuth",
    handler: async (_args, ctx) => {
      await resetClient();
      ctx.ui.notify("Starting Figma MCP OAuth sign-in in your browser...", "info");
      try {
        client = await connectWithOAuth((url) => {
          ctx.ui.notify(`Opening Figma OAuth URL: ${url.toString()}`, "info");
          openBrowser(url.toString());
        });
        const result = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        ctx.ui.notify(`Figma MCP signed in: ${result.tools.length} tools available`, "info");
      } catch (error) {
        await resetClient();
        ctx.ui.notify(`Figma MCP sign-in failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("figma-mcp-status", {
    description: "Check whether Figma MCP is reachable and authenticated",
    handler: async (_args, ctx) => {
      try {
        const c = await getClient();
        const result = await c.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
        ctx.ui.notify(`Figma MCP connected: ${result.tools.length} tools available`, "info");
      } catch (error) {
        await resetClient();
        ctx.ui.notify(`Figma MCP unavailable: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
