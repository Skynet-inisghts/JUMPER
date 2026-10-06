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

  const tokenIsCurrency0 = launch.token.toLowerCase() < launch.pairToken.toLowerCase();
  const reads = Promise.all<[ReturnType<typeof readTransfers>, ReturnType<typeof readCurveTrades>, ReturnType<typeof readPoolSwaps>]>([
    readTransfers(launch.token, launch.launchBlock, toBlock, (done, total, logs) =>
      onEvent({ type: "progress", crawler: "WEAVER", done, total, detail: `${logs} transfers` }), deadline),
    readCurveTrades(launch.curve, launch.launchBlock, toBlock, deadline),
    launch.poolId
      ? readPoolSwaps(ADDR.v4PoolManager, launch.poolId, tokenIsCurrency0, launch.launchBlock, toBlock, deadline)
      : Promise.resolve({ events: [], complete: true }),
  ]);
  let transfers: Awaited<typeof reads>[0];
  let trades: Awaited<typeof reads>[1];
  let swaps: Awaited<typeof reads>[2];
  try {
    [transfers, trades, swaps] = await reads;
  } catch (error) {
    if (error instanceof DeadlineError) {
      const age = Math.round((clock.headTs - launch.launchedAt) / 86400);
      throw new CrawlError(
        `$${launch.symbol} has ${age >= 1 ? `${age} days` : "hours"} of history too busy to read inside one web crawl. ` +
          `Run it locally, it has no time limit: pnpm jumper ${launch.token}`,
      );
    }
    throw error;
  }

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
    transfers: transfers.events.map((t) => ({ from: t.from, to: t.to, value: t.value, block: t.block, logIndex: t.logIndex })),
    trades: trades.events.map((t) => ({ kind: t.kind, wallet: t.wallet, quoteWei: t.quoteWei, tokens: t.tokens, taxWei: t.taxWei, block: t.block, logIndex: t.logIndex })),
    swaps: swaps.events.map((s) => ({ buy: s.buy, tokens: s.tokens, quote: s.quote, price: s.price, block: s.block, logIndex: s.logIndex })),
    logsComplete: transfers.complete && trades.complete && swaps.complete,
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
  const fundingP = readFundingFor(knotTargets(web, snared), THRESHOLDS.knotBudgetMs);

  const [history, funding, books, prices] = await Promise.all([
    historyP.then((h) => { onEvent({ type: "stage", crawler: "SCOUT", state: "done" }); return h; }),
    fundingP.then((f) => { onEvent({ type: "stage", crawler: "KNOT", state: "done" }); return f; }),
    booksP,
    pricesP,
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
