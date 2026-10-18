import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import Footer from "@/components/Footer";
import { indexConfigured, readRadar, type RadarRow } from "@engine/chain/history.js";
import "@/lib/server";

// the radar is read again every two minutes on the server; the page follows
export const revalidate = 60;

export const metadata: Metadata = {
  title: "JUMPER · radar",
  description: "Fresh Pons launches whose buyers are staying: the last three hours, read off the trade index.",
};

const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const usd = (x: number | null) => (x == null ? "n/a" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`);
const age = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

export default async function RadarPage() {
  const data = indexConfigured() ? await readRadar().catch(() => null) : null;
  const rows: RadarRow[] = data?.rows ?? [];
  const when = data?.at ? new Date(data.at * 1000).toISOString().slice(11, 16) : null;
  return (
    <div className="page radarpage">
      <nav>
        <div className="wrap nav">
          <Logo />
          <div className="tagline">radar · fresh launches</div>
          <div className="navlinks"><Link href="/">Back to the terminal</Link></div>
        </div>
      </nav>
      <div className="wrap">
        <h2>RADAR</h2>
        <p className="plede">
          Pons launches of the last three hours, fifteen minutes old or more, whose buyers are staying: thirty buyers or more,
          most of them still in, little taken in the first three blocks, no wallet over a tenth of the supply, the price within half of its peak.
          Read off the trade index every two minutes, bought minus sold per wallet; a full crawl sees transfers too.
          {when ? ` Updated ${when} UTC.` : ""} It describes what happened, it does not predict. Not financial advice.
        </p>
        <p className="psub">Alerts for each new one in Telegram: <a href="https://t.me/jumper_terminal_bot" target="_blank" rel="noopener">@jumper_terminal_bot</a>, send /radar on.</p>
        {!data && <p className="pempty">The radar did not answer. It comes back on the next read.</p>}
        {data && !rows.length && <p className="pempty">Nothing passes right now. Fresh launches are checked every two minutes.</p>}
        {rows.length > 0 && (
          <div className="rtable">
            <div className="rh"><span>token</span><span>age</span><span>buyers</span><span>still in</span><span>top wallet</span><span>first blocks</span><span>smart in</span><span>cap</span><span>from peak</span></div>
            {rows.map((r) => (
              <Link key={r.token} className="rr" href={`/?token=${r.token}`}>
                <b>${r.symbol}</b>
                <span className="d">{age(r.ageMin)}</span>
                <span>{r.buyers}</span>
                <span className="ok">{pct(r.kept)}</span>
                <span>{pct(r.top)}</span>
                <span>{pct(r.snipe)}</span>
                <span className={r.smartIn ? "ok" : "d"}>{r.smartIn}</span>
                <span>{usd(r.mcapUsd)}</span>
                <span className={r.fromPeak < -0.3 ? "bad" : "d"}>{pct(r.fromPeak)}</span>
              </Link>
            ))}
          </div>
        )}
        <p className="psub">Click a token to run the full crawl on it.</p>
      </div>
      <Footer />
    </div>
  );
}
