import { grouped, pctText, short } from "./crawlers/common.js";
import { CHECKPOINTS, type Report } from "./crawlers/types.js";

/**
 * The report as text for a terminal, or as markdown. Monospace columns, no
 * emoji; colour only on the score and verdict, and only when stdout is a
 * TTY. Provenance always prints last.
 */

const ANSI: Record<string, string> = { TORN: "\x1b[38;2;255;93;122m", PATCHED: "\x1b[38;2;255;209;102m", TAUT: "\x1b[38;2;125;240;200m" };
const RESET = "\x1b[0m";
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number) => (s.length >= n ? s : " ".repeat(n - s.length) + s);

function age(sec: number): string {
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

export function renderText(r: Report, color = false): string {
  const paint = (s: string) => (color ? `${ANSI[r.band]}${s}${RESET}` : s);
  const m = r.metrics;
  const out: string[] = [];
  out.push(`JUMPER · crawler terminal · pons v2 · chain 4663`);
  out.push("");
  out.push(`$${r.token.symbol}  ${r.token.name}`);
  out.push(`${r.token.address} · ${r.token.phaseLabel}${r.token.graduated ? "" : ` ${Math.round(r.token.curveProgress * 100)}%`} · age ${age(r.token.ageSec)} · quote ${r.token.pairSymbol}`);
  out.push("");
  out.push(`  ${paint(`${r.score} / 100  ${r.label}`)}   ${paint(`${r.band} · ${r.verdict}`)}`);
  out.push(`  ${r.subline}`);
  out.push("");
  for (const f of r.facts) out.push(`  ${f}`);
  out.push("");

  const w = r.quadrants.web;
  const ret = CHECKPOINTS.map((c) => `${c.label} ${w.retention[c.label] === undefined ? "--" : `${Math.round(w.retention[c.label]! * 100)}%`}`).join("  ");
  const kept = w.firstMinuteKept === null ? "too few real buyers to judge" : pctText(w.firstMinuteKept);
  out.push(`WEB    hold ${pctText(w.hold)} · real holders kept ${pctText(w.realRetention)} · first minute kept ${kept}`);
  out.push(`       ${w.flips} flips under ten minutes and the snipers left out of the score`);
  out.push(`       ${ret}`);
  const s = r.quadrants.silk;
  out.push(`SILK   ${s.online ? `${s.smart} smart on ${pctText(s.smartSupply)}${s.winrate === null ? "" : ` · winrate ${Math.round(s.winrate)}%`} · ${s.scanned} scanned` : "index offline, wallet histories not read"}`);
  const n = r.quadrants.snare;
  out.push(`SNARE  ${n.sniperWallets} sniper${n.sniperWallets === 1 ? "" : "s"} took ${pctText(n.sniperSupply)}, still hold ${pctText(n.sniperHeld)} · ${n.sniperExited} out · ${n.bundles} bundle${n.bundles === 1 ? "" : "s"} on ${pctText(n.bundleSupply)}`);
  const e = r.quadrants.exit;
  out.push(`EXIT   ${pctText(e.exitPressure)} to the exit in the last hour · dev ${e.devState}${e.devSoldPct ? ` (${e.devSoldPct}% of peak)` : ""}`);
  out.push("");

  out.push("crawler   result");
  for (const c of r.crawlers) out.push(`${pad(c.name, 9)} ${pad(c.stats[0], 16)} ${c.stats[1]}`);
  out.push("");

  out.push(`${pad("holder", 14)} ${lpad("share", 7)}  flags`);
  for (const h of r.holders.slice(0, 15)) {
    out.push(`${pad(short(h.wallet), 14)} ${lpad(pctText(h.share), 7)}  ${h.flags.join(", ")}`);
  }
  out.push("");

  const p = r.provenance;
  out.push(`block ${grouped(p.block)} · ${p.observedAt.slice(0, 19).replace("T", " ")} UTC · ${grouped(m.transfers)} transfers · ${p.rpcCalls} rpc calls · ${(p.ms / 1000).toFixed(1)}s`);
  out.push(`sources: ${p.sources.join(", ")} · funding read ${p.fundingRead}${p.partial ? " · PARTIAL: some log chunks were refused" : ""}`);
  out.push("the score describes what already happened. it predicts nothing. not financial advice.");
  return out.join("\n");
}

export function renderMarkdown(r: Report): string {
  const m = r.metrics;
  const lines = [
    `## $${r.token.symbol} · ${r.score} / 100 · ${r.band} · ${r.verdict}`,
    "",
    `\`${r.token.address}\` · ${r.label} · ${r.subline}`,
    "",
    ...r.facts.map((f) => `- ${f}`),
    "",
    "| metric | value |",
    "|---|---|",
    `| holders | ${grouped(m.holders)} |`,
    `| hold / gone | ${pctText(m.hold)} / ${pctText(m.gone)} |`,
    `| smart | ${m.smart} on ${pctText(m.smartSupply)} |`,
    `| snipers | ${m.sniperWallets} on ${pctText(m.sniperSupply)}, ${m.sniperExited} out |`,
    `| bundles | ${m.bundles} on ${pctText(m.bundleSupply)} |`,
    `| first minute kept | ${m.firstMinuteKept === null ? "n/a (too few real buyers)" : pctText(m.firstMinuteKept)} |`,
    `| bots and flips left out | ${m.flips} |`,
    `| dev | ${m.devState} |`,
    `| exit pressure (1h) | ${pctText(m.exitPressure)} |`,
    "",
    `block ${r.provenance.block} · ${r.provenance.observedAt} · sources: ${r.provenance.sources.join(", ")}`,
  ];
  return lines.join("\n");
}
