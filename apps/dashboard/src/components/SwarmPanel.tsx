// SWARM — agent roster: role, state, claimed task, decision count.

import type { AgentDoc } from '@arsu/core';

export default function SwarmPanel({ agents }: { agents: Map<string, AgentDoc> }) {
  const list = [...agents.values()].sort((a, b) => a.id.localeCompare(b.id));
  return (
    <>
      <div className="panel-title">
        <span>SWARM</span>
        <span>{list.length} agents</span>
      </div>
      <div className="panel-body">
        {list.length === 0 && (
          <div className="empty">swarm offline — press LAUNCH SWARM</div>
        )}
        <div className="agent-grid">
          {list.map((a) => (
            <div className="agent-card" key={a.id}>
              <div className="role">{a.role}</div>
              <div className="aid">{a.id}</div>
              <div className={`astate ${a.state}`}>
                ● {a.state}
              </div>
              <div className="meta">
                {a.task ? `task ${a.task.slice(0, 14)}…` : 'no task'} ·{' '}
                {a.decisions} decisions
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
