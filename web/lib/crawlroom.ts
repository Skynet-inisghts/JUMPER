import { drawChain, type Bug, type Graph } from "./chain";
import { CREW, rnd } from "./util";

/**
 * The crawl, staged as the room: the holder graph builds on the back wall
 * while the eight crawlers work at their desks. A desk is dark while its
 * crawler waits, lit with a live progress readout while it runs (and the
 * crawler runs errands to the wall), green with its result when done.
 * Geometry follows the research room in components/Room.tsx.
 */

export type DeskState = "queued" | "running" | "done";

export interface CrawlLive {
  passes: { state: DeskState; pct: number }[];
  /** The newest thing each crawler said, from the stream. */
  said: (string | undefined)[];
  /** Each crawler's two result lines once the report is in. */
  results: ([string, string] | undefined)[];
  graph: Graph | null;
  bugs: Bug[];
}

interface Crew {
  x: number; y: number; sc: number;
  state: "sit" | "go" | "back"; t: number; dur: number;
  fromX: number; fromY: number; toX: number; toY: number; step: number;
  ih: number; iw: number;
}

export function createCrawlRoom() {
  const imgs = CREW.map((c) => {
    const im = new Image();
    im.src = c.spr;
    return im;
  });
  const desks = CREW.map(() => ({ x: 0, y: 0, sc: 1, wallX: 0, wallY: 0, flash: 0 }));
  const crew: Crew[] = CREW.map(() => ({ x: 0, y: 0, sc: 1, state: "sit", t: 0, dur: rnd(800, 2600), fromX: 0, fromY: 0, toX: 0, toY: 0, step: rnd(0, 6), ih: 0, iw: 0 }));
  let bubbles: { i: number; text: string; born: number }[] = [];
  const lastSaid: (string | undefined)[] = [];
  let wall: HTMLCanvasElement | null = null;
  let placed = false;

  function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return function draw(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, live: CrawlLive, DPR: number, mono: string, animate: boolean) {
    ctx.clearRect(0, 0, W, H);
    const HOR = H * 0.5;

    /* wall and floor */
    let g = ctx.createLinearGradient(0, 0, 0, HOR);
    g.addColorStop(0, "#0B0812");
    g.addColorStop(1, "#151020");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HOR);
    g = ctx.createLinearGradient(0, HOR, 0, H);
    g.addColorStop(0, "#161123");
    g.addColorStop(1, "#07060C");
    ctx.fillStyle = g;
    ctx.fillRect(0, HOR, W, H - HOR);
    const VX = W * 0.5, VY = HOR - H * 0.08;
    ctx.strokeStyle = "rgba(180,124,255,.10)";
    ctx.lineWidth = 1;
    for (let i = -9; i <= 9; i++) {
      ctx.beginPath();
      ctx.moveTo(VX + i * W * 0.085, VY);
      ctx.lineTo(VX + i * W * 0.42, H);
      ctx.stroke();
    }
    for (let k = 1; k <= 6; k++) {
      const yy = HOR + Math.pow(k / 6, 1.9) * (H - HOR);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }

    /* the back-wall screen: the holder graph being woven */
    const sx = W * 0.14, sy = H * 0.035, sw = W * 0.72, sh = H * 0.4;
    ctx.fillStyle = "#05040A";
    ctx.fillRect(sx, sy, sw, sh);
    if (live.graph) {
      const gw = Math.round(sw - 8 * DPR), gh = Math.round(sh - 24 * DPR);
      if (!wall || wall.width !== gw || wall.height !== gh) {
        wall = document.createElement("canvas");
        wall.width = gw;
        wall.height = gh;
      }
      const wc = wall.getContext("2d");
      if (wc) {
        drawChain(wc, live.graph, gw, gh, t, live.bugs, true, DPR * 0.8, mono);
        ctx.drawImage(wall, sx + 4 * DPR, sy + 20 * DPR);
      }
    }
    ctx.strokeStyle = "#392B55";
    ctx.lineWidth = 2.4 * DPR;
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.font = 9 * DPR + "px " + mono;
    ctx.fillStyle = "rgba(126,116,144,.95)";
    ctx.fillText("HOLDER GRAPH / LIVE", sx + 10 * DPR, sy + 14 * DPR);
    const doneN = live.passes.filter((p) => p.state === "done").length;
    ctx.textAlign = "right";
    ctx.fillStyle = doneN === 8 ? "#7DF0C8" : "#B47CFF";
    ctx.fillText(`${doneN} / 8 crawlers done`, sx + sw - 10 * DPR, sy + 14 * DPR);
    ctx.textAlign = "left";
    const bl = ctx.createRadialGradient(W * 0.5, sy + sh, 10, W * 0.5, sy + sh, W * 0.55);
    bl.addColorStop(0, "rgba(180,124,255,.14)");
    bl.addColorStop(1, "rgba(180,124,255,0)");
    ctx.fillStyle = bl;
    ctx.fillRect(0, 0, W, H);

    /* desks, two rows of four */
    const ROWS = [{ n: 4, z: 0.2, sc: 0.85 }, { n: 4, z: 0.68, sc: 1.2 }];
    let idx = 0;
    for (const row of ROWS) {
      const yBase = HOR + Math.pow(row.z, 1.4) * (H - HOR) * 0.98;
      const spread = W * (0.2 + row.z * 0.26);
      for (let i = 0; i < row.n; i++, idx++) {
        const c = CREW[idx], D = desks[idx], P = live.passes[idx] ?? { state: "queued", pct: 0 };
        const cx = W * 0.5 + (i - (row.n - 1) / 2) * spread * 0.62;
        const dw = W * 0.12 * row.sc, dh = H * 0.05 * row.sc;
        ctx.fillStyle = "#120E1E";
        ctx.beginPath();
        ctx.moveTo(cx - dw * 0.52, yBase);
        ctx.lineTo(cx + dw * 0.52, yBase);
        ctx.lineTo(cx + dw * 0.62, yBase + dh);
        ctx.lineTo(cx - dw * 0.62, yBase + dh);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(180,124,255,.22)";
        ctx.lineWidth = 1 * DPR;
        ctx.stroke();
        const lit = P.state === "running" ? 0.9 : P.state === "done" ? 0.55 : 0.12;
        ctx.fillStyle = `rgba(${P.state === "done" ? "125,240,200" : c.col},${lit * 0.6})`;
        ctx.fillRect(cx - dw * 0.62, yBase + dh, dw * 1.24, 1.8 * DPR);

        /* the monitor: what this crawler is doing right now */
        const mw = dw * 1.02, mh = dh * 2.3, mx = cx - mw / 2, my = yBase - mh - 2 * DPR;
        if (animate) D.flash = Math.max(0, D.flash - 0.03);
        ctx.fillStyle = P.state === "queued" ? "#06050A" : "#08070E";
        ctx.fillRect(mx, my, mw, mh);
        const edge = P.state === "done" ? "125,240,200" : c.col;
        ctx.strokeStyle = `rgba(${edge},${P.state === "queued" ? 0.25 : 0.55 + D.flash * 0.45})`;
        ctx.lineWidth = (1 + D.flash) * DPR;
        ctx.strokeRect(mx, my, mw, mh);
        const F = Math.max(6 * DPR, mh * 0.12);
        ctx.font = "700 " + F + "px " + mono;
        ctx.fillStyle = `rgba(${c.col},${P.state === "queued" ? 0.45 : 1})`;
        ctx.fillText(c.n, mx + 4 * DPR, my + F + 2 * DPR);
        ctx.textAlign = "right";
        ctx.font = F * 0.9 + "px " + mono;
        ctx.fillStyle = P.state === "done" ? "#7DF0C8" : P.state === "running" ? "#D8D2E4" : "rgba(126,116,144,.6)";
        ctx.fillText(P.state === "running" ? `${Math.round(P.pct)}%` : P.state, mx + mw - 4 * DPR, my + F + 2 * DPR);
        ctx.textAlign = "left";
        const res = live.results[idx];
        ctx.font = F * 0.92 + "px " + mono;
        if (P.state === "done" && res) {
          ctx.fillStyle = "#D8D2E4";
          ctx.fillText(res[0], mx + 4 * DPR, my + F * 2.6);
          ctx.fillStyle = "rgba(126,116,144,.95)";
          ctx.fillText(res[1], mx + 4 * DPR, my + F * 3.7);
        } else if (P.state === "running") {
          const said = live.said[idx] ?? "";
          ctx.fillStyle = "rgba(216,210,228,.85)";
          ctx.fillText(said.length > 26 ? said.slice(0, 25) + "…" : said, mx + 4 * DPR, my + F * 2.6);
          /* a sweep line: the crawler is reading */
          const u = (t * 0.0007 + idx * 0.13) % 1;
          ctx.fillStyle = `rgba(${c.col},.5)`;
          ctx.fillRect(mx + 3 * DPR + u * (mw - 8 * DPR), my + F * 3.1, 2 * DPR, F * 0.9);
        } else if (P.state === "done") {
          ctx.fillStyle = "rgba(126,116,144,.95)";
          ctx.fillText(live.said[idx] ? (live.said[idx]!.length > 26 ? live.said[idx]!.slice(0, 25) + "…" : live.said[idx]!) : "done", mx + 4 * DPR, my + F * 2.6);
        } else {
          ctx.fillStyle = "rgba(126,116,144,.5)";
          ctx.fillText("waiting for its turn", mx + 4 * DPR, my + F * 2.6);
        }
        /* progress bar along the monitor's foot */
        ctx.fillStyle = "rgba(255,255,255,.06)";
        ctx.fillRect(mx + 4 * DPR, my + mh - 6 * DPR, mw - 8 * DPR, 2.4 * DPR);
        ctx.fillStyle = P.state === "done" ? "#7DF0C8" : `rgb(${c.col})`;
        ctx.fillRect(mx + 4 * DPR, my + mh - 6 * DPR, (mw - 8 * DPR) * Math.min(1, P.pct / 100), 2.4 * DPR);

        D.x = cx + dw * 0.52;
        D.y = yBase;
        D.sc = row.sc;
        D.wallX = sx + sw * (0.15 + 0.7 * (idx / 7));
        D.wallY = HOR - H * 0.02;
      }
    }

    /* the crew: queued ones doze, running ones work and run errands to the wall */
    for (let i = 0; i < crew.length; i++) {
      const s = crew[i], D = desks[i], P = live.passes[i] ?? { state: "queued", pct: 0 };
      if (!placed) { s.x = D.x; s.y = D.y; s.sc = D.sc; }
      const said = live.said[i];
      if (said && said !== lastSaid[i]) {
        lastSaid[i] = said;
        bubbles = bubbles.filter((b) => b.i !== i);
        bubbles.push({ i, text: said, born: performance.now() });
        D.flash = 1;
      }
      if (!animate) continue;
      s.t += 16;
      if (s.state === "sit") {
        s.x = D.x;
        s.y = D.y;
        s.sc = D.sc;
        s.step += P.state === "running" ? 0.3 : 0.04;
        if (P.state === "running" && s.t > s.dur && Math.random() < 0.02) {
          s.state = "go";
          s.t = 0;
          s.dur = rnd(500, 800);
          s.fromX = s.x; s.fromY = s.y;
          s.toX = D.wallX; s.toY = D.wallY;
        }
      } else {
        const u = Math.min(1, s.t / s.dur), e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        s.x = s.fromX + (s.toX - s.fromX) * e;
        s.y = s.fromY + (s.toY - s.fromY) * e - Math.sin(u * Math.PI) * H * 0.04;
        s.sc = s.state === "go" ? D.sc * (1 - 0.25 * e) : D.sc * (0.75 + 0.25 * e);
        s.step += 0.8;
        if (u >= 1) {
          if (s.state === "go") {
            s.state = "back";
            s.t = 0;
            s.fromX = s.x; s.fromY = s.y;
            s.toX = D.x; s.toY = D.y;
            D.flash = 1;
          } else {
            s.state = "sit";
            s.t = 0;
            s.dur = rnd(900, 2600);
          }
        }
      }
    }
    placed = true;
    const order = crew.map((_, i) => i).sort((a, b) => crew[a].y - crew[b].y);
    for (const i of order) {
      const s = crew[i], im = imgs[i], P = live.passes[i] ?? { state: "queued", pct: 0 };
      if (!im.complete || !im.naturalWidth) continue;
      const ih = H * 0.1 * s.sc, iw = ih * (im.naturalWidth / im.naturalHeight);
      s.ih = ih;
      s.iw = iw;
      const moving = s.state !== "sit";
      const bob = moving ? Math.abs(Math.sin(s.step)) * 5 * DPR : P.state === "running" ? Math.abs(Math.sin(s.step)) * 3 * DPR : Math.sin(t * 0.0012 + i) * 1.2 * DPR;
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.beginPath();
      ctx.ellipse(s.x + iw * 0.5, s.y + 2 * DPR, iw * 0.34, ih * 0.1, 0, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = P.state === "queued" && !moving ? 0.55 : 1;
      ctx.drawImage(im, s.x, s.y - ih - bob, iw, ih);
      ctx.globalAlpha = 1;
      if (P.state === "queued" && !moving) {
        /* dozing until its turn */
        ctx.fillStyle = "rgba(126,116,144,.7)";
        ctx.font = 9 * DPR + "px " + mono;
        const z = (t * 0.001 + i) % 3;
        ctx.globalAlpha = 1 - z / 3;
        ctx.fillText("z", s.x + iw * 0.85, s.y - ih - z * 6 * DPR);
        ctx.globalAlpha = 1;
      }
      if (moving) {
        ctx.strokeStyle = "rgba(" + CREW[i].col + ",.4)";
        ctx.lineWidth = 1 * DPR;
        ctx.setLineDash([3 * DPR, 5 * DPR]);
        ctx.beginPath();
        ctx.moveTo(s.fromX + iw * 0.5, s.fromY);
        ctx.lineTo(s.x + iw * 0.5, s.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    /* speech: the stream's newest line for each crawler, floating and fading */
    const now = performance.now();
    bubbles = bubbles.filter((b) => now - b.born < 3800);
    for (const b of bubbles) {
      const s = crew[b.i];
      const age = (now - b.born) / 3800;
      const a = age < 0.08 ? age / 0.08 : age > 0.8 ? (1 - age) / 0.2 : 1;
      ctx.font = 9 * DPR + "px " + mono;
      const txt = b.text.length > 44 ? b.text.slice(0, 43) + "…" : b.text;
      const tw = ctx.measureText(txt).width;
      const bx = Math.max(4 * DPR, Math.min(W - tw - 14 * DPR, s.x + s.iw * 0.5 - tw / 2 - 5 * DPR));
      const by = s.y - s.ih - 22 * DPR - age * 6 * DPR;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(7,6,12,.94)";
      rr(ctx, bx, by, tw + 10 * DPR, 15 * DPR, 3 * DPR);
      ctx.fill();
      ctx.strokeStyle = "rgba(" + CREW[b.i].col + ",.9)";
      ctx.lineWidth = 1 * DPR;
      ctx.stroke();
      ctx.fillStyle = "rgb(" + CREW[b.i].col + ")";
      ctx.fillText(txt, bx + 5 * DPR, by + 10.5 * DPR);
      ctx.globalAlpha = 1;
    }
  };
}
