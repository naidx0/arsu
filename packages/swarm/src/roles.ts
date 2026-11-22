// SPEC §3 — agent role handlers. Everything an agent learns lands on the
// board; the board is the only channel between agents.

import {
  Blackboard,
  EdgeDoc,
  EventDoc,
  InvariantDoc,
  NodeDoc,
  ServiceInfo,
  SpecDoc,
  Step,
  TaskDoc,
  ViolationDoc,
} from '@arsu/core';
import { ModelProvider } from './provider.js';

export interface SwarmCtx {
  board: Blackboard;
  provider: ModelProvider;
  simBase: string;
}

async function j<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ---------- recon ----------

export async function doRecon(
  ctx: SwarmCtx,
  agentId: string,
  task: TaskDoc,
): Promise<string> {
  const { services } = await j<{ services: ServiceInfo[] }>(
    await fetch(`${ctx.simBase}/sim/registry`),
  );
  let nodes = 0;
  let edges = 0;
  for (const svc of services) {
    const evidence: string[] = [`GET /sim/registry → listed`];
    let health: NodeDoc['health'] = 'down';
    let opSnippet = '';
    try {
      const h = await j<{ state: string; effective: NodeDoc['health'] }>(
        await fetch(`${ctx.simBase}/sim/health/${svc.id}`),
      );
      health = h.effective;
      evidence.push(`GET /sim/health/${svc.id} → ${h.state}/${h.effective}`);
    } catch (e) {
      evidence.push(`GET /sim/health/${svc.id} → ${String(e)}`);
    }
    try {
      const res = await fetch(`${ctx.simBase}/sim/op/${svc.id}`);
      opSnippet = `op ${res.status}`;
      evidence.push(`GET /sim/op/${svc.id} → ${res.status}`);
    } catch {
      evidence.push(`GET /sim/op/${svc.id} → unreachable`);
    }

    const plan = await ctx.provider.planJSON<{
      description?: string;
      kind?: string;
      deps?: string[];
    }>(
      `Describe this discovered component for the estate ontology.`,
      'node',
      { service: svc, health },
    );

    const existing = await ctx.board.get<NodeDoc>('nodes', svc.id);
    const node: NodeDoc = {
      id: svc.id,
      name: svc.name,
      kind: svc.kind,
      health,
      discoveredBy: agentId,
      firstSeen: existing?.data.firstSeen ?? Date.now(),
      lastProbe: Date.now(),
      evidence,
      description:
        plan.description ??
        `${svc.name} (${svc.kind}) — ${opSnippet || 'probed'}`,
    };
    await ctx.board.put('nodes', svc.id, node);
    nodes++;

    const deps = plan.deps?.length ? plan.deps : svc.deps;
    for (const dep of deps) {
      const edgeId = `${svc.id}->${dep}`;
      const edge: EdgeDoc = {
        id: edgeId,
        from: svc.id,
        to: dep,
        required: true,
        discoveredBy: agentId,
        evidence: [`registry deps: ${svc.id} → ${dep}`],
      };
      await ctx.board.put('edges', edgeId, edge);
      edges++;
    }
    await ctx.board.emit('probe', {
      actor: agentId,
      node: svc.id,
      msg: `probed ${svc.id}: ${health}`,
      data: { task: task.id },
    });
  }
  await ctx.board.emit('recon', {
    actor: agentId,
    severity: 'info',
    msg: `recon complete: ${nodes} nodes, ${edges} edges`,
  });
  return `${nodes} nodes, ${edges} edges`;
}

// ---------- verify ----------

