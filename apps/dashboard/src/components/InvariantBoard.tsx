// INVARIANTS — the proof board. Green/amber/red, last-run detail,
// authoring agent. Fails sort to the top.

import type { InvariantDoc } from '@arsu/core';

export default function InvariantBoard({
  invariants,
}: {
  invariants: Map<string, InvariantDoc>;
}) {
  const rows = [...invariants.values()].sort((a, b) => {
    const rank = (i: InvariantDoc) =>
      i.lastResult === 'fail' ? 0 : i.lastResult === 'pass' ? 2 : 1;
    return rank(a) - rank(b) || a.id.localeCompare(b.id);
  });
  const failing = rows.filter((i) => i.lastResult === 'fail').length;

  return (
    <>
      <div className="panel-title">
        <span>INVARIANTS</span>
        <span>
          {rows.length === 0
            ? '—'
            : failing > 0
              ? `${failing} FAILING / ${rows.length}`
              : `${rows.length} GREEN`}
        </span>
      </div>
      <div className="panel-body">
        {rows.length === 0 && (
          <div className="empty">no proofs authored — verify agents write these</div>
        )}
        {rows.map((i) => (
          <div className="inv-row" key={i.id} title={`${i.id} · by ${i.authoredBy}`}>
            <span className={`dot ${i.lastResult ?? 'idle'}`} />
            <span className="inv-kind">
              {i.node} · {i.kind}
            </span>
            <span className="inv-runs">{i.runs} runs</span>
            <span className="inv-detail">{i.lastDetail ?? '—'}</span>
            <span className="inv-runs">{i.intervalMs / 1000}s</span>
          </div>
        ))}
      </div>
    </>
  );
}
