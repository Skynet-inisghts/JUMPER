"use client";
import { useEffect, useRef } from "react";
import { spider } from "@/lib/spider";
import { CREW, dprNow, fontsFor, reducedMotion, ri, rnd, type Report } from "@/lib/util";

/* ---------- the swarm that crawls over the whole page and spins silk ----------
 * Ported from prototype.html. Coordinates live in the document, so a spider
 * stays on the same word while the page scrolls. Captions are the crawlers'
 * own log lines from the latest report. */

type Anchor = { x: number; y: number; born: number };
type Thread = { a: Anchor; b: Anchor; born: number; dash: boolean; col: string };
type Jump = { x0: number; y0: number; x1: number; y1: number; arc: number; t: number; dur: number };
interface Spider {
  x: number; y: number; vx: number; vy: number; col: string; ang: number; dot: string; sp: number; scale: number; leg: number;
  trail: { x: number; y: number }[]; tgt: { x: number; y: number; anchor: Anchor } | null; anchor: Anchor | null;
  life: number; maxlife: number; fade: number; state: "walk" | "rest" | "jump"; jump: Jump | null; rest: number;
  feet?: [number, number][];
}
type Tag = { sp: Spider; txt: string; col: string; born: number };
type Box = { x: number; y: number; w: number; h: number; col: string; sx: number; sy: number };

// owner's call: a third of the spec's eleven, the page reads before the swarm does
const PER_SCREEN = 3.7;

