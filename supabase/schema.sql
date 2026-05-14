-- Run this in your Supabase SQL editor to create the required tables.
-- Project: tzyftwiookdvqxzllbbd

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text unique,
  created_at timestamptz default now()
);

create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  total_rows int default 0,
  imported int default 0,
  duplicates int default 0,
  failed int default 0,
  status text default 'processing',
  created_at timestamptz default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.upload_batches(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  invoice_number text not null,
  invoice_date date not null,
  total_amount numeric(14,2) not null,
  tax_amount numeric(14,2) default 0,
  created_at timestamptz default now(),
  unique (invoice_number, customer_id, invoice_date)
);

create table if not exists public.upload_errors (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.upload_batches(id) on delete cascade,
  row_number int,
  row_data jsonb,
  error text,
  created_at timestamptz default now()
);

-- Demo-friendly RLS (open). Tighten before production.
alter table public.customers enable row level security;
alter table public.upload_batches enable row level security;
alter table public.invoices enable row level security;
alter table public.upload_errors enable row level security;

do $$ begin
  create policy "anon all" on public.customers for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon all" on public.upload_batches for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon all" on public.invoices for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "anon all" on public.upload_errors for all using (true) with check (true);
exception when duplicate_object then null; end $$;
