import { knot } from "./knot.js";
import { ledger } from "./ledger.js";
import { oracle } from "./oracle.js";
import { scout } from "./scout.js";
import { sieve } from "./sieve.js";
import { snare } from "./snare.js";
import { track } from "./tracker.js";
import type { CrawlerName, Report, Tape } from "./types.js";
import { weave } from "./weaver.js";

/**
 * The eight crawlers in order, each handing its result to the next. Pure:
 * the same Tape always produces the same report body. Provenance (block,
 * time, call counts) is stamped by the live path around it.
 */
export function crawlTape(tape: Tape, onStep?: (name: CrawlerName) => void): Omit<Report, "provenance"> {
  const step = <T>(name: CrawlerName, fn: () => T): T => {
    const out = fn();
    onStep?.(name);
    return out;
  };
  const web = step("WEAVER", () => weave(tape));
  const tracked = step("TRACKER", () => track(tape, web));
  const snared = step("SNARE", () => snare(tape, web));
  const scouted = step("SCOUT", () => scout(tape, web));
  const knotted = step("KNOT", () => knot(tape, web));
  const books = step("LEDGER", () => ledger(tape, web));
  const sieved = step("SIEVE", () => sieve(tape, web, scouted, books));
  return step("ORACLE", () => oracle(tape, { web, tracked, snared, scouted, knotted, books, sieved }));
}
