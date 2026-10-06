import type { Report } from "@engine/crawlers/types.js";
import { spider } from "./spider";
import { COH, ri, rnd } from "./util";

/* ---------- chain graph (ported from prototype.html) ---------- */
export const LAYER = ["CONTRACT", "TRANSACTIONS", "HOLDERS", "WALLET HISTORY"];
export const LX = [0.09, 0.33, 0.6, 0.86];

export type NodeState = "raw" | "hold" | "smart" | "snipe" | "gone";
export interface GNode { x: number; y: number; k: "contract" | "tx" | "holder" | "hist"; r: number; st: NodeState }
export interface Graph { nodes: GNode[]; links: [number, number][] }
export interface Bug { li: number; t: number; v: number; tag: NodeState; leg: number }

/** The shape the swarm walks while the real crawl runs; uncoloured until crawlers reach a node. */
export function buildChain(txN: number, perTx: [number, number]): Graph {
  const nodes: GNode[] = [], links: [number, number][] = [];
  nodes.push({ x: LX[0], y: 0.5, k: "contract", r: 7, st: "raw" });
  const txIdx: number[] = [];
  for (let i = 0; i < txN; i++) {
    nodes.push({ x: LX[1] + rnd(-0.012, 0.012), y: 0.14 + i * (0.72 / (txN - 1)), k: "tx", r: 4, st: "raw" });
    txIdx.push(nodes.length - 1);
    links.push([0, nodes.length - 1]);
  }
  const hIdx: number[] = [];
  txIdx.forEach((ti) => {
    const n = ri(perTx[0], perTx[1]);
    for (let j = 0; j < n; j++) {
      nodes.push({ x: LX[2] + rnd(-0.025, 0.025), y: nodes[ti].y + (j - (n - 1) / 2) * 0.047 + rnd(-0.008, 0.008), k: "holder", r: rnd(2.4, 4.2), st: "raw" });
      hIdx.push(nodes.length - 1);
      links.push([ti, nodes.length - 1]);
    }
  });
  hIdx.forEach((hi) => {
    if (Math.random() < 0.5) return;
    const n = ri(1, 3);
    for (let j = 0; j < n; j++) {
      nodes.push({ x: LX[3] + rnd(-0.03, 0.05), y: nodes[hi].y + (j - (n - 1) / 2) * 0.03 + rnd(-0.006, 0.006), k: "hist", r: rnd(1.5, 2.5), st: "raw" });
      links.push([hi, nodes.length - 1]);
    }
  });
  return { nodes, links };
}

const STATE: Record<string, NodeState> = { held: "hold", smart: "smart", sniper: "snipe", gone: "gone", neutral: "raw" };
const KIND: Record<string, GNode["k"]> = { contract: "contract", tx: "tx", holder: "holder", history: "hist" };

/** The report's own graph, laid out in the same four columns, coloured by what the crawl found. */
export function graphFromReport(g: Report["graph"]): Graph | null {
  if (!g || !g.nodes?.length) return null;
  const parent = new Map<number, number>();
  for (const [a, b] of g.links) if (!parent.has(b)) parent.set(b, a);
  const nodes: GNode[] = g.nodes.map((n) => {
    const k = KIND[n.kind] ?? "holder";
    const layer = Math.max(0, Math.min(3, n.layer));
    return {
      x: LX[layer] + (layer === 0 ? 0 : layer === 1 ? rnd(-0.012, 0.012) : layer === 2 ? rnd(-0.025, 0.025) : rnd(-0.03, 0.05)),
      y: 0.5,
      k,
      r: k === "contract" ? 7 : k === "tx" ? 4 : k === "holder" ? rnd(2.4, 4.2) : rnd(1.5, 2.5),
      st: STATE[n.state] ?? "raw",
    };
  });
  for (let layer = 1; layer <= 3; layer++) {
    const idx = g.nodes.map((n, i) => (n.layer === layer ? i : -1)).filter((i) => i >= 0);
    idx.sort((a, b) => (nodes[parent.get(a) ?? 0]?.y ?? 0.5) - (nodes[parent.get(b) ?? 0]?.y ?? 0.5) || a - b);
    const top = layer === 1 ? 0.14 : 0.1, bot = layer === 1 ? 0.86 : 0.9;
    idx.forEach((i, j) => {
      nodes[i].y = idx.length === 1 ? 0.5 : top + (j * (bot - top)) / (idx.length - 1);
    });
  }
  return { nodes, links: g.links.filter(([a, b]) => nodes[a] && nodes[b]) };
}

