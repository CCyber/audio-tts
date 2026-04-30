# Async TTS Generation with Progress

**Status:** Draft for review
**Date:** 2026-04-30
**Owner:** ceschuler

## Problem

Long TTS generations (e.g. 30 000 characters → ~8 sequential OpenAI calls, 30–120 s total) are submitted via a synchronous `POST /api/recordings` request. Reverse proxies in front of the Node container (Synology DSM, nginx, Cloudflare) close the HTTP connection well before the backend finishes, so the browser shows a misleading red error banner even though the recording is later persisted to disk and DB. There is also no progress feedback during the wait, no way to cancel, and no way to resume after a transient failure (rate limits, server crash).

## Goals

1. Decouple the HTTP request from the actual generation: submit returns immediately.
2. Show real, user-friendly progress in the UI (chunk-based, no jargon).
3. Allow the user to cancel a running generation.
4. On failure, regenerate only the missing chunks instead of the whole text (resume).
5. Survive server restarts without losing already-rendered chunks.

## Non-goals

- Multi-server / horizontal scaling. The app is a single-process Node container on a NAS.
- Real-time push (SSE / WebSocket). Polling is sufficient and avoids the proxy-timeout problem that motivated this work.
- Cost-optimisation features beyond resume (no caching of previously generated chunks across recordings, no deduplication).

## User-facing decisions (locked)

| Question | Decision |
|---|---|
| What happens after clicking "Generieren"? | **B**: Modal closes immediately; a "generating" card appears in the recording list. |
| Progress display | **A**: Chunk-based progress, but with friendly language: primary line `"Vertonung läuft…"`, secondary muted line `"Abschnitt 3 von 8"`. |
| Cancel? | **A**: Cancel button on the pending card. Worker stops between chunks, recording row + chunk files are deleted. No `cancelled` history state. |
| Failure handling | **C**: Resume — `Erneut versuchen` only regenerates failed/pending chunks; already-`done` chunks are reused. |
| Update mechanism | **1**: Polling (1 s interval, only while pending recordings exist). |

## Architecture overview

```
┌──────────┐  POST /api/recordings (202)   ┌──────────────┐
│ Browser  │ ───────────────────────────▶  │  Express     │
│          │ ◀─── recording {pending}      │  recordings  │
│          │                               │  router      │
│          │  GET /api/recordings/:id      └──────┬───────┘
│ Polling  │ ───────────────────────────▶         │ enqueue
│ 1 s      │ ◀─── {progress_done, progress_total} │
└──────────┘                                      ▼
                                            ┌──────────────┐
                                            │  Worker      │
                                            │  (in-proc    │
                                            │  queue,      │
                                            │  concurrency │
                                            │  = 1)        │
                                            └──────┬───────┘
                                                   │ per chunk
                                                   ▼
                                            ┌──────────────┐
                                            │  OpenAI TTS  │
                                            └──────────────┘
```

## Data model

### `recordings` (extended)

| Column | Type | Notes |
|---|---|---|
| `status` | TEXT NOT NULL DEFAULT `'done'` | `'generating'` \| `'done'` \| `'failed'` |
| `progress_total` | INTEGER NOT NULL DEFAULT 0 | Number of chunks the text was split into |
| `progress_done` | INTEGER NOT NULL DEFAULT 0 | Chunks completed |
| `error` | TEXT NULL | Last error message when `status='failed'` |
| `file_path` | TEXT NULL | Was NOT NULL; relaxed to NULL until status=`'done'` |
| `file_size` | INTEGER NULL | Same |
| `duration_ms` | INTEGER NULL | Same |

Migration sets `status='done'`, `progress_total=1`, `progress_done=1` for existing rows so the list endpoint and UI keep working without special-casing.

### `recording_chunks` (new)

```sql
CREATE TABLE recording_chunks (
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  idx          INTEGER NOT NULL,
  text         TEXT    NOT NULL,
  status       TEXT    NOT NULL,       -- 'pending' | 'done' | 'failed'
  file_path    TEXT,                    -- relative path, set when done
  byte_size    INTEGER,
  error        TEXT,
  PRIMARY KEY (recording_id, idx)
);
CREATE INDEX idx_recording_chunks_status ON recording_chunks(recording_id, status);
```

`text` is stored per chunk so resume after restart does not depend on re-splitting (the splitter heuristics may change later).

### Filesystem

```
data/
├── audio/
│   ├── <uuid>.mp3                         # final, completed recordings (existing)
│   └── chunks/
│       └── <recording_id>/
│           ├── 0.mp3                      # temp chunk audio
│           ├── 1.mp3
│           └── ...
└── aria.db
```

