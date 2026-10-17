/**
 * Shapes shared by the eight crawlers.
 *
 * A crawl is two halves. The live half reads the chain, the explorer and
 * the index and writes everything it saw onto a Tape. The pure half, the
 * crawlers themselves, read only the Tape: no network, no clock, no
 * randomness. Fixtures in test/fixtures are recorded Tapes, so the tests
 * run the exact code a live crawl runs, on data a real token produced.
 */

import type { Funding } from "../chain/funding.js";
import type { MarketBook, WalletHistory } from "../chain/history.js";

export interface TapeLaunch {
  token: string;
  symbol: string;
  name: string;
  curve: string;
  deployer: string;
  creatorFeeRecipient: string;
  pairToken: string;
  pairIsEth: boolean;
  pairSymbol: string;
  pairDecimals: number;
  phase: number;
  phaseLabel: string;
  graduated: boolean;
  curveProgress: number;
  /** The curve's quote reserve, quote base units (absent on older tapes). */
  quoteReserve?: bigint;
  /** The curve's pricing reserves (virtual quote, virtual tokens), base units (absent on older tapes). */
  virtualReserves?: [bigint, bigint] | null;
  launchedAt: number;
  launchBlock: number;
  totalSupply: bigint;
  devTokens: bigint;
  exemptions: string[];
}

export interface TapeTransfer {
  from: string;
  to: string;
  value: bigint;
  block: number;
  logIndex: number;
}

export interface TapeTrade {
  kind: "buy" | "sell";
  /** From the event's fields (recipient / seller), never tx.from. */
  wallet: string;
  quoteWei: bigint;
  tokens: bigint;
  taxWei: bigint;
  block: number;
  logIndex: number;
}

export interface TapeSwap {
  buy: boolean;
  tokens: bigint;
  quote: bigint;
  price: number;
  block: number;
  logIndex: number;
}

export interface Tape {
  version: 1;
  launch: TapeLaunch;
  /** Head block and its timestamp at observation; fixtures pin both. */
  headBlock: number;
  now: number;
  secPerBlock: number;
  transfers: TapeTransfer[];
  trades: TapeTrade[];
  /** Swaps on the v4 pool after graduation (absent on older tapes). */
  swaps?: TapeSwap[];
  /** False when some log chunk was refused and never read: the crawl says so. */
  logsComplete: boolean;
  /** SCOUT: per-wallet records across every other Pons market; null when the index is offline. */
  history: Record<string, WalletHistory> | null;
  historyTip: number;
  /** LEDGER: per-wallet books on this token from the index (curve + pool trades); null when offline. */
  books: Record<string, MarketBook> | null;
  /** Price of the token in quote base units per token base unit, newest trade. */
  quotePerToken: number | null;
  /** KNOT: first funding of the wallets that were looked up. */
  funding: Funding[];
  fundingAsked: number;
  /** Lookups that completed inside the budget (found or not). */
  fundingRead: number;
  /** Dollar rate of one whole quote unit (ETH or the pair token). */
  quoteUsd: number | null;
  /** Optional direct dollar price per whole token (graduated tokens, DEX). */
  tokenUsd: number | null;
  /** The pool's dollar liquidity from the DEX source (graduated tokens; absent on older tapes). */
  liquidityUsd?: number | null;
  /** The deployer's other Pons launches, newest first (absent on older tapes, null when unread). */
  devLaunches?: DevLaunches | null;
  sources: string[];
}

// ------------------------------------------------------------------ crawlers

export type CrawlerName = "WEAVER" | "TRACKER" | "SNARE" | "SCOUT" | "KNOT" | "LEDGER" | "SIEVE" | "ORACLE";

export interface Wallet {
  address: string;
  balance: bigint;
  peak: bigint;
  /** Tokens received from the curve or the pool: bought. */
  bought: bigint;
  /** Tokens sent to the curve or the pool: sold. */
  sold: bigint;
  /** Tokens received from another wallet. */
  received: bigint;
  /** Tokens sent to another wallet. */
  sent: bigint;
  firstBlock: number;
  lastBlock: number;
  /** Who first handed this wallet tokens: the curve, the pool or another wallet. */
  parent: string;
  firstBuyBlock: number | null;
  /** Some of its buys or sales went through a router: the index may not know its history. */
  routed: boolean;
}

