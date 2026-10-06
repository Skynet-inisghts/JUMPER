/* eslint-disable @next/next/no-img-element -- pixel sprites, rendered with image-rendering: pixelated */
import Words from "./Words";
import { CREW, type Report } from "@/lib/util";

const DESC = [
  "Pulls every transfer and lays the holders out, parent to child, first buyer to last.",
  "Walks the graph backwards and marks every wallet no longer holding, with what it took out.",
  "Flags everything taken in the first three blocks, before a human could read the ticker.",
  "Follows each holder into every other pons token and scores them on closed trades.",
  "Looks for wallets funded by the same source within minutes of each other.",
  "Weighted average cost per wallet. Bought, sold, what is left, what it is worth now.",
  "Dust under $50, transfers in with no cost basis, wallets whose first trade is this one.",
  "Collapses everything the swarm found into one score and one verdict.",
];

export default function Crawlers({ report, label }: { report: Report | null; label: string | null }) {
  return (
    <section id="crawlers">
      <div className="wrap">
        <h2>Eight crawlers, one web</h2>
        <p className="sechead">
          <Words text="Each spider walks one surface of the token and hands what it found to the next. They run at the same time and print as they go, so nothing is a black box." />
          {label && <span className="replay">{label}</span>}
        </p>
        <div className="crawlers">
          {CREW.map((c, i) => {
            const st = report?.crawlers.find((x) => x.name === c.n)?.stats ?? ["", ""];
            return (
              <div className="crawler" key={c.n}>
                <div className="pic">
                  <div className="silk" />
                  <img src={c.spr} alt={`${c.n} crawler`} style={{ animationDelay: `${i * 0.35}s` }} />
                </div>
                <div className="nm"><Words text={c.n} /></div>
                <div className="ro" style={{ color: `rgb(${c.col})` }}>{c.r}</div>
                <div className="ds"><Words text={DESC[i]} /></div>
                <div className="st"><span><b>{st[0] || "..."}</b></span><span><b>{st[1] || "..."}</b></span></div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
