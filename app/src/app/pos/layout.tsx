import { POSProvider } from "@/context/POSContext";

export const metadata = {
  title: "POS Terminal",
  description: "Point of Sale System",
};

export default function POSLayout({ children }: { children: React.ReactNode }) {
  return <POSProvider>{children}</POSProvider>;
}
