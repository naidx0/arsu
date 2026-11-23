// Flow-canvas building blocks: dotted area sparkline, dotted progress meter and
// the node card that carries them (kicker, status pill, key/value well,
// metric pair, chart, meter, tags).
import type { ReactNode } from "react";

export type Tone = "ok" | "info" | "warn" | "bad" | "idle";

/** Bucket event timestamps into `n` columns, smoothed, normalised to 0..1. */
export function series(ts: number[], range: [number, number], n = 48): number[] {
  const [from, to] = range;
  const span = Math.max(1, to - from);
  const raw = new Array(n).fill(0);
  for (const t of ts) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(((t - from) / span) * n)));
    raw[i] += 1;
  }
  const smooth = raw.map((_, i) => (raw[i - 1] ?? raw[i]) * 0.25 + raw[i] * 0.5 + (raw[i + 1] ?? raw[i]) * 0.25);
  // Running level keeps the line readable: activity lifts it, quiet lets it settle.
  let level = 0;
  const lifted = smooth.map((v) => (level = level * 0.8 + v));
  const max = Math.max(...lifted);
  return lifted.map((v) => (max ? 0.12 + (v / max) * 0.88 : 0.12));
}

export function DotSpark({ values, tone = "idle" }: { values: number[]; tone?: Tone }) {
  const W = 240;
  const H = 46;
  const step = W / values.length;
  let dots = "";
  const line: string[] = [];
  values.forEach((v, i) => {
    const x = i * step + step / 2;
    const top = H - 4 - v * (H - 10);
    line.push(`${x.toFixed(1)},${top.toFixed(1)}`);
    for (let y = top + 3.2; y <= H - 1; y += 3.2) dots += `M${x.toFixed(1)} ${y.toFixed(1)}h0`;
  });
  return (
    <svg className={`flow-spark ${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-fade-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.75" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      <path d={dots} stroke={`url(#spark-fade-${tone})`} strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <polyline points={line.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DotMeter({ value, tone = "idle", cells = 44 }: { value: number; tone?: Tone; cells?: number }) {
  const lit = Math.round(Math.min(1, Math.max(0, value)) * cells);
  return (
    <span className={`flow-meter ${tone}`} aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)}
    </span>
  );
}

export interface FlowCardProps {
  kicker: string;
  title: string;
  pill: { label: string; tone: Tone };
  desc: string;
  kv: [string, ReactNode][];
  metrics: [{ label: string; value: ReactNode }, { label: string; value: ReactNode }];
  spark: number[];
  meter: { label: string; value: number; text: string };
  tone: Tone;
  tags: string[];
  time: string;
  active?: boolean;
  live?: boolean;
  icon: ReactNode;
  onSelect?: () => void;
}

export function FlowCard(p: FlowCardProps) {
  return (
    <button type="button" className={`flow-card ${p.active ? "active" : ""}`} data-tone={p.tone} data-live={p.live || undefined} aria-current={p.active ? "step" : undefined} onClick={p.onSelect}>
      <span className="flow-card-head">
        <span className="flow-card-icon">{p.icon}</span>
        <span className="flow-card-titles">
          <span className="flow-kicker">{p.kicker}</span>
          <strong className="flow-title">{p.title}</strong>
        </span>
        <span className={`flow-pill ${p.pill.tone}`}>
          <i />
          {p.pill.label}
        </span>
      </span>
      <span className="flow-desc">{p.desc}</span>
      <span className="flow-kv">
        {p.kv.map(([k, v]) => (
          <span key={k}>
            <span>{k}</span>
            <b>{v}</b>
          </span>
        ))}
      </span>
      <span className="flow-metrics">
        {p.metrics.map((m) => (
          <span key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </span>
        ))}
      </span>
      <DotSpark values={p.spark} tone={p.tone} />
      <span className="flow-meter-row">
        <span>{p.meter.label}</span>
        <b>{p.meter.text}</b>
      </span>
      <DotMeter value={p.meter.value} tone={p.tone} />
      <span className="flow-foot">
        <span className="flow-tags">
          {p.tags.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </span>
        <time>{p.time}</time>
      </span>
    </button>
  );
}
