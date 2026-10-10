import type { Address } from "viem";
import { readLaunch } from "./chain/launches.js";
import { makeClock } from "./chain/blocks.js";
import { DeadlineError, readCurveTrades, readPoolSwaps, readTransfers } from "./chain/logs.js";
import { ADDR } from "./chain/chain.js";
import { indexConfigured, readBooks, readHistory } from "./chain/history.js";
import { readFundingFor } from "./chain/funding.js";
import { dexPriceUsd, ethUsd, tokenUsd } from "./chain/prices.js";
import { rpcCallCount } from "./chain/rpc.js";
import { blockscoutKey } from "./chain/blockscout.js";
import { CACHE_MARGIN_BLOCKS, loadLogs, saveLogs, worthSaving } from "./cache.js";
import { THRESHOLDS } from "./score/config.js";
import { weave } from "./crawlers/weaver.js";
import { snare } from "./crawlers/snare.js";
import { scoutTargets } from "./crawlers/scout.js";
import { knotTargets } from "./crawlers/knot.js";
import { crawlTape } from "./crawlers/pipeline.js";
import type { CrawlerName, Report, Tape } from "./crawlers/types.js";

/**
 * The live path behind `jumper <ca>` and the site's crawl stream: read one
 * token, record everything onto a Tape, run the crawlers over it, stamp
 * provenance. Reads that cannot finish (an index that is down, an explorer
 * without a key) leave their part of the Tape empty and the report says
 * which; a crawl never invents what it could not read.
 */

export class CrawlError extends Error {}

/** The token's logs did not fit the time a web crawl has; warmLogs reads them into the cache for the next one. */
export class CrawlTooLong extends CrawlError {
  constructor(message: string, public readonly token: Address, public readonly symbol: string) {
    super(message);
  }
}

export type CrawlEvent =
  | { type: "stage"; crawler: CrawlerName; state: "running" | "done"; detail?: string }
  | { type: "progress"; crawler: CrawlerName; done: number; total: number; detail?: string };

export interface CrawlResult {
  report: Report;
  tape: Tape;
}

export interface CrawlOptions {
  /** Give up reading logs after this many ms; the site sets it under its function limit. */
  budgetMs?: number;
  /** KNOT's explorer lookups stop after this many ms (default THRESHOLDS.knotBudgetMs). */
  knotBudgetMs?: number;
  /** The whole crawl should end by this many ms after it started: KNOT gets what is left, a second or more. */
  finishMs?: number;
}

