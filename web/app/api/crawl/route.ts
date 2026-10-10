import { NextResponse, after } from "next/server";
import type { Address } from "viem";
import { cacheWritten, CrawlError, CrawlTooLong, warmLogs } from "@engine/crawl.js";
import { resolveInput } from "@engine/chain/resolve.js";
import { recordCrawl, indexConfigured } from "@engine/chain/history.js";
import { inBackground } from "@engine/chain/rpc.js";
import { clientIp, RateLimiter } from "@engine/web.js";
import { cachedReport, crawlShared } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/crawl { target } -> a Server-Sent Events stream.
 *
 *   event: resolved   { token }
 *   event: stage      { crawler, state, detail? }
 *   event: progress   { crawler, done, total, detail? }
 *   event: report     the full Report
 *   event: error      { message, candidates? }
 *
 * A cached report answers at once. Identical concurrent crawls share one
 * run; a late joiner sees events from the moment it joined.
 */

const limiter = new RateLimiter(6, 60_000);

/** Reading a long history after the answer stops short of the function's own limit. */
const WARM_BUDGET_MS = 280_000;

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

const sse = (body: ReadableStream<Uint8Array>) =>
  new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });

const once = (events: [string, unknown][]) =>
  sse(new ReadableStream({
    start(controller) {
      for (const [e, d] of events) controller.enqueue(frame(e, d));
      controller.close();
    },
  }));

export async function POST(request: Request) {
  let target = "";
  try {
    const body = (await request.json()) as { target?: unknown };
    target = String(body.target ?? "").trim();
  } catch {
    /* falls through to the empty-input error */
  }
  if (!target || target.length > 80) {
    return NextResponse.json({ error: "pass a token contract address or a $TICKER" }, { status: 400 });
  }

  // a cached address never costs a chain read, so it skips the bucket
  const quick = /^0x[0-9a-fA-F]{40}$/.test(target) ? cachedReport(target) : undefined;
  if (quick) return once([["resolved", { token: quick.token.address }], ["report", quick]]);

  if (!limiter.allow(clientIp(request))) {
    return NextResponse.json({ error: "six crawls a minute per address is the ceiling; try again in a minute" }, { status: 429 });
  }

  let token: Address;
  try {
    const resolved = await resolveInput(target);
    if (resolved.kind === "none" || !resolved.token) {
      const candidates = resolved.kind === "cluster" ? resolved.cluster.map((c) => ({ token: c.token, symbol: c.symbol, name: c.name })) : [];
      return once([["error", { message: resolved.note ?? `nothing found for ${target}`, candidates }]]);
    }
    token = resolved.token;
  } catch {
    return once([["error", { message: "the lookup failed; try again in a moment, or paste the contract address" }]]);
  }

  const hit = cachedReport(token);
  if (hit) return once([["resolved", { token }], ["report", hit]]);

  let close: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(frame(event, data));
        } catch {
          open = false;
        }
      };
      const heartbeat = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          open = false;
        }
      }, 15_000);

      send("resolved", { token });
      const run = crawlShared(token, (e) => send(e.type, e));
      close = () => {
        open = false;
        clearInterval(heartbeat);
        run.leave();
      };

      if (run.started) {
        // a history too long for one crawl is read on after the answer, into
        // the log cache; the function lives on until maxDuration for it
        after(async () => {
          const error = await run.promise.then(() => null, (e: unknown) => e);
          if (error instanceof CrawlTooLong) await inBackground(() => warmLogs(error.token, undefined, WARM_BUDGET_MS)).catch(() => {});
          // a crawl's own cache write must land before the function sleeps
          await cacheWritten();
        });
      }

      if (run.started && indexConfigured()) {
        // record the finished crawl for the pulse; never delays the stream
        after(async () => {
          const report = await run.promise.catch(() => null);
          if (!report) return;
          await recordCrawl(
            {
              token: report.token.address,
              symbol: report.token.symbol,
              holders: report.metrics.holders,
              score: report.score,
              band: report.band,
              ms: report.provenance.ms,
              wallets: report.metrics.holders,
            },
            report,
          ).catch(() => {});
        });
      }

      run.promise
        .then((report) => send("report", report))
        .catch((error: unknown) => {
          const message = error instanceof CrawlTooLong
            ? `$${error.symbol} has a long history and this is its first crawl: JUMPER is reading all of it now, once. Crawl it again in a few minutes and it answers in seconds.`
            : error instanceof CrawlError
            ? error.message
            : "the chain read failed part way; try again in a moment";
          send("error", { message });
        })
        .finally(() => {
          const wasOpen = open;
          close();
          if (wasOpen) {
            try {
              controller.close();
            } catch {
              /* already closed by the client */
            }
          }
        });
    },
    cancel() {
      close();
    },
  });
  return sse(stream);
}
