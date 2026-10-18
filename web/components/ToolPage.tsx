import Link from "next/link";
import Logo from "./Logo";
import Footer from "./Footer";

/** The frame of a standalone page (radar, map, exits, clusters, dev): its own nav back to the terminal. */
export default function ToolPage({ tagline, children }: { tagline: string; children: React.ReactNode }) {
  return (
    <div className="page toolpage">
      <nav>
        <div className="wrap nav">
          <Logo />
          <div className="tagline">{tagline}</div>
          <div className="navlinks">
            <Link href="/radar">Radar</Link>
            <Link href="/map">Map</Link>
            <Link href="/exits">Exits</Link>
            <Link href="/clusters">Clusters</Link>
            <Link href="/dev">Dev check</Link>
            <Link href="/leaders">Leaders</Link>
            <Link href="/">Terminal</Link>
          </div>
        </div>
      </nav>
      <div className="wrap">{children}</div>
      <Footer />
    </div>
  );
}

/** The top of a tool page: a live pill, the title, a line under it, fine print and a row of numbers. */
export function ToolHero({ live, title, lede, fine, nums, children }: {
  live?: string; title: string; lede: string; fine?: string;
  nums?: [string, React.ReactNode, string?][]; children?: React.ReactNode;
}) {
  return (
    <div className="thero">
      {live && <span className="tlive"><i />{live}</span>}
      <h1>{title}</h1>
      <p className="tlede">{lede}</p>
      {fine && <p className="tfine">{fine}</p>}
      {nums && (
        <div className="tnums">
          {nums.map(([k, v, cls]) => <div key={k}><span>{k}</span><b className={cls}>{v}</b></div>)}
        </div>
      )}
      {children}
    </div>
  );
}
