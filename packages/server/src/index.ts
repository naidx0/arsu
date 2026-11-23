// packages/server — the ARSU host. One process for the demo: mounts the
// sim, owns the blackboard + swarm runtime, exposes /api + /ws. In prod
// this splits to Cloud Functions / Cloud Run — the board switch is
// config, not code (SPEC §4).

import 'node:process';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AgentDoc,
  ChaosRequest,
  createBlackboard,
  Doc,
  EdgeDoc,
  EventDoc,
  FlightsPayload,
  InvariantDoc,
  LocalBlackboard,
  NodeDoc,
  SkillDoc,
  SpecDoc,
  StateSnapshot,
  TaskDoc,
  ViolationDoc,
  WsMessage,
} from '@arsu/core';
import { createSimApp, fetchLiveFlights, PRACTICE_SCENARIOS, SimEngine, SimError } from '@arsu/sim';
import {
  AgentRuntime,
  loadSkills,
  Orchestrator,
  selectProvider,
  SwarmCtx,
} from '@arsu/swarm';

import { createSummaryService } from './summary.js';
import { RehearsalController } from './rehearsal.js';

const PORT = Number(process.env.ARSU_PORT ?? 4780);
const SELF = `http://localhost:${PORT}`;
const SEED = path.resolve('data/flights.seed.json');
const BOARD_FILE = path.resolve('data/blackboard.json');
const SKILLS_DIR = path.resolve('skills');
const DASH_DIST = path.resolve('apps/dashboard/dist');

const practiceMode = process.argv.includes('--practice');
const recording = practiceMode || process.argv.includes('--recording');
const engine = new SimEngine(SEED, practiceMode);
const board = recording ? new LocalBlackboard() : createBlackboard(BOARD_FILE);
const provider = selectProvider();
const ctx: SwarmCtx = { board, provider, simBase: SELF, stepDelayMs: recording ? 900 : 0 };
const rehearsal = new RehearsalController(board, engine.registry(), recording, fault => { engine.chaos(fault); }, practiceMode ? PRACTICE_SCENARIOS : undefined);
const runtime = new AgentRuntime(ctx);
const orchestrator = new Orchestrator(ctx);

const mission = { launched: false, launchedAt: 0 };
let agentsSpawned = false;

// Idempotent swarm boot — safe on startup AND from /api/launch. Skills
// and orchestrator.launch() dedupe themselves; agents spawn once per
// process since their heartbeat loops live here, not on the board.
async function bootSwarm(): Promise<void> {
  if (!mission.launched) {
    mission.launched = true;
    mission.launchedAt = Date.now();
  }

  // mirror /skills/*.md into the skills collection
  for (const skill of loadSkills(SKILLS_DIR)) {
    await board.put('skills', skill.id, skill);
  }

  await orchestrator.launch();

  if (!agentsSpawned) {
    agentsSpawned = true;
    await runtime.spawn('runner');
    await runtime.spawn('recon');
    await runtime.spawn('verify');
    await runtime.spawn('verify');
    await runtime.spawn('response');
    await runtime.spawn('response');
  }
}

// Lane F — optional live ADS-B feed; seed stays the offline-safe default.
if (!recording && process.env.ARSU_FLIGHT_SOURCE === 'live') {
  void fetchLiveFlights().then(async (flights) => {
    if (flights) {
      engine.setFlights(flights);
      console.log(`[arsu] live ADS-B: ${flights.length} real aircraft on map`);
      await board.emit('mission', {
        actor: 'system',
        msg: `live ADS-B feed connected — ${flights.length} real aircraft`,
      });
    } else {
      console.warn('[arsu] live ADS-B unavailable — using seed flights');
    }
  });
}

// ---------- WS broadcast ----------

const wssClients = new Set<WebSocket>();
function broadcast(msg: WsMessage): void {
  const raw = JSON.stringify(msg);
  for (const ws of wssClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  }
}

