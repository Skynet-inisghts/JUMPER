import Logo from "./Logo";

export const GITHUB = "https://github.com/Skynet-inisghts/JUMPER";
export const DOCS = "https://github.com/Skynet-inisghts/JUMPER#readme";

export default function Footer() {
  return (
    <footer>
      <div className="wrap frow2">
        <Logo small />
        <span>it can jump over any token · reads public state only · not financial advice</span>
        <div className="r">
          <a href={DOCS} target="_blank" rel="noopener noreferrer">Docs</a>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </div>
    </footer>
  );
}
