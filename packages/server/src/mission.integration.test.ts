import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import type { RehearsalRun, StateSnapshot } from '@arsu/core';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
test('recording environment discovers, verifies, stress-tests and exports four real swarm responses', { timeout: 180_000 }, async () => {
  const reservation = net.createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const host = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/index.ts', '--recording'], { env: { ...process.env, ARSU_PORT: String(port), ARSU_PROVIDER: 'sim' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  host.stdout.on('data', d => { log = (log + String(d)).slice(-8000); });
  host.stderr.on('data', d => { log = (log + String(d)).slice(-8000); });
  const base = `http://localhost:${port}`;
  async function request<T>(path: string, body?: object): Promise<T> {
    const response = await fetch(`${base}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, `${path}: ${response.status} ${response.ok ? '' : await response.text()}`);
    return response.json() as Promise<T>;
  }
  async function waitFor(predicate: (state: StateSnapshot) => boolean, label: string): Promise<StateSnapshot> {
    const deadline = Date.now() + 35_000;
    let last: StateSnapshot | undefined;
    while (Date.now() < deadline) {
      try { last = await request<StateSnapshot>('/api/state'); } catch { if (host.exitCode !== null) throw new Error(log); }
      if (last && predicate(last)) return last;
      await delay(200);
    }
    throw new Error(`${label}: ${JSON.stringify(last?.rehearsal)}\n${log}`);
  }
  try {
    const empty = await waitFor(() => true, 'host boot');
    assert.equal(empty.nodes.length, 0);
    assert.equal(empty.mission.launched, false);
    assert.ok(empty.flights.flights.length > 0);
    assert.equal(empty.rehearsal?.recording, true);
    const refused = await fetch(`${base}/api/rehearsal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'hub-outage' }) });
    assert.equal(refused.status, 409);
    await request('/api/launch', {});
    const growing = await waitFor(s => s.nodes.length > 0 && s.nodes.length < 8, 'progressive discovery');
    assert.ok(growing.events?.some(e => e.type === 'probe'));
    const ready = await waitFor(s => s.rehearsal?.ready === true, 'baseline readiness');
    assert.equal(ready.nodes.length, ready.rehearsal?.expectedSystems);
    assert.equal(ready.edges.length, ready.rehearsal?.expectedLinks);
    assert.ok(ready.agents.some(a => a.role === 'runner' && a.state === 'working'));
    for (const scenario of ready.rehearsal!.scenarios) {
      const run = await request<RehearsalRun>('/api/rehearsal', { scenario: scenario.id });
      const done = await waitFor(s => s.rehearsal!.runs.some(r => r.id === run.id && r.outcome !== 'running'), scenario.id);
      const result = done.rehearsal!.runs.find(r => r.id === run.id)!;
      assert.equal(result.outcome, 'verified', `${scenario.id}: ${result.detail}`);
      assert.ok(result.violationIds.length > 0);
      assert.ok(result.actionIds.length > 0);
      const exported = await request<RehearsalRun & { evidence: StateSnapshot }>(`/api/rehearsal/${run.id}/evidence`);
      assert.equal(exported.evidence.invariants.every(i => i.lastResult === 'pass' && i.lastRun! >= run.startedAt), true);
      assert.ok(exported.evidence.events?.some(e => e.type === 'triage' && e.ts >= run.startedAt));
      assert.ok(exported.evidence.tasks.some(t => t.kind === 'remediate' && t.status === 'done'));
      console.log(`${scenario.id}: ${result.violationIds.length} detected violations, ${result.actionIds.length} response actions, ${exported.evidence.invariants.length} re-verified checks`);
    }
  } finally {
    if (host.exitCode === null) { host.kill(); await once(host, 'exit'); }
  }
});
