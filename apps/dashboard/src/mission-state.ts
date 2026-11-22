import type { Board } from "./api";

export function missionStage(board: Board): number {
  const checks = [...board.invariants.values()];
  if ([...board.violations.values()].some((v) => v.status !== "resolved"))
    return 4;
  if (
    board.violations.size > 0 &&
    checks.length > 0 &&
    checks.every((i) => i.lastResult === "pass")
  )
    return 5;
  if (checks.length > 0 && checks.every((i) => i.lastResult === "pass"))
    return 3;
  if (board.nodes.size > 0) return checks.length ? 2 : 1;
  return board.mission.launched ? 0 : -1;
}

export function missionCondition(
  board: Board,
): "STANDBY" | "DEGRADED" | "NOMINAL" | "VERIFYING" {
  if (board.nodes.size === 0) return "STANDBY";
  if (
    [...board.violations.values()].some((v) => v.status !== "resolved") ||
    [...board.nodes.values()].some((n) => n.health !== "up")
  )
    return "DEGRADED";
  const checks = [...board.invariants.values()];
  return checks.length && checks.every((i) => i.lastResult === "pass")
    ? "NOMINAL"
    : "VERIFYING";
}
