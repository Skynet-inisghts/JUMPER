# Changelog

## 0.7.1 · 2026-10-20

- A token that many bought and nearly all sold reads SOLD OUT instead of TOO EARLY.
- The Telegram bot answers TOO EARLY, SOLD OUT or NO VERDICT with the reason instead of a score for such a token.
- The menu shows the Telegram bot as its app icon, next to Run a crawl.

## 0.7.0 · 2026-10-20

- Trade on Axiom and Trade on GMGN buttons on every report, opening that token.
- A $JUMPER block on the home page: the contract to copy, links to trade it, its chart and how much of it was burned.
- A Telegram bot, @jumper_terminal_bot: send a token address or a $TICKER and it answers with the share card, the score, three facts and buttons to the full report and to trade. Linked from the menu and the footer.
- A token too early to read (under ten holders) gets TOO EARLY instead of a score; one whose supply was handed out in many small drops gets NO VERDICT. A few big chunks handed out are a stash and are scored as usual.
- A price 80% or more below its peak gets a warning over the report: probably rugged or price collapsed, how deep, how long ago, and who did the selling since the peak, by kind of wallet.
- A token with more history than one crawl can read counts down and crawls again by itself while its history is read.

## 0.6.1 · 2026-10-18

- Logos load on more cards: a logo kept as a link to any IPFS gateway is read through the gateway pons uses, the pons gateway is tried twice, the RPC read of the logo once more, and logos up to 4 MB are kept.
- A card drawn without its logo is cached for a minute instead of hours, so a slow gateway no longer leaves a token without its logo.

## 0.6.0 · 2026-10-18

- The report shows the market: price, market cap, liquidity, 24h volume, holders, top ten, age and the creator, on one line over the chart.
- A market cap chart on a log scale with its axis on the right: a purple line or candles, one-minute candles for the last day, five-minute for the last week, or the whole life. The wheel or a pinch zooms, a drag scrolls, a double click on the time axis fits it all. Over it, the all-time high, the low since then and now.
- A crawl keeps one- and five-minute candles in its report.

## 0.5.4 · 2026-10-18

- Token logos load again on share cards: pons moved its image gateway, and the old address answered 404 for every logo. Logos are read through the gateway the pons site uses now, then the old one, then a public IPFS gateway.

## 0.5.3 · 2026-10-18

- The site does not crawl $JUMPER itself (0xce45…7d7a): asking for it answers with one line instead of a report, and no share card is drawn for it.

## 0.5.2 · 2026-10-17

- Every minute the site reads the logs of the five busiest Pons tokens of the last hour into the cache, so a first crawl on a token people are trading reads only its newest blocks.
- A long history warms in windows of a million blocks, each kept as soon as it is read, and resumes on the next run.

## 0.5.1 · 2026-10-17

- A token with a long history no longer stops its first crawl with "crawl it again in a few minutes": the site reads the whole history in the same request, with live progress, and answers with the report. Only a history that does not fit the function at all still asks to come back.

## 0.5.0 · 2026-10-11

- A crawl on the site answers inside 20 seconds. Logs are read in pages sized to their density, each page parsed as it lands.
- A token's logs are kept after a complete read (on disk with `JUMPER_CACHE_DIR`, or in the wallet index) and the next crawl reads only the new blocks.
- A history too long for the first crawl says so; the site reads it on after the answer, in resumable windows, yielding the RPC to live crawls.
- KNOT: six-second budget on the site, fundings kept for good, and the explorer left alone for five minutes once its limit is spent.
- Late sources (index, prices) past the finish line are left out instead of waited on.
- The holders table centres its numbers between WHO and the right edge; the logo in the crawl screen closes it.

## 0.4.1 · 2026-10-10

- The site lives at jumper-terminal.xyz. www and the old jumper-crawler.vercel.app address redirect there, path and token kept.
- Share cards carry the new address.

## 0.4.0 · 2026-10-07

- The crawl plays out in the room: the holder graph builds on the back wall, each crawler's desk lights up while it works with its live progress and newest line, crawlers run errands to the wall, waiting ones doze, finished desks turn green with their result.
- Spiders walk the crawl screen too, and no longer freeze while it is open.
- The report: the share card is a square as tall as the score block beside it; the top 50 holders run the full width below with roles: dev, insider (got tokens from or was funded by the dev, or sat in the launch bundle), sniper, bot, whale (3% of supply or $25k), smart, bundle, fresh wallet, trader.

## 0.3.1 · 2026-10-07

- The report lists the top 50 holders by share of supply and says who each one is: the launcher, a sniper, a trading bot, smart money, a bundle, a trader with its record, a first-timer.
- A near-perfect winrate over fifty or more trades marks a bot, not smart money.
- SNARE reads "none" in green when nobody sniped; EXIT shows both sides of the last hour and what leavers took out in dollars.
- Spiders walk over the crawl screen too; the holder table and the log stand at one height.

## 0.3.0 · 2026-10-06

- The score judges people, not bots. Snipers and wallets that sold out within ten minutes of buying are left out of retention and of the first-minute cohort.
- Retention is the share of real holders still in, averaged with the share of held supply that has settled; the old peak-based "gone" grew with a token's age and pushed every mature token to TORN.
- Snipers are charged only for what they still hold; a first minute with fewer than five real buyers is neutral.
- Weights 60 / 25 / 15, smart money full at 3% of supply, exit pressure 1.5 per %.
- The report shows the points that built the score.
- A third as many spiders on the page.

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
