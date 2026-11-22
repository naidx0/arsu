// SPEC §3 — ModelProvider: the single boundary for model calls.
// Every agent decision (ontology authoring, invariant generation, spec
// writing, triage planning) goes through complete()/planJSON(). All
// provider/key env reads happen in this file — nowhere else (SPEC §6).

export type PlanShape = 'node' | 'invariants' | 'triage' | 'spec' | 'summary';

export interface ModelProvider {
  name: 'gemini' | 'sim';
  complete(prompt: string): Promise<string>;
  planJSON<T>(
    prompt: string,
    shape: PlanShape,
    context?: unknown,
  ): Promise<T>;
}

// ---------- Gemini ----------

const GEMINI_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : text).trim();
}

// Structured-output contracts per PlanShape — Gemini's responseSchema keeps
// responses shaped; ResilientProvider still covers any malformed output.
const SHAPE_SCHEMAS: Record<PlanShape, object> = {
  summary: {
    type: 'object',
    required: ['provider', 'headline', 'risks', 'nextAction', 'evidence'],
    properties: {
      provider: { type: 'string', enum: ['gemini'] },
      headline: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' }, maxItems: 4 },
      nextAction: { type: 'string' },
      evidence: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    },
  },
  node: {
    type: 'object',
    required: ['kind', 'description', 'deps'],
    properties: {
      kind: { type: 'string', enum: ['feed', 'hub', 'worker', 'store'] },
      description: { type: 'string' },
      deps: { type: 'array', items: { type: 'string' } },
    },
  },
  invariants: {
    type: 'object',
    required: ['invariants'],
    properties: {
      invariants: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'params', 'intervalMs'],
          properties: {
            kind: {
              type: 'string',
              enum: ['http_status', 'latency_lt', 'data_field', 'dep_health', 'consistency'],
            },
            params: { type: 'object', properties: {
              url: { type: 'string' }, ms: { type: 'number' }, dep: { type: 'string' },
              field: { type: 'string' }, equals: { type: 'boolean' },
              via: { type: 'string' }, viaField: { type: 'string' },
            } },
            intervalMs: { type: 'integer', minimum: 500 },
          },
        },
      },
    },
  },
  spec: {
    type: 'object',
    required: ['title', 'body'],
    properties: {
      title: { type: 'string' },
      body: { type: 'string' },
    },
  },
  triage: {
    type: 'object',
    required: ['rootCause', 'skill', 'priority', 'rationale'],
    properties: {
      rootCause: { type: 'string' },
      skill: { type: 'string' },
      priority: { type: 'integer', minimum: 1, maximum: 5 },
      rationale: { type: 'string' },
    },
  },
};

export class GeminiProvider implements ModelProvider {
  name = 'gemini' as const;
  private key: string;
  private model: string;

  constructor(key = process.env.GEMINI_API_KEY ?? '', model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash') {
    if (!key) throw new Error('GeminiProvider: GEMINI_API_KEY required');
    this.key = key;
    this.model = model;
  }

