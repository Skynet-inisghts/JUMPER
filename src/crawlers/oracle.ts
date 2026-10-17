import { bandOf, CRAWLERS, labelOf } from "../score/scale.js";
import { scoreParts, type ScoreParts } from "../score/score.js";
import { SCORE, THRESHOLDS } from "../score/config.js";
import { isFlip } from "./snare.js";
import { isBotRecord } from "./scout.js";
import { BURN_ADDRESSES } from "../chain/chain.js";
import { blockTs, devSet, isNonWallet, venues, grouped, hasExited, lc, pctOf, pctText, short } from "./common.js";
import type {
  CrawlerName, CrawlerReport, DumpImpact, EarlyBuyer, Fill, Market, Operators, Outcome, Panels, Role, Rug, RugGroup, Flag, HolderRow, KnotOut, LedgerOut, LogLine, Metrics, Report,
  ScoutOut, SieveOut, SnareOut, Tape, TrackerOut, Wallet, WeaverOut,
} from "./types.js";

export interface Crawled {
  web: WeaverOut;
  tracked: TrackerOut;
  snared: SnareOut;
  scouted: ScoutOut;
  knotted: KnotOut;
  books: LedgerOut;
  sieved: SieveOut;
}

const SUBLINES = {
  TORN: "most of the web has already let go",
  PATCHED: "the web holds, with holes in it",
  TAUT: "the web is holding its weight",
} as const;

/**
 * ORACLE: collapses everything the swarm found into one score and one
 * verdict, plus the material every surface prints: the three fact lines,
 * the holder table with its flags, each crawler's log, the smart wallets'
 * fills and a small graph for the run view.
 */
export function oracle(tape: Tape, c: Crawled): Omit<Report, "provenance"> {
  const supply = tape.launch.totalSupply;
  const { web, tracked, snared, scouted, knotted, books, sieved } = c;

  const hold = pctOf(web.holdSupply, supply);
  // Gone is a flow (peaks of wallets now empty) and churn can push it past
  // the whole supply; it is capped at what holders do not hold.
  const gone = Math.min(100 - hold, pctOf(tracked.goneSupply, supply));
  const smartSupply = pctOf(scouted.smartSupply, supply);
  const sniperSupply = pctOf(snared.sniperTokens, supply);
  const sniperHeld = pctOf(snared.sniperHeld, supply);
  const bundleSupply = pctOf(knotted.bundleSupply, supply);
  const exitPressure = pctOf(tracked.exitPressureTokens, supply);
  const firstMinuteKept = snared.firstMinuteKept === null ? null : Math.round(snared.firstMinuteKept * 1000) / 10;

  // The score judges people. Snipers and wallets that sold out within ten
  // minutes of buying were trading the launch, not holding it: they are left
  // out. What is left is measured two ways and averaged, because each alone
  // lies: a count of real holders still in punishes age (an old token has
  // seen thousands come and go), and the share of held supply that has sat
  // still a while flatters a dead token whose last holders are simply stuck.
  const snipers = new Set(snared.snipers.map((s) => s.wallet));
  const flipBlocks = Math.round(THRESHOLDS.flipSec / tape.secPerBlock);
  let realIn = 0;
  let realOut = 0;
  let flips = 0;
  for (const w of web.wallets.values()) {
    if (w.bought === 0n || snipers.has(w.address)) continue;
    if (isFlip(w, flipBlocks)) { flips++; continue; }
    if (hasExited(w.balance, w.peak)) realOut++;
    else realIn++;
  }
  const stillIn = realIn + realOut > 0 ? realIn / (realIn + realOut) : 0;
  const age = Math.max(1, tape.now - tape.launch.launchedAt);
  const settledBlocks = Math.max(THRESHOLDS.settledSec, age * THRESHOLDS.settledLifeShare) / tape.secPerBlock;
  let settled = 0n;
  for (const h of web.holders) if (tape.headBlock - h.firstBlock >= settledBlocks) settled += h.balance;
  const settledShare = web.holdSupply > 0n ? Number((settled * 10_000n) / web.holdSupply) / 10_000 : 0;
  const realRetention = (stillIn + settledShare) / 2;

  const parts = scoreParts({ holding: realRetention, firstMinuteKept, smartSupply, sniperSupply: sniperHeld, exitPressure, bundleSupply, devState: tracked.devState });
  const score = parts.score;
  const band = bandOf(score);

  const metrics: Metrics = {
    holders: web.holders.length,
    transfers: web.transfers,
    hold,
    gone,
    smart: scouted.smart.length,
    smartSupply,
    sniperSupply,
    sniperHeld,
    sniperWallets: snared.snipers.length,
    sniperExited: snared.sniperExited,
    bundles: knotted.clusters.length,
    bundleSupply,
    firstMinuteKept,
    flips,
    devState: tracked.devState,
    exitPressure,
    winrate: scouted.avgWinrate === null ? null : Math.round(scouted.avgWinrate * 10) / 10,
    score,
  };

  const qd = 10 ** tape.launch.pairDecimals;
  const takenOut = Number(tracked.takenOutQuote) / qd;

  const smartWord = scouted.smart.length === 1 ? "smart wallet" : "smart wallets";
  const devPhrase = tracked.devState === "dumped" ? "dev dumped it" : tracked.devState === "sold half" ? "dev sold half" : "dev kept it";
  const facts: [string, string, string] = [
    `${pctText(hold)} still holding · ${pctText(gone)} already gone`,
    scouted.online
      ? `${scouted.smart.length} ${smartWord} on ${pctText(smartSupply)} · ${devPhrase}`
      : `smart money unread · ${devPhrase}`,
    `${pctText(sniperSupply)} sniped · ${plural(web.holders.length, "holder")}`,
  ];

  const candles = chart(tape, c);
  const ops = operators(tape, c);
  const mkt = market(tape, c);
  return {
    version: 1,
    token: {
      address: tape.launch.token,
      symbol: tape.launch.symbol,
      name: tape.launch.name,
      pairSymbol: tape.launch.pairSymbol,
      graduated: tape.launch.graduated,
      phaseLabel: tape.launch.phaseLabel,
      curveProgress: tape.launch.curveProgress,
      launchedAt: tape.launch.launchedAt,
      ageSec: Math.max(0, tape.now - tape.launch.launchedAt),
      deployer: tape.launch.deployer,
    },
    score,
    band: band.band,
    label: labelOf(score),
    verdict: band.verdict,
    subline: SUBLINES[band.band],
    outcome: outcomeOf(tape, c),
    metrics,
    quadrants: {
      web: { retention: snared.retention, hold, gone, firstMinuteKept, realRetention: Math.round(realRetention * 1000) / 10, stillIn: Math.round(stillIn * 1000) / 10, settled: Math.round(settledShare * 1000) / 10, flips, firstMinuteBots: snared.firstMinuteBots },
      silk: { smart: scouted.smart.length, smartSupply, winrate: metrics.winrate, scanned: scouted.scanned, online: scouted.online },
      snare: { sniperSupply, sniperHeld, sniperWallets: snared.snipers.length, sniperExited: snared.sniperExited, bundles: knotted.clusters.length, bundleSupply },
      exit: {
        exitPressure, soldHour: pctOf(tracked.soldHour, supply), boughtHour: pctOf(tracked.boughtHour, supply),
        devState: tracked.devState, devSoldPct: Math.round(tracked.devSoldPct * 1000) / 10,
        takenOut, takenOutUsd: tape.quoteUsd !== null ? takenOut * tape.quoteUsd : null, pairSymbol: tape.launch.pairSymbol,
      },
    },
    market: mkt,
    dump: dumpImpact(tape, c, ops, mkt),
    facts,
    crawlers: crawlerReports(tape, c, metrics),
    chart: candles,
    rug: rugCheck(tape, c, candles),
    sellingNow: sellingNow(tape, c),
    holderCurve: holderCurve(tape, c),
    panels: panels(tape, c, parts),
    holders: withOperators(holderRows(tape, c), ops),
    operators: ops,
    early: earlyBuyers(tape, c),
    devHistory: devHistory(tape),
    fills: fills(tape, c),
    graph: graph(tape, c),
  };
}

