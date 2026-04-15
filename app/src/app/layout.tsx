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

// Static SSR fallback — SeoHead (client component inside AppProvider) overrides
// these reactively from admin settings stored in localStorage.
// Derived from restaurantInfo so there is one source of truth for the default name.
export const metadata: Metadata = {
  title: `${restaurantInfo.name} — Order Online`,
  description: `Order online from ${restaurantInfo.name}. Fast delivery and easy collection.`,
  keywords: `food delivery, online order, ${restaurantInfo.name}`,
  openGraph: {
    title: `${restaurantInfo.name} — Order Online`,
    description: `Fast delivery and easy collection from ${restaurantInfo.name}.`,
    type: "website",
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
