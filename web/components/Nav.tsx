import Logo from "./Logo";
import { DOCS, GITHUB } from "./Footer";

export default function Nav({ onRun }: { onRun: () => void }) {
  return (
    <nav>
      <div className="wrap nav">
        <Logo />
        <div className="tagline">pons v2 · chain 4663</div>
        <div className="navlinks">
          <a href="#crawlers">Crawlers</a>
          <a href="#feed">Live</a>
          <a href={DOCS} target="_blank" rel="noopener noreferrer">Docs</a>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
        <button className="btn" onClick={onRun}>Run a crawl</button>
      </div>
    </nav>
  );
}
