import type { Metadata } from "next";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "Collection - <Restaurant name>" for /collection and /collection/login.
export function generateMetadata(): Promise<Metadata> {
  return staffScreenMetadata("/collection");
}

export default function CollectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
