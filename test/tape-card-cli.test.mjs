import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tapeFromJson, tapeToJson } from "../.jumper-build/tape.js";
import { crawlTape } from "../.jumper-build/crawlers/pipeline.js";
import { renderCard } from "../.jumper-build/card/card.js";
import { fixture } from "./helpers.mjs";

test("a tape survives JSON with every wei intact", () => {
  const tape = fixture("sods");
  const again = tapeFromJson(tapeToJson(tape));
  assert.equal(again.launch.totalSupply, tape.launch.totalSupply);
  assert.equal(again.transfers[5].value, tape.transfers[5].value);
  assert.equal(typeof again.transfers[5].value, "bigint");
});

test("the card is a 1080x1080 PNG", async () => {
  const tape = fixture("twain");
  const report = { ...crawlTape(tape), provenance: { block: tape.headBlock, observedAt: new Date(tape.now * 1000).toISOString(), rpcCalls: 0, ms: 0, sources: [], partial: false, indexTip: null, fundingRead: "" } };
  const png = await renderCard(report, { sample: true });
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1080);
});

test("the CLI replays a tape as JSON", () => {
  const out = execFileSync(process.execPath, ["bin/jumper.mjs", "replay", "test/fixtures/sods.tape.json", "--format", "json"], { encoding: "utf8" });
  const report = JSON.parse(out);
  assert.equal(report.token.symbol, "SODS");
  assert.equal(typeof report.score, "number");
  assert.ok(report.provenance.sources.includes("tape replay"));
});

test("the engine never reads a transaction sender", () => {
  // tx.from is the relayer on this chain; the only transaction read in the
  // engine decodes the launch calldata (tx.input)
  const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" }).trim().split("\n").filter((f) => f.endsWith(".ts"));
  for (const f of files) {
    // comments may explain the rule; code may not break it
    const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /\btx\.from\b|transaction\.from\b|receipt\.from\b/, f);
  }
});
