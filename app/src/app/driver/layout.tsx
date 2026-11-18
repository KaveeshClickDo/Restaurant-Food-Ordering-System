import type { Metadata } from "next";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "Driver - <Restaurant name>" for /driver and /driver/login.
export function generateMetadata(): Promise<Metadata> {
  return staffScreenMetadata("/driver");
}

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
