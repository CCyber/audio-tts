# Aria — Library & Projects Design

**Status:** Approved
**Date:** 2026-04-30
**Scope:** Erweitert die bestehende Aria-TTS-Webapp um persistente Aufnahmen, Projekte als Gruppierung, Tags, Volltextsuche, einen Inline-Player und eine library-zentrische UI.

## Goal

Heute generiert Aria eine MP3, legt sie 5 Minuten in `tmp/` ab und vergisst sie danach. Stattdessen sollen Aufnahmen dauerhaft gespeichert, in Projekten organisiert, mit Tags versehen, durchsuchbar und direkt im Browser abspielbar sein. Download bleibt möglich, ist aber nicht mehr der Default-Use-Case.

## Non-Goals

- Multi-User / Authentifizierung — single-user, lokal in Docker.
- Drag-and-Drop zwischen Projekten — Verschieben über Menü-Dropdown.
- Bulk-Aktionen über mehrere Aufnahmen.
- Dark-Mode-Toggle.
- Verschachtelte Projekte (Sub-Projekte).
- Re-Generate als In-Place-Update einer bestehenden Aufnahme — wir erzeugen stattdessen eine neue Aufnahme aus einer Vorlage.
- Papierkorb / Soft-Delete.

## Tech-Stack

- **Backend:** bestehender Express-Server in TypeScript.
- **DB:** SQLite via `better-sqlite3` (synchron, single-binary, reicht für single-user mehr als locker).
- **Volltextsuche:** SQLite FTS5 Virtual Table mit Triggern auf Insert/Update/Delete.
- **MP3-Dauer:** `music-metadata` (pure JS, keine native Dep) — parst die konkatenierten MP3-Chunks nach Generate.
- **Frontend:** Vanilla TypeScript wie bisher, kein Framework. DOM-Rendering reicht für die Library-Listen.
- **Storage-Layout:** persistentes Docker-Volume mit
  - `/app/data/aria.db` — SQLite-Datei
  - `/app/data/audio/<uuid>.mp3` — Audio-Files

## Datenmodell

### Tabelle `projects`

| Spalte | Typ | Hinweise |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `name` | TEXT NOT NULL | |
| `is_system` | INTEGER NOT NULL DEFAULT 0 | `1` für Inbox, sonst `0` |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) | |

Beim ersten Start wird genau eine System-Zeile mit `id=1`, `name='Inbox'`, `is_system=1` angelegt.

### Tabelle `recordings`

| Spalte | Typ | Hinweise |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `project_id` | INTEGER NOT NULL | FK auf `projects(id)`, `ON DELETE RESTRICT` |
| `title` | TEXT NOT NULL | beim Insert auto aus den ersten ~50 Zeichen, vom User editierbar |
| `original_text` | TEXT NOT NULL | der ursprüngliche Eingabetext |
| `voice` | TEXT NOT NULL | z.B. `alloy` |
| `model` | TEXT NOT NULL | `tts-1` oder `gpt-4o-mini-tts` |
| `file_path` | TEXT NOT NULL UNIQUE | relativer Pfad unter `/app/data/audio/` |
| `file_size` | INTEGER NOT NULL | Bytes |
| `duration_ms` | INTEGER NOT NULL | Aufnahmedauer in Millisekunden |
| `created_at` | TEXT NOT NULL DEFAULT (datetime('now')) | |

`ON DELETE RESTRICT` ist Sicherheitsnetz — die Lifecycle-Regel "Aufnahmen in Inbox umhängen" wird in App-Code gemacht, nicht via Cascade.

### Tabelle `tags`

| Spalte | Typ | Hinweise |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `name` | TEXT NOT NULL UNIQUE COLLATE NOCASE | case-insensitive, "TODO" und "todo" sind dasselbe |

### Tabelle `recording_tags` (Junction)

| Spalte | Typ | Hinweise |
|---|---|---|
| `recording_id` | INTEGER NOT NULL | FK, `ON DELETE CASCADE` |
| `tag_id` | INTEGER NOT NULL | FK, `ON DELETE CASCADE` |
| PRIMARY KEY (`recording_id`, `tag_id`) | | |

### FTS5 Virtual Table `recordings_fts`

- Spalten: `title`, `original_text`.
- Standard-Tokenizer.
- Drei Trigger (`AFTER INSERT/UPDATE/DELETE` auf `recordings`) halten den Index synchron.
- Tags **nicht** indiziert — Tag-Filter ist strukturiert, kein Volltext.

### Migration

