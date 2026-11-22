import assert from 'node:assert/strict';
import test from 'node:test';
import { LocalBlackboard, type EdgeDoc, type EventDoc, type NodeDoc, type ViolationDoc } from '@arsu/core';
import { doRecon, evaluateInvariant } from './roles.js';
import { SimulatedProvider } from './provider.js';
import { Orchestrator } from './orchestrator.js';

test('discovery publishes dependency edges before the node can trigger verification', async () => {
  const board = new LocalBlackboard();
  const put = board.put.bind(board);
  board.put = async <T>(col: string, id: string, data: T) => {
    if (col === 'nodes' && id === 'dispatch') {
      assert.equal((await board.query<EdgeDoc>('edges')).length, 1);
    }
    return put(col, id, data);
  };
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    return Response.json(url.endsWith('/registry') ? { services: [{ id: 'dispatch', name: 'Dispatch', kind: 'worker', deps: ['hub'], description: '' }] } : url.includes('/health/') ? { state: 'up', effective: 'up' } : { rev: 1 });
  };
  try {
    await doRecon({ board, provider: new SimulatedProvider(), simBase: 'http://fixture' }, 'recon', { id: 't', kind: 'recon', target: 'registry', priority: 5, status: 'claimed', attempts: 1, createdBy: 'test' });
    assert.ok(await board.get<NodeDoc>('nodes', 'dispatch'));
  } finally { globalThis.fetch = original; }
});

test('consistency cannot pass when both required fields are missing', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  try {
    const result = await evaluateInvariant({ board: new LocalBlackboard(), provider: new SimulatedProvider(), simBase: 'http://fixture' }, { id: 'i', node: 'hub', kind: 'consistency', params: { url: 'http://fixture/a', via: 'http://fixture/b', field: 'rev' }, intervalMs: 2000, authoredBy: 'test', runs: 0 });
    assert.equal(result.pass, false);
  } finally { globalThis.fetch = original; }
});

test('triage is not mission resolution', async () => {
  const board = new LocalBlackboard();
  const orchestrator = new Orchestrator({ board, provider: new SimulatedProvider(), simBase: 'http://fixture' });
  try {
    await orchestrator.launch();
    await board.put<ViolationDoc>('violations', 'v', { id: 'v', invariant: 'i', node: 'hub', detail: '', firstSeen: 1, lastSeen: 1, count: 1, status: 'open' });
    await board.patch<ViolationDoc>('violations', 'v', { status: 'triaged' });
    assert.equal((await board.query<EventDoc>('events')).some(e => e.data.msg.includes('mission: resolved')), false);
  } finally { orchestrator.stop(); }
});