Chunk directory is removed after successful concat.

## Backend

### API surface

| Method + path | Behavior |
|---|---|
| `POST /api/recordings` | **Now async.** Validates input, splits text via existing `splitTextIntoChunks`, inserts `recordings` row (`status='generating'`, `progress_total=N`, `progress_done=0`, `file_path=NULL`) and N `recording_chunks` rows (`status='pending'`) inside one transaction. Enqueues a job. Responds **`202 Accepted`** with the full recording (including `tags`, `progress_*`, `status`). |
| `GET /api/recordings/:id` | Returns recording with `status`, `progress_total`, `progress_done`, `error?`. |
| `GET /api/recordings` | Same fields per item. |
| `POST /api/recordings/:id/cancel` | Sets cancel flag. Worker observes between chunks, deletes chunk files + DB rows. Responds `204`. `409` if status != `'generating'`. |
| `POST /api/recordings/:id/retry` | Resets `failed` chunks → `pending`, clears `recordings.error`, sets `status='generating'`, re-enqueues. `409` if status != `'failed'`. Done chunks stay → resume. |
| `GET /api/recordings/:id/audio` | `404` if `status != 'done'`. |
| `DELETE /api/recordings/:id` | If `generating`: cancel first, then delete. Otherwise unchanged. |

### Worker

Single in-process module (`src/services/worker.ts`):

- A FIFO queue of `recordingId` values.
- One concurrent job (`MAX_CONCURRENT_JOBS = 1`) — protects against OpenAI rate limits and keeps the design simple. Constant, easy to raise later.
- Per job:
  1. Load all `pending` chunks for the recording (ordered by `idx`).
  2. For each chunk:
     - Check the cancel flag. If set: clean up + return.
     - Call OpenAI. **Auto-retry** on `429` and `5xx`: 2 retries with 2 s / 4 s linear backoff. (Robustness layer below the manual resume; cheap and orthogonal.)
     - Write `data/audio/chunks/<id>/<idx>.mp3`.
     - Transaction: set `chunk.status='done'`, `chunk.file_path`, `chunk.byte_size`; increment `recordings.progress_done`.
     - On hard failure: set `chunk.status='failed'`, `chunk.error`, `recording.status='failed'`, `recording.error`, return.
  3. After all chunks `done`: streaming concat (`fs.createReadStream` per chunk → single `fs.createWriteStream`) into `data/audio/<uuid>.mp3`. Constant memory regardless of recording length.
  4. Measure duration via existing `measureDurationMs`.
  5. Transaction: `recording.status='done'`, set `file_path`, `file_size`, `duration_ms`. Delete `recording_chunks` rows + chunk dir on disk.

### Cancel flag

A `Map<recordingId, true>` in the worker module. The cancel route writes to it, the worker checks it between chunks. Cleared after the worker observes it.

### Crash recovery on startup

In `server.ts` (or a dedicated startup hook), before accepting requests:

```sql
UPDATE recordings
   SET status = 'failed',
       error  = 'Server wurde während der Generierung neugestartet'
 WHERE status = 'generating';
```

Done-chunk files on disk survive. User clicks `Erneut versuchen` → the existing retry endpoint resumes from the persisted state. **No automatic resume** at startup — that would silently incur OpenAI cost on every restart.

Filesystem reconciliation on startup:
- For every `recording_chunks` row with `status='done'`, verify `file_path` exists. If missing, demote to `pending`.
- For every chunk dir without a matching DB row, delete it (orphan cleanup).

## Frontend

### Modal (`src/public/generate.ts`)

- After successful `POST /api/recordings` → close modal immediately, dispatch `aria:reload-recordings`. Drop the in-modal spinner / "Wird generiert…" state.
- Validation errors and pre-submit failures (e.g. missing API key, validation 4xx) still show the existing `.error-banner` inline.

### Card (`src/public/card.ts`)

Three render variants based on `status`:

- **`generating`**:
  - `<progress value=N max=M>` + custom CSS for an animated stripe overlay between updates.
  - Primary line: `Vertonung läuft…`
  - Secondary muted line: `Abschnitt {progress_done + 1} von {progress_total}` (the chunk currently being worked on, not the count of finished ones).
  - Single button: `Abbrechen`. While the cancel request is in flight: button disabled with text `Wird abgebrochen…`.
  - No player, no download, no edit affordances.
- **`failed`**:
  - Red dezent banner inside the card with `error` text from the API.
  - Two buttons: `Erneut versuchen`, `Löschen`.
  - No player.
- **`done`**: existing card UI (player, tags, edit, download, delete) — unchanged.