Einfacher Boot-time-Migrator basierend auf `PRAGMA user_version`. Schema-Version 1 = obiges Setup. Keine bestehenden Daten zu migrieren — die App hatte bisher keine Persistenz.

## Lifecycle-Regeln

- **Inbox** (`projects.id = 1`): kann nicht umbenannt oder gelöscht werden — Enforcement im API-Layer und in der UI (Buttons disabled).
- **Projekt-Löschen**: in einer Transaktion alle zugehörigen Recordings auf `project_id = 1` umsetzen, dann das Projekt löschen.
- **Recording-Löschen**: in einer Transaktion DB-Row löschen (Cascade kümmert sich um `recording_tags`), anschließend MP3-Datei vom Filesystem entfernen. FTS-Trigger kümmert sich um den Index.
- **Verwaiste Tags**: nicht aktiv löschen; `GET /api/tags` filtert per `INNER JOIN recording_tags GROUP BY HAVING COUNT > 0`.
- **Bestehende `tmp/`-Logik**: ersatzlos entfernt. Kein Auto-Cleanup mehr.

## API

Alle Endpoints unter `/api/`. Errors einheitlich als `{ error: string }` mit passendem HTTP-Status.

### Projekte

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/projects` | Alle Projekte mit Aufnahmen-Count, sortiert: Inbox zuerst, dann alphabetisch |
| `POST` | `/api/projects` | Body `{ name }` — neues Projekt |
| `PATCH` | `/api/projects/:id` | Body `{ name }` — umbenennen; 400 wenn `is_system=1` |
| `DELETE` | `/api/projects/:id` | Aufnahmen → Inbox, Projekt löschen; 400 wenn `is_system=1` |

### Aufnahmen

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/recordings` | Liste mit Query-Params: `project_id`, `tag` (mehrfach = AND), `q` (FTS5), `limit`, `offset`. Default-Sort: `created_at DESC` |
| `POST` | `/api/recordings` | Generiert TTS und speichert. `multipart/form-data` oder JSON: `text`, `voice`, `model`, `project_id?`, `tags?` (Array von Namen), `title?`, `file?` (txt-Upload) |
| `GET` | `/api/recordings/:id` | Detail inkl. zugewiesener Tag-Namen |
| `PATCH` | `/api/recordings/:id` | Editierbare Felder: `title?`, `project_id?`, `tags?` (komplette neue Liste — vorhandene werden ersetzt) |
| `DELETE` | `/api/recordings/:id` | DB-Row + MP3-Datei löschen |
| `GET` | `/api/recordings/:id/audio` | MP3 mit Range-Request-Support fürs Inline-Streaming |
| `GET` | `/api/recordings/:id/download` | MP3 mit `Content-Disposition: attachment` für expliziten Download |

### Tags

| Methode | Pfad | Beschreibung |
|---|---|---|
| `GET` | `/api/tags` | Alle Tags mit Recording-Count, sortiert nach Count desc |

### Unverändert

- `GET /health`
- `GET /api/voices`
- `GET /api/models`

### Entfällt

- `POST /api/tts` → ersetzt durch `POST /api/recordings`
- `GET /api/download/:filename` → ersetzt durch `/api/recordings/:id/(audio|download)`

## Generate-Flow (Backend)

`POST /api/recordings`:

1. Validate (Text vorhanden, Voice/Model in Whitelist).
2. Text aus Body oder Upload-File extrahieren.
3. Title bestimmen: User-Wert oder Auto-Slice der ersten ~50 Zeichen.
4. Project bestimmen: User-Wert oder `1` (Inbox).
5. Chunking & TTS-Calls an OpenAI wie bisher.
6. MP3-Buffer parsen mit `music-metadata`, `duration_ms` ermitteln.
7. UUID-Filename erzeugen, Buffer in `/app/data/audio/<uuid>.mp3` schreiben.
8. **Innerhalb einer Transaktion**:
   - Insert in `recordings`.
   - Tags resolven (existierende per Name finden, fehlende einfügen) und `recording_tags`-Rows anlegen.
9. Response: das vollständige Recording-Objekt inkl. Tags.

Bei Fehler nach Schritt 7 (Datei geschrieben, DB schlägt fehl): MP3-Datei wird zurück-gelöscht, damit keine Waisen entstehen.

## UI-Layout

### Grundaufbau

