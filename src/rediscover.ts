/**
 * Force a fresh peer announce after un-pausing a torrent.
 *
 * WebTorrent DISCARDS every peer it discovers while a torrent is paused
 * ("ignoring peer: torrent is paused" in torrent.js), and resume() only calls
 * _drain() on a queue that is therefore empty - it never re-announces. A
 * torrent restored paused would sit at 0 peers until the tracker's next
 * announce interval, which is routinely 30 minutes away, so clicking Resume
 * looked like it did nothing at all.
 *
 * Lives in its own module because BOTH the engine and the daemon need it, and
 * importing it from engine.ts would construct the engine singleton (and a
 * second WebTorrent client) inside the daemon process.
 */

/**
 * Shortest gap between two FORCED announces for the same torrent.
 *
 * Trackers publish a minimum interval and expect clients to honour it, and
 * resume, restore and the background handover all called rediscover() with no
 * floor at all.
 *
 * Honest history: this was written after two torrents sat at zero peers with
 * Ubuntu's trackers returning HTTP 400, and the unthrottled announces were
 * blamed. That diagnosis was WRONG - a hand-built announce to the same
 * tracker moments later returned HTTP 200 with a full peer list, so nothing
 * had been refused. (The real split appears to be transport: peers arrive
 * from Debian's http:// tracker and not from Ubuntu's https:// one, which
 * points at the tracker client rather than at this file.)
 *
 * The throttle stays on its own merits - announcing on every user action with
 * no floor is wrong whether or not it caused that particular outage.
 *
 * Deliberately SHORT. The pathological case is a burst - a stuck row clicked
 * repeatedly, or several torrents restored and resumed at once - not a
 * considered action. A minute-long window looked prudent and broke a
 * perfectly ordinary flow: add a torrent, pause it, resume it, all within
 * that window, and the resume got no announce and therefore no peers. Which
 * is the exact bug rediscover() exists to prevent.
 *
 * Ten seconds collapses any burst a person can produce while leaving every
 * deliberate action its announce.
 */
const MIN_FORCED_ANNOUNCE_MS = 10_000;

/** infoHash -> when we last forced an announce for it. */
const lastAnnounce = new Map<string, number>();

export function rediscover(torrent: any): void {
  const discovery = torrent?.discovery;
  if (!discovery) return;

  // The DHT is asked every time: it is peer-to-peer, has no central party to
  // annoy, and no interval to respect. So a throttled call still does
  // something useful rather than silently doing nothing.
  try {
    discovery.dht?.lookup?.(torrent.infoHash);
  } catch {
    // Peer discovery is best-effort.
  }

  const hash = torrent?.infoHash;
  if (hash) {
    const now = Date.now();
    const previous = lastAnnounce.get(hash) ?? 0;
    if (now - previous < MIN_FORCED_ANNOUNCE_MS) return;
    lastAnnounce.set(hash, now);
  }

  try {
    discovery.tracker?.update?.();
  } catch {
    // Announce is best-effort.
  }
}

/** Forget a torrent's announce history - it is being removed. */
export function forgetAnnounce(infoHash: string): void {
  lastAnnounce.delete(infoHash);
}