export async function doVerify(
  ctx: SwarmCtx,
  agentId: string,
  task: TaskDoc,
): Promise<string> {
  const nodeDoc = await ctx.board.get<NodeDoc>('nodes', task.target);
  if (!nodeDoc) return `node ${task.target} not found — skipped`;
  const node = nodeDoc.data;

  const depEdges = await ctx.board.query<EdgeDoc>('edges', {
    from: node.id,
  } as Partial<EdgeDoc>);
  const service: ServiceInfo = {
    id: node.id,
    name: node.name,
    kind: node.kind,
    deps: depEdges.map((e) => e.data.to),
    description: node.description,
  };

  const plan = await ctx.provider.planJSON<{
    invariants?: {
      kind: InvariantDoc['kind'];
      params: InvariantDoc['params'];
      intervalMs?: number;
    }[];
  }>(
    `Author an executable invariant set for component '${node.id}'. ` +
      `Kinds: http_status{url} · latency_lt{url,ms} · dep_health{dep} · ` +
      `data_field{url,field,equals} · consistency{url,field,via,viaField}.`,
    'invariants',
    { service, simBase: ctx.simBase, health: node.health },
  );

  const ids: string[] = [];
  const drafts = plan.invariants ?? [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const id = `inv-${node.id}-${d.kind}-${i}`;
    const inv: InvariantDoc = {
      id,
      node: node.id,
      kind: d.kind,
      params: d.params,
      intervalMs: d.intervalMs ?? 2000,
      authoredBy: agentId,
      runs: 0,
    };
    await ctx.board.put('invariants', id, inv);
    ids.push(id);
  }

  const specPlan = await ctx.provider.planJSON<{
    title?: string;
    body?: string;
  }>(
    `Write the human-readable behavioral spec for '${node.id}' covering ` +
      `these invariants.`,
    'spec',
    { service, invariants: drafts },
  );

  const existing = await ctx.board.get<SpecDoc>('specs', `spec-${node.id}`);
  const spec: SpecDoc = {
    id: `spec-${node.id}`,
    node: node.id,
    title: specPlan.title ?? `Spec — ${node.name}`,
    body: specPlan.body ?? node.description,
    invariants: ids,
    authoredBy: agentId,
    version: (existing?.data.version ?? 0) + 1,
  };
  await ctx.board.put('specs', spec.id, spec);

  await ctx.board.emit('verify', {
    actor: agentId,
    node: node.id,
    msg: `authored ${ids.length} invariants + spec for ${node.id}`,
    data: { invariants: ids },
  });
  return `${ids.length} invariants, spec v${spec.version}`;
}

// ---------- proof runner ----------

interface EvalResult {
  pass: boolean;
  detail: string;
}

export async function evaluateInvariant(
  ctx: SwarmCtx,
  inv: InvariantDoc,
): Promise<EvalResult> {
  const p = inv.params;
  try {
    switch (inv.kind) {
      case 'http_status': {
        const res = await fetch(p.url!);
        return {
          pass: res.status === 200,
          detail: `GET ${p.url} → ${res.status}`,
        };
      }
      case 'latency_lt': {
        const t0 = Date.now();
        const res = await fetch(p.url!);
        const dt = Date.now() - t0;
        return {
          pass: res.ok && dt < (p.ms ?? 800),
          detail: `${dt}ms (budget ${p.ms}ms)`,
        };
      }
      case 'dep_health': {
        // edge integrity from the dependent's side: the dep must be in
        // the node's active deps AND effectively up — catches both dead
        // deps and severed edges (cut_dep)
        const res = await fetch(`${ctx.simBase}/sim/health/${inv.node}`);
        const body = await j<{ deps?: Record<string, string> }>(res);
        const dh = body.deps?.[p.dep!];
        return {
          pass: dh === 'up',
          detail:
            dh === undefined
              ? `edge ${inv.node}→${p.dep} severed`
              : `${p.dep} effective=${dh}`,
        };
      }
      case 'data_field': {
        const res = await fetch(p.url!);
        if (!res.ok) {
          return { pass: false, detail: `GET ${p.url} → ${res.status}` };
        }
        const body = await j<Record<string, unknown>>(res);
        const has = body[p.field!] !== undefined;
        const eq = p.equals === undefined || body[p.field!] === p.equals;
        return {
          pass: has && eq,
          detail: has
            ? `${p.field}=${JSON.stringify(body[p.field!])}`
            : `missing field ${p.field}`,
        };
      }
      case 'consistency': {
        const [rA, rB] = await Promise.all([
          fetch(p.url!),
          fetch(p.via!),
        ]);
        if (!rA.ok || !rB.ok) {
          return {
            pass: false,
            detail: `endpoints ${rA.status}/${rB.status}`,
          };
        }
        const [a, b] = await Promise.all([
          j<Record<string, unknown>>(rA),
          j<Record<string, unknown>>(rB),
        ]);
        const va = a[p.field!];
        const vb = b[p.viaField ?? p.field!];
        return {
          pass: va === vb,
          detail: `${p.field}: ${JSON.stringify(va)} vs ${JSON.stringify(vb)}`,
        };
      }
      default:
        return { pass: false, detail: `unknown kind ${inv.kind}` };
    }
  } catch (e) {
    return { pass: false, detail: String(e) };
  }
}

