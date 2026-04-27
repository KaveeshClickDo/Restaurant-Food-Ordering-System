import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { restaurantInfo } from "@/data/restaurant";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Static SSR metadata — SeoHead (client component) overrides these reactively
// once admin settings load in the browser. metadataBase is required for Next.js
// to resolve relative og:image paths to absolute URLs for crawlers.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://demo.directdine.tech";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${restaurantInfo.name} — Order Online`,
  description: `Order online from ${restaurantInfo.name}. Fast delivery and easy collection.`,
  keywords: `food delivery, online order, ${restaurantInfo.name}`,
  openGraph: {
    title: `${restaurantInfo.name} — Order Online`,
    description: `Fast delivery and easy collection from ${restaurantInfo.name}.`,
    url: SITE_URL,
    siteName: restaurantInfo.name,
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: `${restaurantInfo.name} — Order Online`,
    description: `Fast delivery and easy collection from ${restaurantInfo.name}.`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans antialiased bg-gray-50 text-gray-900" suppressHydrationWarning>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
