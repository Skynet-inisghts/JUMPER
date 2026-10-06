import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Report } from "../crawlers/types.js";
import { BANDS, bandOf } from "../score/scale.js";

/**
 * Share card: a 1080x1080 PNG for one report. The renderer is Gemhog's,
 * re-laid for the web scale:
 *
 *   logo in a ring of the band colour + ticker      score, glowing, scale key
 *   bar 1-35-70-100 with a white tick on the score
 *   three fact lines
 *   verdict plate with its subline
 *   JUMPER / Crawler terminal / domain / contract / run time       the mascot
 *   the bottom edge lit in the band colour
 *
 * The mascot is the one-pixel-per-cell sprite from assets/brand (generated
 * by mascot.py), scaled with nearest-neighbour: never redrawn here.
 */

export const SITE_HOST = process.env.JUMPER_SITE_HOST ?? "jumper-crawler.vercel.app";

const BG = "#07060A";
const PANEL = "#110D18";
const LINE = "#241B33";
const INK = "#D8D2E4";
const DIM = "#7E7490";
const SILK = "#B47CFF";

/** The repo's assets folder, from the CLI (repo root) or the site (web/). */
export function assetsDir(): string {
  const candidates = [process.env.JUMPER_ASSETS, join(process.cwd(), "assets"), join(process.cwd(), "..", "assets")].filter(Boolean) as string[];
  return candidates.find((d) => existsSync(join(d, "brand", "mark-cells.png"))) ?? candidates[1];
}

let fontsReady = false;
function registerFonts(): void {
  if (fontsReady) return;
  const dir = join(assetsDir(), "fonts");
  GlobalFonts.register(readFileSync(join(dir, "Tiny5-Regular.ttf")), "Tiny5");
  GlobalFonts.register(readFileSync(join(dir, "JetBrainsMono[wght].ttf")), "JBMono");
  fontsReady = true;
}

let mascot: Image | null = null;
async function mascotCells(): Promise<Image> {
  if (!mascot) mascot = await loadImage(readFileSync(join(assetsDir(), "brand", "mark-cells.png")));
  return mascot;
}

export interface CardOptions {
  /** Raw image bytes of the token logo; an initial in a dark circle when missing. */
  logo?: Buffer;
  /** Stamps SAMPLE across the card; only the sample path sets it. */
  sample?: boolean;
}

const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

