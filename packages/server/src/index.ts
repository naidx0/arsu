// packages/server — the ARSU host. One process for the demo: mounts the
// sim, owns the blackboard + swarm runtime, exposes /api + /ws. In prod
// this splits to Cloud Functions / Cloud Run — the board switch is
// config, not code (SPEC §4).

import 'node:process';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  AgentDoc,
  ChaosRequest,
  createBlackboard,
  Doc,
  EdgeDoc,
  FlightsPayload,
  InvariantDoc,
  NodeDoc,
  SkillDoc,
  SpecDoc,
  StateSnapshot,
  TaskDoc,
  ViolationDoc,
  WsMessage,
} from '@arsu/core';
import { createSimApp, SimEngine, SimError } from '@arsu/sim';
import {
  AgentRuntime,
  loadSkills,
  Orchestrator,
  selectProvider,
  SwarmCtx,
} from '@arsu/swarm';

const PORT = Number(process.env.ARSU_PORT ?? 4780);
const SELF = `http://localhost:${PORT}`;
const SEED = path.resolve('data/flights.seed.json');
const BOARD_FILE = path.resolve('data/blackboard.json');
const SKILLS_DIR = path.resolve('skills');
const DASH_DIST = path.resolve('apps/dashboard/dist');

const engine = new SimEngine(SEED);
const board = createBlackboard(BOARD_FILE);
const provider = selectProvider();
const ctx: SwarmCtx = { board, provider, simBase: SELF };
const runtime = new AgentRuntime(ctx);
const orchestrator = new Orchestrator(ctx);

const mission = { launched: false, launchedAt: 0 };

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
  const [nodes, edges, invariants, specs, violations, agents, tasks, skills] =
    await Promise.all([
      board.query<NodeDoc>('nodes'),
      board.query<EdgeDoc>('edges'),
      board.query<InvariantDoc>('invariants'),
      board.query<SpecDoc>('specs'),
      board.query<ViolationDoc>('violations'),
      board.query<AgentDoc>('agents'),
      board.query<TaskDoc>('tasks'),
      board.query<SkillDoc>('skills'),
    ]);
  return {
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
}

app.get('/api/state', async (_req, res) => {
  res.json(await snapshot());
});

app.post('/api/launch', async (_req, res) => {
  if (mission.launched) {
    res.json({ ok: true, already: true });
    return;
  }
  mission.launched = true;
  mission.launchedAt = Date.now();

  // mirror /skills/*.md into the skills collection
  for (const skill of loadSkills(SKILLS_DIR)) {
    await board.put('skills', skill.id, skill);
  }

  await orchestrator.launch();
  await runtime.spawn('runner');
  await runtime.spawn('recon');
  await runtime.spawn('verify');
  await runtime.spawn('verify');
  await runtime.spawn('response');
  await runtime.spawn('response');
  res.json({ ok: true, provider: provider.name });
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
setInterval(() => {
  const payload: FlightsPayload = engine.tick(1000);
  broadcast({ type: 'flight', data: payload });
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

server.listen(PORT, () => {
  console.log(`[arsu] provider=${provider.name}  http://localhost:${PORT}`);
  console.log(`[arsu] sim at /sim — control board proxies /api + /ws`);
});
