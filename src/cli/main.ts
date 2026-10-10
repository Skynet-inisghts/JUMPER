import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import type { Address } from "viem";
import { loadEnv } from "../env.js";
import { VERSION } from "../version.js";

/**
 * The CLI is a thin shell over the engine: `jumper <ca>` crawls one token
 * and prints the report; --card adds the PNG in ./out, --json prints the
 * machine form. Read only: no keys are needed and nothing is ever signed.
 */

const FORMATS = ["text", "json", "markdown"] as const;

/** Print, or save exclusively: an export never overwrites an existing file. */
async function deliver(text: string, file?: string): Promise<void> {
  if (!file) {
    process.stdout.write(text + "\n");
    return;
  }
  try {
    await writeFile(file, text + "\n", { flag: "wx" });
    process.stderr.write(`saved to ${file}\n`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      process.stderr.write(`jumper: ${file} already exists; exports refuse to overwrite\n`);
      process.exit(1);
    }
    throw error;
  }
}

async function resolveTarget(input: string): Promise<Address> {
  const { resolveInput } = await import("../chain/resolve.js");
  const r = await resolveInput(input);
  if (r.token) return r.token;
  if (r.kind === "cluster") {
    process.stderr.write(`${r.note}\n`);
    for (const c of r.cluster) process.stderr.write(`  ${c.token}  $${c.symbol}  ${c.name}\n`);
    process.exit(1);
  }
  process.stderr.write(`jumper: ${r.note ?? "nothing found"}\n`);
  process.exit(1);
}

async function writeCard(report: import("../crawlers/types.js").Report, dir: string, sample = false): Promise<string> {
  const { renderCard } = await import("../card/card.js");
  const { fetchTokenLogo } = await import("../chain/logo.js");
  const logo = sample ? null : await fetchTokenLogo(report.token.address as Address);
  const png = await renderCard(report, { logo: logo ?? undefined, sample });
  await mkdir(dir, { recursive: true });
  const stamp = report.provenance.observedAt.slice(0, 19).replace(/[-:T]/g, "");
  const file = join(dir, `jumper-${report.token.symbol.replace(/[^A-Za-z0-9]/g, "") || "token"}-${stamp}.png`);
  await writeFile(file, png);
  return file;
}

const program = new Command();
/** A terminal has no function limit: KNOT may wait on the explorer longer than on the site. */
const CLI_KNOT_BUDGET_MS = 25_000;

program
  .name("jumper")
  .description("Crawler terminal for Pons v2 tokens on Robinhood Chain. It can jump over any token. Read only: no keys, no signing, no transactions.")
  .version(VERSION);

program
  .command("crawl <target>", { isDefault: true })
  .description("send the swarm down one token (contract address or $TICKER)")
  .option("--card", "also render the 1080x1080 share card into ./out")
  .option("--json", "print the machine form (same as --format json)")
  .option("--format <format>", "text, json or markdown", "text")
  .option("--output <file>", "save the report; never overwrites an existing file")
  .option("--tape <file>", "also save the raw tape the crawlers read (for fixtures)")
  .action(async (target: string, opts: { card?: boolean; json?: boolean; format: string; output?: string; tape?: string }) => {
    loadEnv();
    const format = opts.json ? "json" : opts.format;
    if (!FORMATS.includes(format as (typeof FORMATS)[number])) {
      process.stderr.write("jumper: use --format text, json or markdown\n");
      process.exit(1);
    }
    const token = await resolveTarget(target);
    const { crawl, CrawlError } = await import("../crawl.js");
    const interactive = format === "text" && !opts.output && process.stderr.isTTY;
    let result;
    try {
      result = await crawl(token, (e) => {
        if (!interactive) return;
        if (e.type === "stage" && e.state === "done") process.stderr.write(`  ${e.crawler.padEnd(8)} done${e.detail ? ` · ${e.detail}` : ""}\n`);
        if (e.type === "progress") process.stderr.write(`  ${e.crawler.padEnd(8)} ${Math.round((e.done / e.total) * 100)}% · ${e.detail ?? ""}\r`);
      }, { knotBudgetMs: CLI_KNOT_BUDGET_MS });
    } catch (error) {
      if (error instanceof CrawlError) {
        process.stderr.write(`jumper: ${error.message}\n`);
        process.exit(1);
      }
      throw error;
    }
    const { report, tape } = result;
    if (opts.tape) {
      const { tapeToJson } = await import("../tape.js");
      await writeFile(opts.tape, tapeToJson(tape), { flag: "wx" });
      process.stderr.write(`tape saved to ${opts.tape}\n`);
    }
    const { renderText, renderMarkdown } = await import("../report.js");
    const text = format === "json" ? JSON.stringify(report, null, 2) : format === "markdown" ? renderMarkdown(report) : renderText(report, !opts.output && process.stdout.isTTY);
    await deliver(text, opts.output);
    if (opts.card) {
      const file = await writeCard(report, join(process.cwd(), "out"));
      process.stderr.write(`card saved to ${file}\n`);
    }
  });

program
  .command("replay <tape>")
  .description("run the crawlers over a saved tape: no network, same code as a live crawl")
  .option("--format <format>", "text, json or markdown", "text")
  .option("--card", "also render the card into ./out (stamped SAMPLE)")
  .action(async (file: string, opts: { format: string; card?: boolean }) => {
    const { tapeFromJson } = await import("../tape.js");
    const { crawlTape } = await import("../crawlers/pipeline.js");
    const tape = tapeFromJson(await readFile(file, "utf8"));
    const body = crawlTape(tape);
    const report = {
      ...body,
      provenance: {
        block: tape.headBlock, observedAt: new Date(tape.now * 1000).toISOString(), rpcCalls: 0, ms: 0,
        sources: [...tape.sources, "tape replay"], partial: !tape.logsComplete, indexTip: tape.history ? tape.historyTip : null,
        fundingRead: `${tape.fundingRead ?? tape.funding.length} of ${tape.fundingAsked}`,
      },
    };
    const { renderText, renderMarkdown } = await import("../report.js");
    process.stdout.write((opts.format === "json" ? JSON.stringify(report, null, 2) : opts.format === "markdown" ? renderMarkdown(report) : renderText(report, process.stdout.isTTY)) + "\n");
    if (opts.card) process.stderr.write(`card saved to ${await writeCard(report, join(process.cwd(), "out"), true)}\n`);
  });

program
  .command("doctor")
  .description("check every source: RPC endpoints, pons factory, wallet index, explorer, prices")
  .action(async () => {
    loadEnv();
    const { runDoctor } = await import("../doctor.js");
    const ok = await runDoctor((line) => process.stdout.write(line + "\n"));
    if (!ok) process.exitCode = 2;
  });

program.parseAsync(process.argv).catch((error) => {
  process.stderr.write(`jumper: ${(error as Error).message}\n`);
  process.exit(1);
});
