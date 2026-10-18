import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import Footer from "@/components/Footer";
import { loadProof } from "@/lib/proof";

// the backtest rolls on by itself; the page reads it again every ten minutes
export const revalidate = 600;

export const metadata: Metadata = {
  title: "JUMPER · proof",
  description: "Backtest: what JUMPER said about Pons launches two hours in, next to what their price did afterwards.",
};

interface Row {
  token: string; symbol: string; launchedAt: number; score: number; band: string; verdict: string;
  holdersAtCut: number; peakX: number; changeNow: number;
}
interface Proof {
  cutMin: number; generatedAt: string; tested: number; skipped: number;
  rows: Row[];
}

const BAND: Record<string, string> = { TORN: "bad", PATCHED: "mid", TAUT: "ok" };
const pct = (a: number, n: number) => (n ? Math.round((a / n) * 100) + "%" : "n/a");
const when = (s: number) => new Date(s * 1000).toISOString().slice(5, 16).replace("T", " ");
const change = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x)}%`;

function Table({ rows, empty, cutMin }: { rows: Row[]; empty: string; cutMin: number }) {
  if (!rows.length) return <p className="pempty">{empty}</p>;
  return (
    <div className="ptable">
      <div className="ph"><span>token</span><span>launched</span><span>at {cutMin / 60} h</span><span>holders then</span><span>peak after</span><span>now</span></div>
      {rows.map((r) => (
        <a key={r.token} className="pr" href={`/?token=${r.token}`}>
          <b>${r.symbol}</b>
          <span className="d">{when(r.launchedAt)} UTC</span>
          <span className={BAND[r.band]}>{r.score} {r.band}</span>
          <span className="d">{r.holdersAtCut}</span>
          <span className={r.peakX >= 2 ? "ok" : "d"}>{r.peakX.toFixed(2)}x</span>
          <span className={r.changeNow <= -90 ? "bad" : r.changeNow >= 0 ? "ok" : "d"}>{change(r.changeNow)}</span>
        </a>
      ))}
    </div>
  );
}

const BANDS = ["TORN", "PATCHED", "TAUT"] as const;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
function shape(data: Proof) {
  const stats = BANDS.map((k) => {
    const rows = data.rows.filter((r) => r.band === k);
    return {
      k, n: rows.length,
      median: median(rows.map((r) => r.changeNow)),
      fell50: rows.filter((r) => r.changeNow <= -50).length,
      fell90: rows.filter((r) => r.changeNow <= -90).length,
      x2: rows.filter((r) => r.peakX >= 2).length,
    };
  });
  const rugs = data.rows.filter((r) => r.band === "TORN" && r.changeNow <= -50).sort((a, b) => a.changeNow - b.changeNow);
  const gems = data.rows.filter((r) => r.band !== "TORN" && r.peakX >= 2).sort((a, b) => b.peakX - a.peakX);
  const misses = data.rows.filter((r) => r.band !== "TORN" && r.changeNow <= -80).sort((a, b) => a.changeNow - b.changeNow);
  return { stats, rugs, gems, misses };
}

export default async function ProofPage() {
  const data = (await loadProof()) as unknown as Proof;
  const { stats, rugs, gems, misses } = shape(data);
  const cut = data.cutMin;
  return (
    <div className="page proofpage">
      <nav>
        <div className="wrap nav">
          <Logo />
          <div className="tagline">proof · backtest</div>
          <div className="navlinks"><Link href="/">Back to the terminal</Link></div>
        </div>
      </nav>
      <div className="wrap">
        <h2>PROOF</h2>
        <p className="plede">
          A backtest on {data.tested} real Pons launches: the busiest of the last days by wallets, each old enough to show what came after. New launches are added and the prices checked again every ten minutes.
          For every token the chain was cut {cut / 60} hours after its launch and the swarm ran on what was there, with the wallet
          index left out so nothing from after the cut leaks in. Next to that verdict: the highest price after the cut, and the price now.
          Updated {data.generatedAt.slice(0, 16).replace("T", " ")} UTC. It measures the past, it does not predict. Not financial advice.
        </p>

        <div className="pstats">
          {stats.map((b) => (
            <div key={b.k} className={"pstat " + BAND[b.k]}>
              <b>{b.k}</b>
              <span>{b.n} tokens at {cut / 60} hours</span>
              <span>median since then <i>{change(b.median)}</i></span>
              <span><i>{pct(b.fell50, b.n)}</i> fell 50% or more, <i>{pct(b.fell90, b.n)}</i> fell 90% or more</span>
              <span><i>{pct(b.x2, b.n)}</i> reached 2x</span>
            </div>
          ))}
        </div>

        <h3>Rug replay</h3>
        <p className="psub">Called TORN at {cut / 60} hours, down 50% or more since.</p>
        <Table rows={rugs} empty="none in this run" cutMin={cut} />

        <h3>Gem replay</h3>
        <p className="psub">Called PATCHED or TAUT at {cut / 60} hours, then went 2x or more.</p>
        <Table rows={gems} empty="none in this run" cutMin={cut} />

        <h3>Misses</h3>
        <p className="psub">Called PATCHED or TAUT at {cut / 60} hours, down 80% or more since. Shown so the rest can be trusted.</p>
        <Table rows={misses} empty="none in this run" cutMin={cut} />

        <details className="pall">
          <summary>every token tested ({data.rows.length})</summary>
          <Table rows={[...data.rows].sort((x, y) => x.score - y.score)} empty="" cutMin={cut} />
        </details>
      </div>
      <Footer />
    </div>
  );
}
