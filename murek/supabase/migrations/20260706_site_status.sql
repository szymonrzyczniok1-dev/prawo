-- Status budowy: active (w trakcie) / done (zakończona) / archived (archiwum)
alter table public.ct_sites
  add column if not exists status text not null default 'active'
  check (status in ('active','done','archived'));
