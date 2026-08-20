import { createEffect, onCleanup } from "solid-js";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { theme, themeVersion, dimText } from "./theme.js";

/**
 * The shared frame behind the Settings, Details and Add dialogs.
 *
 * All three had the same skeleton copied out: an absolute bordered box, a
 * title, a hint line, a body, a notice line, and a themeVersion effect
 * repainting the lot. Only the CONTENT differed. This owns the frame; panels
 * supply strings.
 *
 * It also owns key routing. Each overlay registers its handler with a
 * priority, so app.tsx asks one question - "is an overlay open, and does it
 * want this key?" - instead of maintaining an if-chain, and the panels drop
 * the `(Panel as any).handleKey` hack they each carried.
 */
interface Registration {
  priority: number;
  isOpen: () => boolean;
  onKey: (key: string) => boolean;
}

const registry: Registration[] = [];

/** Highest-priority open overlay, if any. */
function active(): Registration | undefined {
  return registry
    .filter(r => r.isOpen())
    .sort((a, b) => b.priority - a.priority)[0];
}

export function anyOverlayOpen(): boolean {
  return active() !== undefined;
}

/** Route a key to the open overlay. undefined = no overlay wanted it. */
export function overlayKey(key: string): boolean | undefined {
  const target = active();
  return target ? target.onKey(key) : undefined;
}

export interface OverlayProps {
  open: () => boolean;
  /** Higher wins when more than one is open. */
  priority: number;
  onKey: (key: string) => boolean;
  title: () => string;
  /** Optional second line under the title - the Add dialog's swarm counts. */
  subtitle?: () => { text: string; colour: string };
  hint: () => string;
  body: () => string;
  notice: () => string;
  /** Notice colour - Settings reports success in green, others errors in red. */
  noticeColour?: () => string;
  /** Clicked line, relative to the first line of the body. */
  onBodyClick?: (row: number) => void;
  /** Buttons, usually. */
  children?: unknown;
  top?: string;
  left?: string;
  width?: string;
  zIndex?: number;
}

export function Overlay(props: OverlayProps) {
  const renderer = useRenderer() as any;
  let boxRef: BoxRenderable | undefined;
  let titleRef: TextRenderable | undefined;
  let subtitleRef: TextRenderable | undefined;
  let hintRef: TextRenderable | undefined;
  let bodyRef: TextRenderable | undefined;
  let noticeRef: TextRenderable | undefined;

  const registration: Registration = {
    priority: props.priority,
    isOpen: () => props.open(),
    onKey: key => props.onKey(key),
  };
  registry.push(registration);
  onCleanup(() => {
    const at = registry.indexOf(registration);
    if (at >= 0) registry.splice(at, 1);
  });

  createEffect(() => {
    if (boxRef) boxRef.visible = props.open();
  });

  createEffect(() => {
    themeVersion();
    if (!props.open()) return;

    if (boxRef) {
      boxRef.borderColor = theme.accent;
      // Without an explicit background the overlay is transparent and the
      // torrent table shows straight through it.
      boxRef.backgroundColor = theme.background;
    }
    if (titleRef) {
      titleRef.content = props.title();
      titleRef.fg = theme.accent2;
    }
    if (subtitleRef) {
      const sub = props.subtitle?.();
      subtitleRef.content = sub?.text ?? "";
      subtitleRef.fg = sub?.colour ?? dimText();
      subtitleRef.visible = !!sub?.text;
    }
    if (hintRef) {
      hintRef.content = props.hint();
      hintRef.fg = dimText();
    }
    if (bodyRef) {
      bodyRef.content = props.body();
      bodyRef.fg = theme.text;
    }
    if (noticeRef) {
      const message = props.notice();
      noticeRef.content = message;
      noticeRef.fg = props.noticeColour?.() ?? theme.error;
      noticeRef.visible = !!message;
    }

    // Setting .content marks the renderable dirty but does not schedule a
    // frame. Without this the screen only caught up on the app's 1s refresh,
    // so a keystroke in any dialog - ticking a checkbox, moving the cursor -
    // could sit invisible for up to a second and read as a dropped key.
    try {
      renderer?.requestRender?.();
    } catch {
      // Cosmetic: never let a repaint request break a dialog.
    }
  });

  return (
    <box
      ref={(el: BoxRenderable) => { boxRef = el; el.visible = false; }}
      position="absolute"
      top={props.top ?? "8%"}
      left={props.left ?? "6%"}
      width={props.width ?? "88%"}
      border={true}
      borderStyle="rounded"
      flexDirection="column"
      padding={1}
      zIndex={props.zIndex ?? 200}
    >
      <text ref={(el: TextRenderable) => (titleRef = el)} />
      <text ref={(el: TextRenderable) => { subtitleRef = el; el.visible = false; }} />
      <text ref={(el: TextRenderable) => (hintRef = el)} marginBottom={1} />
      <text
        ref={(el: TextRenderable) => (bodyRef = el)}
        onMouseDown={(event: { y: number }) =>
          props.onBodyClick?.(event.y - (bodyRef?.screenY ?? 0))}
      />
      <text
        ref={(el: TextRenderable) => { noticeRef = el; el.visible = false; }}
        marginTop={1}
      />
      {props.children}
    </box>
  );
}
