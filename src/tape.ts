import type { Tape } from "./crawlers/types.js";

/**
 * A Tape as JSON. Big integers travel as "123n" strings so a fixture keeps
 * every wei exact; everything else is plain JSON.
 */

export function tapeToJson(tape: Tape): string {
  return JSON.stringify(tape, (_k, v) => (typeof v === "bigint" ? `${v.toString()}n` : v));
}

export function tapeFromJson(text: string): Tape {
  return JSON.parse(text, (_k, v) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v)) as Tape;
}
