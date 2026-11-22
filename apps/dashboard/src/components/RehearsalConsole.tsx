import { useId, useState } from 'react';
import { post, type Board } from '../api';
import PracticeLayers from './PracticeLayers';

export default function RehearsalConsole({ board, enabled, onLaunch, onInspect }: {
  board: Board; enabled: boolean; onLaunch: () => void; onInspect: (id: string) => void;
}) {
  const marker = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rehearsal = board.rehearsal;
  const latest = rehearsal?.runs[0];
  const nodes = [...board.nodes.values()];
  const points = new Map(nodes.map((n, i) => {
    const row = n.layer && board.practice ? board.practice.layers.indexOf(n.layer) : Math.floor(i / 4);
    const col = n.layer && board.practice ? nodes.filter(other => other.layer === n.layer).findIndex(other => other.id === n.id) : i % 4;
    return [n.id, { x: 115 + col * 195, y: 50 + row * 140 }];
  }));
  const checks = [...board.invariants.values()];
  const events = board.events.filter(e => ['planning', 'probe', 'recon', 'verify', 'violation', 'triage', 'remediate', 'action', 'resolved', 'chaos', 'rehearsal'].includes(e.type)).slice(0, 20);
  async function stress(scenario: string) {
    setBusy(true); setError('');
    try { await post('/api/rehearsal', { scenario }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Stress test failed to start'); }
    finally { setBusy(false); }
  }
  return <section className="rehearsal-console" aria-label="Executable mission rehearsal">
    <header><div><span className="pipeline-eyebrow">{rehearsal?.recording ? 'RECORDING ENVIRONMENT · EPHEMERAL BLACKBOARD' : 'EXECUTABLE AVIATION REHEARSAL'}</span><h2>Discover. Stress. Prove recovery.</h2></div>
      <button className="mini-btn" disabled={!enabled || busy || board.mission.launched} onClick={onLaunch}>{board.mission.launched ? 'Swarm launched' : 'Launch environment'}</button></header>
    {!enabled && <p role="status">Connect to the host to run the real swarm. Example data cannot run a verified rehearsal.</p>}
    {!rehearsal?.recording && <p>For a clean recording, start <code>npm run dev:recording</code>. It waits for launch and leaves your saved board untouched.</p>}
    <div className="rehearsal-metrics">
      <div><strong>{nodes.length}<small> / {rehearsal?.expectedSystems ?? '—'}</small></strong><span>Systems discovered</span></div>
      <div><strong>{board.edges.size}<small> / {rehearsal?.expectedLinks ?? '—'}</small></strong><span>Dependency links</span></div>
      <div><strong>{checks.filter(i => i.lastResult === 'pass').length}<small> / {checks.length}</small></strong><span>Checks passing</span></div>
      <div><strong>{rehearsal?.runs.filter(r => r.outcome === 'verified').length ?? 0}</strong><span>Verified stress tests</span></div>
    </div>
    <div className="rehearsal-grid"><div className="rehearsal-map"><header><h3>Discovered dependency graph</h3><span>Click a component</span></header>
      {nodes.length ? <svg viewBox={`0 0 820 ${Math.max(280, (board.practice ? 3 : Math.ceil(nodes.length / 4)) * 140)}`} aria-label="Live discovered systems and dependency links">
        <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="var(--muted)" /></marker></defs>
        {[...board.edges.values()].map(edge => {
          const a = points.get(edge.from), b = points.get(edge.to);
          const broken = board.nodes.get(edge.to)?.health !== 'up' || checks.some(i => i.node === edge.from && i.kind === 'dep_health' && i.params.dep === edge.to && i.lastResult === 'fail');
          return a && b ? <path key={edge.id} markerEnd={`url(#${marker})`} d={`M${a.x},${a.y + 37} Q${(a.x + b.x) / 2},${Math.max(a.y, b.y) + 110} ${b.x},${b.y + 37}`} className={broken ? 'link-down' : 'link-up'}><title>{edge.from} depends on {edge.to}</title></path> : null;
        })}
        {nodes.map(n => { const p = points.get(n.id)!; return <g key={n.id} className={`rehearsal-node ${n.health}`} role="button" tabIndex={0} aria-label={`Inspect ${n.name}, ${n.health}`} onClick={() => onInspect(n.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInspect(n.id); } }} transform={`translate(${p.x},${p.y})`}><rect x={-88} y={-28} width={176} height={64} rx={10} /><text textAnchor="middle" y={-2}>{n.name}</text><text textAnchor="middle" y={20} className="node-meta">{n.kind} · {n.health}</text></g>; })}
      </svg> : <div className="rehearsal-empty">Waiting for recon probes. Nodes appear only when the swarm writes them.</div>}
      <div className="rehearsal-roles">{(['recon', 'verify', 'runner', 'orchestrator', 'response'] as const).map(role => { const agents = [...board.agents.values()].filter(a => a.role === role); return <span key={role}><b>{role}</b>{agents.filter(a => a.state === 'working').length} working / {agents.length} units</span>; })}</div>
    </div><div className="rehearsal-stress"><h3>Stress scenarios</h3><p>{latest?.outcome === 'running' ? latest.detail : rehearsal?.ready ? 'Baseline verified. Choose one fault.' : 'Waiting for complete mapping and fresh passing checks.'}</p>
      <div className="rehearsal-scenarios">{rehearsal?.scenarios.map(s => <button className="mini-btn" key={s.id} disabled={!enabled || !rehearsal.ready || busy} onClick={() => stress(s.id)}>{s.title}</button>)}</div>
      {!!rehearsal?.blockers.length && <details><summary>{rehearsal.blockers.length} readiness gates pending</summary><ul>{rehearsal.blockers.map(b => <li key={b}>{b}</li>)}</ul></details>}
      {error && <p role="alert">{error}</p>}
      <p className="rehearsal-caveat">Simulation only. Verification covers these executable checks. In recording mode, download evidence before stopping the host; restart the recording command for a fresh take.</p>
    </div></div>
    {board.practice && <details className="practice-disclosure"><summary>Explore layers and message receipts</summary><PracticeLayers board={board} onInspect={onInspect} /></details>}
    <div className="rehearsal-grid"><section className="rehearsal-events"><h3>Live execution receipts</h3><div aria-label="Execution event log">{events.map(e => <details key={e.id}><summary><time>{new Date(e.ts).toLocaleTimeString()}</time><span>{e.msg}</span><small>{e.actor}</small></summary><pre>{JSON.stringify(e, null, 2)}</pre></details>)}{!events.length && <p>No agent work has been observed yet.</p>}</div></section>
      <section className="rehearsal-history"><h3>Recorded outcomes</h3>{rehearsal?.runs.map(run => <article key={run.id} data-outcome={run.outcome}><header><strong>{run.scenario}</strong><span>{run.outcome}</span></header><p>{run.detail}</p><small>{run.violationIds.length} violations · {run.actionIds.length} actions</small>{run.outcome !== 'running' && <a href={`/api/rehearsal/${encodeURIComponent(run.id)}/evidence`} download>Download evidence JSON</a>}</article>)}{!rehearsal?.runs.length && <p>Completed stress tests will retain proof results, tasks, topology, and event receipts here.</p>}</section></div>
  </section>;
}
