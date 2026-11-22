import { useBoard } from './api';
import ChaosBar from './components/ChaosBar';
import EventFeed from './components/EventFeed';
import InvariantBoard from './components/InvariantBoard';
import OntologyGraph from './components/OntologyGraph';
import OpsMap from './components/OpsMap';
import SwarmPanel from './components/SwarmPanel';

export default function App() {
  const board = useBoard();
  return (
    <div className="app">
      <ChaosBar
        provider={board.provider}
        connected={board.connected}
        mission={board.mission}
      />
      <div className="main">
        <section className="panel">
          <div className="panel-title">
            <span>LIVE OPS MAP</span>
            <span>
              {board.flights.flights.filter((f) => f.status === 'enroute').length}{' '}
              enroute
            </span>
          </div>
          <OpsMap flights={board.flights} nodes={board.nodes} />
        </section>
        <div className="rightcol">
          <section className="panel">
            <div className="panel-title">
              <span>ONTOLOGY</span>
              <span>
                {board.nodes.size} nodes · {board.edges.size} edges
              </span>
            </div>
            <OntologyGraph
              nodes={board.nodes}
              edges={board.edges}
              violations={board.violations}
            />
          </section>
          <section className="panel">
            <InvariantBoard invariants={board.invariants} />
          </section>
        </div>
      </div>
      <div className="bottom">
        <section className="panel">
          <SwarmPanel agents={board.agents} />
        </section>
        <section className="panel">
          <EventFeed events={board.events} />
        </section>
      </div>
    </div>
  );
}