// push per-doc changes on every collection
const COL_MSG: Record<string, WsMessage['type']> = {
  nodes: 'node',
  edges: 'edge',
  invariants: 'invariant',
  violations: 'violation',
  tasks: 'task',
  agents: 'agent',
  specs: 'spec',
  skills: 'skill',
  events: 'event',
};
const docCache = new Map<string, Map<string, string>>();
for (const [col, type] of Object.entries(COL_MSG)) {
  board.watch(col, (docs: Doc<unknown>[]) => {
    const cache = docCache.get(col) ?? new Map<string, string>();
    docCache.set(col, cache);
    for (const d of docs) {
      const hash = JSON.stringify(d.data);
      if (cache.get(d.id) === hash) continue;
      cache.set(d.id, hash);
      broadcast({ type, data: d.data } as WsMessage);
    }
  });
}

// ---------- HTTP + WS wiring ----------

const app = express();
app.use(express.json());
app.use('/sim', createSimApp(engine));

async function snapshot(): Promise<StateSnapshot> {
  const [nodes, edges, invariants, specs, violations, agents, tasks, skills, events] =
    await Promise.all([
      board.query<NodeDoc>('nodes'),
      board.query<EdgeDoc>('edges'),
      board.query<InvariantDoc>('invariants'),
      board.query<SpecDoc>('specs'),
      board.query<ViolationDoc>('violations'),
      board.query<AgentDoc>('agents'),
      board.query<TaskDoc>('tasks'),
      board.query<SkillDoc>('skills'),
      board.query<EventDoc>('events'),
    ]);
  const state: StateSnapshot = {
    events: events.map(d => d.data).sort((a, b) => b.ts - a.ts).slice(0, 300),
    nodes: nodes.map((d) => d.data),
    edges: edges.map((d) => d.data),
    invariants: invariants.map((d) => d.data),
    specs: specs.map((d) => d.data),
    violations: violations.map((d) => d.data),
    agents: agents.map((d) => d.data),
    tasks: tasks.map((d) => d.data),
    skills: skills.map((d) => d.data),
    flights: engine.flightsPayload(),
    provider: provider.name,
    mission: {
      launched: mission.launched,
      launchedAt: mission.launchedAt || undefined,
    },
  };
  const practice = engine.practiceSnapshot();
  if (practice) state.practice = { ...practice, observer: { source: 'observed ARSU host process', uptimeSeconds: Math.floor(process.uptime()), processMemoryMb: Math.round(process.memoryUsage().rss / 1048576), logicalCpuCount: os.cpus().length } };
  state.rehearsal = await rehearsal.status(state);
  return state;
}

app.get('/api/rehearsal', async (_req, res) => {
  res.json((await snapshot()).rehearsal);
});
app.post('/api/rehearsal', async (req, res) => {
  try {
    const run = await rehearsal.start(req.body.scenario, await snapshot());
    broadcast({ type: 'rehearsal', data: (await snapshot()).rehearsal! });
    res.status(202).json(run);
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : 'Stress test could not start' });
  }
});
app.get('/api/rehearsal/:id/evidence', async (req, res) => {
  const run = await rehearsal.evidence(req.params.id);
  if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
  if (run.outcome === 'running') { res.status(409).json({ error: 'Wait for the run to finish' }); return; }
  res.setHeader('Content-Disposition', `attachment; filename="arsu-evidence-${run.id}.json"`);
  res.json(run);
});

const summarize = createSummaryService(provider, snapshot);
app.post('/api/summary', async (_req, res) => {
  try {
    res.json(await summarize());
  } catch {
    res.status(503).json({ error: 'Operational summary unavailable; inspect the Blackboard directly.' });
  }
});

app.get('/api/state', async (_req, res) => {
  res.json(await snapshot());
});

app.post('/api/launch', async (_req, res) => {
  if (!mission.launched) {
    await bootSwarm();
  } else {
    await board.add('tasks', {
      id: '',
      kind: 'recon',
      target: 'registry',
      priority: 5,
      status: 'pending',
      attempts: 0,
      createdBy: 'operator',
    });
    await board.emit('mission', {
      actor: 'operator',
      msg: 'swarm re-scan triggered by operator',
    });
  }
  res.json({
    ok: true,
    provider: provider.name,
    launchedAt: mission.launchedAt,
  });
});

