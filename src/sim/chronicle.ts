import { CHRONICLE_CAP, DAY_SEC } from './config';
import type { ChronicleCategory, ChronicleDetail, World } from './types';

/**
 * Append a meaningful event to the world's chronicle (bounded ring).
 * `detail` carries the structured payload the Creator UI uses to explain
 * and locate the event — never re-derived by parsing the text.
 */
export function chronicle(
  world: World,
  category: ChronicleCategory,
  text: string,
  detail: ChronicleDetail = {},
): void {
  world.chronicle.push({
    id: world.chronicleCounter++,
    t: world.timeSec,
    category,
    text,
    ...detail,
  });
  if (world.chronicle.length > CHRONICLE_CAP) {
    world.chronicle.splice(0, world.chronicle.length - CHRONICLE_CAP);
  }
}

export interface SimClock {
  year: number;
  day: number;
  hour: number;
  minute: number;
  /** 0..1 through the current day. */
  dayFrac: number;
}

export function clockOf(timeSec: number): SimClock {
  const totalDays = Math.floor(timeSec / DAY_SEC);
  const dayFrac = (timeSec % DAY_SEC) / DAY_SEC;
  const hourF = dayFrac * 24;
  return {
    year: Math.floor(totalDays / 120) + 1, // 120-day Eden year
    day: (totalDays % 120) + 1,
    hour: Math.floor(hourF),
    minute: Math.floor((hourF % 1) * 60),
    dayFrac,
  };
}

export function formatClock(timeSec: number): string {
  const c = clockOf(timeSec);
  const hh = String(c.hour).padStart(2, '0');
  const mm = String(c.minute).padStart(2, '0');
  return `Year ${c.year} · Day ${c.day} · ${hh}:${mm}`;
}

export function formatClockShort(timeSec: number): string {
  const c = clockOf(timeSec);
  const hh = String(c.hour).padStart(2, '0');
  const mm = String(c.minute).padStart(2, '0');
  return `D${c.day} ${hh}:${mm}`;
}

/** Daylight strength 0 (deep night) .. 1 (midday). */
export function daylight01(timeSec: number): number {
  const f = (timeSec % DAY_SEC) / DAY_SEC; // 0 = midnight
  return Math.max(0, Math.sin((f - 0.25) * Math.PI * 2) * 0.5 + 0.5) ** 1.2;
}

export function isNight(timeSec: number): boolean {
  const c = clockOf(timeSec);
  return c.hour >= 21 || c.hour < 5;
}
