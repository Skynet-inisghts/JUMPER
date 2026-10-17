/**
 * Tokens the site does not crawl. The crawl answers with the line below
 * instead of a report, and the share card is not drawn.
 */
const BLOCKED: Record<string, string> = {
  "0xce4537dc4d7c1e172c437dd92f25e757af927d7a": "Jumper is SUPPER BULLISH in any way and any time",
};

export const blockedMessage = (token: string): string | undefined => BLOCKED[token.toLowerCase()];
