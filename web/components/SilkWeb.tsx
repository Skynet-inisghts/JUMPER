"use client";
import type { SilkNode } from "@engine/crawlers/types.js";
import { short } from "@/lib/util";

/**
 * The holders as a spider web. The token sits in the hub; the rings are
 * when a wallet came in (the sniper blocks, the first minute, ten minutes,
 * the first hour, later); each operator gets its own spoke and a yellow
 * silk thread through its wallets. A node is as big as its share; a wallet
 * that left is hollow, and the ring segment it sat on is torn: a web
 * that lost its holders looks it.
 */

const SPOKES = 24;
const RINGS = [0.22, 0.38, 0.54, 0.7, 0.86];
const RING_NAMES = ["sniper blocks", "first minute", "first 10 min", "first hour", "later"];

const colorOf = (n: SilkNode) =>
  n.roles.some((r) => r === "dev" || r === "insider" || r === "sniper") ? "var(--rd)"
  : n.roles.includes("smart") ? "var(--cy)"
  : n.roles.includes("bot") ? "var(--dm)"
  : n.roles.some((r) => r === "bundle" || r === "fresh" || r === "transfer") ? "var(--ye)"
  : "var(--ac)";

export default function SilkWeb({ nodes, symbol, onWallet }: { nodes: SilkNode[]; symbol: string; onWallet?: (n: SilkNode) => void }) {
  if (!nodes.length) return null;
  const S = 640, C = S / 2, R = S / 2 - 18;
  const angle = (k: number) => (k / SPOKES) * Math.PI * 2 - Math.PI / 2;
  const at = (k: number, r: number): [number, number] => [C + Math.cos(angle(k)) * r * R, C + Math.sin(angle(k)) * r * R];

  // operators first, each on its own spoke, spread round the web; then the rest by share
  const ops = [...new Set(nodes.filter((n) => n.op != null).map((n) => n.op as number))].sort((a, b) => a - b);
  const opSpoke = new Map<number, number>();
  ops.forEach((id, i) => opSpoke.set(id, Math.round((i * SPOKES) / Math.max(ops.length, 1) + i * 0.37) % SPOKES));
  const free = [...Array(SPOKES).keys()].filter((k) => ![...opSpoke.values()].includes(k));
  const placed: { n: SilkNode; x: number; y: number; k: number; r: number }[] = [];
  const crowd = new Map<string, number>();
  let rr = 0;
  const order = [...nodes].sort((a, b) => Math.max(b.share, b.peak) - Math.max(a.share, a.peak));
  for (const n of order) {
    const k = n.op != null ? opSpoke.get(n.op)! : free.length ? free[rr++ % free.length] : rr++ % SPOKES;
    const key = `${k}:${n.ring}`;
    const i = crowd.get(key) ?? 0;
    crowd.set(key, i + 1);
    // inside a ring band: step outwards and sideways so neighbours do not sit on each other
    const band = (n.ring < 4 ? RINGS[n.ring + 1] - RINGS[n.ring] : 0.1);
    const r = RINGS[n.ring] + band * (0.15 + ((i * 0.27) % 0.7));
    const kk = k + (i % 2 ? 1 : -1) * Math.min(0.42, 0.14 * Math.ceil(i / 2));
    const [x, y] = at(kk, r);
    placed.push({ n, x, y, k, r });
  }

  // ring segments torn where a wallet that left sat
  const torn = new Set(placed.filter((p) => p.n.gone).map((p) => `${p.n.ring}:${p.k}`));
  const segs: { d: string; torn: boolean }[] = [];
  RINGS.forEach((rad, ri) => {
    for (let k = 0; k < SPOKES; k++) {
      const [x1, y1] = at(k, rad), [x2, y2] = at(k + 1, rad);
      segs.push({ d: `M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}`, torn: torn.has(`${ri}:${k}`) });
    }
  });

  const threads = ops.map((id) => {
    const pts = placed.filter((p) => p.n.op === id).sort((a, b) => a.r - b.r);
    const [hx, hy] = at(opSpoke.get(id)!, 0.1);
    return { id, d: `M${hx.toFixed(1)},${hy.toFixed(1)} ` + pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") };
  });

  const size = (p: SilkNode) => 3 + Math.sqrt(Math.max(p.share, p.gone ? p.peak : 0)) * 6;
  const held = nodes.filter((n) => !n.gone).length;
  const gone = nodes.length - held;

  return (
    <div className="silkweb">
      <div className="sh">
        <b>the web</b>
        <span>{held} biggest holders, {gone} biggest wallets that left · rings: when they came in · yellow silk: one operator · a torn ring: someone left from there</span>
      </div>
      <div className="sb">
        <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Holder web of $${symbol}`}>
          {[...Array(SPOKES).keys()].map((k) => {
            const [x, y] = at(k, 1);
            return <line key={k} x1={C} y1={C} x2={x} y2={y} stroke="var(--ln2)" strokeWidth="0.8" />;
          })}
          {segs.map((s, i) => (
            <path key={i} d={s.d} stroke={s.torn ? "var(--rd)" : "var(--ln2)"} strokeWidth={s.torn ? 1 : 0.9} strokeDasharray={s.torn ? "3 9" : undefined} opacity={s.torn ? 0.8 : 1} />
          ))}
          {RINGS.map((rad, i) => {
            const [x, y] = at(SPOKES * 0.25 - 0.5, rad);
            return <text key={i} x={x + 4} y={y - 4} className="rl">{RING_NAMES[i]}</text>;
          })}
          {threads.map((t) => <path key={t.id} d={t.d} fill="none" stroke="var(--ye)" strokeWidth="2.2" opacity="0.75" />)}
          <circle cx={C} cy={C} r={R * 0.1} fill="var(--bg2)" stroke="var(--ac)" strokeWidth="1.5" />
          <text x={C} y={C + 5} textAnchor="middle" className="hub">${symbol.slice(0, 8)}</text>
          {placed.map(({ n, x, y }) => {
            const col = colorOf(n);
            const label = `${n.wallet}\\n${n.gone ? `left, peak ${n.peak.toFixed(2)}%` : `${n.share.toFixed(2)}% of supply`} · ${RING_NAMES[n.ring]}${n.op != null ? ` · op ${n.op}` : ""}${n.roles.length ? ` · ${n.roles.join(", ")}` : ""}`;
            return (
              <g key={n.wallet} className={onWallet ? "nd click" : "nd"} onClick={onWallet ? () => onWallet(n) : undefined}>
                <title>{label.replace("\\n", " · ")}</title>
                <circle cx={x} cy={y} r={size(n)} fill={n.gone ? "none" : col} fillOpacity={n.gone ? 0 : 0.85} stroke={col} strokeWidth={n.gone ? 1.4 : 1} strokeDasharray={n.gone ? "2 2" : undefined} />
              </g>
            );
          })}
        </svg>
        <div className="sl">
          <span><i style={{ background: "var(--rd)" }} />dev, insider, sniper</span>
          <span><i style={{ background: "var(--cy)" }} />smart money</span>
          <span><i style={{ background: "var(--ye)" }} />bundle, fresh, transfer</span>
          <span><i style={{ background: "var(--ac)" }} />trader, holder</span>
          <span><i className="hollow" />left the token</span>
          <span><i className="thread" />operator</span>
          {placed.filter((p) => p.n.op != null).length > 0 && <em>{ops.length} operator{ops.length === 1 ? "" : "s"} on their own spokes</em>}
          <em>biggest: {short(order[0].wallet)}</em>
        </div>
      </div>
    </div>
  );
}
