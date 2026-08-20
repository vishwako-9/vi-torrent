import fs from "fs";
import path from "path";

/**
 * Is this directory empty, ignoring empty sub-directories?
 *
 * A multi-file torrent leaves its folder tree behind after destroyStore
 * deletes the files, so "no files anywhere underneath" is the test that
 * matters - not "no entries at all".
 */
function holdsNoFiles(dir: string): boolean {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false; // unreadable - treat as "leave it alone"
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!holdsNoFiles(path.join(dir, entry.name))) return false;
    } else {
      return false; // any file at all, including one the user put there
    }
  }
  return true;
}

/**
 * Delete a torrent's own folder after its files have been removed.
 *
 * WebTorrent's `destroyStore` deletes the FILES a torrent owns but not the
 * directory it created for them, so "Remove + Files" on a multi-file torrent
 * left an empty folder behind.
 *
 * This is a destructive filesystem call, so it is deliberately timid:
 *   - only ever `<savePath>/<torrent name>`, never the save directory itself
 *   - the path must genuinely sit inside the save directory (no traversal)
 *   - it must contain NO files, so anything the user dropped in there keeps
 *     the folder alive
 *
 * Returns true only if a directory was actually removed.
 */
export function removeTorrentFolder(savePath: string, torrentName: string): boolean {
  if (!savePath || !torrentName) return false;

  const save = path.resolve(savePath);
  const folder = path.resolve(save, torrentName);

  // Never the save directory itself, and never anything outside it - a
  // torrent name is attacker-controlled data and could contain "..".
  if (folder === save) return false;
  if (!folder.startsWith(save + path.sep)) return false;

  try {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return false;
    if (!holdsNoFiles(folder)) return false;
    fs.rmSync(folder, { recursive: true, force: true });
    return true;
  } catch {
    return false; // never let cleanup break the removal itself
  }
}
