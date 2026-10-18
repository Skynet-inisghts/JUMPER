import type { Metadata } from "next";
import ToolPage from "@/components/ToolPage";
import MapView from "@/components/MapView";

export const metadata: Metadata = {
  title: "JUMPER · launchpad map",
  description: "Every busy Pons launch of the last day as a bubble: size is its cap, colour its JUMPER score.",
};

export default function MapPage() {
  return <ToolPage tagline="launchpad map"><MapView /></ToolPage>;
}