/**
 * The deployer's other launches: dead when nobody traded it for a day,
 * quiet when fewer than twenty wallets ever touched it.
 */
function devHistory(tape: Tape): Report["devHistory"] {
  const d = tape.devLaunches;
  if (!d) return null;
  const day = Math.round(86_400 / tape.secPerBlock);
  const dead = d.tokens.filter((t) => t.lastBlock > 0 && tape.headBlock - t.lastBlock > day).length;
  const quiet = d.tokens.filter((t) => t.wallets < 20).length;
  return { ...d, dead, quiet };
}

/**
 * What kind of wallet each one is: dev, insider, sniper, bot, whale, smart,
 * bundle, fresh, trader, router, transfer. One reader for every table that
 * names wallets, so a wallet is the same thing everywhere in the report.
 */
function roleReader(tape: Tape, c: Crawled): (w: Wallet) => { roles: Role[]; insider: boolean; funder: string | undefined } {
  const dev = devSet(tape);
  const snipers = new Set(c.snared.snipers.map((s) => s.wallet));
  const smart = new Set(c.scouted.smart.map((s) => s.wallet));
  const virgins = new Set(c.scouted.virgins);
  const funding = new Map(tape.funding.map((f) => [f.wallet, f.funder]));
  const declared = new Set(tape.launch.exemptions.map((a) => a.toLowerCase()));
  const clustered = new Set(c.knotted.clusters.flatMap((k) => k.wallets));
  return (h) => {
    const hist = tape.history?.[h.address];
    const book = c.books.books.get(h.address);
    const share = pctOf(h.balance, tape.launch.totalSupply);
    const funder = funding.get(h.address);
    const insider = !dev.has(h.address) && (dev.has(h.parent) || (funder !== undefined && dev.has(funder)) || declared.has(h.address));
    const roles: Role[] = [];
    if (dev.has(h.address)) roles.push("dev");
    if (insider) roles.push("insider");
    if (snipers.has(h.address)) roles.push("sniper");
    if (hist && isBotRecord(hist)) roles.push("bot");
    if (share >= THRESHOLDS.whalePct || (book?.valueUsd ?? 0) >= THRESHOLDS.whaleUsd) roles.push("whale");
    if (smart.has(h.address)) roles.push("smart");
    if (clustered.has(h.address)) roles.push("bundle");
    if (virgins.has(h.address)) roles.push("fresh");
    else if (hist && hist.markets > 0 && !roles.includes("bot") && !roles.includes("smart")) roles.push("trader");
    else if (!hist?.markets && h.routed) roles.push("router");
    if (h.bought === 0n && h.received > 0n) roles.push("transfer");
    return { roles, insider, funder };
  };
}

/**
 * The first twenty wallets to buy, in order: how soon after launch, how much
 * of the supply their first buy took, what they hold now and what they did
 * since.
 */
function earlyBuyers(tape: Tape, c: Crawled): EarlyBuyer[] {
  const roleOf = roleReader(tape, c);
  const supply = tape.launch.totalSupply;
  const first = new Map<string, { block: number; tokens: bigint }>();
  const buys = [...c.web.buys].sort((a, b) => a.block - b.block);
  for (const b of buys) {
    const seen = first.get(b.wallet);
    if (seen) { if (seen.block === b.block) seen.tokens += b.tokens; continue; }
    if (first.size >= 20) break;
    first.set(b.wallet, { block: b.block, tokens: b.tokens });
  }
  return [...first.entries()].map(([wallet, b]) => {
    const w = c.web.wallets.get(wallet);
    const now = w ? pctOf(w.balance, supply) : 0;
    let status: EarlyBuyer["status"] = "holding";
    let soldPct = 0;
    if (w && w.peak > 0n) {
      soldPct = Math.round(Number(((w.peak - w.balance) * 1000n) / w.peak) / 10);
      if (hasExited(w.balance, w.peak)) status = w.sent > w.sold ? "moved" : "sold";
      else if (w.balance > b.tokens && soldPct < 5) status = "added";
      else if (soldPct >= 5) status = "partly sold";
    }
    return {
      wallet,
      delayBlocks: b.block - tape.launch.launchBlock,
      delaySec: Math.max(0, Math.round((b.block - tape.launch.launchBlock) * tape.secPerBlock)),
      atBuy: pctOf(b.tokens, supply),
      now,
      status,
      soldPct,
      roles: w ? roleOf(w).roles : [],
    };
  });
}

