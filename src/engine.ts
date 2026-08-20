/**
 * TUI-side entry point for the torrent engine.
 *
 * Two implementations share this one import surface, chosen the same way
 * tests/_isolate.ts already redirects state directories - by VI_TORRENT_TEST:
 *
 *  - Under test: the real torrent-core.js Engine, in-process, exactly as
 *    before this rewrite. ~20 test files mount <App/> and drive the `engine`
 *    singleton directly, expecting synchronous local behaviour with no
 *    daemon involved - they are testing app.tsx's UI logic, not the process
 *    topology, and making each of them spawn and coordinate with a real OS
 *    subprocess would trade a fast, isolated suite for a slow, flaky one
 *    without testing anything those tests are actually about. Unit tests
 *    that want the real engine (`import { Engine } from "./engine.js"`)
 *    still get torrent-core.js's real class, unchanged.
 *  - In the shipped app: a DaemonEngine that proxies every call to a
 *    separate daemon process, which is the actual point of this rewrite -
 *    see docs/daemon_first_acceptance.md. index.tsx calls `engine.ready()`
 *    once, before mounting <App/>, to spawn the daemon if needed and wait
 *    for its first status snapshot.
 */
export * from "./torrent-core.js";
import { Engine } from "./torrent-core.js";
import { DaemonEngine } from "./daemon-engine.js";

// Singleton instance
export const engine: Engine | DaemonEngine =
  process.env.VI_TORRENT_TEST === "1" ? new Engine() : new DaemonEngine();
