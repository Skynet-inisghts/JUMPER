"use client";
import { useEffect, useRef } from "react";
import { CREW, crawledAt, dprNow, fmt, fontsFor, reducedMotion, ri, rnd, short, usd, type Report } from "@/lib/util";

/* ---------- the research floor, in perspective (ported from prototype.html) ----------
 * Everything on the screens is the latest crawl: the wall replays the token's
 * own candles with the tracked wallets' trades marked on them, every desk
 * monitor shows its crawler's real findings, and the crew mutter their own
 * log lines. Only when no report has loaded does the wall fall back to a
 * labelled synthetic chart.
 */

interface Mark { i: number; k: string; col: string; note: string }
type Candle = { o: number; c: number; h: number; l: number };
type Line = { crawler: number; text: string };

function syntheticCandles(): Candle[] {
  const out: Candle[] = [];
  let px = 100;
  for (let i = 0; i < 64; i++) {
    const o = px, c = px * (1 + rnd(-0.04, 0.042));
    out.push({ o, c, h: Math.max(o, c) * 1.012, l: Math.min(o, c) * 0.988 });
    px = c;
  }
  return out;
}

/** Trade marks from the report's fills, pinned to the candle their time falls in. */
function marksFor(r: Report): Mark[] {
  const chart = r.chart ?? [];
  if (chart.length < 2) return [];
  const step = chart[1].t - chart[0].t;
  const flagged = new Set(r.holders.filter((h) => h.flags.includes("sniper") || h.flags.includes("deployer")).map((h) => h.wallet.toLowerCase()));
  const book = new Map<string, { tok: number; usd: number }>();
  const out: Mark[] = [];
  const used = new Set<number>();
  for (const f of [...r.fills].sort((a, b) => a.ts - b.ts)) {
    const i = Math.max(0, Math.min(chart.length - 1, Math.floor((f.ts - chart[0].t) / step)));
    const w = f.wallet.toLowerCase();
    const b = book.get(w);
    let m: Mark;
    if (f.kind === "buy") {
      m = { i, k: flagged.has(w) ? "FLAGGED" : b ? "ADDED" : "BOUGHT", col: flagged.has(w) ? "180,124,255" : "125,240,200", note: f.usd != null ? usd(f.usd) : "" };
      book.set(w, { tok: (b?.tok ?? 0) + f.tokens, usd: (b?.usd ?? 0) + (f.usd ?? 0) });
    } else {
      let note = f.usd != null ? usd(f.usd) : "";
      if (b && b.tok > 0 && b.usd > 0 && f.usd != null && f.tokens > 0) {
        const pnl = (f.usd / (f.tokens * (b.usd / b.tok)) - 1) * 100;
        note = (pnl >= 0 ? "+" : "-") + Math.round(Math.abs(pnl)) + "%";
      }
      m = { i, k: "SOLD", col: "255,93,122", note };
    }
    // one mark per candle keeps the wall legible
    if (used.has(i)) continue;
    used.add(i);
    out.push(m);
  }
  return out;
}

