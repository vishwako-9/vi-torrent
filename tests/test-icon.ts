import { checks } from "./_isolate.js";
/**
 * The generated .torrent file icon.
 *
 * Windows does not report a malformed icon - it silently shows a blank space
 * or falls back to its own generic glyph, which is indistinguishable from not
 * having registered one at all. So the byte layout is checked here rather
 * than by looking at Explorer and guessing.
 *
 * Two fields are the usual cause of a blank icon, and both are asserted: the
 * BITMAPINFOHEADER height must be DOUBLE the real height (it spans the colour
 * data and the AND mask together), and every directory entry's declared
 * length and offset must actually land inside the file.
 */
import { buildIcon, ICON_ART } from "../src/icon.js";

const { ck, done } = checks();

const ico = buildIcon();
const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);

// --- container ---
ck("reserved field is zero", view.getUint16(0, true) === 0);
ck("type is 1 (icon, not cursor)", view.getUint16(2, true) === 1);
const count = view.getUint16(4, true);
ck("it holds two images", count === 2);

// --- both hand-drawn sizes are square and the size they claim ---
ck("the 16px art is 16 rows", ICON_ART.small.length === 16);
ck("...and 16 columns", ICON_ART.small.every(r => r.length === 16));
ck("the 32px art is 32 rows", ICON_ART.large.length === 32);
ck("...and 32 columns", ICON_ART.large.every(r => r.length === 32));

// --- directory entries ---
const sizes: number[] = [];
for (let i = 0; i < count; i++) {
  const entry = 6 + i * 16;
  const width = ico[entry];
  const height = ico[entry + 1];
  const bytes = view.getUint32(entry + 8, true);
  const offset = view.getUint32(entry + 12, true);
  sizes.push(width);

  ck(`entry ${i}: square`, width === height);
  ck(`entry ${i}: 32 bits per pixel`, view.getUint16(entry + 6, true) === 32);
  ck(`entry ${i}: one colour plane`, view.getUint16(entry + 4, true) === 1);
  // A length or offset past the end is the classic silent-blank cause.
  ck(`entry ${i}: image lies inside the file`, offset + bytes <= ico.length);

  // The DIB header, at the entry's offset.
  const dib = offset;
  ck(`entry ${i}: BITMAPINFOHEADER is 40 bytes`, view.getUint32(dib, true) === 40);
  ck(`entry ${i}: header width matches the entry`, view.getInt32(dib + 4, true) === width);
  ck(`entry ${i}: header height is DOUBLED for the mask`,
    view.getInt32(dib + 8, true) === height * 2);

  // Colour data + a 1bpp mask padded to 4-byte rows.
  const expectedPixels = width * height * 4;
  const maskRow = Math.ceil(width / 32) * 4;
  ck(`entry ${i}: declared length covers pixels and mask`,
    bytes === 40 + expectedPixels + maskRow * height);
}

ck("both sizes are present", sizes.sort((a, b) => a - b).join() === "16,32");

// --- the art actually draws something in both colours ---
// A file that is structurally perfect and entirely transparent looks exactly
// like a missing icon.
const flat = ICON_ART.large.join("");
ck("the large icon has dinosaur pixels", flat.includes("D"));
ck("...and cactus pixels", flat.includes("C"));
ck("...and is not solid", flat.includes("."));
const small = ICON_ART.small.join("");
ck("the small icon has both too", small.includes("D") && small.includes("C"));

// Only the three known characters, or bmpEntry silently treats them as gaps.
ck("the art uses no unknown characters",
  /^[.DC]+$/.test(flat) && /^[.DC]+$/.test(small));

done();
