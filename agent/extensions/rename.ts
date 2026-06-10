import {
  CustomEditor,
  type ExtensionAPI,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";

const WIDGET_ID = "rename-title";
const STATE_TYPE = "rename-state";

type RenameState = {
  title?: string;
  borderColor?: string;
};

let state: RenameState = {};
let activeTui: TUI | undefined;

function parseArgs(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const ch of input.trim()) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) args.push(current);
  return args;
}

function isHexColor(value: string | undefined): value is string {
  return !!value && /^#[0-9a-fA-F]{6}$/.test(value);
}

function hexToAnsi(hex: string, text: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function applyUi(ctx: { ui: any }) {
  if (state.title) {
    ctx.ui.setWidget(
      WIDGET_ID,
      (_tui: TUI, theme: any) => ({
        render(width: number): string[] {
          const title = ` ${state.title} `;
          const styled = state.borderColor ? hexToAnsi(state.borderColor, title) : theme.fg("accent", title);
          return [truncateToWidth(styled, width)];
        },
        invalidate() {},
      }),
      { placement: "aboveEditor" },
    );
  } else {
    ctx.ui.setWidget(WIDGET_ID, undefined);
  }
  activeTui?.requestRender();
}

function latestStateFromSession(ctx: { sessionManager: any }): RenameState {
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === STATE_TYPE && entry.data) {
      return {
        title: typeof entry.data.title === "string" ? entry.data.title : undefined,
        borderColor: isHexColor(entry.data.borderColor) ? entry.data.borderColor : undefined,
      };
    }
  }
  return {};
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    state = latestStateFromSession(ctx);
    if (state.title) pi.setSessionName(state.title);

    class RenameEditor extends CustomEditor {
      constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
        super(tui, theme, keybindings);
        activeTui = tui;
      }

      borderColor(text: string): string {
        return state.borderColor ? hexToAnsi(state.borderColor, text) : super.borderColor(text);
      }
    }

    ctx.ui.setEditorComponent((tui, theme, keybindings) => new RenameEditor(tui, theme, keybindings));
    applyUi(ctx);
  });

  pi.registerCommand("rename", {
    description: "Set a persistent title above the input bar, optionally with a hex border color: /rename 'Title' '#000000'",
    handler: async (rawArgs, ctx) => {
      const args = parseArgs(rawArgs ?? "");
      let title = args[0];
      let color = args[1];

      if (!title) {
        title = await ctx.ui.input("Rename session", "Title to show above the input bar:");
      }

      if (!title) return;

      if (color && !isHexColor(color)) {
        ctx.ui.notify(`Invalid color ${color}. Use #RRGGBB, e.g. #000000.`, "error");
        return;
      }

      state = {
        title,
        borderColor: color ?? state.borderColor,
      };

      pi.setSessionName(title);
      pi.appendEntry(STATE_TYPE, state);
      applyUi(ctx);
      ctx.ui.notify(`Session renamed to ${title}`, "info");
    },
  });

  pi.on("session_shutdown", (_event, ctx) => {
    activeTui = undefined;
    ctx.ui.setWidget(WIDGET_ID, undefined);
    ctx.ui.setEditorComponent(undefined);
  });
}
