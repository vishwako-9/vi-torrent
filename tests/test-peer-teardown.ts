import { checks } from "./_isolate.js";
/**
 * The one WebTorrent error the user must NOT be shown.
 *
 * Reported from a real run: bulk-pausing four torrents filled the screen with
 *
 *   Error: null is not an object (evaluating 'this.swarm.private')
 *     at handshake (webtorrent/lib/peer.js:201:17)
 *     ...
 *     at onCryptoInfoHash (webtorrent/lib/conn-pool.js:153:20)
 *
 * conn-pool AWAITS the encrypted handshake after setting `peer.swarm`; if the
 * torrent stops in that window, `peer.destroy()` nulls the swarm first and the
 * deferred `handshake()` runs on a dead peer. Nothing is lost - the peer was
 * already gone - so it must not surface as an app error.
 *
 * The filter has to be NARROW. This suite exists mostly to prove the things it
 * does **not** swallow, because a catch-all here would hide real failures.
 */
import { isPeerTeardownRace } from "../src/engine.js";

const { ck, done } = checks();

/** The real stack from the report, both engines' wording. */
const jscStack = [
  "TypeError: null is not an object (evaluating 'this.swarm.private')",
  "    at handshake (C:\\Users\\x\\vi-torrent-node\\node_modules\\webtorrent\\lib\\peer.js:201:17)",
  "    at <anonymous> (C:\\Users\\x\\vi-torrent-node\\node_modules\\webtorrent\\lib\\peer.js:108:37)",
  "    at emit (node:events:92:22)",
  "    at onCryptoInfoHash (C:\\Users\\x\\vi-torrent-node\\node_modules\\webtorrent\\lib\\conn-pool.js:153:20)",
].join("\n");

const v8Stack = [
  "TypeError: Cannot read properties of null (reading 'private')",
  "    at Peer.handshake (/home/x/vi-torrent/node_modules/webtorrent/lib/peer.js:201:17)",
  "    at Wire.<anonymous> (/home/x/vi-torrent/node_modules/webtorrent/lib/peer.js:108:37)",
].join("\n");

const withStack = (message: string, stack: string, Kind: any = TypeError) => {
  const e = new Kind(message);
  e.stack = stack;
  return e;
};

// --- the real thing, on both engines ---
ck("the Bun/JSC form is recognised",
  isPeerTeardownRace(withStack("null is not an object (evaluating 'this.swarm.private')", jscStack)));
// The V8 message does not contain the word "swarm" at all, which is why the
// stack is matched instead of the text.
ck("the Node/V8 form is recognised",
  isPeerTeardownRace(withStack("Cannot read properties of null (reading 'private')", v8Stack)));
ck("...even though its message never says 'swarm'",
  !v8Stack.split("\n")[0].includes("swarm"));

// --- everything it must NOT swallow ---
ck("a plain Error is never swallowed",
  !isPeerTeardownRace(withStack("null is not an object (evaluating 'this.swarm.private')", jscStack, Error)));
ck("the torrent-identifier error still reaches the user",
  !isPeerTeardownRace(new Error("Invalid torrent identifier")));
ck("a TypeError with no stack is not swallowed",
  !isPeerTeardownRace(withStack("boom", "")));
ck("a TypeError from OUR code is not swallowed",
  !isPeerTeardownRace(withStack("boom", "TypeError: boom\n    at act (src/app.tsx:12:3)")));
// peer.js is third-party, but a failure somewhere else in it is still news.
ck("a TypeError elsewhere in peer.js is not swallowed",
  !isPeerTeardownRace(withStack("boom",
    "TypeError: boom\n    at onPiece (node_modules/webtorrent/lib/peer.js:400:1)")));
// "handshake" alone is not enough - bittorrent-protocol has its own.
ck("a handshake failure outside peer.js is not swallowed",
  !isPeerTeardownRace(withStack("boom",
    "TypeError: boom\n    at handshake (node_modules/bittorrent-protocol/index.js:9:1)")));
ck("a string is not swallowed", !isPeerTeardownRace("this.swarm.private"));
ck("null is not swallowed", !isPeerTeardownRace(null));

// --- POSIX and Windows paths both match ---
ck("forward-slash paths match",
  isPeerTeardownRace(withStack("x", "at handshake (/a/node_modules/webtorrent/lib/peer.js:201:17)")));
ck("backslash paths match",
  isPeerTeardownRace(withStack("x", "at handshake (C:\\a\\node_modules\\webtorrent\\lib\\peer.js:201:17)")));

done();
