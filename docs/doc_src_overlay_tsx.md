# Component Spec: `src/overlay.tsx`

**File Path:** [src/overlay.tsx](../src/overlay.tsx)
**Role:** The shared frame and key router behind every dialog: Settings, Details and Add.

---

## 1. Why it exists

All three dialogs had the same skeleton copied out: an absolutely-positioned bordered box, a title line, a hint line, a body, a notice line, and a `themeVersion` effect repainting the lot. Only the **content** differed.

The duplication had already cost something real: when the Add dialog gained buttons and mouse support, the Details panel was left behind for two rounds with neither.

## 2. Functional Specification

1. **The frame**: absolute box with `border`, `padding`, configurable `top` / `left` / `width` / `zIndex`, and five text rows: title, optional subtitle, hint, body, notice. Panels supply strings through getter props; the overlay owns the renderables.
2. **Chrome repaint**: one `themeVersion()` effect sets border, background, and every text colour. Title takes `accent2`, hint takes `dimText()`, body takes `text`, notice takes `noticeColour` (default `error`: Settings passes `success` for "Saved.").
3. **Body clicks**: `onBodyClick(row)` receives the clicked line **relative to the first body line**, so panels do not need to know their own screen position.
4. **Key routing**: each overlay registers `{priority, isOpen, onKey}` on mount and removes itself on cleanup.
   - `overlayKey(key)` sends the key to the **highest-priority open** overlay, or returns `undefined` if none is open.
   - `anyOverlayOpen()` answers the "should stray typing be swallowed?" question in `app.tsx`.
   - Priorities: Add `30`, **Background `28`**, Settings `25`, Details `20`. Add is highest because it is a decision the user is in the middle of making.
5. **It asks for a frame.** Assigning `.content` marks a renderable dirty but does not schedule a render, so the screen only caught up on the app's 1-second refresh. A keystroke in *any* dialog could sit invisible for up to a second and read as a dropped key. The repaint effect now calls `renderer.requestRender()`, which fixed Settings, Details and Add as well as the Background dialog that exposed it.
5. **Replaces the `(Panel as any).handleKey` hack**: each panel previously stashed its handler on its own component function and exported a `handleXKey()` to read it back, six lines of escape hatch across three files, plus an if-chain in `app.tsx`. All gone.

## 3. What panels still own

Their own open/close signal, cursor state, body text, key handling, and any buttons passed as children. The overlay deliberately does not know what a "file row" or a "setting" is.

## 4. Net effect

−276 lines across the three panels, +141 here, and `app.tsx` sheds its per-panel imports and routing. Behaviour is unchanged: the suite passed identically before and after. (A fourth panel, [Background](doc_src_bg_panel_tsx.md), was later added on top of this for free.)
