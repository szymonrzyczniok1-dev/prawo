-- Tracker kosztów budowy (MUREK) — tabele niezależne od reszty systemu
create table if not exists public.ct_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  share_token text unique not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

create table if not exists public.ct_expenses (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ct_sites(id) on delete cascade,
  spent_on date not null default current_date,
  description text not null,
  category text not null default 'Materiały',
  gross numeric(12,2) not null check (gross >= 0),
  vat_rate numeric(5,2) not null default 23,
  created_at timestamptz not null default now()
);
create index if not exists ct_expenses_site_idx on public.ct_expenses(site_id, spent_on);

create table if not exists public.ct_advances (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.ct_sites(id) on delete cascade,
  received_on date not null default current_date,
  note text,
  amount numeric(12,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ct_advances_site_idx on public.ct_advances(site_id, received_on);

create table if not exists public.ct_settings (
  key text primary key,
  value text not null
);

-- RLS: włączone bez żadnych polityk = brak dostępu przez klucz anon.
-- Dostęp wyłącznie przez Edge Function (service role) z własną autoryzacją.
alter table public.ct_sites enable row level security;
alter table public.ct_expenses enable row level security;
alter table public.ct_advances enable row level security;
alter table public.ct_settings enable row level security;

-- Klucz administratora (podmień wartość na własną):
-- insert into public.ct_settings(key, value) values ('admin_key', 'TWOJ-KLUCZ')
--   on conflict (key) do update set value = excluded.value;
