import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzip } from "node:zlib";
import type { Funding } from "./chain/funding.js";
import type { TapeSwap, TapeTrade, TapeTransfer } from "./crawlers/types.js";

const gzipAsync = promisify(gzip);

/**
 * The crawl's memory between runs, on disk under JUMPER_CACHE_DIR.
 *
 * Logs: a token's Transfer, curve and pool events never change once final,
 * so a token read once is read again from the block after the last one
 * kept. A busy token with a million transfers costs minutes the first
 * time and a second after that. Only complete reads are kept, and only up
 * to a few blocks behind the head, so the next crawl re-reads the edge.
 *
 * Funding: a wallet's first incoming ETH is history too. Found fundings are
 * kept for good; a wallet with none yet is asked again after a day.
 *
 * Logs live in JUMPER_CACHE_DIR, or, without it, in the wallet index
 * (GET/PUT /logs, see docs/INDEX.md) when JUMPER_INDEX_URL is set: the
 * site's functions keep no disk between runs. Fundings are kept on disk
 * only. With neither, every crawl starts from the launch block.
 */

export interface CachedLogs {
  /** The last block whose events are all in here. */
  upTo: number;
  transfers: TapeTransfer[];
  trades: TapeTrade[];
  swaps: TapeSwap[];
}

/** Blocks behind the head that are never cached: the next crawl reads them again. */
export const CACHE_MARGIN_BLOCKS = 50;
const LOGS_VERSION = 1;
const NO_FUNDING_RETRY_MS = 24 * 3600_000;

export const cacheDir = (): string | null => process.env.JUMPER_CACHE_DIR?.trim() || null;

const remote = (): { base: string; key: string } | null => {
  const base = process.env.JUMPER_INDEX_URL?.trim();
  const key = process.env.JUMPER_INDEX_KEY?.trim();
  return !cacheDir() && base && key ? { base: base.replace(/\/$/, ""), key } : null;
};

const logsPath = (dir: string, token: string) => join(dir, "logs", `${token.toLowerCase()}.json.gz`);

/*
 * Columnar, with one address table: a million transfers as objects with
 * two 42-character strings each would be most of the file. Big integers
 * travel as decimal strings.
 */
interface LogsFile {
  v: number;
  upTo: number;
  addrs: string[];
  t: { f: number[]; to: number[]; v: string[]; b: number[]; i: number[] };
  c: { k: number[]; w: number[]; q: string[]; n: string[]; x: string[]; b: number[]; i: number[] };
  s: { buy: number[]; n: string[]; q: string[]; p: number[]; b: number[]; i: number[] };
}

function encode(logs: CachedLogs): Promise<Buffer> {
  const index = new Map<string, number>();
  const addrs: string[] = [];
  const id = (a: string) => {
    const k = a.toLowerCase();
    let n = index.get(k);
    if (n === undefined) { n = addrs.length; addrs.push(k); index.set(k, n); }
    return n;
  };
  const file: LogsFile = {
    v: LOGS_VERSION,
    upTo: logs.upTo,
    addrs,
    t: { f: [], to: [], v: [], b: [], i: [] },
    c: { k: [], w: [], q: [], n: [], x: [], b: [], i: [] },
    s: { buy: [], n: [], q: [], p: [], b: [], i: [] },
  };
  for (const e of logs.transfers) {
    file.t.f.push(id(e.from)); file.t.to.push(id(e.to)); file.t.v.push(e.value.toString()); file.t.b.push(e.block); file.t.i.push(e.logIndex);
  }
  for (const e of logs.trades) {
    file.c.k.push(e.kind === "buy" ? 1 : 0); file.c.w.push(id(e.wallet)); file.c.q.push(e.quoteWei.toString());
    file.c.n.push(e.tokens.toString()); file.c.x.push(e.taxWei.toString()); file.c.b.push(e.block); file.c.i.push(e.logIndex);
  }
  for (const e of logs.swaps) {
    file.s.buy.push(e.buy ? 1 : 0); file.s.n.push(e.tokens.toString()); file.s.q.push(e.quote.toString());
    file.s.p.push(e.price); file.s.b.push(e.block); file.s.i.push(e.logIndex);
  }
  return gzipAsync(JSON.stringify(file), { level: 6 });
}

function decode(buf: Buffer): CachedLogs | null {
  const file = JSON.parse(gunzipSync(buf).toString("utf8")) as LogsFile;
  if (file.v !== LOGS_VERSION) return null;
  const a = file.addrs;
  return {
    upTo: file.upTo,
    transfers: file.t.b.map((b, j) => ({ from: a[file.t.f[j]], to: a[file.t.to[j]], value: BigInt(file.t.v[j]), block: b, logIndex: file.t.i[j] })),
    trades: file.c.b.map((b, j) => ({
      kind: file.c.k[j] ? "buy" as const : "sell" as const, wallet: a[file.c.w[j]], quoteWei: BigInt(file.c.q[j]),
      tokens: BigInt(file.c.n[j]), taxWei: BigInt(file.c.x[j]), block: b, logIndex: file.c.i[j],
    })),
    swaps: file.s.b.map((b, j) => ({
      buy: file.s.buy[j] === 1, tokens: BigInt(file.s.n[j]), quote: BigInt(file.s.q[j]), price: file.s.p[j], block: b, logIndex: file.s.i[j],
    })),
  };
}

