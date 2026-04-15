import type { WeekSchedule } from "@/types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Parse "HH:MM" into { h, m }. */
function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(":").map(Number);
  return { h, m };
}

/** Minutes since midnight for a Date. */
function minutesOf(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Returns the next Date at which the restaurant will open, or null if the
 * schedule is always closed / manualClosed is true.
 * Looks ahead up to 8 days.
 */
export function getNextOpenTime(
  schedule: WeekSchedule,
  manualClosed: boolean,
): Date | null {
  if (manualClosed) return null;

  const now = new Date();

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    const dayName = DAY_NAMES[candidate.getDay()];
    const day = schedule[dayName];
    if (!day || day.closed) continue;

    const { h: oh, m: om } = parseTime(day.open);
    const openMs = new Date(candidate);
    openMs.setHours(oh, om, 0, 0);

    const { h: ch, m: cm } = parseTime(day.close);
    const closeMs = new Date(candidate);
    closeMs.setHours(ch, cm, 0, 0);

    if (offset === 0) {
      // Same day — only valid if we're currently before closing
      if (now < closeMs) {
        if (now < openMs) return openMs; // hasn't opened yet today
        return null; // currently open — caller shouldn't need this
      }
      // Already past close, try next day
      continue;
    }

    // Future day — open time is valid
    return openMs;
  }

  return null;
}

/**
 * Format a Date as a human-readable next-open label, e.g.:
 *   "today at 11:00"  /  "tomorrow at 11:00"  /  "Monday at 11:00"
 */
export function formatNextOpen(d: Date): string {
  const now = new Date();
  const todayDate = now.toDateString();
  const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString();
  const targetDate = d.toDateString();

  const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  if (targetDate === todayDate) return `today at ${timeStr}`;
  if (targetDate === tomorrowDate) return `tomorrow at ${timeStr}`;
  return `${DAY_NAMES[d.getDay()]} at ${timeStr}`;
}

export interface DaySlots {
  label: string;   // "Today", "Tomorrow", "Monday 14 Apr"
  dateStr: string; // "2026-04-14" (used as key)
  slots: string[]; // ["11:00", "11:15", …]
}

const SLOT_INTERVAL_MIN = 15;
/** Minimum lead time (minutes) before a slot becomes bookable. */
const MIN_LEAD_MIN = 30;

/**
 * Generate bookable time slots across the next `lookAheadDays` days,
 * filtered to the restaurant's opening hours.
 */
export function getAvailableSlots(
  schedule: WeekSchedule,
  lookAheadDays = 7,
): DaySlots[] {
  const now = new Date();
  const results: DaySlots[] = [];

  for (let offset = 0; offset <= lookAheadDays; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    day.setSeconds(0, 0);

    const dayName = DAY_NAMES[day.getDay()];
    const sched = schedule[dayName];
    if (!sched || sched.closed) continue;

    const { h: oh, m: om } = parseTime(sched.open);
    const { h: ch, m: cm } = parseTime(sched.close);
    const openMin  = oh * 60 + om;
    const closeMin = ch * 60 + cm;

    // For today, don't show slots that are too soon
    const cutoffMin =
      offset === 0
        ? minutesOf(now) + MIN_LEAD_MIN
        : -Infinity;

    const slots: string[] = [];
    for (let t = openMin; t < closeMin; t += SLOT_INTERVAL_MIN) {
      if (t <= cutoffMin) continue;
      const hh = Math.floor(t / 60).toString().padStart(2, "0");
      const mm = (t % 60).toString().padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }
    if (slots.length === 0) continue;

    // Build the label
    const todayStr    = now.toDateString();
    const tomorrowStr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString();
    const dayStr      = day.toDateString();
    const dateLabel   = day.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

    let label: string;
    if (dayStr === todayStr)    label = "Today";
    else if (dayStr === tomorrowStr) label = "Tomorrow";
    else label = `${dayName} ${dateLabel}`;

    const dateKey = day.toISOString().slice(0, 10);
    results.push({ label, dateStr: dateKey, slots });
  }

  return results;
}

/**
 * Build the slot label stored in `scheduledTime`, e.g.
 * "Today at 12:30"  /  "Tomorrow at 11:00"  /  "Monday at 14:00"
 */
export function buildSlotLabel(dayLabel: string, slot: string): string {
  return `${dayLabel} at ${slot}`;
}
