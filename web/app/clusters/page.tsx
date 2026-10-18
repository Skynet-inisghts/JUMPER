import type { Metadata } from "next";
import ToolPage from "@/components/ToolPage";
import ClustersView from "@/components/ClustersView";

export const metadata: Metadata = {
  title: "JUMPER · clusters",
  description: "Wallets across Pons that move as one: bundlers, sniper farms, coordinated buyers.",
};

export default function ClustersPage() {
  return <ToolPage tagline="clusters · wallets that move together"><ClustersView /></ToolPage>;
}
