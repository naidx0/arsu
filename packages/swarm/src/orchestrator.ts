// Orchestrator — mission lifecycle + violation triage (SPEC §3).
// Boot: seeds recon work on LAUNCH. Steady state: turns new nodes into
// verify tasks and open violations into remediate tasks carrying the
// right skill. Escalates after repeated remediation failure.

import {
  AgentDoc,
  EdgeDoc,
  InvariantDoc,
  NodeDoc,
  TaskDoc,
  ViolationDoc,
} from '@arsu/core';
import { SwarmCtx } from './roles.js';

const AGENT_ID = 'orchestrator-1';
const MAX_REMEDIATION_ATTEMPTS = 2;

export class Orchestrator {
  private unwatchers: (() => void)[] = [];
  private triageTimer: ReturnType<typeof setTimeout> | null = null;
  private verifyQueue = new Set<string>();
  private sawViolations = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  launched = false;

  constructor(private ctx: SwarmCtx) {}

  async launch(): Promise<void> {
    if (this.launched) return;
    this.launched = true;

    await this.ctx.board.put('agents', AGENT_ID, {
      id: AGENT_ID,
      role: 'orchestrator',
      state: 'working',
      lastBeat: Date.now(),
      decisions: 0,
    } satisfies AgentDoc);
    this.heartbeat = setInterval(() => {
      void (async () => {
        const cur = await this.ctx.board.get<AgentDoc>('agents', AGENT_ID);
        if (!cur) {
          await this.ctx.board.put('agents', AGENT_ID, {
            id: AGENT_ID,
            role: 'orchestrator',
            state: 'working',
            lastBeat: Date.now(),
            decisions: 0,
          });
        } else {
          await this.ctx.board.patch<AgentDoc>('agents', AGENT_ID, {
            lastBeat: Date.now(),
          });
        }
      })();
    }, 1000);

    await this.ctx.board.emit('mission', {
      actor: 'system',
      msg: `mission launched — provider ${this.ctx.provider.name.toUpperCase()}`,
      data: { provider: this.ctx.provider.name },
    });

    // recon seed — only if no recon task is already on the board
    const reconTasks = await this.ctx.board.query<TaskDoc>('tasks', {
      kind: 'recon',
    } as Partial<TaskDoc>);
    if (reconTasks.length === 0) {
      await this.ctx.board.add<TaskDoc>('tasks', {
        id: '',
        kind: 'recon',
        target: 'registry',
        priority: 5,
        status: 'pending',
        attempts: 0,
        createdBy: AGENT_ID,
      });
    }

    // new nodes → verify tasks (once each)
    this.unwatchers.push(
      this.ctx.board.watch<NodeDoc>('nodes', (docs) => {
        for (const d of docs) void this.ensureVerify(d.data.id);
      }),
    );

    // open violations → triage (debounced so cascades group)
    this.unwatchers.push(
      this.ctx.board.watch<ViolationDoc>('violations', (docs) => {
        if (docs.some((d) => d.data.status === 'open')) {
          this.sawViolations = true;
          this.scheduleTriage();
        } else if (this.sawViolations) {
          this.sawViolations = false;
          void this.ctx.board.emit('mission', {
            actor: AGENT_ID,
            msg: 'mission: resolved — board is green',
          });
        }
      }),
    );
  }

  private async ensureVerify(nodeId: string): Promise<void> {
    if (this.verifyQueue.has(nodeId)) return;
    this.verifyQueue.add(nodeId);
    try {
      const invs = await this.ctx.board.query<InvariantDoc>('invariants', {
        node: nodeId,
      } as Partial<InvariantDoc>);
      if (invs.length > 0) return;
      const tasks = await this.ctx.board.query<TaskDoc>('tasks', {
        kind: 'verify',
        target: nodeId,
      } as Partial<TaskDoc>);
      if (tasks.some((t) => t.data.status !== 'failed')) return;
      await this.ctx.board.add<TaskDoc>('tasks', {
        id: '',
        kind: 'verify',
        target: nodeId,
        priority: 3,
        status: 'pending',
        attempts: 0,
        createdBy: AGENT_ID,
      });
    } finally {
      this.verifyQueue.delete(nodeId);
    }
  }

  private scheduleTriage(): void {
    if (this.triageTimer) return; // sticky — the runner's violation writes must not starve it
    this.triageTimer = setTimeout(() => {
      this.triageTimer = null;
      void this.triage();
    }, 800);
  }

  /** A violated node whose required dep is effectively down/degraded is
   *  collateral of a deeper failure — remediation belongs to the root. */
  private async isCollateral(nodeId: string): Promise<boolean> {
    const deps = await this.ctx.board.query<EdgeDoc>('edges', {
      from: nodeId,
    } as Partial<EdgeDoc>);
    for (const e of deps) {
      if (!e.data.required) continue;
      try {
        const res = await fetch(
          `${this.ctx.simBase}/sim/health/${e.data.to}`,
        );
        const body = (await res.json()) as { effective?: string };
        if (body.effective !== 'up') return true;
      } catch {
        return true; // dep unreachable counts as an explanation
      }
    }
    return false;
  }

