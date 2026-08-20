import { createSignal, createEffect } from "solid-js";
import { theme, THEMES, THEME_NAMES, applyTheme, currentThemeName } from "./theme.js";
import { Overlay } from "./overlay.js";
import { describe, RESTART_REQUIRED, NEW_TORRENTS_ONLY, type AppSettings } from "./settings.js";

export const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
const [initialFocus, setInitialFocus] = createSignal<keyof AppSettings | null>(null);

/** Open settings, optionally with the cursor already on a given row. */
export function openSettings(focus?: keyof AppSettings): void {
  setInitialFocus(focus ?? null);
  setIsSettingsOpen(true);
}

interface Field {
  key: keyof AppSettings;
  label: string;
  /** Cycle or step the value. dir is -1 or +1. */
  step: (value: any, dir: number) => any;
  /** Static text, or derived from the current draft. */
  hint: string | ((values: AppSettings) => string);
}

const KB = 1024;

/** Speed limits step through a sensible ladder rather than by a fixed amount. */
const SPEED_STEPS = [0, 50 * KB, 100 * KB, 250 * KB, 500 * KB, 1024 * KB, 2048 * KB, 5120 * KB, 10240 * KB];

/** 0 = let the OS pick; the rest are the conventional BitTorrent ports. */
const PORT_STEPS = [0, 6881, 6882, 6889, 6969, 51413];

function stepThrough<T>(ladder: T[], value: T, dir: number): T {
  const at = ladder.indexOf(value);
  const from = at === -1 ? 0 : at;
  return ladder[Math.max(0, Math.min(ladder.length - 1, from + dir))];
}

/** Exported so tests can assert every stepper is bounded. */
export const FIELDS: Field[] = [
  {
    key: "theme",
    label: "Theme",
    // The hint doubles as the theme's own description, so cycling through
    // them is as informative as a dedicated picker was.
    hint: values => THEMES.find(t => t.name === values.theme)?.description ?? "",
    step: (v, d) => {
      const at = THEME_NAMES.indexOf(v);
      const from = at === -1 ? 0 : at;
      return THEME_NAMES[(from + d + THEME_NAMES.length) % THEME_NAMES.length];
    },
  },
  { key: "downloadLimit", label: "Download limit", hint: "0 = unlimited",
    step: (v, d) => stepThrough(SPEED_STEPS, v, d) },
  { key: "uploadLimit", label: "Upload limit", hint: "0 = unlimited",
    step: (v, d) => stepThrough(SPEED_STEPS, v, d) },
  { key: "maxConns", label: "Max connections", hint: "peers, globally",
    step: (v, d) => Math.max(5, Math.min(500, v + d * 5)) },
  { key: "sequential", label: "Sequential download", hint: "in order - good for streaming",
    step: (v) => !v },
  { key: "seedRatioLimit", label: "Seed ratio limit", hint: "pause after giving back this much",
    // Capped at 10: beyond that it is indistinguishable from "seed forever",
    // which is what 0 already means, and an unbounded stepper never stops.
    step: (v, d) => Math.max(0, Math.min(10, Math.round((v + d * 0.5) * 10) / 10)) },
  { key: "dht", label: "DHT", hint: "peer discovery without trackers", step: (v) => !v },
  { key: "pex", label: "Peer exchange", hint: "learn peers from peers", step: (v) => !v },
  { key: "lsd", label: "Local discovery", hint: "find peers on your LAN", step: (v) => !v },
  { key: "encryption", label: "Encryption", hint: "off / prefer / require",
    step: (v, d) => Math.max(0, Math.min(2, v + d)) },
  { key: "torrentPort", label: "Listen port", hint: "0 = random · edit settings.json for others",
    // A ladder, not a +1 stepper. This panel has no text entry, so stepping
    // by one made any real port ~50,000 key presses away - unreachable in
    // practice. These are the conventional BitTorrent ports; anything else
    // can be set directly in settings.json, which is honest about the limit
    // rather than pretending the whole range is usable here.
    step: (v, d) => stepThrough(PORT_STEPS, v, d) },
  { key: "portForwarding", label: "Port forwarding", hint: "UPnP / NAT-PMP", step: (v) => !v },
];