/** Every crawler's log, interleaved the way the crawl ran them. */
function linesFor(r: Report): Line[] {
  const out: Line[] = [];
  const queues = r.crawlers.map((c) => c.lines.filter((l) => l.text.length > 0));
  let more = true;
  for (let k = 0; more && k < 60; k++) {
    more = false;
    queues.forEach((q, i) => {
      if (k < q.length) { out.push({ crawler: i, text: q[k].text }); more = true; }
    });
  }
  return out;
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function Room({ report }: { report: Report | null }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const sfRefs = useRef<(HTMLDivElement | null)[]>([]);
  const stateRef = useRef<HTMLElement | null>(null);
  const reportRef = useRef<Report | null>(report);

  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    const hc = cvRef.current;
    if (!hc) return;
    const hx = hc.getContext("2d");
    if (!hx) return;
    let DPR = dprNow();
    let SW = 0, SH = 0;
    const hsz = () => {
      DPR = dprNow();
      const r = hc.getBoundingClientRect();
      hc.width = Math.round(r.width * DPR);
      hc.height = Math.round(r.height * DPR);
      SW = hc.width;
      SH = hc.height;
    };
    const timers: number[] = [];
    timers.push(window.setTimeout(hsz, 50));

    const CREWIMG = CREW.map((c) => {
      const im = new Image();
      im.src = c.spr;
      return im;
    });

    /* ---- what the room shows, rebuilt whenever a new report arrives ---- */
    let seededFor: Report | null | undefined = undefined;
    let CANDLES: Candle[] = syntheticCandles();
    let synthetic = true;
    let MARKS: Mark[] = [];
    let LINES: Line[] = [];
    let play = 64; /* how many candles of the replay are on the wall */
    let ledX = 0; /* the crawler.log strip scrolls */
    let lineCursor = 0;
    const rebuild = (r: Report | null) => {
      seededFor = r;
      const chart = r?.chart ?? [];
      if (chart.length >= 8) {
        /* the launch candle holds the whole opening pump (often 20x in a
         * minute); left in, it flattens everything after it */
        const body = chart[0].l > 0 && chart[0].h / chart[0].l > 4 ? chart.slice(1) : chart;
        CANDLES = body.map((k) => ({ o: k.o, c: k.c, h: k.h, l: k.l }));
        synthetic = false;
        MARKS = marksFor(r!).map((m) => ({ ...m, i: m.i - (chart.length - CANDLES.length) })).filter((m) => m.i >= 0);
        play = Math.min(CANDLES.length, 18);
      } else {
        CANDLES = syntheticCandles();
        synthetic = true;
        MARKS = [];
        play = CANDLES.length;
      }
      LINES = r ? linesFor(r) : [];
      lineCursor = 0;
      for (const d of DESK) d.cursor = 0;
    };

    /* each desk keeps a cursor walking its real rows */
    const DESK = CREW.map(() => ({ flash: 0, x: 0, y: 0, sc: 1, vx: 0, vy: 0, cursor: 0, sweep: 0 }));
    type DeskT = (typeof DESK)[number];

    /* the crew: each one owns a desk but wanders between them */
    const CREWST = CREW.map((_, i) => ({
      home: i, at: i, x: 0, y: 0, sc: 1, guest: false, ih: 0, iw: 0,
      state: "sit" as "sit" | "walk", t: 0, dur: rnd(1500, 4500), fromX: 0, fromY: 0, toX: 0, toY: 0, step: rnd(0, 6.28),
    }));
    /* speech: a crawler reads out a line of its own log */
    let BUBBLES: { i: number; text: string; born: number }[] = [];

    let walked = 0, held = 0, snipeN = 0, smartN = 0;
    let placed = false;
    const targets = () => {
      const r = reportRef.current;
      return r
        ? { walked: r.metrics.holders, held: Math.round(r.metrics.hold), snipe: r.metrics.sniperWallets, smart: r.metrics.smart }
        : { walked: 0, held: 0, snipe: 0, smart: 0 };
    };
    const writeCounters = () => {
      const [a, b, c, d] = sfRefs.current;
      if (a) a.textContent = fmt(walked);
      if (b) b.textContent = held + "%";
      if (c) c.textContent = String(snipeN);
      if (d) d.textContent = String(smartN);
    };

    const { mono } = fontsFor();
    const pct = (x: number) => (x < 1 ? x.toFixed(1) : String(Math.round(x))) + "%";

    /** One desk monitor: its crawler's real findings, drawn small. */
    function monitor(ctx: CanvasRenderingContext2D, idx: number, x: number, y: number, w: number, h: number, col: string, DK: DeskT, t: number) {
      const r = reportRef.current;
      const P = r?.panels;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const C = "rgb(" + col + ")";
      ctx.strokeStyle = ctx.fillStyle = C;
      const F = Math.max(5.5 * DPR, h * 0.12);
      ctx.font = F + "px " + mono;
      const foot = (txt: string) => {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = C;
        ctx.fillText(txt, x + 2, y + h - 2);
        ctx.globalAlpha = 1;
      };
      if (!P) {
        ctx.globalAlpha = 0.5;
        ctx.fillText("waiting for a crawl", x + 2, y + F + 2);
        ctx.restore();
        return;
      }
      const body = h - F - 4; /* room above the footer line */

      if (idx === 0) { /* WEAVER: the holder graph fanning out */
        const n = Math.min(9, Math.max(4, Math.round(Math.log2(P.weaver.nodes + 1))));
        const rx = x + 5, ry = y + body / 2;
        ctx.lineWidth = 1;
        for (let k = 0; k < n; k++) {
          const yy = y + (body * (k + 0.5)) / n;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.bezierCurveTo(x + w * 0.32, ry, x + w * 0.44, yy, x + w - 8, yy);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(x + w - 7, yy, 1.6 * DPR, 0, 6.283);
          ctx.fill();
        }
        /* a pulse walking one edge */
        const k = DK.cursor % n, u = (t * 0.0009) % 1;
        const yy = y + (body * (k + 0.5)) / n;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(rx + (x + w - 8 - rx) * u, ry + (yy - ry) * u * u, 1.8 * DPR, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = C;
        ctx.beginPath();
        ctx.arc(rx, ry, 2.6 * DPR, 0, 6.283);
        ctx.fill();
        foot(`${fmt(P.weaver.nodes)} nodes · ${fmt(P.weaver.edges)} edges`);
      } else if (idx === 1) { /* TRACKER: exits over the token's life */
        const B = P.tracker.exitsByBucket, max = Math.max(1, ...B), bw = (w - 4) / B.length;
        B.forEach((v, k) => {
          const bh = (v / max) * (body - 2);
          ctx.globalAlpha = k === DK.cursor % B.length ? 1 : 0.55;
          ctx.fillRect(x + 2 + k * bw, y + body - bh, Math.max(1, bw - 1.5), bh);
        });
        ctx.globalAlpha = 1;
        foot(`${fmt(B.reduce((a, b) => a + b, 0))} gone · ${pct(r!.metrics.gone)}`);
      } else if (idx === 2) { /* SNARE: the snipers, block by block */
        const rows = P.snare.rows;
        if (!rows.length) {
          ctx.globalAlpha = 0.75;
          ctx.fillText("blocks 0-2: clean", x + 2, y + F + 2);
          ctx.globalAlpha = 0.45;
          ctx.fillText("no sniper caught", x + 2, y + F * 2 + 4);
        } else {
          const vis = Math.min(4, rows.length);
          for (let k = 0; k < vis; k++) {
            const row = rows[(DK.cursor + k) % rows.length];
            const yy = y + F + 1 + k * (body / vis);
            ctx.globalAlpha = k === 0 ? 1 : 0.7;
            ctx.fillStyle = row.exited ? "rgba(255,93,122,.95)" : C;
            ctx.fillText(short(row.wallet).slice(0, 9), x + 2, yy);
            ctx.textAlign = "right";
            ctx.fillText(`+${row.block} ${pct(row.pct)}`, x + w - 2, yy);
            ctx.textAlign = "left";
          }
          ctx.globalAlpha = 1;
        }
        foot(`${r!.metrics.sniperWallets} snipers · ${pct(r!.metrics.sniperSupply)}`);
      } else if (idx === 3) { /* SCOUT: winrates of the holders it followed */
        const rows = P.scout.rows;
        const vis = Math.min(4, rows.length);
        for (let k = 0; k < vis; k++) {
          const row = rows[k];
          const yy = y + 2 + k * (body / Math.max(vis, 1));
          const rh = body / Math.max(vis, 1) - 2;
          const wr = row.winrate ?? 0;
          ctx.globalAlpha = 0.18;
          ctx.fillRect(x + 2, yy, w - 4, rh);
          ctx.globalAlpha = k === DK.cursor % Math.max(vis, 1) ? 1 : 0.7;
          ctx.fillStyle = row.smart ? C : "rgba(126,116,144,.9)";
          ctx.fillRect(x + 2, yy, ((w - 4) * wr) / 100, rh);
          ctx.fillStyle = "#07060C";
          ctx.fillText(`${short(row.wallet).slice(0, 7)} ${Math.round(wr)}%`, x + 4, yy + rh - 1.5);
        }
        ctx.globalAlpha = 1;
        foot(`${r!.metrics.smart} smart / ${P.scout.scanned}`);
      } else if (idx === 4) { /* KNOT: who was funded together */
        const rows = P.knot.rows;
        const cols = 10, rws = 3, cw = (w - 4) / cols, ch = (body - 2) / rws;
        const looked = Math.max(1, P.knot.looked);
        for (let k = 0; k < cols * rws; k++) {
          const share = k / (cols * rws);
          const read = share < P.knot.read / looked;
          const clustered = rows.length > 0 && k < Math.min(cols * rws, rows.reduce((a, c) => a + c.wallets, 0));
          ctx.globalAlpha = clustered ? 0.95 : read ? 0.35 : 0.1;
          if (k === DK.cursor % (cols * rws)) ctx.globalAlpha = 1;
          ctx.fillRect(x + 2 + (k % cols) * cw, y + 1 + Math.floor(k / cols) * ch, cw - 1.5, ch - 1.5);
        }
        ctx.globalAlpha = 1;
        foot(rows.length ? `${rows.length} cluster${rows.length === 1 ? "" : "s"} · ${pct(r!.metrics.bundleSupply)}` : `0 clusters · read ${P.knot.read}/${P.knot.looked}`);
      } else if (idx === 5) { /* LEDGER: where every book stands */
        const B = P.ledger.pnlBuckets, max = Math.max(1, ...B), bw = (w - 4) / B.length;
        const zero = x + 2 + 2 * bw; /* buckets of 50 points from -100 */
        B.forEach((v, k) => {
          const bh = (v / max) * (body - 2);
          ctx.fillStyle = k < 2 ? "rgba(255,93,122,.85)" : C;
          ctx.globalAlpha = k === DK.cursor % B.length ? 1 : 0.7;
          ctx.fillRect(x + 2 + k * bw, y + body - bh, Math.max(1, bw - 1.5), bh);
        });
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = "#fff";
        ctx.fillRect(zero, y, 1, body);
        ctx.globalAlpha = 1;
        const avg = P.ledger.avgPnlPct;
        foot(`${fmt(r!.metrics.holders)} books${avg === null ? "" : ` · ${avg >= 0 ? "+" : ""}${Math.round(avg)}%`}`);
      } else if (idx === 6) { /* SIEVE: the field, shaken */
        DK.sweep = (DK.sweep + 0.01) % 1;
        const S = P.sieve, tot = Math.max(1, S.dust + S.transferOnly + S.virgins + S.clean);
        const N = 36;
        for (let k = 0; k < N; k++) {
          const px = x + 2 + (((k * 37) % 100) / 100) * (w - 6), py = y + 2 + (((k * 61) % 100) / 100) * (body - 4);
          const q = k / N;
          const kind = q < S.clean / tot ? 0 : q < (S.clean + S.dust) / tot ? 1 : 2;
          const passed = px < x + DK.sweep * w;
          ctx.fillStyle = kind === 0 ? "rgba(125,240,200,.95)" : C;
          ctx.globalAlpha = kind === 0 ? 0.95 : passed ? 0.12 : 0.6;
          ctx.fillRect(px, py, 2 * DPR, 2 * DPR);
        }
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = C;
        ctx.fillRect(x + DK.sweep * w, y, 1.4, body);
        ctx.globalAlpha = 1;
        foot(`${fmt(S.dust + S.transferOnly + S.virgins)} out · ${fmt(S.clean)} clean`);
      } else { /* ORACLE: the score and what built it */
        const sc = r!.score / 100;
        ctx.font = "700 " + F * 1.3 + "px " + mono;
        ctx.fillText(String(r!.score), x + 2, y + F * 1.3);
        ctx.font = F + "px " + mono;
        ctx.globalAlpha = 0.85;
        ctx.fillText(r!.band, x + F * 2.6, y + F * 1.2);
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x + 2, y + F * 1.7, w - 4, F * 0.55);
        ctx.globalAlpha = 1;
        ctx.fillRect(x + 2, y + F * 1.7, (w - 4) * sc, F * 0.55);
        const parts: [string, number, string][] = [
          ["web", P.oracle.points?.holding ?? 0, "125,240,200"],
          ["kept", P.oracle.points?.kept ?? 0, "125,240,200"],
          ["silk", P.oracle.points?.smart ?? 0, "110,208,255"],
          ["snipe", -P.oracle.sniper, "255,209,102"],
          ["exit", -P.oracle.exit, "255,93,122"],
        ];
        const top = y + F * 2.6, ph = (body - (top - y)) / parts.length;
        parts.forEach(([name, v, c2], k) => {
          const yy = top + k * ph;
          ctx.fillStyle = "rgba(" + c2 + "," + (k === DK.cursor % parts.length ? 1 : 0.75) + ")";
          const bw = Math.min(1, Math.abs(v) / 45) * (w * 0.5);
          ctx.fillRect(x + w * 0.45, yy + 1, bw, Math.max(1.5, ph - 2.5));
          ctx.globalAlpha = 0.8;
          ctx.font = Math.max(5 * DPR, ph * 0.8) + "px " + mono;
          ctx.fillText(name, x + 2, yy + ph - 1.5);
          ctx.globalAlpha = 1;
        });
        ctx.font = F + "px " + mono;
      }
      ctx.restore();
    }

    function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rr: number) {
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    function drawRoom(t: number, animate: boolean) {
      if (!SW || !hx) return;
      const W2 = SW, H2 = SH;
      const r = reportRef.current;
      if (r !== seededFor) rebuild(r);
      hx.clearRect(0, 0, W2, H2);

      /* ---- back wall and floor ---- */
      const HOR = H2 * 0.42; /* horizon */
      let g = hx.createLinearGradient(0, 0, 0, HOR);
      g.addColorStop(0, "#0B0812");
      g.addColorStop(1, "#15102099");
      hx.fillStyle = g;
      hx.fillRect(0, 0, W2, HOR);
      g = hx.createLinearGradient(0, HOR, 0, H2);
      g.addColorStop(0, "#16112399");
      g.addColorStop(1, "#07060C");
      hx.fillStyle = g;
      hx.fillRect(0, HOR, W2, H2 - HOR);

      /* floor grid converging to a vanishing point */
      const VX = W2 * 0.5, VY = HOR - H2 * 0.1;
      hx.strokeStyle = "rgba(180,124,255,.10)";
      hx.lineWidth = 1;
      for (let i = -9; i <= 9; i++) {
        hx.beginPath();
        hx.moveTo(VX + i * W2 * 0.085, VY);
        hx.lineTo(VX + i * W2 * 0.42, H2);
        hx.stroke();
      }
      for (let k = 1; k <= 7; k++) {
        const yy = HOR + Math.pow(k / 7, 1.9) * (H2 - HOR);
        hx.beginPath();
        hx.moveTo(0, yy);
        hx.lineTo(W2, yy);
        hx.stroke();
      }

      /* ---- the big screen on the back wall ---- */
      const sx = W2 * 0.21, sy = H2 * 0.04, sw = W2 * 0.58, sh = H2 * 0.28;
      hx.fillStyle = "#05040A";
      hx.fillRect(sx, sy, sw, sh);
      hx.strokeStyle = "#392B55";
      hx.lineWidth = 2.4 * DPR;
      hx.strokeRect(sx, sy, sw, sh);
      /* header: which token, who crawled it, when */
      hx.font = 9 * DPR + "px " + mono;
      hx.fillStyle = "rgba(126,116,144,.95)";
      hx.fillText(synthetic ? "SELECTED TOKEN / RESEARCH REPLAY · no crawl loaded" : "SELECTED TOKEN / RESEARCH REPLAY", sx + 10 * DPR, sy + 15 * DPR);
      if (r) {
        const band = r.band === "TAUT" ? "#7DF0C8" : r.band === "PATCHED" ? "#FFD166" : "#FF5D7A";
        hx.textAlign = "right";
        hx.fillStyle = "rgba(126,116,144,.95)";
        const right = `${short(r.token.address)} · ${fmt(r.metrics.holders)} holders · crawled ${ago(r.provenance.observedAt)}`;
        hx.fillText(right, sx + sw - 10 * DPR, sy + 15 * DPR);
        const rw = hx.measureText(right).width;
        hx.fillStyle = band;
        hx.fillText(`${r.score}/100 ${r.band}  `, sx + sw - 10 * DPR - rw, sy + 15 * DPR);
        const bw2 = hx.measureText(`${r.score}/100 ${r.band}  `).width;
        hx.fillStyle = "#B47CFF";
        hx.font = "700 " + 9 * DPR + "px " + mono;
        hx.fillText(`$${r.token.symbol}  `, sx + sw - 10 * DPR - rw - bw2, sy + 15 * DPR);
        hx.textAlign = "left";
      }

      /* candles: log scale, the replay revealing them left to right */
      const chartTop = sy + 24 * DPR, chartBot = sy + sh - 30 * DPR;
      const shown = CANDLES.slice(0, Math.max(2, play));
      const lg = (v: number) => Math.log(Math.max(v, 1e-30));
      const scaleSet = shown;
      const hi = Math.max(...scaleSet.map((k) => lg(k.h))), lo = Math.min(...scaleSet.map((k) => lg(k.l)));
      const CY = (v: number) => chartBot - ((lg(v) - lo) / Math.max(1e-9, hi - lo)) * (chartBot - chartTop);
      const bw = (sw - 24 * DPR) / CANDLES.length;
      hx.save();
      hx.beginPath();
      hx.rect(sx, chartTop - 4 * DPR, sw, chartBot - chartTop + 8 * DPR);
      hx.clip();
      shown.forEach((k, i) => {
        const x = sx + 12 * DPR + i * bw, up = k.c >= k.o;
        hx.strokeStyle = hx.fillStyle = up ? "#7DF0C8" : "#FF5D7A";
        hx.lineWidth = 1 * DPR;
        hx.beginPath();
        hx.moveTo(x + bw / 2, CY(k.h));
        hx.lineTo(x + bw / 2, CY(k.l));
        hx.stroke();
        hx.fillRect(x + 0.6 * DPR, Math.min(CY(k.o), CY(k.c)), bw - 1.6 * DPR, Math.max(1.4 * DPR, Math.abs(CY(k.o) - CY(k.c))));
      });
      hx.restore();
      /* the playhead, with the price where the replay stands */
      if (!synthetic && shown.length) {
        const last = shown[shown.length - 1];
        const px = sx + 12 * DPR + (shown.length - 0.5) * bw;
        hx.strokeStyle = "rgba(216,210,228,.35)";
        hx.setLineDash([2 * DPR, 3 * DPR]);
        hx.beginPath();
        hx.moveTo(px, chartTop);
        hx.lineTo(px, chartBot);
        hx.stroke();
        hx.setLineDash([]);
        const usdPx = r?.panels?.ledger.priceUsd && r.panels.ledger.priceQuote ? (last.c / r.panels.ledger.priceQuote) * r.panels.ledger.priceUsd : null;
        const lbl = usdPx !== null ? `$${usdPx < 0.0001 ? usdPx.toExponential(2) : usdPx.toPrecision(3)}` : last.c.toExponential(2);
        hx.font = "700 " + 7.5 * DPR + "px " + mono;
        const tw = hx.measureText(lbl).width;
        hx.fillStyle = "rgba(216,210,228,.9)";
        hx.fillRect(Math.min(px + 3 * DPR, sx + sw - tw - 10 * DPR), CY(last.c) - 6 * DPR, tw + 6 * DPR, 10 * DPR);
        hx.fillStyle = "#05040A";
        hx.fillText(lbl, Math.min(px + 6 * DPR, sx + sw - tw - 7 * DPR), CY(last.c) + 1.5 * DPR);
      }
      /* the tracked wallets' trades, on the candle they happened in */
      let lane = 0;
      /* the newest few, never two labels within three candles of each other */
      const visibleMarks: Mark[] = [];
      for (const m of MARKS.filter((q) => q.i < shown.length).reverse()) {
        if (visibleMarks.length >= 4) break;
        if (visibleMarks.some((q) => Math.abs(q.i - m.i) < 3)) continue;
        visibleMarks.push(m);
      }
      visibleMarks.reverse();
      for (const m of visibleMarks) {
        const mx = sx + 12 * DPR + m.i * bw + bw / 2;
        const k = CANDLES[m.i], at = CY(m.k === "SOLD" ? k.h : k.l);
        hx.strokeStyle = "rgba(" + m.col + ",.5)";
        hx.setLineDash([3 * DPR, 4 * DPR]);
        hx.lineWidth = 1.1 * DPR;
        hx.beginPath();
        hx.moveTo(mx, chartTop);
        hx.lineTo(mx, chartBot);
        hx.stroke();
        hx.setLineDash([]);
        hx.fillStyle = "rgb(" + m.col + ")";
        hx.beginPath();
        if (m.k === "SOLD") {
          hx.moveTo(mx, at - 9 * DPR);
          hx.lineTo(mx - 4 * DPR, at - 3 * DPR);
          hx.lineTo(mx + 4 * DPR, at - 3 * DPR);
        } else {
          hx.moveTo(mx, at + 9 * DPR);
          hx.lineTo(mx - 4 * DPR, at + 3 * DPR);
          hx.lineTo(mx + 4 * DPR, at + 3 * DPR);
        }
        hx.closePath();
        hx.fill();
        const ly = chartTop + 8 * DPR + (lane % 2) * 12 * DPR;
        lane++;
        hx.font = "700 " + 7.5 * DPR + "px " + mono;
        const txt = m.k + (m.note ? " " + m.note : "");
        const tw = hx.measureText(txt).width;
        const lx = Math.min(mx + 3 * DPR, sx + sw - tw - 10 * DPR);
        hx.fillStyle = "rgba(6,5,10,.85)";
        hx.fillRect(lx, ly - 7 * DPR, tw + 6 * DPR, 10 * DPR);
        hx.fillStyle = "rgb(" + m.col + ")";
        hx.fillText(txt, lx + 3 * DPR, ly);
      }
      /* the crawler.log strip along the bottom of the screen */
      if (LINES.length) {
        const ly = sy + sh - 9 * DPR;
        hx.fillStyle = "rgba(17,13,24,.95)";
        hx.fillRect(sx + 1, sy + sh - 22 * DPR, sw - 2, 21 * DPR);
        hx.save();
        hx.beginPath();
        hx.rect(sx + 1, sy + sh - 22 * DPR, sw - 2, 21 * DPR);
        hx.clip();
        hx.font = 8.5 * DPR + "px " + mono;
        const seg = (L: Line) => {
          const tag = CREW[L.crawler].n.toLowerCase() + " ";
          const body2 = L.text + "   ·   ";
          return { tag, body2, w: hx.measureText(tag).width + hx.measureText(body2).width };
        };
        /* the first line has scrolled off: drop it and carry the remainder */
        const first = seg(LINES[lineCursor % LINES.length]);
        if (ledX > first.w) {
          ledX -= first.w;
          lineCursor = (lineCursor + 1) % LINES.length;
        }
        let x = sx + 10 * DPR - ledX;
        for (let k = 0; x < sx + sw && k < LINES.length; k++) {
          const L = LINES[(lineCursor + k) % LINES.length];
          const { tag, body2, w } = seg(L);
          hx.fillStyle = "rgb(" + CREW[L.crawler].col + ")";
          hx.fillText(tag, x, ly);
          hx.fillStyle = "rgba(216,210,228,.8)";
          hx.fillText(body2, x + hx.measureText(tag).width, ly);
          x += w;
        }
        hx.restore();
      }
      /* screen bloom onto the room */
      const bl = hx.createRadialGradient(W2 * 0.5, sy + sh, 10, W2 * 0.5, sy + sh, W2 * 0.55);
      bl.addColorStop(0, "rgba(180,124,255,.16)");
      bl.addColorStop(1, "rgba(180,124,255,0)");
      hx.fillStyle = bl;
      hx.fillRect(0, 0, W2, H2);

      /* ---- the desks, two rows going back ---- */
      const ROWS = [{ n: 4, z: 0.26, sc: 0.86 }, { n: 4, z: 0.72, sc: 1.3 }];
      let idx = 0;
      for (const row of ROWS) {
        const yBase = HOR + Math.pow(row.z, 1.5) * (H2 - HOR) * 1.02;
        const spread = W2 * (0.2 + row.z * 0.26);
        for (let i = 0; i < row.n && idx < CREW.length; i++, idx++) {
          const c = CREW[idx], D = DESK[idx];
          const cx2 = W2 * 0.5 + (i - (row.n - 1) / 2) * spread * 0.62;
          const dw = W2 * 0.112 * row.sc, dh = H2 * 0.046 * row.sc;

          /* desk top as a trapezoid */
          hx.fillStyle = "#120E1E";
          hx.beginPath();
          hx.moveTo(cx2 - dw * 0.52, yBase);
          hx.lineTo(cx2 + dw * 0.52, yBase);
          hx.lineTo(cx2 + dw * 0.62, yBase + dh);
          hx.lineTo(cx2 - dw * 0.62, yBase + dh);
          hx.closePath();
          hx.fill();
          hx.strokeStyle = "rgba(180,124,255,.22)";
          hx.lineWidth = 1 * DPR;
          hx.stroke();
          hx.fillStyle = "rgba(" + c.col + ",.35)";
          hx.fillRect(cx2 - dw * 0.62, yBase + dh, dw * 1.24, 1.6 * DPR);

          /* monitor standing on the desk: big enough to read */
          const mw = dw * 0.98, mh = dh * 2.25, my = yBase - mh - 2 * DPR;
          if (animate) D.flash = Math.max(0, D.flash - 0.02);
          hx.fillStyle = "#07060C";
          hx.fillRect(cx2 - mw / 2, my, mw, mh);
          hx.strokeStyle = "rgba(" + c.col + "," + (0.45 + D.flash * 0.55) + ")";
          hx.lineWidth = (1 + D.flash) * DPR;
          hx.strokeRect(cx2 - mw / 2, my, mw, mh);
          const titleH = 9 * row.sc * DPR;
          hx.fillStyle = "rgba(" + c.col + ",.95)";
          hx.font = "700 " + 6.5 * row.sc * DPR + "px " + mono;
          hx.fillText(c.n, cx2 - mw / 2 + 3 * DPR, my + titleH - 2 * DPR);
          /* a live dot: this desk is working */
          hx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 0.006 + idx);
          hx.beginPath();
          hx.arc(cx2 + mw / 2 - 5 * DPR, my + titleH / 2, 1.8 * DPR, 0, 6.283);
          hx.fill();
          hx.globalAlpha = 1;
          monitor(hx, idx, cx2 - mw / 2 + 2 * DPR, my + titleH + 1 * DPR, mw - 4 * DPR, mh - titleH - 4 * DPR, c.col, D, t);
          hx.fillStyle = "#1B1528";
          hx.fillRect(cx2 - 2 * DPR, yBase - 3 * DPR, 4 * DPR, 3 * DPR);

          /* chair behind the desk */
          hx.fillStyle = "#15101F";
          hx.beginPath();
          hx.ellipse(cx2, yBase + dh * 1.5, dw * 0.2, dh * 0.34, 0, 0, 6.283);
          hx.fill();

          /* two places to stand: the owner's seat and the far side for a visitor */
          D.x = cx2 + dw * 0.5;
          D.y = yBase;
          D.sc = row.sc;
          D.vx = cx2 - dw * 1.06;
          D.vy = yBase - dh * 0.3;
        }
      }

      /* ---- the crew, walking the floor ---- */
      for (let i = 0; i < CREWST.length; i++) {
        const st = CREWST[i];
        if (!placed) {
          st.x = DESK[i].x;
          st.y = DESK[i].y;
          st.sc = DESK[i].sc;
        }
        if (!animate) continue;
        st.t += 16;
        if (st.state === "sit" && st.t > st.dur) {
          const goHome = st.at !== st.home && Math.random() < 0.55;
          const target = goHome ? st.home : ri(0, DESK.length - 1);
          if (target !== st.at) {
            st.fromX = st.x;
            st.fromY = st.y;
            const isHome = target === st.home;
            st.toX = isHome ? DESK[target].x : DESK[target].vx;
            st.toY = isHome ? DESK[target].y : DESK[target].vy;
            st.guest = !isHome;
            st.at = target;
            st.state = "walk";
            st.t = 0;
            st.dur = rnd(450, 850);
          } else {
            st.t = 0;
            st.dur = rnd(1500, 4500);
          }
        }
        if (st.state === "walk") {
          const u = Math.min(1, st.t / st.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
          st.x = st.fromX + (st.toX - st.fromX) * e;
          st.y = st.fromY + (st.toY - st.fromY) * e - Math.sin(u * Math.PI) * H2 * 0.035;
          st.sc = DESK[st.at].sc;
          st.step += 0.78;
          if (u >= 1) {
            st.state = "sit";
            st.t = 0;
            st.dur = rnd(1800, 5500);
          }
        } else {
          const d = DESK[st.at];
          st.x = st.guest ? d.vx : d.x;
          st.y = st.guest ? d.vy : d.y;
          st.sc = d.sc;
          st.step += 0.05;
        }
      }
      placed = true;
      const order = CREWST.map((_, i) => i).sort((p, q) => CREWST[p].y - CREWST[q].y);
      for (const i of order) {
        const st = CREWST[i], im = CREWIMG[i];
        if (!im.complete || !im.naturalWidth) continue;
        const ih = H2 * 0.105 * st.sc, iw = ih * (im.naturalWidth / im.naturalHeight);
        st.ih = ih;
        st.iw = iw;
        const bob = st.state === "walk" ? Math.abs(Math.sin(st.step)) * 4 * DPR : Math.sin(t * 0.0016 + i) * 1.6 * DPR;
        hx.fillStyle = "rgba(0,0,0,.45)";
        hx.beginPath();
        hx.ellipse(st.x + iw * 0.5, st.y + 2 * DPR, iw * 0.34, ih * 0.1, 0, 0, 6.283);
        hx.fill();
        hx.drawImage(im, st.x, st.y - ih - bob, iw, ih);
        if (st.state === "walk") {
          hx.strokeStyle = "rgba(" + CREW[i].col + ",.35)";
          hx.lineWidth = 1 * DPR;
          hx.setLineDash([3 * DPR, 5 * DPR]);
          hx.beginPath();
          hx.moveTo(st.fromX + iw * 0.5, st.fromY);
          hx.lineTo(st.x + iw * 0.5, st.y);
          hx.stroke();
          hx.setLineDash([]);
        }
      }

      /* speech: each bubble floats above its crawler and fades */
      const now = performance.now();
      BUBBLES = BUBBLES.filter((b) => now - b.born < 3600);
      for (const b of BUBBLES) {
        const st = CREWST[b.i];
        const age = (now - b.born) / 3600;
        const a = age < 0.1 ? age / 0.1 : age > 0.8 ? (1 - age) / 0.2 : 1;
        hx.font = 8.5 * DPR + "px " + mono;
        const txt = b.text.length > 46 ? b.text.slice(0, 45) + "…" : b.text;
        const tw = hx.measureText(txt).width;
        const bx = Math.max(4 * DPR, Math.min(W2 - tw - 14 * DPR, st.x + st.iw * 0.5 - tw / 2 - 5 * DPR));
        const by = st.y - st.ih - 20 * DPR - age * 6 * DPR;
        hx.globalAlpha = a;
        hx.fillStyle = "rgba(7,6,12,.92)";
        roundRect(hx, bx, by, tw + 10 * DPR, 14 * DPR, 3 * DPR);
        hx.fill();
        hx.strokeStyle = "rgba(" + CREW[b.i].col + ",.9)";
        hx.lineWidth = 1 * DPR;
        hx.stroke();
        hx.fillStyle = "rgb(" + CREW[b.i].col + ")";
        hx.fillText(txt, bx + 5 * DPR, by + 10 * DPR);
        hx.globalAlpha = 1;
      }

      /* a plant or two, for the room to read as a room */
      for (const px2 of [W2 * 0.09, W2 * 0.9]) {
        const py2 = H2 * 0.93;
        hx.fillStyle = "#1A1428";
        hx.fillRect(px2 - 10 * DPR, py2, 20 * DPR, 16 * DPR);
        hx.fillStyle = "rgba(125,240,200,.5)";
        for (let k = 0; k < 5; k++) {
          hx.beginPath();
          hx.ellipse(px2 + (k - 2) * 5 * DPR, py2 - 11 * DPR - Math.abs(k - 2) * 3 * DPR, 4 * DPR, 11 * DPR, (k - 2) * 0.4, 0, 6.283);
          hx.fill();
        }
      }

      /* counters: walk up to what the latest report found */
      const T = targets();
      if (!animate) {
        walked = T.walked; held = T.held; snipeN = T.snipe; smartN = T.smart;
      } else if (Math.random() < 0.06) {
        walked = Math.min(T.walked, walked + Math.max(ri(2, 24), Math.ceil(T.walked / 90)));
        if (Math.random() < 0.25 || held < T.held - 20) held = Math.min(T.held, held + Math.max(1, Math.ceil(T.held / 40)));
        if (Math.random() < 0.08 || snipeN < T.snipe - 10) snipeN = Math.min(T.snipe, snipeN + 1);
        if (Math.random() < 0.12 || smartN < T.smart - 10) smartN = Math.min(T.smart, smartN + 1);
      }
      writeCounters();
      if (animate) ledX += 0.6 * DPR;
    }

    /* ---- the loop: runs only while the room is on screen and the tab is visible ---- */
    const still = reducedMotion();
    let visible = false, raf = 0;
    const frame = (t: number) => {
      if (!visible || document.hidden) { raf = 0; return; }
      drawRoom(t, true);
      raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (still) { drawRoom(performance.now(), false); return; }
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver((es) => {
      visible = es.some((e) => e.isIntersecting);
      wake();
    });
    io.observe(hc);
    const onVis = () => wake();
    document.addEventListener("visibilitychange", onVis);
    const onResize = () => { timers.push(window.setTimeout(() => { hsz(); placed = false; if (still) drawRoom(performance.now(), false); }, 60)); };
    window.addEventListener("resize", onResize);
    if (still) {
      for (const im of CREWIMG) im.addEventListener("load", () => drawRoom(performance.now(), false));
      timers.push(window.setTimeout(() => drawRoom(performance.now(), false), 120));
    }

    let statusK = 0;
    const live = (fn: () => void) => () => { if (visible && !document.hidden && !still) fn(); };
    const iv = [
      /* the replay: one more candle onto the wall, then start over */
      window.setInterval(live(() => {
        if (synthetic) {
          CANDLES.shift();
          const last = CANDLES[CANDLES.length - 1].c, c2 = last * (1 + rnd(-0.035, 0.04));
          CANDLES.push({ o: last, c: c2, h: Math.max(last, c2) * 1.012, l: Math.min(last, c2) * 0.988 });
          return;
        }
        play = play >= CANDLES.length ? 18 : play + 1;
      }), 900),
      /* a desk steps to its next row */
      window.setInterval(live(() => {
        const i = ri(0, DESK.length - 1);
        DESK[i].cursor++;
        DESK[i].flash = 1;
      }), 520),
      /* someone reads a line of their own log aloud */
      window.setInterval(live(() => {
        const r = reportRef.current;
        if (!r) return;
        const sitting = CREWST.map((s, i) => i).filter((i) => CREWST[i].state === "sit" && !BUBBLES.some((b) => b.i === i));
        if (!sitting.length) return;
        const i = sitting[ri(0, sitting.length - 1)];
        const lines = r.crawlers[i]?.lines ?? [];
        if (!lines.length) return;
        BUBBLES.push({ i, text: lines[ri(0, lines.length - 1)].text, born: performance.now() });
        DESK[i].flash = 1;
      }), 1400),
      /* the route line's status: the crawlers' headline results in turn */
      window.setInterval(live(() => {
        const r = reportRef.current;
        if (!stateRef.current || !r) return;
        const c = r.crawlers[statusK++ % r.crawlers.length];
        stateRef.current.textContent = `${c.name} · ${c.stats[0]} · ${c.stats[1]}`;
        stateRef.current.style.color = c.color;
      }), 2600),
    ];

    return () => {
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      timers.forEach((id) => clearTimeout(id));
      iv.forEach((id) => clearInterval(id));
    };
  }, []);

  return (
    <div className="roomband">
      <div className="stage">
        <canvas id="hunt" ref={cvRef} aria-label="The crawlers' research room: eight desks showing the latest crawl, a replay of the token's chart on the back wall" />
        <div className="routfoot">
          <span>
            sources → objections → size → your approval
            {report ? <em className="roomtok"> · ${report.token.symbol} · crawled {crawledAt(report)}</em> : null}
          </span>
          <u ref={stateRef}>READY</u>
        </div>
        <div className="stagefoot">
          <div className="sf"><div className="k">holders walked</div><div className="v" ref={(el) => { sfRefs.current[0] = el; }}>0</div></div>
          <div className="sf"><div className="k">still holding</div><div className="v g" ref={(el) => { sfRefs.current[1] = el; }}>0%</div></div>
          <div className="sf"><div className="k">snipers</div><div className="v y" ref={(el) => { sfRefs.current[2] = el; }}>0</div></div>
          <div className="sf"><div className="k">smart wallets</div><div className="v c" ref={(el) => { sfRefs.current[3] = el; }}>0</div></div>
        </div>
      </div>
    </div>
  );
}