/**
 * Who sold from `fromBlock` on, by what is known of every seller without its
 * history: the launch, the first minute, the funding graph, how long it
 * held. Share of all tokens sold in the window, and how many wallets.
 */
function sellersSince(tape: Tape, c: Crawled, fromBlock: number): Rug["sellers"] {
  const roleOf = roleReader(tape, c);
  const firstMinute = new Set(c.snared.firstMinute);
  const flipBlocks = Math.round(THRESHOLDS.flipSec / tape.secPerBlock);
  const groups = new Map<RugGroup, { wallets: Set<string>; tokens: bigint }>();
  let total = 0n;
  for (const s of c.web.sells) {
    if (s.block < fromBlock) continue;
    const w = c.web.wallets.get(s.wallet);
    const roles = w ? roleOf(w).roles : [];
    const g: RugGroup = roles.includes("dev") || roles.includes("insider") ? "dev and insiders"
      : roles.includes("sniper") ? "snipers" : roles.includes("bundle") ? "bundles"
      : roles.includes("transfer") ? "got it by transfer"
      : w && isFlip(w, flipBlocks) ? "ten-minute flippers"
      : firstMinute.has(s.wallet) ? "first-minute buyers" : "later buyers";
    const v = groups.get(g) ?? { wallets: new Set<string>(), tokens: 0n };
    v.wallets.add(s.wallet);
    v.tokens += s.tokens;
    groups.set(g, v);
    total += s.tokens;
  }
  return [...groups.entries()]
    .map(([group, v]) => ({ group, wallets: v.wallets.size, share: total > 0n ? Number((v.tokens * 1000n) / total) / 10 : 0 }))
    .sort((a, b) => b.share - a.share);
}

/** The last hour's sellers by kind: who is leaving right now. */
const sellingNow = (tape: Tape, c: Crawled): Rug["sellers"] =>
  sellersSince(tape, c, tape.headBlock - Math.round(3600 / tape.secPerBlock));

/**
 * A price that fell 80% or more from its peak: how deep, how long ago, and
 * who did the selling since the peak, by kind of wallet. Null when the
 * price is within reach of its high.
 */
function rugCheck(tape: Tape, c: Crawled, candles: Report["chart"]): Rug | null {
  if (candles.length < 2) return null;
  let peak = 0;
  for (let i = 1; i < candles.length; i++) if (candles[i].h > candles[peak].h) peak = i;
  const high = candles[peak].h;
  const last = candles[candles.length - 1].c;
  if (!(high > 0)) return null;
  const drawdown = Math.round((1 - last / high) * 1000) / 10;
  if (drawdown < THRESHOLDS.rugDrawdownPct) return null;
  const peakBlock = tape.launch.launchBlock + Math.floor((candles[peak].t - tape.launch.launchedAt) / tape.secPerBlock);
  const sellers = sellersSince(tape, c, peakBlock);
  // A crowd selling a top is a collapse; a dev that dumped, or a launch side
  // doing the selling, is a rug. Flippers buy back what they sell, so their
  // volume is left out of the comparison.
  const held = sellers.filter((x) => x.group !== "ten-minute flippers");
  const heldTotal = held.reduce((a, x) => a + x.share, 0);
  const inside = held.filter((x) => x.group !== "later buyers").reduce((a, x) => a + x.share, 0);
  const rugged = c.tracked.devState === "dumped" || (heldTotal > 0 && (inside / heldTotal) * 100 >= THRESHOLDS.rugInsideSharePct);
  return { drawdown, peakAgoSec: Math.max(0, tape.now - candles[peak].t), rugged, devState: c.tracked.devState, sellers };
}

/** TOO EARLY with too few holders to read; NO VERDICT when the supply was handed out, not bought. */
function outcomeOf(tape: Tape, c: Crawled): Outcome | null {
  const n = c.web.holders.length;
  if (n < THRESHOLDS.tooEarlyHolders) {
    return { kind: "too early", why: `${n} holder${n === 1 ? "" : "s"} so far: too few to read, crawl it again once people buy in` };
  }
  const dev = devSet(tape);
  const dropped = c.web.holders.filter((h) => h.bought === 0n && h.received > 0n && !dev.has(h.address));
  const droppedHeld = dropped.reduce((a, h) => a + h.balance, 0n);
  const share = c.web.holdSupply > 0n ? Number((droppedHeld * 1000n) / c.web.holdSupply) / 10 : 0;
  if (dropped.length >= THRESHOLDS.airdropWallets && share >= THRESHOLDS.airdropHeldPct) {
    return { kind: "no verdict", why: `${grouped(dropped.length)} holders never bought, they were sent ${Math.round(share)}% of what is held: an airdrop, the score cannot judge it` };
  }
  return null;
}

/**
 * The market strip: price and cap from the crawl's own price, liquidity
 * from the curve's quote reserve or the DEX after graduation, and the last
 * day's volume from the trades read.
 */
