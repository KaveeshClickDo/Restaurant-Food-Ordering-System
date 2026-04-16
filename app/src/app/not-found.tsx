import Link from "next/link";
import { ChefHat, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-orange-500/30">
        <ChefHat size={28} className="text-white" />
      </div>
      <h1 className="text-6xl font-black text-gray-900 mb-2">404</h1>
      <h2 className="text-xl font-bold text-gray-700 mb-2">Page not found</h2>
      <p className="text-gray-500 text-sm max-w-xs mb-8">
        This page doesn&apos;t exist or may have moved. Head back to our menu to order.
      </p>
      <Link
        href="/"
        className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors shadow-md"
      >
        <Home size={16} />
        Back to menu
      </Link>
    </div>
  );
}
