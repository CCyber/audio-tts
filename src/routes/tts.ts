import { Router } from "express";
import { ALLOWED_MODELS, VOICES } from "../services/tts";

export function metaRouter(): Router {
  const router = Router();

  router.get("/voices", (_req, res) => {
    res.json({
      items: VOICES.map((v) => ({ _id: v.id, title: v.title })),
    });
  });

  router.get("/models", (_req, res) => {
    res.json({ items: ALLOWED_MODELS });
  });

  return router;
}
