/**
 * Money is held in pence everywhere: menu prices, order lines, totals. Floats
 * would put £7.70 + £0.20 a fraction of a penny off what the till says.
 */

/** "£7.60" */
export function formatPence(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "");
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` and ${words(rest)}` : ""}`;
  }
  return String(n);
}

/**
 * A price the way it is said on the phone: "seven pounds sixty",
 * "twenty-eight pounds fifty", "eighty pence". The receptionist is given this
 * form so the voice never reads "£7.60" as "pound sign seven point six oh".
 */
export function spokenPrice(pence: number): string {
  const pounds = Math.floor(pence / 100);
  const p = pence % 100;
  if (pounds === 0) return `${words(p)} pence`;
  const pound = pounds === 1 ? "one pound" : `${words(pounds)} pounds`;
  return p ? `${pound} ${words(p)}` : pound;
}

/** Parse "7.60", "£7.6", "7" into pence; null if it is not a price. */
export function parsePounds(input: string): number | null {
  const m = input.trim().replace(/^£/, "").match(/^(\d{1,4})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
