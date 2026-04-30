import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { ttsRouter } from "./routes/tts";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Ensure tmp directory exists for temporary audio files
const tmpDir = path.join(__dirname, "..", "tmp");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/api", ttsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Fallback: serve index.html for root
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Aria TTS server running on http://0.0.0.0:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "WARNING: OPENAI_API_KEY is not set. API calls will fail."
    );
  }
});