export default function SpiderLayer({ report }: { report: Report | null }) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const findsRef = useRef<[string, string][]>([]);

  useEffect(() => {
    const out: [string, string][] = [];
    for (const c of report?.crawlers ?? []) {
      const crew = CREW.find((x) => x.n === c.name);
      for (const l of c.lines) {
        const txt = l.text.replace(/ • /g, " · ");
        if (txt.length <= 52) out.push([txt, crew?.col ?? "180,124,255"]);
      }
    }
    findsRef.current = out;
  }, [report]);

  useEffect(() => {
    const wc = cvRef.current;
    const wx = wc?.getContext("2d");
    if (!wc || !wx) return;
    const still = reducedMotion();
    let DPR = dprNow();
    let W = 0, H = 0; /* viewport, in device pixels */
    let DW = 0, DH = 0; /* the whole document, in device pixels */
    let SCX = 0, SCY = 0; /* scroll offset, in device pixels */
    const docH = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const sz = () => {
      DPR = dprNow();
      wc.width = innerWidth * DPR;
      wc.height = innerHeight * DPR;
      wc.style.width = innerWidth + "px";
      wc.style.height = innerHeight + "px";
      W = wc.width;
      H = wc.height;
      DW = W;
      DH = docH() * DPR;
      SCX = scrollX * DPR;
      SCY = scrollY * DPR;
    };
    sz();
    const onScroll = () => {
      SCX = scrollX * DPR;
      SCY = scrollY * DPR;
      if (still) drawWeb(performance.now(), false);
    };
    const onResize = () => { sz(); if (still) drawWeb(performance.now(), false); };
    addEventListener("resize", onResize);
    addEventListener("scroll", onScroll, { passive: true });
    const dhTimer = setInterval(() => { DH = docH() * DPR; }, 1500);

    const ANCH: Anchor[] = []; // anchor points the swarm has dropped
    const TAGS: Tag[] = []; // what a crawler found there, shown briefly
    const THREAD: Thread[] = []; // silk tied between anchors
    const SWARM: Spider[] = [];
    let MAXSW = 16;
    /* about eleven per desktop screen; a phone screen holds fewer, the legs do not shrink */
    const perScreen = () => PER_SCREEN * Math.max(0.35, Math.min(1, (innerWidth * innerHeight) / (1440 * 900)));
    const wantSwarm = () => Math.max(3, Math.min(50, Math.round((DH / H) * perScreen())));
    const roomRange = () => {
      const rb = document.querySelector(".roomband");
      if (!rb) return [-1, -1];
      const r = rb.getBoundingClientRect();
      return [(r.top + scrollY) * DPR, (r.bottom + scrollY) * DPR];
    };

    function newSpider(): Spider {
      const c = CREW[ri(0, CREW.length - 1)];
      /* fill the emptiest band of the page, so every screen has a few */
      const bands = Math.max(1, Math.round(DH / H));
      const count = new Array(bands).fill(0);
      for (const o of SWARM) {
        const k = Math.min(bands - 1, Math.max(0, Math.floor((o.y / DH) * bands)));
        count[k]++;
      }
      let pick = 0, low = 1e9;
      for (let k = 0; k < bands; k++) {
        const bias = k === Math.floor((SCY / DH) * bands) ? -0.6 : 0; /* a slight nudge to what is on screen */
        if (count[k] + bias < low) { low = count[k] + bias; pick = k; }
      }
      const x = rnd(0.04, 0.96) * DW;
      const y = Math.max(70 * DPR, Math.min(DH - 30 * DPR, (pick + Math.random()) * (DH / bands)));
      const DOTS = ["255,209,102", "110,208,255", "125,240,200", "255,93,122", "214,180,255"];
      const r = Math.random();
      return {
        x, y, vx: 0, vy: 0, col: c.col, ang: rnd(0, 6.283),
        dot: DOTS[ri(0, DOTS.length - 1)],
        sp: rnd(0.9, 2.7), // walking speed
        scale: r < 0.34 ? rnd(1.6, 2.2) // quick ones
          : r < 0.84 ? rnd(2.4, 3.4) // the working size
            : rnd(3.8, 5.0), // a couple of heavies
        leg: rnd(0, 6.28),
        trail: [], tgt: null, anchor: null,
        life: 0, maxlife: rnd(14000, 34000), // it leaves eventually
        fade: 0, // 0..1 in, then back out
        state: "walk", jump: null, rest: 0,
      };
    }
    const seedTimer = setTimeout(() => {
      DH = docH() * DPR;
      const n = wantSwarm();
      for (let i = 0; i < n; i++) {
        const s = newSpider();
        s.y = Math.max(70 * DPR, Math.min(DH - 30 * DPR, ((i + 0.5) / n) * DH + rnd(-0.3, 0.3) * (DH / n)));
        s.x = rnd(0.05, 0.95) * DW;
        s.fade = 1;
        SWARM.push(s);
      }
      if (still) drawWeb(performance.now(), false);
    }, 300);

    function nearestAnchor(s: Spider, maxd: number) {
      let best: Anchor | null = null, bd = maxd * maxd;
      for (const a of ANCH) {
        if (a === s.anchor) continue;
        const d = (a.x - s.x) ** 2 + (a.y - s.y) ** 2;
        if (d < bd) { bd = d; best = a; }
      }
      return best;
    }
    function pickTarget(s: Spider, t: number) {
      const near = Math.random() < 0.34 ? nearestAnchor(s, W * 0.3) : null;
      if (near) { s.tgt = { x: near.x, y: near.y, anchor: near }; return; }
      /* half the time head for the reading column, so they crawl over the copy */
      let nx: number, ny: number;
      if (Math.random() < 0.5) {
        nx = rnd(0.06, 0.54) * DW;
        ny = s.y + rnd(-1, 1) * H * 0.55;
      } else {
        nx = Math.max(DW * 0.03, Math.min(DW * 0.97, s.x + rnd(-1, 1) * DW * 0.26));
        ny = s.y + rnd(-1, 1) * H * 0.5;
      }
      ny = Math.max(70 * DPR, Math.min(DH - 20 * DPR, ny));
      const [t0, b0] = roomRange();
      if (t0 >= 0 && ny > t0 && ny < b0) ny = Math.random() < 0.5 ? t0 - 40 * DPR : b0 + 40 * DPR;
      const a = { x: nx, y: ny, born: t };
      ANCH.push(a);
      while (ANCH.length > 420) ANCH.shift();
      if (s.anchor) THREAD.push({ a: s.anchor, b: a, born: t, dash: Math.random() < 0.35, col: s.col });
      s.tgt = { x: nx, y: ny, anchor: a };
    }

    function stepSwarm(t: number, dt: number) {
      /* population: spawn newcomers, retire the old */
      MAXSW = wantSwarm();
      if (SWARM.length < MAXSW && Math.random() < 0.05) SWARM.push(newSpider());
      for (let i = SWARM.length - 1; i >= 0; i--) {
        const s = SWARM[i];
        s.life += dt;
        if (s.life < 700) s.fade = Math.min(1, s.fade + dt / 700);
        else if (s.life > s.maxlife) {
          s.fade -= dt / 900;
          if (s.fade <= 0) { SWARM.splice(i, 1); continue; }
        }

        if (s.state === "rest") {
          s.rest -= dt;
          s.leg += 0.012;
          if (s.rest <= 0) s.state = "walk";
          s.trail.push({ x: s.x, y: s.y });
          if (s.trail.length > 52) s.trail.shift();
          continue;
        }

        if (s.state === "jump" && s.jump) {
          const j = s.jump;
          j.t += dt / j.dur;
          if (j.t >= 1) {
            s.x = j.x1;
            s.y = j.y1;
            s.state = "walk";
            s.jump = null;
            s.tgt = null;
            if (Math.random() < 0.35) { s.state = "rest"; s.rest = rnd(600, 1800); }
          } else {
            const u = j.t;
            s.x = j.x0 + (j.x1 - j.x0) * u;
            s.y = j.y0 + (j.y1 - j.y0) * u - Math.sin(u * Math.PI) * j.arc;
            s.leg += 0.5; // legs splay mid-air
            const wa = Math.atan2(j.y1 - j.y0, j.x1 - j.x0) + Math.PI / 2;
            const dj = ((wa - s.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            s.ang += dj * 0.09;
          }
          s.trail.push({ x: s.x, y: s.y });
          if (s.trail.length > 52) s.trail.shift();
          continue;
        }

        /* walking */
        if (!s.tgt || Math.hypot(s.tgt.x - s.x, s.tgt.y - s.y) < 13 * DPR) {
          if (s.tgt && s.tgt.anchor) {
            if (s.anchor) THREAD.push({ a: s.anchor, b: s.tgt.anchor, born: t, dash: Math.random() < 0.45, col: s.col });
            s.anchor = s.tgt.anchor;
            const FINDS = findsRef.current;
            if (FINDS.length && Math.random() < 0.14) {
              const [txt, col] = FINDS[ri(0, FINDS.length - 1)];
              TAGS.push({ sp: s, txt, col, born: t });
              while (TAGS.length > 3) TAGS.shift();
            }
          }
          /* at an anchor it may stop, jump, or carry on */
          const roll = Math.random();
          if (roll < 0.12) { s.state = "rest"; s.rest = rnd(200, 750); s.tgt = null; continue; }
          if (roll < 0.62) {
            const ang = rnd(0, 6.283), dist = rnd(0.2, 0.52) * Math.min(W, H);
            s.jump = {
              x0: s.x, y0: s.y,
              x1: Math.max(DW * 0.03, Math.min(DW * 0.97, s.x + Math.cos(ang) * dist)),
              y1: Math.max(70 * DPR, Math.min(DH - 20 * DPR, s.y + Math.sin(ang) * dist)),
              arc: rnd(50, 165) * DPR, t: 0, dur: rnd(170, 330),
            };
            s.state = "jump";
            s.anchor = null;
            continue;
          }
          pickTarget(s, t);
        }
        const tgt = s.tgt!;
        const dx = tgt.x - s.x, dy = tgt.y - s.y, d = Math.hypot(dx, dy) || 1;
        s.vx += (dx / d - s.vx) * 0.14;
        s.vy += (dy / d - s.vy) * 0.14;
        const spd = s.sp * (1.5 / Math.max(0.8, s.scale * 0.8));
        s.x += s.vx * spd * DPR * 1.7;
        s.y += s.vy * spd * DPR * 1.7;
        s.leg += 0.16 * s.sp;
        const want = Math.atan2(s.vy, s.vx) + Math.PI / 2;
        const dA = ((want - s.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        s.ang += dA * 0.12;
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 52) s.trail.shift();
      }
      while (THREAD.length > 700) THREAD.shift();
    }

    let BOXES: Box[] = [];
    let litEls: HTMLElement[] = [];
    let lastLit = 0;
    const { mono } = fontsFor();

    function drawWeb(t: number, animate: boolean) {
      if (!wx) return;
      wx.clearRect(0, 0, W, H);
      wx.save();
      wx.translate(-SCX, -SCY);

      for (const th of THREAD) {
        const age = (t - th.born) / 15000;
        if (age > 1) continue;
        if (th.a.y < SCY - 200 * DPR && th.b.y < SCY - 200 * DPR) continue;
        if (th.a.y > SCY + H + 200 * DPR && th.b.y > SCY + H + 200 * DPR) continue;
        const len = Math.hypot(th.b.x - th.a.x, th.b.y - th.a.y);
        if (len > W * 0.32) continue; /* a dragline, not a tightrope */
        wx.strokeStyle = "rgba(" + th.col + "," + (1 - age) * 0.13 + ")";
        wx.lineWidth = 1 * DPR;
        if (th.dash) wx.setLineDash([3 * DPR, 6 * DPR]);
        else wx.setLineDash([]);
        wx.beginPath();
        wx.moveTo(th.a.x, th.a.y);
        wx.lineTo(th.b.x, th.b.y);
        wx.stroke();
      }
      wx.setLineDash([]);

      for (const a of ANCH) {
        const age = (t - a.born) / 15000;
        if (age > 1) continue;
        const al = (1 - age) * 0.32;
        wx.fillStyle = "rgba(180,124,255," + al + ")";
        wx.fillRect(a.x - 1.5 * DPR, a.y - 1.5 * DPR, 3 * DPR, 3 * DPR);
      }

      wx.font = 10.5 * DPR + "px " + mono;
      for (const g of TAGS) {
        const age = (t - g.born) / 3000;
        if (age > 1 || !g.sp || g.sp.fade < 0.3) continue;
        const al = (age < 0.15 ? age / 0.15 : (1 - age) * 1.1) * 0.9;
        const gx = g.sp.x + 12 * DPR, gy = g.sp.y + 16 * DPR; /* follows its own spider */
        const w = wx.measureText(g.txt).width + 11 * DPR;
        wx.fillStyle = "rgba(7,6,10," + al * 0.82 + ")";
        wx.fillRect(gx, gy - 10 * DPR, w, 15 * DPR);
        wx.fillStyle = "rgba(" + g.col + "," + al * 0.9 + ")";
        wx.fillRect(gx, gy - 10 * DPR, 1.5 * DPR, 15 * DPR);
        wx.fillStyle = "rgba(" + g.col + "," + al + ")";
        wx.fillText(g.txt, gx + 7 * DPR, gy + 1 * DPR);
      }

      /* what the swarm is reading right now, boxed and tethered */
      for (const b of BOXES) {
        wx.strokeStyle = "rgba(" + b.col + ",.55)";
        wx.lineWidth = 1 * DPR;
        wx.strokeRect(b.x - 3 * DPR, b.y - 3 * DPR, b.w + 6 * DPR, b.h + 6 * DPR);
        const cx2 = b.x + b.w / 2, cy2 = b.y + b.h / 2;
        wx.setLineDash([3 * DPR, 5 * DPR]);
        wx.strokeStyle = "rgba(" + b.col + ",.28)";
        wx.beginPath();
        wx.moveTo(b.sx, b.sy);
        wx.lineTo(cx2, cy2);
        wx.stroke();
        wx.setLineDash([]);
        /* corner ticks, so it reads as a reticle not a border */
        wx.strokeStyle = "rgba(" + b.col + ",.9)";
        wx.lineWidth = 1.6 * DPR;
        const L = 5 * DPR;
        for (const [ox, oy, ddx, ddy] of [[0, 0, 1, 1], [b.w, 0, -1, 1], [0, b.h, 1, -1], [b.w, b.h, -1, -1]]) {
          wx.beginPath();
          wx.moveTo(b.x - 3 * DPR + ox, b.y - 3 * DPR + oy + ddy * L);
          wx.lineTo(b.x - 3 * DPR + ox, b.y - 3 * DPR + oy);
          wx.lineTo(b.x - 3 * DPR + ox + ddx * L, b.y - 3 * DPR + oy);
          wx.stroke();
        }
      }

      const [rbT, rbB] = roomRange();
      for (const s of SWARM) {
        if (s.y < SCY - 200 * DPR || s.y > SCY + H + 200 * DPR) continue;
        if (rbT >= 0 && s.y > rbT && s.y < rbB) continue;
        const al = Math.max(0, Math.min(1, s.fade));
        if (s.trail.length > 1 && s.state !== "jump") {
          wx.strokeStyle = "rgba(" + s.col + "," + 0.22 * al + ")";
          wx.lineWidth = Math.max(1, 0.8 * s.scale) * DPR;
          wx.beginPath();
          wx.moveTo(s.trail[0].x, s.trail[0].y);
          for (const p of s.trail) wx.lineTo(p.x, p.y);
          wx.stroke();
        }
        if (s.state === "jump" && s.jump) { /* a thin dragline back to where it leapt from */
          wx.strokeStyle = "rgba(" + s.col + "," + 0.18 * al + ")";
          wx.lineWidth = 1 * DPR;
          wx.setLineDash([2 * DPR, 5 * DPR]);
          wx.beginPath();
          wx.moveTo(s.jump.x0, s.jump.y0);
          wx.lineTo(s.x, s.y);
          wx.stroke();
          wx.setLineDash([]);
        }
        s.feet = [];
        spider(wx, s.x, s.y, 1.8 * DPR * s.scale, s.col, 0.82 * al, s.leg, s.ang, s.dot, s.feet);
      }
      wx.restore();
      if (animate) highlightUnderfoot();
    }

    function probe(px: number, py: number): HTMLElement | null {
      const sx = (px - SCX) / DPR, sy = (py - SCY) / DPR;
      if (sx < 0 || sy < 0 || sx > innerWidth || sy > innerHeight) return null;
      const el = document.elementFromPoint(sx, sy) as HTMLElement | null;
      if (!el) return null;
      // the crawl screen is walked too; only its command bar, the card lightbox and the nav are off limits
      if (el.closest(".ovtop") || el.closest("#share") || el.closest("nav")) return null;
      return el.classList && el.classList.contains("w")
        ? el
        : (el.closest(".w,.btn,.sf,.crawler,.frow,.wrw,.lrw,.hud,.tag") as HTMLElement | null);
    }
    function highlightUnderfoot() {
      const now = performance.now();
      if (now - lastLit < 120) return;
      lastLit = now;
      for (const e of litEls) e.classList.remove("lit");
      litEls = [];
      BOXES = [];
      for (const s of SWARM) {
        if (s.fade < 0.45) continue;
        const pts: [number, number][] = [[s.x, s.y], ...(s.feet || [])];
        const seen = new Set<HTMLElement>();
        for (const [px, py] of pts) {
          const tgt = probe(px, py);
          if (!tgt || seen.has(tgt)) continue;
          if (tgt.closest(".heroart") || tgt.closest(".roomband")) continue;
          seen.add(tgt);
          tgt.classList.add("lit");
          tgt.style.setProperty("--litcol", "rgb(" + s.col + ")");
          litEls.push(tgt);
          /* the box the crawler draws around whatever it is reading */
          const r = tgt.getBoundingClientRect();
          if (r.width < 34) continue; /* skip the reticle on short words */
          BOXES.push({ x: (r.left + scrollX) * DPR, y: (r.top + scrollY) * DPR, w: r.width * DPR, h: r.height * DPR, col: s.col, sx: s.x, sy: s.y });
        }
      }
    }

    let raf = 0, lastT = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(60, t - lastT || 16);
      lastT = t;
      if (document.hidden) return;
      stepSwarm(t, dt);
      drawWeb(t, true);
    };
    if (!still) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(seedTimer);
      clearInterval(dhTimer);
      removeEventListener("resize", onResize);
      removeEventListener("scroll", onScroll);
      for (const e of litEls) e.classList.remove("lit");
    };
  }, []);

  return <canvas id="web" ref={cvRef} aria-hidden="true" />;
}
