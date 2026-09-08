# Zabezpieczenie dostępu do MonkeyPanel

## Stan końcowy — 8 września 2026

Wdrożono Supabase Auth i przypisania kont w `athlete_access`. Zawodnik ma
odczyt własnego planu oraz odczyt i zapis swoich wyników. Trener ma odczyt
dwóch przypisanych profili. Osoba niezalogowana lub konto bez przypisania
nie ma dostępu do danych aplikacji. Parametr `?client=` tylko wybiera profil;
uprawnienia zawsze sprawdza baza na podstawie `auth.uid()`.

- RLS działa na wszystkich 18 tabelach, łącznie z nową tabelą przypisań.
- `anon` nie ma uprawnień do żadnej tabeli aplikacji ani funkcji zapisu.
- Przypisania może zmieniać wyłącznie administrator; aplikacja tylko czyta
  przypisania własnego konta. `plan_imports` pozostaje prywatną tabelą audytu.
- Funkcja `save_workout` działa jako `SECURITY INVOKER`: zapis treningu i serii
  jest atomowy i podlega RLS. Błąd nie usuwa poprzednich serii.
- Wyłączono publiczną rejestrację i pozostawiono wyłączone logowania anonimowe.
  Zmiana hasła wymaga obecnego hasła; nowe hasła mają minimum 12 znaków.
- Frontend wymaga logowania, obsługuje wylogowanie i zmianę hasła. Szkice
  są zapisane osobno dla konta i profilu. Starsze lokalne szkice są odczytywane
  dopiero po potwierdzeniu dostępu właściciela; oryginały zostają zachowane.

Migracje dostępowe w produkcji:
`20260908125439_account_scoped_access` i `20260908125938_index_athlete_access`.
Adresów e-mail, haseł ani identyfikatorów prawdziwych kont nie zapisano w kodzie.

Weryfikacja: 24 testy przeszły (`npm ci`, `npm test`). Testy zapisów i odmów
działają w lokalnym Postgresie PGlite ze sztucznymi danymi. W produkcji wykonano
odczyty jako oba konta zawodników, trener i konto bez przypisania. Sprawdzono
ekran logowania w przeglądarce. Agent nie zna haseł użytkowników, więc logowanie
prawdziwym hasłem pozostaje testem użytkownika. Liczby rekordów wszystkich
17 wcześniejszych tabel nie zmieniły się. Wyniki: `account-access-verification.json`.

