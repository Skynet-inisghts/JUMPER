import { isNonWallet, lc, venues } from "./common.js";
import type { Tape, TapeTrade, Wallet, WeaverOut } from "./types.js";

/**
 * WEAVER: pulls every transfer and lays the holders out as a graph,
 * parent to child, first buyer to last.
 *
 * Balances come from replaying the Transfer log, never from archive state
 * reads. A wallet's parent is whoever first handed it tokens: the curve or
 * the pool for a buyer, another wallet for a hand-off. The trader on every
 * edge is the event's own `from`/`to`; the transaction sender is a relayer
 * on this chain and never appears here.
 *
 * Routers. Close to half of all buys reach the buyer through an aggregator
 * contract: the curve or pool pays the router, and the router forwards the
 * tokens in the same block. Taken literally, the router would be the
 * busiest "holder" on every token and the real buyer would look like a
 * wallet that was handed tokens with no cost basis. So a pass first finds
 * every same-block pass-through (in from a venue, straight out to a wallet;
 * or in from a wallet, straight out to a venue), treats those contracts as
 * part of the venue, and credits the trade to the wallet at the far end.
 */

/** A hop forwards between 90% and 100% of what came in: routers may keep a fee, never add. */
const HOP_MIN = 9n;
const HOP_DEN = 10n;

interface Hops {
  routers: Set<string>;
  /** `${block}:${router}` -> wallets the router delivered to, in order */
  buyTo: Map<string, string[]>;
  /** `${block}:${router}` -> wallets the router sold for, in order */
  sellFor: Map<string, string[]>;
}

function findHops(tape: Tape, base: Set<string>): Hops {
  const routers = new Set<string>();
  const buyTo = new Map<string, string[]>();
  const sellFor = new Map<string, string[]>();
  const token = lc(tape.launch.token);
  const transfers = tape.transfers;
  // Two rounds: a route can pass through two contracts back to back.
  for (let round = 0; round < 2; round++) {
    const venueSet = new Set([...base, ...routers]);
    const isVenue = (a: string) => venueSet.has(a);
    const isWallet = (a: string) => !isNonWallet(a, venueSet, token);
    let i = 0;
    while (i < transfers.length) {
      let j = i;
      while (j < transfers.length && transfers[j].block === transfers[i].block) j++;
      for (let k = i; k < j; k++) {
        const t = transfers[k];
        const from = lc(t.from);
        const to = lc(t.to);
        if (isVenue(from) && isWallet(to)) {
          // the next movement out of `to` in this block, if it goes on to a wallet
          for (let n = k + 1; n < j; n++) {
            const u = transfers[n];
            if (lc(u.from) !== to) continue;
            const dest = lc(u.to);
            if (isWallet(dest) && dest !== to && u.value <= t.value && u.value * HOP_DEN >= t.value * HOP_MIN) {
              routers.add(to);
              const key = `${t.block}:${to}`;
              const list = buyTo.get(key) ?? [];
              list.push(dest);
              buyTo.set(key, list);
            }
            break;
          }
        } else if (isWallet(from) && isVenue(to)) {
          // the last movement into `from` in this block, if it came from a wallet
          for (let n = k - 1; n >= i; n--) {
            const u = transfers[n];
            if (lc(u.to) !== from) continue;
            const src = lc(u.from);
            if (isWallet(src) && src !== from && t.value <= u.value && t.value * HOP_DEN >= u.value * HOP_MIN) {
              routers.add(from);
              const key = `${t.block}:${from}`;
              const list = sellFor.get(key) ?? [];
              list.push(src);
              sellFor.set(key, list);
            }
            break;
          }
        }
      }
      i = j;
    }
  }
  return { routers, buyTo, sellFor };
}

export function weave(tape: Tape): WeaverOut {
  const base = venues(tape);
  const hops = findHops(tape, base);
  const venueSet = new Set([...base, ...hops.routers]);
  const token = tape.launch.token;
  const wallets = new Map<string, Wallet>();
  const pairs = new Set<string>();
  const buys: WeaverOut["buys"] = [];
  const sells: WeaverOut["sells"] = [];
  let walletEdges = 0;
  let firstBuyer: string | null = null;
  let lastBuyer: string | null = null;

  const touch = (address: string, block: number, parent: string): Wallet => {
    let w = wallets.get(address);
    if (!w) {
      w = { address, balance: 0n, peak: 0n, bought: 0n, sold: 0n, received: 0n, sent: 0n, firstBlock: block, lastBlock: block, parent, firstBuyBlock: null, routed: false };
      wallets.set(address, w);
    }
    w.lastBlock = block;
    return w;
  };

  for (const t of tape.transfers) {
    const from = lc(t.from);
    const to = lc(t.to);
    if (from === to || t.value === 0n) continue;
    const fromWallet = !isNonWallet(from, venueSet, token);
    const toWallet = !isNonWallet(to, venueSet, token);
    const fromVenue = venueSet.has(from);
    const toVenue = venueSet.has(to);
    if (fromWallet || toWallet) pairs.add(`${from}>${to}`);

    if (fromWallet) {
      const w = touch(from, t.block, from);
      w.balance -= t.value;
      if (hops.routers.has(to)) w.routed = true;
      if (toVenue) { w.sold += t.value; sells.push({ wallet: from, block: t.block, tokens: t.value }); }
      else w.sent += t.value;
    }
    if (toWallet) {
      // a buyer's parent is the venue it bought from, not the router in between
      const w = touch(to, t.block, hops.routers.has(from) ? lc(tape.launch.curve) : from);
      w.balance += t.value;
      if (w.balance > w.peak) w.peak = w.balance;
      if (fromVenue) {
        if (hops.routers.has(from)) w.routed = true;
        w.bought += t.value;
        buys.push({ wallet: to, block: t.block, tokens: t.value });
        if (w.firstBuyBlock === null) w.firstBuyBlock = t.block;
        if (!firstBuyer) firstBuyer = to;
        lastBuyer = to;
      } else {
        w.received += t.value;
        if (fromWallet) walletEdges++;
      }
    }
  }

  const holders = [...wallets.values()]
    .filter((w) => w.balance > 0n)
    .sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
  const holdSupply = holders.reduce((s, w) => s + w.balance, 0n);

  // Curve trades name the router when one was used; hand each such trade to
  // the wallet the router served in that block, in order.
  const cursor = new Map<string, number>();
  const traderOf = (trade: TapeTrade): string => {
    const w = lc(trade.wallet);
    if (!hops.routers.has(w)) return w;
    const key = `${trade.block}:${w}`;
    const list = (trade.kind === "buy" ? hops.buyTo : hops.sellFor).get(key);
    if (!list?.length) return w;
    const ck = `${trade.kind}:${key}`;
    const i = cursor.get(ck) ?? 0;
    cursor.set(ck, i + 1);
    return list[Math.min(i, list.length - 1)];
  };
  const trades = tape.trades.map((t) => ({ ...t, wallet: traderOf(t) }));

  return {
    wallets,
    holders,
    nodes: wallets.size,
    edges: pairs.size,
    walletEdges,
    transfers: tape.transfers.length,
    firstBuyer,
    lastBuyer,
    holdSupply,
    routers: hops.routers,
    buys,
    sells,
    trades,
  };
}
