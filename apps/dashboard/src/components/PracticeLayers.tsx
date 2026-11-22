import { useState } from 'react';
import type { SystemLayer } from '@arsu/core';
import type { Board } from '../api';

const descriptions: Record<SystemLayer, string> = {
  infrastructure: 'Modeled hosts and process readiness. A running process does not prove that its messages are usable.',
  communications: 'Producer → broker → consumer. Inspect payload integrity, sequence continuity, and freshness before trusting delivery.',
  operations: 'The modeled release gate depends on trustworthy messages. Communication failures propagate into operational impact.',
};
export default function PracticeLayers({ board, onInspect }: { board: Board; onInspect: (id: string) => void }) {
  const [layer, setLayer] = useState<SystemLayer>('communications');
  const practice = board.practice;
  if (!practice) return null;
  const nodes = [...board.nodes.values()].filter(n => n.layer === layer);
  const channel = practice.communications;
  return <section className="practice-layers" aria-label="Three-layer practice environment">
    <header><span className="pipeline-eyebrow">PUBLIC-REFERENCE PRACTICE · MODELED TOPOLOGY</span><h2>{practice.title}</h2><p>In-process educational JSON replay. No connection to FAA systems, real NOTAM content, JMS middleware, or aircraft radios.</p></header>
    <nav className="practice-layer-tabs" aria-label="System layers">{practice.layers.map((id, i) => <button key={id} aria-pressed={id === layer} onClick={() => setLayer(id)}><small>LAYER {i + 1}</small><strong>{id}</strong><span>{[...board.nodes.values()].filter(n => n.layer === id).length} discovered components</span></button>)}</nav>
    <p>{descriptions[layer]}</p>
    <div className="practice-components">{nodes.map(n => <button key={n.id} onClick={() => onInspect(n.id)}><strong>{n.name}</strong><span>{n.health} · {n.provenance?.basis ?? 'unclassified'}</span><small>{[...board.invariants.values()].filter(i => i.node === n.id && i.lastResult === 'pass').length} / {[...board.invariants.values()].filter(i => i.node === n.id).length} checks passing</small></button>)}{!nodes.length && <p>Launch discovery to populate this layer from the checked-in service manifest.</p>}</div>
    {layer === 'communications' && <>
      <div className="practice-checks">{(['integrityOk', 'sequenceOk', 'freshnessOk'] as const).map(flag => <span key={flag} data-valid={channel[flag]}>{flag.replace('Ok', '')}<strong>{channel[flag] ? 'valid' : 'FAILED'}</strong></span>)}<span>Stream epoch<strong>{channel.epoch}</strong></span></div>
      <h3>Message receipts · {channel.published} published / {channel.received} delivered to validator</h3>
      <p>Only our replay harness omits or modifies deliveries. Sequence gaps are detected on the next arrival; duplicate sequences detect replay. SHA-256 checks payload corruption, not sender authenticity.</p>
      <div className="practice-receipts">{channel.receipts.slice().reverse().map(r => <details key={r.id}><summary><span>#{r.sequence} · epoch {r.epoch}</span><strong>{r.outcome}</strong><small>{r.payload.airport} · {new Date(r.receivedAt).toLocaleTimeString()}</small></summary><pre>{JSON.stringify(r, null, 2)}</pre></details>)}</div>
    </>}
    {layer === 'infrastructure' && practice.observer && <div className="practice-observer"><strong>Observed locally: ARSU host process only</strong><p>{practice.observer.uptimeSeconds}s uptime · {practice.observer.processMemoryMb} MB resident process memory · {practice.observer.logicalCpuCount} logical CPUs reported by the OS.</p><p>These measurements belong to the host running ARSU. The three modeled hosts are not separate machines or containers; their CPU utilization is not measured.</p></div>}
    <details className="practice-sources"><summary>Provenance · {practice.references.length} public references + repository manifest</summary><p>Service IDs, links, payloads, thresholds, and failure scenarios are our model. Public documents support the concepts below; they do not reveal a real network topology.</p><code>{practice.manifestPath}</code>{practice.references.map(ref => <article key={ref.id}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title}</a><p>{ref.fact}</p></article>)}</details>
  </section>;
}