export async function crawl(token: Address, onEvent: (e: CrawlEvent) => void = () => {}, options: CrawlOptions = {}): Promise<CrawlResult> {
  const started = Date.now();
  const deadline = options.budgetMs ? started + options.budgetMs : Infinity;
  const callsBefore = rpcCallCount();
  const sources = ["robinhood rpc"];

  onEvent({ type: "stage", crawler: "WEAVER", state: "running", detail: "reading the launch" });
  const launch = await readLaunch(token);
  if (!launch) {
    const { creatorLabel } = await import("./chain/creator.js");
    const label = await creatorLabel(token).catch(() => null);
    throw new CrawlError(
      label
        ? `${token} was not launched through the pons v2 factory; it was created by ${label}. JUMPER crawls pons v2 launches only`
        : `${token} was not launched through the pons v2 factory`,
    );
  }
  const clock = await makeClock(launch.launchBlock, launch.launchedAt);
  const toBlock = clock.headBlock;

  // Prices and the index's books do not depend on the logs; start them now.
  const pricesP = (async () => {
    const quote = launch.pairIsEth ? await ethUsd() : await tokenUsd(launch.pairToken);
    const direct = launch.graduated ? await dexPriceUsd(launch.token) : null;
    return { quote, direct };
  })();
  const booksP = indexConfigured() ? readBooks(launch.token, launch.curve).catch(() => null) : Promise.resolve(null);

  const logs = await readLogs(launch, toBlock, deadline, (done, total, n) =>
    onEvent({ type: "progress", crawler: "WEAVER", done, total, detail: `${n} transfers` }));
  if (!logs) {
    const age = Math.round((clock.headTs - launch.launchedAt) / 86400);
    throw new CrawlTooLong(
      `$${launch.symbol} has ${age >= 1 ? `${age} days` : "hours"} of history too busy to read inside one web crawl. ` +
        `Run it locally, it has no time limit: pnpm jumper ${launch.token}`,
      launch.token,
      launch.symbol,
    );
  }
  if (logs.cachedTo) sources.push("log cache");
  const { transfers, trades, swaps } = logs;

  const tape: Tape = {
    version: 1,
    launch: {
      token: launch.token,
      symbol: launch.symbol,
      name: launch.name,
      curve: launch.curve,
      deployer: launch.deployer,
      creatorFeeRecipient: launch.creatorFeeRecipient,
      pairToken: launch.pairToken,
      pairIsEth: launch.pairIsEth,
      pairSymbol: launch.pairSymbol,
      pairDecimals: launch.pairDecimals,
      phase: launch.phase,
      phaseLabel: launch.phaseLabel,
      graduated: launch.graduated,
      curveProgress: launch.curveProgress,
      launchedAt: launch.launchedAt,
      launchBlock: launch.launchBlock,
      totalSupply: launch.totalSupply,
      devTokens: launch.devTokens,
      exemptions: launch.exemptions,
    },
    headBlock: clock.headBlock,
    now: clock.headTs,
    secPerBlock: clock.secPerBlock,
    transfers,
    trades,
    swaps,
    logsComplete: logs.complete,
    history: null,
    historyTip: 0,
    books: null,
    quotePerToken: null,
    funding: [],
    fundingAsked: 0,
    fundingRead: 0,
    quoteUsd: null,
    tokenUsd: null,
    sources,
  };
  onEvent({ type: "stage", crawler: "WEAVER", state: "done", detail: `${tape.transfers.length} transfers` });

  // The graph decides who the expensive crawlers look at.
  const web = weave(tape);
  onEvent({ type: "stage", crawler: "TRACKER", state: "done" });
  const snared = snare(tape, web);
  onEvent({ type: "stage", crawler: "SNARE", state: "done", detail: `${snared.snipers.length} snipers` });

  onEvent({ type: "stage", crawler: "SCOUT", state: "running" });
  onEvent({ type: "stage", crawler: "KNOT", state: "running" });
  const historyP = indexConfigured()
    ? readHistory(scoutTargets(web, snared), launch.token).catch(() => null)
    : Promise.resolve(null);
  let knotMs = options.knotBudgetMs ?? THRESHOLDS.knotBudgetMs;
  if (options.finishMs) knotMs = Math.max(1_000, Math.min(knotMs, started + options.finishMs - Date.now() - 1_000));
  const fundingP = readFundingFor(knotTargets(web, snared), knotMs);

  // past the finish line a late source is left out, as if it were offline
  const finish = options.finishMs ? started + options.finishMs : Infinity;
  const [history, funding, books, prices] = await Promise.all([
    within(historyP, finish, null).then((h) => { onEvent({ type: "stage", crawler: "SCOUT", state: "done" }); return h; }),
    fundingP.then((f) => { onEvent({ type: "stage", crawler: "KNOT", state: "done" }); return f; }),
    within(booksP, finish, null),
    within(pricesP, finish, { quote: null, direct: null }),
  ]);

  if (history) {
    tape.history = history.wallets;
    tape.historyTip = history.tip;
    sources.push("wallet index");
  }
  if (books) {
    tape.books = books.wallets;
    if (books.price) tape.quotePerToken = books.price.quotePerToken;
  }
  // the pool's newest swap is the freshest price once graduated
  const lastSwap = tape.swaps?.at(-1);
  if (lastSwap && lastSwap.price > 0) tape.quotePerToken = lastSwap.price;
  if (tape.quotePerToken === null) {
    // the newest curve trade prices the token when the index has nothing newer
    const last = [...tape.trades].reverse().find((t) => t.tokens > 0n);
    if (last) tape.quotePerToken = Number(last.quoteWei) / Number(last.tokens);
  }
  tape.funding = funding.funding;
  tape.fundingAsked = funding.asked;
  tape.fundingRead = funding.read;
  if (funding.read > 0) sources.push("blockscout");
  tape.quoteUsd = prices.quote?.usd ?? null;
  tape.tokenUsd = prices.direct?.usd ?? null;
  if (prices.quote) sources.push(`${prices.quote.source} rate`);
  if (prices.direct) sources.push("dexscreener price");

  onEvent({ type: "stage", crawler: "LEDGER", state: "running" });
  const body = crawlTape(tape, (name) => onEvent({ type: "stage", crawler: name, state: "done" }));

  const report: Report = {
    ...body,
    provenance: {
      block: clock.headBlock,
      observedAt: new Date(clock.headTs * 1000).toISOString(),
      rpcCalls: rpcCallCount() - callsBefore,
      ms: Date.now() - started,
      sources: [...new Set(sources)],
      partial: !tape.logsComplete,
      indexTip: history ? history.tip : null,
      fundingRead: blockscoutKey() ? `${funding.read} of ${funding.asked}` : "no explorer key",
    },
  };
  return { report, tape };
}

