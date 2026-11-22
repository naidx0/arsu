// SPEC §2 — the sim's HTTP surface. Mounted at /sim by the server.
// Chaos and action are deliberately separate surfaces: chaos is what the
// demo operator presses; action is what only agents may use.

import express, { Router } from 'express';
import { ActionRequest, ChaosRequest } from '@arsu/core';
import { SimEngine, SimError } from './engine.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createSimApp(engine: SimEngine): Router {
  const app = Router();
  app.use(express.json());

  app.get('/registry', (_req, res) => {
    res.json({ services: engine.registry() });
  });

  app.get('/health/:id', async (req, res) => {
    try {
      await delay(engine.latency(req.params.id));
      res.json(engine.health(req.params.id));
    } catch (e) {
      res.status((e as SimError).status ?? 500).json(err(e));
    }
  });

  app.get('/op/:id', async (req, res) => {
    try {
      const h = engine.health(req.params.id);
      await delay(engine.latency(req.params.id));
      if (h.effective !== 'up') {
        res
          .status(503)
          .json({ id: req.params.id, error: 'unavailable', effective: h.effective });
        return;
      }
      res.json(engine.op(req.params.id));
    } catch (e) {
      res.status((e as SimError).status ?? 500).json(err(e));
    }
  });

  app.get('/flights', (_req, res) => {
    res.json(engine.flightsPayload());
  });

  app.get('/airports', (_req, res) => {
    res.json({ airports: engine.airports() });
  });

  app.post('/chaos', (req, res) => {
    try {
      res.json(engine.chaos(req.body as ChaosRequest));
    } catch (e) {
      res.status((e as SimError).status ?? 400).json(err(e));
    }
  });

  app.post('/action', (req, res) => {
    try {
      res.json(engine.act(req.body as ActionRequest));
    } catch (e) {
      res.status((e as SimError).status ?? 400).json(err(e));
    }
  });

  app.post('/reset', (_req, res) => {
    engine.reset();
    res.json({ ok: true });
  });

  return app;
}

function err(e: unknown) {
  return { error: e instanceof Error ? e.message : String(e) };
}
