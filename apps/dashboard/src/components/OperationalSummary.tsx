import { useEffect, useRef, useState } from 'react';
import type { OperationalSummary as Summary } from '@arsu/core';

export default function OperationalSummary({ enabled }: { enabled: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setSummary(null);
    setError('');
    setBusy(false);
    return () => request.current?.abort();
  }, [enabled]);
  async function generate() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/summary', { method: 'POST', signal: controller.signal });
      if (!response.ok) throw new Error('Summary unavailable. Check the host connection and try again.');
      const result = await response.json() as Summary;
      if (!controller.signal.aborted) setSummary(result);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Summary unavailable');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <section className="operational-summary" aria-label="Operational assistant">
    <header><div><span className="pipeline-eyebrow">OPERATIONAL ASSISTANT</span><h2>{summary ? `${summary.provider.toUpperCase()} assessment` : 'Mission briefing'}</h2></div>
      <button className="mini-btn" disabled={!enabled || busy} onClick={generate}>{busy ? 'Assessing…' : summary ? 'Refresh summary' : 'Generate summary'}</button></header>
    {!enabled ? <p>Connect to the host and leave local example mode to summarize the actual Blackboard.</p> : summary ? <>
      <p className="summary-headline">{summary.headline}</p>
      {summary.risks.length > 0 && <ul>{summary.risks.map((risk, i) => <li key={i}>{risk}</li>)}</ul>}
      <p><strong>Next action</strong> · {summary.nextAction}</p>
      <details><summary>Evidence · {summary.evidence.length} records</summary>{summary.evidence.map(path => <code key={path}>{path}</code>)}</details>
      <footer>Generated {new Date(summary.generatedAt).toLocaleTimeString()} · advisory only · cached up to 20s · simulation health</footer>
    </> : <p>Assess current checks, unresolved incidents, and flight-feed flags. No actions are executed.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
