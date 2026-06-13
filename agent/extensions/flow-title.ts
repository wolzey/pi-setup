import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const DEEP_BLUE: Rgb = [22, 83, 189];
const BLUE: Rgb = [48, 129, 247];
const SKY: Rgb = [93, 171, 255];
const ICE: Rgb = [151, 205, 255];
const PALETTE: Rgb[] = [DEEP_BLUE, BLUE, SKY, ICE, SKY, BLUE];

type Rgb = [number, number, number];
type Renderable = {
  render(width: number): string[];
  invalidate?: () => void;
};
type RenderableContainer = Renderable & { children: Renderable[] };
type TuiLike = RenderableContainer & { requestRender(force?: boolean): void };

const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const TITLE_LINES = [
  "  ██████╗  ██╗ ",
  "  ██╔══██╗ ██║ ",
  "  ██████╔╝ ██║ ",
  "  ██╔═══╝  ██║ ",
  "  ██║      ██║ ",
  "  ╚═╝      ╚═╝ ",
];

const DEFAULT_AVATAR: AgentFactoryAvatar = {
  skinTone: "#ffcc99",
  hairColor: "#332211",
  shirtColor: "#4a90d9",
  pantsColor: "#2a2a3e",
  shoeColor: "#222222",
  faceAccessory: 0,
  headAccessory: 0,
  facialHair: 0,
};

type AgentFactoryAvatar = {
  spriteIndex?: number;
  color?: string;
  hairStyle?: number;
  skinTone?: string;
  hairColor?: string;
  shirtColor?: string;
  pantsColor?: string;
  shoeColor?: string;
  faceAccessory?: number;
  headAccessory?: number;
  facialHair?: number;
  mouthStyle?: number;
  shirtDesign?: number;
};

function mix(a: number, b: number, t: number) {
  return Math.round(a + (b - a) * t);
}

function sampleGradient(position: number) {
  const wrapped = ((position % 1) + 1) % 1;
  const scaled = wrapped * PALETTE.length;
  const index = Math.floor(scaled);
  const nextIndex = (index + 1) % PALETTE.length;
  const t = scaled - index;
  const a = PALETTE[index]!;
  const b = PALETTE[nextIndex]!;
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)] as Rgb;
}

