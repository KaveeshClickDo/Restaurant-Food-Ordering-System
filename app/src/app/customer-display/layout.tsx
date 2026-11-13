import type { Metadata } from "next";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "Customer Display - <Restaurant name>" for /customer-display and its login.
export function generateMetadata(): Promise<Metadata> {
  return staffScreenMetadata("/customer-display");
}

export default function CustomerDisplayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
