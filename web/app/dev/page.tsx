import type { Metadata } from "next";
import ToolPage from "@/components/ToolPage";
import DevView from "@/components/DevView";

export const metadata: Metadata = {
  title: "JUMPER · dev check",
  description: "Everything one dev launched on Pons, and what became of it: dumped, dead, or kept.",
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function DevPage({ searchParams }: Props) {
  const raw = (await searchParams).address;
  const v = Array.isArray(raw) ? raw[0] : raw;
  return <ToolPage tagline="dev check"><DevView initial={v && /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null} /></ToolPage>;
}