export async function renderCard(r: Report, options: CardOptions = {}): Promise<Buffer> {
  registerFonts();
  const band = bandOf(r.score);
  const ACC = band.color;
  const W = 1080;
  const H = 1080;
  const M = 72;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // faint web in the background: a few long threads from the top corners
  ctx.strokeStyle = rgba(LINE, 0.9);
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(W, 0);
    ctx.lineTo(W - 140 - i * 120, H);
    ctx.stroke();
  }
  for (let r0 = 1; r0 <= 5; r0++) {
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const t = (i / 8) * (Math.PI / 2);
      const x = W - Math.sin(t) * r0 * 150;
      const y = Math.cos(t) * r0 * 150;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // the bottom edge lit in the band colour
  const glow = ctx.createLinearGradient(0, H - 260, 0, H);
  glow.addColorStop(0, rgba(ACC, 0));
  glow.addColorStop(1, rgba(ACC, 0.22));
  ctx.fillStyle = glow;
  ctx.fillRect(0, H - 260, W, 260);
  ctx.fillStyle = ACC;
  ctx.fillRect(0, H - 6, W, 6);

  // ---- header left: logo in a ring + ticker
  const LOGO = 120;
  const cx = M + LOGO / 2;
  const cy = M + LOGO / 2;
  let drewLogo = false;
  if (options.logo) {
    try {
      const img = await loadImage(options.logo);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, LOGO / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, M, M, LOGO, LOGO);
      ctx.restore();
      drewLogo = true;
    } catch { /* initial below */ }
  }
  if (!drewLogo) {
    ctx.fillStyle = PANEL;
    ctx.beginPath();
    ctx.arc(cx, cy, LOGO / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "64px Tiny5";
    ctx.fillStyle = DIM;
    ctx.textBaseline = "middle";
    const ch = (r.token.symbol[0] ?? "?").toUpperCase();
    ctx.fillText(ch, cx - ctx.measureText(ch).width / 2, cy + 4);
  }
  ctx.strokeStyle = ACC;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, LOGO / 2 + 7, 0, Math.PI * 2);
  ctx.stroke();

  // ---- header right: score with glow, scale key under it
  const scoreText = String(r.score);
  ctx.textBaseline = "alphabetic";
  ctx.font = "176px Tiny5";
  const sw = ctx.measureText(scoreText).width;
  const sx = W - M - sw;
  const sy = M + 140;
  ctx.save();
  ctx.shadowColor = rgba(ACC, 0.85);
  ctx.shadowBlur = 48;
  ctx.fillStyle = ACC;
  ctx.fillText(scoreText, sx, sy);
  ctx.restore();
  ctx.fillStyle = ACC;
  ctx.fillText(scoreText, sx, sy);

  ctx.font = "500 22px JBMono";
  let kx = W - M;
  const keyY = sy + 44;
  for (const b of [...BANDS].reverse()) {
    const label = b.band;
    const lw = ctx.measureText(label).width;
    kx -= lw;
    ctx.fillStyle = b.band === band.band ? b.color : "#4A4259";
    ctx.fillText(label, kx, keyY);
    kx -= 28;
    if (b !== BANDS[0]) {
      ctx.fillStyle = "#4A4259";
      ctx.fillText("·", kx + 8, keyY);
    }
  }

  // ticker, shrunk in whole Tiny5 steps so it never runs into the score
  const tx = M + LOGO + 40;
  const limit = sx - 40;
  ctx.textBaseline = "middle";
  ctx.font = "700 64px JBMono";
  ctx.fillStyle = ACC;
  ctx.fillText("$", tx, cy);
  const tx2 = tx + ctx.measureText("$").width + 6;
  const ticker = r.token.symbol.toUpperCase();
  let size = 96;
  ctx.font = `${size}px Tiny5`;
  while (size > 40 && tx2 + ctx.measureText(ticker).width > limit) {
    size -= 8;
    ctx.font = `${size}px Tiny5`;
  }
  ctx.fillStyle = INK;
  ctx.fillText(ticker, tx2, cy);

  // ---- the bar: zones 1-35-70-100, a white tick on the score
  const by = M + LOGO + 120;
  const bw = W - 2 * M;
  const zones: [number, number, string][] = [[0, 35, BANDS[0].color], [35, 70, BANDS[1].color], [70, 100, BANDS[2].color]];
  for (const [lo, hi, col] of zones) {
    ctx.fillStyle = rgba(col, col === ACC ? 0.9 : 0.25);
    ctx.fillRect(M + (bw * lo) / 100, by, (bw * (hi - lo)) / 100 - 4, 12);
  }
  const mx = M + (bw * Math.max(0, Math.min(100, r.score))) / 100;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(mx - 3, by - 12, 6, 36);
  ctx.font = "400 20px JBMono";
  ctx.fillStyle = "#4A4259";
  ctx.textBaseline = "top";
  ctx.fillText("1", M, by + 26);
  ctx.fillText("35", M + bw * 0.35 - ctx.measureText("35").width / 2, by + 26);
  ctx.fillText("70", M + bw * 0.7 - ctx.measureText("70").width / 2, by + 26);
  ctx.fillText("100", M + bw - ctx.measureText("100").width, by + 26);

  // ---- three fact lines
  ctx.font = "400 30px JBMono";
  ctx.fillStyle = INK;
  let ty = by + 92;
  for (const line of r.facts) {
    ctx.fillText(capLine(line, ctx, W - 2 * M), M, ty);
    ty += 46;
  }

  // ---- verdict plate
  const py = ty + 26;
  ctx.font = "400 22px JBMono";
  const sublineW = ctx.measureText(`${r.band} · ${r.subline}`).width;
  ctx.font = "44px Tiny5";
  const plateW = Math.min(W - 2 * M - 300, Math.max(520, sublineW + 64, ctx.measureText(r.verdict).width + 64));
  ctx.fillStyle = rgba(ACC, 0.1);
  ctx.fillRect(M, py, plateW, 108);
  ctx.strokeStyle = ACC;
  ctx.lineWidth = 2;
  ctx.strokeRect(M + 1, py + 1, plateW - 2, 106);
  ctx.fillStyle = ACC;
  ctx.fillRect(M, py, 8, 108);
  ctx.font = "44px Tiny5";
  ctx.fillText(r.verdict, M + 32, py + 16);
  ctx.font = "400 22px JBMono";
  ctx.fillStyle = DIM;
  ctx.fillText(`${r.band} · ${r.subline}`, M + 32, py + 70);

  // ---- the mascot, bottom right, glowing in the band colour
  const cells = await mascotCells();
  const PX = 17;
  const MW = 24 * PX;
  const mxl = W - M - MW + 30;
  const myt = H - MW - 40;
  ctx.save();
  ctx.shadowColor = rgba(ACC, 0.7);
  ctx.shadowBlur = 70;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cells, mxl, myt, MW, MW);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(cells, mxl, myt, MW, MW);
  ctx.imageSmoothingEnabled = true;

  if (options.sample) {
    ctx.save();
    ctx.translate(mxl + MW / 2, myt + MW / 2);
    ctx.rotate(-0.22);
    ctx.font = "80px Tiny5";
    const dw = ctx.measureText("SAMPLE").width;
    ctx.fillStyle = "rgba(7,6,10,0.7)";
    ctx.fillRect(-dw / 2 - 20, -56, dw + 40, 112);
    ctx.strokeStyle = ACC;
    ctx.lineWidth = 4;
    ctx.strokeRect(-dw / 2 - 20, -56, dw + 40, 112);
    ctx.fillStyle = ACC;
    ctx.textBaseline = "middle";
    ctx.fillText("SAMPLE", -dw / 2, 6);
    ctx.restore();
  }

  // ---- signature, bottom left
  ctx.textBaseline = "alphabetic";
  const base = H - M - 8;
  ctx.font = "60px Tiny5";
  ctx.fillStyle = INK;
  ctx.fillText("JUM", M, base - 118);
  const jw = ctx.measureText("JUM").width;
  ctx.fillStyle = SILK;
  ctx.fillText("PER", M + jw, base - 118);
  ctx.font = "400 26px JBMono";
  ctx.fillStyle = DIM;
  ctx.fillText("Crawler terminal", M, base - 80);
  ctx.font = "400 22px JBMono";
  ctx.fillText(SITE_HOST, M, base - 46);
  ctx.fillStyle = "#4A4259";
  ctx.fillText(`${r.token.address.slice(0, 10)}…${r.token.address.slice(-8)}`, M, base - 16);
  ctx.fillText(`${r.provenance.observedAt.slice(0, 16).replace("T", " ")} UTC`, M, base + 14);

  return canvas.toBuffer("image/png");
}

function capLine(line: string, ctx: SKRSContext2D, max: number): string {
  if (ctx.measureText(line).width <= max) return line;
  let s = line;
  while (s.length > 10 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