```
+----------------------+--------------------------------------+
|  ARIA                |  [Projektname]    [umbenennen][löschen] |
|                      |  ----------------------------------- |
|  PROJEKTE            |  [🔍 Suchen...]   [+ Neue Aufnahme]   |
|  • Inbox       (12)  |  Tags aktiv: [#urgent ✕]              |
|  • Hörbücher    (3)  |  ----------------------------------- |
|  • Lernen       (8)  |  ┌─ Aufnahme-Card ──────────────┐   |
|  + Neues Projekt     |  │ Karl der Große               │   |
|                      |  │ 28.04.2026 · alloy · tts-1   │   |
|  TAGS                |  │ · 02:14         [#urgent] [+] │   |
|  #urgent       (4)   |  │ ▶ ━━━━━━━━━━ 0:23 / 2:14 [⬇] │   |
|  #lernen       (2)   |  └──────────────────────────────┘   |
|  #podcast      (1)   |                                       |
+----------------------+--------------------------------------+
```

### Sidebar (links, 240 px)

- App-Name "Aria" oben.
- Sektion **Projekte**: Inbox immer ganz oben (System-Marker), eigene Projekte alphabetisch, jeweils mit Aufnahmen-Count. `+ Neues Projekt` als letzter Eintrag, Klick öffnet Inline-Input.
- Sektion **Tags**: alle benutzten Tags mit Count (Klick aktiviert Tag-Filter im Hauptbereich des aktuellen Projekts).

### Hauptbereich

- **Project-Header**: Projekt-Name (Inline-editierbar via Klick, außer Inbox), Action-Buttons rechts für Umbenennen/Löschen (bei Inbox disabled).
- **Toolbar**: Suchfeld (debounced 300 ms gegen `?q=`), aktive Tag-Filter als entfernbare Chips, `+ Neue Aufnahme`-Button rechts.
- **Liste**: Aufnahme-Cards untereinander.

### Aufnahme-Card

- **Title** — Inline-Edit per Klick, Enter speichert via `PATCH`.
- **Metadaten-Zeile**: Erstellungsdatum · Voice · Modell · Dauer (`mm:ss`).
- **Tag-Pillen + `+`-Button** — Klick auf `+` öffnet Mini-Popover mit Autocomplete (existierende Tags vorschlagen, neuer Tag wird beim Speichern angelegt).
- **`<audio controls>`** lädt von `/api/recordings/:id/audio`, browser-native Player-UI.
- **Download-Button** (`⬇`) rechts neben dem Player → zeigt auf `/api/recordings/:id/download`.
- **`…`-Menü**: "In Projekt verschieben" (Dropdown), "Als Vorlage für neue Aufnahme" (öffnet Generate-Dialog mit vorbefüllten Text+Settings), "Löschen" (mit Confirm).

### Generate-Dialog (Modal)

Getriggert durch `+ Neue Aufnahme` oder "Als Vorlage". Felder:

- Textarea (oder `.txt`-Upload-Button), Zeichenzähler.
- Voice-Dropdown, Modell-Dropdown.
- Title-Input (Placeholder: "Wird automatisch aus Text generiert").
- Tags-Input — Chip-Input mit Autocomplete aus bestehenden Tags.
- Projekt-Dropdown (Default: aktuell offenes Projekt).
- `Generieren`-Button, während des API-Calls eine Progressbar.

Bei Erfolg: Modal schließt, neue Card erscheint oben in der Liste.

### Empty States

- Projekt ohne Aufnahmen: zentriert "Noch keine Aufnahmen — Erste erstellen", großer Generate-Button.
- Suche/Filter ohne Treffer: "Keine Aufnahmen gefunden".

## Storage & Container-Layout

`docker-compose.yml` erweitern: zusätzliches benanntes Volume gemountet auf `/app/data`. Im Dockerfile: `mkdir -p /app/data/audio` und Ownership setzen.

`.gitignore`: `data/` und `tmp/` (letzteres wird obsolet, kann raus).

## Testing-Ansatz

- **Backend**: Integrationstests für die wichtigsten API-Routen mit einer In-Memory-SQLite-Instanz pro Test (über `better-sqlite3` einfach realisierbar). Fokus:
  - Projekt erstellen/umbenennen/löschen — Inbox-Schutz.
  - Recording erzeugen mit Tags, Tag-Wiederverwendung.
  - Suche per FTS5 trifft Title und Original-Text.
  - Tag-AND-Filter.
  - Beim Recording-Löschen wird die MP3 entfernt.
  - Beim Projekt-Löschen werden Recordings in Inbox umgehängt.
- OpenAI-API-Calls in Tests gemockt (Network-Layer austauschbar).
- **Frontend**: kein Test-Framework — die Logik ist DOM-Manipulation gegen REST. Manuelles Smoke-Testing nach Implementierung über die UI.

## Open Questions

Keine.
