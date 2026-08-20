// Archived 2026-08-09. The 12 hand-authored themes vi-torrent shipped with
// before the codemie-opencode replacement, including the Claude-branded
// default ("claude" - terracotta, matched to Claude Code's own accent since
// Claude Code stores no theme to read from). Superseded by the 33 themes
// ported from codemie-opencode in src/theme.ts - see this folder's README.

export const OLD_THEMES = [
  {
    name: "claude",
    description: "Terracotta coral on warm black",
    palette: {
      accent: "#D97757", accentDim: "#A85C42",
      text: "#E8E6E3", muted: "#8A8580",
      border: "#3A3733", borderFocus: "#D97757",
      success: "#7FB069", error: "#E06C75", warning: "#E5C07B",
      selectionBg: "#D97757", selectionFg: "#1A1815", background: "#1A1815", progress: "#7FB069", accent2: "#5FB3A1", info: "#6BA6D9",
    },
  },
  {
    name: "nord",
    description: "Cool arctic blues",
    palette: {
      accent: "#88C0D0", accentDim: "#5E81AC",
      text: "#ECEFF4", muted: "#7B88A1",
      border: "#3B4252", borderFocus: "#88C0D0",
      success: "#A3BE8C", error: "#BF616A", warning: "#EBCB8B",
      selectionBg: "#88C0D0", selectionFg: "#2E3440", background: "#2E3440", progress: "#A3BE8C", accent2: "#B48EAD", info: "#81A1C1",
    },
  },
  {
    name: "gruvbox",
    description: "Warm retro orange",
    palette: {
      accent: "#FE8019", accentDim: "#D65D0E",
      text: "#EBDBB2", muted: "#928374",
      border: "#504945", borderFocus: "#FE8019",
      success: "#B8BB26", error: "#FB4934", warning: "#FABD2F",
      selectionBg: "#FE8019", selectionFg: "#282828", background: "#282828", progress: "#B8BB26", accent2: "#83A598", info: "#8EC07C",
    },
  },
  {
    name: "dracula",
    description: "Purple and pink on deep grey",
    palette: {
      accent: "#BD93F9", accentDim: "#6272A4",
      text: "#F8F8F2", muted: "#6272A4",
      border: "#44475A", borderFocus: "#BD93F9",
      success: "#50FA7B", error: "#FF5555", warning: "#F1FA8C",
      selectionBg: "#BD93F9", selectionFg: "#282A36", background: "#282A36", progress: "#50FA7B", accent2: "#8BE9FD", info: "#FF79C6",
    },
  },
  {
    name: "matrix",
    description: "Green phosphor",
    palette: {
      accent: "#00FF41", accentDim: "#008F11",
      text: "#C8FFC8", muted: "#4E7A4E",
      border: "#123312", borderFocus: "#00FF41",
      success: "#00FF41", error: "#FF5555", warning: "#B8FF00",
      selectionBg: "#00FF41", selectionFg: "#001100", background: "#0B0F0B", progress: "#00FF41", accent2: "#B8FF00", info: "#7CFFB2",
    },
  },
  {
    name: "tokyo",
    description: "Tokyo Night - blue, purple and cyan",
    palette: {
      accent: "#7AA2F7", accentDim: "#3D59A1",
      text: "#C0CAF5", muted: "#565F89",
      border: "#292E42", borderFocus: "#7AA2F7",
      success: "#9ECE6A", error: "#F7768E", warning: "#E0AF68",
      selectionBg: "#7AA2F7", selectionFg: "#1A1B26", background: "#1A1B26",
      progress: "#9ECE6A", accent2: "#BB9AF7", info: "#7DCFFF",
    },
  },
  {
    name: "catppuccin",
    description: "Mauve, peach and pink on mocha",
    palette: {
      accent: "#CBA6F7", accentDim: "#8839EF",
      text: "#CDD6F4", muted: "#7F849C",
      border: "#313244", borderFocus: "#CBA6F7",
      success: "#A6E3A1", error: "#F38BA8", warning: "#FAB387",
      selectionBg: "#CBA6F7", selectionFg: "#1E1E2E", background: "#1E1E2E",
      progress: "#A6E3A1", accent2: "#F5C2E7", info: "#89B4FA",
    },
  },
  {
    name: "solarized",
    description: "Solarized dark - teal base, amber accent",
    palette: {
      accent: "#B58900", accentDim: "#856000",
      text: "#93A1A1", muted: "#586E75",
      border: "#073642", borderFocus: "#B58900",
      success: "#859900", error: "#DC322F", warning: "#CB4B16",
      selectionBg: "#B58900", selectionFg: "#002B36", background: "#002B36",
      progress: "#859900", accent2: "#2AA198", info: "#268BD2",
    },
  },
  {
    name: "light",
    description: "Light background, blue accent",
    palette: {
      accent: "#325CC0", accentDim: "#6B8DD6",
      text: "#000000", muted: "#787878",
      border: "#9E9E9E", borderFocus: "#325CC0",
      success: "#3E8024", error: "#D13E23", warning: "#A16400",
      selectionBg: "#325CC0", selectionFg: "#F7F7F7", background: "#F7F7F7",
      progress: "#3E8024", accent2: "#7B3FB5", info: "#0075C4",
    },
  },
  {
    name: "darkplus",
    description: "Editor syntax colours - violet, gold and sky",
    palette: {
      accent: "#C586C0", accentDim: "#9B6A96",
      text: "#D4D4D4", muted: "#808080",
      border: "#3C3C3C", borderFocus: "#C586C0",
      success: "#6A9955", error: "#F44747", warning: "#CE9178",
      selectionBg: "#C586C0", selectionFg: "#1E1E1E", background: "#1E1E1E",
      progress: "#89D185", accent2: "#DCDCAA", info: "#9CDCFE",
    },
  },
  {
    name: "neon",
    description: "Neon green, red, yellow and orange on near-black",
    palette: {
      accent: "#3FFF6E", accentDim: "#1F9E42",
      text: "#FFFFFF", muted: "#7A8290",
      border: "#2A2F3A", borderFocus: "#3FFF6E",
      success: "#3FFF6E", error: "#FF4D4D", warning: "#FFC53D",
      selectionBg: "#3FFF6E", selectionFg: "#0D1117", background: "#0D1117",
      progress: "#3FFF6E", accent2: "#FF9E2C", info: "#FFE95C",
    },
  },
  {
    name: "mono",
    description: "Greyscale, errors still red",
    palette: {
      accent: "#E8E6E3", accentDim: "#8A8580",
      text: "#E8E6E3", muted: "#6E6A66",
      border: "#3A3733", borderFocus: "#E8E6E3",
      success: "#C8C6C3", error: "#FF8080", warning: "#D8D4C8",
      selectionBg: "#E8E6E3", selectionFg: "#1A1815", background: "#1A1815", progress: "#6FCF6F", accent2: "#B8B4AF", info: "#9A968F",
    },
  },
];
