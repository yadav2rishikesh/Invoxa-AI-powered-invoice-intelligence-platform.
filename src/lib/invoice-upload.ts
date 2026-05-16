import Papa from "papaparse";
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";

async function readXlsx(file: File, limit?: number): Promise<{ columns: string[]; rows: Record<string, unknown>[]; totalRows: number }> {
  const buf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return { columns: [], rows: [], totalRows: 0 };
  const headerRow = sheet.getRow(1);
  const columns: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    columns.push(String(cell.value ?? "").trim());
  });
  const rows: Record<string, unknown>[] = [];
  const total = Math.max(0, sheet.rowCount - 1);
  const max = limit ? Math.min(limit + 1, sheet.rowCount) : sheet.rowCount;
  for (let r = 2; r <= max; r++) {
    const row = sheet.getRow(r);
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      const v = row.getCell(i + 1).value;
      obj[col] = v && typeof v === "object" && "text" in (v as object)
        ? (v as { text: string }).text
        : v instanceof Date
        ? v
        : v ?? "";
    });
    rows.push(obj);
  }
  return { columns, rows, totalRows: total };
}

export type InvoiceType = "sales" | "purchase";

export type FieldKey =
  | "invoice_number"
  | "invoice_date"
  | "party_name" // customer_name (sales) or supplier_name (purchase)
  | "total_amount"
  | "due_date"
  | "subtotal"
  | "tax_amount"
  | "discount"
  | "gstin"
  | "hsn_code"
  | "notes";

export type FieldDef = {
  key: FieldKey;
  label: (t: InvoiceType) => string;
  required: boolean;
};

export const FIELDS: FieldDef[] = [
  { key: "invoice_number", label: () => "Invoice Number", required: true },
  { key: "invoice_date", label: () => "Invoice Date", required: true },
  { key: "party_name", label: (t) => (t === "sales" ? "Customer Name" : "Supplier Name"), required: true },
  { key: "total_amount", label: () => "Total Amount", required: true },
  { key: "due_date", label: () => "Due Date", required: false },
  { key: "subtotal", label: () => "Subtotal", required: false },
  { key: "tax_amount", label: () => "Tax Amount", required: false },
  { key: "discount", label: () => "Discount", required: false },
  { key: "gstin", label: () => "GSTIN", required: false },
  { key: "hsn_code", label: () => "HSN Code", required: false },
  { key: "notes", label: () => "Notes", required: false },
];

