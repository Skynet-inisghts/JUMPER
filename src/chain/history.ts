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
 *   POST /tokens     { tokens }             a few tokens at a glance: ticker, wallets, last trade, verdict
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

/** A token at a glance, from the index: for a dev's other launches. */
export interface TokenGlance {
  token: string;
  symbol: string | null;
  block: number;
  wallets: number;
  trades: number;
  lastBlock: number;
  verdict: { score: number; band: string; at: number } | null;
}

export const readTokens = async (tokens: string[]): Promise<TokenGlance[]> =>
  (await call<{ tokens: TokenGlance[] }>("/tokens", { tokens }, 15_000)).tokens;

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

/** Launches old enough for the /proof backtest, the most traders first. */
export const readProofCandidates = async (): Promise<string[]> =>
  (await call<{ tokens: { token: string }[] }>("/proof-candidates", undefined, 30_000)).tokens.map((t) => t.token);

/** The rolling /proof backtest, or null before the first run. */
export async function readProof<T>(): Promise<T | null> {
  try {
    return await call<T>("/proof", undefined, 10_000);
  } catch (e) {
    if (String(e).includes("HTTP 404")) return null;
    throw e;
  }
}

export async function writeProof(proof: unknown): Promise<void> {
  const base = process.env.JUMPER_INDEX_URL!.trim().replace(/\/$/, "");
  const res = await fetch(`${base}/proof`, {
    method: "PUT",
    headers: { "content-type": "application/json", "x-jumper-key": process.env.JUMPER_INDEX_KEY!.trim() },
    body: JSON.stringify(proof),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`index /proof: HTTP ${res.status}`);
}
/** One launch on the radar: read off the trade index, bought minus sold per wallet. */
export interface RadarRow {
  token: string; symbol: string; ageMin: number; buyers: number; stayed: number; kept: number;
  top: number; snipe: number; smartIn: number; volEth: number; mcapUsd: number | null; fromPeak: number; rank: number;
  /** when the radar first showed it, at what cap, and its price since as a multiple */
  entryAt?: number; entryMcapUsd?: number | null; sinceX?: number | null;
  /** the full crawl's score, once the site has run it */
  score?: number; band?: string; label?: string; scoredAt?: number;
}
export interface Radar { at: number; rows: RadarRow[]; checked?: number; others?: { token: string; symbol: string; ageMin: number }[] }
export const readRadar = (): Promise<Radar> => call<Radar>("/radar", undefined, 8_000);

/** The bot's watchlist: jumper-watch on the index host sends the alerts. */
export async function watchToken(chat: number, token: string, deployer?: string): Promise<{ ok?: boolean; symbol?: string; already?: boolean; count?: number; error?: string }> {
  const base = process.env.JUMPER_INDEX_URL!.trim().replace(/\/$/, "");
  const res = await fetch(`${base}/watch`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-jumper-key": process.env.JUMPER_INDEX_KEY!.trim() },
    body: JSON.stringify({ chat, token, deployer }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await res.json()) as { ok?: boolean; symbol?: string; already?: boolean; count?: number; error?: string };
}
export const unwatchToken = (chat: number, token?: string): Promise<{ removed: number }> => call<{ removed: number }>("/unwatch", { chat, token }, 10_000);
export const readWatches = (chat: number): Promise<{ rows: { token: string; symbol: string }[]; radar: boolean }> =>
  call<{ rows: { token: string; symbol: string }[]; radar: boolean }>(`/watches?chat=${chat}`, undefined, 10_000);
export const radarSub = (chat: number, on: boolean): Promise<{ on: boolean }> => call<{ on: boolean }>("/radar-sub", { chat, on }, 10_000);

/** What became of every token the radar showed over the last days. */
export interface RadarHistory {
  at: number; days: number;
  stats: { spotted: number; settled: number; reached2x: number; fell50at24h: number; medianX24h: number | null } | null;
  rows: { token: string; symbol: string; firstAt: number; firstMcapUsd: number | null; peakX: number | null; x6h: number | null; x24h: number | null; xNow: number | null; score: number | null; band: string | null; label: string | null }[];
}
export const readRadarHistory = (): Promise<RadarHistory> => call<RadarHistory>("/radar-history", undefined, 8_000);
export const readRadarScoreQueue = async (): Promise<{ token: string; scoredAt: number | null }[]> =>
  (await call<{ rows: { token: string; scoredAt: number | null }[] }>("/radar-scores", undefined, 8_000)).rows;
export const writeRadarScore = (token: string, score: number, band: string, label: string): Promise<unknown> =>
  call("/radar-score", { token, score, band, label }, 8_000);

/** One big sell of the last hour; the dev flag is the site's, from the launch event. */
export interface ExitSell { wallet: string; block: number; minAgo: number; share: number; eth: number; bagSold: number | null; left: number | null; dev?: boolean }
export interface ExitRow { token: string; symbol: string; ageMin: number; mcapEth: number | null; sold: number; eth: number; sellers: number; lastMinAgo: number; sells: ExitSell[] }
export const readExits = (): Promise<{ at: number; rows: ExitRow[] }> => call<{ at: number; rows: ExitRow[] }>("/exits", undefined, 15_000);

/** The launchpad map jumper-watch draws every five minutes. */
export interface MapNode { token: string; symbol: string; ageMin: number; wallets: number; mcapUsd: number | null; peakUsd: number | null; fromPeak: number; score: number | null; label: string | null; radar: boolean }
export const readMap = (): Promise<{ at: number; nodes: MapNode[] }> => call<{ at: number; nodes: MapNode[] }>("/map", undefined, 10_000);

/** A dev's launches and what became of them. */
export interface DevToken { token: string; symbol: string; ageMin: number; wallets: number; peakMcapEth: number | null; nowMcapEth: number | null; devBuyEth: number; devSellEth: number; devSold: number | null }
export const readDevTokens = (dev: string, tokens: string[]): Promise<{ dev: string; rows: DevToken[] }> =>
  call<{ dev: string; rows: DevToken[] }>("/dev", { dev, tokens }, 30_000);

/** Wallets that move together, from the jumper-clusters job. */
export interface Cluster {
  id: string; wallets: string[]; size: number; tokenCount: number; spentEth: number; backEth: number; lastMinAgo: number;
  tokens: { token: string; symbol: string; together: number; held: number; kept: number }[];
  holding: { token: string; symbol: string; together: number; held: number; kept: number }[];
}
export const readClusters = (): Promise<{ at: number; windowH: number; clusters: Cluster[] }> =>
  call<{ at: number; windowH: number; clusters: Cluster[] }>("/clusters", undefined, 10_000);

/** The bot's price alerts and followed wallets; jumper-watch sends the messages. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.JUMPER_INDEX_URL!.trim().replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-jumper-key": process.env.JUMPER_INDEX_KEY!.trim() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  // the index's refusals carry a reason the bot shows as is
  return (await res.json()) as T;
}
export const addPriceAlert = (chat: number, token: string, mult: number) =>
  post<{ ok?: boolean; symbol?: string; price?: number; target?: number; count?: number; error?: string }>("/alert", { chat, token, mult });
export const readPriceAlerts = (chat: number) =>
  call<{ rows: { token: string; symbol: string; mult: number }[] }>(`/alerts?chat=${chat}`, undefined, 10_000);
export const clearPriceAlerts = (chat: number, token?: string) => post<{ removed?: number }>("/alert-clear", { chat, token });
export const followWallet = (chat: number, wallet: string) => post<{ ok?: boolean; already?: boolean; count?: number; error?: string }>("/follow", { chat, wallet });
export const unfollowWallet = (chat: number, wallet?: string) => post<{ removed?: number }>("/unfollow", { chat, wallet });
export const readFollows = (chat: number) => call<{ rows: { wallet: string }[] }>(`/follows?chat=${chat}`, undefined, 10_000);
/** Watched tokens the site should crawl again, so a changed score reaches the watchers. */
export const readWatchScoreQueue = async (): Promise<string[]> =>
  (await call<{ rows: { token: string }[] }>("/watch-scores", undefined, 8_000)).rows.map((r) => r.token);
export const writeWatchScore = (token: string, score: number, band: string, label: string) =>
  post<{ changed?: boolean }>("/watch-score", { token, score, band, label });

export const readPulse = (): Promise<Pulse> => call<Pulse>("/pulse", undefined, 8_000);

export const readLatest = <T>(): Promise<{ report: T | null }> => call<{ report: T | null }>("/latest", undefined, 8_000);

export async function recordCrawl(summary: Record<string, unknown>, report: unknown): Promise<void> {
  await call("/crawls", { summary, report }, 8_000);
}
