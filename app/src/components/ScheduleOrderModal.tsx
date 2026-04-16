"use client";

import { useState } from "react";
import { X, Clock, CalendarDays, CheckCircle2 } from "lucide-react";
import { useApp } from "@/context/AppContext";
import { getAvailableSlots, buildSlotLabel } from "@/lib/scheduleUtils";

interface Props {
  onClose: () => void;
}

export default function ScheduleOrderModal({ onClose }: Props) {
  const { settings, scheduledTime, setScheduledTime, fulfillment } = useApp();
  const days = getAvailableSlots(settings.schedule, 6);

  const [selectedDay, setSelectedDay] = useState(days[0]?.dateStr ?? "");
  const [selectedSlot, setSelectedSlot] = useState("");

  const currentDay = days.find((d) => d.dateStr === selectedDay);

  function confirm() {
    if (!currentDay || !selectedSlot) return;
    setScheduledTime(buildSlotLabel(currentDay.label, selectedSlot));
    onClose();
  }

  function clearSchedule() {
    setScheduledTime(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-orange-500" />
            <h2 className="font-bold text-gray-900">Schedule your order</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Fulfillment note */}
          <p className="text-sm text-gray-500 leading-relaxed">
            Choose when you&apos;d like your{" "}
            <span className="font-semibold text-gray-800">
              {fulfillment === "delivery" ? "delivery" : "collection"}
            </span>{" "}
            — we&apos;ll have your order ready in time.
          </p>

          {days.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <Clock size={32} className="mx-auto mb-3 text-gray-200" />
              <p className="font-medium text-sm">No upcoming slots available</p>
              <p className="text-xs mt-1">Please check back later or contact us directly.</p>
            </div>
          ) : (
            <>
              {/* Day selector */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Date
                </p>
                <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                  {days.map((d) => (
                    <button
                      key={d.dateStr}
                      onClick={() => { setSelectedDay(d.dateStr); setSelectedSlot(""); }}
                      className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                        selectedDay === d.dateStr
                          ? "border-orange-500 bg-orange-50 text-orange-700"
                          : "border-gray-200 text-gray-600 hover:border-gray-300"
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time slots */}
              {currentDay && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Time
                  </p>
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                    {currentDay.slots.map((slot) => (
                      <button
                        key={slot}
                        onClick={() => setSelectedSlot(slot)}
                        className={`py-2 rounded-xl text-sm font-semibold border-2 transition-all ${
                          selectedSlot === slot
                            ? "border-orange-500 bg-orange-500 text-white"
                            : "border-gray-200 text-gray-700 hover:border-orange-300 hover:text-orange-600"
                        }`}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Selected summary */}
              {selectedSlot && currentDay && (
                <div className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                  <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                  <p className="text-sm text-green-800">
                    <span className="font-semibold">
                      {buildSlotLabel(currentDay.label, selectedSlot)}
                    </span>
                    {" "}— your order will be ready around this time.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-3 border-t border-gray-100 space-y-2 flex-shrink-0">
          <button
            disabled={!selectedSlot}
            onClick={confirm}
            className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
              selectedSlot
                ? "bg-orange-500 hover:bg-orange-600 active:scale-[0.98] text-white"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }`}
          >
            {selectedSlot ? `Confirm — ${buildSlotLabel(currentDay!.label, selectedSlot)}` : "Select a time slot"}
          </button>
          {/* Allow clearing a previously set schedule */}
          {scheduledTime && (
            <button
              onClick={clearSchedule}
              className="w-full py-2 text-xs text-gray-400 hover:text-red-500 transition"
            >
              Cancel scheduled order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
