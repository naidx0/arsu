// ONTOLOGY — d3-force graph of nodes/edges, colored by effective health.
// Nodes with open violations pulse.

import { useEffect, useRef, useState } from 'react';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { EdgeDoc, NodeDoc, ViolationDoc } from '@arsu/core';

interface SimNode extends SimulationNodeDatum {
  id: string;
  doc: NodeDoc;
}

const HEALTH_COLOR: Record<string, string> = {
  up: '#39ff6a',
  degraded: '#ffb000',
  down: '#ff3355',
};

const KIND_R: Record<string, number> = { hub: 14, worker: 10, feed: 10, store: 9 };

export default function OntologyGraph({
  nodes,
  edges,
  violations,
}: {
  nodes: Map<string, NodeDoc>;
  edges: Map<string, EdgeDoc>;
  violations: Map<string, ViolationDoc>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<
    { source: SimNode; target: SimNode }[]
  >([]);

  const violated = new Set(
    [...violations.values()]
      .filter((v) => ['open', 'triaged', 'remediating'].includes(v.status))
      .map((v) => v.node),
  );

  useEffect(() => {
    const el = ref.current;
    const w = el?.clientWidth ?? 600;
    const h = el?.clientHeight ?? 400;
    const sns: SimNode[] = [...nodes.values()].map((doc) => ({
      id: doc.id,
      doc,
      x: w / 2 + (Math.random() - 0.5) * 80,
      y: h / 2 + (Math.random() - 0.5) * 80,
    }));
    const byId = new Map(sns.map((n) => [n.id, n]));
    const lks: SimulationLinkDatum<SimNode>[] = [...edges.values()]
      .filter((e) => byId.has(e.from) && byId.has(e.to))
      .map((e) => ({ source: e.from, target: e.to }));

    const sim = forceSimulation(sns)
      .force(
        'link',
        forceLink<SimNode, SimulationLinkDatum<SimNode>>(lks)
          .id((n) => n.id)
          .distance(90),
      )
      .force('charge', forceManyBody().strength(-260))
      .force('center', forceCenter(w / 2, h / 2))
      .alphaDecay(0.02)
      .on('tick', () => {
        setSimNodes([...sns]);
        setLinks([...lks] as { source: SimNode; target: SimNode }[]);
      });
    return () => {
      sim.stop();
    };
    // rebuild when the graph shape changes, not on health ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...nodes.keys()].join(','), [...edges.keys()].join(',')]);

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      <svg width="100%" height="100%">
        {links.map((l, i) => (
          <line
            key={i}
            className="onto-edge"
            x1={l.source.x}
            y1={l.source.y}
            x2={l.target.x}
            y2={l.target.y}
          />
        ))}
        {simNodes.map((n) => {
          const live = nodes.get(n.id);
          return (
            <g
              key={n.id}
              className={`onto-node ${violated.has(n.id) ? 'violated' : ''}`}
              transform={`translate(${n.x},${n.y})`}
            >
              <circle
                r={KIND_R[live?.kind ?? 'worker'] ?? 10}
                fill={HEALTH_COLOR[live?.health ?? 'down'] ?? '#5f7a66'}
              />
              <text y={(KIND_R[live?.kind ?? 'worker'] ?? 10) + 12}>
                {n.id}
              </text>
            </g>
          );
        })}
      </svg>
      {simNodes.length === 0 && (
        <div className="empty">no ontology yet — launch the swarm</div>
      )}
    </div>
  );
}
