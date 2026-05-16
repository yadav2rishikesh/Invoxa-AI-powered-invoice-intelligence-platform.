import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/format";

export const Route = createFileRoute("/invoices")({
  head: () => ({ meta: [{ title: "Invoices" }] }),
  component: InvoicesPage,
});

function InvoicesPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | "sales" | "purchase">("all");
  const [status, setStatus] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["invoices-list", type, status],
    queryFn: async () => {
      let q = supabase
        .from("invoices")
        .select(
          "id, invoice_number, invoice_date, total_amount, status, invoice_type, customers(name), suppliers(name)",
        )
        .order("invoice_date", { ascending: false })
        .limit(500);
      if (type !== "all") q = q.eq("invoice_type", type);
      if (status !== "all") q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return [];
      return data ?? [];
    },
  });

  const rows = (data ?? []).filter((r: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      String(r.invoice_number ?? "").toLowerCase().includes(s) ||
      String(r.customers?.name ?? "").toLowerCase().includes(s) ||
      String(r.suppliers?.name ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="text-sm text-muted-foreground">All sales and purchase invoices</p>
        </div>
        <Link to="/dashboard" className="text-sm text-primary hover:underline">
          ← Back to dashboard
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Search by number or party…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-[260px]"
            />
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="purchase">Purchase</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Party</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    No invoices found. Try{" "}
                    <Link to="/upload" className="text-primary hover:underline">
                      uploading invoices
                    </Link>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.invoice_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                    <TableCell className="capitalize">{r.invoice_type}</TableCell>
                    <TableCell>{r.customers?.name ?? r.suppliers?.name ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(r.total_amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {r.status ?? "—"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
