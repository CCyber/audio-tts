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

## API Dokumentation

### `GET /health`

Health-Check-Endpoint.

### `GET /api/voices`

Liefert die verfügbaren Stimmen.

**Response:**
```json
{
  "items": [
    { "_id": "alloy", "title": "Alloy" },
    { "_id": "echo",  "title": "Echo"  }
  ]
}
```

### `GET /api/models`

Liefert die zugelassenen Modelle.

**Response:**
```json
{ "items": ["tts-1", "gpt-4o-mini-tts"] }
```

### `POST /api/tts`

Generiert eine MP3-Datei aus Text.

**Request** (`multipart/form-data` oder `application/x-www-form-urlencoded`):

| Feld            | Typ    | Beschreibung                                                   |
|-----------------|--------|----------------------------------------------------------------|
| `text`          | string | Der zu sprechende Text                                         |
| `reference_id`  | string | ID der gewählten Stimme (z.B. `alloy`) — Alias: `voice`        |
| `model`         | string | `tts-1` oder `gpt-4o-mini-tts`                                 |
| `file`          | file   | Optional: `.txt`-Datei statt Textfeld                          |

**Response:**
```json
{
  "success": true,
  "filename": "tts-uuid.mp3",
  "size": 123456,
  "chunks": 1,
  "download_url": "/api/download/tts-uuid.mp3"
}
```

### `GET /api/download/:filename`

Lädt die generierte MP3-Datei herunter. Dateien werden nach dem Download automatisch gelöscht.

## Features

- Automatisches Chunking langer Texte (> 4000 Zeichen pro Request)
- Temporäre Dateien werden automatisch nach 5 Minuten oder nach dem Download gelöscht
- Responsive Design
- Fortschrittsanzeige während der Generierung

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
