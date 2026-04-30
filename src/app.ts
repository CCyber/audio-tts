import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import path from "path";
import type { DB } from "./db";
import { ApiError } from "./utils/errors";

export interface AppDeps {
  db: DB;
  dataRoot: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  // Routers werden in den nächsten Tasks angehängt.
  app.locals.deps = deps;

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Static frontend
  app.use(express.static(path.join(__dirname, "public")));
  app.get("/", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // Centralized error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Unhandled error:", message);
    res.status(500).json({ error: message });
  });

  return app;
}