export interface WeaverOut {
  wallets: Map<string, Wallet>;
  holders: Wallet[]; // balance > 0, infra excluded, sorted by balance
  nodes: number;
  edges: number;
  /** wallet-to-wallet hand-offs, excluding curve and pool */
  walletEdges: number;
  transfers: number;
  firstBuyer: string | null;
  lastBuyer: string | null;
  holdSupply: bigint;
  /** Aggregator contracts found passing tokens straight through; treated as part of the venue. */
  routers: Set<string>;
  /** Every buy, credited to the wallet at the far end of any router. */
  buys: { wallet: string; block: number; tokens: bigint }[];
  /** Every sale, credited to the wallet that sent the tokens into the router or venue. */
  sells: { wallet: string; block: number; tokens: bigint }[];
  /** The curve trades with each router-named trader replaced by the wallet it served. */
  trades: TapeTrade[];
}

export interface TrackerOut {
  exited: Wallet[];
  goneSupply: bigint; // peak balances of exited wallets
  /** quote taken out by exited wallets through sells */
  takenOutQuote: bigint;
  partial: number; // wallets below 50% of peak but not at zero
  devState: "clean" | "sold half" | "dumped";
  devSoldPct: number;
  exitPressureTokens: bigint; // net sold in the last hour, floored at zero
  soldHour: bigint;
  boughtHour: bigint;
}

export interface SnareOut {
  snipers: { wallet: string; tokens: bigint; block: number; exited: boolean; balance: bigint }[];
  sniperTokens: bigint;
  /** What the snipers hold right now. */
  sniperHeld: bigint;
  sniperExited: number;
  /** Real first-minute buyers: no snipers, no ten-minute flips. */
  firstMinute: string[];
  /** Bots and flippers left out of the cohort. */
  firstMinuteBots: number;
  firstMinuteKept: number | null; // 0..1, null when too few real buyers
  retention: Partial<Record<CheckpointLabel, number>>;
}

export interface ScoutOut {
  online: boolean;
  scanned: number;
  smart: { wallet: string; winrate: number; positions: number; balance: bigint }[];
  smartSupply: bigint;
  avgWinrate: number | null;
  virgins: string[];
  shortHistory: string[];
}

export interface KnotOut {
  looked: number;
  read: number;
  clusters: { funder: string; wallets: string[]; supply: bigint; declared: boolean }[];
  bundleSupply: bigint;
}

export interface Book {
  wallet: string;
  bought: number; // whole tokens
  sold: number;
  remaining: number;
  avgEntryQuote: number | null; // whole quote per whole token
  costQuote: number; // whole quote
  proceedsQuote: number;
  valueQuote: number | null;
  valueUsd: number | null;
  pnlPct: number | null;
}

export interface LedgerOut {
  source: "index" | "curve";
  books: Map<string, Book>;
  avgPnlPct: number | null;
  priceQuote: number | null; // whole quote per whole token
  priceUsd: number | null;
}

export interface SieveOut {
  dust: string[];
  transferOnly: string[];
  virgins: string[];
  removed: number;
  clean: string[];
  cleanSupply: bigint;
}

export const CHECKPOINTS = [
  { label: "5m", sec: 300 },
  { label: "15m", sec: 900 },
  { label: "1h", sec: 3_600 },
  { label: "6h", sec: 21_600 },
  { label: "24h", sec: 86_400 },
] as const;
export type CheckpointLabel = (typeof CHECKPOINTS)[number]["label"];

// -------------------------------------------------------------------- report

export type Band = "TORN" | "PATCHED" | "TAUT";

export interface Metrics {
  holders: number;
  transfers: number;
  hold: number; // % supply
  gone: number; // % supply
  smart: number;
  smartSupply: number; // %
  sniperSupply: number; // % taken in the first three blocks
  sniperHeld: number; // % the snipers still hold
  sniperWallets: number;
  sniperExited: number;
  bundles: number;
  bundleSupply: number; // %
  firstMinuteKept: number | null; // %, null when too few real first-minute buyers
  /** Wallets left out of retention as bots or ten-minute flips. */
  flips: number;
  devState: "clean" | "sold half" | "dumped";
  exitPressure: number; // %
  winrate: number | null; // %
  score: number;
}

export type Flag = "deployer" | "sniper" | "virgin" | "transfer" | "short history" | "clean" | "smart" | "bundle";

export type Role = "dev" | "insider" | "sniper" | "bot" | "whale" | "smart" | "bundle" | "fresh" | "trader" | "router" | "transfer";

