import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export type FieldKey =
  | "invoice_number"
  | "invoice_date"
  | "customer_name"
  | "total_amount"
  | "tax_amount"
  | "gstin";

export const FIELDS: { key: FieldKey; label: string; required: boolean }[] = [
  { key: "invoice_number", label: "Invoice Number", required: true },
  { key: "invoice_date", label: "Invoice Date", required: true },
  { key: "customer_name", label: "Customer Name", required: true },
  { key: "total_amount", label: "Total Amount", required: true },
  { key: "tax_amount", label: "Tax Amount", required: false },
  { key: "gstin", label: "Customer GSTIN", required: false },
];

const VARIANTS: Record<FieldKey, string[]> = {
  invoice_number: ["invoice no", "invoice number", "bill no", "inv #", "inv no", "invoice#", "invoice"],
  invoice_date: ["date", "invoice date", "bill date", "inv date", "issued"],
  customer_name: ["customer", "customer name", "client name", "bill to", "client", "party"],
  total_amount: ["total", "amount", "grand total", "total amount", "net amount", "invoice total"],
  tax_amount: ["gst", "tax", "vat", "tax amount", "gst amount"],
  gstin: ["gstin", "gst no", "gst number", "tax id"],
};

export function autoDetect(columns: string[]): Partial<Record<FieldKey, string>> {
  const map: Partial<Record<FieldKey, string>> = {};
  const norm = (s: string) => s.toLowerCase().trim().replace(/[._-]+/g, " ");
  for (const f of FIELDS) {
    const variants = VARIANTS[f.key];
    const found = columns.find((c) => variants.some((v) => norm(c) === v));
    if (found) map[f.key] = found;
    else {
      const partial = columns.find((c) => variants.some((v) => norm(c).includes(v)));
      if (partial) map[f.key] = partial;
    }
  }
  return map;
}

export async function parseFile(file: File): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const rows = res.data;
          const columns = res.meta.fields ?? Object.keys(rows[0] ?? {});
          resolve({ columns, rows });
        },
        error: reject,
      });
    });
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows };
}

export function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[₹$,\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // DD/MM/YYYY or MM/DD/YYYY (assume DD/MM if first > 12)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [_, a, b, y] = m;
    const ai = parseInt(a), bi = parseInt(b);
    let day: number, mon: number;
    if (ai > 12) { day = ai; mon = bi; }
    else if (bi > 12) { mon = ai; day = bi; }
    else { day = ai; mon = bi; } // default DD/MM
    const yr = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    return `${yr}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export type UploadResult = {
  batchId: string | null;
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
  errors: { row: number; error: string; data: Record<string, unknown> }[];
};

export async function processUpload(
  filename: string,
  rows: Record<string, unknown>[],
  mapping: Partial<Record<FieldKey, string>>,
  onProgress?: (pct: number) => void,
): Promise<UploadResult> {
  const result: UploadResult = {
    batchId: null,
    total: rows.length,
    imported: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
  };

  const { data: batch, error: batchErr } = await supabase
    .from("upload_batches")
    .insert({ filename, total_rows: rows.length, status: "processing" })
    .select()
    .single();

  if (batchErr || !batch) {
    throw new Error(`Failed to create batch: ${batchErr?.message ?? "unknown"}`);
  }
  result.batchId = batch.id;

  const customerCache = new Map<string, string>();

  async function getOrCreateCustomer(name: string, gstin?: string | null): Promise<string> {
    const key = (gstin || name).toLowerCase();
    if (customerCache.has(key)) return customerCache.get(key)!;

    if (gstin) {
      const { data } = await supabase.from("customers").select("id").eq("gstin", gstin).maybeSingle();
      if (data) { customerCache.set(key, data.id); return data.id; }
    }
    const { data: existing } = await supabase
      .from("customers").select("id").eq("name", name).limit(1).maybeSingle();
    if (existing) { customerCache.set(key, existing.id); return existing.id; }

    const { data: created, error } = await supabase
      .from("customers").insert({ name, gstin: gstin || null }).select("id").single();
    if (error || !created) throw new Error(`Customer create failed: ${error?.message}`);
    customerCache.set(key, created.id);
    return created.id;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const get = (k: FieldKey) => (mapping[k] ? row[mapping[k]!] : undefined);
      const invoice_number = String(get("invoice_number") ?? "").trim();
      const customer_name = String(get("customer_name") ?? "").trim();
      const date = parseDate(get("invoice_date"));
      const total = parseAmount(get("total_amount"));
      const tax = parseAmount(get("tax_amount")) ?? 0;
      const gstin = get("gstin") ? String(get("gstin")).trim() : null;

      if (!invoice_number) throw new Error("Missing invoice_number");
      if (!customer_name) throw new Error("Missing customer_name");
      if (!date) throw new Error("Invalid invoice_date");
      if (total == null) throw new Error("Invalid total_amount");

      const customerId = await getOrCreateCustomer(customer_name, gstin);

      const { data: dup } = await supabase
        .from("invoices")
        .select("id")
        .eq("invoice_number", invoice_number)
        .eq("customer_id", customerId)
        .eq("invoice_date", date)
        .maybeSingle();

      if (dup) {
        result.duplicates++;
      } else {
        const { error: insErr } = await supabase.from("invoices").insert({
          batch_id: batch.id,
          customer_id: customerId,
          invoice_number,
          invoice_date: date,
          total_amount: total,
          tax_amount: tax,
        });
        if (insErr) throw new Error(insErr.message);
        result.imported++;
      }
    } catch (e: any) {
      result.failed++;
      const err = { row: i + 2, error: e?.message ?? String(e), data: row };
      result.errors.push(err);
      await supabase.from("upload_errors").insert({
        batch_id: batch.id,
        row_number: err.row,
        row_data: row,
        error: err.error,
      });
    }
    if (onProgress) onProgress(Math.round(((i + 1) / rows.length) * 100));
  }

  await supabase.from("upload_batches").update({
    imported: result.imported,
    duplicates: result.duplicates,
    failed: result.failed,
    status: "completed",
  }).eq("id", batch.id);

  return result;
}
