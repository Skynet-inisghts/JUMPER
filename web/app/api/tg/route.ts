import { NextResponse, after } from "next/server";
import type { Address } from "viem";
import { CrawlError, CrawlTooLong, cacheWritten } from "@engine/crawl.js";
import { resolveInput } from "@engine/chain/resolve.js";
import { renderCard } from "@engine/card/card.js";
import { fetchTokenLogo } from "@engine/chain/logo.js";
import { RateLimiter } from "@engine/web.js";
import { blockedMessage } from "@engine/blocked.js";
import type { Report } from "@engine/crawlers/types.js";
import { cachedReport, crawlShared } from "@/lib/server";
import { deleteMessage, editText, esc, sendPhoto, sendText, typing, type Button, type TgUpdate } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/tg, the Telegram webhook of the JUMPER bot. A message with a
 * token address (or a $TICKER) gets the share card back, the score and the
 * three facts under it, and buttons to the full report and to trade. The
 * answer to Telegram goes out at once; the crawl runs after it.
 *
 * Telegram signs each call with the secret set on the webhook
 * (TG_WEBHOOK_SECRET); anything else is turned away.
 */

const ADDRESS = /0x[0-9a-fA-F]{40}/;
const TICKER = /\$[A-Za-z0-9]{1,20}\b/;
const perChat = new RateLimiter(4, 60_000);

const HELP = [
  "<b>JUMPER</b> crawls one Pons v2 token on Robinhood Chain and scores its holders: who stayed, who left, who sniped it.",
  "",
  "Send a token contract address (0x...) or a $TICKER. In a group: <code>/scan 0x...</code>",
  "",
  "0-34 TORN, do not touch · 35-69 PATCHED, handle with care · 70-100 TAUT, safe to walk in.",
  "It measures the past, it does not predict. Not financial advice.",
].join("\n");

const site = (request: Request) => (process.env.NEXT_PUBLIC_SITE_URL?.trim() || new URL(request.url).origin).replace(/\/$/, "");

/** What the user asked for: an address first, then a $TICKER, or a bare word after /scan. */
function target(text: string): string | null {
  const a = text.match(ADDRESS);
  if (a) return a[0];
  const t = text.match(TICKER);
  if (t) return t[0];
  const scan = text.match(/^\/scan(?:@\w+)?\s+(\S+)/i);
  return scan ? scan[1] : null;
}

function caption(r: Report): string {
  const lines = [
    ...(r.outcome
      ? [`<b>$${esc(r.token.symbol)}</b> · <b>${esc(r.outcome.kind.toUpperCase())}</b>`, `no score: ${esc(r.outcome.why)}`]
      : [`<b>$${esc(r.token.symbol)}</b> · <b>${r.score}/100 ${esc(r.label)}</b>`, `${esc(r.verdict.toLowerCase())}: ${esc(r.subline)}`]),
    "",
    ...r.facts.map((f) => `· ${esc(f)}`),
    "",
    `<code>${r.token.address}</code>`,
    `${r.metrics.holders} holders · crawled in ${(r.provenance.ms / 1000).toFixed(1)}s · not financial advice`,
  ];
  return lines.join("\n").slice(0, 1024);
}

function buttons(base: string, token: string): Button[][] {
  const ca = token.toLowerCase();
  return [
    [{ text: "Full report", url: `${base}/?token=${ca}` }],
    [
      { text: "Trade on Axiom", url: `https://axiom.trade/t/${ca}/@jumperrrr?chain=robinhood` },
      { text: "Trade on GMGN", url: `https://gmgn.ai/robinhood/token/jumper_${ca}` },
    ],
  ];
}

async function answer(chat: number, replyTo: number, input: string, base: string) {
  const early = blockedMessage(input);
  if (early) return void sendText(chat, esc(early), { replyTo });

  let token: Address;
  try {
    const resolved = await resolveInput(input);
    if (resolved.kind === "none" || !resolved.token) {
      const options = resolved.kind === "cluster"
        ? "\n\n" + resolved.cluster.slice(0, 8).map((c) => `$${esc(c.symbol)} <code>${c.token}</code>`).join("\n")
        : "";
      return void sendText(chat, esc(resolved.note ?? `nothing found for ${input}`) + options, { replyTo });
    }
    token = resolved.token;
  } catch {
    return void sendText(chat, "The lookup failed. Try again in a moment, or send the contract address.", { replyTo });
  }

  const blocked = blockedMessage(token);
  if (blocked) return void sendText(chat, esc(blocked), { replyTo });

  let report = cachedReport(token);
  const wait = report ? null : await sendText(chat, `Crawling <code>${token}</code>. The swarm usually needs a few seconds; a long history takes a few minutes.`, { replyTo });
  void typing(chat);
  try {
    if (!report) report = await crawlShared(token).promise;
    const logo = await fetchTokenLogo(token).catch(() => null);
    const png = await renderCard(report, { logo: logo ?? undefined });
    const sent = await sendPhoto(chat, png, caption(report), { replyTo, buttons: buttons(base, token) });
    if (sent && wait) await deleteMessage(chat, wait.message_id);
  } catch (error) {
    const message = error instanceof CrawlTooLong
      ? `$${esc(error.symbol)} has more history than one crawl can read. JUMPER keeps reading it; send it again in a few minutes.`
      : error instanceof CrawlError
      ? esc(error.message)
      : "The chain read failed part way. Try again in a moment.";
    if (wait) await editText(chat, wait.message_id, message);
    else await sendText(chat, message, { replyTo });
  } finally {
    await cacheWritten().catch(() => {});
  }
}

export async function POST(request: Request) {
  const secret = process.env.TG_WEBHOOK_SECRET?.trim();
  if (!process.env.TG_BOT_TOKEN?.trim() || !secret) return NextResponse.json({ error: "no bot configured" }, { status: 404 });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) return NextResponse.json({ error: "not allowed" }, { status: 401 });

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  const msg = update?.message;
  const text = msg?.text?.trim();
  if (!msg || !text) return NextResponse.json({ ok: true });
  const chat = msg.chat.id;
  const isPrivate = msg.chat.type === "private";
  const base = site(request);

  if (/^\/(start|help)\b/i.test(text)) {
    after(() => sendText(chat, HELP).then(() => {}));
    return NextResponse.json({ ok: true });
  }

  const input = target(text);
  if (!input) {
    // in a group the bot only speaks when asked; in a private chat it says what it needs
    if (isPrivate) after(() => sendText(chat, "Send a token contract address (0x...) or a $TICKER.").then(() => {}));
    return NextResponse.json({ ok: true });
  }
  if (!perChat.allow(String(chat))) {
    after(() => sendText(chat, "Four crawls a minute per chat is the ceiling. Try again in a minute.", { replyTo: msg.message_id }).then(() => {}));
    return NextResponse.json({ ok: true });
  }

  after(() => answer(chat, msg.message_id, input, base));
  return NextResponse.json({ ok: true });
}