### Polling (new `src/public/polling.ts`)

- Module owns a `Set<number>` of recording IDs in `generating` status.
- `register(id)` adds to the set and (if not already running) starts `setInterval(tick, 1000)`.
- `tick()` calls `GET /api/recordings/:id` for every id in parallel via `Promise.allSettled`.
  - On `done` or `failed`: remove from set; trigger a card-level re-render via `document.dispatchEvent(new CustomEvent('aria:recording-updated', { detail: recording }))`.
  - On still-`generating`: update progress bar value + secondary text on the existing card DOM in place (no re-render → no flicker, no scroll reset).
  - On network error: keep id in set, try again next tick. Three consecutive errors → log to console, keep polling (don't drop state silently).
- When the set becomes empty: `clearInterval`, leave a sentinel so a future `register` re-starts.
- Triggers:
  - `library.ts` after fetching the list: register every `generating` recording.
  - `generate.ts` after successful submit: register the new id.
  - `card.ts` after successful retry: register the id.

### API client (`src/public/api.ts`)

```ts
type RecordingStatus = 'generating' | 'done' | 'failed';

interface Recording {
  id: number;
  status: RecordingStatus;
  progress_total: number;
  progress_done: number;
  error?: string;
  file_path: string | null;     // null until done
  file_size: number | null;
  duration_ms: number | null;
  // ...existing fields
}

api.cancelRecording(id: number): Promise<void>
api.retryRecording(id: number): Promise<Recording>
```

## Error handling

| Scenario | Handling |
|---|---|
| Missing / invalid OPENAI_API_KEY | Pre-flight check in `POST /api/recordings` before insert. Return `500` with clear message. No pending row created. |
| OpenAI 429 / 5xx | Auto-retry inside worker (2× with 2 s / 4 s backoff). On giving up: chunk + recording → `failed`. |
| OpenAI 4xx (other) | Immediate `failed`. Persist the upstream message in `error`. |
| Disk write fails on chunk | `failed` for that chunk + recording. Other chunks survive on disk → resume. |
| Disk write fails during concat | `failed` with error `"Datei konnte nicht gespeichert werden"`. Chunk files preserved → retry skips straight to concat. |
| Server crash mid-job | Startup migrates `generating` → `failed`. User retries → resume from done chunks. |
| User clicks Cancel during last chunk | Worker still finishes that chunk's OpenAI call (no in-call abort), then sees flag, then deletes everything. UI shows `Wird abgebrochen…` for ≤ ~15 s. |
| User clicks Cancel twice | Endpoint returns `409` on second call; UI ignores. |
| User clicks Retry on a non-failed recording | `409`. Should not be reachable from UI. |
| Concurrent generations | Queue serialises. Cards beyond the active one stay at `0/N` until their turn. |

## Logging

Worker logs at info level: `recording {id} chunk {idx}/{total} ok ({ms} ms)`. At warn level: rate limit hits + retries. At error level: hard failures with OpenAI status code, response body excerpt (truncated), and recording id. No PII in logs (no full user text).

## Testing

Unit:
- `splitTextIntoChunks` (already covered) — no change.
- DB migration round-trip: open old DB schema, run migration, assert new columns + defaults.
- Filesystem reconciliation on startup: orphan dir cleanup, missing-file demotion.

Integration (vitest, with mocked OpenAI fetch):
- Happy path: submit → poll → `done`. Assert chunk dir is gone after concat. Assert final file size ≈ Σ chunk sizes.
- Auto-retry on 429: first call returns 429, second succeeds, recording ends as `done`.
- Permanent failure: chunk fails after retries → `failed`, error text persisted.
- Cancel mid-job: cancel after first chunk done; row + chunk dir gone, no further OpenAI calls.
- Resume: simulate failure on chunk 4/8; retry → only chunks 4..7 hit OpenAI, chunks 0..3 reused.
- Crash recovery: insert `generating` row, run startup hook, assert `failed` + correct error text.
- Cancel race: cancel during the in-flight chunk's OpenAI call (mock delays response); assert worker finishes the call but does not start the next chunk.

End-to-end (manual smoke test in browser, documented in PR):
- 30 000-character text via the modal; verify progress bar, cancel button, retry flow.

## Out of scope (explicit non-features)

- Cancel during an in-flight OpenAI call (only between chunks).
- Persistent job queue across restarts (we use crash recovery + manual retry instead).
- Per-user / per-project rate limiting.
- WebSocket or SSE — polling only.
- Cancel history / `cancelled` status — cancel = delete.

## Open questions

None remaining. Design is locked pending user review of this document.
