import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import Footer from "@/components/Footer";
import proof from "@/sample/proof.json";

export const metadata: Metadata = {
  title: "JUMPER · proof",
  description: "Backtest: what JUMPER said about Pons launches two hours in, next to what their price did afterwards.",
};

interface Row {
  token: string; symbol: string; launchedAt: number; score: number; band: string; verdict: string;
  holdersAtCut: number; peakX: number; changeNow: number;
}
interface Stat { n: number; fell90: number; reached2x: number }
interface Proof {
  cutMin: number; generatedAt: string; tested: number; skipped: number;
  bands: Record<"TORN" | "PATCHED" | "TAUT", Stat>; rugs: Row[]; gems: Row[]; rows: Row[];
}

const data = proof as unknown as Proof;
const BAND: Record<string, string> = { TORN: "bad", PATCHED: "mid", TAUT: "ok" };
const pct = (a: number, n: number) => (n ? Math.round((a / n) * 100) + "%" : "n/a");
const when = (s: number) => new Date(s * 1000).toISOString().slice(5, 16).replace("T", " ");
const change = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x)}%`;

function Table({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <p className="pempty">{empty}</p>;
  return (
    <div className="ptable">
      <div className="ph"><span>token</span><span>launched</span><span>at {data.cutMin} min</span><span>holders then</span><span>peak after</span><span>now</span></div>
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

export default function ProofPage() {
  const b = data.bands;
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
          A backtest on {data.tested} real Pons launches: the busiest of the last three days by wallets, each old enough to show what came after.
          For every token the chain was cut {data.cutMin} minutes after its launch and the swarm ran on what was there, with the wallet
          index left out so nothing from after the cut leaks in. Next to that verdict: the highest price after the cut, and the price now.
          Run {data.generatedAt.slice(0, 16).replace("T", " ")} UTC. It measures the past, it does not predict. Not financial advice.
        </p>

        <div className="pstats">
          {(["TORN", "PATCHED", "TAUT"] as const).map((k) => (
            <div key={k} className={"pstat " + BAND[k]}>
              <b>{k}</b>
              <span>{b[k].n} tokens at {data.cutMin} min</span>
              <span><i>{pct(b[k].fell90, b[k].n)}</i> fell 90% or more by now</span>
              <span><i>{pct(b[k].reached2x, b[k].n)}</i> reached 2x after</span>
            </div>
          ))}
        </div>

        <h3>Rug replay</h3>
        <p className="psub">Called TORN at {data.cutMin} minutes, down 90% or more since.</p>
        <Table rows={data.rugs} empty="none in this run" />

        <h3>Gem replay</h3>
        <p className="psub">Called PATCHED or TAUT at {data.cutMin} minutes, then went 2x or more.</p>
        <Table rows={data.gems} empty="none in this run" />

        <details className="pall">
          <summary>every token tested ({data.rows.length})</summary>
          <Table rows={[...data.rows].sort((x, y) => x.score - y.score)} empty="" />
        </details>
      </div>
      <Footer />
    </div>
  );
}