async function syncLiveFeed(res: express.Response): Promise<void> {
  const live = await fetchLiveFlights();
  if (live && live.length > 0) {
    engine.setFlights(live);
    broadcast({ type: 'flight', data: engine.flightsPayload() });
    await board.emit('mission', {
      actor: 'system',
      msg: `Open-source ADS-B feed synced — ${live.length} live North America aircraft tracked`,
    });
  } else if (!live) {
    await board.emit('mission', {
      actor: 'system',
      severity: 'info',
      msg: 'ADS-B live endpoint unreachable — maintaining deterministic North America flight feed',
    });
  }
  res.json({
    ok: true,
    source: live ? 'live-adsb' : 'seed',
    count: engine.flightsPayload().flights.length,
  });
}

app.post('/api/flights/live', (_req, res) => {
  void syncLiveFeed(res);
});
app.get('/api/flights/live', (_req, res) => {
  void syncLiveFeed(res);
});

app.post('/api/chaos', async (req, res) => {
  try {
    const out = engine.chaos(req.body as ChaosRequest);
    await board.emit('chaos', {
      actor: 'operator',
      node: req.body.target,
      severity: 'crit',
      msg: `CHAOS: ${req.body.type} ${req.body.target}${req.body.dep ? ` (dep ${req.body.dep})` : ''}`,
      data: req.body,
    });
    res.json(out);
  } catch (e) {
    res.status((e as SimError).status ?? 400).json({ error: String(e) });
  }
});

app.post('/api/reset', async (_req, res) => {
  engine.reset();
  await (board as { clearExcept?: (k: string[]) => Promise<void> })
    .clearExcept?.(['skills']);
  docCache.clear();
  await board.emit('mission', {
    actor: 'operator',
    severity: 'warn',
    msg: 'reset — board wiped, estate restored',
  });
  // if a mission is live, re-seed recon so the swarm re-maps the estate
  if (mission.launched) {
    await board.add('tasks', {
      id: '',
      kind: 'recon',
      target: 'registry',
      priority: 5,
      status: 'pending',
      attempts: 0,
      createdBy: 'system',
    });
  }
  res.json({ ok: true });
});

app.post('/api/resolve', async (req, res) => {
  const { violationId } = req.body as { violationId?: string };
  if (!violationId) {
    res.status(400).json({ error: 'violationId required' });
    return;
  }
  await board.patch('violations', violationId, {
    status: 'resolved',
    resolvedBy: 'operator',
    resolution: 'manually resolved from control board',
    lastSeen: Date.now(),
  });
  res.json({ ok: true });
});

if (fs.existsSync(DASH_DIST)) {
  app.use(express.static(DASH_DIST));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', async (ws) => {
  wssClients.add(ws);
  ws.send(
    JSON.stringify({ type: 'snapshot', data: await snapshot() } as WsMessage),
  );
  ws.on('close', () => wssClients.delete(ws));
});

// ---------- steady-state loops ----------

// flight ticker → WS (1 Hz)
let samplingRehearsal = false;
setInterval(() => {
  const payload: FlightsPayload = engine.tick(1000);
  broadcast({ type: 'flight', data: payload });
  if (!samplingRehearsal) {
    samplingRehearsal = true;
    void (async () => {
      try {
        await rehearsal.advance(await snapshot());
        const current = await snapshot();
        broadcast({ type: 'rehearsal', data: current.rehearsal! });
        if (current.practice) broadcast({ type: 'practice', data: current.practice });
      } finally { samplingRehearsal = false; }
    })();
  }
}, 1000);

// sim truth → board node.health (1 Hz) so the ontology + invariants see
// the same world the map does
setInterval(() => {
  void (async () => {
    for (const svc of engine.registry()) {
      const eff = engine.effective(svc.id);
      const node = await board.get<NodeDoc>('nodes', svc.id);
      if (node && node.data.health !== eff) {
        await board.patch<NodeDoc>('nodes', svc.id, { health: eff });
      }
    }
  })();
}, 1000);

// swarm + proof-runner come up with the host, even over a warm board file
if (!recording) void bootSwarm();
server.listen(PORT, () => {
  if (recording) console.log('[arsu] RECORDING: ephemeral board, seed flights, manual launch, paced workers');
  console.log(`[arsu] provider=${provider.name}  http://localhost:${PORT}`);
  console.log(`[arsu] sim at /sim — control board proxies /api + /ws`);
  if (recording && !practiceMode) console.log(`[arsu] DEMO: open http://localhost:${PORT}/?demo for the presenter director`);
});
