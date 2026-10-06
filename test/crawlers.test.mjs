import test from "node:test";
import assert from "node:assert/strict";
import { weave } from "../.jumper-build/crawlers/weaver.js";
import { knot } from "../.jumper-build/crawlers/knot.js";
import { snare } from "../.jumper-build/crawlers/snare.js";
import { crawlTape } from "../.jumper-build/crawlers/pipeline.js";
import { addr, tinyTape, M } from "./helpers.mjs";

const CURVE = addr(0xc0);
const ZERO = addr(0);
const ROUTER = addr(0x90);
const ALICE = addr(0xa1);
const BOB = addr(0xb0);
const tr = (from, to, value, block, logIndex) => ({ from, to, value, block, logIndex });
const mint = tr(ZERO, CURVE, 10n ** 27n, 1000, 0);

test("WEAVER credits a routed buy to the wallet at the far end", () => {
  const tape = tinyTape({
    transfers: [mint, tr(CURVE, ROUTER, 10n * M, 1005, 1), tr(ROUTER, ALICE, 10n * M, 1005, 2)],
    trades: [{ kind: "buy", wallet: ROUTER, quoteWei: 10n ** 16n, tokens: 10n * M, taxWei: 0n, block: 1005, logIndex: 0 }],
  });
  const web = weave(tape);
  assert.ok(web.routers.has(ROUTER));
  assert.deepEqual(web.holders.map((h) => h.address), [ALICE]);
  assert.equal(web.wallets.get(ALICE).bought, 10n * M);
  assert.equal(web.wallets.get(ALICE).received, 0n);
  assert.equal(web.trades[0].wallet, ALICE);
});

test("WEAVER credits a routed sale to the wallet that sent the tokens", () => {
  const tape = tinyTape({
    transfers: [mint, tr(CURVE, ALICE, 10n * M, 1005, 1), tr(ALICE, ROUTER, 4n * M, 2000, 1), tr(ROUTER, CURVE, 4n * M, 2000, 2)],
    trades: [
      { kind: "buy", wallet: ALICE, quoteWei: 10n ** 16n, tokens: 10n * M, taxWei: 0n, block: 1005, logIndex: 0 },
      { kind: "sell", wallet: ROUTER, quoteWei: 4n * 10n ** 15n, tokens: 4n * M, taxWei: 0n, block: 2000, logIndex: 0 },
    ],
  });
  const web = weave(tape);
  assert.equal(web.wallets.get(ALICE).sold, 4n * M);
  assert.equal(web.wallets.get(ALICE).balance, 6n * M);
  assert.equal(web.trades[1].wallet, ALICE);
});

test("a hand-off between two wallets is a transfer, not a buy", () => {
  const tape = tinyTape({ transfers: [mint, tr(CURVE, ALICE, 10n * M, 1005, 1), tr(ALICE, BOB, 3n * M, 3000, 1)] });
  const web = weave(tape);
  assert.equal(web.routers.size, 0);
  assert.equal(web.wallets.get(BOB).received, 3n * M);
  assert.equal(web.wallets.get(BOB).bought, 0n);
  assert.equal(web.wallets.get(BOB).parent, ALICE);
});

test("SNARE takes the first three blocks and leaves the dev out", () => {
  const DEV = addr(0xde);
  const buy = (wallet, block, tokens) => ({ kind: "buy", wallet, quoteWei: 1n, tokens, taxWei: 0n, block, logIndex: 0 });
  const tape = tinyTape({
    transfers: [mint, tr(CURVE, DEV, 5n * M, 1000, 1), tr(CURVE, ALICE, 20n * M, 1002, 1), tr(CURVE, BOB, 7n * M, 1003, 1)],
    trades: [buy(DEV, 1000, 5n * M), buy(ALICE, 1002, 20n * M), buy(BOB, 1003, 7n * M)],
  });
  const s = snare(tape, weave(tape));
  assert.deepEqual(s.snipers.map((x) => x.wallet), [ALICE]);
  assert.equal(s.sniperTokens, 20n * M);
});

test("KNOT ties wallets funded from one source within ten minutes, not further apart", () => {
  const C = addr(0xc1);
  const D = addr(0xd1);
  const F = addr(0xf0);
  const transfers = [mint, ...[ALICE, BOB, C, D].map((w, i) => tr(CURVE, w, M, 1005 + i, 1))];
  const funding = [
    { wallet: ALICE, funder: F, ts: 1000, block: 1, valueWei: "1", via: "tx" },
    { wallet: BOB, funder: F, ts: 1300, block: 2, valueWei: "1", via: "tx" },
    { wallet: C, funder: F, ts: 1500, block: 3, valueWei: "1", via: "tx" },
    { wallet: D, funder: F, ts: 9000, block: 4, valueWei: "1", via: "tx" },
  ];
  const tape = tinyTape({ transfers, funding, fundingAsked: 4, fundingRead: 4 });
  const k = knot(tape, weave(tape));
  assert.equal(k.clusters.length, 1);
  assert.deepEqual(k.clusters[0].wallets, [ALICE, BOB, C]);
  assert.equal(k.bundleSupply, 3n * M);
});

test("without the index SCOUT says it is offline instead of guessing", () => {
  const tape = tinyTape({ transfers: [mint, tr(CURVE, ALICE, 10n * M, 1005, 1)] });
  const r = crawlTape(tape);
  assert.equal(r.quadrants.silk.online, false);
  assert.match(r.facts[1], /smart money unread/);
});

test("gone never pushes past what holders do not hold", () => {
  // Alice buys and sells the whole float three times: her peaks add up to 3x
  const transfers = [mint];
  let block = 1005;
  for (let i = 0; i < 3; i++) {
    transfers.push(tr(CURVE, ALICE, 500n * M, block++, 1));
    transfers.push(tr(ALICE, CURVE, 500n * M, block++, 1));
  }
  transfers.push(tr(CURVE, BOB, 100n * M, block++, 1));
  const r = crawlTape(tinyTape({ transfers }));
  assert.ok(r.metrics.hold + r.metrics.gone <= 100.0001);
});