export interface HolderRow {
  wallet: string;
  share: number; // % supply
  flags: Flag[];
  valueUsd: number | null;
  pnlPct: number | null;
  winrate: number | null;
  /** Who this wallet is, in a few words: dev, sniper, bot, smart money, trader, first-timer. */
  who: string;
  /** Roles, most telling first: dev, insider, sniper, bot, whale, smart, bundle, fresh, trader, router. */
  roles: Role[];
  /** Other Pons tokens it ever traded; null when the index did not read it. */
  markets: number | null;
  /** Seconds since it first got this token. */
  heldSec: number;
  /** What it did with what it got, as % of everything it bought or received (absent on older reports). */
  exit?: { sold: number; moved: number; burned: number };
  /** Seconds since its last sale, null when it never sold. */
  lastSellSec?: number | null;
  /** The operator this wallet belongs to, when it is tied to another top holder (absent on older reports). */
  op?: number | null;
}

export interface EarlyBuyer {
  wallet: string;
  /** Blocks and seconds from the launch to its first buy. */
  delayBlocks: number;
  delaySec: number;
  /** % of supply its first buy took. */
  atBuy: number;
  /** % of supply it holds now. */
  now: number;
  /** holding, added more, partly sold, sold out, or moved its tokens to another wallet. */
  status: "holding" | "added" | "partly sold" | "sold" | "moved";
  /** % of its peak that is gone. */
  soldPct: number;
  roles: Role[];
}

export type RugGroup = "dev and insiders" | "snipers" | "bundles" | "got it by transfer" | "first-minute buyers" | "ten-minute flippers" | "later buyers";

export interface Rug {
  /** % the price fell from its peak to now. */
  drawdown: number;
  peakAgoSec: number;
  /** The dev dumped, or the launch side (dev, insiders, snipers, bundles, transfers, first minute) did enough of the selling to call it a rug. */
  rugged: boolean;
  devState: "clean" | "sold half" | "dumped";
  /** Who sold since the peak: % of all tokens sold since then, and how many wallets. */
  sellers: { group: RugGroup; wallets: number; share: number }[];
}

/** A token the score cannot judge: too few holders yet, or supply handed out instead of bought. */
export interface Outcome {
  kind: "too early" | "no verdict";
  why: string;
}

/** What the biggest hand would do to the price selling everything into today's liquidity. */
export interface DumpImpact {
  /** "operator" when tied wallets hold more than any single one. */
  who: "operator" | "wallet";
  wallets: number;
  /** % of supply it holds. */
  share: number;
  /** % the price would fall, fees and other trades left out. */
  drop: number;
  /** The curve's own reserves, or the pool's liquidity read as a full-range pool. */
  basis: "curve" | "pool estimate";
  /** Holders up 3x or more on their book: how many, how much they hold, and what selling it all would do. */
  overhang?: { wallets: number; share: number; drop: number } | null;
}

/** The market strip at the top of the report, in dollars where a rate was read. */
export interface Market {
  priceUsd: number | null;
  mcapUsd: number | null;
  /** The curve's quote reserve before graduation, the pool's liquidity after. */
  liquidityUsd: number | null;
  liquidityIn: "curve" | "pool";
  /** Curve and pool trades of the last 24 hours. */
  vol24hUsd: number | null;
  vol24hQuote: number;
  trades24h: number;
  /** % of supply the ten biggest holders have. */
  top10: number;
}

/** Top holders tied together: one hand behind several wallets. */
export interface Operators {
  /** Top holders looked at, and how many hands they come to. */
  wallets: number;
  hands: number;
  groups: { id: number; wallets: string[]; share: number; ties: ("transfer" | "funder" | "same block" | "same sender")[] }[];
}

/** What the deployer launched before (and after) this token, from the factory and the index. */
export interface DevLaunches {
  /** Every launch by this deployer, this one included. */
  total: number;
  /** False when a window of the factory log could not be read. */
  complete: boolean;
  tokens: { token: string; symbol: string | null; block: number; wallets: number; trades: number; lastBlock: number; verdict: { score: number; band: string; at: number } | null }[];
}

/** One wallet on the silk web: where it sits and what it is. */
export interface SilkNode {
  wallet: string;
  /** % of supply held now, and at its peak. */
  share: number;
  peak: number;
  /** Ring by entry time: 0 the sniper blocks, 1 the first minute, 2 ten minutes, 3 the first hour, 4 later. */
  ring: 0 | 1 | 2 | 3 | 4;
  roles: Role[];
  op: number | null;
  /** Left: holds nothing now. */
  gone: boolean;
}

export interface CrawlerReport {
  name: CrawlerName;
  color: string;
  role: string;
  /** two headline facts, as the crawler card prints them */
  stats: [string, string];
  /** what the crawler would print to crawler.log */
  lines: LogLine[];
}

export interface LogLine {
  crawler: CrawlerName;
  kind: "walk" | "link" | "cluster" | "trace" | "verdict" | "flag";
  wallet?: string;
  text: string;
}

