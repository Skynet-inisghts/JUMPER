import { THRESHOLDS } from "../score/config.js";
import type { ScoutOut, SnareOut, Tape, WeaverOut } from "./types.js";

/** Which wallets SCOUT asks the index about: the largest holders and every sniper. */
export function scoutTargets(web: WeaverOut, snared: SnareOut): string[] {
  const out = new Set(web.holders.slice(0, THRESHOLDS.scoutHolders).map((h) => h.address));
  for (const s of snared.snipers) out.add(s.wallet);
  return [...out];
}

/**
 * SCOUT: follows each holder through every other Pons token and scores it
 * on closed trades.
 *
 * A wallet is smart at a 55% winrate over five or more realized positions,
 * with the crawled token left out of its own record (a launcher's insiders
 * would otherwise decorate the token with its own pump). Wallets that have
 * traded thousands of markets are bots; their numbers describe a strategy,
 * not judgement, and they are never counted smart.
 */
export function scout(tape: Tape, web: WeaverOut): ScoutOut {
  if (!tape.history) {
    return { online: false, scanned: 0, smart: [], smartSupply: 0n, avgWinrate: null, virgins: [], shortHistory: [] };
  }
  const smart: ScoutOut["smart"] = [];
  const virgins: string[] = [];
  const shortHistory: string[] = [];
  let scanned = 0;
  for (const holder of web.holders) {
    const h = tape.history[holder.address];
    if (!h) continue;
    scanned++;
    // The index credits a routed trade to the router, so a wallet that trades
    // through one can look brand new there. Only a wallet that bought here
    // directly and has no other market is called a first-timer.
    if (h.markets === 0) {
      if (!holder.routed) virgins.push(holder.address);
      continue;
    }
    if (h.markets < THRESHOLDS.shortHistoryMarkets) shortHistory.push(holder.address);
    if (isBotRecord(h)) continue;
    if (h.winrate !== null && h.winrate >= THRESHOLDS.smartWinrate && h.positions >= THRESHOLDS.smartMinPositions) {
      smart.push({ wallet: holder.address, winrate: h.winrate, positions: h.positions, balance: holder.balance });
    }
  }
  const smartSupply = smart.reduce((s, w) => s + w.balance, 0n);
  const avgWinrate = smart.length ? smart.reduce((s, w) => s + w.winrate, 0) / smart.length : null;
  return { online: true, scanned, smart, smartSupply, avgWinrate, virgins, shortHistory };
}

/** A record no person makes: thousands of markets, or a near-perfect winrate over many trades. */
export function isBotRecord(h: { markets: number; positions: number; winrate: number | null }): boolean {
  return h.markets >= THRESHOLDS.botMarkets || (h.winrate !== null && h.winrate >= THRESHOLDS.botWinrate && h.positions >= THRESHOLDS.botPositions);
}
