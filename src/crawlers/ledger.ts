import { lc, wholeTokens } from "./common.js";
import type { Book, LedgerOut, Tape, WeaverOut } from "./types.js";

/**
 * LEDGER: rebuilds every holder's book. Weighted average entry, bought,
 * sold, what is left, what that is worth now.
 *
 * Bought and sold come from the index when it is online (curve trades and
 * pool trades after graduation, already folded per wallet); otherwise from
 * the curve's own trade events. What is left is never buys minus sells:
 * tokens also arrive and leave by transfer, so the remainder is the
 * replayed balance from WEAVER. Each book's return joins the average
 * clamped to [-100%, +500%], so one wallet that bought for a rounding error
 * cannot carry the whole token.
 */
export function ledger(tape: Tape, web: WeaverOut): LedgerOut {
  const qd = 10 ** tape.launch.pairDecimals;
  const priceQuote = tape.quotePerToken !== null ? (tape.quotePerToken * 1e18) / qd : null;
  const priceUsd = tape.tokenUsd ?? (priceQuote !== null && tape.quoteUsd !== null ? priceQuote * tape.quoteUsd : null);

  // Curve trades with routers resolved to the wallets they served...
  const raw = new Map<string, { bt: number; bq: number; st: number; sq: number }>();
  for (const t of web.trades) {
    const r = raw.get(t.wallet) ?? { bt: 0, bq: 0, st: 0, sq: 0 };
    if (t.kind === "buy") { r.bt += Number(t.tokens); r.bq += Number(t.quoteWei); }
    else { r.st += Number(t.tokens); r.sq += Number(t.quoteWei); }
    raw.set(t.wallet, r);
  }
  // ...and the index's book where it saw more: it also folds pool trades
  // after graduation, but credits a routed trade to the router, so neither
  // source is a superset of the other.
  if (tape.books) {
    for (const [w, b] of Object.entries(tape.books)) {
      const key = lc(w);
      const cur = raw.get(key);
      if (!cur || b.buyTokens + b.sellTokens > cur.bt + cur.st) raw.set(key, { bt: b.buyTokens, bq: b.buyQuote, st: b.sellTokens, sq: b.sellQuote });
    }
  }

  const books = new Map<string, Book>();
  let pnlSum = 0;
  let pnlN = 0;
  for (const holder of web.holders) {
    const r = raw.get(holder.address) ?? { bt: 0, bq: 0, st: 0, sq: 0 };
    const bought = r.bt / 1e18;
    const sold = r.st / 1e18;
    const remaining = wholeTokens(holder.balance);
    const costQuote = r.bq / qd;
    const proceedsQuote = r.sq / qd;
    const valueQuote = priceQuote !== null ? remaining * priceQuote : null;
    const valueUsd = priceUsd !== null ? remaining * priceUsd : null;
    const pnlPct = costQuote > 0 && valueQuote !== null ? ((proceedsQuote + valueQuote - costQuote) / costQuote) * 100 : null;
    if (pnlPct !== null) { pnlSum += Math.max(-100, Math.min(500, pnlPct)); pnlN++; }
    books.set(holder.address, {
      wallet: holder.address,
      bought,
      sold,
      remaining,
      avgEntryQuote: bought > 0 ? costQuote / bought : null,
      costQuote,
      proceedsQuote,
      valueQuote,
      valueUsd,
      pnlPct,
    });
  }
  return { source: tape.books ? "index" : "curve", books, avgPnlPct: pnlN ? pnlSum / pnlN : null, priceQuote, priceUsd };
}
