import { createSignal } from "solid-js";

export interface Palette {
  accent: string;
  accentDim: string;
  text: string;
  muted: string;
  border: string;
  borderFocus: string;
  success: string;
  error: string;
  warning: string;
  selectionBg: string;
  selectionFg: string;
  /** Base surface - used to clear a chip's fill when it is not hovered. */
  background: string;
  /**
   * A SECOND hue, deliberately different from `accent`. Without it a theme is
   * one colour plus greys - the accent drives the logo, headers, buttons and
   * selection, so everything reads as monochrome however many role colours
   * the table uses. `mono` keeps this grey on purpose.
   */
  accent2: string;
  /** A third, cooler hue for secondary data. */
  info: string;
  /**
   * Progress bar fill and edge. Green in EVERY theme on purpose - a progress
   * bar reads as progress because it is green, so this does not reuse
   * `success` (which is greyscale in the mono theme and would leave the bar
   * indistinguishable from its own background).
   */
  progress: string;
}

export interface ThemeSpec {
  name: string;
  description: string;
  palette: Palette;
}

/**
 * Colour themes.
 *
 * Ported wholesale from codemie-opencode's 33 TUI themes (2026-08-09) - see
 * `research/codemie-opencode-src/packages/opencode/src/cli/cmd/tui/context/theme/`
 * for the originals and `scripts/gen-themes.mjs` for the exact field mapping
 * (codemie's `primary`/`secondary`/`accent` -> vi-torrent's `accent`/`accent2`/
 * `info`; `progress` is forced to a real green when a theme's own `success`
 * isn't one, same rule the old `mono` theme needed). This REPLACES vi-torrent's
 * own 12 hand-authored themes, including the Claude-branded default - deliberate,
 * not an oversight. Sorted alphabetically, so the default (THEMES[0]) is `aura`.
 */