function fg([r, g, b]: Rgb, text: string) {
  return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

function hexToRgb(hex: string | undefined, fallback: Rgb): Rgb {
  const value = hex?.replace("#", "");
  if (!value || !/^[0-9a-fA-F]{6}$/.test(value)) return fallback;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function loadAgentFactoryAvatar(): AgentFactoryAvatar {
  try {
    const configPath = path.join(os.homedir(), ".config", "agent-factory", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { ...DEFAULT_AVATAR, ...(isRecord(config) && isRecord(config.avatar) ? config.avatar : {}) };
  } catch {
    return DEFAULT_AVATAR;
  }
}

function cssToRgb(color: string | undefined, fallback: Rgb): Rgb {
  if (!color) return fallback;
  if (color.startsWith("#")) return hexToRgb(color, fallback);
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return fallback;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

class PixelCanvas {
  readonly pixels: Array<Array<Rgb | undefined>>;
  fillStyle = "#000000";

  constructor(readonly width: number, readonly height: number) {
    this.pixels = Array.from({ length: height }, () => Array<Rgb | undefined>(width));
  }

  fillRect(x: number, y: number, w: number, h: number) {
    const color = cssToRgb(this.fillStyle, [0, 0, 0]);
    for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(this.height, Math.floor(y + h)); yy++) {
      for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(this.width, Math.floor(x + w)); xx++) {
        this.pixels[yy]![xx] = color;
      }
    }
  }
}

function renderAvatar(avatar: AgentFactoryAvatar) {
  const spriteIdx = avatar.spriteIndex ?? 0;
  const skinColor = avatar.skinTone ?? "#ffcc99";
  const hairColor = avatar.hairColor ?? "#332211";
  const shirtColor = avatar.shirtColor ?? avatar.color ?? "#4a90d9";
  const pantsColor = avatar.pantsColor ?? "#2a2a3e";
  const shoeColor = avatar.shoeColor ?? "#222222";
  const shirt = hexToRgb(shirtColor, [74, 144, 217]);
  const dark = `rgb(${Math.floor(shirt[0] * 0.6)}, ${Math.floor(shirt[1] * 0.6)}, ${Math.floor(shirt[2] * 0.6)})`;
  const light = `rgb(${Math.min(255, shirt[0] + 40)}, ${Math.min(255, shirt[1] + 40)}, ${Math.min(255, shirt[2] + 40)})`;
  const ctx = new PixelCanvas(32, 32);
  const x = 0;
  const y = 0;
  const b = 0;

  ctx.fillStyle = skinColor;
  ctx.fillRect(x + 11, y + 4, 10, 10);
  ctx.fillRect(x + 10, y + 5, 12, 8);
  ctx.fillRect(x + 9, y + 7, 1, 3);
  ctx.fillRect(x + 22, y + 7, 1, 3);

  ctx.fillStyle = hairColor;
  switch (avatar.hairStyle ?? (spriteIdx % 8)) {
    case 3:
    case 7:
      ctx.fillStyle = shirtColor; ctx.fillRect(x + 8, y + 4, 16, 4); ctx.fillRect(x + 6, y + 6, 20, 2); break;
    case 6:
      ctx.fillRect(x + 8, y + 2, 16, 8); ctx.fillRect(x + 6, y + 4, 2, 4); ctx.fillRect(x + 24, y + 4, 2, 4); break;
    case 5:
      break;
    default:
      ctx.fillRect(x + 10, y + 4, 12, 4); ctx.fillRect(x + 9, y + 5, 1, 3); ctx.fillRect(x + 22, y + 5, 1, 3);
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + 12, y + 8, 3, 3);
  ctx.fillRect(x + 18, y + 8, 3, 3);
  ctx.fillStyle = "#4466aa";
  ctx.fillRect(x + 13, y + 8, 2, 3);
  ctx.fillRect(x + 19, y + 8, 2, 3);
  ctx.fillStyle = "#000000";
  ctx.fillRect(x + 13, y + 9, 2, 1);
  ctx.fillRect(x + 19, y + 9, 2, 1);

  if (avatar.faceAccessory === 2) {
    ctx.fillStyle = "#111111";
    ctx.fillRect(x + 10, y + 8, 5, 3);
    ctx.fillRect(x + 17, y + 8, 5, 3);
    ctx.fillStyle = "#333333";
    ctx.fillRect(x + 15, y + 8, 2, 1);
  } else if (avatar.faceAccessory === 1) {
    ctx.fillStyle = "#666666";
    ctx.fillRect(x + 10, y + 7, 5, 1); ctx.fillRect(x + 10, y + 11, 5, 1); ctx.fillRect(x + 10, y + 8, 1, 3); ctx.fillRect(x + 14, y + 8, 1, 3);
    ctx.fillRect(x + 17, y + 7, 5, 1); ctx.fillRect(x + 17, y + 11, 5, 1); ctx.fillRect(x + 17, y + 8, 1, 3); ctx.fillRect(x + 21, y + 8, 1, 3);
    ctx.fillRect(x + 14, y + 8, 3, 1);
  }

  if ((avatar.facialHair ?? 0) === 1) {
    ctx.fillStyle = hairColor;
    ctx.fillRect(x + 12, y + 12, 1, 1); ctx.fillRect(x + 14, y + 13, 1, 1); ctx.fillRect(x + 17, y + 13, 1, 1); ctx.fillRect(x + 19, y + 12, 1, 1); ctx.fillRect(x + 16, y + 12, 1, 1);
  }

  if (avatar.headAccessory === 6) {
    ctx.fillStyle = "#22aa22"; ctx.fillRect(x + 21, y + 6 + b, 1, 3);
    ctx.fillStyle = "#ff69b4"; ctx.fillRect(x + 20, y + 4 + b, 3, 1); ctx.fillRect(x + 20, y + 8 + b, 3, 1); ctx.fillRect(x + 19, y + 5 + b, 1, 3); ctx.fillRect(x + 23, y + 5 + b, 1, 3);
    ctx.fillStyle = "#ffff00"; ctx.fillRect(x + 20, y + 5 + b, 3, 3);
  }

  ctx.fillStyle = skinColor; ctx.fillRect(x + 14, y + 14, 4, 2);
  ctx.fillStyle = shirtColor; ctx.fillRect(x + 8, y + 15, 16, 8);
  ctx.fillStyle = dark; ctx.fillRect(x + 22, y + 15, 2, 8);
  ctx.fillStyle = light; ctx.fillRect(x + 8, y + 16, 1, 4); ctx.fillRect(x + 12, y + 15, 8, 1);
  if (avatar.shirtDesign === 9) {
    ctx.fillStyle = "#ffff00";
    ctx.fillRect(x + 16, y + 16, 3, 1); ctx.fillRect(x + 15, y + 17, 3, 1); ctx.fillRect(x + 14, y + 18, 3, 1); ctx.fillRect(x + 15, y + 19, 3, 1); ctx.fillRect(x + 16, y + 20, 3, 1); ctx.fillRect(x + 15, y + 21, 3, 1);
  }
  ctx.fillStyle = "#443322"; ctx.fillRect(x + 8, y + 22, 16, 1);
  ctx.fillStyle = pantsColor; ctx.fillRect(x + 8, y + 23, 16, 4); ctx.fillRect(x + 10, y + 27, 4, 3); ctx.fillRect(x + 18, y + 27, 4, 3);
  ctx.fillStyle = dark; ctx.fillRect(x + 5, y + 16, 4, 6); ctx.fillRect(x + 23, y + 16, 4, 6);
  ctx.fillStyle = skinColor; ctx.fillRect(x + 5, y + 21, 3, 2); ctx.fillRect(x + 24, y + 21, 3, 2);
  ctx.fillStyle = shoeColor; ctx.fillRect(x + 9, y + 30, 5, 2); ctx.fillRect(x + 17, y + 30, 5, 2);

  const lines: string[] = [];
  for (let py = 2; py < 32; py += 2) {
    let line = "";
    for (let px = 5; px < 27; px++) {
      const upper = ctx.pixels[py]?.[px];
      const lower = ctx.pixels[py + 1]?.[px];
      if (upper && lower) line += `\x1b[38;2;${upper[0]};${upper[1]};${upper[2]}m\x1b[48;2;${lower[0]};${lower[1]};${lower[2]}m▀${RESET}`;
      else if (upper) line += fg(upper, "▀");
      else if (lower) line += fg(lower, "▄");
      else line += " ";
    }
    lines.push(line.replace(/\s+$/g, ""));
  }
  return lines;
}

function visualLength(text: string) {
  return [...withoutAnsi(text)].length;
}

function padRight(text: string, width: number) {
  return text + " ".repeat(Math.max(0, width - visualLength(text)));
}

function composeTitleWithAvatar(titleLines: string[], avatarLines: string[], width: number) {
  const titleWidth = Math.max(...titleLines.map(visualLength));
  const avatarWidth = Math.max(...avatarLines.map(visualLength));
  const gap = 4;
  const combinedWidth = titleWidth + gap + avatarWidth;

  if (width < combinedWidth + 2) {
    return titleLines.map((line) => center(line, width));
  }

  const leftPad = Math.max(0, Math.floor((width - combinedWidth) / 2));
  const topPad = Math.max(0, Math.floor((avatarLines.length - titleLines.length) / 2));
  const lines: string[] = [];

  for (let index = 0; index < Math.max(titleLines.length + topPad, avatarLines.length); index++) {
    const title = index >= topPad && index - topPad < titleLines.length
      ? titleLines[index - topPad]!
      : "";
    const avatar = avatarLines[index] ?? "";
    lines.push(`${" ".repeat(leftPad)}${padRight(title, titleWidth)}${" ".repeat(gap)}${padRight(avatar, avatarWidth)}`);
  }

  return lines;
}

function gradientText(text: string, phase: number) {
  const chars = [...text];
  const span = Math.max(chars.length - 1, 1);
  return chars
    .map((char, index) => {
      if (char === " ") return char;
      return fg(sampleGradient(index / span + phase), char);
    })
    .join("");
}

function center(text: string, width: number) {
  const length = [...text].length;
  if (length >= width) return text;
  return `${" ".repeat(Math.floor((width - length) / 2))}${text}`;
}

function projectName() {
  return path.basename(process.cwd()) || "session";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRenderable(value: unknown): value is Renderable {
  return isRecord(value) && typeof value.render === "function";
}

function isRenderableContainer(value: unknown): value is RenderableContainer {
  return isRenderable(value) && Array.isArray(value.render);
}

function withoutAnsi(text: string) {
  return text.replace(ANSI_PATTERN, "");
}

function renderedText(component: Renderable) {
  try {
    return withoutAnsi(component.render(120).join("\n"));
  } catch {
    return "";
  }
}

function hasSectionHeader(text: string, header: string) {
  return text.split("\n").some((line) => line.trim() === header);
}

function isHiddenStartupListing(component: Renderable) {
  const text = renderedText(component);
  const isThemesListing =
    hasSectionHeader(text, "[Themes]") &&
    (text.includes("/themes/") || text.includes(".pi/agent/themes"));
  const isExtensionsListing =
    hasSectionHeader(text, "[Extensions]") &&
    (text.includes("/extensions/") || text.includes(".pi/agent/extensions"));

  return isThemesListing || isExtensionsListing;
}

function isBlankSpacer(component: Renderable) {
  return renderedText(component).trim() === "";
}

function renderHeader(width: number, phase: number, subtitleText: string, avatar: AgentFactoryAvatar) {
  const titleLines = TITLE_LINES.map((line, row) =>
    gradientText(line, phase + row * 0.045),
  );
  const lines = composeTitleWithAvatar(titleLines, renderAvatar(avatar), width);
  const subtitle = center(subtitleText, width);

  return [
    "",
    ...lines,
    `${BOLD}${gradientText(subtitle, phase + 0.18)}${RESET}`,
    "",
  ];
}

export default function (pi: ExtensionAPI) {
  let requestRender: (() => void) | undefined;
  let currentModelId = "no model selected";
  let avatar = loadAgentFactoryAvatar();

  function installHeader(ctx: ExtensionContext) {
    ctx.ui.setHeader((tui: TuiLike) => {
      requestRender = () => tui.requestRender();
      return {
        render(width: number) {
          return renderHeader(width, 0, `${currentModelId} · ${projectName()}`, avatar);
        },
        invalidate() {
          tui.requestRender();
        },
      };
    });
  }

  pi.on("session_start", (_event, ctx) => {
    currentModelId = ctx.model?.id ?? "no model selected";
    if (!ctx.hasUI) return;
    installHeader(ctx);
  });

  pi.on("model_select", (event) => {
    currentModelId = event.model.id;
    requestRender?.();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setHeader(undefined);
  });

  pi.registerCommand("flow-title", {
    description: "Enable the blue flowing gradient session header",
    handler: async (_args, ctx) => {
      avatar = loadAgentFactoryAvatar();
      installHeader(ctx);
      ctx.ui.notify("Flow title enabled", "info");
    },
  });

  pi.registerCommand("flow-title-builtin", {
    description: "Restore pi's built-in header for this session",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
