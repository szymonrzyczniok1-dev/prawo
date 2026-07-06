# MUREK — śledzenie kosztów budowy

Aplikacja internetowa do rozliczania budów: wydatki wpisywane **brutto**,
automatycznie rozbijane na **netto / VAT / brutto**, plus **zaliczki od klienta**
i saldo. Osobny, tylko-do-odczytu **panel klienta** udostępniany linkiem.

Kolorystyka i logo wg identyfikacji MUREK („Fundamentalna solidność").

## Architektura

Całość działa na **Supabase** (projekt `system-budowlany-murek`,
ref `djwbznlykqcqpvybvrtq`):

- **Postgres** — tabele `ct_sites`, `ct_expenses`, `ct_advances`, `ct_settings`
  (migracja w `supabase/migrations/`). RLS włączone **bez polityk** — dane nie są
  dostępne przez klucz anon; jedyna droga to Edge Function.
- **Edge Function `murek`** (`supabase/functions/murek/index.ts`) — serwuje
  panel administratora, panel klienta i API. Deploy z `verify_jwt=false`,
  bo funkcja ma własną autoryzację:
  - panel pełny: nagłówek `x-admin-key` porównywany z `ct_settings.admin_key`,
  - panel klienta: sekretny `share_token` budowy w adresie URL.

## Adresy

- Panel pełny (administratora): `https://djwbznlykqcqpvybvrtq.supabase.co/functions/v1/murek`
- Panel klienta: `…/functions/v1/murek/klient/<share_token>`
  (link kopiuje się przyciskiem „Link dla klienta" w panelu).

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
- eksport CSV (wydatki i zaliczki, format zgodny z polskim Excelem),
- panel klienta: suma wpłat, wykorzystane środki z listą „na co", pasek
  postępu wykorzystania zaliczek — bez możliwości edycji.