export const THEMES: ThemeSpec[] = [
  {
    name: "aura",
    description: "indigo and purple on dark black",
    palette: {
      accent: "#a277ff", accentDim: "#7658b7",
      text: "#edecee", muted: "#6d6d6d",
      border: "#2d2d2d", borderFocus: "#6d6d6d",
      success: "#61ffca", error: "#ff6767", warning: "#ffca85",
      selectionBg: "#a277ff", selectionFg: "#0f0f0f", background: "#0f0f0f", progress: "#61ffca", accent2: "#f694ff", info: "#a277ff",
    },
  },
  {
    name: "ayu",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#59C2FF", accentDim: "#428cb9",
      text: "#BFBDB6", muted: "#565B66",
      border: "#6C7380", borderFocus: "#6C7380",
      success: "#7FD962", error: "#D95757", warning: "#E6B673",
      selectionBg: "#59C2FF", selectionFg: "#0B0E14", background: "#0B0E14", progress: "#7FD962", accent2: "#D2A6FF", info: "#E6B450",
    },
  },
  {
    name: "carbonfox",
    description: "blue and blue on dark black",
    palette: {
      accent: "#33b1ff", accentDim: "#2a83b9",
      text: "#f2f4f8", muted: "#7d848f",
      border: "#303030", borderFocus: "#33b1ff",
      success: "#25be6a", error: "#ee5396", warning: "#f1c21b",
      selectionBg: "#33b1ff", selectionFg: "#161616", background: "#161616", progress: "#25be6a", accent2: "#78a9ff", info: "#ff7eb6",
    },
  },
  {
    name: "catppuccin",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#89b4fa", accentDim: "#6987bd",
      text: "#cdd6f4", muted: "#bac2de",
      border: "#313244", borderFocus: "#45475a",
      success: "#a6e3a1", error: "#f38ba8", warning: "#f9e2af",
      selectionBg: "#89b4fa", selectionFg: "#1e1e2e", background: "#1e1e2e", progress: "#a6e3a1", accent2: "#cba6f7", info: "#f5c2e7",
    },
  },
  {
    name: "catppuccin-frappe",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#8da4e2", accentDim: "#7182b3",
      text: "#c6d0f5", muted: "#b5bfe2",
      border: "#414559", borderFocus: "#51576d",
      success: "#a6d189", error: "#e78284", warning: "#e5c890",
      selectionBg: "#8da4e2", selectionFg: "#303446", background: "#303446", progress: "#a6d189", accent2: "#ca9ee6", info: "#f4b8e4",
    },
  },
  {
    name: "catppuccin-macchiato",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#8aadf4", accentDim: "#6b85bc",
      text: "#cad3f5", muted: "#b8c0e0",
      border: "#363a4f", borderFocus: "#494d64",
      success: "#a6da95", error: "#ed8796", warning: "#eed49f",
      selectionBg: "#8aadf4", selectionFg: "#24273a", background: "#24273a", progress: "#a6da95", accent2: "#c6a0f6", info: "#f5bde6",
    },
  },
  {
    name: "cobalt2",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#0088ff", accentDim: "#086fc8",
      text: "#ffffff", muted: "#adb7c9",
      border: "#1f4662", borderFocus: "#0088ff",
      success: "#9eff80", error: "#ff0088", warning: "#ffc600",
      selectionBg: "#0088ff", selectionFg: "#193549", background: "#193549", progress: "#9eff80", accent2: "#9a5feb", info: "#2affdf",
    },
  },
  {
    name: "cursor",
    description: "cyan and blue on dark black",
    palette: {
      accent: "#88c0d0", accentDim: "#668e99",
      text: "#e4e4e4", muted: "#e4e4e4",
      border: "#e4e4e4", borderFocus: "#88c0d0",
      success: "#3fa266", error: "#e34671", warning: "#f1b467",
      selectionBg: "#88c0d0", selectionFg: "#181818", background: "#181818", progress: "#3fa266", accent2: "#81a1c1", info: "#88c0d0",
    },
  },
  {
    name: "dracula",
    description: "indigo and purple on dark blue",
    palette: {
      accent: "#bd93f9", accentDim: "#9074bf",
      text: "#f8f8f2", muted: "#6272a4",
      border: "#44475a", borderFocus: "#bd93f9",
      success: "#50fa7b", error: "#ff5555", warning: "#f1fa8c",
      selectionBg: "#bd93f9", selectionFg: "#282a36", background: "#282a36", progress: "#50fa7b", accent2: "#ff79c6", info: "#8be9fd",
    },
  },
  {
    name: "everforest",
    description: "green and cyan on dark blue",
    palette: {
      accent: "#a7c080", accentDim: "#82966b",
      text: "#d3c6aa", muted: "#7a8478",
      border: "#859289", borderFocus: "#9da9a0",
      success: "#a7c080", error: "#e67e80", warning: "#e69875",
      selectionBg: "#a7c080", selectionFg: "#2d353b", background: "#2d353b", progress: "#a7c080", accent2: "#7fbbb3", info: "#d699b6",
    },
  },
  {
    name: "flexoki",
    description: "orange and blue on dark black",
    palette: {
      accent: "#DA702C", accentDim: "#9d5323",
      text: "#CECDC3", muted: "#6F6E69",
      border: "#575653", borderFocus: "#6F6E69",
      success: "#879A39", error: "#D14D41", warning: "#DA702C",
      selectionBg: "#DA702C", selectionFg: "#100F0F", background: "#100F0F", progress: "#879A39", accent2: "#4385BE", info: "#8B7EC8",
    },
  },
  {
    name: "github",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#58a6ff", accentDim: "#4279b9",
      text: "#c9d1d9", muted: "#8b949e",
      border: "#30363d", borderFocus: "#58a6ff",
      success: "#3fb950", error: "#f85149", warning: "#e3b341",
      selectionBg: "#58a6ff", selectionFg: "#0d1117", background: "#0d1117", progress: "#3fb950", accent2: "#bc8cff", info: "#39c5cf",
    },
  },
  {
    name: "gruvbox",
    description: "green and magenta on dark black",
    palette: {
      accent: "#83a598", accentDim: "#688076",
      text: "#ebdbb2", muted: "#928374",
      border: "#665c54", borderFocus: "#ebdbb2",
      success: "#b8bb26", error: "#fb4934", warning: "#fe8019",
      selectionBg: "#83a598", selectionFg: "#282828", background: "#282828", progress: "#3FFF6E", accent2: "#d3869b", info: "#8ec07c",
    },
  },
  {
    name: "kanagawa",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#7E9CD8", accentDim: "#6277a3",
      text: "#DCD7BA", muted: "#727169",
      border: "#54546D", borderFocus: "#C38D9D",
      success: "#98BB6C", error: "#E82424", warning: "#D7A657",
      selectionBg: "#7E9CD8", selectionFg: "#1F1F28", background: "#1F1F28", progress: "#98BB6C", accent2: "#957FB8", info: "#D27E99",
    },
  },
  {
    name: "lucent-orng",
    description: "red and orange on dark ground",
    palette: {
      accent: "#EC5B2B", accentDim: "#b24824",
      text: "#eeeeee", muted: "#808080",
      border: "#EC5B2B", borderFocus: "#EE7948",
      success: "#6ba1e6", error: "#e06c75", warning: "#EC5B2B",
      selectionBg: "#EC5B2B", selectionFg: "#2a1a15", background: "#2a1a15", progress: "#3FFF6E", accent2: "#EE7948", info: "#FFF7F1",
    },
  },
  {
    name: "material",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#82aaff", accentDim: "#6686c3",
      text: "#eeffff", muted: "#546e7a",
      border: "#37474f", borderFocus: "#82aaff",
      success: "#c3e88d", error: "#f07178", warning: "#ffcb6b",
      selectionBg: "#82aaff", selectionFg: "#263238", background: "#263238", progress: "#c3e88d", accent2: "#c792ea", info: "#89ddff",
    },
  },
  {
    name: "matrix",
    description: "green and cyan on dark ground",
    palette: {
      accent: "#2eff6a", accentDim: "#23b74d",
      text: "#62ff94", muted: "#8ca391",
      border: "#1e2a1b", borderFocus: "#2eff6a",
      success: "#62ff94", error: "#ff4b4b", warning: "#e6ff57",
      selectionBg: "#2eff6a", selectionFg: "#0a0e0a", background: "#0a0e0a", progress: "#62ff94", accent2: "#00efff", info: "#c770ff",
    },
  },
  {
    name: "mercury",
    description: "blue and blue on dark ground",
    palette: {
      accent: "#8da4f5", accentDim: "#6a7ab5",
      text: "#dddde5", muted: "#9d9da8",
      border: "#b4b7c8", borderFocus: "#8da4f5",
      success: "#77c599", error: "#fc92b4", warning: "#fc9b6f",
      selectionBg: "#8da4f5", selectionFg: "#171721", background: "#171721", progress: "#77c599", accent2: "#a7b6f8", info: "#8da4f5",
    },
  },
  {
    name: "monokai",
    description: "cyan and indigo on dark yellow",
    palette: {
      accent: "#66d9ef", accentDim: "#53a4b2",
      text: "#f8f8f2", muted: "#75715e",
      border: "#3e3d32", borderFocus: "#66d9ef",
      success: "#a6e22e", error: "#f92672", warning: "#e6db74",
      selectionBg: "#66d9ef", selectionFg: "#272822", background: "#272822", progress: "#a6e22e", accent2: "#ae81ff", info: "#a6e22e",
    },
  },
  {
    name: "nightowl",
    description: "blue and cyan on dark ground",
    palette: {
      accent: "#82AAFF", accentDim: "#5b7ebe",
      text: "#d6deeb", muted: "#5f7e97",
      border: "#5f7e97", borderFocus: "#82AAFF",
      success: "#c5e478", error: "#EF5350", warning: "#ecc48d",
      selectionBg: "#82AAFF", selectionFg: "#011627", background: "#011627", progress: "#c5e478", accent2: "#7fdbca", info: "#c792ea",
    },
  },
  {
    name: "nord",
    description: "cyan and blue on dark ground",
    palette: {
      accent: "#88C0D0", accentDim: "#6d96a5",
      text: "#ECEFF4", muted: "#8B95A7",
      border: "#434C5E", borderFocus: "#4C566A",
      success: "#A3BE8C", error: "#BF616A", warning: "#D08770",
      selectionBg: "#88C0D0", selectionFg: "#2E3440", background: "#2E3440", progress: "#A3BE8C", accent2: "#81A1C1", info: "#8FBCBB",
    },
  },
  {
    name: "one-dark",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#61afef", accentDim: "#5088b7",
      text: "#abb2bf", muted: "#5c6370",
      border: "#393f4a", borderFocus: "#61afef",
      success: "#98c379", error: "#e06c75", warning: "#e5c07b",
      selectionBg: "#61afef", selectionFg: "#282c34", background: "#282c34", progress: "#98c379", accent2: "#c678dd", info: "#56b6c2",
    },
  },
  {
    name: "opencode",
    description: "orange and blue on dark black",
    palette: {
      accent: "#fab283", accentDim: "#b2805f",
      text: "#eeeeee", muted: "#808080",
      border: "#484848", borderFocus: "#606060",
      success: "#7fd88f", error: "#e06c75", warning: "#f5a742",
      selectionBg: "#fab283", selectionFg: "#0a0a0a", background: "#0a0a0a", progress: "#7fd88f", accent2: "#5c9cf5", info: "#9d7cd8",
    },
  },
  {
    name: "orng",
    description: "red and orange on dark black",
    palette: {
      accent: "#EC5B2B", accentDim: "#a84321",
      text: "#eeeeee", muted: "#808080",
      border: "#EC5B2B", borderFocus: "#EE7948",
      success: "#6ba1e6", error: "#e06c75", warning: "#EC5B2B",
      selectionBg: "#EC5B2B", selectionFg: "#0a0a0a", background: "#0a0a0a", progress: "#3FFF6E", accent2: "#EE7948", info: "#FFF7F1",
    },
  },
  {
    name: "osaka-jade",
    description: "cyan and magenta on dark green",
    palette: {
      accent: "#2DD5B7", accentDim: "#259e87",
      text: "#C1C497", muted: "#53685B",
      border: "#3d4a44", borderFocus: "#2DD5B7",
      success: "#549e6a", error: "#FF5345", warning: "#E5C736",
      selectionBg: "#2DD5B7", selectionFg: "#111c18", background: "#111c18", progress: "#549e6a", accent2: "#D2689C", info: "#549e6a",
    },
  },
  {
    name: "palenight",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#82aaff", accentDim: "#6785c5",
      text: "#a6accd", muted: "#676e95",
      border: "#32364a", borderFocus: "#82aaff",
      success: "#c3e88d", error: "#f07178", warning: "#ffcb6b",
      selectionBg: "#82aaff", selectionFg: "#292d3e", background: "#292d3e", progress: "#c3e88d", accent2: "#c792ea", info: "#89ddff",
    },
  },
  {
    name: "rosepine",
    description: "cyan and indigo on dark blue",
    palette: {
      accent: "#9ccfd8", accentDim: "#7598a2",
      text: "#e0def4", muted: "#6e6a86",
      border: "#403d52", borderFocus: "#9ccfd8",
      success: "#31748f", error: "#eb6f92", warning: "#f6c177",
      selectionBg: "#9ccfd8", selectionFg: "#191724", background: "#191724", progress: "#3FFF6E", accent2: "#c4a7e7", info: "#ebbcba",
    },
  },
  {
    name: "solarized",
    description: "blue and blue on dark cyan",
    palette: {
      accent: "#268bd2", accentDim: "#1b6ea3",
      text: "#839496", muted: "#586e75",
      border: "#073642", borderFocus: "#586e75",
      success: "#859900", error: "#dc322f", warning: "#b58900",
      selectionBg: "#268bd2", selectionFg: "#002b36", background: "#002b36", progress: "#3FFF6E", accent2: "#6c71c4", info: "#2aa198",
    },
  },
  {
    name: "synthwave84",
    description: "cyan and purple on dark blue",
    palette: {
      accent: "#36f9f6", accentDim: "#31b9bc",
      text: "#ffffff", muted: "#848bbd",
      border: "#495495", borderFocus: "#36f9f6",
      success: "#72f1b8", error: "#fe4450", warning: "#fede5d",
      selectionBg: "#36f9f6", selectionFg: "#262335", background: "#262335", progress: "#72f1b8", accent2: "#ff7edb", info: "#b084eb",
    },
  },
  {
    name: "tokyonight",
    description: "blue and indigo on dark ground",
    palette: {
      accent: "#82aaff", accentDim: "#637fbe",
      text: "#c8d3f5", muted: "#828bb8",
      border: "#737aa2", borderFocus: "#9099b2",
      success: "#c3e88d", error: "#ff757f", warning: "#ff966c",
      selectionBg: "#82aaff", selectionFg: "#1a1b26", background: "#1a1b26", progress: "#c3e88d", accent2: "#c099ff", info: "#ff966c",
    },
  },
  {
    name: "vercel",
    description: "blue and blue on dark black",
    palette: {
      accent: "#0070F3", accentDim: "#004eaa",
      text: "#EDEDED", muted: "#878787",
      border: "#1F1F1F", borderFocus: "#454545",
      success: "#46A758", error: "#E5484D", warning: "#FFB224",
      selectionBg: "#0070F3", selectionFg: "#000000", background: "#000000", progress: "#46A758", accent2: "#52A8FF", info: "#8E4EC6",
    },
  },
  {
    name: "vesper",
    description: "orange and green on dark black",
    palette: {
      accent: "#FFC799", accentDim: "#b79070",
      text: "#FFFFFF", muted: "#A0A0A0",
      border: "#282828", borderFocus: "#FFC799",
      success: "#99FFE4", error: "#FF8080", warning: "#FFC799",
      selectionBg: "#FFC799", selectionFg: "#101010", background: "#101010", progress: "#99FFE4", accent2: "#99FFE4", info: "#FFC799",
    },
  },
  {
    name: "zenburn",
    description: "cyan and purple on dark grey",
    palette: {
      accent: "#8cd0d3", accentDim: "#75a5a7",
      text: "#dcdccc", muted: "#9f9f9f",
      border: "#5f5f5f", borderFocus: "#8cd0d3",
      success: "#7f9f7f", error: "#cc9393", warning: "#f0dfaf",
      selectionBg: "#8cd0d3", selectionFg: "#3f3f3f", background: "#3f3f3f", progress: "#3FFF6E", accent2: "#dc8cc3", info: "#93e0e3",
    },
  },
];

