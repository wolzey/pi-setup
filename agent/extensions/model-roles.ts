import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "model-roles.json");
const ENTRY_TYPE = "model-role";
const STATUS_KEY = "model-role";

type RoleConfig = {
  provider: string;
  model: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  description?: string;
};

type Config = {
  roles?: Record<string, RoleConfig>;
};

async function loadConfig(): Promise<Config> {
  const text = await readFile(CONFIG_PATH, "utf8");
  return JSON.parse(text) as Config;
}

function formatRole(name: string, role: RoleConfig) {
  const thinking = role.thinking ? ` thinking=${role.thinking}` : "";
  const description = role.description ? ` — ${role.description}` : "";
  return `- ${name}: ${role.provider}/${role.model}${thinking}${description}`;
}

function latestRoleFromSession(ctx: { sessionManager: any }) {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data?.name) {
      return String(entry.data.name);
    }
  }
  return undefined;
}

async function applyRole(pi: ExtensionAPI, ctx: any, name: string, role: RoleConfig) {
  const model = ctx.modelRegistry.find(role.provider, role.model);
  if (!model) {
    ctx.ui.notify(`Role ${name} references unavailable model ${role.provider}/${role.model}`, "error");
    return false;
  }

  const ok = await pi.setModel(model);
  if (!ok) {
    ctx.ui.notify(`No available auth/API key for ${role.provider}/${role.model}`, "error");
    return false;
  }

  if (role.thinking) pi.setThinkingLevel(role.thinking);

  pi.appendEntry(ENTRY_TYPE, {
    name,
    provider: role.provider,
    model: role.model,
    thinking: role.thinking,
    selectedAt: new Date().toISOString(),
  });
  ctx.ui.setStatus(STATUS_KEY, `role: ${name}`);
  ctx.ui.notify(`Switched to role ${name}: ${role.provider}/${role.model}${role.thinking ? ` (${role.thinking})` : ""}`, "info");
  return true;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const role = latestRoleFromSession(ctx);
    ctx.ui.setStatus(STATUS_KEY, role ? `role: ${role}` : undefined);
  });

  pi.registerCommand("role", {
    description: "Switch model role from ~/.pi/agent/model-roles.json: /role list, /role <name>",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      let config: Config;
      try {
        config = await loadConfig();
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? `Failed to load ${CONFIG_PATH}: ${error.message}` : String(error), "error");
        return;
      }

      const roles = config.roles ?? {};
      const requested = args.trim() || "list";

      if (requested === "list" || requested === "help") {
        const lines = Object.entries(roles).map(([name, role]) => formatRole(name, role));
        ctx.ui.notify(lines.length ? `Model roles:\n${lines.join("\n")}` : `No roles configured in ${CONFIG_PATH}`, "info");
        return;
      }

      const role = roles[requested];
      if (!role) {
        ctx.ui.notify(`Unknown role ${requested}. Try /role list.`, "warning");
        return;
      }

      await applyRole(pi, ctx, requested, role);
    },
  });
}
