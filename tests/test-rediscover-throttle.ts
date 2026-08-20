import { checks } from "./_isolate.js";
/**
 * Forced announces must be throttled.
 *
 * resume(), restore(), confirmPreview() and the background handover all call
 * rediscover(), and none of them had any floor at all - trackers publish a
 * minimum interval precisely to discourage that.
 *
 * Written on a wrong diagnosis, and kept anyway: the trigger was two torrents
 * at zero peers with Ubuntu's trackers returning HTTP 400, blamed on
 * self-inflicted rate limiting. A hand-built announce to the same tracker
 * moments later returned HTTP 200 with a full peer list, so nothing had been
 * refused. The throttle is still correct behaviour; the reason first recorded
 * for it was not. See src/rediscover.ts.
 */
import { rediscover, forgetAnnounce } from "../src/rediscover.js";

const { ck, done } = checks();

/** A torrent stub that counts what rediscover() asks of it. */
function fake(infoHash: string) {
  const counts = { announces: 0, lookups: 0 };
  return {
    counts,
    torrent: {
      infoHash,
      discovery: {
        tracker: { update: () => { counts.announces++; } },
        dht: { lookup: () => { counts.lookups++; } },
      },
    },
  };
}

// --- a burst of clicks must collapse into ONE announce ---
const a = fake("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
for (let i = 0; i < 5; i++) rediscover(a.torrent);
ck("five rapid calls announce exactly once (got " + a.counts.announces + ")",
  a.counts.announces === 1);

// ...but the DHT is still asked every time: it has no interval to respect,
// so a throttled call still does something rather than nothing.
ck("the DHT is still asked on every call (got " + a.counts.lookups + ")",
  a.counts.lookups === 5);

// --- the throttle is PER TORRENT ---
const b = fake("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
rediscover(b.torrent);
ck("a different torrent is not throttled by the first", b.counts.announces === 1);

// --- removing a torrent forgets its history ---
forgetAnnounce(a.torrent.infoHash);
rediscover(a.torrent);
ck("after forgetAnnounce a re-added torrent may announce again",
  a.counts.announces === 2);

// --- the window must not swallow a DELIBERATE resume ---
// The first version used a 60-second window, which looked prudent and broke
// an ordinary flow: add a torrent (announce), pause it, resume it - all
// inside the window, so the resume announced nothing and found no peers,
// which is precisely the bug rediscover() exists to prevent. Caught by
// test-resume.ts, not by this file.
const c = fake("cccccccccccccccccccccccccccccccccccccccc");
rediscover(c.torrent);
await new Promise(r => setTimeout(r, 11000));
rediscover(c.torrent);
ck("an announce 11s later is allowed through (got " + c.counts.announces + ")",
  c.counts.announces === 2);

// --- a torrent with no discovery must not throw ---
let threw = false;
try {
  rediscover({ infoHash: "c".repeat(40) });
  rediscover(undefined);
  rediscover({ infoHash: "d".repeat(40), discovery: {} });
} catch { threw = true; }
ck("a torrent without trackers or DHT is handled quietly", !threw);

// --- a tracker that throws must not take the caller down ---
let brokeCaller = false;
try {
  rediscover({
    infoHash: "e".repeat(40),
    discovery: {
      tracker: { update: () => { throw new Error("tracker exploded"); } },
      dht: { lookup: () => { throw new Error("dht exploded"); } },
    },
  });
} catch { brokeCaller = true; }
ck("a throwing tracker or DHT is swallowed", !brokeCaller);

done();
