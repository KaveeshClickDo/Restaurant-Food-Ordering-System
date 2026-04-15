"use client";

import { useApp } from "@/context/AppContext";
import { Calendar, Power } from "lucide-react";
import { DaySchedule } from "@/types";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function SchedulePanel() {
  const { settings, updateSettings } = useApp();
  const { schedule, manualClosed } = settings;

  function updateDay(day: string, patch: Partial<DaySchedule>) {
    updateSettings({
      schedule: {
        ...schedule,
        [day]: { ...schedule[day], ...patch },
      },
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
              <Calendar size={18} className="text-blue-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Store Schedule</h2>
              <p className="text-xs text-gray-400">Opening hours and manual override</p>
            </div>
          </div>

          {/* Manual open/close toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-gray-600">
              {manualClosed ? (
                <span className="text-red-600 font-semibold">Manually CLOSED</span>
              ) : (
                <span className="text-green-600 font-semibold">Auto schedule</span>
              )}
            </span>
            <button
              onClick={() => updateSettings({ manualClosed: !manualClosed })}
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                manualClosed ? "bg-red-500" : "bg-green-500"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                  manualClosed ? "translate-x-8" : "translate-x-1"
                }`}
              />
              <Power size={12} className={`absolute ${manualClosed ? "left-2" : "right-2"} text-white`} />
            </button>
          </div>
        </div>

        {manualClosed && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700 font-medium">
            ⚠️ Store is manually closed — no orders can be placed until you re-enable.
          </div>
        )}
      </div>

      <div className="p-6 space-y-3">
        {DAYS.map((day) => {
          const d = schedule[day] ?? { open: "09:00", close: "22:00", closed: false };
          return (
            <div
              key={day}
              className={`p-3 rounded-xl border transition-all ${d.closed ? "bg-gray-50 border-gray-200 opacity-60" : "bg-white border-gray-100"}`}
            >
              {/* Row 1: day name + closed toggle */}
              <div className="flex items-center justify-between mb-2 sm:mb-0 sm:hidden">
                <span className="text-sm font-semibold text-gray-700">{day}</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={d.closed}
                    onChange={(e) => updateDay(day, { closed: e.target.checked })}
                    className="w-4 h-4 accent-red-500 rounded"
                  />
                  <span className="text-xs text-gray-500">Closed</span>
                </label>
              </div>
              {/* Mobile: time inputs below */}
              <div className={`flex items-center gap-2 sm:hidden ${d.closed ? "opacity-40 pointer-events-none" : ""}`}>
                <input
                  type="time"
                  value={d.open}
                  disabled={d.closed}
                  onChange={(e) => updateDay(day, { open: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40"
                />
                <span className="text-gray-400 text-sm">–</span>
                <input
                  type="time"
                  value={d.close}
                  disabled={d.closed}
                  onChange={(e) => updateDay(day, { close: e.target.value })}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40"
                />
              </div>
              {/* Desktop: original single-row layout */}
              <div className="hidden sm:flex items-center gap-4">
                <div className="w-24 flex-shrink-0">
                  <span className="text-sm font-semibold text-gray-700">{day.slice(0, 3)}</span>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="time"
                    value={d.open}
                    disabled={d.closed}
                    onChange={(e) => updateDay(day, { open: e.target.value })}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40"
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="time"
                    value={d.close}
                    disabled={d.closed}
                    onChange={(e) => updateDay(day, { close: e.target.value })}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-40"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={d.closed}
                    onChange={(e) => updateDay(day, { closed: e.target.checked })}
                    className="w-4 h-4 accent-red-500 rounded"
                  />
                  <span className="text-xs text-gray-500">Closed</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