function market(tape: Tape, c: Crawled): Market {
  const qd = 10 ** tape.launch.pairDecimals;
  const usd = tape.quoteUsd;
  const priceUsd = c.books.priceUsd;
  const whole = Number(tape.launch.totalSupply) / 1e18;
  let liquidityUsd: number | null = null;
  if (tape.launch.graduated) liquidityUsd = tape.liquidityUsd ?? null;
  else if (usd !== null && tape.launch.quoteReserve !== undefined) liquidityUsd = (Number(tape.launch.quoteReserve) / qd) * usd;
  const dayAgo = tape.headBlock - Math.round(86_400 / tape.secPerBlock);
  let vol = 0;
  let n = 0;
  for (const t of c.web.trades) if (t.block >= dayAgo) { vol += Number(t.quoteWei) / qd; n++; }
  for (const s of tape.swaps ?? []) if (s.block >= dayAgo) { vol += Number(s.quote) / qd; n++; }
  const top10 = c.web.holders.slice(0, 10).reduce((a, h) => a + h.balance, 0n);
  return {
    priceUsd,
    mcapUsd: priceUsd !== null ? priceUsd * whole : null,
    liquidityUsd,
    liquidityIn: tape.launch.graduated ? "pool" : "curve",
    vol24hUsd: usd !== null ? vol * usd : null,
    vol24hQuote: vol,
    trades24h: n,
    top10: pctOf(top10, tape.launch.totalSupply),
  };
}

/**
 * Operators: the top fifty holders tied into the hands behind them. Two
 * wallets are one hand when tokens went straight from one to the other,
 * when both got their first tokens, without buying, from the same wallet,
 * when KNOT found them funded from one source inside its window, or when
 * three or more bought in the same block within 2% of the same amount.
 */
function operators(tape: Tape, c: Crawled): Operators {
  const top = c.web.holders.slice(0, 50).map((h) => h.address);
  const inTop = new Set(top);
  const parent = new Map(top.map((a) => [a, a]));
  const find = (a: string): string => { let x = a; while (parent.get(x) !== x) x = parent.get(x)!; parent.set(a, x); return x; };
  const ties = new Map<string, Set<"transfer" | "funder" | "same block" | "same sender">>();
  const join = (a: string, b: string, why: "transfer" | "funder" | "same block" | "same sender") => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
    for (const w of [a, b]) { const t = ties.get(w) ?? new Set(); t.add(why); ties.set(w, t); }
  };
  for (const t of tape.transfers) {
    const f = lc(t.from), to = lc(t.to);
    if (f !== to && inTop.has(f) && inTop.has(to)) join(f, to, "transfer");
  }
  // wallets whose first tokens came from one wallet (not a venue): handed out by one hand
  const venueSet = venues(tape);
  const bySender = new Map<string, string[]>();
  for (const h of c.web.holders.slice(0, 50)) {
    if (h.bought > 0n || !h.parent || venueSet.has(h.parent) || c.web.routers.has(h.parent)) continue;
    bySender.set(h.parent, [...(bySender.get(h.parent) ?? []), h.address]);
  }
  for (const ws of bySender.values()) for (let i = 1; i < ws.length; i++) join(ws[0], ws[i], "same sender");
  for (const k of c.knotted.clusters) {
    const mine = k.wallets.filter((w) => inTop.has(w));
    for (let i = 1; i < mine.length; i++) join(mine[0], mine[i], "funder");
  }
  const firstBuy = new Map<string, { block: number; tokens: bigint }>();
  for (const b of c.web.buys) if (inTop.has(b.wallet) && !firstBuy.has(b.wallet)) firstBuy.set(b.wallet, b);
  const byBlock = new Map<number, { wallet: string; tokens: bigint }[]>();
  for (const [wallet, b] of firstBuy) byBlock.set(b.block, [...(byBlock.get(b.block) ?? []), { wallet, tokens: b.tokens }]);
  for (const group of byBlock.values()) {
    if (group.length < 3) continue;
    group.sort((a, b) => (a.tokens < b.tokens ? -1 : 1));
    // runs of near-equal buys inside the block
    let run = [group[0]];
    const flush = () => { if (run.length >= 3) for (let i = 1; i < run.length; i++) join(run[0].wallet, run[i].wallet, "same block"); };
    for (let i = 1; i < group.length; i++) {
      const prev = run[run.length - 1].tokens;
      if (prev > 0n && (group[i].tokens - prev) * 50n <= prev) run.push(group[i]);
      else { flush(); run = [group[i]]; }
    }
    flush();
  }
  const comps = new Map<string, string[]>();
  for (const a of top) comps.set(find(a), [...(comps.get(find(a)) ?? []), a]);
  const balance = new Map(c.web.holders.map((h) => [h.address, h.balance]));
  const groups = [...comps.values()]
    .filter((ws) => ws.length >= 2)
    .map((ws) => ({ ws, held: ws.reduce((a, w) => a + (balance.get(w) ?? 0n), 0n) }))
    .sort((a, b) => (a.held > b.held ? -1 : a.held < b.held ? 1 : 0))
    .map(({ ws, held }, i) => ({
      id: i + 1,
      wallets: ws,
      share: pctOf(held, tape.launch.totalSupply),
      ties: [...new Set(ws.flatMap((w) => [...(ties.get(w) ?? [])]))],
    }));
  return { wallets: top.length, hands: comps.size, groups };
}

/**
 * The biggest hand (an operator, or the top wallet when it holds more)
 * sold whole into today's liquidity: on the curve through its own pricing
 * reserves, x * y = k; after graduation the pool's dollar liquidity read
 * as a full-range pool, so an estimate. Fees and other trades left out.
 */