export interface SettingsPanelProps {
  initial: () => AppSettings;
  onApply: (next: AppSettings) => boolean;
}

/**
 * Settings overlay.
 *
 * Values are stepped with the arrow keys rather than typed: every setting
 * here is an enum, a toggle or a number from a sensible ladder, and free-text
 * entry would mean validating strings that can only ever be wrong.
 *
 * Rendered imperatively (refs + createEffect) like everything else in this
 * app - JSX props are not reactive here, see src/button.tsx.
 */
export function SettingsPanel(props: SettingsPanelProps) {
  const [draft, setDraft] = createSignal<AppSettings | null>(null);
  const [cursor, setCursor] = createSignal(0);
  const [notice, setNotice] = createSignal("");


  /** The theme active when the panel opened, so escape can put it back. */
  const [themeOnOpen, setThemeOnOpen] = createSignal(currentThemeName());

  const open = () => {
    setDraft({ ...props.initial() });
    const focus = initialFocus();
    const index = focus ? FIELDS.findIndex(f => f.key === focus) : 0;
    setCursor(index === -1 ? 0 : index);
    setThemeOnOpen(currentThemeName());
    setNotice("");
  };

  createEffect(() => {
    const visible = isSettingsOpen();
    if (visible && !draft()) open();
    if (!visible) setDraft(null);
  });


  const body = (): string => {
    const values = draft();
    const at = cursor();
    if (!values) return "";
    return FIELDS.map((field, index) => {
      const marker = index === at ? "❯ " : "  ";
      const value = describe(field.key, values[field.key]);
      // When a change takes effect. Silence means "immediately, including
      // torrents already running", which is the majority and needs no label.
      const restart = RESTART_REQUIRED.includes(field.key) ? "  (next launch)"
        : NEW_TORRENTS_ONLY.includes(field.key) ? "  (new torrents)"
        : "";
      const hint = typeof field.hint === "function" ? field.hint(values) : field.hint;
      return marker + field.label.padEnd(20) + value.padEnd(14) + hint + restart;
    }).join("\n");
  };


  /** Returns true if the key was consumed. */
  const handleKey = (name: string): boolean => {
    const values = draft();
    if (!values) return false;

    if (name === "up") { setCursor(c => Math.max(0, c - 1)); return true; }
    if (name === "down") { setCursor(c => Math.min(FIELDS.length - 1, c + 1)); return true; }

    if (name === "left" || name === "right") {
      const field = FIELDS[cursor()];
      const dir = name === "right" ? 1 : -1;
      const stepped = field.step(values[field.key], dir);
      setDraft({ ...values, [field.key]: stepped } as AppSettings);
      // The theme applies as you cycle it: the app IS the preview, which
      // beats describing a palette you cannot see.
      if (field.key === "theme") applyTheme(stepped as string);
      return true;
    }

    if (name === "return" || name === "enter") {
      const needsRestart = props.onApply(values);
      setNotice(needsRestart
        ? "Saved. Network settings marked (next launch) apply when you reopen vi-torrent."
        : "Saved.");
      setTimeout(() => setIsSettingsOpen(false), needsRestart ? 1600 : 500);
      return true;
    }

    if (name === "escape") {
      // Cancelling must undo the live theme preview too, not just the draft.
      if (currentThemeName() !== themeOnOpen()) applyTheme(themeOnOpen());
      setIsSettingsOpen(false);
      return true;
    }
    return false;
  };

  // Exposed so app.tsx can route keys here while the panel is open.
  return (
    <Overlay
      open={isSettingsOpen}
      priority={25}
      onKey={handleKey}
      title={() => "Settings"}
      hint={() => "up/down choose · left/right change · enter save · esc cancel"}
      body={body}
      notice={notice}
      noticeColour={() => theme.success}
      onBodyClick={row => { if (row >= 0 && row < FIELDS.length) setCursor(row); }}
    />
  );
}

