/**
 * WebTorrent options that every client in this project must pass, including
 * the ones inside tests.
 *
 * **uTP takes the process down on macOS and Linux.** It is a second transport
 * alongside TCP, provided by `utp-native` — a NAPI module — and NAPI on POSIX
 * is still being completed in Bun (oven-sh/bun#18546). The failure is not an
 * exception that can be caught:
 *
 *     panic(main thread): unsupported uv function: uv_timer_init
 *
 * Measured on Ubuntu 26.04 / WSL2:
 *
 * | client                        | result                              |
 * | :---------------------------- | :---------------------------------- |
 * | `new WebTorrent()`            | panics within seconds               |
 * | `new WebTorrent({wrtc:false})` | panics — WebRTC was NOT the cause   |
 * | `new WebTorrent({utp:false})`  | 55 peers, 642 MB at 11 MB/s in 60s  |
 *
 * uTP genuinely works on Windows, so it is kept there rather than disabled
 * everywhere: every BitTorrent peer speaks TCP, and uTP is a congestion-control
 * improvement on top of that, so losing it costs little — but there is no
 * reason to give it up where it works.
 *
 * This lives in its own module for the same reason `rediscover.ts` does: the
 * engine, the detached daemon and the test helpers all need it, and importing
 * it from `engine.ts` would construct the engine singleton (and a second
 * WebTorrent client) inside the daemon process.
 */

/** True where uTP can be used without taking the process down. */
export const utpSupported: boolean = process.platform === "win32";

/**
 * Spread into EVERY `new WebTorrent(...)` in this project.
 *
 * A client built without it runs on Windows and panics on POSIX, and because
 * the panic is not catchable it takes the whole process with it — a detached
 * daemon would do so invisibly.
 */
export function platformOptions(): { utp: boolean } {
  return { utp: utpSupported };
}
