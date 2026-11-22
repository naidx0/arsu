// AgentRuntime — spawn/heartbeat/task-claim loop (SPEC §3).
// Claimable roles poll `tasks` for pending work matching their kind and
// claim by lease; the runner and orchestrator are spawned, not claimable.

import { AgentDoc, AgentRole, TaskDoc } from '@arsu/core';
import {
  doRecon,
  doRemediate,
  doVerify,
  ProofRunner,
  SwarmCtx,
} from './roles.js';

const CLAIM_KIND: Partial<Record<AgentRole, TaskDoc['kind']>> = {
  recon: 'recon',
  verify: 'verify',
  response: 'remediate',
};

const LEASE_MS = 30_000;

export class AgentRuntime {
  private seq = 0;
  private busy = new Set<string>();
  private handles: ReturnType<typeof setInterval>[] = [];
  private runners: ProofRunner[] = [];

  constructor(private ctx: SwarmCtx) {}

  async spawn(role: AgentRole, id?: string): Promise<string> {
    const agentId = id ?? `${role}-${++this.seq}`;
    const doc: AgentDoc = {
      id: agentId,
      role,
      state: 'idle',
      lastBeat: Date.now(),
      decisions: 0,
    };
    await this.ctx.board.put('agents', agentId, doc);
    await this.ctx.board.emit('agent', {
      actor: agentId,
      msg: `${agentId} online (${role})`,
    });

    this.handles.push(
      setInterval(() => {
        void (async () => {
          const cur = await this.ctx.board.get<AgentDoc>('agents', agentId);
          if (!cur) {
            await this.ctx.board.put('agents', agentId, {
              ...doc,
              lastBeat: Date.now(),
            });
          } else {
            await this.ctx.board.patch<AgentDoc>('agents', agentId, {
              lastBeat: Date.now(),
            });
          }
        })();
      }, 1000),
    );

    if (role === 'runner') {
      const r = new ProofRunner(this.ctx);
      r.start();
      this.runners.push(r);
    } else if (CLAIM_KIND[role]) {
      this.handles.push(
        setInterval(() => void this.tryClaim(agentId, role), 500),
      );
    }
    return agentId;
  }

  private async tryClaim(agentId: string, role: AgentRole): Promise<void> {
    if (this.busy.has(agentId)) return;
    const kind = CLAIM_KIND[role];
    if (!kind) return;

    const pending = await this.ctx.board.query<TaskDoc>('tasks', {
      status: 'pending',
    } as Partial<TaskDoc>);
    const mine = pending
      .filter((t) => t.data.kind === kind)
      .sort(
        (a, b) =>
          b.data.priority - a.data.priority || a.id.localeCompare(b.id),
      );
    const task = mine[0];
    if (!task) return;

    // CAS claim — write, then read back to confirm we hold it
    await this.ctx.board.patch<TaskDoc>('tasks', task.id, {
      status: 'claimed',
      claimedBy: agentId,
      leaseUntil: Date.now() + LEASE_MS,
      attempts: task.data.attempts + 1,
    });
    const held = await this.ctx.board.get<TaskDoc>('tasks', task.id);
    if (held?.data.claimedBy !== agentId) return;

    this.busy.add(agentId);
    await this.ctx.board.patch<AgentDoc>('agents', agentId, {
      state: 'working',
      task: task.id,
    });
    try {
      const handler =
        role === 'recon' ? doRecon : role === 'verify' ? doVerify : doRemediate;
      const result = await handler(this.ctx, agentId, task.data);
      await this.ctx.board.patch<TaskDoc>('tasks', task.id, {
        status: 'done',
        result,
      });
    } catch (e) {
      const attempts = task.data.attempts + 1;
      await this.ctx.board.patch<TaskDoc>(
        'tasks',
        task.id,
        attempts >= 2
          ? { status: 'failed', result: String(e) }
          : {
              status: 'pending',
              attempts,
              claimedBy: undefined,
              leaseUntil: undefined,
            },
      );
      await this.ctx.board.emit('task', {
        actor: agentId,
        node: task.data.target === 'registry' ? undefined : task.data.target,
        severity: 'warn',
        msg: `task ${task.id} ${attempts >= 2 ? 'failed' : 'retry'}: ${String(e)}`,
      });
    } finally {
      await this.ctx.board.patch<AgentDoc>('agents', agentId, {
        state: 'idle',
        task: undefined,
      });
      this.busy.delete(agentId);
    }
  }

  stopAll(): void {
    for (const h of this.handles) clearInterval(h);
    this.handles = [];
    for (const r of this.runners) r.stop();
    this.runners = [];
  }
}
