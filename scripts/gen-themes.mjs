// Conversion: the reference opencode fork's 33 TUI theme JSONs -> vi-torrent's Palette shape.
// Kept as the provenance record for THIRD-PARTY-NOTICES.md's attribution note
// (not shipped - not in package.json's "files" allowlist). Re-run with
// `bun scripts/gen-themes.mjs` and diff against src/theme.ts if the reference opencode fork's
// theme roster ever changes.
import fs from "fs";
import path from "path";

const SRC_DIR =
  "C:/Users/vishw/workspace/vitorrent-node/research/opencode-reference-src/packages/opencode/src/cli/cmd/tui/context/theme";

function resolveColor(value, defs, depth = 0) {
  if (depth > 10) throw new Error("defs reference cycle");
  if (value && typeof value === "object" && "dark" in value) value = value.dark;
  if (typeof value !== "string") throw new Error(`unexpected color value: ${JSON.stringify(value)}`);
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) return "#" + [...hex].map((c) => c + c).join(""); // #FFF -> #FFFFFF
    return "#" + hex.slice(0, 6); // drop alpha (#RRGGBBAA -> #RRGGBB)
  }
  if (defs[value] !== undefined) return resolveColor(defs[value], defs, depth + 1);
  return null; // "transparent" / "none" / anything unresolvable - caller supplies a fallback
}

function mix(from, to, amount) {
  const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const ch = (a, b) => Math.round(a + (b - a) * amount).toString(16).padStart(2, "0");
  return "#" + ch(r1, r2) + ch(g1, g2) + ch(b1, b2);
}

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

// Progress must read as green even if the theme's own "success" doesn't
// (e.g. a monochrome theme) - vi-torrent's existing rule, see theme.ts comment.
function greenify(successHex) {
  const { h, s, l } = hexToHsl(successHex);
  const isGreenish = h >= 70 && h <= 165 && s > 0.15;
  return isGreenish ? successHex : "#3FFF6E";
}

const HUE_NAMES = [
  [0, 15, "red"], [15, 45, "orange"], [45, 70, "yellow"], [70, 165, "green"],
  [165, 195, "cyan"], [195, 255, "blue"], [255, 290, "indigo"], [290, 330, "purple"],
  [330, 345, "magenta"], [345, 361, "red"],
];
function hueName(hex) {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.08) return l > 0.6 ? "white" : l < 0.2 ? "black" : "grey";
  for (const [lo, hi, name] of HUE_NAMES) if (h >= lo && h < hi) return name;
  return "grey";
}

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".json"));
const results = [];

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC_DIR, file), "utf8"));
  const defs = raw.defs ?? {};
  const t = raw.theme;
  const R = (key) => resolveColor(t[key], defs);

  const accent = R("primary");
  const accent2 = R("secondary");
  // "background" is "transparent" in a couple of themes (meant to inherit the
  // terminal's own colour) - vi-torrent always paints a real colour, so fall
  // back to the theme's own designated solid panel colour instead of
  // guessing an unrelated hex.
  const background = R("background") ?? R("backgroundMenu") ?? R("backgroundPanel");
  const success = R("success");
  if (!background) throw new Error(`${file}: no resolvable background at all`);

  const name = path.basename(file, ".json");
  const palette = {
    accent,
    accentDim: mix(accent, background, 0.3),
    text: R("text"),
    muted: R("textMuted"),
    border: R("border"),
    borderFocus: R("borderActive"),
    success,
    error: R("error"),
    warning: R("warning"),
    selectionBg: accent,
    selectionFg: background,
    background,
    accent2,
    info: R("accent"), // the fork's third hue field is named "accent"; vi-torrent's role for it is "info"
    progress: greenify(success),
  };

  const bgHue = hueName(background);
  const isLight = hexToHsl(background).l > 0.5;
  const description = `${hueName(accent)} and ${hueName(accent2)} on ${isLight ? "light" : "dark"} ${bgHue === hueName(accent) || bgHue === hueName(accent2) ? "ground" : bgHue}`;

  results.push({ name, description, palette });
}

results.sort((a, b) => a.name.localeCompare(b.name));

const lines = results.map((r) => {
  const p = r.palette;
  return `  {
    name: "${r.name}",
    description: "${r.description}",
    palette: {
      accent: "${p.accent}", accentDim: "${p.accentDim}",
      text: "${p.text}", muted: "${p.muted}",
      border: "${p.border}", borderFocus: "${p.borderFocus}",
      success: "${p.success}", error: "${p.error}", warning: "${p.warning}",
      selectionBg: "${p.selectionBg}", selectionFg: "${p.selectionFg}", background: "${p.background}", progress: "${p.progress}", accent2: "${p.accent2}", info: "${p.info}",
    },
  },`;
});

console.log(`export const THEMES: ThemeSpec[] = [\n${lines.join("\n")}\n];`);
console.log(`\n// ${results.length} themes generated`);
