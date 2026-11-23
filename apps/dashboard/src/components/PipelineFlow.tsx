// The seven pipeline stages as a flow canvas: stage cards with live counters,
// dotted activity charts and orthogonal wires. Detection branches into the
// response lane on a violation, or straight to confirmation when clear.
import { useLayoutEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AiNetworkIcon, Alert02Icon, CheckmarkCircle01Icon, FlashIcon, Search01Icon, Shield01Icon, WorkflowSquare01Icon } from "@hugeicons/core-free-icons";
import type { Board } from "../api";
import { FlowCard, series, type FlowCardProps, type Tone } from "./FlowKit";

function ago(ts?: number) {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}
const pct = (a: number, b: number) => (b ? a / b : 0);
const pctText = (a: number, b: number) => `${Math.round(pct(a, b) * 100)}%`;

type Wire = { d: string; ports: [number, number][]; label?: { x: number; y: number; text: string; tone: Tone } };
type Lane = { x: number; y: number; text: string };

export default function PipelineFlow({ board, stage, liveStep, onSelect }: {
  board: Board; stage: number; liveStep: number; onSelect: (i: number) => void;
}) {
  const nodes = [...board.nodes.values()];
  const invariants = [...board.invariants.values()];
  const violations = [...board.violations.values()];
  const tasks = [...board.tasks.values()];
  const agents = [...board.agents.values()];
  const events = board.events;
  const passing = invariants.filter((i) => i.lastResult === "pass").length;
  const failing = invariants.filter((i) => i.lastResult === "fail").length;
  const open = violations.filter((v) => v.status !== "resolved").length;
  const resolved = violations.length - open;
  const remediate = tasks.filter((t) => t.kind === "remediate");
  const doneTasks = remediate.filter((t) => t.status === "done").length;
  const activeTasks = remediate.filter((t) => t.status === "pending" || t.status === "claimed").length;
  const runs = board.rehearsal?.runs ?? [];
  const verified = runs.filter((r) => r.outcome === "verified").length;
  const expected = board.rehearsal?.expectedSystems ?? Math.max(nodes.length, 1);
  const expectedLinks = board.rehearsal?.expectedLinks ?? Math.max(board.edges.size, 1);
  const role = (r: string) => agents.filter((a) => a.role === r).length;
  const tsAll = events.map((e) => e.ts);
  const range: [number, number] = tsAll.length ? [Math.min(...tsAll), Math.max(Date.now(), ...tsAll)] : [Date.now() - 60_000, Date.now()];
  const of = (types: string[]) => events.filter((e) => types.includes(e.type));
  const sparkOf = (types: string[]) => series(of(types).map((e) => e.ts), range);
  const lastOf = (types: string[]) => of(types).reduce((m, e) => Math.max(m, e.ts), 0) || undefined;
  const covered = new Set(invariants.map((i) => i.node)).size;
  const actions = of(["action", "remediate"]).length;

  const status = (i: number, records: number, override?: { label: string; tone: Tone }): { label: string; tone: Tone } =>
    override ?? (i === liveStep && nodes.length ? { label: "Live", tone: "info" } : records ? { label: "Done", tone: "ok" } : { label: "Waiting", tone: "idle" });

  const icon = (i: Parameters<typeof HugeiconsIcon>[0]["icon"]) => <HugeiconsIcon icon={i} size={15} />;
  const cards: Omit<FlowCardProps, "active" | "onSelect">[] = [
    {
      kicker: "Recon · 01", title: "Discover sources", icon: icon(Search01Icon),
      pill: status(0, nodes.length), tone: nodes.length >= expected ? "ok" : nodes.length ? "info" : "idle",
      desc: "Probes the registry and health endpoints",
      kv: [["Source", "sim/registry"], ["Agents", `recon ×${role("recon")}`], ["Receipts", `${nodes.reduce((n, x) => n + ((x as { evidence?: unknown[] }).evidence?.length ?? 0), 0)} stored`]],
      metrics: [{ label: "Systems", value: nodes.length }, { label: "Probes", value: of(["probe"]).length }],
      spark: sparkOf(["probe", "recon"]), meter: { label: "Mapped", value: pct(nodes.length, expected), text: `${nodes.length} / ${expected}` },
      tags: ["nodes", "recon"], time: ago(lastOf(["probe", "recon"])), live: liveStep === 0,
    },
    {
      kicker: "Ontology · 02", title: "Build ontology", icon: icon(AiNetworkIcon),
      pill: status(1, board.edges.size), tone: board.edges.size >= expectedLinks ? "ok" : board.edges.size ? "info" : "idle",
      desc: "Types components and links dependencies",
      kv: [["Nodes", nodes.length], ["Edges", board.edges.size], ["Kinds", new Set(nodes.map((n) => n.kind)).size]],
      metrics: [{ label: "Links", value: board.edges.size }, { label: "Roots", value: nodes.filter((n) => ![...board.edges.values()].some((e) => e.from === n.id)).length }],
      spark: sparkOf(["recon", "planning"]), meter: { label: "Linked", value: pct(board.edges.size, expectedLinks), text: `${board.edges.size} / ${expectedLinks}` },
      tags: ["edges", "graph"], time: ago(lastOf(["recon"])), live: liveStep === 1,
    },
    {
      kicker: "Verify · 03", title: "Author contracts", icon: icon(Shield01Icon),
      pill: status(2, invariants.length), tone: invariants.length ? "ok" : "idle",
      desc: "Writes specs and executable invariants",
      kv: [["Specs", board.specs.size], ["Invariants", invariants.length], ["Kinds", new Set(invariants.map((i) => i.kind)).size]],
      metrics: [{ label: "Proofs", value: invariants.length }, { label: "Systems", value: covered }],
      spark: sparkOf(["verify"]), meter: { label: "Coverage", value: pct(covered, nodes.length), text: pctText(covered, nodes.length) },
      tags: ["specs", "invariants"], time: ago(lastOf(["verify"])), live: liveStep === 2,
    },
    {
      kicker: "Runner · 04", title: "Detect violations", icon: icon(Alert02Icon),
      pill: status(3, violations.length, open ? { label: `${open} open`, tone: "bad" } : invariants.length ? { label: "Clear", tone: "ok" } : undefined),
      tone: open || failing ? "bad" : invariants.length ? "ok" : "idle",
      desc: "Runs every proof on its interval",
      kv: [["Checks", invariants.length], ["Failing", failing], ["Runs", invariants.reduce((n, i) => n + i.runs, 0)]],
      metrics: [{ label: "Passing", value: passing }, { label: "Violations", value: violations.length }],
      spark: sparkOf(["violation", "chaos"]), meter: { label: "Passing", value: pct(passing, invariants.length), text: pctText(passing, invariants.length) },
      tags: ["violations", "runner"], time: ago(lastOf(["violation", "verify"])), live: liveStep === 3,
    },
    {
      kicker: "Plan · 05", title: "Plan response", icon: icon(WorkflowSquare01Icon),
      pill: status(4, remediate.length, activeTasks ? { label: `${activeTasks} active`, tone: "warn" } : undefined),
      tone: activeTasks ? "warn" : remediate.length ? "ok" : "idle",
      desc: "Separates root cause from collateral",
      kv: [["Tasks", remediate.length], ["Claimed", remediate.filter((t) => t.status === "claimed").length], ["Top priority", remediate.length ? `P${Math.max(...remediate.map((t) => t.priority))}` : "—"]],
      metrics: [{ label: "Dispatched", value: remediate.length }, { label: "Active", value: activeTasks }],
      spark: sparkOf(["triage", "dispatch", "escalation"]), meter: { label: "Planned → done", value: pct(doneTasks, remediate.length), text: `${doneTasks} / ${remediate.length}` },
      tags: ["tasks", "triage"], time: ago(lastOf(["triage", "dispatch"])), live: liveStep === 4,
    },
    {
      kicker: "Respond · 06", title: "Execute skills", icon: icon(FlashIcon),
      pill: status(5, actions, activeTasks ? { label: "Running", tone: "warn" } : undefined),
      tone: activeTasks ? "warn" : actions ? "ok" : "idle",
      desc: "Claims tasks and runs skill steps",
      kv: [["Skills", board.skills.size], ["Units", `response ×${role("response")}`], ["Actions", actions]],
      metrics: [{ label: "Actions", value: actions }, { label: "Done", value: doneTasks }],
      spark: sparkOf(["action", "remediate"]), meter: { label: "Tasks done", value: pct(doneTasks, remediate.length), text: pctText(doneTasks, remediate.length) },
      tags: ["skills", "actions"], time: ago(lastOf(["action", "remediate"])), live: liveStep === 5,
    },
    {
      kicker: "Confirm · 07", title: "Confirm outcome", icon: icon(CheckmarkCircle01Icon),
      pill: status(6, resolved + verified, verified ? { label: `${verified} verified`, tone: "ok" } : undefined),
      tone: open ? "warn" : resolved || verified ? "ok" : "idle",
      desc: "Re-checks proofs after every response",
      kv: [["Resolved", resolved], ["Runs", runs.length], ["Proofs", `${passing}/${invariants.length}`]],
      metrics: [{ label: "Resolved", value: resolved }, { label: "Verified", value: verified }],
      spark: sparkOf(["resolved", "rehearsal"]), meter: { label: "Resolved", value: violations.length ? pct(resolved, violations.length) : invariants.length ? 1 : 0, text: violations.length ? pctText(resolved, violations.length) : "—" },
      tags: ["resolved", "evidence"], time: ago(lastOf(["resolved", "rehearsal"])), live: liveStep === 6,
    },
  ];

  // Wires are measured from the laid-out cards, so they follow any width.
  const canvas = useRef<HTMLDivElement>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [geo, setGeo] = useState<{ wires: Wire[]; lanes: Lane[]; w: number; h: number }>({ wires: [], lanes: [], w: 0, h: 0 });
  const branchTone: Tone = open || failing ? "bad" : "idle";
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const c = el.getBoundingClientRect();
      const r = refs.current.map((n) => {
        const b = n!.getBoundingClientRect();
        return { l: b.left - c.left, t: b.top - c.top, r: b.right - c.left, b: b.bottom - c.top, w: b.width };
      });
      if (r.length < 7) return;
      const PY = 46;
      const wires: Wire[] = [];
      const lanes: Lane[] = [];
      const stacked = Math.abs(r[0].l - r[1].l) < 4;
      const horiz = (a: number, b: number) => {
        const y1 = r[a].t + PY, y2 = r[b].t + PY, x1 = r[a].r, x2 = r[b].l, xm = (x1 + x2) / 2;
        wires.push({ d: `M${x1},${y1} H${xm} V${y2} H${x2}`, ports: [[x1, y1], [x2, y2]] });
      };
      const vert = (a: number, b: number, label?: Wire["label"]) => {
        const x = r[a].l + r[a].w / 2, y1 = r[a].b, y2 = r[b].t;
        wires.push({ d: `M${x},${y1} V${y2}`, ports: [[x, y1], [x, y2]], label });
      };
      if (stacked) {
        for (let i = 0; i < 6; i++) vert(i, i + 1, i === 3 ? { x: r[3].l + r[3].w / 2, y: (r[3].b + r[4].t) / 2, text: open ? "Violation" : "On violation", tone: branchTone } : undefined);
      } else {
        horiz(0, 1); horiz(1, 2); horiz(2, 3); horiz(4, 5); horiz(5, 6);
        const row1 = Math.max(r[0].b, r[1].b, r[2].b, r[3].b);
        const ym = (row1 + r[4].t) / 2 - 10;
        const xv = r[3].l + r[3].w * 0.3, xc = r[3].l + r[3].w * 0.72;
        const xg = r[4].l - Math.max(16, (r[4].l - r[0].r) / 2);
        const y5 = r[4].t + PY;
        wires.push({
          d: `M${xv},${r[3].b} V${ym} H${xg} V${y5} H${r[4].l}`, ports: [[xv, r[3].b], [r[4].l, y5]],
          label: { x: (xv + xg) / 2, y: ym, text: open ? `Violation · ${open}` : "Violation", tone: branchTone },
        });
        wires.push({
          d: `M${xc},${r[3].b} V${r[6].t}`, ports: [[xc, r[3].b], [xc, r[6].t]],
          label: { x: xc, y: (r[3].b + r[6].t) / 2 + 14, text: "Clear", tone: open ? "idle" : "ok" },
        });
        lanes.push({ x: r[0].l, y: r[0].t - 22, text: `Lane · discovery & proof · ${nodes.length} systems` });
        lanes.push({ x: r[4].l, y: r[4].t - 22, text: `Lane A · response · ${remediate.length} tasks` });
      }
      setGeo({ wires, lanes, w: c.width, h: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    refs.current.forEach((n) => n && ro.observe(n));
    return () => ro.disconnect();
  }, [open, failing, branchTone, nodes.length, remediate.length]);

  return (
    <div className="flow-canvas" ref={canvas} role="navigation" aria-label="Mission pipeline">
      <svg className="flow-wires" width={geo.w} height={geo.h} aria-hidden="true">
        {geo.wires.map((w, i) => (
          <g key={i} className={w.label ? `branch ${w.label.tone}` : ""}>
            <path d={w.d} />
            {w.ports.map(([x, y], j) => <rect key={j} x={x - 3.5} y={y - 3.5} width="7" height="7" />)}
          </g>
        ))}
      </svg>
      {geo.wires.filter((w) => w.label).map((w) => (
        <span key={w.label!.text} className={`flow-branch ${w.label!.tone}`} style={{ left: w.label!.x, top: w.label!.y }}>{w.label!.text}</span>
      ))}
      {geo.lanes.map((l) => (
        <span key={l.text} className="flow-lane" style={{ left: l.x, top: l.y }}>{l.text}</span>
      ))}
      {cards.map((c, i) => (
        <div key={c.title} className={`flow-slot s${i + 1}`} ref={(n) => { refs.current[i] = n; }}>
          <FlowCard {...c} active={stage === i} onSelect={() => onSelect(i)} />
        </div>
      ))}
    </div>
  );
}
