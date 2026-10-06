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
  metrics: Metrics;
  quadrants: {
    web: { retention: Partial<Record<CheckpointLabel, number>>; hold: number; gone: number; firstMinuteKept: number | null; realRetention: number; stillIn: number; settled: number; flips: number; firstMinuteBots: number };
    silk: { smart: number; smartSupply: number; winrate: number | null; scanned: number; online: boolean };
    snare: { sniperSupply: number; sniperHeld: number; sniperWallets: number; sniperExited: number; bundles: number; bundleSupply: number };
    exit: { exitPressure: number; soldHour: number; boughtHour: number; devState: string; devSoldPct: number; takenOut: number; takenOutUsd: number | null; pairSymbol: string };
  };
  /** the three fact lines the card and the report print */
  facts: [string, string, string];
  crawlers: CrawlerReport[];
  holders: HolderRow[];
  fills: Fill[];
  /** Price candles over the token's life: curve trades, then pool swaps. Whole quote per whole token. */
  chart: { t: number; o: number; h: number; l: number; c: number; v: number }[];
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
