# MonkeyPanel / GorIlliaPanel

MonkeyPanel to mobilna aplikacja treningowa dla podopiecznych.

GorIlliaPanel to panel trenera: diagnostyka, raporty i analiza podopiecznych.

## Główna zasada projektu

Arkusz Google Sheets / Excel pozostaje źródłem prawdy.

Aplikacja:
- odczytuje dane,
- zapisuje dane,
- poprawia UX,
- analizuje progres i anomalie.

Nigdy nie wymuszamy migracji workflow trenera.

## Stack MVP

- HTML / CSS / JS
- Google Sheets
- Google Apps Script
- Google Drive
- GitHub Pages

## Aktualny status

Projekt jest w fazie MVP.

Aktualna aplikacja korzysta z Supabase i wymaga konta e-mail/hasło.
Zawodnicy mają dostęp do własnego profilu, a trener do przypisanych profili
w trybie podglądu. Publiczna rejestracja jest wyłączona; konta i przypisania
tworzy administrator. Po zalogowaniu można użyć przycisku „Zmień hasło”.

Opis reguł i weryfikacji: [bezpieczeństwo](docs/security/README.md).
Lokalne testy: `npm ci`, następnie `npm test` (dane testowe, bez produkcji).
Kod aplikacji jest statyczny i nie wymaga budowania przed publikacją w Pages.

W trakcie treningu „Dodaj ćwiczenie” dopisuje ćwiczenie wyłącznie do tej sesji.
„Ćwiczenia tej sesji” pozwala wrócić do dowolnego ćwiczenia przed zapisem.
Serie można dodać na początku i na końcu; uchwyt obok numeru służy do
przeciągania. Kliknięcie uchwytu otwiera opcje przesunięcia, dodania serii przed
lub po wybranej oraz usunięcia. Uchwyt obsługuje również strzałki klawiatury.
Kolejność, wyniki i lista ćwiczeń są zapisywane w historii sesji. Plan trenera
oraz kolejne sesje zachowują swoje pierwotne ćwiczenia. Nie wymaga to migracji
bazy. Przy publikacji trzeba uwzględnić `session-editor.js` i `session-editor.css`.

Priorytet:
1. wygodne wykonywanie treningu na telefonie,
2. synchronizacja z arkuszem,
3. podstawowa diagnostyka,
4. panel trenera.
