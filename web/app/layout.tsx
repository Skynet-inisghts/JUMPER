import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const tiny5 = localFont({
  src: "../fonts/Tiny5-Regular.ttf",
  variable: "--f-tiny",
  weight: "400",
  display: "swap",
});

const mono = localFont({
  src: "../fonts/JetBrainsMono[wght].ttf",
  variable: "--f-mono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JUMPER · crawler terminal for pons v2",
  description:
    "JUMPER drops a swarm of eight crawlers on one Pons v2 token on Robinhood Chain and reads who stayed, who left, who sniped it and who knows what they are doing. Read only.",
};

export const viewport: Viewport = {
  themeColor: "#07060A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${tiny5.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
