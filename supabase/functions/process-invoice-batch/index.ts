// Supabase Edge Function: process-invoice-batch
// Deploy: supabase functions deploy process-invoice-batch
//
// Required RPCs in your Supabase project:
//   - find_or_create_customer(p_name text, p_gstin text) returns uuid
//   - find_or_create_supplier(p_name text, p_gstin text) returns uuid
//   - bulk_insert_invoices(p_rows jsonb) returns int
//
// Required tables: upload_batches, invoices, upload_errors (already in schema.sql)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────
// Input schema
// ─────────────────────────────────────────────────────────────
const InputSchema = z.object({
  batch_id: z.string().uuid(),
  file_url: z.string().url(),
  file_type: z.enum(["csv", "xlsx", "xls"]),
  invoice_type: z.enum(["sales", "purchase"]),
  // Optional explicit mapping; otherwise auto-detect.
  column_mapping: z.record(z.string(), z.string()).optional(),
});
type Input = z.infer<typeof InputSchema>;

// ─────────────────────────────────────────────────────────────
// Column auto-detection
// ─────────────────────────────────────────────────────────────
const FIELD_PATTERNS: Record<string, RegExp[]> = {
  invoice_number: [/invoice\s*(no|num|#)/i, /bill\s*(no|num)/i, /^inv$/i],
  invoice_date: [/invoice\s*date/i, /bill\s*date/i, /^date$/i],
  party_name: [/customer|client|buyer|supplier|vendor|party/i, /name/i],
  party_gstin: [/gstin/i, /gst\s*no/i, /tax\s*id/i],
  total_amount: [/total\s*amount/i, /grand\s*total/i, /amount/i, /^total$/i],
  tax_amount: [/tax\s*amount/i, /gst\s*amount/i, /^tax$/i],
  subtotal: [/subtotal|sub\s*total|taxable/i],
  status: [/status|state/i],
};

function detectColumns(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    for (const h of headers) {
      if (patterns.some((p) => p.test(h))) {
        map[field] = h;
        break;
      }
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// Value normalization
// ─────────────────────────────────────────────────────────────
function cleanAmount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return raw;
  const cleaned = String(raw).replace(/[₹$€£,\s]/g, "").replace(/[()]/g, "-");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const DATE_FORMATS: Array<(s: string) => Date | null> = [
  // ISO YYYY-MM-DD
  (s) => {
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  },
  // DD/MM/YYYY or DD-MM-YYYY
  (s) => {
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
    if (!m) return null;
    const d = +m[1];
    const mo = +m[2];
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    if (d > 12) return new Date(y, mo - 1, d); // unambiguous DD/MM
    if (mo > 12) return new Date(y, d - 1, mo); // MM/DD swapped
    return new Date(y, mo - 1, d); // default DD/MM (Indian)
  },
  // Excel serial date number passed as string
  (s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 10000 || n > 60000) return null;
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  },
];

function parseDate(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  for (const fn of DATE_FORMATS) {
    const d = fn(s);
    if (d && !isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? null : fallback.toISOString().slice(0, 10);
}

// SHA-256 hash for deduplication: invoice_type|invoice_number|party|date|amount
async function rowHash(parts: Array<string | number | null>): Promise<string> {
  const data = new TextEncoder().encode(parts.map((p) => String(p ?? "")).join("|"));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────
// Streaming CSV parser (line-by-line, handles quoted fields)
// ─────────────────────────────────────────────────────────────
async function* streamCsvRows(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string[]> {
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line) yield parseCsvLine(line);
    }
  }
  if (buf.trim()) yield parseCsvLine(buf);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// ─────────────────────────────────────────────────────────────
// Row → invoice transformation
// ─────────────────────────────────────────────────────────────
async function transformRow(
  rowObj: Record<string, unknown>,
  mapping: Record<string, string>,
  invoiceType: "sales" | "purchase",
  batchId: string,
  resolveParty: (name: string, gstin: string | null) => Promise<string | null>,
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; reason: string }> {
  const get = (field: string) => (mapping[field] ? rowObj[mapping[field]] : undefined);
  const invoiceNumber = String(get("invoice_number") ?? "").trim();
  const invoiceDate = parseDate(get("invoice_date"));
  const totalAmount = cleanAmount(get("total_amount"));
  const partyName = String(get("party_name") ?? "").trim();

  if (!invoiceNumber) return { ok: false, reason: "Missing invoice number" };
  if (!invoiceDate) return { ok: false, reason: "Invalid or missing date" };
  if (totalAmount == null) return { ok: false, reason: "Invalid amount" };
  if (!partyName) return { ok: false, reason: "Missing party name" };

  const gstin = String(get("party_gstin") ?? "").trim() || null;
  const partyId = await resolveParty(partyName, gstin);
  const hash = await rowHash([invoiceType, invoiceNumber, partyName, invoiceDate, totalAmount]);

  return {
    ok: true,
    row: {
      batch_id: batchId,
      invoice_type: invoiceType,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      total_amount: totalAmount,
      tax_amount: cleanAmount(get("tax_amount")) ?? 0,
      subtotal: cleanAmount(get("subtotal")),
      gstin,
      [invoiceType === "sales" ? "customer_id" : "supplier_id"]: partyId,
      row_hash: hash,
      raw_data: rowObj,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Main processor
// ─────────────────────────────────────────────────────────────
async function processBatch(supabase: SupabaseClient, input: Input) {
  const startedAt = Date.now();
  const stats = { total_rows: 0, processed: 0, successful: 0, duplicates: 0, failed: 0 };

  await supabase
    .from("upload_batches")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", input.batch_id);

  // Cache party lookups within this batch
  const partyCache = new Map<string, string | null>();
  const resolveParty = async (name: string, gstin: string | null) => {
    const key = `${name}::${gstin ?? ""}`;
    if (partyCache.has(key)) return partyCache.get(key)!;
    const rpc = input.invoice_type === "sales" ? "find_or_create_customer" : "find_or_create_supplier";
    const { data, error } = await supabase.rpc(rpc, { p_name: name, p_gstin: gstin });
    const id = error ? null : (data as string | null);
    partyCache.set(key, id);
    return id;
  };

  // Fetch file
  const res = await fetch(input.file_url);
  if (!res.ok || !res.body) throw new Error(`Failed to fetch file (${res.status})`);

  // Build row iterator
  let rowIterator: AsyncGenerator<Record<string, unknown>>;
  let headers: string[] = [];

  if (input.file_type === "csv") {
    const reader = res.body.getReader();
    rowIterator = (async function* () {
      let isFirst = true;
      for await (const cells of streamCsvRows(reader)) {
        if (isFirst) {
          headers = cells;
          isFirst = false;
          continue;
        }
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => (obj[h] = cells[i]));
        yield obj;
      }
    })();
  } else {
    // XLSX requires full buffer; not truly streamable in workerd
    const buf = new Uint8Array(await res.arrayBuffer());
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    headers = json.length ? Object.keys(json[0]) : [];
    rowIterator = (async function* () {
      for (const r of json) yield r;
    })();
  }

  // Resolve mapping after we have headers (peek first row for csv)
  let mapping = input.column_mapping;
  let pending: Record<string, unknown>[] = [];

  // For CSV we need to advance once to have headers populated
  const firstRow = await rowIterator.next();
  if (!firstRow.done) pending.push(firstRow.value);
  if (!mapping) mapping = detectColumns(headers);

  const CHUNK = 500;
  const errors: Array<{ row_number: number; row_data: unknown; error_type: string; error: string }> = [];
  let chunk: Record<string, unknown>[] = [];
  let rowNum = 0;

  const flushChunk = async () => {
    if (chunk.length === 0) return;
    const { error } = await supabase.rpc("bulk_insert_invoices", { p_rows: chunk });
    if (error) {
      // dedupe-aware fallback: try one-by-one to count duplicates vs failures
      for (const row of chunk) {
        const { error: rowErr } = await supabase.from("invoices").insert(row);
        if (rowErr) {
          if (/duplicate key|row_hash/i.test(rowErr.message)) stats.duplicates++;
          else {
            stats.failed++;
            errors.push({
              row_number: 0,
              row_data: row,
              error_type: "insert_error",
              error: rowErr.message,
            });
          }
        } else stats.successful++;
      }
    } else {
      stats.successful += chunk.length;
    }
    chunk = [];
  };

  const processRow = async (raw: Record<string, unknown>) => {
    rowNum++;
    stats.total_rows++;
    try {
      const result = await transformRow(raw, mapping!, input.invoice_type, input.batch_id, resolveParty);
      if (!result.ok) {
        stats.failed++;
        errors.push({ row_number: rowNum, row_data: raw, error_type: "validation", error: result.reason });
        return;
      }
      chunk.push(result.row);
      if (chunk.length >= CHUNK) await flushChunk();
    } catch (e) {
      stats.failed++;
      errors.push({
        row_number: rowNum,
        row_data: raw,
        error_type: "exception",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      stats.processed++;
      if (stats.processed % 1000 === 0) {
        await supabase.from("upload_batches").update({ ...stats }).eq("id", input.batch_id);
      }
    }
  };

  for (const row of pending) await processRow(row);
  for await (const row of rowIterator) await processRow(row);
  await flushChunk();

  // Persist errors (cap to 1000 to avoid runaway)
  if (errors.length) {
    const slice = errors.slice(0, 1000).map((e) => ({ ...e, batch_id: input.batch_id }));
    await supabase.from("upload_errors").insert(slice);
  }

  const elapsed = Date.now() - startedAt;
  await supabase
    .from("upload_batches")
    .update({
      ...stats,
      imported: stats.successful,
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.batch_id);

  return {
    success: true,
    batch_id: input.batch_id,
    stats: {
      ...stats,
      processing_time_ms: elapsed,
      rows_per_second: elapsed ? Math.round((stats.processed / elapsed) * 1000) : 0,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let batchId: string | undefined;
  try {
    const body = await req.json();
    const input = InputSchema.parse(body);
    batchId = input.batch_id;
    const result = await processBatch(supabase, input);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (batchId) {
      await supabase
        .from("upload_batches")
        .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
        .eq("id", batchId);
    }
    return new Response(JSON.stringify({ success: false, error: message, batch_id: batchId }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
