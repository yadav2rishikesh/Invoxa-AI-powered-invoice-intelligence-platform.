import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  format,
  eachMonthOfInterval,
  startOfMonth,
  endOfMonth,
  subDays,
  startOfDay,
} from "date-fns";
import type { DateRange } from "./format";
import { getPreviousRange } from "./format";

const STALE = 5 * 60 * 1000;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Sum invoices using DB-side aggregation (handles 100k+ rows correctly) */
async function sumInvoices(type: "sales" | "purchase", range: DateRange) {
  const { data, error } = await supabase.rpc("sum_invoices_by_type", {
    p_type: type,
    p_from: isoDate(range.from),
    p_to: isoDate(range.to),
  });
  if (error) {
    console.error("sumInvoices RPC error:", error);
    return { total: 0, count: 0, missing: true };
  }
  return {
    total: Number(data?.[0]?.total ?? 0),
    count: Number(data?.[0]?.count ?? 0),
    missing: false,
  };
}

export function useDashboardStats(range: DateRange) {
  const prev = getPreviousRange(range);
  return useQuery({
    queryKey: ["dashboard-stats", isoDate(range.from), isoDate(range.to)],
    staleTime: STALE,
    queryFn: async () => {
      const [sales, purchases, salesPrev, purchasesPrev, pending] = await Promise.all([
        sumInvoices("sales", range),
        sumInvoices("purchase", range),
        sumInvoices("sales", prev),
        sumInvoices("purchase", prev),
        supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .in("status", ["sent", "partial", "overdue"]),
      ]);

      return {
        sales: sales.total,
        salesPrev: salesPrev.total,
        purchases: purchases.total,
        purchasesPrev: purchasesPrev.total,
        profit: sales.total - purchases.total,
        profitPrev: salesPrev.total - purchasesPrev.total,
        pendingCount: pending.count ?? 0,
        missing: sales.missing && purchases.missing,
      };
    },
  });
}

/** Last 7 days sparkline of total invoice amount per day for a given type */
export function useSparkline(type: "sales" | "purchase" | "all" | "pending") {
  return useQuery({
    queryKey: ["sparkline", type],
    staleTime: STALE,
    queryFn: async () => {
      const today = startOfDay(new Date());
      const days = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i));
      const from = days[0];
      let q = supabase
        .from("invoices")
        .select("invoice_date, total_amount, invoice_type, status")
        .gte("invoice_date", isoDate(from));
      if (type === "sales" || type === "purchase") q = q.eq("invoice_type", type);
      if (type === "pending") q = q.in("status", ["sent", "partial", "overdue"]);
      const { data, error } = await q;
      const byDay = new Map(days.map((d) => [isoDate(d), 0]));
      if (!error && data) {
        for (const r of data as any[]) {
          const k = String(r.invoice_date).slice(0, 10);
          if (byDay.has(k)) {
            const v = type === "pending" ? 1 : Number(r.total_amount ?? 0);
            byDay.set(k, (byDay.get(k) ?? 0) + v);
          }
        }
      }
      return Array.from(byDay.entries()).map(([d, v]) => ({ d, v }));
    },
  });
}

export function useMonthlyChart(range: DateRange) {
  return useQuery({
    queryKey: ["monthly-chart", isoDate(range.from), isoDate(range.to)],
    staleTime: STALE,
    queryFn: async () => {
      const months = eachMonthOfInterval({ start: range.from, end: range.to });

      // Use DB aggregation instead of fetching all rows
      const { data, error } = await supabase.rpc("monthly_invoice_summary", {
        p_from: isoDate(startOfMonth(range.from)),
        p_to: isoDate(endOfMonth(range.to)),
      });

      const buckets = new Map(
        months.map((m) => [
          format(m, "yyyy-MM"),
          { month: format(m, "MMM yy"), sales: 0, purchases: 0 },
        ]),
      );

      if (!error && data) {
        for (const r of data as any[]) {
          const key = String(r.month).slice(0, 7);
          const b = buckets.get(key);
          if (!b) continue;
          if (r.invoice_type === "sales") b.sales = Number(r.total ?? 0);
          else if (r.invoice_type === "purchase") b.purchases = Number(r.total ?? 0);
        }
      }

      return Array.from(buckets.values());
    },
  });
}

