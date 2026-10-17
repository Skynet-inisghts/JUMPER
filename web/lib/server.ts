import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { loadEnv } from "@engine/env.js";
import { crawl, CrawlTooLong, warmLogs, type CrawlEvent } from "@engine/crawl.js";
import { coalesce, reportTtlMs, TtlCache } from "@engine/web.js";
import type { Report } from "@engine/crawlers/types.js";

/**
 * Server-side state shared by the API routes of one instance: the report
 * cache and the hub that lets several callers watch one crawl.
 *
 * Local development keeps its keys in the repo root .env; next.config.ts
 * already parses it, this is the same read for processes that did not load
 * the config (process env always wins, nothing is printed).
 */
{
  const rootEnv = join(process.cwd(), "..", ".env");
  if (existsSync(rootEnv)) loadEnv(rootEnv);
}

/*
 * One copy per server process: route handlers are separate bundles, so the
 * shared state lives on globalThis rather than in this module's scope.
 */
const g = globalThis as unknown as { __jumper?: { reportCache: TtlCache<Report>; runs: Map<string, Run> } };


type Listener = (e: CrawlEvent) => void;

interface Run {
  listeners: Set<Listener>;
  promise: Promise<Report>;
}

const shared = (g.__jumper ??= { reportCache: new TtlCache<Report>(300), runs: new Map<string, Run>() });
export const reportCache = shared.reportCache;
const runs = shared.runs;

/**
 * A crawl answers inside 20 seconds: logs must be in by 15 s, KNOT gets
 * what is left. A token whose history does not fit is read on in the same
 * request, into the log cache, and crawled again from it: the caller waits
 * longer and still gets a report. Only a history that does not fit the
 * function at all ends in an error; the crawl route reads on after it.
 */
const CRAWL_BUDGET_MS = 15_000;
const CRAWL_FINISH_MS = 19_000;
const LONG_READ_MS = 220_000;
const LONG_BUDGET_MS = 30_000;
const LONG_FINISH_MS = 36_000;

/**
 * Start a crawl for `token` or join the one already running. A listener
 * that joins late sees events from the moment it joined; everyone gets the
 * same final report. Finished reports land in the cache with the engine's
 * age-aware TTL.
 */
export function crawlShared(token: Address, listener?: Listener): { promise: Promise<Report>; started: boolean; leave: () => void } {
  const key = token.toLowerCase();
  let run = runs.get(key);
  let started = false;
  if (!run) {
    started = true;
    const listeners = new Set<Listener>();
    const fresh: Run = {
      listeners,
      promise: coalesce(`crawl:${key}`, async () => {
        try {
          const emit = (e: CrawlEvent) => {
            for (const l of listeners) {
              try {
                l(e);
              } catch {
                /* a closed stream must not break the crawl */
              }
            }
          };
          let report: Report;
          try {
            ({ report } = await crawl(token, emit, { budgetMs: CRAWL_BUDGET_MS, finishMs: CRAWL_FINISH_MS }));
          } catch (error) {
            if (!(error instanceof CrawlTooLong)) throw error;
            emit({ type: "stage", crawler: "WEAVER", state: "running", detail: `$${error.symbol} has a long history, reading all of it once` });
            await warmLogs(token, (done, total, n) => emit({ type: "progress", crawler: "WEAVER", done, total, detail: `${n} transfers` }), LONG_READ_MS);
            ({ report } = await crawl(token, emit, { budgetMs: LONG_BUDGET_MS, finishMs: LONG_FINISH_MS }));
          }
          reportCache.set(key, report, reportTtlMs(report.token.ageSec));
          return report;
        } finally {
          runs.delete(key);
        }
      }),
    };
    run = fresh;
    runs.set(key, fresh);
  }
  if (listener) run.listeners.add(listener);
  const r = run;
  return { promise: r.promise, started, leave: () => { if (listener) r.listeners.delete(listener); } };
}

export const cachedReport = (token: string): Report | undefined => reportCache.get(token.toLowerCase());
