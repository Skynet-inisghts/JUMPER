// README images are rendered, never drawn: every card and the terminal view
// below come from real crawls (recorded tapes or saved reports), through the
// same renderer the site uses. Each image gets a JSON caption with the token,
// the block and the time it describes. Run with `pnpm render:readme`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tapeFromJson } from "../.jumper-build/tape.js";
import { crawlTape } from "../.jumper-build/crawlers/pipeline.js";
import { renderCard } from "../.jumper-build/card/card.js";
import { renderText } from "../.jumper-build/report.js";

const OUT = "assets/readme";

function fromTape(name) {
  const tape = tapeFromJson(readFileSync(`test/fixtures/${name}.tape.json`, "utf8"));
  return {
    ...crawlTape(tape),
    provenance: { block: tape.headBlock, observedAt: new Date(tape.now * 1000).toISOString(), rpcCalls: 0, ms: 0, sources: tape.sources, partial: false, indexTip: null, fundingRead: `${tape.fundingRead ?? tape.funding.length} of ${tape.fundingAsked}` },
  };
}

const caption = (r) => ({ token: r.token.address, symbol: r.token.symbol, score: r.score, band: r.band, block: r.provenance.block, observedAt: r.provenance.observedAt });

// cards: the fixture crawl plus any saved live reports in assets/readme/reports
const reports = [fromTape("twain")];
for (const f of ["patched", "taut"]) {
  const p = `${OUT}/reports/${f}.json`;
  if (existsSync(p)) reports.push(JSON.parse(readFileSync(p, "utf8")));
}
for (const r of reports) {
  const name = `card-${r.token.symbol.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  writeFileSync(`${OUT}/${name}.png`, await renderCard(r));
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(caption(r), null, 2) + "\n");
  console.log(`${name}.png: $${r.token.symbol} ${r.score} ${r.band}`);
}

// the terminal: the real text report, typeset as an SVG
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r = reports[0];
const ansi = renderText(r, true).split("\n").slice(0, 44);
const COL = { "255;93;122": "#FF5D7A", "255;209;102": "#FFD166", "125;240;200": "#7DF0C8" };
const LH = 19, W = 980, PADX = 28, TOP = 64;
const rows = ansi.map((line, i) => {
  const y = TOP + i * LH;
  const parts = [];
  let rest = line;
  let color = null;
  while (rest.length) {
    const m = rest.match(/\x1b\[38;2;(\d+;\d+;\d+)m|\x1b\[0m/);
    const chunk = m ? rest.slice(0, m.index) : rest;
    const q = !color && chunk === line ? chunk.match(/^(WEB|SILK|SNARE|EXIT)( {2,3})(?=\S)(?!\d+ wallets)/) : null;
    if (q && /^(WEB|SILK|SNARE|EXIT) {1,3}(hold|\d+ smart|\d+ snipers|index|\d+(\.\d)?% to)/.test(chunk)) {
      parts.push(`<tspan fill="#B47CFF">${esc(q[1])}</tspan>`);
      parts.push(`<tspan fill="#D8D2E4">${esc(chunk.slice(q[1].length))}</tspan>`);
    } else if (chunk) parts.push(`<tspan fill="${color ?? tint(chunk, line)}">${esc(chunk)}</tspan>`);
    if (!m) break;
    color = m[1] ? COL[m[1]] ?? "#D8D2E4" : null;
    rest = rest.slice(m.index + m[0].length);
  }
  return `<text x="${PADX}" y="${y}" xml:space="preserve">${parts.join("")}</text>`;
});
function tint(chunk, line) {
  if (/^(WEAVER|TRACKER|SNARE|SCOUT|KNOT|LEDGER|SIEVE|ORACLE) /.test(line)) return "#D8D2E4";
  if (/^(block|sources|the score)/.test(line)) return "#7E7490";
  return "#D8D2E4";
}
const H = TOP + ansi.length * LH + 24;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" rx="12" fill="#07060A" stroke="#241B33"/>
<rect width="${W}" height="38" rx="12" fill="#110D18"/><rect y="26" width="${W}" height="12" fill="#110D18"/>
<circle cx="24" cy="19" r="6" fill="#FF5D7A"/><circle cx="44" cy="19" r="6" fill="#FFD166"/><circle cx="64" cy="19" r="6" fill="#7DF0C8"/>
<text x="${W / 2}" y="24" text-anchor="middle" fill="#7E7490" font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-size="13">$ jumper ${r.token.address}</text>
<g font-family="JetBrains Mono, ui-monospace, Menlo, monospace" font-size="13.5">
${rows.join("\n")}
</g>
</svg>
`;
writeFileSync(`${OUT}/terminal.svg`, svg);
writeFileSync(`${OUT}/terminal.json`, JSON.stringify(caption(r), null, 2) + "\n");
console.log("terminal.svg");
