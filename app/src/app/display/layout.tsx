import type { Metadata } from "next";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "Digital Signage - <Restaurant name>" for the signage screens at /display/<name>.
export function generateMetadata(): Promise<Metadata> {
  return staffScreenMetadata("/display");
}

export default function SignageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
