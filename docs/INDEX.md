# The wallet-history index

SCOUT and LEDGER read from an index of every Pons curve and pool trade,
folded to one record per wallet and market. JUMPER does not ship the index
itself; it talks to any service that answers the contract below.

Set `JUMPER_INDEX_URL` and `JUMPER_INDEX_KEY` in `.env`. Every request
carries the key in the `x-jumper-key` header.

## POST /history

```json
{ "wallets": ["0x…", "0x…"], "exclude": "0x<crawled token>" }
```

For each wallet, its record across every Pons market except the excluded
token (so insiders cannot decorate a token with its own pump):

```json
{
  "tip": 81847471,
  "wallets": {
    "0x…": {
      "markets": 42,
      "positions": 32,
      "wins": 11,
      "winrate": 33.3,
      "avgPnlPct": 12.9,
      "realizedEth": 0.0029,
      "trades": 82,
      "lastBlock": 57578296
    }
  }
}
```

Only realized positions are judged: something bought and something sold,
cost of the sold part against what it fetched. A position sold beyond what
was bought has no honest basis and is skipped. `winrate` is
`wins / (positions + 1)` and null under two positions; the extra loss in the
denominator keeps a newcomer's lucky first flip from reading as 100%.

## POST /positions

```json
{ "token": "0x…", "curve": "0x…" }
```

Every wallet's book on one token, curve and pool trades added together, in
base units, plus the price of the newest trade:

```json
{
  "tip": 81847471,
  "wallets": { "0x…": { "buyTokens": 4.4e25, "buyQuote": 1.0e17, "sellTokens": 0, "sellQuote": 0, "trades": 1, "lastBlock": 50189686 } },
  "price": { "quotePerToken": 2.4e-9, "block": 81846000 }
}
```

## Site endpoints

`POST /crawls` records a finished crawl (summary and report), `GET /pulse`
returns the counters the hero shows and the recently crawled tokens,
`GET /latest` the newest full report for the replay panels.

## GET /logs, PUT /logs

`?token=0x…`. A token's logs as the engine's log cache writes them
(`src/cache.ts`: gzip, columnar JSON). The site keeps no disk between
crawls, so it reads a token's logs from here and puts them back after a
complete read; 404 when none are kept.