const OPEN_STATUSES = ['open', 'triaged', 'remediating'];

/** Run one invariant, update its doc, mint/close violations. */
export async function runInvariantOnce(
  ctx: SwarmCtx,
  inv: InvariantDoc,
): Promise<EvalResult> {
  const res = await evaluateInvariant(ctx, inv);
  await ctx.board.patch<InvariantDoc>('invariants', inv.id, {
    runs: inv.runs + 1,
    lastRun: Date.now(),
    lastResult: res.pass ? 'pass' : 'fail',
    lastDetail: res.detail,
  });

  const open = await ctx.board.query<ViolationDoc>('violations', {
    invariant: inv.id,
  } as Partial<ViolationDoc>);
  const active = open.filter((v) => OPEN_STATUSES.includes(v.data.status));

  if (!res.pass) {
    if (active.length > 0) {
      const v = active[0];
      await ctx.board.patch<ViolationDoc>('violations', v.id, {
        lastSeen: Date.now(),
        count: v.data.count + 1,
        detail: res.detail,
      });
    } else {
      await ctx.board.add<ViolationDoc>('violations', {
        id: '',
        invariant: inv.id,
        node: inv.node,
        detail: res.detail,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        count: 1,
        status: 'open',
      });
      await ctx.board.emit('violation', {
        actor: 'runner',
        node: inv.node,
        severity: 'crit',
        msg: `proof broken: ${inv.id} — ${res.detail}`,
        data: { invariant: inv.id },
      });
    }
  } else {
    for (const v of active) {
      await ctx.board.patch<ViolationDoc>('violations', v.id, {
        status: 'resolved',
        resolvedBy: 'runner',
        resolution: `check green: ${res.detail}`,
        lastSeen: Date.now(),
      });
      await ctx.board.emit('resolved', {
        actor: 'runner',
        node: inv.node,
        severity: 'info',
        msg: `proof restored: ${inv.id}`,
      });
    }
  }
  return res;
}

/** The runner role — interval executor, spawned once at launch. */
export class ProofRunner {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private busy = new Set<string>();
  private unwatch: (() => void) | null = null;

  constructor(private ctx: SwarmCtx) {}

  start(): void {
    this.unwatch = this.ctx.board.watch<InvariantDoc>(
      'invariants',
      (docs) => this.reconcile(docs.map((d) => d.data)),
    );
  }

  stop(): void {
    this.unwatch?.();
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }

  private reconcile(invs: InvariantDoc[]): void {
    const live = new Set(invs.map((i) => i.id));
    for (const [id, t] of this.timers) {
      if (!live.has(id)) {
        clearInterval(t);
        this.timers.delete(id);
      }
    }
    for (const inv of invs) {
      if (this.timers.has(inv.id)) continue;
      const t = setInterval(() => void this.tick(inv.id), inv.intervalMs);
      this.timers.set(inv.id, t);
    }
  }

  private async tick(id: string): Promise<void> {
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      const doc = await this.ctx.board.get<InvariantDoc>('invariants', id);
      if (doc) await runInvariantOnce(this.ctx, doc.data);
    } finally {
      this.busy.delete(id);
    }
  }
}

// ---------- response ----------

const ACTION_STEPS = new Set(['restart', 'failover', 'reroute', 'repair']);

