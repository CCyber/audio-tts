# Fish Audio TTS

Web-Applikation zur Text-to-Speech-Generierung mit der [Fish Audio](https://fish.audio) API. Bietet ein modernes Browser-Interface zum Eingeben von Text oder Hochladen von `.txt`-Dateien, Auswahl von Stimmen und Modellen, sowie den Download der generierten MP3-Dateien.

## Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) (>= 20.x)
- [Docker Compose](https://docs.docker.com/compose/install/) (>= 2.x)
- Ein [Fish Audio](https://fish.audio) API-Key

## Setup

```bash
# 1. Repository klonen
git clone https://github.com/dein-user/fish-audio-tts.git
cd fish-audio-tts

# 2. Umgebungsvariablen konfigurieren
cp .env.example .env
# .env bearbeiten und API-Key eintragen

# 3. Container starten
docker compose up -d

# 4. Browser öffnen
open http://localhost:3000
```

## Umgebungsvariablen

| Variable              | Beschreibung                          | Standard |
|-----------------------|---------------------------------------|----------|
| `FISH_AUDIO_API_KEY`  | API-Key für Fish Audio (erforderlich) | –        |
| `PORT`                | Server-Port                           | `3000`   |

## API Dokumentation

### `GET /health`

Health-Check-Endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

### `GET /api/voices`

Lädt die verfügbaren Stimmen aus der Fish Audio Library (eigene Modelle).

**Response:**
```json
{
  "items": [
    {
      "_id": "abc123",
      "title": "Meine Stimme",
      "description": "..."
    }
  ]
}
```

### `POST /api/tts`

Generiert eine MP3-Datei aus Text.

**Request** (`multipart/form-data` oder `application/x-www-form-urlencoded`):

| Feld            | Typ    | Beschreibung                              |
|-----------------|--------|-------------------------------------------|
| `text`          | string | Der zu sprechende Text                    |
| `reference_id`  | string | ID der gewählten Stimme                   |
| `model`         | string | Modellname (`fish-speech-1.5` / `fish-speech-1.6`) |
| `file`          | file   | Optional: `.txt`-Datei statt Textfeld     |

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

- Automatisches Chunking langer Texte (> 2000 Zeichen)
- Temporäre Dateien werden automatisch nach 5 Minuten oder nach dem Download gelöscht
- Responsive Design
- Fortschrittsanzeige während der Generierung
- Benutzerfreundliche Fehlermeldungen

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
