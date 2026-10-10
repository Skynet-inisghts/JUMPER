import { SOURCES } from "./chain.js";

/**
 * Every Blockscout API request goes through this one gate.
 *
 * The hosted instance fronts its API with a Cloudflare bot challenge; a
 * DevPortal key (sent as the x-api-key header) passes it. Free-plan keys are
 * limited to about 5 requests per second, so the gate spaces requests 250 ms
 * apart process-wide and answers a 429 with one patient retry — the terminal
 * degrades to its fallbacks instead of falling over.
 */

export class BlockscoutError extends Error {
  constructor(message: string, public readonly reason: "challenge" | "rate-limit" | "http") {
    super(message);
  }
}

const SPACING_MS = 250; // 4 req/s, under the free plan's 5
let lastStart = 0;
let queue: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function acquire(): Promise<void> {
  const my = queue.then(async () => {
    const wait = lastStart + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
  });
  queue = my.catch(() => {});
  return my;
}

export const blockscoutKey = (): string | undefined => process.env.BLOCKSCOUT_API_KEY?.trim() || undefined;

/** The Etherscan-compatible endpoint (/api?module=…), used where v2 has no ascending sort. */
export const blockscoutFetchLegacy = (query: string): Promise<unknown> => blockscoutFetch(`/api?${query}`);

/** GET an /api/v2 path; JSON out or a typed BlockscoutError. */
/** After the key's limit is spent the explorer is left alone for a while: every ask would only wait to be refused. */
let restingUntil = 0;
const REST_MS = 5 * 60_000;
export const blockscoutResting = (): boolean => Date.now() < restingUntil;

export async function blockscoutFetch(path: string): Promise<unknown> {
  if (blockscoutResting()) throw new BlockscoutError("Blockscout rate limit reached; try again in a moment", "rate-limit");
  const key = blockscoutKey();
  for (let attempt = 0; attempt < 2; attempt++) {
    await acquire();
    const res = await fetch(`${SOURCES.blockscout}${path}`, {
      headers: {
        accept: "application/json",
        "user-agent": "jumper/0.1",
        ...(key ? { "x-api-key": key } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (res.status === 403 && /just a moment|cloudflare|challenge/i.test(text)) {
      throw new BlockscoutError(
        "Blockscout answers this network with a bot challenge; set BLOCKSCOUT_API_KEY (free at dev.blockscout.com)",
        "challenge",
      );
    }
    if (res.status === 429) {
      // The free plan's limit; wait out the window once, then give up honestly.
      if (attempt === 0) { await sleep(1_200); continue; }
      restingUntil = Date.now() + REST_MS;
      throw new BlockscoutError("Blockscout rate limit reached; try again in a moment", "rate-limit");
    }
    if (res.status >= 500) {
      // The hosted instance hiccups now and then; one patient retry usually lands.
      if (attempt === 0) { await sleep(800); continue; }
      throw new BlockscoutError(`Blockscout answered HTTP ${res.status}; usually transient, try again in a few seconds`, "http");
    }
    if (!res.ok) throw new BlockscoutError(`Blockscout returned HTTP ${res.status}`, "http");
    try {
      return JSON.parse(text);
    } catch {
      throw new BlockscoutError("Blockscout returned a non-JSON body", "http");
    }
  }
  throw new BlockscoutError("Blockscout rate limit reached; try again in a moment", "rate-limit");
}
