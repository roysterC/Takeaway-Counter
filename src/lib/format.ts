/**
 * Display formatting for the CRM screens, in the shop's own terms: UK times,
 * pounds, phone numbers as people write them.
 */

import { normalisePhone } from "@/lib/phone";

export { formatPence } from "@/lib/money";

/** "18:05" */
export function clock(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** "Sat 18 Oct, 18:05" */
export function dateTime(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "18 Oct 2026" */
export function date(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "just now", "4 min ago", "1 hr 10 min ago" */
export function ago(iso: string | Date, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} hr${mins % 60 ? ` ${mins % 60} min` : ""} ago`;
}

/** "07700 900123" from "+447700900123"; anything else as it came. */
export function phone(e164: string | null | undefined): string {
  if (!e164) return "";
  const p = normalisePhone(e164);
  if (!p.ok) return e164;
  return `${p.national.slice(0, 5)} ${p.national.slice(5)}`;
}

/** "3m 05s" */
export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
