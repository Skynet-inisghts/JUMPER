/**
 * Client for the wallet-history index: a service that has folded every
 * Pons curve and pool trade on the chain into one record per wallet and
 * market. SCOUT reads holders' records from it, LEDGER reads every book on
 * the crawled token, and the site reads its pulse.
 *
 * Why an index at all: the public RPC answers an eth_getLogs without an
 * address filter for 30,000 blocks at most (100,000 with a list), and the
 * Pons history is tens of millions of blocks with thousands of launches a
 * day. Following a wallet across every other token is a database query or
 * it is nothing.
 *
 * The index is optional. Without JUMPER_INDEX_URL the crawl still runs:
 * SCOUT reports itself offline and LEDGER rebuilds books from curve trades.
 *
 *   POST /history    { wallets, exclude }   per-wallet record, the crawled token excluded
 *   POST /positions  { token, curve }       every wallet's book on one token
 *   POST /crawls     { summary, report }    the site records a finished crawl
 *   GET  /pulse                             counters and recently crawled tokens
 *   GET  /latest                            the newest full report
 *   GET  /logs?token=  PUT /logs?token=     a token's cached logs (see src/cache.ts)
 *   GET  /leaders?by=  GET /smartflow       leaderboard, smart money buying in the last hour
 *   GET  /active                            the Pons tokens busiest in the last hour
 *   GET  /wallet?address=                   one wallet: record, last markets, reports that name it
 */

export interface WalletHistory {
  /** Other Pons markets this wallet ever traded. 0 means this token is its first. */
  markets: number;
  /** Positions with a realized result (something bought, something sold). */
  positions: number;
  wins: number;
  /** wins / (positions + 1) as a percent; null under two positions. */
  winrate: number | null;
  avgPnlPct: number | null;
  realizedEth: number;
  trades: number;
  lastBlock: number;
}

export interface MarketBook {
  buyTokens: number;
  buyQuote: number;
  sellTokens: number;
  sellQuote: number;
  trades: number;
  lastBlock: number;
}

export interface TokenBooks {
  wallets: Record<string, MarketBook>;
  /** Quote per token (both in base units) at the market's newest trade. */
  price: { quotePerToken: number; block: number } | null;
  tip: number;
}

export interface Pulse {
  at: number;
  crawlsToday: number;
  crawlsLastHour: number;
  crawlsTotal: number;
  avgCrawlMs: number;
  launchesToday: number;
  walletsIndexed: number;
  indexTip: number;
  recent: { token: string; symbol: string; holders: number; score: number; band: string; at: number }[];
}

export const indexConfigured = (): boolean => Boolean(process.env.JUMPER_INDEX_URL?.trim() && process.env.JUMPER_INDEX_KEY?.trim());

async function call<T>(path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const base = process.env.JUMPER_INDEX_URL!.trim().replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-jumper-key": process.env.JUMPER_INDEX_KEY!.trim() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`index ${path}: HTTP ${res.status} ${text.slice(0, 120)}`);
  return JSON.parse(text) as T;
}

/** Records for up to a few hundred wallets, the crawled token left out of each. */
export async function readHistory(wallets: string[], exclude: string): Promise<{ tip: number; wallets: Record<string, WalletHistory> }> {
  const out: Record<string, WalletHistory> = {};
  let tip = 0;
  // A trading bot's record spans hundreds of thousands of markets and costs
  // the index seconds; small batches keep one bot from holding up the rest.
  const batches: string[][] = [];
  for (let i = 0; i < wallets.length; i += 60) batches.push(wallets.slice(i, i + 60));
  await Promise.all(batches.map(async (batch) => {
    const r = await call<{ tip: number; wallets: Record<string, WalletHistory> }>("/history", { wallets: batch, exclude }, 45_000);
    tip = Math.max(tip, r.tip);
    Object.assign(out, r.wallets);
  }));
  return { tip, wallets: out };
}

/** The Pons tokens with the most trades in the last hour, busiest first. */
export const readActive = async (): Promise<string[]> => (await call<{ tokens: string[] }>("/active", undefined, 10_000)).tokens;

/** One wallet for the site's wallet check: its record, last markets, and the kept reports that name it. */
export interface WalletCheck {
  wallet: string;
  tip: number;
  record: WalletHistory;
  seen: { token: string; symbol: string; score: number; band: string; at: number; roles: string[]; who: string | null; share: number | null; early: { delaySec: number; status: string } | null }[];
  recent: { token: string; symbol: string | null; trades: number; lastBlock: number; boughtEth: number; soldEth: number; verdict: { score: number; band: string; at: number } | null }[];
}

export const readWallet = (address: string): Promise<WalletCheck> => call<WalletCheck>(`/wallet?address=${address.toLowerCase()}`, undefined, 15_000);

/** The leaderboard the index's leaders job keeps: wallets of the busiest markets, bots left out. */
export interface Leaders {
  at: number;
  by: "realized" | "winrate";
  rows: { wallet: string; markets: number; positions: number; winrate: number | null; avgPnl: number; realized: number; trades: number; lastBlock: number; smart: number }[];
}

/** Smart money moving now: the last hour's buys by smart wallets, per token. */
export interface SmartFlow {
  at: number;
  smartWallets: number;
  tip: number;
  tokens: { token: string; symbol: string | null; smartBuyers: number; eth: number; lastBlock: number }[];
}

export const readLeaders = (by: "realized" | "winrate"): Promise<Leaders> => call<Leaders>(`/leaders?by=${by}`, undefined, 15_000);
export const readSmartFlow = (): Promise<SmartFlow> => call<SmartFlow>("/smartflow", undefined, 20_000);

export const readBooks = (token: string, curve: string): Promise<TokenBooks> => call<TokenBooks>("/positions", { token, curve });

export const readPulse = (): Promise<Pulse> => call<Pulse>("/pulse", undefined, 8_000);

export const readLatest = <T>(): Promise<{ report: T | null }> => call<{ report: T | null }>("/latest", undefined, 8_000);

export async function recordCrawl(summary: Record<string, unknown>, report: unknown): Promise<void> {
  await call("/crawls", { summary, report }, 8_000);
}
