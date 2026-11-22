import { randomUUID } from 'node:crypto';
import type { Blackboard, ChaosRequest, EventDoc, RehearsalRun, RehearsalState, ServiceInfo, StateSnapshot } from '@arsu/core';

export const scenarios: RehearsalState['scenarios'] = [
  { id: 'hub-outage', title: 'Lose the flight-information hub', fault: { type: 'kill', target: 'unimatic' } },
  { id: 'slow-loadsheet', title: 'Slow weight & balance calculations', fault: { type: 'degrade', target: 'weight-balance' } },
  { id: 'notam-link', title: 'Disconnect dispatch from NOTAMs', fault: { type: 'cut_dep', target: 'dispatch', dep: 'notam' } },
  { id: 'corrupt-manifest', title: 'Corrupt the passenger feed', fault: { type: 'corrupt', target: 'pax-connect' } },
];

export function readiness(state: StateSnapshot, services: ServiceInfo[], after = 0): string[] {
  const blockers: string[] = [];
  if (!state.mission.launched) blockers.push('Launch discovery');
  for (const service of services) {
    const node = state.nodes.find(n => n.id === service.id);
    if (!node) { blockers.push(`${service.id}: not discovered`); continue; }
    if (node.health !== 'up') blockers.push(`${service.id}: not healthy`);
    const checks = state.invariants.filter(i => i.node === service.id);
    if (!checks.some(i => i.kind === 'http_status')) blockers.push(`${service.id}: missing availability contract`);
    if (!state.specs.some(s => s.node === service.id && s.invariants.length > 0 && s.invariants.every(id => checks.some(i => i.id === id)))) blockers.push(`${service.id}: missing linked spec`);
    for (const dep of service.deps) {
      if (!state.edges.some(e => e.from === service.id && e.to === dep && e.required)) blockers.push(`${service.id}: missing edge to ${dep}`);
      if (!checks.some(i => i.kind === 'dep_health' && i.params.dep === dep)) blockers.push(`${service.id}: missing dependency contract for ${dep}`);
    }
  }
  if (!state.invariants.length || state.invariants.some(i => i.lastResult !== 'pass' || !i.lastRun || i.lastRun <= after || Date.now() - i.lastRun > Math.max(15_000, i.intervalMs * 3))) blockers.push('All checks must have fresh passing results');
  if (state.violations.some(v => v.status !== 'resolved')) blockers.push('There are unresolved violations');
  if (state.tasks.some(t => t.status === 'claimed' || t.status === 'pending' || t.status === 'failed')) blockers.push('There is unfinished or failed agent work');
  if (state.flights.groundStop || state.flights.staleFeed) blockers.push('Flight operations have not recovered');
  return blockers;
}

type StoredRun = RehearsalRun & { baseline?: Omit<StateSnapshot, 'rehearsal'>; evidence?: Omit<StateSnapshot, 'rehearsal'> };
export class RehearsalController {
  private starting = false;
  private advancing = false;
  constructor(private board: Blackboard, private services: ServiceInfo[], private recording: boolean, private inject: (fault: ChaosRequest) => void, private scenarioList = scenarios) {}

  async status(state: StateSnapshot): Promise<RehearsalState> {
    const runs = (await this.board.query<StoredRun>('rehearsals')).map(({ data: { baseline: _baseline, evidence: _evidence, ...run } }) => run).sort((a, b) => b.startedAt - a.startedAt);
    const blockers = readiness(state, this.services);
    if (this.starting || runs.some(r => r.outcome === 'running')) blockers.push('A stress test is already running');
    return { recording: this.recording, expectedSystems: this.services.length, expectedLinks: this.services.reduce((n, s) => n + s.deps.length, 0), ready: blockers.length === 0, blockers, scenarios: this.scenarioList, runs };
  }

  async start(scenarioId: string, state: StateSnapshot): Promise<RehearsalRun> {
    if (this.starting) throw new Error('A stress test is already starting');
    this.starting = true;
    try {
      const scenario = this.scenarioList.find(s => s.id === scenarioId);
      if (!scenario) throw new Error('Unknown stress scenario');
      const runs = await this.board.query<StoredRun>('rehearsals');
      if (runs.some(r => r.data.outcome === 'running')) throw new Error('A stress test is already running');
      const blockers = readiness(state, this.services);
      if (blockers.length) throw new Error(blockers.join('; '));
      const run: RehearsalRun = { id: randomUUID(), scenario: scenario.id, startedAt: Date.now(), outcome: 'running', detail: 'Fault injected; waiting for executable checks to detect it.', violationIds: [], actionIds: [] };
      const { rehearsal: _rehearsal, ...baseline } = state;
      const frozenBaseline = structuredClone(baseline);
      this.inject(scenario.fault);
      await this.board.put('rehearsals', run.id, { ...run, baseline: frozenBaseline });
      await this.board.emit('chaos', { actor: 'operator', node: scenario.fault.target, severity: 'crit', msg: `Stress test: ${scenario.title}`, data: { run: run.id, ...scenario.fault } });
      return run;
    } finally { this.starting = false; }
  }

  async advance(state: StateSnapshot): Promise<void> {
    if (this.advancing) return;
    this.advancing = true;
    try {
      for (const { data: run } of await this.board.query<StoredRun>('rehearsals')) {
        if (run.outcome !== 'running') continue;
        const violations = state.violations.filter(v => v.firstSeen >= run.startedAt);
        const events = (state.events ?? []).filter(e => e.ts >= run.startedAt);
        const actions = events.filter(e => e.type === 'action' && e.severity === 'info');
        const lastAction = Math.max(0, ...actions.map(e => e.ts));
        const failed = violations.some(v => v.status === 'escalated') || events.some(e => e.type === 'escalate') || Date.now() - run.startedAt > 180_000;
        const verified = !failed && violations.length > 0 && actions.length > 0 && readiness(state, this.services, lastAction).length === 0;
        const next: StoredRun = { ...run, violationIds: violations.map(v => v.id), actionIds: actions.map(e => e.id), outcome: failed ? 'failed' : verified ? 'verified' : 'running', detail: failed ? 'Escalated or timed out; recovery was not verified.' : verified ? 'Fault detected, response executed, and every covered check passed after the response.' : actions.length ? 'Response executed; waiting for fresh estate-wide verification.' : violations.length ? 'Failure detected; orchestrator and response units are working.' : 'Waiting for executable checks to detect the injected fault.' };
        if (next.outcome !== 'running') {
          next.finishedAt = Date.now();
          const { rehearsal: _rehearsal, ...evidence } = state;
          next.evidence = structuredClone(evidence);
          next.evidence.events = (await this.board.query<EventDoc>('events')).map(d => d.data).filter(e => e.ts >= run.startedAt && e.ts <= next.finishedAt!).sort((a, b) => a.ts - b.ts);
          await this.board.emit('rehearsal', { actor: 'system', severity: failed ? 'crit' : 'info', msg: next.detail, data: { run: run.id, outcome: next.outcome } });
        }
        if (JSON.stringify(next) !== JSON.stringify(run)) await this.board.put('rehearsals', run.id, next);
      }
    } finally { this.advancing = false; }
  }

  async evidence(id: string): Promise<StoredRun | null> {
    return (await this.board.get<StoredRun>('rehearsals', id))?.data ?? null;
  }
}
