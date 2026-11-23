// The presenter's script: one beat per moment of the stage demo (docs/DEMO.md).
// Each beat names the view it opens, what to say, the optional action it runs,
// and the live condition that proves the beat landed.
import type { Board } from "./api";

export type DemoView = "Mission Control" | "Airspace" | "Topology" | "Verification" | "Swarm" | "Pipeline" | "Blackboard";
export type DemoAction = "launch" | "hub-outage" | "evidence";

export interface DemoContext {
  board: Board;
  /** Run ids that existed before the director injected its fault. */
  priorRuns: string[];
  injected: boolean;
}

export interface Watch {
  done: boolean;
  /** Short live readout, e.g. "6 / 8 systems mapped". */
  status: string;
  /** Present when the beat cannot proceed until something else happens. */
  blocked?: string;
}

export interface Beat {
  id: string;
  kicker: string;
  title: string;
  view: DemoView;
  radar?: boolean;
  say: string;
  action?: { kind: DemoAction; label: string };
  watch: (ctx: DemoContext) => Watch;
  /** Autopilot pause after the beat lands, in ms. */
  hold: number;
}

export function demoRun(ctx: DemoContext) {
  return ctx.board.rehearsal?.runs.find((r) => r.scenario === "hub-outage" && !ctx.priorRuns.includes(r.id));
}

const expected = (b: Board) => b.rehearsal?.expectedSystems ?? 8;
const expectedLinks = (b: Board) => b.rehearsal?.expectedLinks ?? 8;
const proofs = (b: Board) => {
  const all = [...b.invariants.values()];
  return { pass: all.filter((i) => i.lastResult === "pass").length, total: all.length };
};

export const BEATS: Beat[] = [
  {
    id: "cold-open",
    kicker: "Cold open",
    title: "An estate nobody has mapped",
    view: "Swarm",
    say: "This is an airline back office we know nothing about. The blackboard is empty: zero systems, zero proofs.",
    watch: ({ board }) => ({ done: true, status: `${board.nodes.size} / ${expected(board)} systems known` }),
    hold: 5000,
  },
  {
    id: "airspace",
    kicker: "The stakes",
    title: "Forty flights in the air",
    view: "Airspace",
    say: "Forty flights on real North American routes, all depending on eight back-office systems. The same shape United runs on.",
    watch: ({ board }) => ({ done: true, status: `${board.flights.flights.length} aircraft tracked` }),
    hold: 6000,
  },
  {
    id: "launch",
    kicker: "Launch",
    title: "One click starts the swarm",
    view: "Swarm",
    say: "One click. Agents register on the blackboard and recon starts probing the estate.",
    action: { kind: "launch", label: "Launch swarm" },
    watch: ({ board }) => {
      if (!board.mission.launched) return { done: false, status: "Swarm idle", blocked: "Run the action to launch" };
      const n = board.nodes.size;
      return { done: n >= expected(board), status: `${n} / ${expected(board)} systems mapped` };
    },
    hold: 3000,
  },
  {
    id: "topology",
    kicker: "Discovery",
    title: "The swarm drew this map itself",
    view: "Topology",
    say: "Nobody configured this graph. Every system and every dependency link was discovered and written to the blackboard.",
    watch: ({ board }) => {
      const e = board.edges.size;
      return { done: e >= expectedLinks(board), status: `${e} / ${expectedLinks(board)} dependency links` };
    },
    hold: 6000,
  },
  {
    id: "proof",
    kicker: "Proof",
    title: "Every system gets executable proofs",
    view: "Verification",
    say: "Each block now has machine-checkable invariants: availability, latency budgets, schema integrity. All green.",
    watch: ({ board }) => {
      const p = proofs(board);
      const ready = !!board.rehearsal?.ready;
      return { done: ready, status: `${p.pass} / ${p.total} proofs passing${ready ? " · baseline verified" : ""}`, blocked: ready ? undefined : board.rehearsal?.blockers[0] };
    },
    hold: 5000,
  },
  {
    id: "mission",
    kicker: "Mission control",
    title: "One screen for the whole estate",
    view: "Mission Control",
    say: "Systems online, proofs passing, open violations, swarm actions. This is the operator's single pane.",
    watch: ({ board }) => {
      const up = [...board.nodes.values()].filter((n) => n.health === "up").length;
      return { done: true, status: `${up} / ${board.nodes.size} systems online` };
    },
    hold: 6000,
  },
  {
    id: "fault",
    kicker: "Fault",
    title: "August 6th: the hub goes dark",
    view: "Airspace",
    radar: true,
    say: "This is what happened on August 6th. The flight-information hub goes offline and every flight is held on the ground.",
    action: { kind: "hub-outage", label: "Take Unimatic offline" },
    watch: (ctx) => {
      const run = demoRun(ctx);
      if (!ctx.injected && !run) {
        const ready = !!ctx.board.rehearsal?.ready;
        return { done: false, status: ready ? "Estate green, ready for the fault" : "Waiting for a green baseline", blocked: ready ? "Run the action to inject" : "Wait for every proof to pass" };
      }
      const stop = ctx.board.flights.groundStop;
      return { done: !!run && (stop || run.outcome !== "running"), status: stop ? "GROUND STOP · Unimatic offline" : run ? "Fault landed" : "Injecting fault" };
    },
    hold: 4000,
  },
  {
    id: "response",
    kicker: "Response",
    title: "Triage, failover, recovery",
    view: "Topology",
    say: "Links sever and proofs fail. The orchestrator triages, the response agent runs hub failover, and the standby takes over.",
    watch: (ctx) => {
      const run = demoRun(ctx);
      if (!run) return { done: false, status: "No stress test running", blocked: "Go back and inject the fault" };
      if (run.outcome === "failed") return { done: false, status: "Recovery failed", blocked: run.detail };
      return { done: run.outcome === "verified", status: run.outcome === "verified" ? "Recovered and re-verified" : run.detail || "Swarm responding" };
    },
    hold: 4000,
  },
  {
    id: "evidence",
    kicker: "Evidence",
    title: "Verified, with every decision receipted",
    view: "Swarm",
    say: "The stress test is verified: violations raised, actions taken, proofs green again. Every decision is in the evidence file.",
    action: { kind: "evidence", label: "Download evidence" },
    watch: (ctx) => {
      const run = demoRun(ctx);
      const verified = ctx.board.rehearsal?.runs.filter((r) => r.outcome === "verified").length ?? 0;
      return {
        done: run?.outcome === "verified",
        status: run ? `${run.violationIds.length} violations · ${run.actionIds.length} actions · ${verified} verified` : "No recorded run yet",
      };
    },
    hold: 7000,
  },
  {
    id: "close",
    kicker: "Close",
    title: "Point it at a real estate",
    view: "Mission Control",
    say: "Discover, prove, break, recover, all autonomously. Imagine this pointed at a real estate.",
    watch: ({ board }) => {
      const p = proofs(board);
      return { done: true, status: `${p.pass} / ${p.total} proofs passing` };
    },
    hold: 0,
  },
];
