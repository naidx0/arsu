// Board state: one snapshot fetch, then WS diffs only (SPEC §5).

import { useEffect, useRef, useState } from "react";
import type {
  AgentDoc,
  EdgeDoc,
  EventDoc,
  FlightsPayload,
  InvariantDoc,
  MissionState,
  NodeDoc,
  SkillDoc,
  SpecDoc,
  StateSnapshot,
  TaskDoc,
  ViolationDoc,
  WsMessage,
} from "@arsu/core";

export interface Board {
  rehearsal?: StateSnapshot['rehearsal'];
  nodes: Map<string, NodeDoc>;
  edges: Map<string, EdgeDoc>;
  invariants: Map<string, InvariantDoc>;
  specs: Map<string, SpecDoc>;
  violations: Map<string, ViolationDoc>;
  agents: Map<string, AgentDoc>;
  tasks: Map<string, TaskDoc>;
  skills: Map<string, SkillDoc>;
  events: EventDoc[];
  flights: FlightsPayload;
  provider: string;
  mission: MissionState;
  connected: boolean;
}

const emptyBoard = (): Board => ({
  nodes: new Map(),
  edges: new Map(),
  invariants: new Map(),
  specs: new Map(),
  violations: new Map(),
  agents: new Map(),
  tasks: new Map(),
  skills: new Map(),
  events: [],
  flights: { flights: [], groundStop: false, staleFeed: false },
  provider: "…",
  mission: { launched: false },
  connected: false,
});

function fromSnapshot(s: StateSnapshot): Board {
  const b = emptyBoard();
  for (const n of s.nodes) b.nodes.set(n.id, n);
  for (const e of s.edges) b.edges.set(e.id, e);
  for (const i of s.invariants) b.invariants.set(i.id, i);
  for (const sp of s.specs) b.specs.set(sp.id, sp);
  for (const v of s.violations) b.violations.set(v.id, v);
  for (const a of s.agents) b.agents.set(a.id, a);
  for (const t of s.tasks) b.tasks.set(t.id, t);
  for (const k of s.skills) b.skills.set(k.id, k);
  b.events = (s.events ?? [])
    .slice()
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 300);
  b.flights = s.flights;
  b.provider = s.provider;
  b.mission = s.mission;
  b.rehearsal = s.rehearsal;
  return b;
}

const EVENT_CAP = 300;

export function useBoard(): Board {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const boardRef = useRef(board);
  boardRef.current = board;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let dead = false;
    let retry = 0;
    let socketSnapshotReceived = false;

    fetch("/api/state")
      .then((r) => r.json())
      .then((s: StateSnapshot) => {
        if (!dead && !socketSnapshotReceived)
          setBoard((previous) => ({
            ...fromSnapshot(s),
            connected: previous.connected,
          }));
      })
      .catch(() => {});

    const apply = (msg: WsMessage) => {
      setBoard((prev) => {
        const b: Board = { ...prev };
        const put = <T extends { id: string }>(
          key: keyof Pick<
            Board,
            | "nodes"
            | "edges"
            | "invariants"
            | "specs"
            | "violations"
            | "agents"
            | "tasks"
            | "skills"
          >,
          doc: T,
        ) => {
          const m = new Map(prev[key] as unknown as Map<string, T>);
          m.set(doc.id, doc);
          (b as unknown as Record<string, unknown>)[key] = m;
        };
        switch (msg.type) {
          case "rehearsal":
            b.rehearsal = msg.data;
            break;
          case "snapshot":
            socketSnapshotReceived = true;
            return { ...fromSnapshot(msg.data), connected: true };
          case "node":
            put("nodes", msg.data);
            break;
          case "edge":
            put("edges", msg.data);
            break;
          case "invariant":
            put("invariants", msg.data);
            break;
          case "spec":
            put("specs", msg.data);
            break;
          case "violation":
            put("violations", msg.data);
            break;
          case "agent":
            put("agents", msg.data);
            break;
          case "task":
            put("tasks", msg.data);
            break;
          case "skill":
            put("skills", msg.data);
            break;
          case "event":
            b.events = [msg.data, ...prev.events].slice(0, EVENT_CAP);
            if (
              msg.data.type === "mission" &&
              msg.data.msg.startsWith("mission launched")
            ) {
              b.mission = { launched: true, launchedAt: msg.data.ts };
            }
            if (
              msg.data.type === "mission" &&
              msg.data.msg.startsWith("reset —")
            ) {
              const empty = emptyBoard();
              return {
                ...empty,
                connected: prev.connected,
                provider: prev.provider,
                mission: prev.mission,
                flights: prev.flights,
                events: [msg.data],
              };
            }
            break;
          case "flight":
            b.flights = msg.data;
            break;
        }
        return b;
      });
    };

    const connect = () => {
      if (dead) return;
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      ws.onopen = () => {
        retry = 0;
        setBoard((p) => ({ ...p, connected: true }));
      };
      ws.onmessage = (ev) => apply(JSON.parse(ev.data as string) as WsMessage);
      ws.onclose = () => {
        setBoard((p) => ({ ...p, connected: false }));
        if (!dead) setTimeout(connect, Math.min(5000, 500 * ++retry));
      };
    };
    connect();

    return () => {
      dead = true;
      ws?.close();
    };
  }, []);

  return board;
}

export async function post(path: string, body?: object): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok)
    throw new Error(
      `Request failed (${response.status}): ${await response.text()}`,
    );
}