export function useTopCustomers(limit = 5) {
  return useQuery({
    queryKey: ["top-customers", limit],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("total_amount, customer_id, customers(name, gstin)")
        .eq("invoice_type", "sales")
        .limit(2000);
      if (error || !data) return [];
      const m = new Map<string, { name: string; gstin: string | null; total: number; count: number }>();
      for (const r of data as any[]) {
        const c = r.customers;
        if (!c) continue;
        const key = r.customer_id;
        const cur = m.get(key) ?? { name: c.name, gstin: c.gstin, total: 0, count: 0 };
        cur.total += Number(r.total_amount ?? 0);
        cur.count += 1;
        m.set(key, cur);
      }
      return Array.from(m.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
    },
  });
}

export function useTopSuppliers(limit = 5) {
  return useQuery({
    queryKey: ["top-suppliers", limit],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("total_amount, supplier_id, suppliers(name, gstin)")
        .eq("invoice_type", "purchase")
        .limit(2000);
      if (error || !data) return [];
      const m = new Map<string, { name: string; gstin: string | null; total: number; count: number }>();
      for (const r of data as any[]) {
        const s = r.suppliers;
        if (!s) continue;
        const key = r.supplier_id;
        const cur = m.get(key) ?? { name: s.name, gstin: s.gstin, total: 0, count: 0 };
        cur.total += Number(r.total_amount ?? 0);
        cur.count += 1;
        m.set(key, cur);
      }
      return Array.from(m.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
    },
  });
}

export function useRecentInvoices(limit = 10) {
  return useQuery({
    queryKey: ["recent-invoices", limit],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select(
          "id, invoice_number, invoice_date, total_amount, status, invoice_type, customers(name), suppliers(name)",
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
}

export function useRecentBatches(limit = 5) {
  return useQuery({
    queryKey: ["recent-batches", limit],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
}

export function useRecentErrors(limit = 5) {
  return useQuery({
    queryKey: ["recent-errors", limit],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("upload_errors")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return [];
      return (data ?? []) as any[];
    },
  });
}

export function useInvoiceStatusDistribution() {
  return useQuery({
    queryKey: ["invoice-status-dist"],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("status, total_amount")
        .limit(5000);
      if (error || !data) return [];
      const m = new Map<string, { name: string; count: number; amount: number }>();
      for (const r of data as any[]) {
        const k = r.status ?? "unknown";
        const cur = m.get(k) ?? { name: k, count: 0, amount: 0 };
        cur.count += 1;
        cur.amount += Number(r.total_amount ?? 0);
        m.set(k, cur);
      }
      return Array.from(m.values());
    },
  });
}

export function useRegionDistribution() {
  return useQuery({
    queryKey: ["region-dist"],
    staleTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("state").limit(5000);
      if (error || !data) return [];
      const m = new Map<string, number>();
      for (const r of data as any[]) {
        const k = (r.state || "Unknown") as string;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      const sorted = Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
      const top = sorted.slice(0, 5).map(([name, value]) => ({ name, value }));
      const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
      if (rest) top.push({ name: "Others", value: rest });
      return top;
    },
  });
}

export function useQuickStats() {
  return useQuery({
    queryKey: ["quick-stats"],
    staleTime: STALE,
    queryFn: async () => {
      const [inv, cust, sup, pendingAmt] = await Promise.all([
        supabase.from("invoices").select("id", { count: "exact", head: true }),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("suppliers").select("id", { count: "exact", head: true }),
        supabase.rpc("sum_invoices_by_status", {
          p_statuses: ["sent", "partial", "overdue"],
        }),
      ]);

      const totalInvoices = inv.count ?? 0;

      // Get avg from DB too
      const { data: avgData } = await supabase.rpc("avg_invoice_amount");

      return {
        totalInvoices,
        totalCustomers: cust.count ?? 0,
        totalSuppliers: sup.count ?? 0,
        avgInvoice: Number(avgData ?? 0),
        pendingAmount: Number(pendingAmt.data?.[0]?.total ?? 0),
      };
    },
  });
}
