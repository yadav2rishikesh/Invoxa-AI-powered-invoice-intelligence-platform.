import Papa from "papaparse";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

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
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.slice(0, previewRows), totalRows: rows.length, previewOnly: true };
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
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows, totalRows: rows.length };
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

// ============== Processing ==============

export type ProgressUpdate = {
  processed: number;
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
  rowsPerSec: number;
  elapsedMs: number;
  etaMs: number;
};

export type UploadError = {
  row: number;
  errorType: string;
  error: string;
  data: Record<string, unknown>;
};

export type UploadResult = {
  batchId: string;
  total: number;
  imported: number;
  duplicates: number;
  failed: number;
  elapsedMs: number;
  rowsPerSec: number;
  errors: UploadError[];
};

const CHUNK = 500;

export async function processUpload(opts: {
  file: File;
  invoiceType: InvoiceType;
  mapping: Partial<Record<FieldKey, string>>;
  onProgress?: (p: ProgressUpdate) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const { file, invoiceType, mapping, onProgress, signal } = opts;

  const { rows, totalRows } = await parseAll(file);

  const { data: batch, error: batchErr } = await supabase
    .from("upload_batches")
    .insert({
      filename: file.name,
      invoice_type: invoiceType,
      total_rows: totalRows,
      status: "processing",
    })
    .select()
    .single();
  if (batchErr || !batch) throw new Error(`Batch create failed: ${batchErr?.message}`);

  // Persist mapping memory (fire & forget)
  rememberMappings(mapping, invoiceType).catch(() => {});

  const start = Date.now();
  const partyTable = invoiceType === "sales" ? "customers" : "suppliers";
  const partyFk = invoiceType === "sales" ? "customer_id" : "supplier_id";
  const partyCache = new Map<string, string>();

  async function getOrCreateParty(name: string, gstin: string | null): Promise<string> {
    const key = (gstin || name).toLowerCase();
    if (partyCache.has(key)) return partyCache.get(key)!;
    if (gstin) {
      const { data } = await supabase.from(partyTable).select("id").eq("gstin", gstin).maybeSingle();
      if (data) { partyCache.set(key, data.id); return data.id; }
    }
    const { data: existing } = await supabase
      .from(partyTable).select("id").eq("name", name).limit(1).maybeSingle();
    if (existing) { partyCache.set(key, existing.id); return existing.id; }
    const { data: created, error } = await supabase
      .from(partyTable).insert({ name, gstin: gstin || null }).select("id").single();
    if (error || !created) throw new Error(`${partyTable} create failed: ${error?.message}`);
    partyCache.set(key, created.id);
    return created.id;
  }

  let processed = 0, imported = 0, duplicates = 0, failed = 0;
  const errors: UploadError[] = [];
  const errorBuffer: Array<{
    batch_id: string; row_number: number; row_data: unknown; error_type: string; error: string;
  }> = [];

  const get = (row: Record<string, unknown>, k: FieldKey) =>
    mapping[k] ? row[mapping[k]!] : undefined;

  function pushError(row: number, type: string, message: string, data: Record<string, unknown>) {
    failed++;
    const e = { row, errorType: type, error: message, data };
    errors.push(e);
    errorBuffer.push({
      batch_id: batch.id, row_number: row, row_data: data, error_type: type, error: message,
    });
  }

  async function flushErrors() {
    if (!errorBuffer.length) return;
    const slice = errorBuffer.splice(0, errorBuffer.length);
    await supabase.from("upload_errors").insert(slice);
  }

  let lastTick = Date.now();

  for (let i = 0; i < rows.length; i += CHUNK) {
    if (signal?.aborted) throw new Error("Upload cancelled");
    const slice = rows.slice(i, i + CHUNK);
    const toInsert: Record<string, unknown>[] = [];

    for (let j = 0; j < slice.length; j++) {
      const row = slice[j];
      const rowNum = i + j + 2; // +2 for header + 1-index
      try {
        const invoice_number = String(get(row, "invoice_number") ?? "").trim();
        const partyName = String(get(row, "party_name") ?? "").trim();
        const date = parseDate(get(row, "invoice_date"));
        const total = parseAmount(get(row, "total_amount"));

        if (!invoice_number) throw Object.assign(new Error("Missing invoice_number"), { type: "validation" });
        if (!partyName) throw Object.assign(new Error("Missing party name"), { type: "validation" });
        if (!date) throw Object.assign(new Error("Invalid invoice_date"), { type: "validation" });
        if (total == null) throw Object.assign(new Error("Invalid total_amount"), { type: "validation" });

        const gstin = get(row, "gstin") ? String(get(row, "gstin")).trim() : null;
        const partyId = await getOrCreateParty(partyName, gstin);

        const hash = await sha256Hex(
          `${invoiceType}|${invoice_number}|${partyId}|${date}|${total}`,
        );

        // Build raw_data of unmapped columns
        const mappedCols = new Set(Object.values(mapping).filter(Boolean) as string[]);
        const raw: Record<string, unknown> = {};
        for (const k of Object.keys(row)) if (!mappedCols.has(k)) raw[k] = row[k];

        toInsert.push({
          batch_id: batch.id,
          invoice_type: invoiceType,
          [partyFk]: partyId,
          invoice_number,
          invoice_date: date,
          due_date: parseDate(get(row, "due_date")),
          subtotal: parseAmount(get(row, "subtotal")),
          total_amount: total,
          tax_amount: parseAmount(get(row, "tax_amount")) ?? 0,
          discount: parseAmount(get(row, "discount")) ?? 0,
          gstin,
          hsn_code: get(row, "hsn_code") ? String(get(row, "hsn_code")).trim() : null,
          notes: get(row, "notes") ? String(get(row, "notes")) : null,
          row_hash: hash,
          raw_data: Object.keys(raw).length ? raw : null,
          __rowNum: rowNum,
        });
      } catch (e: unknown) {
        const err = e as { message?: string; type?: string };
        pushError(rowNum, err.type ?? "validation", err.message ?? String(e), row);
      }
    }

    if (toInsert.length) {
      const payload = toInsert.map(({ __rowNum, ...rest }) => rest);
      const { error: insErr, data: inserted } = await supabase
        .from("invoices")
        .insert(payload)
        .select("id");

      if (insErr) {
        // Likely duplicate hash collision in chunk — retry one by one to count duplicates vs failures
        for (let k = 0; k < toInsert.length; k++) {
          const item = toInsert[k];
          const { __rowNum, ...rest } = item;
          const { error: oneErr } = await supabase.from("invoices").insert(rest);
          if (!oneErr) imported++;
          else if (/duplicate|unique/i.test(oneErr.message)) duplicates++;
          else pushError(Number(__rowNum), "db_error", oneErr.message, rest as Record<string, unknown>);
        }
      } else {
        imported += inserted?.length ?? toInsert.length;
      }
    }

    processed = Math.min(i + slice.length, rows.length);

    // Throttle DB writes for batch progress
    const now = Date.now();
    if (now - lastTick > 500 || processed === rows.length) {
      lastTick = now;
      await supabase.from("upload_batches").update({
        processed, imported, duplicates, failed,
      }).eq("id", batch.id);
      await flushErrors();
    }

    if (onProgress) {
      const elapsed = Date.now() - start;
      const rps = elapsed > 0 ? processed / (elapsed / 1000) : 0;
      const eta = rps > 0 ? ((rows.length - processed) / rps) * 1000 : 0;
      onProgress({
        processed, total: rows.length, imported, duplicates, failed,
        rowsPerSec: rps, elapsedMs: elapsed, etaMs: eta,
      });
    }
  }

  await flushErrors();
  const elapsed = Date.now() - start;
  await supabase.from("upload_batches").update({
    processed, imported, duplicates, failed,
    status: "completed", completed_at: new Date().toISOString(),
  }).eq("id", batch.id);

  return {
    batchId: batch.id,
    total: rows.length,
    imported, duplicates, failed,
    elapsedMs: elapsed,
    rowsPerSec: elapsed > 0 ? rows.length / (elapsed / 1000) : 0,
    errors,
  };
}