/** `work`, or `fallback` if it has not settled by `deadline` (a timestamp). */
function within<T, F>(work: Promise<T>, deadline: number, fallback: F): Promise<T | F> {
  if (!Number.isFinite(deadline)) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<F>((r) => { timer = setTimeout(() => r(fallback), Math.max(0, deadline - Date.now())); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** One warming step: a few minutes of reading at most, for the busiest tokens. */
const WARM_WINDOW_BLOCKS = 4_000_000;

const pendingSaves = new Set<Promise<void>>();

/** Wait for cache writes still in flight. */
export async function cacheWritten(): Promise<void> {
  await Promise.all([...pendingSaves]);
}

type Launch = NonNullable<Awaited<ReturnType<typeof readLaunch>>>;

interface Logs {
  transfers: Tape["transfers"];
  trades: Tape["trades"];
  swaps: NonNullable<Tape["swaps"]>;
  complete: boolean;
  /** The block the cache covered, 0 when everything was read live. */
  cachedTo: number;
}

/**
 * The token's three logs from launch to `toBlock`: whatever the cache holds,
 * plus a live read of the rest. A complete read goes back into the cache.
 * Null when the deadline passed first.
 */
async function readLogs(
  launch: Launch,
  toBlock: number,
  deadline: number,
  onProgress?: (done: number, total: number, transfers: number) => void,
): Promise<Logs | null> {
  const cached = await loadLogs(launch.token);
  const cachedTo = cached && cached.upTo >= launch.launchBlock ? Math.min(cached.upTo, toBlock) : 0;
  const from = cachedTo ? cachedTo + 1 : launch.launchBlock;
  const base = cachedTo ? cached!.transfers.length : 0;
  const tokenIsCurrency0 = launch.token.toLowerCase() < launch.pairToken.toLowerCase();
  // The deadline is checked between pages, but one page can sit in the RPC
  // gate's retries for a minute: the timer is the hard stop.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = Number.isFinite(deadline)
    ? new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DeadlineError(0)), Math.max(0, deadline - Date.now())); })
    : null;
  let live;
  try {
    const reading = Promise.all([
      readTransfers(launch.token, from, toBlock, (done, total, n) => onProgress?.(done, total, base + n), deadline),
      readCurveTrades(launch.curve, from, toBlock, deadline),
      launch.poolId
        ? readPoolSwaps(ADDR.v4PoolManager, launch.poolId, tokenIsCurrency0, from, toBlock, deadline)
        : Promise.resolve({ events: [], complete: true }),
    ]);
    reading.catch(() => {}); // after the timer wins, a late failure is nobody's
    live = await (expired ? Promise.race([reading, expired]) : reading);
  } catch (error) {
    if (error instanceof DeadlineError) return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const [t, c, s] = live;
  const keep = <T extends { block: number }>(xs: T[] | undefined) => (cachedTo ? (xs ?? []).filter((x) => x.block <= cachedTo) : []);
  const logs: Logs = {
    // concat, not spread: a busy token's log overflows the argument stack
    transfers: keep(cached?.transfers).concat(t.events.map((e) => ({ from: e.from, to: e.to, value: e.value, block: e.block, logIndex: e.logIndex }))),
    trades: keep(cached?.trades).concat(c.events.map((e) => ({ kind: e.kind, wallet: e.wallet, quoteWei: e.quoteWei, tokens: e.tokens, taxWei: e.taxWei, block: e.block, logIndex: e.logIndex }))),
    swaps: keep(cached?.swaps).concat(s.events.map((e) => ({ buy: e.buy, tokens: e.tokens, quote: e.quote, price: e.price, block: e.block, logIndex: e.logIndex }))),
    complete: t.complete && c.complete && s.complete,
    cachedTo,
  };
  const upTo = toBlock - CACHE_MARGIN_BLOCKS;
  if (logs.complete && upTo > cachedTo && worthSaving(cachedTo, upTo, t.events.length + c.events.length + s.events.length)) {
    // written in the background: a full disk costs the next crawl time, never this one its report
    const save: Promise<void> = saveLogs(launch.token, { upTo, transfers: logs.transfers, trades: logs.trades, swaps: logs.swaps })
      .catch(() => {})
      .finally(() => pendingSaves.delete(save));
    pendingSaves.add(save);
  }
  return logs;
}

/**
 * Read a token's logs into the cache: what the site does after a crawl ran
 * out of time on a long history, so the next crawl is quick. Returns the
 * number of transfers kept, 0 when the budget ran out first.
 */
export async function warmLogs(
  token: Address,
  onProgress?: (done: number, total: number, transfers: number) => void,
  budgetMs?: number,
): Promise<number> {
  const deadline = budgetMs ? Date.now() + budgetMs : Infinity;
  const launch = await readLaunch(token);
  if (!launch) return 0;
  const clock = await makeClock(launch.launchBlock, launch.launchedAt);
  // In windows, each kept as soon as it is complete: a history longer than
  // one budget is read over several runs, each picking up where the last stopped.
  let transfers = 0;
  for (;;) {
    const kept = await loadLogs(launch.token);
    const from = kept && kept.upTo >= launch.launchBlock ? kept.upTo + 1 : launch.launchBlock;
    const to = Math.min(clock.headBlock, from + WARM_WINDOW_BLOCKS);
    const logs = await readLogs(launch, to, deadline, onProgress);
    await cacheWritten();
    if (!logs) return 0;
    transfers = logs.transfers.length;
    if (to >= clock.headBlock || !logs.complete) return transfers;
  }
}
