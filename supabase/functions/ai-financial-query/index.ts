// Supabase Edge Function: ai-financial-query
// Deploy: supabase functions deploy ai-financial-query
// Required secrets in Supabase dashboard:
//   - DEEPSEEK_API_KEY
//   - SUPABASE_URL (auto)
//   - SUPABASE_SERVICE_ROLE_KEY (auto)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";

const SCHEMA_CONTEXT = `DATABASE SCHEMA:
- customers (id, name, gstin, email, phone, state, created_at)
- suppliers (id, name, gstin, email, phone, state, created_at)
- invoices (id, invoice_number, invoice_type, invoice_date, customer_id, supplier_id,
  subtotal, tax_amount, total_amount, status, created_at)
  - invoice_type: 'sales' or 'purchase'
  - status: 'draft', 'sent', 'paid', 'partial', 'overdue', 'cancelled'
- invoice_line_items (id, invoice_id, product_id, description, quantity,
  unit_price, taxable_amount, tax_amount, line_total)
- products (id, name, sku, hsn_code, default_price)
- transactions (id, invoice_id, transaction_type, amount, transaction_date)

USEFUL VIEWS:
- v_top_customers (id, name, total_sales, invoice_count)
- v_outstanding_invoices (id, invoice_number, days_overdue)
- mv_monthly_summary (month, invoice_type, total_amount, invoice_count)

INDIAN FY: April 1 - March 31
- FY 2023-24 = 2023-04-01 to 2024-03-31
- FY 2024-25 = 2024-04-01 to 2025-03-31`;

const SQL_SYSTEM_PROMPT = `You are a SQL expert for a finance application. Your job is to convert natural language queries into safe PostgreSQL SELECT statements.

${SCHEMA_CONTEXT}

RULES:
1. ONLY generate SELECT statements
2. Use the provided schema and views above
3. Always include LIMIT 1000 unless specifically asking for totals
4. Use ILIKE for case-insensitive text matching
5. Format dates correctly
6. Indian Financial Year: April 1 to March 31
7. Use COALESCE for nullable fields
8. Use proper aggregations (SUM, COUNT, AVG)
9. Return ONLY valid SQL - no explanations
10. NEVER use INSERT, UPDATE, DELETE, DROP, ALTER

When generating SQL:
- For "total sales" → SUM(total_amount) WHERE invoice_type='sales'
- For "FY 2023-24" → invoice_date BETWEEN '2023-04-01' AND '2024-03-31'
- For "January 2024" → invoice_date BETWEEN '2024-01-01' AND '2024-01-31'
- For "top customers" → use v_top_customers view
- For "outstanding" → use v_outstanding_invoices view

Output format: Just the SQL query, nothing else.`;

const INTENT_TYPES = [
  "total_aggregate",
  "comparison",
  "top_n",
  "trend",
  "specific_lookup",
  "count",
  "breakdown",
] as const;
type Intent = (typeof INTENT_TYPES)[number];

interface DeepseekResponse {
  choices: Array<{ message: { content: string } }>;
}

async function callLLM(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 1000,
): Promise<string> {
  const res = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${text}`);
  }
  const data = (await res.json()) as DeepseekResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

async function classifyIntent(apiKey: string, query: string): Promise<Intent> {
  const out = await callClaude(
    apiKey,
    `Classify the user's finance query into ONE of: ${INTENT_TYPES.join(", ")}. Reply with just the label, nothing else.`,
    query,
    20,
  );
  const lower = out.toLowerCase().replace(/[^a-z_]/g, "");
  return (INTENT_TYPES.find((t) => lower.includes(t)) ?? "specific_lookup") as Intent;
}