function dumpImpact(tape: Tape, c: Crawled, ops: Operators, mkt: Market): DumpImpact | null {
  const top = c.web.holders[0];
  if (!top) return null;
  const supply = tape.launch.totalSupply;
  const balance = new Map(c.web.holders.map((h) => [h.address, h.balance]));
  const g = ops.groups[0];
  const gHeld = g ? g.wallets.reduce((a, w) => a + (balance.get(w) ?? 0n), 0n) : 0n;
  const useOp = g !== undefined && gHeld > top.balance;
  const held = useOp ? gHeld : top.balance;
  let tokenReserve: number | null = null;
  let basis: DumpImpact["basis"] = "curve";
  if (!tape.launch.graduated && tape.launch.virtualReserves) tokenReserve = Number(tape.launch.virtualReserves[1]) / 1e18;
  else if (tape.launch.graduated && mkt.liquidityUsd && mkt.priceUsd) {
    tokenReserve = mkt.liquidityUsd / 2 / mkt.priceUsd;
    basis = "pool estimate";
  }
  if (!tokenReserve || tokenReserve <= 0) return null;
  const R = tokenReserve;
  const drop = (tokens: bigint) => { const left = R / (R + Number(tokens) / 1e18); return Math.round((1 - left * left) * 1000) / 10; };
  // the overhang: holders sitting on 3x or more, who have a reason to sell
  const inProfit = c.web.holders.filter((h) => (c.books.books.get(h.address)?.pnlPct ?? -Infinity) >= THRESHOLDS.overhangPnlPct);
  const profitHeld = inProfit.reduce((a, h) => a + h.balance, 0n);
  return {
    who: useOp ? "operator" : "wallet",
    wallets: useOp ? g!.wallets.length : 1,
    share: pctOf(held, supply),
    drop: drop(held),
    basis,
    overhang: inProfit.length ? { wallets: inProfit.length, share: pctOf(profitHeld, supply), drop: drop(profitHeld) } : null,
  };
}

const withOperators = (rows: HolderRow[], ops: Operators): HolderRow[] => {
  const of = new Map(ops.groups.flatMap((g) => g.wallets.map((w) => [w, g.id] as const)));
  return rows.map((r) => ({ ...r, op: of.get(r.wallet) ?? null }));
};

/** The top fifty holders, each with a few words on who it is. */
function holderRows(tape: Tape, c: Crawled): HolderRow[] {
  const roleOf = roleReader(tape, c);
  // what each wallet burned, and when it last sold
  const burned = new Map<string, bigint>();
  for (const t of tape.transfers) {
    if (!BURN_ADDRESSES.has(lc(t.to))) continue;
    const f = lc(t.from);
    burned.set(f, (burned.get(f) ?? 0n) + t.value);
  }
  const lastSell = new Map<string, number>();
  for (const s of c.web.sells) if (s.block > (lastSell.get(s.wallet) ?? 0)) lastSell.set(s.wallet, s.block);
  const pctOfGot = (x: bigint, got: bigint) => (got > 0n ? Math.round(Number((x * 1000n) / got)) / 10 : 0);
  const dev = devSet(tape);
  const snipers = new Map(c.snared.snipers.map((s) => [s.wallet, s]));
  const smart = new Map(c.scouted.smart.map((s) => [s.wallet, s]));
  const virgins = new Set(c.scouted.virgins);
  const shortHist = new Set(c.scouted.shortHistory);
  const clean = new Set(c.sieved.clean);
  const declared = new Set(tape.launch.exemptions.map((a) => a.toLowerCase()));
  const clusters = new Map<string, number>();
  c.knotted.clusters.forEach((k) => k.wallets.forEach((w) => clusters.set(w, k.wallets.length)));
  return c.web.holders.slice(0, 50).map((h) => {
    const flags: Flag[] = [];
    if (dev.has(h.address)) flags.push("deployer");
    if (snipers.has(h.address)) flags.push("sniper");
    if (virgins.has(h.address)) flags.push("virgin");
    if (h.bought === 0n && h.received > 0n) flags.push("transfer");
    if (shortHist.has(h.address)) flags.push("short history");
    if (smart.has(h.address)) flags.push("smart");
    if (!flags.length && clean.has(h.address)) flags.push("clean");
    const book = c.books.books.get(h.address);
    const hist = tape.history?.[h.address];

    // who it is, most telling first
    let who: string;
    const sn = snipers.get(h.address);
    const sm = smart.get(h.address);
    if (dev.has(h.address)) who = "the launcher's own wallet";
    else if (sn) who = `sniper, bought in block +${sn.block - tape.launch.launchBlock}`;
    else if (hist && hist.markets >= THRESHOLDS.botMarkets) who = `trading bot, ${grouped(hist.markets)} tokens traded`;
    else if (hist && isBotRecord(hist)) who = `bot, won ${Math.round(hist.winrate ?? 0)}% of ${grouped(hist.positions)} trades`;
    else if (sm) who = `smart money, ${Math.round(sm.winrate)}% winrate over ${sm.positions} closed`;
    else if (clusters.has(h.address)) who = `bundle, funded with ${clusters.get(h.address)! - 1} other wallet${clusters.get(h.address) === 2 ? "" : "s"}`;
    else if (h.bought === 0n && h.received > 0n) who = `got it by transfer from ${short(h.parent)}`;
    else if (virgins.has(h.address)) who = "first trade of its life";
    else if (hist && hist.markets > 0) who = `trader, ${grouped(hist.markets)} other token${hist.markets === 1 ? "" : "s"}${hist.winrate === null ? ", no closed trades" : `, ${Math.round(hist.winrate)}% winrate`}`;
    else if (h.routed) who = "buys through a router, history not visible";
    else if (!tape.history) who = "holder, history not read";
    else who = "holder";

    // roles: what kind of wallet this is, independent of the sentence above
    const share = pctOf(h.balance, tape.launch.totalSupply);
    const { roles, insider, funder } = roleOf(h);
    if (insider && who === `got it by transfer from ${short(h.parent)}`) who = `insider, got it from the dev`;
    else if (insider && !dev.has(h.address) && !sn) who = funder && dev.has(funder) ? "insider, funded by the dev" : declared.has(h.address) ? "insider, declared in the launch bundle" : who;

    return {
      wallet: h.address,
      share,
      roles,
      flags,
      valueUsd: book?.valueUsd ?? null,
      pnlPct: book?.pnlPct ?? null,
      winrate: hist?.winrate ?? null,
      who,
      markets: hist ? hist.markets : null,
      heldSec: Math.max(0, Math.round((tape.headBlock - h.firstBlock) * tape.secPerBlock)),
      exit: (() => {
        const got = h.bought + h.received;
        const burnt = burned.get(h.address) ?? 0n;
        const moved = h.sent > burnt ? h.sent - burnt : 0n;
        return { sold: pctOfGot(h.sold, got), moved: pctOfGot(moved, got), burned: pctOfGot(burnt, got) };
      })(),
      lastSellSec: lastSell.has(h.address) ? Math.max(0, Math.round((tape.headBlock - lastSell.get(h.address)!) * tape.secPerBlock)) : null,
    };
  });
}

