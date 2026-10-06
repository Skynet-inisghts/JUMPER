"use client";
import { useEffect, useRef } from "react";
import { CREW, dprNow, fmt, fontsFor, hex4, reducedMotion, ri, rnd, usd, type Report } from "@/lib/util";

/* ---------- the research floor, in perspective (ported from prototype.html) ---------- */

interface Mark { i: number; k: string; col: string; note?: string }
type Candle = { o: number; c: number; h: number; l: number };

/** The trade marks on the wall chart come from the report's fills, in order. */
function markQueue(r: Report | null): Omit<Mark, "i">[] {
  if (!r) return [];
  const flagged = new Set(r.holders.filter((h) => h.flags.includes("sniper") || h.flags.includes("deployer")).map((h) => h.wallet.toLowerCase()));
  const book = new Map<string, { tok: number; usd: number }>();
  const shownFlag = new Set<string>();
  const out: Omit<Mark, "i">[] = [];
  for (const f of [...r.fills].sort((a, b) => a.ts - b.ts)) {
    const w = f.wallet.toLowerCase();
    if (flagged.has(w) && !shownFlag.has(w)) {
      shownFlag.add(w);
      out.push({ k: "FLAGGED", col: "180,124,255", note: "" });
    }
    const b = book.get(w);
    if (f.kind === "buy") {
      out.push({ k: b ? "ADDED" : "BOUGHT", col: "125,240,200", note: f.usd != null ? usd(f.usd) : "" });
      book.set(w, { tok: (b?.tok ?? 0) + f.tokens, usd: (b?.usd ?? 0) + (f.usd ?? 0) });
    } else {
      let note = f.usd != null ? usd(f.usd) : "";
      if (b && b.tok > 0 && b.usd > 0 && f.usd != null && f.tokens > 0) {
        const pnl = (f.usd / (f.tokens * (b.usd / b.tok)) - 1) * 100;
        note = (pnl >= 0 ? "+" : "-") + Math.round(Math.abs(pnl)) + "%";
      }
      out.push({ k: "SOLD", col: "255,93,122", note });
    }
  }
  return out;
}

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

    /* the candles on the back wall: decorative, labelled as a replay */
    const WALLC: Candle[] = [];
    {
      let px = 100;
      for (let i = 0; i < 64; i++) {
        const o = px, c = px * (1 + rnd(-0.04, 0.042));
        WALLC.push({ o, c, h: Math.max(o, c) * 1.012, l: Math.min(o, c) * 0.988 });
        px = c;
      }
    }
    /* marks live on an index that shifts with the chart; seeded from the report's fills */
    let queue = markQueue(reportRef.current);
    let qi = 0;
    let seededFor = reportRef.current;
    const nextMark = (): Omit<Mark, "i"> | null => {
      if (!queue.length) return null;
      const m = queue[qi % queue.length];
      qi++;
      return m;
    };
    let MARKS: Mark[] = [];
    const seed = () => {
      MARKS = [];
      /* open on a spread of the replay so the wall shows buys, adds and sells at once */
      const sells = queue.findIndex((m) => m.k === "SOLD");
      if (sells > 3) qi = sells - 2;
      for (const i of [14, 22, 38, 52]) {
        const m = nextMark();
        if (m) MARKS.push({ ...m, i });
      }
    };
    seed();

    /* each desk keeps its own little readout */
    const MONKIND = ["graph", "bars", "wallets", "rows", "heat", "line", "scan", "verdict"];
    const DESK = CREW.map((_, i) => ({
      d: Array.from({ length: 18 }, () => Math.random()),
      kind: MONKIND[i], flash: 0, x: 0, y: 0, sc: 1, vx: 0, vy: 0,
      rows: Array.from({ length: 4 }, () => ({ a: "0x" + hex4(), v: ri(1, 99) })),
      heat: Array.from({ length: 24 }, () => Math.random()),
      scan: 0,
    }));
    type DeskT = (typeof DESK)[number];

    /* the crew: each one owns a desk but wanders between them */
    const CREWST = CREW.map((_, i) => ({
      home: i, at: i, x: 0, y: 0, sc: 1, guest: false,
      state: "sit" as "sit" | "walk", t: 0, dur: rnd(1500, 4500), fromX: 0, fromY: 0, toX: 0, toY: 0, step: rnd(0, 6.28),
    }));

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

    function miniChart(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, DK: DeskT) {
      const D = DK.d, kind = DK.kind;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = ctx.fillStyle = "rgb(" + col + ")";
      const F = Math.max(5, h * 0.22);

      if (kind === "bars") { /* transfer volume */
        const bw = w / D.length;
        D.forEach((v, k) => {
          ctx.globalAlpha = 0.45 + v * 0.55;
          ctx.fillRect(x + k * bw + 1, y + h - 2 - v * (h - 5), bw - 2, v * (h - 5));
        });
        ctx.globalAlpha = 1;
      } else if (kind === "wallets") { /* a list of addresses */
        ctx.font = F + "px " + mono;
        DK.rows.forEach((r, k) => {
          ctx.globalAlpha = 0.9 - k * 0.16;
          ctx.fillText(r.a + "…", x + 2, y + F + k * (h / 4));
          ctx.fillText(r.v + "%", x + w - F * 2.4, y + F + k * (h / 4));
        });
        ctx.globalAlpha = 1;
      } else if (kind === "rows") { /* a ledger of in and out */
        DK.rows.forEach((r, k) => {
          const yy = y + 3 + (k * (h - 6)) / 4, wd = (r.v / 100) * (w - 6);
          ctx.globalAlpha = 0.25;
          ctx.fillRect(x + 3, yy, w - 6, (h - 6) / 4 - 2);
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x + 3, yy, wd, (h - 6) / 4 - 2);
        });
        ctx.globalAlpha = 1;
      } else if (kind === "heat") { /* a grid of cohorts */
        const cols = 8, rows2 = 3, cw = (w - 4) / cols, ch = (h - 4) / rows2;
        DK.heat.forEach((v, k) => {
          ctx.globalAlpha = 0.15 + v * 0.8;
          ctx.fillRect(x + 2 + (k % cols) * cw, y + 2 + Math.floor(k / cols) * ch, cw - 1.5, ch - 1.5);
        });
        ctx.globalAlpha = 1;
      } else if (kind === "scan") { /* a sweep across a field of dots */
        DK.scan = (DK.scan + 0.012) % 1;
        for (let k = 0; k < 26; k++) {
          const px = x + (((k * 37) % 100) / 100) * w, py = y + (((k * 61) % 100) / 100) * h;
          const d = Math.abs(px - (x + DK.scan * w));
          ctx.globalAlpha = d < w * 0.12 ? 0.95 : 0.22;
          ctx.fillRect(px, py, 2, 2);
        }
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x + DK.scan * w, y, 1.4, h);
        ctx.globalAlpha = 1;
      } else if (kind === "verdict") { /* a score bar with a marker */
        const sc = 0.2 + D[D.length - 1] * 0.75;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(x + 3, y + h * 0.42, w - 6, h * 0.18);
        ctx.globalAlpha = 1;
        ctx.fillRect(x + 3, y + h * 0.42, (w - 6) * sc, h * 0.18);
        ctx.fillRect(x + 3 + (w - 6) * sc - 1, y + h * 0.32, 2.5, h * 0.38);
        ctx.font = F + "px " + mono;
        ctx.fillText(String(Math.round(sc * 100)), x + 3, y + F);
      } else if (kind === "graph") { /* a little holder tree */
        ctx.lineWidth = 1;
        for (let k = 0; k < 7; k++) {
          const yy = y + (h * (k + 0.6)) / 7.2;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(x + 4, y + h / 2);
          ctx.bezierCurveTo(x + w * 0.32, y + h / 2, x + w * 0.44, yy, x + w - 6, yy);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(x + w - 5, yy, 1.7, 0, 6.283);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(x + 4, y + h / 2, 2.4, 0, 6.283);
        ctx.fill();
      } else { /* a plain line */
        ctx.lineWidth = Math.max(1, w * 0.012);
        ctx.beginPath();
        D.forEach((v, k) => {
          const px = x + (k / (D.length - 1)) * w, py = y + h - 3 - v * (h - 7);
          if (k) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        });
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawRoom(t: number, animate: boolean) {
      if (!SW || !hx) return;
      const W2 = SW, H2 = SH;
      const r = reportRef.current;
      if (r !== seededFor) {
        seededFor = r;
        queue = markQueue(r);
        qi = 0;
        seed();
      }
      const ROOMTOK = r ? "$" + r.token.symbol : "";
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
      const sx = W2 * 0.21, sy = H2 * 0.05, sw = W2 * 0.58, sh = H2 * 0.27;
      hx.fillStyle = "#05040A";
      hx.fillRect(sx, sy, sw, sh);
      hx.strokeStyle = "#392B55";
      hx.lineWidth = 2.4 * DPR;
      hx.strokeRect(sx, sy, sw, sh);
      hx.fillStyle = "rgba(126,116,144,.95)";
      hx.font = 9 * DPR + "px " + mono;
      hx.fillText("SELECTED TOKEN / RESEARCH REPLAY", sx + 10 * DPR, sy + 15 * DPR);
      hx.fillStyle = "#B47CFF";
      hx.textAlign = "right";
      hx.fillText(ROOMTOK, sx + sw - 10 * DPR, sy + 15 * DPR);
      hx.textAlign = "left";
      /* candles inside */
      const hi = Math.max(...WALLC.map((k) => k.h)), lo = Math.min(...WALLC.map((k) => k.l));
      const CY = (v: number) => sy + sh - 16 * DPR - ((v - lo) / (hi - lo)) * (sh - 34 * DPR);
      const bw = (sw - 24 * DPR) / WALLC.length;
      WALLC.forEach((k, i) => {
        const x = sx + 12 * DPR + i * bw, up = k.c >= k.o;
        hx.strokeStyle = hx.fillStyle = up ? "#7DF0C8" : "#FF5D7A";
        hx.lineWidth = 1 * DPR;
        hx.beginPath();
        hx.moveTo(x + bw / 2, CY(k.h));
        hx.lineTo(x + bw / 2, CY(k.l));
        hx.stroke();
        hx.fillRect(x + 0.6 * DPR, Math.min(CY(k.o), CY(k.c)), bw - 1.6 * DPR, Math.max(1.4 * DPR, Math.abs(CY(k.o) - CY(k.c))));
      });
      /* the swarm's marks on the chart */
      let lane = 0;
      for (const m of MARKS) {
        if (m.i < 0 || m.i >= WALLC.length) continue;
        const mx = sx + 12 * DPR + m.i * bw + bw / 2;
        const k = WALLC[m.i], at = CY(m.k === "SOLD" ? k.h : k.l);
        hx.strokeStyle = "rgba(" + m.col + ",.55)";
        hx.setLineDash([3 * DPR, 4 * DPR]);
        hx.lineWidth = 1.1 * DPR;
        hx.beginPath();
        hx.moveTo(mx, sy + 22 * DPR);
        hx.lineTo(mx, sy + sh - 8 * DPR);
        hx.stroke();
        hx.setLineDash([]);
        /* the marker itself, on the candle */
        hx.fillStyle = "rgb(" + m.col + ")";
        if (m.k === "SOLD") {
          hx.beginPath();
          hx.moveTo(mx, at - 9 * DPR);
          hx.lineTo(mx - 4 * DPR, at - 3 * DPR);
          hx.lineTo(mx + 4 * DPR, at - 3 * DPR);
          hx.closePath();
          hx.fill();
        } else {
          hx.beginPath();
          hx.moveTo(mx, at + 9 * DPR);
          hx.lineTo(mx - 4 * DPR, at + 3 * DPR);
          hx.lineTo(mx + 4 * DPR, at + 3 * DPR);
          hx.closePath();
          hx.fill();
        }
        /* the label, staggered so they do not collide */
        const ly = sy + 28 * DPR + (lane % 3) * 11 * DPR;
        lane++;
        hx.font = "700 " + 7.5 * DPR + "px " + mono;
        const txt = m.k + (m.note ? " " + m.note : "");
        const tw = hx.measureText(txt).width;
        hx.fillStyle = "rgba(6,5,10,.85)";
        hx.fillRect(mx + 3 * DPR, ly - 7 * DPR, tw + 6 * DPR, 10 * DPR);
        hx.fillStyle = "rgb(" + m.col + ")";
        hx.fillText(txt, mx + 6 * DPR, ly);
      }
      /* the position band between the first buy and the last sell */
      const buy = MARKS.find((m) => m.k === "BOUGHT"), sell = MARKS.find((m) => m.k === "SOLD");
      if (buy && sell && sell.i > buy.i) {
        const x1 = sx + 12 * DPR + buy.i * bw, x2 = sx + 12 * DPR + sell.i * bw;
        hx.fillStyle = "rgba(125,240,200,.06)";
        hx.fillRect(x1, sy + 20 * DPR, x2 - x1, sh - 28 * DPR);
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
          /* desk front edge light */
          hx.fillStyle = "rgba(" + c.col + ",.35)";
          hx.fillRect(cx2 - dw * 0.62, yBase + dh, dw * 1.24, 1.6 * DPR);

          /* monitor standing on the desk */
          const mw = dw * 0.78, mh = dh * 1.5, my = yBase - mh - 2 * DPR;
          if (animate) D.flash = Math.max(0, D.flash - 0.02);
          hx.fillStyle = "#07060C";
          hx.fillRect(cx2 - mw / 2, my, mw, mh);
          hx.strokeStyle = "rgba(" + c.col + "," + (0.45 + D.flash * 0.55) + ")";
          hx.lineWidth = (1 + D.flash) * DPR;
          hx.strokeRect(cx2 - mw / 2, my, mw, mh);
          miniChart(hx, cx2 - mw / 2 + 2 * DPR, my + 8 * DPR, mw - 4 * DPR, mh - 11 * DPR, c.col, D);
          hx.fillStyle = "rgba(" + c.col + ",.95)";
          hx.font = 6.5 * row.sc * DPR + "px " + mono;
          hx.fillText(c.n, cx2 - mw / 2 + 3 * DPR, my + 7 * DPR);
          /* stand */
          hx.fillStyle = "#1B1528";
          hx.fillRect(cx2 - 2 * DPR, yBase - 3 * DPR, 4 * DPR, 3 * DPR);

          /* chair behind the desk */
          hx.fillStyle = "#15101F";
          hx.beginPath();
          hx.ellipse(cx2, yBase + dh * 1.5, dw * 0.2, dh * 0.34, 0, 0, 6.283);
          hx.fill();

          /* two places to stand: the owner's seat and the far side for a visitor */
          D.x = cx2 + dw * 0.46;
          D.y = yBase;
          D.sc = row.sc;
          D.vx = cx2 - dw * 1.02;
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
          /* get up and visit someone else's desk, or go home */
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
      /* draw them back to front so the near row overlaps the far one */
      const order = CREWST.map((_, i) => i).sort((p, q) => CREWST[p].y - CREWST[q].y);
      for (const i of order) {
        const st = CREWST[i], im = CREWIMG[i];
        if (!im.complete || !im.naturalWidth) continue;
        const ih = H2 * 0.105 * st.sc, iw = ih * (im.naturalWidth / im.naturalHeight);
        const bob = st.state === "walk" ? Math.abs(Math.sin(st.step)) * 4 * DPR : Math.sin(t * 0.0016 + i) * 1.6 * DPR;
        /* a soft shadow on the floor under it */
        hx.fillStyle = "rgba(0,0,0,.45)";
        hx.beginPath();
        hx.ellipse(st.x + iw * 0.5, st.y + 2 * DPR, iw * 0.34, ih * 0.1, 0, 0, 6.283);
        hx.fill();
        hx.drawImage(im, st.x, st.y - ih - bob, iw, ih);
        /* a thread trailing behind whoever is walking */
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

    const live = (fn: () => void) => () => { if (visible && !document.hidden && !still) fn(); };
    const iv = [
      window.setInterval(live(() => {
        WALLC.shift();
        const last = WALLC[WALLC.length - 1].c, c2 = last * (1 + rnd(-0.035, 0.04));
        WALLC.push({ o: last, c: c2, h: Math.max(last, c2) * 1.012, l: Math.min(last, c2) * 0.988 });
        MARKS.forEach((m) => m.i--);
        MARKS = MARKS.filter((m) => m.i > 1);
        if (MARKS.length < 4 && Math.random() < 0.22) {
          const m = nextMark();
          if (m) MARKS.push({ ...m, i: WALLC.length - 3 });
        }
      }), 1300),
      window.setInterval(live(() => {
        const i = ri(0, DESK.length - 1);
        DESK[i].d.shift();
        DESK[i].d.push(Math.random());
        DESK[i].flash = 1;
        const D = DESK[i];
        if (D.kind === "wallets" || D.kind === "rows") {
          D.rows.shift();
          D.rows.push({ a: "0x" + hex4(), v: ri(1, 99) });
        }
        if (D.kind === "heat") D.heat[ri(0, D.heat.length - 1)] = Math.random();
      }), 520),
      window.setInterval(live(() => {
        if (stateRef.current) stateRef.current.textContent = ["READY", "SCORING", "USER APPROVED"][ri(0, 2)];
      }), 3400),
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
        <canvas id="hunt" ref={cvRef} aria-label="The crawlers' research room: eight desks, a replay chart on the back wall" />
        <div className="routfoot">
          <span>sources → objections → size → your approval</span>
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
