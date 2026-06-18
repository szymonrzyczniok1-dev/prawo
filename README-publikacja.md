# Powtórki — panel nauki do studiów prawniczych

Statyczna strona (HTML + CSS + JS, bez backendu) do powtórek z wielu przedmiotów.
Strona główna: **wybór roku → wybór przedmiotu → pulpit przedmiotu**.
Tryby nauki zależą od przedmiotu (Fiszki / Test ABCD / Pisanie / Kazusy).
Logowanie + zapis postępów (lokalnie lub w chmurze — patrz niżej).

> **Treść i format pytań pozostają nietknięte.** Pliki `questions.js` (administracyjne)
> oraz `data.js` (karne) zawierają dokładnie te same pytania, co wcześniej.

---

## Struktura plików

```
powtorki/
├─ index.html                      ← strona główna (rok → przedmiot, logowanie)
├─ assets/
│  ├─ style.css                    ← wspólny wygląd (light + dark)
│  ├─ config.js                    ← TU wklejasz dane Supabase (konta w chmurze)
│  └─ store.js                     ← logowanie + zapis i synchronizacja postępów
└─ przedmioty/
   ├─ prawo-administracyjne/
   │  ├─ index.html                ← panel (Fiszki / ABCD / Pisanie)
   │  └─ questions.js              ← pytania (NIE edytować formatu)
   └─ prawo-karne/
      ├─ index.html                ← panel (Test ABCD / Kazusy)
      └─ data.js                   ← pytania i kazusy (NIE edytować formatu)
```

**Publikujesz cały folder `powtorki`** (to jest katalog główny strony).

---

## Uruchomienie lokalne

Otwórz `powtorki/index.html` w przeglądarce. Działa też bez internetu
(w trybie lokalnym; czcionki i konta w chmurze wymagają sieci).

---

## Publikacja na Cloudflare Pages

### Wariant A — przez GitHub (zalecany, masz już tak skonfigurowane)
1. Wrzuć **zawartość folderu `powtorki`** do swojego repozytorium (tak, aby
   `index.html` był w katalogu głównym repo — albo ustaw katalog jako root).
2. W Cloudflare Pages projekt jest już połączony z repo → każdy `git push`
   automatycznie zaktualizuje stronę.
3. Ustawienia builda: **Framework preset: None**, **Build command: (puste)**,
   **Build output directory: `/`**.

> Jeśli wcześniej publikowany był tylko folder „Panel Powtorkowy", podmień
> zawartość repo na zawartość folderu `powtorki`.

### Wariant B — przeciągnij i upuść
Cloudflare → Workers & Pages → Create → Pages → Upload assets → przeciągnij
**zawartość** folderu `powtorki` → Deploy.

---

## Konta w chmurze (synchronizacja postępów między urządzeniami)

Domyślnie strona działa w **trybie lokalnym**: logujesz się imieniem,
a postępy zapisują się w danej przeglądarce. Aby włączyć prawdziwe konta
z synchronizacją telefon ↔ laptop, podłącz darmowy **Supabase**:

### 1. Załóż projekt
- Wejdź na https://supabase.com → załóż konto → **New project**.
- Zapamiętaj region (np. EU) i hasło do bazy.

### 2. Skopiuj dane dostępowe
- W projekcie: **Settings → API**.
- Skopiuj **Project URL** oraz klucz **anon public**.
- Wklej je do `assets/config.js`:

```js
window.POWTORKA_CONFIG = {
  supabaseUrl: "https://twojprojekt.supabase.co",
  supabaseAnonKey: "eyJhbGciOi....(długi klucz)"
};
```

> Klucz **anon public** jest przeznaczony do umieszczania w kodzie strony —
> dostępu do danych pilnują reguły bezpieczeństwa (RLS) z punktu 3.

### 3. Utwórz tabelę postępów (Baza postępów)
- W Supabase: **SQL Editor → New query** → wklej i uruchom:

```sql
create table if not exists public.progress (
  user_id    uuid not null references auth.users(id) on delete cascade,
  subject    text not null,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, subject)
);

alter table public.progress enable row level security;

create policy "wlasne postepy - odczyt"  on public.progress
  for select using (auth.uid() = user_id);
create policy "wlasne postepy - zapis"   on public.progress
  for insert with check (auth.uid() = user_id);
create policy "wlasne postepy - zmiana"  on public.progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Każdy użytkownik widzi i zmienia wyłącznie własne postępy.

### 4. (Opcjonalnie) Wyłącz potwierdzanie e-mail
Żeby rejestracja logowała od razu (bez maila aktywacyjnego):
- **Authentication → Providers → Email** → wyłącz **Confirm email**.

### 5. Gotowe
Opublikuj zmieniony `config.js`. Na stronie pojawi się rejestracja/logowanie
e-mailem, a postępy zaczną się synchronizować. Wskaźnik w nagłówku zmieni się
z „tryb lokalny" na „synchronizacja w chmurze".

> **Bezpieczne dla istniejących postępów:** dane zebrane wcześniej jako „gość"
> zostaną automatycznie scalone z kontem przy pierwszym logowaniu.

---

## Jak dodać nowy przedmiot

1. Utwórz folder `przedmioty/<slug-przedmiotu>/` z plikiem `index.html`
   (najprościej skopiować istniejący panel) i plikiem danych.
2. W `index.html` (strona główna) dopisz wpis do tablicy `SUBJECTS`
   i ustaw `ready: true`, `total`, `url`.

## Jak dopisać / poprawić pytanie

Otwórz odpowiedni plik danych i trzymaj się istniejącego formatu:

- **Administracyjne** (`questions.js`):
  `{ id, kat, q, skrot, sredni, max }`
- **Karne** (`data.js`):
  pytania `{ temat, pytanie, odpowiedzi[], poprawna, wyjasnienie }`,
  kazusy `{ temat, stan, polecenie, rozwiazanie, punkty[] }`

Tekst wpisuj między backtickami (administracyjne) lub w cudzysłowach (karne) —
nie zmieniaj nazw pól ani struktury.
