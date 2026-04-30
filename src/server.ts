import path from "path";
import fs from "fs";
import { openDb } from "./db";
import { createApp } from "./app";
import { reconcileOnStartup } from "./utils/recovery";
import { createWorker } from "./services/worker";

const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_ROOT = process.env.ARIA_DATA_DIR || path.join(__dirname, "..", "data");

fs.mkdirSync(path.join(DATA_ROOT, "audio"), { recursive: true });

const db = openDb(path.join(DATA_ROOT, "aria.db"));
reconcileOnStartup(db, DATA_ROOT);
const worker = createWorker({ db, dataRoot: DATA_ROOT });
const app = createApp({ db, dataRoot: DATA_ROOT, worker });

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aria TTS server running on http://0.0.0.0:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("WARNING: OPENAI_API_KEY is not set. API calls will fail.");
  }
});