const PATTERNS: Record<FieldKey, RegExp[]> = {
  invoice_number: [/^inv(oice)?\s*(no|num|number|#)?$/i, /^bill\s*(no|num)?$/i, /^doc(ument)?\s*(no|num)?$/i],
  invoice_date: [/^(inv(oice)?|bill)?\s*date$/i, /^issued?$/i, /^doc(ument)?\s*date$/i],
  party_name: [/^(customer|client|supplier|vendor|party|bill\s*to|ship\s*to)\s*(name)?$/i],
  total_amount: [/^(grand\s*)?total(\s*amount)?$/i, /^net\s*amount$/i, /^invoice\s*total$/i, /^amount$/i],
  due_date: [/^due\s*date$/i, /^payment\s*due$/i],
  subtotal: [/^sub\s*total$/i, /^taxable\s*amount$/i, /^base\s*amount$/i],
  tax_amount: [/^(tax|gst|vat|igst|cgst|sgst)(\s*amount)?$/i],
  discount: [/^discount(\s*amount)?$/i, /^disc$/i],
  gstin: [/^gst(in)?(\s*(no|num))?$/i, /^tax\s*id$/i],
  hsn_code: [/^hsn(\s*code)?$/i, /^sac(\s*code)?$/i],
  notes: [/^notes?$/i, /^remarks?$/i, /^description$/i],
};

const norm = (s: string) => s.toLowerCase().trim().replace(/[._\-]+/g, " ").replace(/\s+/g, " ");

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

export type DetectedMapping = {
  field: FieldKey;
  column: string;
  confidence: number; // 0-1
  source: "history" | "fuzzy" | "pattern";
};

export async function smartDetect(
  columns: string[],
  invoiceType: InvoiceType,
): Promise<Partial<Record<FieldKey, DetectedMapping>>> {
  const result: Partial<Record<FieldKey, DetectedMapping>> = {};
  const used = new Set<string>();

  // 1) History — exact + fuzzy
  const { data: history } = await supabase
    .from("column_mapping_history")
    .select("source_column, target_field, use_count")
    .eq("invoice_type", invoiceType);

  if (history?.length) {
    for (const col of columns) {
      const nc = norm(col);
      const exact = history.find((h) => norm(h.source_column) === nc);
      if (exact && !used.has(col)) {
        const f = exact.target_field as FieldKey;
        if (!result[f]) {
          result[f] = { field: f, column: col, confidence: 1, source: "history" };
          used.add(col);
        }
      }
    }
    for (const col of columns) {
      if (used.has(col)) continue;
      const nc = norm(col);
      let best: { h: typeof history[number]; dist: number } | null = null;
      for (const h of history) {
        const d = levenshtein(nc, norm(h.source_column));
        const max = Math.max(nc.length, h.source_column.length);
        if (max === 0) continue;
        if (!best || d < best.dist) best = { h, dist: d };
      }
      if (best) {
        const max = Math.max(nc.length, best.h.source_column.length);
        const sim = 1 - best.dist / max;
        if (sim >= 0.75) {
          const f = best.h.target_field as FieldKey;
          if (!result[f]) {
            result[f] = { field: f, column: col, confidence: sim, source: "fuzzy" };
            used.add(col);
          }
        }
      }
    }
  }

  // 2) Pattern fallback
  for (const f of FIELDS) {
    if (result[f.key]) continue;
    const patterns = PATTERNS[f.key];
    for (const col of columns) {
      if (used.has(col)) continue;
      const nc = norm(col);
      if (patterns.some((p) => p.test(nc))) {
        result[f.key] = { field: f.key, column: col, confidence: 0.85, source: "pattern" };
        used.add(col);
        break;
      }
    }
    if (result[f.key]) continue;
    // partial contains
    for (const col of columns) {
      if (used.has(col)) continue;
      const nc = norm(col);
      if (patterns.some((p) => p.test(nc.replace(/\s+/g, "")))) {
        result[f.key] = { field: f.key, column: col, confidence: 0.6, source: "pattern" };
        used.add(col);
        break;
      }
    }
  }

  return result;
}

export async function rememberMappings(
  mapping: Partial<Record<FieldKey, string>>,
  invoiceType: InvoiceType,
) {
  const rows = Object.entries(mapping)
    .filter(([, col]) => !!col)
    .map(([field, col]) => ({
      source_column: col!,
      target_field: field,
      invoice_type: invoiceType,
      use_count: 1,
      last_used_at: new Date().toISOString(),
    }));
  if (!rows.length) return;
  // upsert by unique (source_column,target_field,invoice_type)
  await supabase
    .from("column_mapping_history")
    .upsert(rows, { onConflict: "source_column,target_field,invoice_type", ignoreDuplicates: false });
}

// ============== Parsing ==============

export type ParseResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  delimiter?: string;
};

export async function parsePreview(file: File, previewRows = 10): Promise<ParseResult & { previewOnly: true }> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      const all: Record<string, unknown>[] = [];
      let columns: string[] = [];
      let delimiter = "";
      let total = 0;
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        worker: false,
        chunk: (chunk, parser) => {
          if (!columns.length) {
            columns = chunk.meta.fields ?? [];
            delimiter = chunk.meta.delimiter ?? "";
          }
          for (const r of chunk.data) {
            total++;
            if (all.length < previewRows) all.push(r);
          }
          // Don't abort — we need accurate total. Streaming via chunk avoids memory blow-up.
        },
        complete: () => resolve({ columns, rows: all, totalRows: total, delimiter, previewOnly: true }),
        error: reject,
      });
    });
  }
  const { columns, rows, totalRows } = await readXlsx(file, previewRows);
  return { columns, rows, totalRows, previewOnly: true };
}

export async function parseAll(file: File): Promise<ParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => {
          const columns = res.meta.fields ?? Object.keys(res.data[0] ?? {});
          resolve({ columns, rows: res.data, totalRows: res.data.length, delimiter: res.meta.delimiter });
        },
        error: reject,
      });
    });
  }
  return readXlsx(file);
}

// ============== Normalization ==============

export function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[₹$€£,\s]/g, "").replace(/[^\d.\-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

export function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, a, b, y] = m;
    const ai = parseInt(a), bi = parseInt(b);
    let day: number, mon: number;
    if (ai > 12) { day = ai; mon = bi; }
    else if (bi > 12) { mon = ai; day = bi; }
    else { day = ai; mon = bi; }
    const yr = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    return `${yr}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Server-side processing now lives in the `process-invoice-batch` edge function.
// This module only handles client-side parsing & column detection.

