/* =========================================================================
   KONFIGURACJA KONT W CHMURZE (Supabase)
   -------------------------------------------------------------------------
   Dopóki oba pola są puste, strona działa w TRYBIE LOKALNYM:
   logujesz się samym imieniem, a postępy zapisują się w tej przeglądarce.

   Aby włączyć prawdziwe konta z synchronizacją między urządzeniami:
   1. Załóż darmowe konto na https://supabase.com i utwórz projekt.
   2. W panelu projektu: Settings → API. Skopiuj:
        - "Project URL"        -> wklej do supabaseUrl
        - klucz "anon public"  -> wklej do supabaseAnonKey
      (klucz anon jest publiczny i bezpieczny do umieszczenia tutaj —
       dostępu do danych pilnują reguły bezpieczeństwa w bazie).
   3. W zakładce SQL Editor wykonaj skrypt z pliku README-publikacja.md
      (sekcja „Baza postępów”).
   4. W Authentication → Providers → Email wyłącz „Confirm email”,
      żeby rejestracja logowała od razu (opcjonalne, ale wygodne).
   ========================================================================= */

window.POWTORKA_CONFIG = {
  supabaseUrl: "https://rbvxfefjqhectkjgpkml.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJidnhmZWZqcWhlY3Rramdwa21sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3Mjg4NDAsImV4cCI6MjA5NzMwNDg0MH0.f7-UqqwPPGQl0v7clqC7gr5Q-ldDD8GDgliyEWhXcOE"
};
