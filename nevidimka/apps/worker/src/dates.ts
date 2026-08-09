/** Returns YYYY-MM-DD for "now" in the given IANA timezone. */
export function todayInTimezone(timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

/** Day number of the program for a given date, where day0Date is day 1. */
export function dayNumberFor(day0Date: string, date: string): number {
  const start = new Date(`${day0Date}T00:00:00Z`).getTime();
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const diffDays = Math.floor((target - start) / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}
