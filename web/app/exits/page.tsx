import type { Metadata } from "next";
import ToolPage from "@/components/ToolPage";
import ExitsView from "@/components/ExitsView";

export const metadata: Metadata = {
  title: "JUMPER · exits",
  description: "Who is getting out of Pons tokens right now: the last hour's big sells, the dev's own marked.",
};

export default function ExitsPage() {
  return <ToolPage tagline="exits · the last hour"><ExitsView /></ToolPage>;
}