async function generateSQL(apiKey: string, query: string): Promise<string> {
  const raw = await callClaude(apiKey, SQL_SYSTEM_PROMPT, query, 800);
  // strip markdown fences
  return raw
    .replace(/^```(?:sql)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

const FORBIDDEN = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "CREATE",
  "MERGE",
  "CALL",
];

function validateSQL(sql: string): { ok: boolean; reason?: string } {
  const trimmed = sql.trim().replace(/;+\s*$/g, "");
  if (!/^select\b/i.test(trimmed)) {
    return { ok: false, reason: "Query must start with SELECT" };
  }
  if (trimmed.includes(";")) {
    return { ok: false, reason: "Multi-statement queries are not allowed" };
  }
  const upper = trimmed.toUpperCase();
  for (const kw of FORBIDDEN) {
    if (new RegExp(`\\b${kw}\\b`).test(upper)) {
      return { ok: false, reason: `Forbidden keyword: ${kw}` };
    }
  }
  if (/\bpg_[a-z_]+/i.test(trimmed)) {
    return { ok: false, reason: "Access to pg_* system tables is forbidden" };
  }
  if (/\bauth\.[a-z_]+/i.test(trimmed)) {
    return { ok: false, reason: "Access to auth schema is forbidden" };
  }
  if (!/\blimit\s+\d+/i.test(trimmed) && !/\b(sum|count|avg|min|max)\s*\(/i.test(trimmed)) {
    return { ok: false, reason: "Query must include LIMIT or aggregation" };
  }
  // hard cap
  const limitMatch = trimmed.match(/\blimit\s+(\d+)/i);
  if (limitMatch && parseInt(limitMatch[1], 10) > 1000) {
    return { ok: false, reason: "LIMIT cannot exceed 1000" };
  }
  return { ok: true };
}

async function executeSQL(
  supabaseUrl: string,
  serviceKey: string,
  sql: string,
): Promise<unknown[]> {
  // Requires an `exec_readonly_sql(sql text)` RPC in your Supabase project
  // that runs the query as a read-only transaction and returns JSON.
  const supabase = createClient(supabaseUrl, serviceKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const { data, error } = await supabase.rpc("exec_readonly_sql", { sql });
    if (error) throw new Error(error.message);
    if (Array.isArray(data)) return data as unknown[];
    if (data == null) return [];
    return [data] as unknown[];
  } finally {
    clearTimeout(timeout);
  }
}

async function formatAnswer(
  apiKey: string,
  query: string,
  data: unknown[],
): Promise<{ answer: string; suggested_follow_ups: string[] }> {
  const sample = JSON.stringify(data.slice(0, 20));
  const prompt = `User asked: "${query}"
Result data (JSON, up to 20 rows): ${sample}
Total rows: ${data.length}

Reply in strict JSON: {"answer": "...", "suggested_follow_ups": ["...", "...", "..."]}
- "answer" = one concise natural-language sentence using Indian number format (₹1,00,000 / ₹1.5L / ₹1.2Cr).
- "suggested_follow_ups" = 3 short related questions the user might ask next.
No prose outside the JSON.`;
  const raw = await callClaude(
    apiKey,
    "You are a finance analyst that summarizes query results in Indian rupees. Output strict JSON only.",
    prompt,
    400,
  );
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    return JSON.parse(cleaned);
  } catch {
    return { answer: raw, suggested_follow_ups: [] };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  let query = "";
  let userId: string | null = null;
  let intent: Intent | null = null;
  let sql = "";
  let success = false;
  let result: unknown[] = [];
  let errorMessage: string | null = null;

  try {
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
    const body = await req.json();
    query = String(body?.query ?? "").trim();
    userId = body?.user_id ?? null;
    if (!query) throw new Error("query is required");

    intent = await classifyIntent(anthropicKey, query);
    sql = await generateSQL(anthropicKey, query);

    const valid = validateSQL(sql);
    if (!valid.ok) throw new Error(`Could not generate safe query: ${valid.reason}`);

    result = await executeSQL(supabaseUrl, serviceKey, sql);
    const formatted = await formatAnswer(anthropicKey, query, result);
    success = true;

    const elapsed = Date.now() - startedAt;
    // fire-and-forget log
    void createClient(supabaseUrl, serviceKey)
      .from("ai_query_logs")
      .insert({
        user_id: userId,
        query,
        intent,
        generated_sql: sql,
        result: result.slice(0, 50),
        execution_time_ms: elapsed,
        success: true,
      })
      .then(() => undefined);

    return new Response(
      JSON.stringify({
        success: true,
        answer: formatted.answer,
        sql,
        data: result,
        intent,
        execution_time_ms: elapsed,
        suggested_follow_ups: formatted.suggested_follow_ups,
      }),
      { headers: { ...corsHeaders, "content-type": "application/json" } },
    );
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    const elapsed = Date.now() - startedAt;

    void createClient(supabaseUrl, serviceKey)
      .from("ai_query_logs")
      .insert({
        user_id: userId,
        query,
        intent,
        generated_sql: sql || null,
        result: null,
        execution_time_ms: elapsed,
        success: false,
        error_message: errorMessage,
      })
      .then(() => undefined);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        sql: sql || undefined,
        intent,
        execution_time_ms: elapsed,
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      },
    );
  }
});
