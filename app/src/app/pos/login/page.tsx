"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePOS } from "@/context/POSContext";
import { POSStaff } from "@/types/pos";
import { Delete, Lock, ChefHat, AlertCircle } from "lucide-react";

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function POSLoginPage() {
  const router = useRouter();
  const { staff, login, currentStaff, settings } = usePOS();
  const [selectedStaff, setSelectedStaff] = useState<POSStaff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Mount guard prevents SSR/client hydration mismatch from localStorage reads
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mounted && currentStaff) router.replace("/pos");
  }, [mounted, currentStaff, router]);

  const activeStaff = staff.filter((s) => s.active);

  function selectStaff(member: POSStaff) {
    setSelectedStaff(member);
    setPin("");
    setError("");
  }

  function pressDigit(d: string) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      // Auto-submit
      setTimeout(() => attemptLogin(next), 100);
    }
  }

  function attemptLogin(p: string) {
    if (!selectedStaff) return;
    const ok = login(selectedStaff.id, p);
    if (ok) {
      router.push("/pos");
    } else {
      setShaking(true);
      setError("Incorrect PIN. Please try again.");
      setPin("");
      setTimeout(() => setShaking(false), 600);
    }
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
    setError("");
  }

  const PAD = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  // Render a dark placeholder during SSR / before hydration to avoid mismatch
  if (!mounted) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 select-none">
      {/* Brand */}
      <div className="flex items-center gap-3 mb-10">
        <div className="w-12 h-12 bg-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-500/30">
          <ChefHat size={24} className="text-white" />
        </div>
        <div>
          <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">POS Terminal</p>
          <h1 className="text-xl font-bold text-white">{settings.businessName}</h1>
        </div>
      </div>

      {!selectedStaff ? (
        // ── Staff selector ────────────────────────────────────────────────
        <div className="w-full max-w-lg">
          <p className="text-center text-slate-400 text-sm mb-6">Select your profile to continue</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {activeStaff.map((member) => (
              <button
                key={member.id}
                onClick={() => selectStaff(member)}
                className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-slate-800/60 border border-slate-700/50 hover:border-orange-500/60 hover:bg-slate-800 active:scale-95 transition-all duration-150 group"
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg group-hover:scale-105 transition-transform"
                  style={{ backgroundColor: member.avatarColor }}
                >
                  {getInitials(member.name)}
                </div>
                <div className="text-center">
                  <p className="text-white font-semibold text-sm">{member.name}</p>
                  <p className="text-slate-400 text-xs capitalize mt-0.5">{member.role}</p>
                </div>
              </button>
            ))}
          </div>
          <p className="text-center text-slate-600 text-xs mt-8">
            {settings.location} · POS v1.0
          </p>
        </div>
      ) : (
        // ── PIN entry ─────────────────────────────────────────────────────
        <div className="w-full max-w-xs">
          {/* Back */}
          <button
            onClick={() => { setSelectedStaff(null); setPin(""); setError(""); }}
            className="flex items-center gap-2 text-slate-400 hover:text-white text-sm mb-8 transition-colors"
          >
            ← Back
          </button>

          {/* Avatar */}
          <div className="flex flex-col items-center mb-8">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-xl mb-3"
              style={{ backgroundColor: selectedStaff.avatarColor }}
            >
              {getInitials(selectedStaff.name)}
            </div>
            <p className="text-white font-bold text-lg">{selectedStaff.name}</p>
            <p className="text-slate-400 text-sm capitalize">{selectedStaff.role}</p>
          </div>

          {/* PIN dots */}
          <div className={`flex justify-center gap-4 mb-6 ${shaking ? "animate-[shake_0.5s_ease-in-out]" : ""}`}>
            {[0,1,2,3].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                  pin.length > i
                    ? "bg-orange-500 border-orange-500 scale-110"
                    : "bg-transparent border-slate-600"
                }`}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-5">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* PIN pad */}
          <div className="grid grid-cols-3 gap-3">
            {PAD.map((d, i) => {
              if (d === "") return <div key={i} />;
              if (d === "⌫") {
                return (
                  <button
                    key={i}
                    onClick={backspace}
                    className="h-16 rounded-2xl bg-slate-700/60 hover:bg-slate-700 active:scale-95 text-slate-300 flex items-center justify-center transition-all"
                  >
                    <Delete size={20} />
                  </button>
                );
              }
              return (
                <button
                  key={i}
                  onClick={() => pressDigit(d)}
                  className="h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-orange-500 active:scale-95 text-white font-bold text-xl transition-all border border-slate-700/50 hover:border-slate-600 shadow-sm"
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center gap-2 mt-6 text-slate-600 text-xs">
            <Lock size={11} />
            <span>PIN protected terminal</span>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-8px); }
          30%, 70% { transform: translateX(8px); }
        }
      `}</style>
    </div>
  );
}
