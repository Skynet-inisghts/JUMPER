import type { Metadata } from "next";
import { headers } from "next/headers";
import { VERSION } from "@engine/version.js";
import Site from "@/components/Site";

const TOKEN = /^0x[0-9a-fA-F]{40}$/;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function siteBase(): Promise<URL> {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) {
    try {
      return new URL(env);
    } catch {
      /* falls through to the request host */
    }
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return new URL(`${proto}://${host}`);
}

const pickToken = (raw: string | string[] | undefined): string | null => {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && TOKEN.test(v) ? v : null;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const token = pickToken((await searchParams).token);
  const metadataBase = await siteBase();
  const title = "JUMPER · crawler terminal for pons v2";
  const description = token
    ? `A JUMPER crawl of ${token}: who stayed, who left, who sniped it, scored on the web scale. Read only, describes the past.`
    : "It can jump over any token. Eight crawlers walk one Pons v2 token on Robinhood Chain and score its holders. Read only.";
  const image = token
    ? { url: `/api/card?token=${token}`, width: 1080, height: 1080, alt: "JUMPER share card" }
    : { url: "/og-header.png", width: 1500, height: 500, alt: "JUMPER" };
  return {
    metadataBase,
    title,
    description,
    openGraph: { title, description, images: [image], type: "website" },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export default async function Page({ searchParams }: Props) {
  const token = pickToken((await searchParams).token);
  return <Site initialToken={token} version={VERSION} />;
}
