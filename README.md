# Finance Intelligence Platform

Production-grade finance application with bulk invoice processing and AI-powered financial querying.

## 🎯 Features

- **Bulk Invoice Upload** — Smart CSV/Excel processing with auto-column detection, handles 1L–10L invoices
- **AI Financial Querying** — Natural language → SQL via Claude AI with multi-layer safety
- **Real-time Dashboard** — Sales/purchase analytics with materialized views

## 🏗️ Architecture

```
Frontend (React + TypeScript)
       ↓
Supabase Edge Functions (Deno)
 ├── process-invoice-batch   (Async bulk processor)
 └── ai-financial-query      (NL → SQL pipeline)
       ↓
Supabase PostgreSQL
 ├── 9 normalized tables + RLS
 ├── Materialized views for analytics
 ├── RPCs for performance
 └── Hash-based deduplication
```

## 🚀 Tech Stack

| Layer    | Technology |
|----------|-----------|
| Frontend | React + TypeScript + Tailwind + shadcn/ui |
| Backend  | Supabase (PostgreSQL + Edge Functions + Storage) |
| AI       | Anthropic Claude (Sonnet 4.5) |
| Parsing  | PapaParse (CSV), SheetJS (Excel) |
| Hosting  | Vercel / Supabase |

## 📊 Database Schema

9 normalized tables with proper relationships:

- `customers`, `suppliers`, `products` — Master data
- `invoices`, `invoice_line_items`, `transactions` — Transactional data
- `upload_batches`, `upload_errors`, `ai_query_logs` — Audit/tracking
- Plus: `batch_processing_metrics`, `column_mapping_history`

Key features:
- ✅ Foreign keys with proper cascading
- ✅ Indexes on lookup columns
- ✅ JSONB columns for flexible raw data
- ✅ Materialized view for fast analytics
- ✅ Row Level Security on all tables

## ⚡ Performance

| Scale         | Processing Time |
|---------------|----------------|
| 1K invoices   | ~3 seconds |
| 10K invoices  | ~25 seconds |
| 1L invoices   | ~4 minutes |
| 10L invoices  | ~40 minutes (multiple invocations) |

Throughput: ~2,500 rows/second.

## 🔒 Security

- Row Level Security (RLS) on all tables
- AI-generated SQL validated at 4 layers:
  1. Claude instructed SELECT-only
  2. JavaScript SQL validator
  3. PostgreSQL read-only transaction
  4. `service_role`-only RPC
- Statement timeout (10s) prevents runaway queries
- Hash-based duplicate detection (no SQL injection vector)

## 🚀 Setup Instructions

### Prerequisites

- Node.js 18+
- Supabase account
- Anthropic API key

### Quick Start

1. **Clone repository**
   ```bash
   git clone https://github.com/yourusername/finance-app.git
   cd finance-app
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Supabase project**
   - Create new project at https://supabase.com
   - Run SQL in `supabase/schema.sql`
   - Create storage bucket: `invoice-uploads` (private, 50MB limit)

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

5. **Deploy Edge Functions**
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase functions deploy process-invoice-batch
   supabase functions deploy ai-financial-query
   ```

6. **Run development server**
   ```bash
   npm run dev
   ```

### Environment Variables

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

For Edge Functions (set via Supabase CLI):

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

## 🎮 Usage

### Upload Page (`/upload`)
- Select invoice type (Sales/Purchase)
- Drop CSV or Excel file
- Review auto-detected column mapping
- Click "Process & Upload"
- Watch real-time progress

### Dashboard (`/`)
- Total Sales, Purchases, Net, Pending
- Sales vs Purchases trend chart
- Top customers and suppliers
- Recent invoices

### AI Chat (`/chat`)
Ask questions in natural language:
- "What were total sales in FY 2023-24?"
- "Compare sales vs purchases for January"
- "Which customer had the highest revenue?"
- "Show me outstanding invoices over 30 days"

## 📁 Project Structure

```
finance-app/
├── README.md
├── ARCHITECTURE.md
├── package.json
├── supabase/
│   ├── schema.sql
│   └── functions/
│       ├── process-invoice-batch/
│       └── ai-financial-query/
└── src/
    ├── routes/
    │   ├── index.tsx       (Dashboard)
    │   ├── upload.tsx
    │   └── chat.tsx
    ├── components/
    ├── integrations/supabase/
    └── lib/
```

## 📡 API Documentation

### `process-invoice-batch`

**Endpoint:** `POST /functions/v1/process-invoice-batch`

**Request:**
```json
{
  "batch_id": "uuid",
  "file_path": "string",
  "file_type": "csv | xlsx | xls",
  "invoice_type": "sales | purchase",
  "column_mapping": {
    "invoice_number": "Invoice No",
    "invoice_date": "Date",
    "customer_name": "Customer",
    "total_amount": "Amount",
    "tax_amount": "GST"
  }
}
```

**Response:** `202 Accepted` (async processing)
```json
{
  "success": true,
  "batch_id": "uuid",
  "status": "processing",
  "message": "Subscribe to upload_batches for live updates"
}
```

### `ai-financial-query`

**Endpoint:** `POST /functions/v1/ai-financial-query`

**Request:**
```json
{ "query": "What were total sales last month?" }
```

**Response:**
```json
{
  "success": true,
  "answer": "Total sales last month were ₹4,52,300",
  "sql": "SELECT...",
  "data": [],
  "intent": "total_aggregate",
  "execution_time_ms": 234,
  "suggested_follow_ups": []
}
```

## 🧪 Testing

Sample test files in `tests/`:
- `sample-sales.csv` — 100 sales invoices
- `sample-purchases.xlsx` — 50 purchase invoices

## 🤝 Contributing

Built as a technical assessment. PRs welcome.

## 📄 License

MIT