export interface Fill {
  wallet: string;
  kind: "buy" | "sell";
  block: number;
  ts: number;
  tokens: number; // whole tokens
  quote: number; // whole quote units
  usd: number | null;
  /** True when the quote is the wallet's average price, not this trade's own (pool trades carry no quote in our reads). */
  estimated: boolean;
}

export interface Panels {
  weaver: { nodes: number; edges: number; walletEdges: number; routers: number; firstBuyer: string | null; lastBuyer: string | null; fanout: number[] };
  tracker: { exitsByBucket: number[]; recent: { wallet: string; pct: number }[] };
  snare: { rows: { wallet: string; pct: number; block: number; exited: boolean }[] };
  scout: { rows: { wallet: string; winrate: number | null; markets: number; smart: boolean }[]; scanned: number };
  knot: { rows: { funder: string; wallets: number; pct: number; declared: boolean }[]; read: number; looked: number };
  ledger: { pnlBuckets: number[]; avgPnlPct: number | null; priceQuote: number | null; priceUsd: number | null };
  sieve: { dust: number; transferOnly: number; virgins: number; clean: number };
  oracle: {
    retention: number; kept: number; smart: number; sniper: number; exit: number; bundle: number; dev: number; base: number;
    /** points each positive term added, so a reader can rebuild the score */
    points: { holding: number; kept: number; smart: number };
  };
}

export interface Report {
  version: 1;
  token: {
    address: string;
    symbol: string;
    name: string;
    pairSymbol: string;
    graduated: boolean;
    phaseLabel: string;
    curveProgress: number;
    launchedAt: number;
    ageSec: number;
    deployer: string;
  };
  score: number;
  band: Band;
  /** the six-step reading: TORN, LOOSE, PATCHED, HOLDING, TAUT, SILK */
  label: string;
  verdict: string;
  /** the verdict plate's second line */
  subline: string;
  /** Set when no score is given: the page and the card show this instead of the number (absent on older reports). */
  outcome?: Outcome | null;
  metrics: Metrics;
  quadrants: {
    web: { retention: Partial<Record<CheckpointLabel, number>>; hold: number; gone: number; firstMinuteKept: number | null; realRetention: number; stillIn: number; settled: number; flips: number; firstMinuteBots: number };
    silk: { smart: number; smartSupply: number; winrate: number | null; scanned: number; online: boolean };
    snare: { sniperSupply: number; sniperHeld: number; sniperWallets: number; sniperExited: number; bundles: number; bundleSupply: number };
    exit: { exitPressure: number; soldHour: number; boughtHour: number; devState: string; devSoldPct: number; takenOut: number; takenOutUsd: number | null; pairSymbol: string };
  };
  /** Price, market cap, liquidity, 24h volume, top ten (absent on older reports). */
  market?: Market;
  /** the three fact lines the card and the report print */
  facts: [string, string, string];
  crawlers: CrawlerReport[];
  holders: HolderRow[];
  /** Set when the price fell 80% or more from its peak (absent on older reports). */
  rug?: Rug | null;
  /** Who sold in the last hour, by kind of wallet (absent on older reports). */
  sellingNow?: Rug["sellers"];
  /** The first twenty buyers, in order (absent on reports from before 0.6). */
  early?: EarlyBuyer[];
  /** The top holders tied into operators (absent on older reports). */
  operators?: Operators;
  /** The silk web: the top holders and the biggest wallets that left (absent on older reports). */
  silk?: SilkNode[];
  /** The biggest hand selling into today's liquidity; null when the liquidity is unknown. */
  dump?: DumpImpact | null;
  /** The deployer's other launches and how they went (absent on older reports). */
  devHistory?: (DevLaunches & { dead: number; quiet: number }) | null;
  fills: Fill[];
  /** Price candles over the token's life: curve trades, then pool swaps. Whole quote per whole token. */
  chart: { t: number; o: number; h: number; l: number; c: number; v: number }[];
  /** Wallets holding at the end of each chart candle (absent on older reports). */
  holderCurve?: number[];
  /** What each crawler's desk monitor shows: real rows from this crawl. */
  panels: Panels;
  graph: { nodes: { id: string; layer: number; kind: "contract" | "tx" | "holder" | "history"; state: "held" | "smart" | "sniper" | "gone" | "neutral" }[]; links: [number, number][] };
  provenance: {
    block: number;
    observedAt: string;
    rpcCalls: number;
    ms: number;
    sources: string[];
    partial: boolean;
    indexTip: number | null;
    fundingRead: string;
  };
}