export const THEME_NAMES = THEMES.map(t => t.name);

/**
 * The live palette.
 *
 * Deliberately a MUTABLE object that is never reassigned: every module does
 * `import { theme }` and holds the same reference, so copying a new palette
 * over it updates all of them at once. Reassigning the export instead would
 * leave every importer pointing at the old object.
 */
export const theme: Palette = { ...THEMES[0].palette };

const [themeVersion, setThemeVersion] = createSignal(0);
/**
 * Bumped whenever the palette changes. Colours are applied imperatively all
 * over this app (JSX props are not reactive here - see button.tsx), so the
 * effects that paint them read this to know they must run again.
 */
export { themeVersion };

export function currentThemeName(): string {
  return activeName;
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const ch = (a: number, b: number) =>
    Math.round(a + (b - a) * amount).toString(16).padStart(2, "0");
  return "#" + ch(r1, r2) + ch(g1, g2) + ch(b1, b2);
}

/**
 * Secondary text that is actually legible.
 *
 * `muted` is tuned to sit back visually, and in most of these palettes it sits
 * back too far to READ: measured against their own backgrounds, ten of the
 * eleven fall under the 4.5:1 WCAG AA threshold - tokyo worst at 2.76:1. Rather
 * than hand-tune every palette, `muted` is lifted towards `text` until it
 * clears the threshold. Use this for anything the user has to read;
 * `theme.muted` remains right for things they only need to perceive, like an
 * unselected radio or the empty half of a progress bar.
 */
