import assert from 'node:assert/strict';
import test from 'node:test';
import type { StateSnapshot } from '@arsu/core';
import { ResilientProvider, SimulatedProvider } from '@arsu/swarm';
import { createSummaryService } from './summary.js';

const state: StateSnapshot = {
  nodes: [], edges: [], invariants: [], specs: [], violations: [], agents: [],
  tasks: [], skills: [], events: [], provider: 'sim', mission: { launched: false },
  flights: { flights: [], groundStop: false, staleFeed: false },
};

test('standby summary never claims verified health and caches concurrent calls', async () => {
  let calls = 0;
  const provider = new SimulatedProvider();
  const original = provider.planJSON.bind(provider);
  provider.planJSON = async (...args) => { calls++; return original(...args); };
  const summary = createSummaryService(provider, async () => structuredClone(state));
  const [a, b] = await Promise.all([summary(), summary()]);
  assert.equal(a.provider, 'sim');
  assert.match(a.headline, /not mapped/i);
  assert.deepEqual(a, b);
  await summary();
  assert.equal(calls, 1);
});

test('valid Gemini summary retains grounded evidence and uses bounded server context', async () => {
  const node = { id: 'dispatch', name: 'Dispatch', kind: 'worker' as const, health: 'up' as const, discoveredBy: 'recon-1', firstSeen: 1, lastProbe: 2, evidence: [], description: 'x'.repeat(5000) };
  const summary = createSummaryService({
    name: 'gemini', complete: async () => '',
    planJSON: async <T>(_prompt: string, shape: string, context?: unknown) => {
      assert.equal(shape, 'summary');
      const ctx = context as { records: { value: string }[] };
      assert.ok(ctx.records[0].value.length <= 2000);
      return { provider: 'gemini', headline: 'Dispatch mapped; checks not yet available.', risks: [], nextAction: 'Inspect contracts.', evidence: ['nodes/dispatch'] } as T;
    },
  }, async () => ({ ...structuredClone(state), nodes: [node] }));
  const result = await summary();
  assert.equal(result.provider, 'gemini');
  assert.deepEqual(result.evidence, ['nodes/dispatch']);
});

test('malformed Gemini evidence falls back with an honest SIM label', async () => {
  const summary = createSummaryService({
    name: 'gemini', complete: async () => '',
    planJSON: async <T>() => ({ provider: 'gemini', headline: 'Safe', risks: [], nextAction: 'Wait', evidence: ['nodes/invented'] }) as T,
  }, async () => structuredClone(state));
  assert.equal((await summary()).provider, 'sim');
});

test('provider failure retains SIM attribution and operational risks', async () => {
  const provider = new ResilientProvider({ name: 'gemini', complete: async () => '', planJSON: async () => { throw new Error('offline'); } });
  const summary = createSummaryService(provider, async () => ({ ...structuredClone(state), flights: { flights: [], groundStop: true, staleFeed: true } }));
  const result = await summary();
  assert.equal(result.provider, 'sim');
  assert.match(result.risks.join(' '), /Ground stop/);
  assert.match(result.risks.join(' '), /stale/);
});
