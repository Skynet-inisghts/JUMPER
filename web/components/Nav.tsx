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
        <a className="tgapp" href={BOT} target="_blank" rel="noopener noreferrer" aria-label="JUMPER bot on Telegram" title="JUMPER bot on Telegram">
          <svg viewBox="0 0 240 240" width="28" height="28" aria-hidden="true">
            <defs>
              <linearGradient id="tgapp" x1="0.5" y1="0" x2="0.5" y2="1">
                <stop offset="0" stopColor="#2AABEE" />
                <stop offset="1" stopColor="#229ED9" />
              </linearGradient>
            </defs>
            <circle cx="120" cy="120" r="120" fill="url(#tgapp)" />
            <path fill="#fff" d="M54.3 118.8c35-15.2 58.3-25.3 70-30.2 33.3-13.9 40.3-16.3 44.8-16.4 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.3 1.7 3.3.2 1 .4 3.1.2 4.7-1.8 19-9.6 65.1-13.6 86.3-1.7 9-5 12-8.2 12.3-7 .6-12.3-4.6-19-9-10.6-6.9-16.5-11.2-26.8-18-11.9-7.8-4.2-12.1 2.6-19.1 1.8-1.8 32.5-29.8 33.1-32.3.1-.3.1-1.5-.6-2.1-.7-.6-1.7-.4-2.5-.2-1.1.2-17.9 11.4-50.6 33.5-4.8 3.3-9.1 4.9-13 4.8-4.3-.1-12.5-2.4-18.7-4.4-7.5-2.4-13.5-3.7-13-7.9.3-2.2 3.3-4.4 8.9-6.7z" />
          </svg>
        </a>
        <button className="btn" onClick={onRun}>Run a crawl</button>
      </div>
    </nav>
  );
}
