import { parseAbi, parseEventLogs, type AbiEvent, type Address, type Hex } from "viem";
import { curveAbi, erc20Abi } from "./abi.js";
import { publicClient } from "./chain.js";

/**
 * Chunked log reads. The public Robinhood RPC accepts ranges up to about 1M
 * blocks (~28 hours) on a single address filter and refuses any read whose
 * result would pass 10k logs, so the chunk starts big and shrinks on refusal.
 * A refused chunk that never succeeds is reported as a hole, not silently
 * treated as empty: see `complete`.
 * Chunking pattern adapted from novamp (MIT) — https://github.com/bored2boar/novamp
 * via Gemhog — https://github.com/Skynet-inisghts/GEMHOG
 */

const START_CHUNK = 900_000;

/** A read ran past the caller's deadline: the token's history is longer than the time it was given. */
export class DeadlineError extends Error {
  constructor(public readonly logsRead: number) {
    super("deadline passed while reading logs");
  }
}

const MIN_CHUNK = 500;

export interface ChunkedResult<T> {
  events: T[];
  complete: boolean;
}

type RawLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];

/** A log read keeps only what the crawl needs: each page is parsed as it lands, raw logs never pile up. */
type PageParser<T> = (logs: RawLog[]) => T[];

/** A full page stays under the RPC's 10k-log ceiling with room to spare. */
const TARGET_LOGS = 6_000;

/** An optional event + indexed-argument filter, for reads on a shared contract like the v4 PoolManager. */
interface Filter { event: AbiEvent; args: Record<string, unknown> }

async function readChunked<T>(
  address: Address,
  fromBlock: number,
  toBlock: number,
  parse: PageParser<T>,
  onProgress?: (doneBlocks: number, totalBlocks: number, logs: number) => void,
  filter?: Filter,
  deadline = Infinity,
): Promise<{ events: T[]; complete: boolean }> {
  if (toBlock < fromBlock) return { events: [], complete: true };
  const total = Math.max(1, toBlock - fromBlock + 1);
  // A long window splits into segments read side by side: a busy token's
  // log is hundreds of pages, and one lane spends most of its time waiting
  // on each response. The RPC gate still caps requests in flight.
  const lanes = total > 4 * START_CHUNK ? 4 : total > START_CHUNK ? 2 : 1;
  const size = Math.ceil(total / lanes);
  const done = new Array<number>(lanes).fill(0);
  let found = 0;
  const parts = await Promise.all(Array.from({ length: lanes }, (_, i) => {
    const a = fromBlock + i * size;
    const b = Math.min(toBlock, a + size - 1);
    return readSegment(address, a, b, parse, filter, deadline, (blocks, logs) => {
      done[i] = blocks;
      found += logs;
      onProgress?.(done.reduce((x, y) => x + y, 0), total, found);
    });
  }));
  // concat, not push(...): a busy token's log overflows the argument stack
  const events = ([] as T[]).concat(...parts.map((p) => p.events));
  return { events, complete: parts.every((p) => p.complete) };
}

/**
 * One lane. The chunk follows the log density: after each page it is sized
 * to land near TARGET_LOGS, so a launch-hour hot zone reads in small bites
 * and the quiet weeks after in 900k-block strides, without the refusals a
 * blind doubling walks into. A refusal still quarters it, down to 500
 * blocks (~50 s); a chunk refused at that size is a hole, not an empty window.
 */
async function readSegment<T>(
  address: Address,
  fromBlock: number,
  toBlock: number,
  parse: PageParser<T>,
  filter: Filter | undefined,
  deadline: number,
  onPage: (doneBlocks: number, newLogs: number) => void,
): Promise<{ events: T[]; complete: boolean }> {
  const events: T[] = [];
  let complete = true;
  let chunk = START_CHUNK;
  let start = fromBlock;
  while (start <= toBlock) {
    if (Date.now() > deadline) throw new DeadlineError(events.length);
    const end = Math.min(toBlock, start + chunk - 1);
    let batch: RawLog[];
    try {
      batch = filter
        ? ((await publicClient.getLogs({ address, event: filter.event, args: filter.args, fromBlock: BigInt(start), toBlock: BigInt(end) } as never)) as RawLog[])
        : await publicClient.getLogs({ address, fromBlock: BigInt(start), toBlock: BigInt(end) });
    } catch {
      if (chunk > MIN_CHUNK) { chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 4)); continue; }
      complete = false; // a hole in the window, not an empty window
      start = end + 1;
      continue;
    }
    for (const e of parse(batch)) events.push(e);
    const span = end - start + 1;
    start = end + 1;
    const fit = batch.length > 0 ? Math.floor((span * TARGET_LOGS) / batch.length) : span * 4;
    chunk = Math.max(MIN_CHUNK, Math.min(START_CHUNK, fit, span * 4));
    onPage(start - fromBlock, batch.length);
  }
  return { events, complete };
}

