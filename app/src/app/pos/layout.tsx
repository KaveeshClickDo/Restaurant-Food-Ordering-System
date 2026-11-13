import type { Metadata } from "next";
import { POSProvider } from "@/context/POSContext";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "POS - <Restaurant name>" for /pos and /pos/login.
export async function generateMetadata(): Promise<Metadata> {
  return { ...(await staffScreenMetadata("/pos")), description: "Point of Sale System" };
}

export default function POSLayout({ children }: { children: React.ReactNode }) {
  return <POSProvider>{children}</POSProvider>;
}