/** The token's kept logs, or null when there are none (or no cache is configured). */
export async function loadLogs(token: string): Promise<CachedLogs | null> {
  const r = remote();
  if (r) {
    try {
      const res = await fetch(`${r.base}/logs?token=${token.toLowerCase()}`, { headers: { "x-jumper-key": r.key }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      return decode(Buffer.from(await res.arrayBuffer()));
    } catch {
      return null;
    }
  }
  const dir = cacheDir();
  if (!dir) return null;
  const path = logsPath(dir, token);
  if (!existsSync(path)) return null;
  try {
    const logs = decode(readFileSync(path));
    // the access time drives eviction; mount options may not keep it
    const now = new Date();
    utimesSync(path, now, now);
    return logs;
  } catch {
    return null;
  }
}

/**
 * Whether a crawl that found the cache at `cachedTo` and read `fresh` new
 * events live should rewrite the file: every crawl would, and a busy
 * token's file takes seconds to write, so only a missing cache, a real
 * batch of new events or an hour of drift earn a rewrite.
 */
export const worthSaving = (cachedTo: number, upTo: number, fresh: number): boolean =>
  !cachedTo || fresh >= 2_000 || upTo - cachedTo >= 36_000;

/** Keep a complete read, cut at `upTo`; a later block's events wait for the next crawl. */
export async function saveLogs(token: string, logs: CachedLogs): Promise<void> {
  const cut = <T extends { block: number }>(xs: T[]) => xs.filter((x) => x.block <= logs.upTo);
  const r = remote();
  if (r) {
    const body = await encode({ upTo: logs.upTo, transfers: cut(logs.transfers), trades: cut(logs.trades), swaps: cut(logs.swaps) });
    await fetch(`${r.base}/logs?token=${token.toLowerCase()}`, {
      method: "PUT", headers: { "x-jumper-key": r.key, "content-type": "application/gzip" }, body: new Uint8Array(body), signal: AbortSignal.timeout(60_000),
    });
    return;
  }
  const dir = cacheDir();
  if (!dir) return;
  const path = logsPath(dir, token);
  mkdirSync(join(dir, "logs"), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, await encode({ upTo: logs.upTo, transfers: cut(logs.transfers), trades: cut(logs.trades), swaps: cut(logs.swaps) }));
  renameSync(tmp, path);
}

/** Drop kept logs nobody crawled for `maxAgeMs`; returns how many files went. */
export function evictLogs(maxAgeMs: number): number {
  const dir = cacheDir();
  if (!dir || !existsSync(join(dir, "logs"))) return 0;
  let n = 0;
  for (const name of readdirSync(join(dir, "logs"))) {
    const path = join(dir, "logs", name);
    try {
      if (Date.now() - statSync(path).mtimeMs > maxAgeMs) { unlinkSync(path); n++; }
    } catch { /* gone already */ }
  }
  return n;
}

// ---------------------------------------------------------------- funding

interface FundingLine { wallet: string; at: number; funding: Funding | null }

let fundingMap: Map<string, FundingLine> | null = null;
let fundingFile: string | null = null;

function fundingStore(): Map<string, FundingLine> | null {
  const dir = cacheDir();
  if (!dir) return null;
  const file = join(dir, "funding.jsonl");
  if (fundingMap && fundingFile === file) return fundingMap;
  fundingMap = new Map();
  fundingFile = file;
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as FundingLine;
        fundingMap.set(row.wallet, row);
      } catch { /* a torn last line */ }
    }
  }
  return fundingMap;
}

/** A kept answer for this wallet: a funding, `null` for "none yet" (fresh), undefined when it must be asked. */
export function cachedFunding(wallet: string): Funding | null | undefined {
  const row = fundingStore()?.get(wallet.toLowerCase());
  if (!row) return undefined;
  if (row.funding) return row.funding;
  return Date.now() - row.at < NO_FUNDING_RETRY_MS ? null : undefined;
}

export function keepFunding(wallet: string, funding: Funding | null): void {
  const store = fundingStore();
  if (!store || !fundingFile) return;
  const row: FundingLine = { wallet: wallet.toLowerCase(), at: Date.now(), funding };
  store.set(row.wallet, row);
  mkdirSync(cacheDir()!, { recursive: true });
  appendFileSync(fundingFile, `${JSON.stringify(row)}\n`);
}
