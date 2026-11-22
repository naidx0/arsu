import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalBlackboard, type RehearsalRun, type ServiceInfo, type StateSnapshot } from '@arsu/core';
import { readiness, RehearsalController } from './rehearsal.js';

const services: ServiceInfo[] = [{ id: 'dispatch', name: 'Dispatch', kind: 'worker', deps: ['hub'], description: '' }, { id: 'hub', name: 'Hub', kind: 'hub', deps: [], description: '' }];
const baseline = (): StateSnapshot => ({
  nodes: services.map(s => ({ ...s, health: 'up', discoveredBy: 'recon', firstSeen: 1, lastProbe: Date.now(), evidence: ['probe'] })),
  edges: [{ id: 'dispatch->hub', from: 'dispatch', to: 'hub', required: true, discoveredBy: 'recon', evidence: [] }],
  invariants: services.flatMap(s => [
    { id: `http-${s.id}`, node: s.id, kind: 'http_status' as const, params: {}, authoredBy: 'verify', intervalMs: 2000, runs: 1, lastRun: Date.now(), lastResult: 'pass' as const },
    ...s.deps.map(dep => ({ id: `dep-${s.id}`, node: s.id, kind: 'dep_health' as const, params: { dep }, authoredBy: 'verify', intervalMs: 2000, runs: 1, lastRun: Date.now(), lastResult: 'pass' as const })),
  ]),
  specs: services.map(s => ({ id: `spec-${s.id}`, node: s.id, title: '', body: '', invariants: [`http-${s.id}`], authoredBy: 'verify', version: 1 })),
  violations: [], tasks: [], agents: [], skills: [], events: [], flights: { flights: [], groundStop: false, staleFeed: false }, provider: 'sim', mission: { launched: true },
});

test('readiness requires complete discovered coverage and fresh passing proofs', () => {
  assert.deepEqual(readiness(baseline(), services), []);
  const missing = baseline(); missing.invariants = missing.invariants.filter(i => i.kind !== 'dep_health');
  assert.match(readiness(missing, services).join(' '), /dependency contract/);
  const stale = baseline(); stale.invariants[0].lastRun = 1;
  assert.match(readiness(stale, services).join(' '), /fresh/);
  const empty = baseline(); empty.nodes = []; empty.invariants = []; empty.specs = [];
  assert.ok(readiness(empty, services).length > 0);
});

test('triaged and escalated violations and unfinished work block readiness', () => {
  for (const status of ['triaged', 'escalated'] as const) {
    const state = baseline(); state.violations = [{ id: 'v', invariant: 'http-hub', node: 'hub', detail: '', firstSeen: 1, lastSeen: 2, count: 1, status }];
    assert.match(readiness(state, services).join(' '), /unresolved/);
  }
  const state = baseline(); state.tasks = [{ id: 't', kind: 'recon', target: 'registry', priority: 5, status: 'claimed', attempts: 1, createdBy: 'operator' }];
  assert.match(readiness(state, services).join(' '), /unfinished/);
});

test('a green screen alone cannot verify a stress test; evidence is frozen after real recovery', async () => {
  const board = new LocalBlackboard();
  let injections = 0;
  const controller = new RehearsalController(board, services, true, () => { injections++; });
  const run = await controller.start('hub-outage', baseline());
  await assert.rejects(controller.start('hub-outage', baseline()), /already running/);
  assert.equal(injections, 1);
  await controller.advance(baseline());
  assert.equal((await board.get<RehearsalRun>('rehearsals', run.id))?.data.outcome, 'running');
  const restored = baseline();
  restored.violations = [{ id: 'v', invariant: 'http-hub', node: 'hub', detail: '503', firstSeen: run.startedAt, lastSeen: Date.now(), count: 1, status: 'resolved' }];
  restored.events = [{ id: 'action', type: 'action', actor: 'response', ts: run.startedAt, severity: 'info', msg: 'restart hub → ok' }];
  restored.invariants.forEach(i => { i.lastRun = run.startedAt - 1; });
  await controller.advance(restored);
  assert.equal((await controller.evidence(run.id))?.outcome, 'running');
  restored.invariants.forEach(i => { i.lastRun = run.startedAt + 1; });
  await controller.advance(restored);
  assert.equal((await controller.evidence(run.id))?.outcome, 'verified');
  restored.invariants[0].lastResult = 'fail';
  assert.equal((await controller.evidence(run.id))?.evidence?.invariants[0].lastResult, 'pass');
});

test('an escalation cannot be reported as verified recovery', async () => {
  const board = new LocalBlackboard();
  const controller = new RehearsalController(board, services, true, () => {});
  const run = await controller.start('hub-outage', baseline());
  const state = baseline();
  state.events = [{ id: 'escalate', type: 'escalate', actor: 'response', ts: run.startedAt, severity: 'crit', msg: 'Human required' }];
  await controller.advance(state);
  assert.equal((await controller.evidence(run.id))?.outcome, 'failed');
});
