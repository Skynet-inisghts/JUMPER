// README images are rendered, never drawn: the card below is the real
// $TWAIN crawl recorded in test/fixtures, replayed through the same
// renderer the site uses. Run with `pnpm render:readme`.
import { readFileSync, writeFileSync } from "node:fs";
import { tapeFromJson } from "../.jumper-build/tape.js";
import { crawlTape } from "../.jumper-build/crawlers/pipeline.js";
import { renderCard } from "../.jumper-build/card/card.js";

const tape = tapeFromJson(readFileSync("test/fixtures/twain.tape.json", "utf8"));
const body = crawlTape(tape);
const report = {
  ...body,
  provenance: { block: tape.headBlock, observedAt: new Date(tape.now * 1000).toISOString(), rpcCalls: 0, ms: 0, sources: tape.sources, partial: false, indexTip: null, fundingRead: "" },
};
writeFileSync("assets/readme/card-twain.png", await renderCard(report));
writeFileSync("assets/readme/card-twain.json", JSON.stringify({ token: report.token.address, symbol: report.token.symbol, score: report.score, band: report.band, observedAt: report.provenance.observedAt, block: report.provenance.block }, null, 2) + "\n");
console.log(`card-twain.png: $${report.token.symbol} ${report.score} ${report.band} at ${report.provenance.observedAt}`);
