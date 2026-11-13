import type { Metadata } from "next";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "Waiter - <Restaurant name>" for /waiter and /waiter/login.
export function generateMetadata(): Promise<Metadata> {
  return staffScreenMetadata("/waiter");
}

export default function WaiterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