/**
 * The smart cohort's trades on this token, or the top holders' when no wallet
 * is smart. Every buy and sale the transfer log shows, curve and pool alike;
 * a curve trade carries its own quote, a pool trade is priced at the
 * wallet's average entry or exit and marked estimated.
 */
function fills(tape: Tape, c: Crawled): Fill[] {
  const watch = new Set(c.scouted.smart.length ? c.scouted.smart.map((s) => s.wallet) : c.web.holders.slice(0, 10).map((h) => h.address));
  const qd = 10 ** tape.launch.pairDecimals;
  const exact = new Map<string, number>();
  for (const t of c.web.trades) {
    if (!watch.has(t.wallet)) continue;
    const key = `${t.kind}:${t.block}:${t.wallet}`;
    exact.set(key, (exact.get(key) ?? 0) + Number(t.quoteWei) / qd);
  }
  // pool swaps carry their quote but not the trader: price a pool trade at
  // the swap in the same block that moved the same side
  const swapPx = new Map<string, number>();
  for (const s of tape.swaps ?? []) if (s.tokens > 0n) swapPx.set(`${s.buy ? "buy" : "sell"}:${s.block}`, Number(s.quote) / Number(s.tokens));
  const out: Fill[] = [];
  const push = (kind: "buy" | "sell", e: { wallet: string; block: number; tokens: bigint }) => {
    if (!watch.has(e.wallet)) return;
    const tokens = Number(e.tokens) / 1e18;
    const key = `${kind}:${e.block}:${e.wallet}`;
    const own = exact.get(key);
    let quote: number;
    let estimated = false;
    const px = swapPx.get(`${kind}:${e.block}`);
    if (own !== undefined) {
      quote = own;
      exact.delete(key);
    } else if (px !== undefined) {
      quote = (Number(e.tokens) * px) / qd;
    } else {
      const b = c.books.books.get(e.wallet);
      const avg = kind === "buy" ? b?.avgEntryQuote ?? null : b && b.sold > 0 ? b.proceedsQuote / b.sold : null;
      const px = avg ?? c.books.priceQuote;
      if (px === null) return;
      quote = tokens * px;
      estimated = true;
    }
    out.push({ wallet: e.wallet, kind, block: e.block, ts: Math.round(blockTs(tape, e.block)), tokens, quote, usd: tape.quoteUsd !== null ? quote * tape.quoteUsd : null, estimated });
  };
  for (const b of c.web.buys) push("buy", b);
  for (const s of c.web.sells) push("sell", s);
  out.sort((a, b) => a.block - b.block);
  return out.slice(-200);
}

/** A small four-layer picture: contract, a sample of trades, the top holders, their other markets. */
function graph(tape: Tape, c: Crawled): Report["graph"] {
  const nodes: Report["graph"]["nodes"] = [{ id: tape.launch.token, layer: 0, kind: "contract", state: "neutral" }];
  const links: [number, number][] = [];
  const smart = new Set(c.scouted.smart.map((s) => s.wallet));
  const snipers = new Set(c.snared.snipers.map((s) => s.wallet));
  const holders = c.web.holders.slice(0, 18).map((h) => h.address);
  const exited = c.tracked.exited.slice(0, 6).map((w) => w.address);
  const people = [...holders, ...exited];
  const stateOf = (w: string): Report["graph"]["nodes"][number]["state"] =>
    smart.has(w) ? "smart" : snipers.has(w) ? "sniper" : exited.includes(w) ? "gone" : "held";

  const txIdx: number[] = [];
  const sampleTrades = c.web.trades.filter((t) => people.includes(t.wallet)).slice(0, 14);
  for (const t of sampleTrades) {
    txIdx.push(nodes.length);
    nodes.push({ id: `${t.block}:${t.logIndex}`, layer: 1, kind: "tx", state: "neutral" });
    links.push([0, nodes.length - 1]);
  }
  const holderIdx = new Map<string, number>();
  for (const w of people) {
    holderIdx.set(w, nodes.length);
    nodes.push({ id: w, layer: 2, kind: "holder", state: stateOf(w) });
  }
  sampleTrades.forEach((t, i) => {
    const h = holderIdx.get(t.wallet);
    if (h !== undefined) links.push([txIdx[i], h]);
  });
  for (const w of holders) if (!sampleTrades.some((t) => t.wallet === w)) links.push([0, holderIdx.get(w)!]);
  let hist = 0;
  for (const w of holders) {
    const h = tape.history?.[w];
    if (!h || h.markets === 0 || hist >= 12) continue;
    nodes.push({ id: `${w}:history`, layer: 3, kind: "history", state: smart.has(w) ? "smart" : "neutral" });
    links.push([holderIdx.get(w)!, nodes.length - 1]);
    hist++;
  }
  return { nodes, links };
}

