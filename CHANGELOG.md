# Changelog

## 0.2.0 · 2026-10-06

- The room shows the crawl: the token's own candles replay on the back wall (curve trades, then Uniswap v4 swaps after graduation) with the tracked wallets' trades marked, every desk monitor shows its crawler's findings, crawlers read their log lines aloud, a crawler.log strip runs under the screen.
- Pool swaps are read per pool id; fills after graduation carry their real quote instead of an average.
- Reports carry `chart` and `panels`.
- Site crawls stop reading logs after 240 s and say so, instead of running into the 300 s function limit.
- README: site screenshots, the terminal view, share cards, brand sheets.

## 0.1.0 · 2026-10-06

First release.

- Eight crawlers over one token: WEAVER, TRACKER, SNARE, SCOUT, KNOT, LEDGER, SIEVE, ORACLE.
- Score 0-100 on the web scale (TORN / PATCHED / TAUT), weights in `src/score/config.ts`.
- Router pass-through detection: routed trades credited to the wallet at the far end.
- CLI: `jumper <ca|$TICKER>` with `--card`, `--json`, `--tape`; `replay`, `doctor`.
- 1080x1080 share card.
- Recorded tapes of real tokens ($TWAIN, $SODS) as test fixtures; 21 tests.
- Site: hero, the room, eight crawlers, crawlers at work, run a crawl, spider layer.