export async function doRemediate(
  ctx: SwarmCtx,
  agentId: string,
  task: TaskDoc,
): Promise<string> {
  const nodeId = task.target;
  const nodeDoc = await ctx.board.get<NodeDoc>('nodes', nodeId);

  // mark linked violations as actively remediated
  const violations = (
    await ctx.board.query<ViolationDoc>('violations', { node: nodeId } as Partial<ViolationDoc>)
  ).filter((v) => v.data.status === 'triaged' || v.data.status === 'open');
  for (const v of violations) {
    await ctx.board.patch<ViolationDoc>('violations', v.id, {
      status: 'remediating',
    });
  }

  const skillDoc = task.skill
    ? await ctx.board.get<{ steps: Step[]; title: string }>('skills', task.skill)
    : null;
  const steps = skillDoc?.data.steps ?? [];
  if (steps.length === 0) {
    await ctx.board.emit('escalate', {
      actor: agentId,
      node: nodeId,
      severity: 'crit',
      msg: `no skill for ${nodeId} (${task.skill ?? 'none'}) — escalating`,
    });
    return 'no skill — escalated';
  }

  await ctx.board.emit('remediate', {
    actor: agentId,
    node: nodeId,
    severity: 'warn',
    msg: `response unit on ${nodeId} — executing skill ${task.skill}`,
    data: { skill: task.skill, steps: steps.length },
  });

  let escalated = false;
  for (const step of steps) {
    const target = step.target === '.' ? nodeId : step.target;
    if (ACTION_STEPS.has(step.action)) {
      try {
        const res = await fetch(`${ctx.simBase}/sim/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            type: step.action,
            target,
            params: step.params,
          }),
        });
        const body = await j<Record<string, unknown>>(res);
        await ctx.board.emit('action', {
          actor: agentId,
          node: nodeId,
          severity: res.ok ? 'info' : 'warn',
          msg: `${step.action} ${target} → ${res.ok ? 'ok' : `failed (${res.status})`}`,
          data: body,
        });
      } catch (e) {
        await ctx.board.emit('action', {
          actor: agentId,
          node: nodeId,
          severity: 'warn',
          msg: `${step.action} ${target} → ${String(e)}`,
        });
      }
    } else if (step.action === 'verify_only') {
      const invs = await ctx.board.query<InvariantDoc>('invariants', {
        node: nodeId,
      } as Partial<InvariantDoc>);
      let passing = 0;
      for (const d of invs) {
        const r = await runInvariantOnce(ctx, d.data);
        if (r.pass) passing++;
      }
      await ctx.board.emit('verify', {
        actor: agentId,
        node: nodeId,
        msg: `re-verified ${nodeId}: ${passing}/${invs.length} invariants pass`,
      });
    } else if (step.action === 'escalate') {
      // only escalate if the block is still red — check before burning it
      const remaining = await openViolations(ctx, nodeId);
      const stillRed = remaining.length > 0;
      if (stillRed && !escalated) {
        escalated = true;
        for (const v of remaining) {
          await ctx.board.patch<ViolationDoc>('violations', v.id, {
            status: 'escalated',
          });
        }
        await ctx.board.emit('escalate', {
          actor: agentId,
          node: nodeId,
          severity: 'crit',
          msg: `${nodeId} still red after skill ${task.skill} — PAGING HUMAN`,
        });
      }
    }
    await bumpDecisions(ctx, agentId);
  }

  const open = await openViolations(ctx, nodeId);
  if (open.length === 0) {
    await ctx.board.emit('remediate', {
      actor: agentId,
      node: nodeId,
      msg: `${nodeId} remediated — all proofs green`,
    });
    return `remediated via ${task.skill}`;
  }
  return escalated
    ? `escalated (${open.length} still red)`
    : `${open.length} violation(s) remain`;
}

async function openViolations(
  ctx: SwarmCtx,
  nodeId: string,
): Promise<{ id: string; data: ViolationDoc }[]> {
  const all = await ctx.board.query<ViolationDoc>('violations', {
    node: nodeId,
  } as Partial<ViolationDoc>);
  return all.filter((v) =>
    ['open', 'triaged', 'remediating'].includes(v.data.status),
  );
}

async function bumpDecisions(ctx: SwarmCtx, agentId: string): Promise<void> {
  const a = await ctx.board.get<{ decisions: number }>('agents', agentId);
  if (a) {
    await ctx.board.patch('agents', agentId, {
      decisions: a.data.decisions + 1,
    });
  }
}

// re-exported for runtime
export type { EventDoc };
