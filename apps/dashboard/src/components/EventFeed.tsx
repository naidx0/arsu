// FEED — the events stream. Timestamped, severity-filtered.

import { useState } from 'react';
import type { EventDoc, Severity } from '@arsu/core';

const FILTERS: (Severity | 'all')[] = ['all', 'info', 'warn', 'crit'];

function ts(t: number): string {
  const d = new Date(t);
  return d.toTimeString().slice(0, 8);
}

export default function EventFeed({ events }: { events: EventDoc[] }) {
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const shown = events.filter((e) => filter === 'all' || e.severity === filter);
  return (
    <>
      <div className="panel-title">
        <span>EVENT FEED</span>
        <span className="feed-filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={
                filter === f
                  ? { color: 'var(--green)', borderColor: 'var(--green)' }
                  : undefined
              }
            >
              {f}
            </button>
          ))}
        </span>
      </div>
      <div className="panel-body">
        {shown.length === 0 && <div className="empty">feed quiet</div>}
        {shown.map((e) => (
          <div className={`feed-row ${e.severity}`} key={e.id}>
            <span className="feed-ts">{ts(e.ts)}</span>
            <span className={`feed-sev ${e.severity}`}>{e.severity.toUpperCase()}</span>
            <span className="feed-actor">{e.actor}</span>
            <span className="feed-msg" title={e.msg}>
              {e.msg}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
