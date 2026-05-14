-- Run this in your Supabase SQL editor.
-- Project: tzyftwiookdvqxzllbbd
-- Safe to re-run: uses IF NOT EXISTS / ALTER ADD COLUMN IF NOT EXISTS.

-- ============== Parties ==============
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text unique,
  created_at timestamptz default now()
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text unique,
  created_at timestamptz default now()
);

-- ============== Batches ==============
create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  invoice_type text not null default 'sales' check (invoice_type in ('sales','purchase')),
  total_rows int default 0,
  processed int default 0,
  imported int default 0,
  duplicates int default 0,
  failed int default 0,
  status text default 'pending',
  error_message text,
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_at timestamptz default now()
);

alter table public.upload_batches add column if not exists invoice_type text default 'sales';
alter table public.upload_batches add column if not exists processed int default 0;
alter table public.upload_batches add column if not exists started_at timestamptz default now();
alter table public.upload_batches add column if not exists completed_at timestamptz;
alter table public.upload_batches add column if not exists error_message text;

-- ============== Invoices ==============
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.upload_batches(id) on delete set null,
  invoice_type text not null default 'sales' check (invoice_type in ('sales','purchase')),
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  invoice_number text not null,
  invoice_date date not null,
  due_date date,
  subtotal numeric(14,2),
  total_amount numeric(14,2) not null,
  tax_amount numeric(14,2) default 0,
  discount numeric(14,2) default 0,
  gstin text,
  hsn_code text,
  notes text,
  row_hash text,
  raw_data jsonb,
  created_at timestamptz default now()
);

alter table public.invoices add column if not exists invoice_type text default 'sales';
alter table public.invoices add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists subtotal numeric(14,2);
alter table public.invoices add column if not exists discount numeric(14,2) default 0;
alter table public.invoices add column if not exists gstin text;
alter table public.invoices add column if not exists hsn_code text;
alter table public.invoices add column if not exists notes text;
alter table public.invoices add column if not exists row_hash text;
alter table public.invoices add column if not exists raw_data jsonb;

create unique index if not exists invoices_row_hash_uniq on public.invoices(row_hash) where row_hash is not null;
create index if not exists invoices_batch_idx on public.invoices(batch_id);

-- ============== Errors ==============
create table if not exists public.upload_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.upload_batches(id) on delete cascade,
  row_number int,
  row_data jsonb,
  error_type text,
  error text,
  created_at timestamptz default now()
);
alter table public.upload_errors add column if not exists error_type text;
create index if not exists upload_errors_batch_idx on public.upload_errors(batch_id);

-- ============== Column Mapping History ==============
create table if not exists public.column_mapping_history (
  id uuid primary key default gen_random_uuid(),
  source_column text not null,
  target_field text not null,
  invoice_type text not null default 'sales',
  use_count int default 1,
  last_used_at timestamptz default now(),
  unique (source_column, target_field, invoice_type)
);
create index if not exists cmh_lookup_idx
  on public.column_mapping_history(invoice_type, source_column);

-- ============== Realtime ==============
alter publication supabase_realtime add table public.upload_batches;

-- ============== Demo RLS (open) ==============
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.upload_batches enable row level security;
alter table public.invoices enable row level security;
alter table public.upload_errors enable row level security;
alter table public.column_mapping_history enable row level security;

do $$ begin create policy "anon all" on public.customers for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "anon all" on public.suppliers for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "anon all" on public.upload_batches for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "anon all" on public.invoices for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "anon all" on public.upload_errors for all using (true) with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "anon all" on public.column_mapping_history for all using (true) with check (true); exception when duplicate_object then null; end $$;
