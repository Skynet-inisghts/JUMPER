import { readFileSync } from "node:fs";
import { tapeFromJson } from "../.jumper-build/tape.js";

/** A recorded tape from test/fixtures: real chain data, replayed offline. */
export const fixture = (name) => tapeFromJson(readFileSync(new URL(`./fixtures/${name}.tape.json`, import.meta.url), "utf8"));

const W = (n) => `0x${n.toString(16).padStart(40, "0")}`;
export const addr = W;

/**
 * A small hand-built tape. The curve is 0x...c0, the token 0x...70, the dev
 * 0x...de. Supply 1e27 (1B tokens) so percentages read naturally.
 */
export function tinyTape(overrides = {}) {
  return {
    version: 1,
    launch: {
      token: W(0x70), symbol: "TINY", name: "Tiny", curve: W(0xc0), deployer: W(0xde), creatorFeeRecipient: W(0xde),
      pairToken: W(0), pairIsEth: true, pairSymbol: "ETH", pairDecimals: 18, phase: 0, phaseLabel: "curve",
      graduated: false, curveProgress: 0.1, launchedAt: 1_000_000, launchBlock: 1000, totalSupply: 10n ** 27n,
      devTokens: 0n, exemptions: [],
    },
    headBlock: 1000 + 36_000 * 4,
    now: 1_000_000 + 36_000 * 4 * 0.1,
    secPerBlock: 0.1,
    transfers: [],
    trades: [],
    logsComplete: true,
    history: null,
    historyTip: 0,
    books: null,
    quotePerToken: 1e-9,
    funding: [],
    fundingAsked: 0,
    fundingRead: 0,
    quoteUsd: 3000,
    tokenUsd: null,
    sources: ["test"],
    ...overrides,
  };
}

export const M = 10n ** 24n; // one million tokens: 0.1% of supply
