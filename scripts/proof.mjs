// Backtest for the /proof page from a list of tokens, run by hand. The
// site keeps the same backtest rolling on its own (web/app/api/proof-tick);
// the logic of the cut lives in src/proof.ts.
//
//   pnpm build:cli && node scripts/proof.mjs tokens.json [out.json]
//
// tokens.json is a list of { token } (or plain addresses), for example the
// busiest launches of the last days.
import { readFileSync, writeFileSync } from "node:fs";
import { proveToken, summarize } from "../.jumper-build/proof.js";
import { loadEnv } from "../.jumper-build/env.js";

loadEnv(new URL("../.env", import.meta.url).pathname);
const [, , input, output = "web/sample/proof.json"] = process.argv;
const list = JSON.parse(readFileSync(input, "utf8")).map((x) => (typeof x === "string" ? x : x.token));

const rows = [];
let skipped = 0;
for (const [i, token] of list.entries()) {
  try {
    // a token that will not read in two minutes is skipped
    const row = await proveToken(token, 120_000);
    if (typeof row === "string") { skipped++; continue; }
    rows.push(row);
    console.log(`${i + 1}/${list.length} $${row.symbol} ${row.score} ${row.band} · peak ${row.peakX.toFixed(2)}x · now ${row.changeNow.toFixed(0)}%`);
  } catch (e) {
    skipped++;
    console.log(`${i + 1}/${list.length} ${token} failed: ${String(e.message ?? e).slice(0, 80)}`);
  }
}
// a crawl left running past its timeout must not hold the process open
setTimeout(() => process.exit(0), 5_000).unref();

writeFileSync(output, JSON.stringify(summarize(rows, skipped), null, 1));
console.log(`tested ${rows.length}, skipped ${skipped} -> ${output}`);
