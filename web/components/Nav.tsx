import Logo from "./Logo";
import { DOCS } from "./Footer";

export default function Nav({ onRun }: { onRun: () => void }) {
  return (
    <nav>
      <div className="wrap nav">
        <Logo />
        <div className="tagline">pons v2 · chain 4663</div>
        <div className="navlinks">
          <a href="/radar">Radar</a>
          <a href="/map">Map</a>
          <a href="/exits">Exits</a>
          <a href="/clusters">Clusters</a>
          <a href="/dev">Dev check</a>
          <a href="/leaders">Leaders</a>
          <a href="/proof">Proof</a>
          <a href="#jumper">$JUMPER</a>
          <a href={DOCS} target="_blank" rel="noopener noreferrer">Docs</a>
        </div>
        <button className="btn" onClick={onRun}>Run a crawl</button>
      </div>
    </nav>
  );
}
