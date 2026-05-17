import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  subDays,
  differenceInCalendarDays,
  format,
} from "date-fns";

export type DateRangePreset = "today" | "this_week" | "this_month" | "this_quarter" | "this_year" | "all_time" | "last_fy";

export interface DateRange {
  from: Date;
  to: Date;
}

export function getDateRange(preset: DateRangePreset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "this_week":
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "this_quarter":
      return { from: startOfQuarter(now), to: endOfQuarter(now) };
    case "this_year":
      return { from: startOfYear(now), to: endOfYear(now) };
    case "all_time":
      // Indian FY: Apr 1 — Mar 31. Last FY = 2023-04-01 to 2024-03-31 (relative to "previous" FY).
      const y = now.getMonth() < 3 ? now.getFullYear() - 2 : now.getFullYear() - 1;
      return { from: new Date(2020, 0, 1), to: endOfDay(now) };
  }
}

export function getPreviousRange(range: DateRange): DateRange {
  const days = differenceInCalendarDays(range.to, range.from) + 1;
  return {
    from: subDays(range.from, days),
    to: subDays(range.to, 1),
  };
}

/** Indian numbering: ₹1,23,456 — compact: 1.5L, 1.2Cr */
export function formatCurrency(amount: number | null | undefined, compact = false): string {
  const n = Number(amount ?? 0);
  if (compact) {
    const abs = Math.abs(n);
    if (abs >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)}Cr`;
    if (abs >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
    if (abs >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
    return `₹${n.toFixed(0)}`;
  }
  // Indian numbering system grouping
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  });
  return formatter.format(n);
}

export function formatNumber(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-IN").format(Number(n ?? 0));
}

export function formatDate(date: string | Date | null | undefined, fmt = "dd MMM yyyy"): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return format(d, fmt);
}

export function calculatePercentChange(current: number, previous: number): number {
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}
