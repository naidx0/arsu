// CHAOS BAR — the demo operator's buttons. Chaos is the operator plane;
// /sim/action stays agent-only.

import { post } from '../api';
import type { MissionState } from '@arsu/core';

const CHAOS: { label: string; body: object }[] = [
  { label: 'kill unimatic', body: { type: 'kill', target: 'unimatic' } },
  {
    label: 'degrade weight-balance',
    body: { type: 'degrade', target: 'weight-balance' },
  },
  {
    label: 'cut dispatch→notam',
    body: { type: 'cut_dep', target: 'dispatch', dep: 'notam' },
  },
  { label: 'corrupt pax-connect', body: { type: 'corrupt', target: 'pax-connect' } },
];

export default function ChaosBar({
  provider,
  connected,
  mission,
}: {
  provider: string;
  connected: boolean;
  mission: MissionState;
}) {
  return (
    <header className="topbar">
      <span className="brand">ARSU</span>
      <span className={`badge ${provider === 'gemini' ? 'gemini' : 'sim'}`}>
        {provider === 'gemini' ? 'GEMINI' : 'SIM'}
      </span>
      <span className={`badge ${connected ? 'ws-on' : 'ws-off'}`}>
        {connected ? 'WS LIVE' : 'WS DOWN'}
      </span>
      {mission.launched && <span className="badge mission">MISSION</span>}
      <span className="spacer" />
      <button className="launch" onClick={() => post('/api/launch')}>
        ▶ launch swarm
      </button>
      {CHAOS.map((c) => (
        <button
          key={c.label}
          className="chaos"
          onClick={() => post('/api/chaos', c.body)}
        >
          {c.label}
        </button>
      ))}
      <button className="reset" onClick={() => post('/api/reset')}>
        reset
      </button>
    </header>
  );
}