function crawlerReports(tape: Tape, c: Crawled, m: Metrics): CrawlerReport[] {
  const { web, tracked, snared, scouted, knotted, books, sieved } = c;
  const unit = tape.launch.pairSymbol;
  const supply = tape.launch.totalSupply;
  const q = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toPrecision(2));
  const lines: Record<CrawlerName, LogLine[]> = { WEAVER: [], TRACKER: [], SNARE: [], SCOUT: [], KNOT: [], LEDGER: [], SIEVE: [], ORACLE: [] };
  const say = (crawler: CrawlerName, kind: LogLine["kind"], text: string, wallet?: string) => lines[crawler].push({ crawler, kind, text, wallet });

  for (const h of web.holders.slice(0, 24)) {
    const parent = h.parent === lc(tape.launch.curve) ? "curve" : web.wallets.has(h.parent) ? short(h.parent) : "pool";
    say("WEAVER", h.bought === 0n ? "link" : "walk", `${short(h.address)} • ${parent === "curve" || parent === "pool" ? `bought from the ${parent}` : `funded by transfer from ${parent}`}`, h.address);
  }
  say("WEAVER", "verdict", `graph ${grouped(web.nodes)} nodes, ${grouped(web.edges)} edges, ${grouped(web.transfers)} transfers`);

  for (const w of tracked.exited.slice(0, 16)) {
    say("TRACKER", "trace", `${short(w.address)} • left, peak ${pctText(pctOf(w.peak, supply))} of supply`, w.address);
  }
  say("TRACKER", "verdict", `${grouped(tracked.exited.length)} gone with ${pctText(m.gone)} of supply · dev ${tracked.devState}`);

  for (const s of snared.snipers.slice(0, 12)) {
    say("SNARE", "flag", `${short(s.wallet)} • took ${pctText(pctOf(s.tokens, supply))} in block +${s.block - tape.launch.launchBlock}${s.exited ? ", already out" : ""}`, s.wallet);
  }
  say("SNARE", "verdict", `${plural(snared.snipers.length, "sniper")} on ${pctText(m.sniperSupply)} · ${snared.sniperExited} already out`);

  if (scouted.online) {
    for (const h of web.holders.slice(0, 40)) {
      const rec = tape.history?.[h.address];
      if (!rec) continue;
      const wr = rec.winrate === null ? "no closed trades" : `winrate ${Math.round(rec.winrate)}%`;
      say("SCOUT", "walk", `${short(h.address)} • ${grouped(rec.markets)} other tokens, ${wr}`, h.address);
    }
    for (const s of scouted.smart.slice(0, 8)) say("SCOUT", "flag", `${short(s.wallet)} • smart, ${Math.round(s.winrate)}% over ${s.positions} closed`, s.wallet);
    say("SCOUT", "verdict", `${scouted.smart.length} smart of ${scouted.scanned} scanned`);
  } else {
    say("SCOUT", "verdict", "index offline · wallet histories not read");
  }

  for (const f of tape.funding.slice(0, 16)) say("KNOT", "link", `${short(f.wallet)} • funded by ${short(f.funder)}`, f.wallet);
  for (const k of knotted.clusters.slice(0, 6)) {
    say("KNOT", "cluster", `cluster ${k.wallets.length} wallets, ${pctText(pctOf(k.supply, supply))} of float${k.declared ? " · declared at launch" : ""}`);
  }
  say("KNOT", "verdict", `${plural(knotted.clusters.length, "cluster")} · funding read for ${knotted.read} of ${knotted.looked}`);

  for (const b of [...books.books.values()].slice(0, 20)) {
    if (b.pnlPct === null) continue;
    say("LEDGER", "walk", `${short(b.wallet)} • entry ${b.avgEntryQuote === null ? "n/a" : q(b.avgEntryQuote)} ${unit} · ${b.pnlPct >= 0 ? "+" : ""}${b.pnlPct.toFixed(0)}%`, b.wallet);
  }
  say("LEDGER", "verdict", `${grouped(books.books.size)} books${books.avgPnlPct === null ? "" : ` · ${books.avgPnlPct >= 0 ? "+" : ""}${books.avgPnlPct.toFixed(1)}% avg`}`);

  for (const w of sieved.dust.slice(0, 6)) say("SIEVE", "walk", `${short(w)} • dust, dropped`, w);
  for (const w of sieved.transferOnly.slice(0, 6)) say("SIEVE", "walk", `${short(w)} • no cost basis, dropped`, w);
  for (const w of sieved.virgins.slice(0, 6)) say("SIEVE", "walk", `${short(w)} • first trade of its life, dropped`, w);
  say("SIEVE", "verdict", `${grouped(sieved.removed)} removed · ${grouped(sieved.clean.length)} clean`);

  say("ORACLE", "verdict", `${m.score} / 100 · ${bandOf(m.score).band} · ${bandOf(m.score).verdict}`);

  const stats: Record<CrawlerName, [string, string]> = {
    WEAVER: [`${grouped(web.nodes)} nodes`, `${grouped(web.edges)} edges`],
    TRACKER: [`${grouped(tracked.exited.length)} gone`, `${pctText(m.gone)} of supply`],
    SNARE: [plural(snared.snipers.length, "wallet"), `${pctText(m.sniperSupply)} of supply`],
    SCOUT: scouted.online ? [`${scouted.smart.length} found`, m.winrate === null ? "no smart money" : `${Math.round(m.winrate)}% winrate`] : ["offline", "index not set"],
    KNOT: [plural(knotted.clusters.length, "cluster"), `${pctText(m.bundleSupply)} of supply`],
    LEDGER: [`${grouped(books.books.size)} books`, books.avgPnlPct === null ? "no price" : `${books.avgPnlPct >= 0 ? "+" : ""}${books.avgPnlPct.toFixed(1)}% avg`],
    SIEVE: [`${grouped(sieved.removed)} removed`, "clean set"],
    ORACLE: [`${m.score} / 100`, bandOf(m.score).band === "TAUT" ? "THE WEB HOLDS" : bandOf(m.score).band === "PATCHED" ? "THE WEB SAGS" : "THE WEB TORE"],
  };

  return CRAWLERS.map((meta) => ({ name: meta.name, color: meta.color, role: meta.role, stats: stats[meta.name], lines: lines[meta.name] }));
}

/** 64 candles across the token's life; empty buckets carry the last close. */
/**
 * How many wallets held the token at the end of each candle: the transfer
 * log replayed in order, venues, routers and burns left out. Same 64 steps
 * over the token's life as the chart.
 */
