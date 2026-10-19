import { NextResponse, after } from "next/server";
import type { Address } from "viem";
import { CrawlError, CrawlTooLong, cacheWritten } from "@engine/crawl.js";
import { resolveInput } from "@engine/chain/resolve.js";
import { renderCard } from "@engine/card/card.js";
import { fetchTokenLogo } from "@engine/chain/logo.js";
import { RateLimiter } from "@engine/web.js";
import { blockedMessage } from "@engine/blocked.js";
import { readLaunch } from "@engine/chain/launches.js";
import {
  addPriceAlert, clearPriceAlerts, followWallet, indexConfigured, radarSub, readFollows, readPriceAlerts, readRadar, readWatches, unfollowWallet, unwatchToken, watchToken,
} from "@engine/chain/history.js";
import type { Report } from "@engine/crawlers/types.js";
import { cachedReport, crawlShared } from "@/lib/server";
import { answerCallback, deleteMessage, editText, esc, sendPhoto, sendText, typing, type Button, type TgUpdate } from "@/lib/telegram";

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

/**
 * Everything past /scan (watchlist, price alerts, follows, radar) is built
 * but not released yet. Flip this to true to bring it all back: the help,
 * the Watch button and the commands. The menu is set separately with
 * setMyCommands.
 */
const EXTRAS = false;