function computeDim(palette: Palette): string {
  let colour = palette.muted;
  for (let step = 0; step <= 20; step++) {
    if (contrastRatio(colour, palette.background) >= 4.5) return colour;
    colour = mix(palette.muted, palette.text, step / 20);
  }
  return palette.text; // last resort: guaranteed readable
}

let dimCache = computeDim(theme);

/** Readable secondary-text colour for the active theme. */
export function dimText(): string {
  return dimCache;
}

let activeName = THEMES[0].name;

/** Returns false if the name is not a known theme. */
export function applyTheme(name: string): boolean {
  const found = THEMES.find(t => t.name === name.trim().toLowerCase());
  if (!found) return false;
  Object.assign(theme, found.palette);
  activeName = found.name;
  dimCache = computeDim(theme);
  setThemeVersion(v => v + 1);
  return true;
}

export interface CommandSpec {
  name: string;
  args?: string;
  description: string;
  category: string;
}

/**
 * Single source of truth for commands - drives the inline autocomplete,
 * the ctrl+p palette, and the header hint, so they cannot drift apart.
 */
export const COMMANDS: CommandSpec[] = [
  { name: "/add-magnet", args: "<uri>", description: "Add a torrent from a magnet link", category: "Torrents" },
  { name: "/add-file", args: "<path>", description: "Add a torrent from a .torrent file", category: "Torrents" },
  { name: "/pause", args: "[id]", description: "Pause ticked (or given) torrents", category: "Torrents" },
  { name: "/resume", args: "[id]", description: "Resume ticked (or given) torrents", category: "Torrents" },
  { name: "/remove", args: "[id]", description: "Remove ticked (or given) torrents", category: "Torrents" },
  // The command-input always has focus, so the space bar belongs to it and
  // cannot double as a tick. These are the keyboard route to what clicking a
  // row and the All/None buttons do with a mouse.
  { name: "/select-all", description: "Tick every torrent for a bulk action", category: "Torrents" },
  { name: "/select-none", description: "Clear all ticks", category: "Torrents" },
  { name: "/details", description: "Files and peers for the selected torrent", category: "Torrents" },
  { name: "/theme", args: "[name]", description: "Change the colour theme", category: "Appearance" },
  { name: "/settings", description: "Open settings", category: "System" },
  // Deliberately armed rather than immediate: this stops every download in
  // every window watching the daemon, not just this one. Type it twice (or
  // click the matching button twice) to confirm - same armed state either
  // way, so arming with one and confirming with the other both work.
  { name: "/shutdown-daemon", description: "Stop the daemon and close this window - type twice to confirm", category: "System" },
  // A toggle, not an arm-then-confirm action like the one above: this does
  // not fire anything itself, only schedules a future check, so it is
  // freely and safely reversible by typing it again.
  { name: "/shutdown-when-done", description: "Toggle: stop the daemon once every torrent finishes", category: "System" },
  { name: "/quit", description: "Exit vi-torrent", category: "System" },
];

export function matchCommands(input: string): CommandSpec[] {
  if (!input.startsWith("/")) return [];
  const typed = input.split(" ")[0].toLowerCase();
  // Once a full command plus an argument is typed, stop suggesting.
  if (input.includes(" ") && COMMANDS.some(c => c.name === typed)) return [];
  return COMMANDS.filter(c => c.name.toLowerCase().startsWith(typed));
}
