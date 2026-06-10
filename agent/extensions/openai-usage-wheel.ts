import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type LimitWindow = {
	usedPercent: number;
	windowMinutes?: number;
	resetAt?: number;
	source: "codex headers" | "wham" | "local estimate";
	label: string;
};

type WhamWindow = {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_after_seconds?: number;
	reset_at?: number;
};

type WhamRateLimit = {
	allowed?: boolean;
	limit_reached?: boolean;
	primary_window?: WhamWindow | null;
	secondary_window?: WhamWindow | null;
};

type WhamUsage = {
	plan_type?: string;
	rate_limit?: WhamRateLimit;
	credits?: {
		has_credits?: boolean;
		unlimited?: boolean;
		balance?: string;
	};
	spend_control?: { reached?: boolean };
};

const STATUS_KEY = "openai-usage-wheel";
const DEFAULT_BUDGET_TOKENS = 250_000;
const WHAM_URL = "https://chatgpt.com/backend-api/wham/usage";

export default function (pi: ExtensionAPI) {
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let totalCost = 0;
	let primaryWindow: LimitWindow | undefined;
	let secondaryWindow: LimitWindow | undefined;
	let planType: string | undefined;
	let credits: WhamUsage["credits"] | undefined;
	let limitReached = false;
	let footerTui: { requestRender: () => void } | undefined;
	let lastProvider = "";
	let lastModel = "";

	function configuredBudget(): number {
		const raw = process.env.PI_OPENAI_USAGE_BUDGET_TOKENS;
		const parsed = raw ? Number(raw.replaceAll("_", "")) : DEFAULT_BUDGET_TOKENS;
		return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET_TOKENS;
	}

	function totalTokens(): number {
		// Cache reads can be very large and cheap; including them makes the local fallback
		// falsely hit 100% in long cached sessions. Use billable-ish fresh tokens instead.
		return inputTokens + outputTokens + cacheWriteTokens;
	}

	function localWindow(): LimitWindow {
		return {
			usedPercent: Math.min(100, (totalTokens() / configuredBudget()) * 100),
			source: "local estimate",
			label: "local",
		};
	}

	function activeWindow(): LimitWindow {
		const remoteWindows = [primaryWindow, secondaryWindow].filter(Boolean) as LimitWindow[];
		if (remoteWindows.length > 0) {
			return remoteWindows.reduce((max, current) => (current.usedPercent > max.usedPercent ? current : max));
		}
		return localWindow();
	}

	function wheel(percent: number): string {
		if (percent <= 0) return "○";
		if (percent < 25) return "◔";
		if (percent < 50) return "◑";
		if (percent < 100) return "◕";
		return "●";
	}

	function colorize(ctx: any, percent: number, text: string): string {
		const theme = ctx.ui.theme;
		if (percent <= 0) return theme.fg("dim", text);
		if (percent < 50) return theme.fg("success", text);
		if (percent < 75) return theme.fg("warning", text);
		return theme.fg("error", text);
	}

	function usageLabel(): { percent: number; label: string } {
		const active = activeWindow();
		const percent = limitReached ? 100 : Math.round(Math.min(100, Math.max(0, active.usedPercent)));
		return { percent, label: `${wheel(percent)} ${percent}% ${limitReached ? "limit" : active.label}` };
	}

	function updateStatus(ctx: any) {
		if (footerTui) {
			footerTui.requestRender();
			return;
		}
		const { percent, label } = usageLabel();
		ctx.ui.setStatus(STATUS_KEY, colorize(ctx, percent, label));
	}

	function installFooter(ctx: any) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			footerTui = tui;
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: () => {
					footerTui = undefined;
					unsub?.();
				},
				invalidate() {},
				render(width: number): string[] {
					let input = 0;
					let output = 0;
					let cacheRead = 0;
					let cacheWrite = 0;
					let cost = 0;
					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							const message = entry.message as AssistantMessage;
							input += message.usage.input;
							output += message.usage.output;
							cacheRead += message.usage.cacheRead;
							cacheWrite += message.usage.cacheWrite;
							cost += message.usage.cost.total;
						}
					}
					const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
					const branch = footerData.getGitBranch?.();
					const sessionName = pi.getSessionName?.();
					const left = theme.fg("dim", `${ctx.cwd}${sessionName ? ` · ${sessionName}` : ""}${branch ? ` (${branch})` : ""}`);
					const tokenStats = theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} R${fmt(cacheRead)} W${fmt(cacheWrite)} $${cost.toFixed(3)}`);
					const { percent, label } = usageLabel();
					const usage = colorize(ctx, percent, label);
					const model = theme.fg("dim", ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model");
					const right = `${tokenStats}  ${usage}  ${model}`;
					const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
					return [truncateToWidth(left + pad + right, width, "")];
				},
			};
		});
	}

	function addUsage(usage: Usage | undefined) {
		if (!usage) return;
		inputTokens += usage.input ?? 0;
		outputTokens += usage.output ?? 0;
		cacheReadTokens += usage.cacheRead ?? 0;
		cacheWriteTokens += usage.cacheWrite ?? 0;
		totalCost += usage.cost?.total ?? 0;
	}

	function header(headers: Record<string, string>, name: string): string | undefined {
		return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
	}

	function numberHeader(headers: Record<string, string>, name: string): number | undefined {
		const value = header(headers, name);
		if (!value) return undefined;
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	function parseCodexWindow(headers: Record<string, string>, prefix: string, label: string): LimitWindow | undefined {
		const usedPercent = numberHeader(headers, `${prefix}-used-percent`);
		if (usedPercent === undefined) return undefined;
		return {
			usedPercent,
			windowMinutes: numberHeader(headers, `${prefix}-window-minutes`),
			resetAt: numberHeader(headers, `${prefix}-reset-at`),
			source: "codex headers",
			label,
		};
	}

	function captureCodexHeaders(headers: Record<string, string>) {
		primaryWindow = parseCodexWindow(headers, "x-codex-primary", "5h") ?? primaryWindow;
		secondaryWindow = parseCodexWindow(headers, "x-codex-secondary", "wk") ?? secondaryWindow;
		limitReached = limitReached || [primaryWindow, secondaryWindow].some((window) => (window?.usedPercent ?? 0) >= 100);
	}

	function fromWhamWindow(window: WhamWindow | null | undefined, label: string): LimitWindow | undefined {
		if (!window || typeof window.used_percent !== "number") return undefined;
		return {
			usedPercent: window.used_percent,
			windowMinutes: window.limit_window_seconds ? Math.round(window.limit_window_seconds / 60) : undefined,
			resetAt: window.reset_at,
			source: "wham",
			label,
		};
	}

	function formatReset(resetAt?: number): string {
		if (!resetAt) return "unknown";
		const date = new Date(resetAt * 1000);
		return date.toLocaleString(undefined, {
			weekday: "short",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	function decodeJwtPayload(token: string): any | undefined {
		const part = token.split(".")[1];
		if (!part) return undefined;
		const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
	}

	function findOauthCandidates(value: any): Array<{ access: string; expires?: number }> {
		const found: Array<{ access: string; expires?: number }> = [];
		function visit(node: any) {
			if (!node || typeof node !== "object") return;
			const access = typeof node.access === "string" ? node.access : typeof node.access_token === "string" ? node.access_token : undefined;
			const type = typeof node.type === "string" ? node.type : undefined;
			if (access && (!type || type === "oauth")) found.push({ access, expires: Number(node.expires ?? node.expires_at) });
			for (const child of Object.values(node)) visit(child);
		}
		visit(value);
		return found;
	}

	async function readAuth(): Promise<{ token: string; accountId: string } | undefined> {
		const paths = [
			join(homedir(), ".pi/agent/auth.json"),
			join(homedir(), ".local/share/opencode/auth.json"),
		];

		for (const path of paths) {
			try {
				const json = JSON.parse(await readFile(path, "utf8"));
				for (const candidate of findOauthCandidates(json)) {
					if (candidate.expires && candidate.expires < Date.now() / 1000) continue;
					const payload = decodeJwtPayload(candidate.access);
					const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
					if (typeof accountId === "string" && accountId) return { token: candidate.access, accountId };
				}
			} catch {
				// Try the next auth store.
			}
		}
		return undefined;
	}

	async function refreshWham(signal?: AbortSignal): Promise<WhamUsage> {
		const auth = await readAuth();
		if (!auth) throw new Error("No usable ChatGPT OAuth token found in ~/.pi/agent/auth.json or ~/.local/share/opencode/auth.json.");
		const response = await fetch(WHAM_URL, {
			headers: {
				Authorization: `Bearer ${auth.token}`,
				"ChatGPT-Account-Id": auth.accountId,
			},
			signal,
		});
		if (!response.ok) throw new Error(`ChatGPT usage request failed with HTTP ${response.status}.`);
		return (await response.json()) as WhamUsage;
	}

	function applyWhamUsage(usage: WhamUsage) {
		planType = usage.plan_type ?? planType;
		credits = usage.credits ?? credits;
		primaryWindow = fromWhamWindow(usage.rate_limit?.primary_window, "5h") ?? primaryWindow;
		secondaryWindow = fromWhamWindow(usage.rate_limit?.secondary_window, "wk") ?? secondaryWindow;
		limitReached = Boolean(usage.rate_limit?.limit_reached || usage.spend_control?.reached || limitReached);
	}

	pi.on("session_start", async (_event, ctx) => installFooter(ctx));
	pi.on("model_select", async (event, ctx) => {
		lastProvider = event.model.provider;
		lastModel = event.model.id;
		updateStatus(ctx);
	});
	pi.on("after_provider_response", async (event, ctx) => {
		captureCodexHeaders(event.headers);
		updateStatus(ctx);
	});
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		lastProvider = event.message.provider;
		lastModel = event.message.model;
		addUsage(event.message.usage);
		if (event.message.stopReason === "error" && /limit|quota|rate/i.test(event.message.errorMessage ?? "")) limitReached = true;
		updateStatus(ctx);
	});

	pi.registerCommand("usage-refresh", {
		description: "Refresh ChatGPT Codex subscription usage from the internal usage endpoint",
		handler: async (_args, ctx) => {
			try {
				const usage = await refreshWham(ctx.signal);
				applyWhamUsage(usage);
				updateStatus(ctx);
				ctx.ui.notify("Usage refreshed from ChatGPT.", "info");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : "Usage refresh failed.", "warning");
			}
		},
	});

	pi.registerCommand("usage", {
		description: "Show OpenAI/Codex usage wheel details",
		handler: async (_args, ctx) => {
			const active = activeWindow();
			const percent = limitReached ? 100 : Math.round(Math.min(100, Math.max(0, active.usedPercent)));
			const lines = [
				`${wheel(percent)} ${percent}% ${limitReached ? "limit reached" : active.label}`,
				`Source: ${active.source}`,
				`Plan: ${planType ?? "unknown"}`,
				`Model: ${lastProvider || ctx.model?.provider || "unknown"}/${lastModel || ctx.model?.id || "unknown"}`,
			];
			for (const [name, window] of [["Primary", primaryWindow], ["Secondary", secondaryWindow]] as const) {
				if (!window) continue;
				lines.push(`${name} (${window.label}): ${window.usedPercent.toFixed(1)}%, resets ${formatReset(window.resetAt)}`);
			}
			lines.push(`Local tokens: ${totalTokens().toLocaleString()} / ${configuredBudget().toLocaleString()}`);
			lines.push(`Input/output/cache: ${inputTokens.toLocaleString()} / ${outputTokens.toLocaleString()} / ${(cacheReadTokens + cacheWriteTokens).toLocaleString()}`);
			lines.push(`Cost: $${totalCost.toFixed(4)}`);
			if (credits) lines.push(`Credits: ${credits.unlimited ? "unlimited" : credits.balance ?? "unknown"}`);
			ctx.ui.notify(lines.join("\n"), percent >= 75 ? "warning" : "info");
			updateStatus(ctx);
		},
	});

	pi.registerCommand("usage-reset", {
		description: "Reset local session usage wheel counters and cached limits",
		handler: async (_args, ctx) => {
			inputTokens = 0;
			outputTokens = 0;
			cacheReadTokens = 0;
			cacheWriteTokens = 0;
			totalCost = 0;
			primaryWindow = undefined;
			secondaryWindow = undefined;
			limitReached = false;
			updateStatus(ctx);
			ctx.ui.notify("Usage wheel reset.", "info");
		},
	});
}
