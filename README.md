# Aria

Aria ist eine Web-Applikation zur Text-to-Speech-Generierung auf Basis der [OpenAI Audio API](https://platform.openai.com/docs/guides/text-to-speech). Browser-Interface zum Eingeben von Text oder Hochladen von `.txt`-Dateien, Auswahl von Stimme und Modell, MP3-Download.

## Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) (>= 20.x)
- [Docker Compose](https://docs.docker.com/compose/install/) (>= 2.x)
- Ein [OpenAI](https://platform.openai.com) API-Key

## Setup

```bash
# 1. Repository klonen
git clone https://github.com/dein-user/aria-tts.git
cd aria-tts

# 2. Umgebungsvariablen konfigurieren
cp .env.example .env
# .env bearbeiten und API-Key eintragen

# 3. Container starten
docker compose up -d

# 4. Browser öffnen
open http://localhost:3000
```

## Umgebungsvariablen

| Variable          | Beschreibung                          | Standard |
|-------------------|---------------------------------------|----------|
| `OPENAI_API_KEY`  | API-Key für OpenAI (erforderlich)     | –        |
| `PORT`            | Server-Port                           | `3000`   |

## Modelle & Stimmen

| Modell             | Beschreibung                                     |
|--------------------|--------------------------------------------------|
| `tts-1`            | Schnell, niedrige Latenz                         |
| `gpt-4o-mini-tts`  | Neueres Modell, höhere Sprachqualität            |

Verfügbare Stimmen: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`.

## Features

- Persistente Speicherung aller Aufnahmen in SQLite + Filesystem
- Projekte zur Gruppierung mit Default-"Inbox"
- Tags für Cross-Cutting-Filter, case-insensitive
- Volltextsuche über Title und Original-Text via FTS5
- Inline-Player im Browser, Download optional
- Automatisches Chunking langer Texte (> 4000 Zeichen) mit Live-Fortschrittsanzeige
- Asynchrone Generierung: lange Aufnahmen blockieren keine HTTP-Verbindung mehr (kein Reverse-Proxy-Timeout)
- Resume bei Fehlern (z. B. Rate Limit) — bereits erzeugte Abschnitte werden nicht neu generiert

## API Dokumentation

### Projekte
- `GET /api/projects` — alle Projekte mit Aufnahmen-Count
- `POST /api/projects` — Body `{ name }`
- `PATCH /api/projects/:id` — Body `{ name }` (Inbox geschützt)
- `DELETE /api/projects/:id` — Aufnahmen → Inbox, Projekt löschen (Inbox geschützt)

### Aufnahmen
- `GET /api/recordings?project_id=&tag=&q=&limit=&offset=` — Liste mit Filtern
- `POST /api/recordings` — multipart oder JSON: `text`, `voice`, `model`, `project_id?`, `tags?`, `title?`, `file?`. Antwortet `202 Accepted`; Generierung läuft asynchron, Fortschritt per Polling abrufen.
- `POST /api/recordings/:id/cancel` — laufende Generierung abbrechen, Aufnahme verwerfen
- `POST /api/recordings/:id/retry` — fehlgeschlagene Aufnahme erneut versuchen (nur fehlende Abschnitte)
- `GET /api/recordings/:id` — Detail inkl. Tags, `status`, `progress_total`, `progress_done`, `error?`
- `PATCH /api/recordings/:id` — Body kann enthalten: `title`, `project_id`, `tags`
- `DELETE /api/recordings/:id` — Datei + DB-Eintrag (bricht laufende Generierung erst ab)
- `GET /api/recordings/:id/audio` — MP3 mit Range-Support für Inline-Player
- `GET /api/recordings/:id/download` — MP3 mit Content-Disposition

### Tags
- `GET /api/tags` — alle Tags mit Count

### Meta
- `GET /api/voices` — verfügbare Stimmen
- `GET /api/models` — zulässige Modelle
- `GET /health` — Healthcheck

## Lokale Entwicklung (ohne Docker)

```bash
npm install
npm run build
npm start
```

Oder mit TypeScript direkt (erfordert `ts-node`):

```bash
npm run dev
```

## Lizenz

MIT
