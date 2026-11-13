import type { Metadata } from "next";
import { staffScreenMetadata } from "@/lib/dbSettings";

// Tab title "Admin - <Restaurant name>" for /admin and /admin/login.
export function generateMetadata(): Promise<Metadata> {
  return staffScreenMetadata("/admin");
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
