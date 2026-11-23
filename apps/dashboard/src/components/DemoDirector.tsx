// Presenter overlay: walks the stage demo beat by beat, opens each view,
// runs the beat's action, and shows the live evidence that it landed.
// Keys: → / PageDown / Space next, ← / PageUp back, A autopilot, H hide, Esc close.
import { useEffect, useRef, useState } from "react";
import type { Board } from "../api";
import { BEATS, demoRun, type DemoContext, type DemoView } from "../demo-script";

export default function DemoDirector({ board, onView, onRadar, onLaunch, onScenario, onClose }: {
  board: Board;
  onView: (v: DemoView) => void;
  onRadar: (on: boolean) => void;
  onLaunch: () => void;
  onScenario: (id: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [ran, setRan] = useState<Set<string>>(() => new Set());
  const [injected, setInjected] = useState(false);
  const [priorRuns, setPriorRuns] = useState<string[]>(() => board.rehearsal?.runs.map((r) => r.id) ?? []);
  const [started] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const beat = BEATS[index];
  const ctx: DemoContext = { board, priorRuns, injected };
  const watch = beat.watch(ctx);
  const last = index === BEATS.length - 1;

  const actionDone = (() => {
    if (!beat.action) return true;
    if (beat.action.kind === "launch") return board.mission.launched;
    if (beat.action.kind === "hub-outage") return injected || !!demoRun(ctx);
    return ran.has(beat.id);
  })();
  const actionReady = beat.action?.kind !== "hub-outage" || !!board.rehearsal?.ready;

  function runAction() {
    if (!beat.action || actionDone) return;
    if (beat.action.kind === "launch") onLaunch();
    if (beat.action.kind === "hub-outage") {
      if (!board.rehearsal?.ready) return;
      setPriorRuns(board.rehearsal.runs.map((r) => r.id));
      setInjected(true);
      onScenario("hub-outage");
    }
    if (beat.action.kind === "evidence") {
      const run = demoRun(ctx);
      if (!run) return;
      const a = document.createElement("a");
      a.href = `/api/rehearsal/${encodeURIComponent(run.id)}/evidence`;
      a.download = "";
      a.click();
    }
    setRan((s) => new Set(s).add(beat.id));
  }

  const go = (d: number) => setIndex((i) => Math.min(BEATS.length - 1, Math.max(0, i + d)));
  const primary = () => (!actionDone && actionReady ? runAction() : last ? onClose() : go(1));

  // Each beat owns its view.
  useEffect(() => {
    onView(beat.view);
    if (beat.view === "Airspace") onRadar(!!beat.radar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Bring the beat's key element into view, again once the beat lands (it may appear late).
  useEffect(() => {
    if (!beat.focus) return;
    const t = window.setTimeout(() => document.querySelector(beat.focus!)?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
    return () => window.clearTimeout(t);
  }, [index, beat.focus, watch.done]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Autopilot: run the action once it is allowed, then hold and advance once the beat lands.
  const latest = useRef({ primary, runAction, go });
  latest.current = { primary, runAction, go };
  useEffect(() => {
    if (!auto) return;
    if (!actionDone && actionReady) {
      const t = window.setTimeout(() => latest.current.runAction(), 1800);
      return () => window.clearTimeout(t);
    }
    if (watch.done && actionDone && !last) {
      const t = window.setTimeout(() => latest.current.go(1), beat.hold);
      return () => window.clearTimeout(t);
    }
  }, [auto, index, actionDone, actionReady, watch.done, last, beat.hold]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && el === document.body)) { e.preventDefault(); latest.current.primary(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); latest.current.go(-1); }
      else if (e.key === "Escape") onClose();
      else if (e.key.toLowerCase() === "a" && !e.metaKey && !e.ctrlKey) setAuto((v) => !v);
      else if (e.key.toLowerCase() === "h" && !e.metaKey && !e.ctrlKey) setHidden((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const secs = Math.floor((now - started) / 1000);
  const clock = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const state = watch.done && actionDone ? "landed" : watch.blocked && actionDone ? "blocked" : "pending";

  if (hidden)
    return (
      <button className="demo-pill" onClick={() => setHidden(false)} aria-label="Show demo director">
        <span className={`demo-light ${state}`} />
        {String(index + 1).padStart(2, "0")} / {BEATS.length} · {beat.kicker}
      </button>
    );

  return (
    <section className="demo-director" role="region" aria-label="Demo director" data-beat={beat.id} data-state={state}>
      <ol className="demo-rail" aria-label="Demo beats">
        {BEATS.map((b, i) => (
          <li key={b.id}>
            <button className={i === index ? "current" : i < index ? "past" : ""} onClick={() => setIndex(i)} aria-label={`Beat ${i + 1}: ${b.kicker}`} aria-current={i === index ? "step" : undefined} />
          </li>
        ))}
      </ol>
      <header className="demo-head">
        <span className="demo-kicker">
          {String(index + 1).padStart(2, "0")} / {BEATS.length} · {beat.kicker}
        </span>
        <span className="demo-meta">
          <span className="demo-clock">T+ {clock}</span>
          <button className={`demo-auto ${auto ? "on" : ""}`} aria-pressed={auto} onClick={() => setAuto((v) => !v)} title="Autopilot (A)">
            {auto ? "Autopilot on" : "Autopilot"}
          </button>
          <button className="demo-icon" onClick={() => setHidden(true)} aria-label="Hide demo director" title="Hide (H)">–</button>
          <button className="demo-icon" onClick={onClose} aria-label="Close demo director" title="Close (Esc)">×</button>
        </span>
      </header>
      <h2 className="demo-title">{beat.title}</h2>
      <p className="demo-say">{beat.say}</p>
      <div className="demo-foot">
        <span className={`demo-status ${state}`} role="status">
          <span className={`demo-light ${state}`} />
          {watch.status}
          {state !== "landed" && watch.blocked && <small>{watch.blocked}</small>}
        </span>
        <span className="demo-buttons">
          <button className="demo-back" disabled={index === 0} onClick={() => go(-1)}>Back</button>
          <button className="demo-next" disabled={!actionDone && !actionReady} onClick={primary}>
            {!actionDone && beat.action ? beat.action.label : last ? "Finish" : "Next"} <span aria-hidden="true">→</span>
          </button>
        </span>
      </div>
    </section>
  );
}
