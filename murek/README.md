# MUREK — śledzenie kosztów budowy

Aplikacja internetowa do rozliczania budów: wydatki wpisywane **brutto**,
automatycznie rozbijane na **netto / VAT / brutto**, plus **zaliczki od klienta**
i saldo. Osobny, tylko-do-odczytu **panel klienta** udostępniany linkiem.

Kolorystyka i logo wg identyfikacji MUREK („Fundamentalna solidność").

## Architektura

- **Strony (frontend)** — statyczne pliki w tym folderze, publikowane przez
  **Cloudflare Pages** razem z resztą repozytorium (po scaleniu do gałęzi
  głównej):
  - `murek/index.html` — panel pełny (administratora), pod adresem
    `https://<twoja-domena-pages>/murek/`
  - `murek/klient.html` — panel klienta (tylko odczyt), linki mają postać
    `https://<twoja-domena-pages>/murek/klient.html?t=<share_token>`
    (przycisk „Link dla klienta" w panelu kopiuje gotowy adres)
- **API + baza** — Supabase (projekt `system-budowlany-murek`,
  ref `djwbznlykqcqpvybvrtq`):
  - Postgres: tabele `ct_sites`, `ct_expenses`, `ct_advances`, `ct_settings`
    (migracje w `supabase/migrations/`). RLS włączone **bez polityk** — dane
    nie są dostępne przez klucz anon; jedyna droga to Edge Function.
  - **Edge Function `murek`** (`supabase/functions/murek/index.ts`) — czyste
    JSON API z CORS: `https://djwbznlykqcqpvybvrtq.supabase.co/functions/v1/murek/api/…`.
    Deploy z `verify_jwt=false`, bo funkcja ma własną autoryzację:
    panel pełny → nagłówek `x-admin-key` (porównywany z `ct_settings.admin_key`),
    panel klienta → sekretny `share_token` budowy.

> **Dlaczego strony nie są serwowane z Supabase?** Domena `*.supabase.co`
> wymusza `content-type: text/plain` + CSP `sandbox` dla treści HTML
> (zabezpieczenie antyphishingowe platformy) — przeglądarka pokazuje wtedy
> kod źródłowy zamiast strony. Dlatego HTML mieszka na Cloudflare Pages,
> a Supabase obsługuje tylko API.

## Klucz dostępu

Klucz administratora leży w tabeli `ct_settings` (klucz `admin_key`).
Zmiana klucza:

```sql
update public.ct_settings set value = 'NOWY-KLUCZ' where key = 'admin_key';
```

## Ponowny deploy funkcji

```bash
supabase functions deploy murek --no-verify-jwt --project-ref djwbznlykqcqpvybvrtq
```

## Funkcje

- wiele budów, każda z własnym linkiem dla klienta,
- wydatki: data, opis, kategoria, stawka VAT (23/8/0%), kwota brutto →
  automatyczne rozbicie netto/VAT, kolumna „narastająco" i wiersz sumy,
- zaliczki: data, notatka, kwota, suma na górze panelu,
- saldo = zaliczki − wydatki brutto (zielone/czerwone),
- edycja wpisów (ołówek przy każdym wydatku i zaliczce),
- statusy budowy: **W trakcie / Zakończona / Archiwum** (ustawienia budowy);
  budowy z archiwum lądują w osobnej grupie listy wyboru,
- eksport CSV (wydatki i zaliczki, format zgodny z polskim Excelem),
- **eksport PDF** — przycisk „Eksport PDF" otwiera gotowy raport rozliczenia
  (zaliczki, wydatki z rozbiciem VAT, saldo) i wywołuje drukowanie →
  „Zapisz jako PDF"; panel klienta ma analogiczny przycisk „Zapisz PDF",
- panel klienta: suma wpłat, wykorzystane środki z listą „na co", pasek
  postępu wykorzystania zaliczek, plakietka „Budowa zakończona" — bez
  możliwości edycji.
