import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crawlTape } from "../.jumper-build/crawlers/pipeline.js";
import { cachedFunding, keepFunding, loadLogs, saveLogs, worthSaving } from "../.jumper-build/cache.js";
import { fixture } from "./helpers.mjs";

// The log cache must hand back exactly what it was given: a crawl from the
// cache and a crawl from the chain have to score the same.

const withCache = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), "jumper-cache-"));
  process.env.JUMPER_CACHE_DIR = dir;
  try {
    await fn(dir);
  } finally {
    delete process.env.JUMPER_CACHE_DIR;
    rmSync(dir, { recursive: true, force: true });
  }
};

test("cache: a tape's logs come back exact, and the crawl scores the same", () => withCache(async () => {
  const tape = fixture("sods");
  const upTo = tape.headBlock;
  await saveLogs(tape.launch.token, { upTo, transfers: tape.transfers, trades: tape.trades, swaps: tape.swaps ?? [] });
  const back = await loadLogs(tape.launch.token.toUpperCase().replace("0X", "0x"));
  assert.ok(back, "nothing came back");
  assert.equal(back.upTo, upTo);
  const lower = (xs, keys) => xs.map((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, x[k].toLowerCase()])) }));
  assert.deepEqual(back.transfers, lower(tape.transfers, ["from", "to"]));
  assert.deepEqual(back.trades, lower(tape.trades, ["wallet"]));
  assert.deepEqual(back.swaps, tape.swaps ?? []);
  const again = crawlTape({ ...tape, transfers: back.transfers, trades: back.trades, swaps: back.swaps });
  assert.equal(again.score, crawlTape(tape).score);
}));

test("cache: events past upTo wait for the next crawl", () => withCache(async () => {
  const tape = fixture("twain");
  const mid = tape.transfers[Math.floor(tape.transfers.length / 2)].block;
  await saveLogs(tape.launch.token, { upTo: mid, transfers: tape.transfers, trades: tape.trades, swaps: [] });
  const back = await loadLogs(tape.launch.token);
  assert.ok(back.transfers.length > 0 && back.transfers.length < tape.transfers.length);
  assert.ok(back.transfers.every((t) => t.block <= mid));
  assert.ok(back.trades.every((t) => t.block <= mid));
}));

test("cache: a busy token's file is not rewritten on every crawl", () => {
  assert.equal(worthSaving(0, 100, 0), true, "no cache yet");
  assert.equal(worthSaving(1_000, 1_100, 3), false, "a few new events a minute later");
  assert.equal(worthSaving(1_000, 1_100, 2_000), true, "a real batch");
  assert.equal(worthSaving(1_000, 40_000, 3), true, "an hour of drift");
});

test("cache: a found funding is kept, a missing one is asked again later", () => withCache(async () => {
  const f = { wallet: "0xabc", funder: "0xdef", ts: 1, block: 2, valueWei: "3", via: "tx" };
  assert.equal(cachedFunding("0xABC"), undefined);
  keepFunding("0xABC", f);
  assert.deepEqual(cachedFunding("0xabc"), f);
  keepFunding("0x123", null);
  assert.equal(cachedFunding("0x123"), null, "fresh 'none' is kept for a day");
}));