const HELP = [
  "<b>JUMPER</b> crawls one Pons v2 token on Robinhood Chain and scores its holders: who stayed, who left, who sniped it.",
  "",
  "Send a token contract address (0x...) or a $TICKER. In a group: <code>/scan 0x...</code>",
  "",
  ...(EXTRAS ? [
    "<code>/watch 0x...</code> alerts on a token: the dev sells, a wallet sells 1% of the supply or more at once, a smart wallet buys, the price moves 50% up or 30% down",
    "<code>/unwatch 0x...</code> or <code>/unwatch all</code> stops them, <code>/list</code> shows what you watch",
    "<code>/radar</code> fresh launches whose buyers stay, <code>/radar on</code> a message for each new one, <code>/radar off</code> stops it",
    "<code>/alert 0x... 2x</code> or <code>/alert 0x... -50%</code> one message when the price gets there, <code>/alerts</code> lists them, <code>/alerts clear</code>",
    "<code>/follow 0x...</code> a message on every trade of a wallet, <code>/unfollow 0x...</code>, <code>/following</code>",
    "Watched tokens also tell you when their JUMPER score changes band.",
    "",
  ] : []),
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
    `<b>$${esc(r.token.symbol)}</b> · <b>${r.score}/100 ${esc(r.label)}</b>`,
    `${esc(r.verdict.toLowerCase())}: ${esc(r.subline)}`,
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
    [{ text: "Full report", url: `${base}/?token=${ca}` }, ...(EXTRAS ? [{ text: "Watch", callback_data: `w:${ca}` }] : [])],
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

const WATCH_NOTE = "You get a message when the dev sells, a wallet sells 1% of the supply or more at once, a smart wallet buys, or the price moves 50% up or 30% down.";
const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
const usd = (x: number | null) => (x == null ? "n/a" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}K` : `$${x.toFixed(0)}`);

/** Adds a token to the chat's watchlist; the dev comes from the launch so their sells are named. */
async function watch(chat: number, token: Address): Promise<string> {
  const blocked = blockedMessage(token);
  if (blocked) return esc(blocked);
  const deployer = cachedReport(token)?.token.deployer ?? (await readLaunch(token).catch(() => null))?.deployer;
  const r = await watchToken(chat, token, deployer).catch(() => ({ error: "the watchlist did not answer; try again in a moment" }) as { error: string });
  if ("error" in r && r.error) return esc(r.error);
  const ok = r as { symbol?: string; already?: boolean; count?: number };
  return `${ok.already ? "Already watching" : "Watching"} <b>$${esc(ok.symbol ?? "")}</b> (${ok.count ?? 1} of 20). ${WATCH_NOTE}`;
}

/** A target as a multiple of the price now: 2x, 0.5x, -50%, +100%, 50% (up). */
function multOf(arg: string): number | null {
  const x = arg.match(/^(\d+(?:\.\d+)?)x$/i);
  if (x) return Number(x[1]);
  const p = arg.match(/^([+-]?)(\d+(?:\.\d+)?)%$/);
  if (!p) return null;
  const v = Number(p[2]) / 100;
  return p[1] === "-" ? (v < 1 ? 1 - v : null) : 1 + v;
}

async function command(chat: number, replyTo: number, text: string) {
  const [head, arg = ""] = text.replace(/@\w+/, "").split(/\s+/, 2);
  const cmd = head.toLowerCase();
  if (!indexConfigured()) return void sendText(chat, "Alerts are not set up here.", { replyTo });
  if (cmd === "/watch") {
    const input = target(arg);
    if (!input) return void sendText(chat, "Send <code>/watch 0x...</code> or <code>/watch $TICKER</code>.", { replyTo });
    const resolved = await resolveInput(input).catch(() => null);
    if (!resolved?.token) return void sendText(chat, esc(resolved?.note ?? `nothing found for ${input}`), { replyTo });
    return void sendText(chat, await watch(chat, resolved.token), { replyTo });
  }
  if (cmd === "/unwatch") {
    const all = /^all$/i.test(arg);
    const input = all ? null : target(arg);
    if (!all && !input) return void sendText(chat, "Send <code>/unwatch 0x...</code> or <code>/unwatch all</code>.", { replyTo });
    const token = input ? (await resolveInput(input).catch(() => null))?.token : undefined;
    if (!all && !token) return void sendText(chat, `nothing found for ${esc(input ?? "")}`, { replyTo });
    const r = await unwatchToken(chat, token).catch(() => null);
    return void sendText(chat, r ? (r.removed ? `Stopped ${r.removed === 1 ? "that token" : `${r.removed} tokens`}.` : "That token was not on your list.") : "The watchlist did not answer. Try again in a moment.", { replyTo });
  }
  if (cmd === "/list") {
    const r = await readWatches(chat).catch(() => null);
    if (!r) return void sendText(chat, "The watchlist did not answer. Try again in a moment.", { replyTo });
    const lines = r.rows.map((w) => `$${esc(w.symbol)} <code>${w.token}</code>`);
    return void sendText(chat, [
      lines.length ? `<b>Watching ${lines.length} of 20</b>` : "Nothing on your list. <code>/watch 0x...</code> adds a token.",
      ...lines,
      "",
      `Radar alerts: ${r.radar ? "on" : "off"}`,
    ].join("\n"), { replyTo });
  }
  if (cmd === "/alert") {
    const [, a1 = "", a2 = ""] = text.split(/\s+/);
    const input = target(a1);
    const mult = multOf(a2);
    if (!input || !mult || mult === 1) return void sendText(chat, "Send <code>/alert 0x... 2x</code>, <code>/alert 0x... -50%</code> or <code>/alert 0x... +100%</code>.", { replyTo });
    const resolved = await resolveInput(input).catch(() => null);
    if (!resolved?.token) return void sendText(chat, esc(resolved?.note ?? `nothing found for ${input}`), { replyTo });
    const r = await addPriceAlert(chat, resolved.token, mult).catch(() => ({ error: "the alerts did not answer; try again in a moment" }) as { error: string });
    if ("error" in r && r.error) return void sendText(chat, esc(r.error), { replyTo });
    const ok = r as { symbol?: string; count?: number };
    return void sendText(chat, `Alert set on <b>$${esc(ok.symbol ?? "")}</b>: one message when the price is ${mult > 1 ? `up ${Math.round((mult - 1) * 100)}%` : `down ${Math.round((1 - mult) * 100)}%`} from now (${ok.count ?? 1} of 20).`, { replyTo });
  }
  if (cmd === "/alerts") {
    if (/^clear$/i.test(arg)) {
      const r = await clearPriceAlerts(chat).catch(() => null);
      return void sendText(chat, r ? `Cleared ${r.removed ?? 0}.` : "The alerts did not answer. Try again in a moment.", { replyTo });
    }
    const r = await readPriceAlerts(chat).catch(() => null);
    if (!r) return void sendText(chat, "The alerts did not answer. Try again in a moment.", { replyTo });
    if (!r.rows.length) return void sendText(chat, "No price alerts. <code>/alert 0x... 2x</code> sets one.", { replyTo });
    return void sendText(chat, [`<b>${r.rows.length} price alerts</b>`, ...r.rows.map((a) => `$${esc(a.symbol)} at ${a.mult > 1 ? `+${Math.round((a.mult - 1) * 100)}%` : `-${Math.round((1 - a.mult) * 100)}%`} <code>${a.token}</code>`), "", "<code>/alerts clear</code> removes them."].join("\n"), { replyTo });
  }
  if (cmd === "/follow") {
    const w = arg.match(ADDRESS)?.[0];
    if (!w) return void sendText(chat, "Send <code>/follow 0x...</code> with a wallet address.", { replyTo });
    const r = await followWallet(chat, w).catch(() => ({ error: "following did not answer; try again in a moment" }) as { error: string });
    if ("error" in r && r.error) return void sendText(chat, esc(r.error), { replyTo });
    const ok = r as { already?: boolean; count?: number };
    return void sendText(chat, `${ok.already ? "Already following" : "Following"} <code>${w.toLowerCase()}</code> (${ok.count ?? 1} of 10). A message on every Pons trade it makes.`, { replyTo });
  }
  if (cmd === "/unfollow") {
    const w = arg.match(ADDRESS)?.[0];
    if (!w && !/^all$/i.test(arg)) return void sendText(chat, "Send <code>/unfollow 0x...</code> or <code>/unfollow all</code>.", { replyTo });
    const r = await unfollowWallet(chat, w).catch(() => null);
    return void sendText(chat, r ? (r.removed ? `Stopped following ${r.removed === 1 ? "it" : `${r.removed} wallets`}.` : "That wallet was not followed.") : "Following did not answer. Try again in a moment.", { replyTo });
  }
  if (cmd === "/following") {
    const r = await readFollows(chat).catch(() => null);
    if (!r) return void sendText(chat, "Following did not answer. Try again in a moment.", { replyTo });
    return void sendText(chat, r.rows.length ? [`<b>Following ${r.rows.length} of 10</b>`, ...r.rows.map((f) => `<code>${f.wallet}</code>`)].join("\n") : "You follow no wallets. <code>/follow 0x...</code> adds one.", { replyTo });
  }
  if (cmd === "/radar") {
    if (/^(on|off)$/i.test(arg)) {
      const on = /^on$/i.test(arg);
      const r = await radarSub(chat, on).catch(() => null);
      return void sendText(chat, !r ? "The radar did not answer. Try again in a moment." : on ? "Radar alerts on: a message for each launch the first time it is on the radar." : "Radar alerts off.", { replyTo });
    }
    const r = await readRadar().catch(() => null);
    if (!r) return void sendText(chat, "The radar did not answer. Try again in a moment.", { replyTo });
    if (!r.rows.length) return void sendText(chat, "Nothing on the radar right now. Fresh launches are checked every two minutes.", { replyTo });
    const lines = r.rows.slice(0, 10).map((x, i) =>
      `${i + 1}. <b>$${esc(x.symbol)}</b> ${x.ageMin}m · ${x.buyers} buyers, ${pct(x.kept)} in · top ${pct(x.top)}${x.smartIn ? ` · ${x.smartIn} smart` : ""} · ${usd(x.mcapUsd)}\n<code>${x.token}</code>`);
    return void sendText(chat, ["<b>Radar</b>: fresh launches whose buyers stay", "", ...lines, "", "Send an address to crawl it. <code>/radar on</code> for alerts. Not financial advice."].join("\n"), { replyTo });
  }
}

export async function POST(request: Request) {
  const secret = process.env.TG_WEBHOOK_SECRET?.trim();
  if (!process.env.TG_BOT_TOKEN?.trim() || !secret) return NextResponse.json({ error: "no bot configured" }, { status: 404 });
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) return NextResponse.json({ error: "not allowed" }, { status: 401 });

  const update = (await request.json().catch(() => null)) as TgUpdate | null;
  const cb = update?.callback_query;
  if (cb) {
    if (!EXTRAS) return NextResponse.json({ ok: true });
    const m = cb.data?.match(/^w:(0x[0-9a-f]{40})$/);
    const chat = cb.message?.chat.id;
    if (m && chat) after(async () => {
      const text = await watch(chat, m[1] as Address);
      await answerCallback(cb.id, text.startsWith("Watching") || text.startsWith("Already") ? "Watching it" : "Could not add it");
      await sendText(chat, text);
    });
    return NextResponse.json({ ok: true });
  }
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

  if (EXTRAS && /^\/(watch|unwatch|list|radar|alerts?|follow|unfollow|following)\b/i.test(text)) {
    after(() => command(chat, msg.message_id, text));
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
