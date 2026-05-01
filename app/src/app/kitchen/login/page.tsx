"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import type { KitchenStaff } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

type LoginStep = "staff" | "pin";

// ── PIN pad ───────────────────────────────────────────────────────────────────

function PinPad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
      {keys.map((k, i) =>
        k === "" ? (
          <div key={i} />
        ) : (
          <button
            key={k + i}
            onClick={() => {
              if (k === "⌫") onChange(value.slice(0, -1));
              else if (value.length < 4) onChange(value + k);
            }}
            className={`h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95 select-none ${
              k === "⌫"
                ? "bg-slate-700 text-slate-300 hover:bg-slate-600"
                : "bg-slate-700 text-white hover:bg-slate-600 active:bg-orange-500"
            }`}
          >
            {k}
          </button>
        )
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KitchenLoginPage() {
  const router = useRouter();

  const [allStaff,    setAllStaff]    = useState<Omit<KitchenStaff, "pin">[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [step,        setStep]        = useState<LoginStep>("staff");
  const [target,      setTarget]      = useState<Omit<KitchenStaff, "pin"> | null>(null);
  const [pin,         setPin]         = useState("");
  const [pinError,    setPinError]    = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const pinShakeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load staff list on mount
  useEffect(() => {
    fetch("/api/kitchen/config")
      .then((r) => r.json())
      .then((d: { ok: boolean; staff?: Omit<KitchenStaff, "pin">[] }) => {
        if (d.ok && d.staff) setAllStaff(d.staff);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-submit when 4 digits are entered
  const submitPin = useCallback(
    async (currentPin: string) => {
      if (!target || submitting) return;
      setSubmitting(true);
      try {
        const res = await fetch("/api/kitchen/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId: target.id, pin: currentPin }),
        });
        const data = await res.json() as { ok: boolean };
        if (data.ok) {
          router.replace("/kitchen");
        } else {
          setPinError(true);
          setPin("");
          if (pinShakeRef.current) clearTimeout(pinShakeRef.current);
          pinShakeRef.current = setTimeout(() => setPinError(false), 700);
        }
      } catch {
        setPinError(true);
        setPin("");
      } finally {
        setSubmitting(false);
      }
    },
    [target, submitting, router],
  );

  useEffect(() => {
    if (pin.length === 4) submitPin(pin);
  }, [pin, submitPin]);

  function selectStaff(s: Omit<KitchenStaff, "pin">) {
    setTarget(s);
    setPin("");
    setPinError(false);
    setStep("pin");
  }

  function roleLabel(role: KitchenStaff["role"]) {
    const map: Record<KitchenStaff["role"], string> = {
      chef: "Chef",
      head_chef: "Head Chef",
      kitchen_manager: "Kitchen Manager",
    };
    return map[role] ?? role;
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 gap-8">
      {/* Branding */}
      <div className="text-center">
        <div className="w-16 h-16 bg-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <ChefHat size={28} className="text-white" />
        </div>
        <h1 className="text-white text-2xl font-black">Kitchen Login</h1>
        <p className="text-slate-400 text-sm mt-1">Select your name then enter your PIN</p>
      </div>

      {step === "staff" ? (
        /* Staff grid */
        <div className="w-full max-w-sm space-y-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="text-orange-500 animate-spin" />
            </div>
          ) : allStaff.length === 0 ? (
            <p className="text-slate-500 text-center text-sm">No kitchen staff configured.</p>
          ) : (
            allStaff.map((s) => (
              <button
                key={s.id}
                onClick={() => selectStaff(s)}
                className="w-full flex items-center gap-4 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-2xl px-5 py-4 transition-all"
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
                  style={{ backgroundColor: s.avatarColor }}
                >
                  {initials(s.name)}
                </div>
                <div className="text-left">
                  <p className="text-white font-bold">{s.name}</p>
                  <p className="text-slate-400 text-xs">{roleLabel(s.role)}</p>
                </div>
                <ChevronRight size={16} className="text-slate-500 ml-auto" />
              </button>
            ))
          )}
        </div>
      ) : (
        /* PIN pad */
        <div className="w-full max-w-sm space-y-6">
          <button
            onClick={() => { setStep("staff"); setPin(""); setPinError(false); }}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition text-sm"
          >
            <ArrowLeft size={14} /> Back
          </button>

          {/* Who */}
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{ backgroundColor: target?.avatarColor }}
            >
              {initials(target?.name ?? "")}
            </div>
            <div>
              <p className="text-white font-semibold">{target?.name}</p>
              <p className="text-slate-400 text-xs">{target ? roleLabel(target.role) : ""}</p>
            </div>
          </div>

          {/* PIN dots */}
          <div className={`flex justify-center gap-4 ${pinError ? "animate-bounce" : ""}`}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  i < pin.length
                    ? pinError
                      ? "bg-red-500 border-red-500"
                      : "bg-orange-500 border-orange-500"
                    : "border-slate-600"
                }`}
              />
            ))}
          </div>

          {submitting ? (
            <div className="flex justify-center py-2">
              <Loader2 size={24} className="text-orange-500 animate-spin" />
            </div>
          ) : (
            <PinPad value={pin} onChange={setPin} />
          )}

          {pinError && (
            <p className="text-red-400 text-sm text-center font-medium">
              Incorrect PIN — try again
            </p>
          )}
        </div>
      )}
    </div>
  );
}
