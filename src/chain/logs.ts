import { parseEventLogs, type Address } from "viem";
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
const MIN_CHUNK = 500;

export interface ChunkedResult<T> {
  events: T[];
  complete: boolean;
}

type RawLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];

/**
 * AIMD chunking: a refusal quarters the chunk down to 500 blocks (~50 s) and
 * every clean read doubles it back. A launch-hour hot zone reads in small
 * bites, the quiet weeks after in 1M-block strides.
 */
async function readChunked(
  address: Address,
  fromBlock: number,
  toBlock: number,
  onProgress?: (doneBlocks: number, totalBlocks: number, logs: number) => void,
): Promise<{ logs: RawLog[]; complete: boolean }> {
  const total = Math.max(1, toBlock - fromBlock + 1);
  // A long window splits into segments read side by side: a busy token's
  // log is hundreds of 10k-log pages, and one lane spends most of its time
  // waiting on each response. The RPC gate still caps requests in flight.
  const lanes = total > 4 * START_CHUNK ? 4 : total > START_CHUNK ? 2 : 1;
  const size = Math.ceil(total / lanes);
  const done = new Array<number>(lanes).fill(0);
  let found = 0;
  const parts = await Promise.all(Array.from({ length: lanes }, (_, i) => {
    const a = fromBlock + i * size;
    const b = Math.min(toBlock, a + size - 1);
    return readSegment(address, a, b, (blocks, logs) => {
      done[i] = blocks;
      found += logs;
      onProgress?.(done.reduce((x, y) => x + y, 0), total, found);
    });
  }));
  // concat, not push(...): a busy token's log overflows the argument stack
  const logs = ([] as RawLog[]).concat(...parts.map((p) => p.logs));
  return { logs, complete: parts.every((p) => p.complete) };
}

async function readSegment(
  address: Address,
  fromBlock: number,
  toBlock: number,
  onPage: (doneBlocks: number, newLogs: number) => void,
): Promise<{ logs: RawLog[]; complete: boolean }> {
  const logs: RawLog[] = [];
  let complete = true;
  let chunk = START_CHUNK;
  let start = fromBlock;
  while (start <= toBlock) {
    const end = Math.min(toBlock, start + chunk - 1);
    try {
      const batch = await publicClient.getLogs({ address, fromBlock: BigInt(start), toBlock: BigInt(end) });
      logs.push(...batch);
      start = end + 1;
      if (chunk < START_CHUNK) chunk = Math.min(START_CHUNK, chunk * 2);
      onPage(start - fromBlock, batch.length);
    } catch {
      if (chunk > MIN_CHUNK) { chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 4)); continue; }
      complete = false; // a hole in the window, not an empty window
      start = end + 1;
    }
  }
  return { logs, complete };
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
export async function readCurveTrades(curve: Address, fromBlock: number, toBlock: number): Promise<ChunkedResult<CurveTrade>> {
  const { logs, complete } = await readChunked(curve, fromBlock, toBlock);
  const events: CurveTrade[] = [];
  for (const log of parseEventLogs({ abi: curveAbi, logs })) {
    const base = { block: Number(log.blockNumber), logIndex: Number(log.logIndex) };
    if (log.eventName === "CurveBuy") {
      events.push({ kind: "buy", wallet: log.args.recipient, quoteWei: log.args.quoteIn, tokens: log.args.tokensOut, taxWei: log.args.tax, ...base });
    } else if (log.eventName === "CurveSell") {
      events.push({ kind: "sell", wallet: log.args.seller, quoteWei: log.args.quoteOut, tokens: log.args.tokensIn, taxWei: log.args.tax, ...base });
    }
  }
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
): Promise<ChunkedResult<TokenTransfer>> {
  const { logs, complete } = await readChunked(token, fromBlock, toBlock, onProgress);
  const events: TokenTransfer[] = [];
  for (const log of parseEventLogs({ abi: erc20Abi, logs, eventName: "Transfer" })) {
    events.push({ from: log.args.from, to: log.args.to, value: log.args.value, block: Number(log.blockNumber), logIndex: Number(log.logIndex) });
  }
  events.sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
  return { events, complete };
}
