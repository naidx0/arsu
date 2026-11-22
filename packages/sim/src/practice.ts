import type { PracticeSnapshot, PublicReference, RehearsalState, ServiceInfo, SystemLayer } from '@arsu/core';

export const PRACTICE_MANIFEST = 'packages/sim/src/practice.ts';
export const PRACTICE_REFERENCES: PublicReference[] = [
  { id: 'faa-sfdps', title: 'FAA: SWIM Flight Data Publication Service', url: 'https://www.faa.gov/air_traffic/technology/swim/sfdps', fact: 'SFDPS transforms en-route data into SWIM-compliant XML and distributes it through enterprise messaging to authorized consumers. This supports the producer/distribution/consumer concept, not our modeled host layout.' },
  { id: 'faa-jms', title: 'FAA: SWIM JMS developer workshop', url: 'https://www.faa.gov/media/19536', fact: 'FAA SWIM uses JMS publish/subscribe patterns. JMS is an API; our educational replay does not implement that API or its underlying transport.' },
  { id: 'asterix-cat021', title: 'EUROCONTROL: ASTERIX CAT021 edition 2.7', url: 'https://www.eurocontrol.int/publication/cat021-eurocontrol-specification-surveillance-data-exchange-asterix-part-12-category-21', fact: 'CAT021 specifies ADS-B target-report structures. It is a surveillance reference only; this lab does not decode CAT021 or equate surveillance reports with NOTAMs.' },
  { id: 'compose-health', title: 'Docker: service startup and readiness', url: 'https://docs.docker.com/compose/how-tos/startup-order/', fact: 'Starting a process is not the same as readiness. Compose can gate dependencies on health checks. This lab models that distinction without launching Docker containers.' },
];

const component = (id: string, name: string, kind: ServiceInfo['kind'], layer: SystemLayer, deps: string[], description: string, sourceIds: string[], standby?: string): ServiceInfo => ({
  id, name, kind, layer, deps, description, ...(standby ? { standby } : {}),
  provenance: { basis: 'modeled', manifestPath: PRACTICE_MANIFEST, sourceIds },
});

export const PRACTICE_SERVICES: ServiceInfo[] = [
  component('gateway-host', 'Gateway host', 'store', 'infrastructure', [], 'Modeled host for the notice publisher; not an actual FAA server.', ['compose-health']),
  component('broker-host', 'Broker host', 'store', 'infrastructure', [], 'Modeled messaging host. Host liveness is not sufficient to prove valid delivery.', ['compose-health']),
  component('consumer-host', 'Consumer host', 'store', 'infrastructure', [], 'Modeled consumer host, separate from observed ARSU process telemetry.', ['compose-health']),
  component('notam-source', 'Notice publisher', 'feed', 'communications', ['gateway-host'], 'Publishes synthetic aeronautical notices using a public-reference producer pattern. Not a real SWIM or NOTAM feed.', ['faa-sfdps', 'faa-jms']),
  component('broker-standby', 'Broker standby', 'store', 'communications', ['consumer-host'], 'Modeled standby on a different modeled host; no claim about FAA redundancy.', ['compose-health']),
  component('message-broker', 'Message broker', 'hub', 'communications', ['broker-host', 'notam-source'], 'Modeled distribution broker. Actual replay is in-process educational JSON, not JMS.', ['faa-jms'], 'broker-standby'),
  component('message-consumer', 'Message consumer', 'worker', 'communications', ['consumer-host', 'message-broker'], 'Validates payload checksum, sequence continuity, and 5-second freshness. Faults latch until repair starts a new stream epoch.', ['faa-sfdps', 'faa-jms']),
  component('release-gate', 'Release decision', 'worker', 'operations', ['message-consumer'], 'Modeled operational gate: invalid or stale notices block the simulated release decision. Not certified dispatch logic.', ['faa-sfdps']),
];

export const PRACTICE_SCENARIOS: RehearsalState['scenarios'] = [
  { id: 'payload-corruption', title: 'Change a message payload', fault: { type: 'packet_corrupt', target: 'message-consumer' } },
  { id: 'sequence-gap', title: 'Omit deliveries and detect sequence gaps', fault: { type: 'packet_drop', target: 'message-consumer' } },
  { id: 'message-replay', title: 'Replay an already received message', fault: { type: 'packet_replay', target: 'message-consumer' } },
  { id: 'stale-message', title: 'Deliver an expired message', fault: { type: 'packet_stale', target: 'message-consumer' } },
];

export const PRACTICE_IDENTITY: Omit<PracticeSnapshot, 'communications'> = {
  id: 'communications-lab', title: 'Three-layer aviation communications lab', manifestPath: PRACTICE_MANIFEST,
  layers: ['infrastructure', 'communications', 'operations'], references: PRACTICE_REFERENCES,
};