Security Advisor nie zgłasza błędów ekspozycji tabel. Pozostaje ostrzeżenie
o wyłączonym sprawdzaniu haseł z wycieków: włączenie tej opcji nie zostało
zapisane w obecnym planie, a panel wymaga Pro lub wyższego. Nie zmieniono planu
rozliczeniowego. Zobacz [ochronę haseł](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
Informacja [RLS bez polityki](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
dotyczy wyłącznie celowo zamkniętej tabeli `plan_imports`.

Poniżej zachowano przebieg wcześniejszego zamknięcia publicznego dostępu.

## Etap zabezpieczenia przed wdrożeniem kont

Projekt `gorillia_panel` (`matuflemwleglsrzrlkp`). Zamknięcie dostępu wykonano
8 września 2026 r. po wyraźnej zgodzie użytkownika na przerwę w działaniu.
Zmiana jest zapisana w Supabase jako migracja
`20260908074510_contain_public_app_tables`. Jej treść odpowiada blokowi
transakcji w `containment-review.sql`; transakcję obsłużył konektor migracji.

## Wynik weryfikacji po zamknięciu publicznego dostępu

- RLS włączone na 17 z 17 tabel aplikacji.
- Brak uprawnień tabel i kolumn dla `anon` i `authenticated` na tych tabelach.
- Usunięte wszystkie 10 otwartych polityk prototypowych.
- Publiczne API bez sesji, z publikowalnym kluczem aplikacji, zwróciło HTTP 401
  oraz kod Postgresa `42501` — `permission denied for table athletes`.
  Zapytanie miało `limit=0`; nie pobrano rekordów ani nie próbowano zapisu.
- Liczba rekordów w każdej z 17 tabel identyczna przed i po zmianie.
  Historia obejmuje m.in. 49 sesji treningowych i 1391 zapisów serii.
- Security Advisor: 0 ERROR, 0 WARN, 17 INFO `rls_enabled_no_policy`.
  Brak polityk jest na tym etapie celowy: dostęp klientów pozostaje zamknięty
  do wdrożenia kont, przypisań i ograniczonych reguł.

Wyniki tego etapu zapisano w `containment-verification.json`. Konta wdrożono
w kolejnym etapie opisanym powyżej. Nie przywracać otwartych grantów.

## Ustalenia przed zmianą

- 17 tabel aplikacji w `public`: 13 z wyłączonym RLS, 4 z RLS i otwartymi
  regułami `prototype_*` dla `anon` oraz `authenticated`.
- Każda z tych 17 tabel miała bezpośrednie granty odczytu i zapisu dla obu ról.
- Brak kont i tożsamości w Supabase Auth.
- Frontend wybiera zawodnika z parametru URL i pobiera listę zawodników
  bez logowania. Publikowalny klucz w przeglądarce jest przeznaczony do takiego
  miejsca; kontrolę dostępu muszą zapewnić Auth, granty i RLS.
- W `public` nie znaleziono widoków ani własnych funkcji `SECURITY DEFINER`.
  To nie jest pełny audyt wszystkich usług i schematów projektu.
- Użytkownik potwierdził, że baza zawiera prawdziwą historię treningów.

## Krok 1: zamknięcie obecnego dostępu — wykonany

Skrypt wykonano przez `apply_migration` jako właściciel bazy (`postgres`)
po ponownym sprawdzeniu schematu i potwierdzeniu braku kont Auth.

Skrypt włącza RLS na wskazanych tabelach, odbiera ich uprawnienia klientom
`anon`, `authenticated` oraz `PUBLIC` i usuwa 10 otwartych reguł prototypowych.
Przy zmianie inwentarza lub pojawieniu się kont zatrzymuje się bez zatwierdzenia
zmian. Transakcja ma limit oczekiwania na blokady. Nie wykonuje zmian danych.

Skutek tego etapu: aplikacja przestała pobierać i zapisywać dane z Supabase.
Już pobrane dane w przeglądarkach nie zostaną zdalnie wycofane. Historia
przechowywana w bazie pozostaje na miejscu. Nie czyścić lokalnej pamięci
aplikacji, jeżeli mogą w niej być niezapisane treningi.

Po wykonaniu: sprawdzić wynik zapytania końcowego, Security Advisor i odmowę
odczytu przez publiczne API bez sesji. Nie tworzyć testowych rekordów
treningowych w produkcji.

## Krok 2: przywrócenie dostępu przez konta — wykonany

Wdrożony model:

- Użytkownik i kolega: odczyt własnego planu, odczyt i zapis własnych wyników.
- Trener: odczyt danych przypisanych podopiecznych, bez zapisu.
- Osoba niezalogowana: brak dostępu do danych zawodników i treningów.

Trzy potwierdzone konta przypisano do istniejących zawodników po adresach
podanych przez właściciela. Dodano cztery wiersze dostępu. Nie zmieniano
identyfikatorów zawodników, planów, treningów ani powiązań historii.
Nie opierać przyszłych reguł na edytowalnym `user_metadata` ani parametrze URL.
Nie umieszczać klucza `service_role` lub sekretnego klucza w przeglądarce.

## Krok 3: dalsza praca agenta

Rozwój i testy zapisów prowadzić na osobnej bazie lub gałęzi z danymi
testowymi. Diagnostykę produkcji ograniczyć do wybranego projektu,
odczytu i niezbędnego zakresu danych. Przed kolejnymi publikacjami sprawdzić
kontrolę dostępu z perspektywy użytkownika aplikacji.

To usuwa opisane przyczyny ekspozycji. Nie jest obietnicą wyłączenia
wszystkich przyszłych alertów bezpieczeństwa w Codex.

Źródła:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/ai-tools/mcp
