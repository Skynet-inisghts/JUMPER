import test from "node:test";
import assert from "node:assert/strict";
import { crawlTape } from "../.jumper-build/crawlers/pipeline.js";
import { fixture } from "./helpers.mjs";

// Two recorded crawls of real tokens. The numbers below were read off the
// live crawl and checked by hand against the tape (see the comments); a
// formula change that moves them has to say why in its commit.

test("$TWAIN: six snipers took half the supply in block +1 and all left", () => {
  // Bot-aware score (0.3.0): the snipers already sold, so they are charged
  // nothing for holding; the score is low because the dev dumped (-15), net
  // selling in the last hour was 16% of supply (-24) and the real holders
  // are thin (37% firm).
  const tape = fixture("twain");
  const r = crawlTape(tape);
  assert.equal(r.metrics.sniperWallets, 6);
  assert.equal(r.metrics.sniperExited, 6);
  // 8.49 + 9.20 + 8.90 + 8.86 + 6.58 + 7.94 = 49.97% of supply, in block +1
  assert.ok(Math.abs(r.metrics.sniperSupply - 50) < 0.1, `sniperSupply ${r.metrics.sniperSupply}`);
  assert.equal(r.metrics.devState, "dumped");
  assert.equal(r.metrics.holders, 311);
  assert.equal(r.metrics.transfers, 7395);
  assert.equal(r.metrics.sniperHeld, 0);
  assert.equal(r.score, 3);
  assert.equal(r.band, "TORN");
  assert.equal(r.verdict, "DO NOT TOUCH");
});

test("$TWAIN: snipers are the event recipients, never a relayer", () => {
  const tape = fixture("twain");
  const r = crawlTape(tape);
  const recipients = new Set(tape.trades.filter((t) => t.block <= tape.launch.launchBlock + 2).map((t) => t.wallet.toLowerCase()));
  const snipers = r.holders.filter((h) => h.flags.includes("sniper")).map((h) => h.wallet);
  for (const s of snipers) assert.ok(recipients.has(s), `${s} was not a CurveBuy recipient`);
  // a relayer would show up as one wallet behind many buys; six distinct traders do not
  const snare = r.crawlers.find((c) => c.name === "SNARE");
  assert.equal(snare.lines.filter((l) => l.kind === "flag").length, 6);
});

test("$SODS: a quiet launch, no snipers, smart money present", () => {
  const r = crawlTape(fixture("sods"));
  assert.equal(r.metrics.sniperWallets, 0);
  assert.equal(r.metrics.holders, 80);
  // three of the six "smart" wallets won 98-99% of 150-600 trades: bots, not judgement
  assert.equal(r.metrics.smart, 3);
  assert.equal(r.metrics.devState, "clean");
  // 40% of real holders still in, all held supply settled; smart money thin
  // once the bots are out; pulled down by 10% net selling in the last hour
  assert.equal(r.score, 32);
  assert.equal(r.band, "TORN");
});

test("replays are deterministic", () => {
  const tape = fixture("sods");
  assert.deepEqual(crawlTape(tape), crawlTape(tape));
});

test("every report carries eight crawlers in brand order", () => {
  const r = crawlTape(fixture("sods"));
  assert.deepEqual(r.crawlers.map((c) => c.name), ["WEAVER", "TRACKER", "SNARE", "SCOUT", "KNOT", "LEDGER", "SIEVE", "ORACLE"]);
  assert.equal(r.facts.length, 3);
});

test("the room's material: candles over the token's life and a panel per crawler", () => {
  const r = crawlTape(fixture("twain"));
  assert.equal(r.chart.length, 64);
  for (const c of r.chart) assert.ok(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c));
  assert.equal(r.panels.snare.rows.length, 6);
  assert.ok(r.panels.snare.rows.every((s) => s.block === 1 && s.exited));
  assert.equal(r.panels.tracker.exitsByBucket.reduce((a, b) => a + b, 0), Number(r.crawlers[1].stats[0].split(" ")[0].replace(/\s/g, "")));
  assert.equal(r.panels.sieve.clean + r.panels.sieve.dust + r.panels.sieve.transferOnly + r.panels.sieve.virgins >= r.metrics.holders, true);
});

test("a token with fewer than ten holders gets no score: TOO EARLY", () => {
  // $TWAIN cut to its launch block: the dev and the snipers of block +0 only
  const tape = fixture("twain");
  const cut = tape.launch.launchBlock;
  tape.transfers = tape.transfers.filter((t) => t.block <= cut);
  tape.trades = tape.trades.filter((t) => t.block <= cut);
  tape.swaps = (tape.swaps ?? []).filter((s) => s.block <= cut);
  const r = crawlTape(tape);
  assert.ok(r.metrics.holders < 10, `holders ${r.metrics.holders}`);
  assert.equal(r.outcome?.kind, "too early");
});

test("supply handed out instead of bought gets no score: NO VERDICT", () => {
  // the top holders of $TWAIN send everything they hold to 25 new wallets,
  // so a third of the held supply sits with wallets that never bought
  const tape = fixture("twain");
  assert.equal(crawlTape(tape).outcome, null);
  const r0 = crawlTape(tape);
  const head = tape.headBlock;
  let logIndex = 10_000;
  let moved = 0;
  for (const h of r0.holders.filter((x) => !x.roles.includes("dev"))) {
    if (moved >= 34) break;
    const bal = tape.transfers.reduce((a, t) => a + (t.to.toLowerCase() === h.wallet ? t.value : 0n) - (t.from.toLowerCase() === h.wallet ? t.value : 0n), 0n);
    const part = bal / 25n;
    for (let i = 0; i < 25; i++) {
      tape.transfers.push({ from: h.wallet, to: `0x${(0xd00d0000 + logIndex).toString(16).padStart(40, "0")}`, value: part, block: head, logIndex: logIndex++ });
    }
    moved += h.share;
  }
  const r = crawlTape(tape);
  assert.equal(r.outcome?.kind, "no verdict", JSON.stringify(r.outcome));
});

test("a few big equal chunks handed out is a stash, not an airdrop: it is scored", () => {
  const tape = fixture("twain");
  const r0 = crawlTape(tape);
  const giver = r0.holders[0].wallet;
  const bal = tape.transfers.reduce((a, t) => a + (t.to.toLowerCase() === giver ? t.value : 0n) - (t.from.toLowerCase() === giver ? t.value : 0n), 0n);
  // the top holder hands its bag out in 22 chunks of about 1% of supply
  const chunk = tape.launch.totalSupply / 100n;
  for (let i = 0; i < 22 && chunk * BigInt(i + 1) <= bal; i++) {
    tape.transfers.push({ from: giver, to: `0x${(0xcafe00 + i).toString(16).padStart(40, "0")}`, value: chunk, block: tape.headBlock, logIndex: 80_000 + i });
  }
  const r = crawlTape(tape);
  assert.notEqual(r.outcome?.kind, "no verdict", JSON.stringify(r.outcome));
});