  private async generate(prompt: string, schema?: object): Promise<string> {
    const res = await fetch(GEMINI_URL(this.model, this.key), {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(schema
          ? {
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: schema,
              },
            }
          : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = body.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('');
    if (!text) throw new Error('gemini: empty response');
    return text;
  }

  async complete(prompt: string): Promise<string> {
    return this.generate(prompt);
  }

  async planJSON<T>(
    prompt: string,
    shape: PlanShape,
    context?: unknown,
  ): Promise<T> {
    const full =
      `${prompt}\n\nYou are ARSU's ${shape} planner.` +
      (context !== undefined ? `\n\nCONTEXT:\n${JSON.stringify(context)}` : '');
    const text = await this.generate(full, SHAPE_SCHEMAS[shape]);
    return JSON.parse(stripFences(text)) as T;
  }
}

// ---------- Simulated (offline dev, labeled SIM everywhere) ----------

interface SimServiceCtx {
  service: {
    id: string;
    name: string;
    kind: string;
    deps: string[];
    description: string;
    standby?: string;
  };
  simBase?: string;
  health?: { state: string; effective: string };
}

export class SimulatedProvider implements ModelProvider {
  name = 'sim' as const;

  async complete(prompt: string): Promise<string> {
    return `[SIM] deterministic response (${prompt.length} chars in)`;
  }

  async planJSON<T>(
    _prompt: string,
    shape: PlanShape,
    context?: unknown,
  ): Promise<T> {
    const ctx = (context ?? {}) as Record<string, unknown>;
    switch (shape) {
      case 'summary': {
        const counts = ctx.counts as { nodes: number; failing: number; pending: number; open: number };
        const flights = ctx.flights as { groundStop: boolean; staleFeed: boolean };
        return {
          provider: 'sim',
          headline: !counts.nodes ? 'Estate not mapped yet.' : `${counts.nodes} mapped systems · ${counts.failing} failing checks · ${counts.open} unresolved violations.`,
          risks: [
            ...(flights.groundStop ? ['Ground stop reported by the simulation.'] : []),
            ...(flights.staleFeed ? ['Position feed is stale; do not rely on displayed aircraft positions.'] : []),
            ...(counts.pending ? [`${counts.pending} checks have not run yet.`] : []),
            ...(counts.open ? [`${counts.open} violations need response or confirmation.`] : []),
          ],
          nextAction: !counts.nodes ? 'Launch discovery to map the simulated estate.' : counts.open ? 'Inspect violations and response tasks before confirming recovery.' : 'Continue monitoring executable checks; this is not external aviation telemetry.',
          evidence: (ctx.recordPaths as string[]).slice(0, 8),
        } as T;
      }
      case 'node':
        return this.planNode(ctx as unknown as SimServiceCtx) as T;
      case 'invariants':
        return this.planInvariants(ctx as unknown as SimServiceCtx) as T;
      case 'spec':
        return this.planSpec(ctx) as T;
      case 'triage':
        return this.planTriage(ctx) as T;
      default:
        throw new Error(`SimulatedProvider: unknown shape ${shape}`);
    }
  }

  private planNode(ctx: SimServiceCtx) {
    const s = ctx.service;
    const depLine =
      s.deps.length === 0
        ? 'It sits at the root of the dependency graph.'
        : `It hard-depends on ${s.deps.join(', ')} — a failure in any of them cascades here.`;
    return {
      kind: s.kind,
      description:
        `${s.name} — ${s.description} Classified as a ${s.kind} block. ` +
        depLine +
        (s.standby
          ? ` A standby replica (${s.standby}) exists and is the primary failover path.`
          : ''),
      deps: s.deps,
    };
  }

  private planInvariants(ctx: SimServiceCtx) {
    const s = ctx.service;
    const base = ctx.simBase ?? 'http://localhost:4780';
    const drafts: {
      kind: string;
      params: Record<string, unknown>;
      intervalMs: number;
    }[] = [
      {
        kind: 'http_status',
        params: { url: `${base}/sim/op/${s.id}` },
        intervalMs: 2000,
      },
      {
        kind: 'latency_lt',
        params: { url: `${base}/sim/health/${s.id}`, ms: 800 },
        intervalMs: 3000,
      },
      {
        kind: 'data_field',
        params: { url: `${base}/sim/op/${s.id}`, field: 'rev' },
        intervalMs: 3000,
      },
    ];
    for (const dep of s.deps) {
      drafts.push({
        kind: 'dep_health',
        params: { dep },
        intervalMs: 2000,
      });
    }
    if (s.id === 'message-consumer') {
      for (const field of ['integrityOk', 'sequenceOk', 'freshnessOk']) drafts.push({
        kind: 'data_field', params: { url: `${base}/sim/communications/status`, field, equals: true }, intervalMs: 1000,
      });
    }
    if (s.id === 'unimatic') {
      // THE Unimatic check — two surfaces must agree on the estate revision.
      drafts.push({
        kind: 'consistency',
        params: {
          url: `${base}/sim/op/unimatic`,
          field: 'rev',
          via: `${base}/sim/op/ops-radar`,
          viaField: 'unimaticRev',
        },
        intervalMs: 2000,
      });
    }
    return { invariants: drafts };
  }

  private planSpec(ctx: Record<string, unknown>) {
    const s = ctx.service as SimServiceCtx['service'];
    const inv = (ctx.invariants as { kind: string }[] | undefined) ?? [];
    return {
      title: `Spec — ${s.name}`,
      body:
        `# ${s.name}\n\n${s.description}\n\n` +
        `**Block kind:** ${s.kind}\n` +
        `**Required dependencies:** ${s.deps.length ? s.deps.join(', ') : 'none'}\n\n` +
        `## Behavioral contract\n\n` +
        `The block must answer its op surface with HTTP 200 inside latency ` +
        `budget, and every required dependency must itself be effectively up. ` +
        `${s.standby ? `On primary loss, failover to ${s.standby} restores the contract.` : ''}\n\n` +
        `## Invariants (${inv.length})\n\n` +
        inv.map((i) => `- \`${i.kind}\``).join('\n'),
    };
  }

  private planTriage(ctx: Record<string, unknown>) {
    const node = ctx.node as { id: string; kind: string; health: string };
    const inDegree = (ctx.inDegree as number) ?? 0;
    const kinds = (ctx.invariantKinds as string[]) ?? [];
    const depHealthy = (ctx.depHealthy as boolean) ?? true;

    let skill = 'degraded-restore';
    if (kinds.includes('dep_health') && depHealthy) skill = 'dep-reconnect';
    else if (node.kind === 'hub') skill = 'hub-failover';
    else if (node.kind === 'feed') skill = 'feed-resync';

    const priority = node.kind === 'hub' ? 5 : node.kind === 'feed' ? 4 : 3;
    return {
      rootCause: node.id,
      skill,
      priority,
      rationale:
        `[SIM] ${node.id} (${node.kind}) holds ${ctx.violationCount ?? 1} open ` +
        `violation(s), in-degree ${inDegree}. ` +
        (skill === 'dep-reconnect'
          ? 'dep_health proof failed while the dep itself is up — severed edge, reroute.'
          : skill === 'hub-failover'
            ? 'Hub down with dependents cascading — fail over to standby.'
            : `Restore path for a ${node.kind} block.`),
    };
  }
}

// ---------- selection + resilience ----------

/** Primary provider falls back to SIM on any call failure — demo insurance. */
export class ResilientProvider implements ModelProvider {
  name: 'gemini' | 'sim';
  private primary: ModelProvider;
  private fallback = new SimulatedProvider();
  onFallback?: (err: unknown) => void;

  constructor(primary: ModelProvider) {
    this.primary = primary;
    this.name = primary.name;
  }

  async complete(prompt: string): Promise<string> {
    try {
      return await this.primary.complete(prompt);
    } catch (e) {
      this.onFallback?.(e);
      return this.fallback.complete(prompt);
    }
  }

  async planJSON<T>(
    prompt: string,
    shape: PlanShape,
    context?: unknown,
  ): Promise<T> {
    try {
      return await this.primary.planJSON<T>(prompt, shape, context);
    } catch (e) {
      this.onFallback?.(e);
      return this.fallback.planJSON<T>(prompt, shape, context);
    }
  }
}

export function selectProvider(): ModelProvider {
  const want = process.env.ARSU_PROVIDER;
  const key = process.env.GEMINI_API_KEY;
  if (want === 'sim') return new SimulatedProvider();
  if (want === 'gemini' || key) {
    const p = new ResilientProvider(new GeminiProvider(key));
    p.onFallback = (e) =>
      console.warn(`[swarm] gemini call failed, SIM fallback: ${e}`);
    return p;
  }
  return new SimulatedProvider();
}
