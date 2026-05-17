import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar as CalendarIcon,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";
import {
  calculatePercentChange,
  formatCurrency,
  formatDate,
  formatNumber,
  getDateRange,
  type DateRangePreset,
} from "@/lib/format";
import {
  useDashboardStats,
  useInvoiceStatusDistribution,
  useMonthlyChart,
  useQuickStats,
  useRecentBatches,
  useRecentErrors,
  useRecentInvoices,
  useRegionDistribution,
  useSparkline,
  useTopCustomers,
  useTopSuppliers,
} from "@/lib/dashboard-queries";

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "all_time", label: "All Time" },
];

const STATUS_COLORS: Record<string, string> = {
  paid: "hsl(142 71% 45%)",
  sent: "hsl(217 91% 60%)",
  partial: "hsl(38 92% 50%)",
  overdue: "hsl(0 84% 60%)",
  cancelled: "hsl(220 9% 46%)",
  unknown: "hsl(220 9% 60%)",
};

const PIE_COLORS = [
  "hsl(217 91% 60%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(280 70% 55%)",
  "hsl(340 82% 55%)",
  "hsl(220 9% 60%)",
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    sent: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    partial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    overdue: "bg-red-500/15 text-red-700 dark:text-red-300",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={`${map[status] ?? "bg-muted"} border-0 capitalize`}>
      {status ?? "—"}
    </Badge>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const pct = calculatePercentChange(current, previous);
  const up = pct >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
        up ? "text-emerald-600" : "text-red-600"
      }`}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function Sparkline({ data, color }: { data: { d: string; v: number }[]; color: string }) {
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  current: number;
  previous: number;
  spark: { d: string; v: number }[] | undefined;
  loading: boolean;
  color: string;
  href?: string;
}

function KpiCard({ label, value, current, previous, spark, loading, color, href }: KpiCardProps) {
  const inner = (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-28" />
            ) : (
              <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
            )}
            <div className="mt-1">
              {loading ? <Skeleton className="h-3 w-16" /> : <Delta current={current} previous={previous} />}
            </div>
          </div>
          <div className="w-24">
            {loading ? <Skeleton className="h-10 w-24" /> : <Sparkline data={spark ?? []} color={color} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link to={href}>{inner}</Link> : inner;
}

export function Dashboard() {
  const [preset, setPreset] = useState<DateRangePreset>("all_time");
  const [compare, setCompare] = useState(true);
  const range = useMemo(() => getDateRange(preset), [preset]);

  const queryClient = useQueryClient();
  const stats = useDashboardStats(range);
  const monthly = useMonthlyChart(range);
  const sparkSales = useSparkline("sales");
  const sparkPurch = useSparkline("purchase");
  const sparkAll = useSparkline("all");
  const sparkPending = useSparkline("pending");
  const topCust = useTopCustomers(5);
  const topSup = useTopSuppliers(5);
  const recentInv = useRecentInvoices(10);
  const recentBatches = useRecentBatches(5);
  const recentErrors = useRecentErrors(5);
  const statusDist = useInvoiceStatusDistribution();
  const regionDist = useRegionDistribution();
  const quick = useQuickStats();

  const refresh = () => queryClient.invalidateQueries();

  const profitSpark = useMemo(() => {
    const a = sparkSales.data ?? [];
    const b = sparkPurch.data ?? [];
    return a.map((s, i) => ({ d: s.d, v: s.v - (b[i]?.v ?? 0) }));
  }, [sparkSales.data, sparkPurch.data]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      {/* HEADER */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of sales, purchases & cashflow</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border px-2 py-1">
            <Switch id="compare" checked={compare} onCheckedChange={setCompare} />
            <Label htmlFor="compare" className="text-xs">Compare prev.</Label>
          </div>
          <Select value={preset} onValueChange={(v) => setPreset(v as DateRangePreset)}>
            <SelectTrigger className="w-[180px]">
              <CalendarIcon className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={refresh} aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${stats.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* EMPTY STATE HINT */}
      {!stats.isLoading &&
        (stats.data?.sales ?? 0) === 0 &&
        (stats.data?.purchases ?? 0) === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-start gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">No invoices in this period</p>
                <p className="text-xs text-muted-foreground">
                  Try a wider date range, or upload invoices to get started.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreset("last_fy")}>
                  Try Last FY
                </Button>
                <Button asChild size="sm">
                  <Link to="/upload">Upload invoices</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Sales"
          value={formatCurrency(stats.data?.sales ?? 0, true)}
          current={stats.data?.sales ?? 0}
          previous={compare ? stats.data?.salesPrev ?? 0 : stats.data?.sales ?? 0}
          spark={sparkSales.data}
          loading={stats.isLoading}
          color="hsl(142 71% 45%)"
        />
        <KpiCard
          label="Total Purchases"
          value={formatCurrency(stats.data?.purchases ?? 0, true)}
          current={stats.data?.purchases ?? 0}
          previous={compare ? stats.data?.purchasesPrev ?? 0 : stats.data?.purchases ?? 0}
          spark={sparkPurch.data}
          loading={stats.isLoading}
          color="hsl(0 84% 60%)"
        />
        <KpiCard
          label="Net Profit"
          value={formatCurrency(stats.data?.profit ?? 0, true)}
          current={stats.data?.profit ?? 0}
          previous={compare ? stats.data?.profitPrev ?? 0 : stats.data?.profit ?? 0}
          spark={profitSpark}
          loading={stats.isLoading}
          color="hsl(217 91% 60%)"
        />
        <KpiCard
          label="Pending Invoices"
          value={formatNumber(stats.data?.pendingCount ?? 0)}
          current={stats.data?.pendingCount ?? 0}
          previous={stats.data?.pendingCount ?? 0}
          spark={sparkPending.data}
          loading={stats.isLoading}
          color="hsl(38 92% 50%)"
        />
      </div>

      {/* AREA CHART */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" /> Sales vs Purchases
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {formatDate(range.from)} — {formatDate(range.to)}
          </span>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            {monthly.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly.data ?? []} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-sales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(142 71% 45%)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g-purch" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(0 84% 60%)" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" stroke="currentColor" className="text-xs text-muted-foreground" />
                  <YAxis
                    stroke="currentColor"
                    className="text-xs text-muted-foreground"
                    tickFormatter={(v) => formatCurrency(v, true)}
                  />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Area type="monotone" dataKey="sales" name="Sales" stroke="hsl(142 71% 45%)" fill="url(#g-sales)" strokeWidth={2} />
                  <Area type="monotone" dataKey="purchases" name="Purchases" stroke="hsl(0 84% 60%)" fill="url(#g-purch)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* TOP CUSTOMERS / SUPPLIERS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Top Customers</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedList loading={topCust.isLoading} items={topCust.data ?? []} emptyLabel="No customer data yet" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Top Suppliers</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedList loading={topSup.isLoading} items={topSup.data ?? []} emptyLabel="No supplier data yet" />
          </CardContent>
        </Card>
      </div>

      {/* RECENT ACTIVITY */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="invoices">
            <TabsList>
              <TabsTrigger value="invoices">Recent Invoices</TabsTrigger>
              <TabsTrigger value="uploads">Recent Uploads</TabsTrigger>
              <TabsTrigger value="errors">Recent Errors</TabsTrigger>
            </TabsList>
            <TabsContent value="invoices" className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Number</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentInv.isLoading ? (
                    <SkeletonRows cols={5} />
                  ) : (recentInv.data ?? []).length === 0 ? (
                    <EmptyRow cols={5} label="No invoices yet" />
                  ) : (
                    recentInv.data!.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell>{formatDate(r.invoice_date)}</TableCell>
                        <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                        <TableCell>{r.customers?.name ?? r.suppliers?.name ?? "—"}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(r.total_amount)}</TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="uploads" className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead className="text-right">Success %</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentBatches.isLoading ? (
                    <SkeletonRows cols={5} />
                  ) : (recentBatches.data ?? []).length === 0 ? (
                    <EmptyRow cols={5} label="No uploads yet" />
                  ) : (
                    recentBatches.data!.map((b: any) => {
                      const total = b.total_rows ?? b.processed ?? 0;
                      const success = b.imported ?? 0;
                      const pct = total ? (success / total) * 100 : 0;
                      return (
                        <TableRow key={b.id}>
                          <TableCell className="max-w-[200px] truncate">{b.filename ?? "—"}</TableCell>
                          <TableCell>{formatDate(b.created_at)}</TableCell>
                          <TableCell className="text-right">{formatNumber(total)}</TableCell>
                          <TableCell className="text-right">{pct.toFixed(1)}%</TableCell>
                          <TableCell><StatusBadge status={b.status} /></TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TabsContent>
            <TabsContent value="errors" className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Batch</TableHead>
                    <TableHead>Row</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentErrors.isLoading ? (
                    <SkeletonRows cols={4} />
                  ) : (recentErrors.data ?? []).length === 0 ? (
                    <EmptyRow cols={4} label="No errors 🎉" />
                  ) : (
                    recentErrors.data!.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-mono text-xs">{String(e.batch_id ?? "").slice(0, 8)}</TableCell>
                        <TableCell>{e.row_number ?? "—"}</TableCell>
                        <TableCell>{e.error_type ?? "—"}</TableCell>
                        <TableCell className="max-w-[420px] truncate text-muted-foreground">{e.error_message}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* PIE CHARTS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Invoice Status</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {statusDist.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (statusDist.data ?? []).length === 0 ? (
                <EmptyState label="No invoices yet" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDist.data}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                    >
                      {(statusDist.data ?? []).map((d, i) => (
                        <Cell key={i} fill={STATUS_COLORS[d.name] ?? PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(_v, _n, p: any) =>
                        [`${p.payload.count} (${formatCurrency(p.payload.amount, true)})`, p.payload.name]
                      }
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Customers by Region</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {regionDist.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (regionDist.data ?? []).length === 0 ? (
                <EmptyState label="No customer data yet" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={regionDist.data} dataKey="value" nameKey="name" outerRadius={100}>
                      {(regionDist.data ?? []).map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* QUICK STATS */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 md:grid-cols-5">
          <Stat label="Total Invoices" value={formatNumber(quick.data?.totalInvoices ?? 0)} loading={quick.isLoading} />
          <Stat label="Customers" value={formatNumber(quick.data?.totalCustomers ?? 0)} loading={quick.isLoading} />
          <Stat label="Suppliers" value={formatNumber(quick.data?.totalSuppliers ?? 0)} loading={quick.isLoading} />
          <Stat label="Avg. Invoice" value={formatCurrency(quick.data?.avgInvoice ?? 0, true)} loading={quick.isLoading} />
          <Stat label="Pending Amount" value={formatCurrency(quick.data?.pendingAmount ?? 0, true)} loading={quick.isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="mt-1 h-6 w-20" /> : <p className="mt-1 text-lg font-semibold">{value}</p>}
    </div>
  );
}

function RankedList({
  loading,
  items,
  emptyLabel,
}: {
  loading: boolean;
  items: { name: string; gstin: string | null; total: number; count: number }[];
  emptyLabel: string;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (items.length === 0) return <EmptyState label={emptyLabel} />;
  return (
    <ol className="space-y-2">
      {items.map((c, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent/40"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{c.name}</p>
            <p className="text-xs text-muted-foreground">{c.count} invoice{c.count === 1 ? "" : "s"}</p>
          </div>
          {c.gstin && (
            <Badge variant="outline" className="hidden font-mono text-[10px] sm:inline-flex">
              {c.gstin}
            </Badge>
          )}
          <p className="text-sm font-semibold">{formatCurrency(c.total, true)}</p>
        </li>
      ))}
    </ol>
  );
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-8 text-center text-sm text-muted-foreground">
        {label}
      </TableCell>
    </TableRow>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
