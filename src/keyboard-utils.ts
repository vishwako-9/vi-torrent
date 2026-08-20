import type { KeyEvent } from "@opentui/core";

/**
 * A focused Input/Textarea's handleKeyPress consumes every keystroke it gets
 * (confirmed by testing: global useKeyboard subscribers never fire for a key
 * combo while any input has focus, regardless of whether that combo matches
 * one of the input's own keyBindings). TextareaAction is a closed union type
 * with no "custom" slot, so keyBindings can't express "open the command
 * palette" either. The only real extension point is overriding the public
 * handleKeyPress method on the instance to intercept specific combos first,
 * falling through to the original implementation for everything else.
 */
export function interceptKeyPress(
  el: { handleKeyPress(key: KeyEvent): boolean },
  shortcuts: Array<{
    /**
     * Key name, or "*" to match any key. A wildcard entry belongs LAST, so
     * the specific shortcuts above it still win; it exists to swallow stray
     * typing while a modal owns the screen.
     */
    name: string;
    ctrl?: boolean;
    /**
     * Return false to DECLINE the key and let the input handle it normally.
     * Needed for keys that are only ours some of the time - left/right belong
     * to the settings panel while it is open, and to the input's own cursor
     * the rest of the time. Returning anything else consumes the key.
     */
    handler: (key: KeyEvent) => void | boolean;
  }>,
): void {
  const original = el.handleKeyPress.bind(el);
  el.handleKeyPress = (key: KeyEvent) => {
    if (key.eventType === "press") {
      for (const shortcut of shortcuts) {
        const matches = shortcut.name === "*"
          ? true
          : key.name === shortcut.name && !!key.ctrl === !!shortcut.ctrl;
        if (matches) {
          if (shortcut.handler(key) === false) break;
          return true;
        }
      }
    }
    return original(key);
  };
}
