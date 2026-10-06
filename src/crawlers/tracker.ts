import { THRESHOLDS } from "../score/config.js";
import { devSet, hasExited, lc, venues } from "./common.js";
import type { Tape, TrackerOut, WeaverOut } from "./types.js";

/**
 * TRACKER: walks the graph backwards and marks every wallet that no longer
 * holds, and what it took out.
 *
 * "Gone" is measured at each exited wallet's peak: the most it ever held is
 * what walked out of the web. What it took out is the quote it received
 * selling; the index books cover pool sales after graduation, the curve
 * trades everything before. A move to another wallet looks the same as a
 * sale from here, and the README says so.
 */
export function track(tape: Tape, web: WeaverOut): TrackerOut {
  const exited = [...web.wallets.values()].filter((w) => hasExited(w.balance, w.peak));
  const goneSupply = exited.reduce((s, w) => s + w.peak, 0n);
  const exitedSet = new Set(exited.map((w) => w.address));

  // per wallet, the larger of the two views: routed curve sales resolved
  // here, pool sales after graduation only in the index
  const curveOut = new Map<string, bigint>();
  for (const t of web.trades) if (t.kind === "sell" && exitedSet.has(t.wallet)) curveOut.set(t.wallet, (curveOut.get(t.wallet) ?? 0n) + t.quoteWei);
  let takenOutQuote = 0n;
  for (const w of exitedSet) {
    const fromCurve = curveOut.get(w) ?? 0n;
    const fromIndex = tape.books?.[w] ? BigInt(Math.round(tape.books[w].sellQuote)) : 0n;
    takenOutQuote += fromIndex > fromCurve ? fromIndex : fromCurve;
  }

  const partial = [...web.wallets.values()].filter((w) => !hasExited(w.balance, w.peak) && w.peak > 0n && w.balance * 2n < w.peak).length;

  // The dev is the deployer and the fee recipient together: a launcher who
  // moves the bag to its fee wallet has not sold.
  let devPeak = 0n;
  let devBalance = 0n;
  for (const d of devSet(tape)) {
    const w = web.wallets.get(d);
    if (!w) continue;
    devPeak += w.peak;
    devBalance += w.balance;
  }
  const devSoldPct = devPeak > 0n ? Math.max(0, 1 - Number((devBalance * 10_000n) / devPeak) / 10_000) : 0;
  const devState = devSoldPct >= THRESHOLDS.devDumped ? "dumped" : devSoldPct >= THRESHOLDS.devSoldHalf ? "sold half" : "clean";

  // Exit pressure: over the last hour, what wallets pushed into the curve or
  // the pool minus what they took back out, as a share of supply. Net, not
  // gross: a volume bot flipping the same bag a hundred times moves nothing
  // toward the exit, and gross flow on a young token passes the whole supply.
  const venueSet = new Set([...venues(tape), ...web.routers]);
  const since = tape.headBlock - Math.round(THRESHOLDS.exitWindowSec / tape.secPerBlock);
  let net = 0n;
  let soldHour = 0n;
  let boughtHour = 0n;
  for (let i = tape.transfers.length - 1; i >= 0; i--) {
    const t = tape.transfers[i];
    if (t.block < since) break;
    const from = lc(t.from);
    const to = lc(t.to);
    if (venueSet.has(to) && web.wallets.has(from)) { net += t.value; soldHour += t.value; }
    else if (venueSet.has(from) && web.wallets.has(to)) { net -= t.value; boughtHour += t.value; }
  }
  const exitPressureTokens = net > 0n ? net : 0n;

  return { exited, goneSupply, takenOutQuote, partial, devState, devSoldPct, exitPressureTokens, soldHour, boughtHour };
}
