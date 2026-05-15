# Architecture Document

## System Overview

The Finance Intelligence Platform is a three-tier application:

1. **Presentation** — React SPA with 3 focused pages
2. **Application** — Two Supabase Edge Functions (Deno runtime)
3. **Data** — PostgreSQL with materialized views and RPCs

## Design Decisions

### Why Supabase?
- Unified stack: DB + Auth + Storage + Edge Functions
- PostgreSQL with advanced features (JSONB, full-text search, materialized views)
- Real-time subscriptions for progress tracking
- Edge Functions run on Deno (modern, secure)

### Why Edge Functions for processing?
- Serverless = auto-scaling
- Co-located with database = low latency
- Background execution via `EdgeRuntime.waitUntil()` for long jobs
- No server management

### Why hash-based deduplication?
For millions of invoices, O(1) hash lookup beats O(log n) composite index
by ~10x. We compute SHA-256 of `(invoice_number + date + party + amount)`
for instant duplicate detection.

### Why materialized views?
Dashboard analytics queries pre-computed → sub-second response even with
millions of rows.

### Why two-stage AI?
Prevents hallucination:
- **Stage 1:** NL → SQL (deterministic, temp=0.1)
- Execute real SQL against database
- **Stage 2:** Real data → natural language (creative, temp=0.3)

Numbers in answers always come from the database, never from the model.

## Data Flow

### Bulk Upload
```
1. Frontend uploads file → Supabase Storage
2. Frontend creates upload_batches record
3. Frontend invokes process-invoice-batch Edge Function
4. Edge Function returns 202 immediately
5. Background processing begins:
   a. Download file from Storage
   b. Parse CSV/Excel
   c. Process in chunks of 500
   d. Normalize each row (dates, amounts, GSTINs)
   e. Find/create customers via RPC (cached)
   f. Compute SHA-256 content hash
   g. Bulk insert via RPC (ON CONFLICT DO NOTHING)
   h. Update batch progress in DB
6. Frontend subscribes to Realtime updates
7. Live progress bar via Realtime subscriptions
8. Completion → final summary + error log
```

### AI Query
```
1. User submits natural language query
2. Frontend invokes ai-financial-query Edge Function
3. Edge Function calls Claude (system prompt = schema context)
4. Claude returns: { intent, sql }
5. validateSQL() rejects unsafe SQL
6. exec_readonly_sql() RPC runs SQL in read-only txn
7. Result sent back to Claude for formatting
8. Claude returns: { answer, follow_ups }
9. Log to ai_query_logs
10. Return to frontend with full response
```

## Scalability

### Current capacity
- 10 lakh invoices per batch
- 1000 concurrent users
- Sub-second dashboard queries

### Scaling beyond
- Partition `invoices` table by date for 10M+ rows
- Add Redis caching for frequent queries
- Read replicas for analytics workload
- Event-driven architecture for multi-tenant

## Security

- Row Level Security on all tables
- AI SQL validated at 4 layers
- `service_role` isolated to Edge Functions
- API keys in Supabase secrets (not in code)
- Statement timeout prevents DoS
- Read-only transaction enforces no writes
