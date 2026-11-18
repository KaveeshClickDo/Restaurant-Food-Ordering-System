import type { Metadata } from "next";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "Kitchen - <Restaurant name>" for /kitchen and /kitchen/login.
export function generateMetadata(): Promise<Metadata> {
  return staffScreenMetadata("/kitchen");
}

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