export interface CurveTrade {
  kind: "buy" | "sell";
  /**
   * The trader, taken from the event's own fields: `recipient` for buys,
   * `seller` for sells. Never `tx.from`: on this chain that is the relayer,
   * and reading it collapses thousands of traders into a handful.
   */
  wallet: Address;
  quoteWei: bigint;
  tokens: bigint;
  taxWei: bigint;
  block: number;
  logIndex: number;
}

/** Every CurveBuy and CurveSell on a curve over a block window, in order. */
export async function readCurveTrades(curve: Address, fromBlock: number, toBlock: number, deadline = Infinity): Promise<ChunkedResult<CurveTrade>> {
  const { events, complete } = await readChunked(curve, fromBlock, toBlock, (logs) => {
    const page: CurveTrade[] = [];
    for (const log of parseEventLogs({ abi: curveAbi, logs })) {
      const base = { block: Number(log.blockNumber), logIndex: Number(log.logIndex) };
      if (log.eventName === "CurveBuy") {
        page.push({ kind: "buy", wallet: log.args.recipient, quoteWei: log.args.quoteIn, tokens: log.args.tokensOut, taxWei: log.args.tax, ...base });
      } else if (log.eventName === "CurveSell") {
        page.push({ kind: "sell", wallet: log.args.seller, quoteWei: log.args.quoteOut, tokens: log.args.tokensIn, taxWei: log.args.tax, ...base });
      }
    }
    return page;
  }, undefined, undefined, deadline);
  events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  return { events, complete };
}

export interface TokenTransfer {
  from: Address;
  to: Address;
  value: bigint;
  block: number;
  logIndex: number;
}

/** The token's full Transfer history over a window: every balance in a crawl is rebuilt from this. */
export async function readTransfers(
  token: Address,
  fromBlock: number,
  toBlock: number,
  onProgress?: (doneBlocks: number, totalBlocks: number, logs: number) => void,
  deadline = Infinity,
): Promise<ChunkedResult<TokenTransfer>> {
  const { events, complete } = await readChunked(token, fromBlock, toBlock, (logs) =>
    parseEventLogs({ abi: erc20Abi, logs, eventName: "Transfer" }).map((log) => ({
      from: log.args.from, to: log.args.to, value: log.args.value, block: Number(log.blockNumber), logIndex: Number(log.logIndex),
    })), onProgress, undefined, deadline);
  events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  return { events, complete };
}

const poolAbi = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);

export interface PoolSwap {
  /** Seen from the trader: true when the token left the pool. */
  buy: boolean;
  tokens: bigint;
  quote: bigint;
  /** Quote base units per token base unit after the swap, from sqrtPriceX96. */
  price: number;
  block: number;
  logIndex: number;
}

/**
 * Every swap on the token's Uniswap v4 pool after graduation. The pool
 * manager is shared by every pool, so the read filters on the pool id; the
 * sender is a router, never the trader, and is not kept. Amounts in a v4
 * Swap are the trader's deltas: positive is what the trader received.
 */
export async function readPoolSwaps(poolManager: Address, poolId: Hex, tokenIsCurrency0: boolean, fromBlock: number, toBlock: number, deadline = Infinity): Promise<ChunkedResult<PoolSwap>> {
  const event = poolAbi[0] as AbiEvent;
  const { events, complete } = await readChunked(poolManager, fromBlock, toBlock, (logs) => parseEventLogs({ abi: poolAbi, logs }).map((log) => {
    const { amount0, amount1, sqrtPriceX96 } = log.args;
    const tokenDelta = tokenIsCurrency0 ? amount0 : amount1;
    const quoteDelta = tokenIsCurrency0 ? amount1 : amount0;
    const sp = Number(sqrtPriceX96) / 2 ** 96;
    const p1per0 = sp * sp; // currency1 per currency0, base units
    return {
      buy: tokenDelta > 0n,
      tokens: tokenDelta < 0n ? -tokenDelta : tokenDelta,
      quote: quoteDelta < 0n ? -quoteDelta : quoteDelta,
      price: tokenIsCurrency0 ? p1per0 : p1per0 > 0 ? 1 / p1per0 : 0,
      block: Number(log.blockNumber),
      logIndex: Number(log.logIndex),
    } satisfies PoolSwap;
  }), undefined, { event, args: { id: poolId } }, deadline);
  events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  return { events, complete };
}
