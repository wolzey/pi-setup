import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PLAN_STATUS_KEY = "plan-mode";
const PLAN_WIDGET_KEY = "plan-mode-widget";

export default function planMode(pi: ExtensionAPI) {
  let planModeEnabled = false;

  pi.on("session_start", async (_event, ctx) => {
    planModeEnabled = false;

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "plan-mode") {
        planModeEnabled = Boolean((entry.data as { enabled?: unknown } | undefined)?.enabled);
      }
    }

    updatePlanModeUi(ctx, planModeEnabled);
  });

  pi.registerCommand("plan", {
    description: "Enable plan mode for critical clarification before implementation",
    handler: async (_args, ctx) => {
      planModeEnabled = true;
      pi.appendEntry("plan-mode", { enabled: true, timestamp: Date.now() });
      updatePlanModeUi(ctx, true);
      ctx.ui.notify("Plan mode enabled", "info");
    },
  });

  pi.registerTool({
    name: "create_plan_artifact",
    label: "Create Plan Artifact",
    description: "Create a locked implementation plan markdown file in ~/.pi/plans after the user explicitly approves the plan.",
    promptSnippet: "Create a markdown implementation plan artifact in ~/.pi/plans after explicit user approval",
    promptGuidelines: [
      "Use create_plan_artifact only in plan mode and only after the user explicitly says the plan is locked/approved.",
      "Do not use create_plan_artifact for code or configuration changes; it may only write markdown plan artifacts under ~/.pi/plans.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Short human-readable plan title" }),
      markdown: Type.String({ description: "Complete markdown plan content, including goal, scope, files, steps, and acceptance/testing criteria" }),
    }),
    async execute(_toolCallId, params) {
      if (!planModeEnabled) {
        throw new Error("create_plan_artifact can only be used while plan mode is enabled. Run /plan first.");
      }

      const plansDir = path.join(os.homedir(), ".pi", "plans");
      await mkdir(plansDir, { recursive: true });

      const slug = slugify(params.title);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filePath = path.join(plansDir, `${timestamp}-${slug}.md`);
      await writeFile(filePath, params.markdown.endsWith("\n") ? params.markdown : `${params.markdown}\n`, "utf8");

      return {
        content: [{ type: "text", text: `Created plan artifact: ${filePath}` }],
        details: { filePath },
      };
    },
  });

  pi.on("tool_call", async (event) => {
    if (planModeEnabled && ["edit", "write"].includes(event.toolName)) {
      return {
        block: true,
        reason: "Plan mode is enabled. File mutation tools are blocked until the user chooses to execute the approved plan.",
      };
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!planModeEnabled) return;

    updatePlanModeUi(ctx, true);

    return {
      systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_PROMPT}`,
    };
  });
}

const PLAN_MODE_PROMPT = [
  "PLAN MODE IS ENABLED.",
  "The user's next prompts describe work they may want done. Do not implement code changes in plan mode.",
  "Be extremely critical. Do not assume requirements, architecture, file targets, constraints, or acceptance criteria that the user did not state.",
  "Ask focused clarification questions until the goal, scope, approach, affected files, constraints, and test/acceptance criteria are completely clear.",
  "You may suggest easier or safer approaches, but you must ask the user before deviating from their stated direction.",
  "When the plan is clear, present it for explicit approval. Do not create a plan artifact until the user explicitly confirms the plan is locked/approved.",
  "After approval, call create_plan_artifact with a markdown plan saved under ~/.pi/plans. The markdown must include: goal, non-goals, assumptions confirmed by the user, implementation steps, files to change, acceptance criteria, and testing criteria.",
  "After creating the plan artifact, ask whether the user wants to execute the plan now or hand it to another session.",
].join("\n");

function updatePlanModeUi(ctx: { ui: { setStatus: (key: string, value: string | undefined) => void; setWidget: (key: string, value: string[] | undefined) => void } }, enabled: boolean) {
  ctx.ui.setStatus(PLAN_STATUS_KEY, enabled ? "mode: plan" : undefined);
  ctx.ui.setWidget(PLAN_WIDGET_KEY, enabled ? ["Plan mode enabled"] : undefined);
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "plan";
}
