import type { Metadata } from "next";
import LeadersView from "@/components/LeadersView";

export const metadata: Metadata = {
  title: "JUMPER · leaders",
  description: "The wallets that trade Pons best, bots left out, and the tokens smart money is buying right now.",
};

export default function LeadersPage() {
  return <LeadersView />;
}
