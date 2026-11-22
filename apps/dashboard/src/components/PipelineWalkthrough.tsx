import { useState } from 'react';
import type { Board } from '../api';
import OperationalSummary from './OperationalSummary';

type RecordEntry = { path: string; data: unknown };
export default function PipelineWalkthrough({ board, hostEnabled, onInspect, onLaunch }: {
  board: Board; hostEnabled: boolean; onInspect: (id: string) => void; onLaunch: () => void;
}) {
  const [stage, setStage] = useState(0);
  const [recordPath, setRecordPath] = useState('');
  const entries = (collection: string, values: Iterable<{ id: string }>): RecordEntry[] =>
    [...values].map(data => ({ path: `${collection}/${data.id}`, data }));
  const steps = [
    { title: 'Discover sources', actor: 'Recon agents', description: 'Recon reads the simulated service registry and probes health and operational endpoints. Evidence receipts are stored on each discovered component.', records: entries('nodes', board.nodes.values()) },
    { title: 'Build ontology', actor: 'Recon + ModelProvider', description: 'Components become typed nodes. Directed edges point from each dependent to its dependency. Inspect a system to see the receipts and connected systems.', records: entries('edges', board.edges.values()) },
    { title: 'Author contracts', actor: 'Verification + ModelProvider', description: 'Verification agents turn discovered context into human-readable specs and executable invariants. The author and source node are preserved in each record.', records: [...entries('specs', board.specs.values()), ...entries('invariants', board.invariants.values())] },
    { title: 'Detect violations', actor: 'Proof runner', description: 'The runner executes checks, records pass/fail details and opens violations. Unrun checks are not evidence of health.', records: entries('violations', board.violations.values()) },
    { title: 'Plan response', actor: 'Orchestrator + ModelProvider', description: 'The orchestrator separates root failures from collateral effects and dispatches skill-backed remediation tasks. Task IDs identify work items; they are not invented idempotency keys.', records: entries('tasks', [...board.tasks.values()].filter(t => t.kind === 'remediate')) },
    { title: 'Execute skills', actor: 'Response units', description: 'Response agents claim tasks through the Blackboard and execute the selected skill steps against the simulation action surface. No direct agent-to-agent messages.', records: entries('skills', board.skills.values()) },
    { title: 'Confirm outcome', actor: 'Runner + response units', description: 'Review resolution records alongside current checks. Resolved history alone does not prove current health. The retained event window shows observed actions, not hidden model reasoning.', records: [...entries('violations', [...board.violations.values()].filter(v => v.status === 'resolved')), ...entries('events', board.events.filter(e => ['resolved', 'action', 'triage', 'dispatch', 'escalation'].includes(e.type)))] },
  ];
  const current = steps[stage];
  const record = current.records.find(r => r.path === recordPath) ?? current.records[0];
  return <div className="pipeline-workspace">
    <div className="pipeline-intro"><div><span className="pipeline-eyebrow">LIVE RECORD WALKTHROUGH</span><h2>From discovery to verified response</h2><p>Simulated airline estate · {board.provider.toUpperCase()} configured · {hostEnabled ? 'Host Blackboard' : 'Local example records'}</p></div>
      <button className="mini-btn" onClick={onLaunch}>{board.nodes.size ? 'Re-scan estate' : 'Launch discovery'}</button></div>
    <nav className="pipeline-steps" aria-label="Mission pipeline">{steps.map((s, i) => <button key={s.title} aria-current={stage === i ? 'step' : undefined} onClick={() => { setStage(i); setRecordPath(''); }}><span>{String(i + 1).padStart(2, '0')}</span><strong>{s.title}</strong><small>{s.records.length} records</small></button>)}</nav>
    <div className="pipeline-detail-grid"><section className="pipeline-stage"><span className="pipeline-eyebrow">STAGE {stage + 1} / {steps.length} · {current.actor}</span><h2>{current.title}</h2><p>{current.description}</p>
      <div className="pipeline-record-list">{current.records.length ? current.records.map(r => <button key={r.path} aria-pressed={record?.path === r.path} onClick={() => setRecordPath(r.path)}>{r.path}</button>) : <p>No records yet. Launch discovery, or inject a fault from the header to observe detection and response. Selecting a stage does not run work.</p>}</div>
      <div className="pipeline-paging"><button className="mini-btn" disabled={stage === 0} onClick={() => setStage(stage - 1)}>Previous</button><button className="mini-btn" disabled={stage === steps.length - 1} onClick={() => setStage(stage + 1)}>Next stage</button></div>
    </section><section className="pipeline-record"><header><h2>Blackboard record</h2>{record?.path.startsWith('nodes/') && <button className="mini-btn" onClick={() => onInspect(record.path.slice(6))}>Inspect system</button>}</header><p>{record?.path ?? 'Waiting for evidence'}</p><pre>{record ? JSON.stringify(record.data, null, 2) : 'No record has been written for this stage.'}</pre></section></div>
    <OperationalSummary enabled={hostEnabled} />
  </div>;
}