function holderCurve(tape: Tape, c: Crawled): number[] {
  const N = 64;
  const from = tape.launch.launchBlock;
  const size = Math.max(N, tape.headBlock - from + 1) / N;
  const skip = new Set([...venues(tape), ...c.web.routers]);
  const isWallet = (a: string) => !isNonWallet(a, skip, tape.launch.token);
  const bal = new Map<string, bigint>();
  let holders = 0;
  const move = (a: string, d: bigint) => {
    const was = bal.get(a) ?? 0n;
    const now = was + d;
    if (was <= 0n && now > 0n) holders++;
    else if (was > 0n && now <= 0n) holders--;
    bal.set(a, now);
  };
  const ts = [...tape.transfers].sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
  const out: number[] = [];
  let k = 0;
  for (let i = 0; i < N; i++) {
    const end = from + (i + 1) * size;
    while (k < ts.length && ts[k].block < end) {
      const t = ts[k++];
      const f = lc(t.from), to = lc(t.to);
      if (isWallet(f)) move(f, -t.value);
      if (isWallet(to)) move(to, t.value);
    }
    out.push(holders);
  }
  return out;
}

function chart(tape: Tape, c: Crawled): Report["chart"] {
  const qd = 10 ** tape.launch.pairDecimals;
  const toWhole = 1e18 / qd;
  const pts: { block: number; px: number; v: number }[] = [];
  for (const t of c.web.trades) if (t.tokens > 0n) pts.push({ block: t.block, px: (Number(t.quoteWei) / Number(t.tokens)) * toWhole, v: Number(t.quoteWei) / qd });
  for (const s of tape.swaps ?? []) if (s.price > 0) pts.push({ block: s.block, px: s.price * toWhole, v: Number(s.quote) / qd });
  if (pts.length < 2) return [];
  pts.sort((a, b) => a.block - b.block);
  const N = 64;
  const from = tape.launch.launchBlock;
  const span = Math.max(N, tape.headBlock - from + 1);
  const size = span / N;
  const out: Report["chart"] = [];
  let last = pts[0].px;
  let k = 0;
  for (let i = 0; i < N; i++) {
    const end = from + (i + 1) * size;
    const o = last;
    let h = o, l = o, cl = o, v = 0;
    while (k < pts.length && pts[k].block < end) {
      const p = pts[k++].px;
      h = Math.max(h, p);
      l = Math.min(l, p);
      cl = p;
      v += pts[k - 1].v;
    }
    last = cl;
    out.push({ t: Math.round(blockTs(tape, from + i * size)), o, h, l, c: cl, v });
  }
  return out;
}

function panels(tape: Tape, c: Crawled, parts: ScoreParts): Panels {
  const supply = tape.launch.totalSupply;
  const { web, tracked, snared, scouted, knotted, books, sieved } = c;

  // how many children each of the busiest parents has: the fan the graph draws
  const kids = new Map<string, number>();
  for (const w of web.wallets.values()) if (web.wallets.has(w.parent) && w.parent !== w.address) kids.set(w.parent, (kids.get(w.parent) ?? 0) + 1);
  const fanout = [...kids.values()].sort((a, b) => b - a).slice(0, 8);

  const B = 24;
  const from = tape.launch.launchBlock;
  const span = Math.max(B, tape.headBlock - from + 1);
  const exitsByBucket = new Array<number>(B).fill(0);
  for (const w of tracked.exited) exitsByBucket[Math.min(B - 1, Math.floor(((w.lastBlock - from) / span) * B))]++;

  const smartSet = new Set(scouted.smart.map((s) => s.wallet));
  const scoutRows = web.holders
    .map((h) => ({ h, rec: tape.history?.[h.address] }))
    .filter((x) => x.rec && x.rec.markets > 0 && !isBotRecord(x.rec))
    .sort((a, b) => (b.rec!.winrate ?? -1) - (a.rec!.winrate ?? -1))
    .slice(0, 6)
    .map((x) => ({ wallet: x.h.address, winrate: x.rec!.winrate, markets: x.rec!.markets, smart: smartSet.has(x.h.address) }));

  const pnlBuckets = new Array<number>(12).fill(0);
  for (const b of books.books.values()) {
    if (b.pnlPct === null) continue;
    const v = Math.max(-100, Math.min(499, b.pnlPct));
    pnlBuckets[Math.min(11, Math.floor((v + 100) / 50))]++;
  }

  return {
    weaver: { nodes: web.nodes, edges: web.edges, walletEdges: web.walletEdges, routers: web.routers.size, firstBuyer: web.firstBuyer, lastBuyer: web.lastBuyer, fanout },
    tracker: {
      exitsByBucket,
      recent: [...tracked.exited].sort((a, b) => b.lastBlock - a.lastBlock).slice(0, 5).map((w) => ({ wallet: w.address, pct: pctOf(w.peak, supply) })),
    },
    snare: { rows: snared.snipers.slice(0, 6).map((s) => ({ wallet: s.wallet, pct: pctOf(s.tokens, supply), block: s.block - tape.launch.launchBlock, exited: s.exited })) },
    scout: { rows: scoutRows, scanned: scouted.scanned },
    knot: { rows: knotted.clusters.slice(0, 5).map((k) => ({ funder: k.funder, wallets: k.wallets.length, pct: pctOf(k.supply, supply), declared: k.declared })), read: knotted.read, looked: knotted.looked },
    ledger: { pnlBuckets, avgPnlPct: books.avgPnlPct, priceQuote: books.priceQuote, priceUsd: books.priceUsd },
    sieve: { dust: sieved.dust.length, transferOnly: sieved.transferOnly.length, virgins: sieved.virgins.length, clean: sieved.clean.length },
    oracle: {
      retention: parts.retention, kept: parts.kept, smart: parts.smart, sniper: parts.sniper, exit: parts.exit, bundle: parts.bundle, dev: parts.dev, base: parts.base,
      points: { holding: 100 * SCORE.weights.retention * parts.retention, kept: 100 * SCORE.weights.firstMinuteKept * parts.kept, smart: 100 * SCORE.weights.smartSupply * parts.smart },
    },
  };
}

const plural = (n: number, word: string) => `${grouped(n)} ${word}${n === 1 ? "" : "s"}`;
