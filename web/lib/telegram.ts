/**
 * The few Bot API calls the JUMPER bot makes. The token lives in the
 * host's environment (TG_BOT_TOKEN), never in the repo.
 */

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  text?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export type Button = { text: string; url: string };

const api = (method: string) => `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN!.trim()}/${method}`;

async function call<T>(method: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(api(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!j.ok) console.log(`tg ${method}: ${j.description ?? res.status}`);
    return j.ok ? (j.result ?? null) : null;
  } catch (e) {
    console.log(`tg ${method}: ${String((e as Error).message ?? e).slice(0, 120)}`);
    return null;
  }
}

const keyboard = (rows: Button[][] | undefined) => (rows ? { reply_markup: { inline_keyboard: rows } } : {});

export const sendText = (chat: number, text: string, opts: { replyTo?: number; buttons?: Button[][] } = {}) =>
  call<TgMessage>("sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    ...keyboard(opts.buttons),
  });

export const editText = (chat: number, message: number, text: string) =>
  call("editMessageText", { chat_id: chat, message_id: message, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });

export const deleteMessage = (chat: number, message: number) => call("deleteMessage", { chat_id: chat, message_id: message });

export const typing = (chat: number) => call("sendChatAction", { chat_id: chat, action: "upload_photo" });

/** A PNG with a caption and link buttons, as a multipart upload. */
export async function sendPhoto(chat: number, png: Buffer, caption: string, opts: { replyTo?: number; buttons?: Button[][] } = {}): Promise<boolean> {
  const form = new FormData();
  form.set("chat_id", String(chat));
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  if (opts.replyTo) form.set("reply_parameters", JSON.stringify({ message_id: opts.replyTo, allow_sending_without_reply: true }));
  if (opts.buttons) form.set("reply_markup", JSON.stringify({ inline_keyboard: opts.buttons }));
  form.set("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), "jumper.png");
  try {
    const res = await fetch(api("sendPhoto"), { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const j = (await res.json()) as { ok: boolean; description?: string };
    if (!j.ok) console.log(`tg sendPhoto: ${j.description ?? res.status}`);
    return j.ok;
  } catch (e) {
    console.log(`tg sendPhoto: ${String((e as Error).message ?? e).slice(0, 120)}`);
    return false;
  }
}

/** Text for an HTML caption: the three characters Telegram reads as markup. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