export function drawChain(
  ctx: CanvasRenderingContext2D, g: Graph, CW: number, CH: number, t: number, bugs: Bug[], labels: boolean, DPR: number, mono: string,
) {
  ctx.clearRect(0, 0, CW, CH);
  ctx.setLineDash([3 * DPR, 7 * DPR]);
  LX.forEach((x) => {
    ctx.strokeStyle = "rgba(180,124,255,.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x * CW, CH * 0.1);
    ctx.lineTo(x * CW, CH * 0.95);
    ctx.stroke();
  });
  ctx.setLineDash([]);
  if (labels) {
    ctx.font = 9.5 * DPR + "px " + mono;
    ctx.fillStyle = "rgba(126,116,144,.8)";
    ctx.textAlign = "center";
    LX.forEach((x, i) => ctx.fillText(LAYER[i], x * CW, CH * 0.06));
    ctx.textAlign = "left";
  }
  for (const [a, b] of g.links) {
    const A = g.nodes[a], B = g.nodes[b];
    const lit = B.st !== "raw";
    ctx.strokeStyle = lit ? "rgba(" + COH[B.st] + ",.34)" : "rgba(255,255,255,.06)";
    ctx.lineWidth = lit ? 1.3 : 0.8;
    const mx = (A.x + B.x) / 2;
    ctx.beginPath();
    ctx.moveTo(A.x * CW, A.y * CH);
    ctx.bezierCurveTo(mx * CW, A.y * CH, mx * CW, B.y * CH, B.x * CW, B.y * CH);
    ctx.stroke();
  }
  for (const n of g.nodes) {
    const c = COH[n.st];
    const pulse = 0.84 + 0.16 * Math.sin(t * 0.004 + n.y * 40);
    if (n.k === "contract") {
      ctx.fillStyle = "rgba(216,210,228,.95)";
      ctx.fillRect(n.x * CW - 5 * DPR, n.y * CH - 5 * DPR, 10 * DPR, 10 * DPR);
      ctx.strokeStyle = "rgba(180,124,255,.5)";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(n.x * CW - 9 * DPR, n.y * CH - 9 * DPR, 18 * DPR, 18 * DPR);
      continue;
    }
    ctx.fillStyle = "rgba(" + c + "," + (n.st === "raw" ? 0.24 : 0.95) + ")";
    if (n.k === "tx") {
      const r = n.r * DPR * pulse;
      ctx.fillRect(n.x * CW - r, n.y * CH - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(n.x * CW, n.y * CH, n.r * DPR * pulse, 0, 6.283);
      ctx.fill();
    }
    if (n.st === "smart") {
      ctx.strokeStyle = "rgba(" + c + ",.45)";
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(n.x * CW, n.y * CH, n.r * DPR * 2.5, 0, 6.283);
      ctx.stroke();
    }
  }
  for (const b of bugs) {
    const link = g.links[b.li];
    if (!link) continue;
    const A = g.nodes[link[0]], B = g.nodes[link[1]];
    const mx = (A.x + B.x) / 2, u = b.t, v = 1 - u;
    const px = (v * v * v * A.x + 3 * v * v * u * mx + 3 * v * u * u * mx + u * u * u * B.x) * CW;
    const py = (v * v * v * A.y + 3 * v * v * u * A.y + 3 * v * u * u * B.y + u * u * u * B.y) * CH;
    spider(ctx, px, py, 1.2 * DPR, COH[b.tag], 0.85, t * 0.011 + b.leg, b.leg * 0.3, "255,209,102");
  }
}
