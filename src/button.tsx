import { createSignal, createEffect } from "solid-js";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { theme, themeVersion } from "./theme.js";

export interface ButtonProps {
  label: () => string;
  onPress: () => void;
  /** Greyed out and unclickable while this returns true. */
  disabled?: () => boolean;
  /** "danger" paints the button red - used for the armed delete confirm. */
  tone?: () => "normal" | "danger";
}

/**
 * A clickable label chip.
 *
 * Deliberately borderless and one row tall: a bordered box costs three rows
 * of vertical space, which is a lot to spend on a control strip in a
 * terminal. Hover is shown by filling the background instead of recolouring
 * a border. (Terminals have no font size - every cell is one character - so
 * "smaller" can only mean fewer rows and tighter padding.)
 *
 * opentui has no click event - only "down"/"up" - so onMouseDown IS the
 * press. Every visible renderable is registered in the native hit grid
 * automatically, so no opt-in is needed for the box to receive the event,
 * and events bubble from the inner <text> up to this box.
 *
 * IMPORTANT: the label and colours are applied imperatively through refs,
 * NOT as reactive JSX props. This project compiles JSX with tsconfig's
 * "react-jsx" automatic runtime against @opentui/solid's jsx-runtime rather
 * than with babel-preset-solid, so JSX props are evaluated ONCE into a plain
 * object - there are no getters and nothing is tracked. Writing
 * `<text>{props.label()}</text>` therefore paints the first value and never
 * updates again. That silently broke the delete confirmation: the button
 * armed correctly but kept reading "Remove + Files", so the second click
 * deleted files with no visible warning. Every other dynamic value in this
 * app (table content, error line, suggestions) is driven the same imperative
 * way for the same reason.
 */
export function Button(props: ButtonProps) {
  const [hovered, setHovered] = createSignal(false);

  let boxRef: BoxRenderable | undefined;
  let textRef: TextRenderable | undefined;

  const disabled = () => props.disabled?.() ?? false;
  const danger = () => (props.tone?.() ?? "normal") === "danger";

  createEffect(() => {
    themeVersion(); // repaint when the palette changes
    const isDisabled = disabled();
    const isDanger = danger();
    const isHovered = hovered();

    // Hovering fills the chip; disabled stays flat and grey.
    const active = isHovered && !isDisabled;
    const fill = active ? (isDanger ? theme.error : theme.accent) : theme.background;
    const color = active
      ? theme.selectionFg
      : isDisabled
        ? theme.muted
        : isDanger
          ? theme.error
          : theme.text;

    if (textRef) {
      textRef.content = props.label();
      textRef.fg = color;
      textRef.bg = fill;
    }
    if (boxRef) boxRef.backgroundColor = fill;
  });

  return (
    <box
      ref={(el: BoxRenderable) => (boxRef = el)}
      height={1}
      paddingLeft={1}
      paddingRight={1}
      marginRight={1}
      flexShrink={0}
      onMouseDown={() => {
        if (!disabled()) props.onPress();
      }}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
    >
      <text ref={(el: TextRenderable) => (textRef = el)} />
    </box>
  );
}
