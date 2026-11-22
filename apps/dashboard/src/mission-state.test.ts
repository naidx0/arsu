import assert from "node:assert/strict";
import { test } from "node:test";
import { missionStage, missionCondition } from "./mission-state";
import { showcaseBoard } from "./showcase";
import { routePoint } from "./geometry";

test("an unlaunched empty board is standby, not nominal", () => {
  const board = showcaseBoard();
  board.nodes.clear();
  board.invariants.clear();
  board.mission = { launched: false };
  assert.equal(missionStage(board), -1);
  assert.equal(missionCondition(board), "STANDBY");
});

test("partially evaluated proofs remain in verification", () => {
  const board = showcaseBoard();
  const inv = [...board.invariants.values()][0];
  board.invariants.set(inv.id, { ...inv, lastResult: undefined });
  assert.equal(missionStage(board), 2);
});

test("an escalated violation cannot be shown as restored", () => {
  const board = showcaseBoard();
  board.violations.set("failure", {
    id: "failure",
    node: "unimatic",
    invariant: "inv",
    detail: "still down",
    firstSeen: 0,
    lastSeen: 0,
    count: 2,
    status: "escalated",
  });
  assert.equal(missionStage(board), 4);
  assert.equal(missionCondition(board), "DEGRADED");
  board.violations.get("failure")!.status = "resolved";
  assert.equal(missionStage(board), 5);
  assert.equal(missionCondition(board), "NOMINAL");
});

test("showcase instances never share mutable fixture objects", () => {
  const first = showcaseBoard();
  const second = showcaseBoard();
  first.flights.flights[0].position.lat = 0;
  assert.notEqual(second.flights.flights[0].position.lat, 0);
});

test("great circle interpolation respects endpoints and the date line", () => {
  const from = { lat: 10, lon: 170 };
  const to = { lat: 10, lon: -170 };
  const start = routePoint(from, to, 0);
  const end = routePoint(from, to, 1);
  assert.ok(Math.abs(start[0] - from.lon) < 1e-8);
  assert.ok(Math.abs(end[0] - to.lon) < 1e-8);
  const mid = routePoint(from, to, 0.5);
  assert.ok(Math.abs(Math.abs(mid[0]) - 180) < 1e-8);
  assert.ok(mid[1] > 10);
});
