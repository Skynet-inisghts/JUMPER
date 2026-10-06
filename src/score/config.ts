/**
 * Every weight and threshold the crawl uses, in one place. Change a number
 * here and the fixtures in test/ tell you which reports moved.
 */

export const SCORE = {
  /** Positive terms, summing to 1: how much of the web is still standing. */
  weights: {
    /** hold / (hold + gone): of everything wallets ever held, the share still held. */
    retention: 0.45,
    /** share of first-minute buyers still keeping 80% of their peak. */
    firstMinuteKept: 0.3,
    /** smart-wallet supply, saturating at `smartSupplyFull` percent. */
    smartSupply: 0.25,
  },
  smartSupplyFull: 10,
  /** Penalties, in score points per percent of supply (or flat for the dev). */
  penalties: {
    sniperSupplyPerPct: 0.8,
    exitPressurePerPct: 2.0,
    bundleSupplyPerPct: 0.4,
    devSoldHalf: 7,
    devDumped: 15,
  },
} as const;

export const THRESHOLDS = {
  /** SNARE: buys inside the launch block and the two after it. */
  sniperBlocks: 3,
  /** First-minute cohort window and the keep ratio (balance >= 80% of peak). */
  firstMinuteSec: 60,
  /** A first minute with fewer buyers than this widens to the first this-many, out to cohortMaxSec. */
  cohortMin: 20,
  cohortMaxSec: 600,
  keepRatio: 0.8,
  /** SCOUT: a wallet is smart at this winrate over at least this many realized positions. */
  smartWinrate: 55,
  smartMinPositions: 5,
  /** SCOUT: a record this thin is "short history". */
  shortHistoryMarkets: 3,
  /** SCOUT looks up this many of the largest holders (plus every sniper). */
  scoutHolders: 300,
  /** Wallets that traded this many markets are bots; their winrate is not a signal. */
  botMarkets: 5_000,
  /** KNOT: same funder within this many seconds is one cluster. */
  knotWindowSec: 600,
  /** KNOT looks up the funding of this many top holders and snipers, inside the budget. */
  knotWallets: 40,
  knotBudgetMs: 25_000,
  /** SIEVE: positions worth less than this are dust. */
  dustUsd: 50,
  /** TRACKER: dev sold this share of its peak = "sold half", this much = "dumped". */
  devSoldHalf: 0.25,
  devDumped: 0.9,
  /** TRACKER: exit pressure looks back this far. */
  exitWindowSec: 3_600,
} as const;
