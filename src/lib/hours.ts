/**
 * Opening hours: whether the shop is taking orders right now, and how to say
 * when it next is.
 *
 * Stored as one entry per weekday (Sunday = 0) in the shop's own time zone.
 * Every comparison is done on the wall clock in that zone, never in UTC, so
 * the clocks going forward in March cannot shift "5pm" to 6pm.
 */

export interface DayHours {
  day: number;
  closed: boolean;
  /** "HH:MM", 24-hour. */
  open: string;
  close: string;
}

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toMinutes(hhmm: string): number {
  const m = hhmm.match(HHMM);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Hours as stored, made whole: one valid entry for every day, closed where
 * nothing usable was given. Used on read and on write, because the hours
 * decide whether a caller can order at all.
 */
export function parseOpeningHours(raw: unknown): DayHours[] {
  const given = Array.isArray(raw) ? raw : [];
  return WEEKDAYS.map((_, day) => {
    const e = given.find((x) => x && typeof x === "object" && (x as DayHours).day === day) as
      | Partial<DayHours>
      | undefined;
    const open = typeof e?.open === "string" && HHMM.test(e.open) ? e.open : "17:00";
    const close = typeof e?.close === "string" && HHMM.test(e.close) ? e.close : "22:00";
    return { day, closed: e ? Boolean(e.closed) || open === close : true, open, close };
  });
}

export interface ZonedNow {
  year: number;
  month: number;
  day: number;
  weekday: number;
  /** Minutes since midnight on the shop's wall clock. */
  minutes: number;
}

export function zonedNow(now: Date, timeZone: string): ZonedNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export type OpenStatus =
  | { open: true; closes: string; minutesLeft: number }
  | { open: false; next: { day: number; open: string; today: boolean; tomorrow: boolean } | null };

/**
 * Open now? A day whose closing time is at or before its opening time runs
 * past midnight, so a shop open 17:00–01:00 on Saturday is still open at
 * half past midnight on Sunday.
 */
export function openStatus(hours: DayHours[], timeZone: string, now: Date): OpenStatus {
  const z = zonedNow(now, timeZone);
  const today = hours[z.weekday];
  const yesterday = hours[(z.weekday + 6) % 7];

  if (yesterday && !yesterday.closed && toMinutes(yesterday.close) <= toMinutes(yesterday.open)) {
    if (z.minutes < toMinutes(yesterday.close)) {
      return { open: true, closes: yesterday.close, minutesLeft: toMinutes(yesterday.close) - z.minutes };
    }
  }
  if (today && !today.closed) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    const end = close <= open ? close + 24 * 60 : close;
    if (z.minutes >= open && z.minutes < end) {
      return { open: true, closes: today.close, minutesLeft: end - z.minutes };
    }
    if (z.minutes < open) {
      return { open: false, next: { day: z.weekday, open: today.open, today: true, tomorrow: false } };
    }
  }
  for (let i = 1; i <= 7; i++) {
    const d = hours[(z.weekday + i) % 7];
    if (d && !d.closed) return { open: false, next: { day: d.day, open: d.open, today: false, tomorrow: i === 1 } };
  }
  return { open: false, next: null };
}

/** "5pm", "half past nine", "quarter to ten": how a person says a time. */
export function spokenTime(hhmm: string): string {
  const mins = toMinutes(hhmm);
  if (Number.isNaN(mins)) return hhmm;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const twelve = (h: number) => (h % 12 === 0 ? 12 : h % 12);
  const suffix = (h: number) => (h === 0 ? "midnight" : h === 12 ? "midday" : h < 12 ? "am" : "pm");
  if (m === 0) {
    const s = suffix(h24);
    return s === "midnight" || s === "midday" ? s : `${twelve(h24)}${s}`;
  }
  if (m === 30) return `half past ${twelve(h24)}`;
  if (m === 15) return `quarter past ${twelve(h24)}`;
  if (m === 45) return `quarter to ${twelve(h24 + 1)}`;
  return `${twelve(h24)}:${String(m).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
}

/** The week in a sentence, with runs of identical days joined up. */
export function describeHours(hours: DayHours[]): string {
  // Monday first, as people say a week.
  const order = [1, 2, 3, 4, 5, 6, 0].map((d) => hours[d]);
  const label = (d: DayHours) => (d.closed ? "closed" : `${spokenTime(d.open)} to ${spokenTime(d.close)}`);
  const runs: Array<{ from: number; to: number; text: string }> = [];
  for (const d of order) {
    const text = label(d);
    const last = runs[runs.length - 1];
    if (last && last.text === text) last.to = d.day;
    else runs.push({ from: d.day, to: d.day, text });
  }
  return runs
    .map((r) => {
      const days =
        r.from === r.to
          ? WEEKDAYS[r.from]
          : (r.to - r.from + 7) % 7 === 1
            ? `${WEEKDAYS[r.from]} and ${WEEKDAYS[r.to]}`
            : `${WEEKDAYS[r.from]} to ${WEEKDAYS[r.to]}`;
      return `${days}: ${r.text}`;
    })
    .join(". ");
}

/** When the shop next opens, as a sentence: "today at 5pm", "on Wednesday at 5pm". */
export function spokenNextOpen(status: OpenStatus): string | null {
  if (status.open || !status.next) return null;
  const when = status.next.today ? "today" : status.next.tomorrow ? "tomorrow" : `on ${WEEKDAYS[status.next.day]}`;
  return `${when} at ${spokenTime(status.next.open)}`;
}

/**
 * The instant a calendar day starts in the shop's time zone: midnight on its
 * wall clock. For "tonight's orders" and the history's day picker, which must
 * not split an evening at UTC midnight (an hour early all summer).
 */
export function shopDayStart(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0);
  // How far the zone's wall clock is ahead of UTC at that moment.
  const z = zonedNow(new Date(guess), timeZone);
  const wall = Date.UTC(z.year, z.month - 1, z.day, Math.floor(z.minutes / 60), z.minutes % 60);
  return new Date(guess - (wall - guess));
}

/** "2026-10-18" for the shop's current day. */
export function shopToday(now: Date, timeZone: string): string {
  const z = zonedNow(now, timeZone);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}

/** Start and end of a "YYYY-MM-DD" day in the shop's zone; null if it is not a date. */
export function shopDayRange(date: string, timeZone: string): { start: Date; end: Date } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const start = shopDayStart(y, mo, d, timeZone);
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  const end = shopDayStart(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone);
  return { start, end };
}