  private async triage(): Promise<void> {
    const open = (
      await this.ctx.board.query<ViolationDoc>('violations')
    ).filter((v) => v.data.status === 'open');
    if (open.length === 0) return;

    // group by node
    const byNode = new Map<string, typeof open>();
    for (const v of open) {
      const list = byNode.get(v.data.node) ?? [];
      list.push(v);
      byNode.set(v.data.node, list);
    }

    // rank: most open violations, tiebreak fan-in on the node
    const edges = await this.ctx.board.query<EdgeDoc>('edges');
    const inDegree = (nodeId: string) =>
      edges.filter((e) => e.data.to === nodeId).length;
    const ranked = [...byNode.entries()].sort(
      (a, b) =>
        b[1].length - a[1].length || inDegree(b[0]) - inDegree(a[0]),
    );

    for (const [nodeId, violations] of ranked) {
      // dedupe — a remediate task already in flight for this node?
      const existing = await this.ctx.board.query<TaskDoc>('tasks', {
        kind: 'remediate',
        target: nodeId,
      } as Partial<TaskDoc>);
      const inFlight = existing.some(
        (t) => t.data.status === 'pending' || t.data.status === 'claimed',
      );
      const failed = existing.filter((t) => t.data.status === 'failed');
      if (inFlight) continue;

      // collateral of a deeper failure — its proofs re-green when the
      // root is remediated, so no task is minted for it
      if (await this.isCollateral(nodeId)) continue;

      const nodeDoc = await this.ctx.board.get<NodeDoc>('nodes', nodeId);
      const node = nodeDoc?.data ?? {
        id: nodeId,
        kind: 'worker' as const,
        health: 'down' as const,
        name: nodeId,
      };

      if (failed.length >= MAX_REMEDIATION_ATTEMPTS) {
        for (const v of violations) {
          await this.ctx.board.patch<ViolationDoc>('violations', v.id, {
            status: 'escalated',
          });
        }
        await this.ctx.board.emit('escalate', {
          actor: AGENT_ID,
          node: nodeId,
          severity: 'crit',
          msg: `${nodeId}: ${failed.length} failed remediations — escalating to human`,
        });
        continue;
      }

      // gather the failure signature for the planner
      const invIds = violations.map((v) => v.data.invariant);
      const invs = (
        await Promise.all(
          invIds.map((id) =>
            this.ctx.board.get<InvariantDoc>('invariants', id),
          ),
        )
      )
        .filter((d) => d !== null)
        .map((d) => d!.data);
      const kinds = invs.map((i) => i.kind);

      // a dep_health proof failing while the dep is up = severed edge
      let depHealthy = true;
      for (const i of invs) {
        if (i.kind !== 'dep_health' || !i.params.dep) continue;
        try {
          const res = await fetch(
            `${this.ctx.simBase}/sim/health/${i.params.dep}`,
          );
          const body = (await res.json()) as { effective?: string };
          if (body.effective !== 'up') depHealthy = false;
        } catch {
          depHealthy = false;
        }
      }

      const plan = await this.ctx.provider.planJSON<{
        rootCause?: string;
        skill?: string;
        priority?: number;
        rationale?: string;
      }>(
        `Triage: pick the remediation skill + priority for this violation cluster.`,
        'triage',
        {
          node: { id: node.id, kind: node.kind, health: node.health },
          violationCount: violations.length,
          inDegree: inDegree(nodeId),
          invariantKinds: kinds,
          depHealthy,
        },
      );

      const skill = plan.skill ?? 'degraded-restore';
      const priority = plan.priority ?? 3;
      await this.ctx.board.add<TaskDoc>('tasks', {
        id: '',
        kind: 'remediate',
        target: nodeId,
        skill,
        priority,
        status: 'pending',
        attempts: 0,
        createdBy: AGENT_ID,
      });
      for (const v of violations) {
        await this.ctx.board.patch<ViolationDoc>('violations', v.id, {
          status: 'triaged',
        });
      }
      await this.ctx.board.emit('triage', {
        actor: AGENT_ID,
        node: nodeId,
        severity: 'warn',
        msg: `triage ${nodeId} → ${skill} (p${priority}, in-degree ${inDegree(nodeId)}): ${plan.rationale ?? ''}`,
        data: { skill, priority, violations: violations.map((v) => v.id) },
      });
      await this.bumpDecisions();
    }
  }

  private async bumpDecisions(): Promise<void> {
    const a = await this.ctx.board.get<AgentDoc>('agents', AGENT_ID);
    if (a) {
      await this.ctx.board.patch<AgentDoc>('agents', AGENT_ID, {
        decisions: a.data.decisions + 1,
      });
    }
  }

  stop(): void {
    for (const u of this.unwatchers) u();
    this.unwatchers = [];
    if (this.triageTimer) clearTimeout(this.triageTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.launched = false;
  }
}
