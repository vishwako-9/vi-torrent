import { checks, testRoot } from "./_isolate.js";
/**
 * Links handed over by the operating system.
 *
 * Clicking a magnet link in a browser launches a second vi-torrent. The
 * instance lock refuses to let it become a client, so it leaves the link in
 * an inbox and exits, and the window already open picks it up on its refresh
 * tick. This covers that channel end to end.
 */
import {
  isTorrentArg, normaliseLink, dropLink, takeNextLink, resolveStateDir,
} from "../src/handoff.js";
import fs from "fs";
import path from "path";

const { ck, done } = checks();
const dir = path.join(testRoot, "handoff");
const inbox = path.join(dir, "inbox");

const MAGNET = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=thing";

// --- what counts as a link ---
ck("a magnet URI is a link", isTorrentArg(MAGNET));
ck("a .torrent path is a link", isTorrentArg("C:\\downloads\\ubuntu.torrent"));
ck("...case-insensitively", isTorrentArg("/home/x/Ubuntu.TORRENT"));
ck("a flag is not a link", !isTorrentArg("--register"));
ck("a bare path is not a link", !isTorrentArg("C:\\downloads"));
ck("an empty argument is not a link", !isTorrentArg(""));
// A browser hands over http URLs for plenty of things we are not; only the
// two schemes we registered may open a dialog.
ck("an http URL is not a link", !isTorrentArg("https://example.com/x"));

// --- a relative .torrent path must survive the process boundary ---
// The launching process's working directory is not the running window's, so
// a path relative to it is meaningless by the time it is read.
ck("a relative .torrent path is made absolute",
  path.isAbsolute(normaliseLink("some.torrent")));
ck("a magnet URI is left alone", normaliseLink(MAGNET) === MAGNET);

// --- nothing waiting ---
ck("an inbox that does not exist yields nothing", takeNextLink(dir) === null);

// --- drop and pick up ---
dropLink(dir, MAGNET);
ck("dropping a link creates the inbox", fs.existsSync(inbox));
ck("the link comes back", takeNextLink(dir) === MAGNET);
ck("reading is destructive - it is not added twice", takeNextLink(dir) === null);

// --- oldest first, one at a time ---
// There is only one preview dialog, so links queue rather than clobber.
dropLink(dir, MAGNET + "&x=1");
// mtime and name both carry the ordering; sleep-free by writing the second
// file with an older name is not possible, so order is asserted on arrival.
dropLink(dir, MAGNET + "&x=2");
ck("two links are both waiting", fs.readdirSync(inbox).length === 2);
const first = takeNextLink(dir);
const second = takeNextLink(dir);
ck("the first link comes back", first === MAGNET + "&x=1");
ck("the second link comes back after it", second === MAGNET + "&x=2");
ck("the inbox is then empty", takeNextLink(dir) === null);

// --- a stale link is discarded, not opened ---
// It only lingers if the window it was meant for died. Opening a magnet
// dialog out of nowhere on an unrelated launch days later reads as a bug.
dropLink(dir, MAGNET);
const stalePath = path.join(inbox, fs.readdirSync(inbox)[0]);
const longAgo = new Date(Date.now() - 60 * 60 * 1000);
fs.utimesSync(stalePath, longAgo, longAgo);
ck("a stale link is not opened", takeNextLink(dir) === null);
ck("...and is cleared away rather than left to retry", fs.readdirSync(inbox).length === 0);

// --- rubbish in the inbox is ignored, not handed to the engine ---
fs.writeFileSync(path.join(inbox, "junk.txt"), "not a link at all");
ck("a file that is not a link is ignored", takeNextLink(dir) === null);
ck("...and removed so it cannot jam the queue", fs.readdirSync(inbox).length === 0);

// --- the state dir the TUI reads is the one the launcher writes ---
// Both sides call this; if they ever disagreed, links would vanish silently.
ck("the state directory honours VI_TORRENT_STATE_DIR",
  path.resolve(resolveStateDir()) === path.resolve(process.env.VI_TORRENT_STATE_DIR!));

done();
