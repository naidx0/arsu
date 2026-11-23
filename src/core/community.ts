// The community view: counts anonymous signals by area and says where a cluster is forming.
// Signals carry an area, a symptom group, a day and a weekly rotating key. Nothing else.
import type { Group } from '../data/protocol';

export interface Signal { area: string; group: Group; day: string; key: string }
export interface Training { area: string; skill: string; day: string; key: string }

export interface Cluster {
  area: string;
  group: Group;
  /** Distinct households in the last 7 days. */
  thisWeek: number;
  /** Mean distinct households per week over the three weeks before. */
  earlier: number;
  flagged: boolean;
  /** Distinct households on each of the last 14 days, oldest first. */
  daily: number[];
}

export const CLUSTER_MIN = 5;
export const CLUSTER_RATIO = 3;

const DAY = 86_400_000;
export const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);
const daysAgo = (day: string, today: string) => Math.round((Date.parse(today) - Date.parse(day)) / DAY);

export function clusters(signals: Signal[], today: string): Cluster[] {
  const cells = new Map<string, Signal[]>();
  for (const signal of signals) {
    const id = `${signal.area}|${signal.group}`;
    cells.set(id, [...(cells.get(id) ?? []), signal]);
  }
  const result: Cluster[] = [];
  for (const [id, list] of cells) {
    const [area, group] = id.split('|') as [string, Group];
    const distinct = (from: number, to: number) => new Set(list.filter(signal => { const age = daysAgo(signal.day, today); return age >= from && age <= to; }).map(signal => signal.key)).size;
    const thisWeek = distinct(0, 6);
    const earlier = (distinct(7, 13) + distinct(14, 20) + distinct(21, 27)) / 3;
    const daily = Array.from({ length: 14 }, (_, i) => distinct(13 - i, 13 - i));
    result.push({ area, group, thisWeek, earlier: Math.round(earlier * 10) / 10, daily, flagged: thisWeek >= CLUSTER_MIN && thisWeek >= CLUSTER_RATIO * earlier });
  }
  return result.sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.thisWeek - a.thisWeek);
}

/** Households with a practice session in the last 365 days, by area. */
export function readiness(training: Training[], today: string, skill = 'cpr'): Record<string, number> {
  const byArea = new Map<string, Set<string>>();
  for (const item of training) {
    const age = daysAgo(item.day, today);
    if (item.skill !== skill || age < 0 || age > 365) continue;
    byArea.set(item.area, (byArea.get(item.area) ?? new Set()).add(item.key));
  }
  return Object.fromEntries([...byArea].map(([area, keys]) => [area, keys.size]));
}

/**
 * A key that lets the clinic count households inside one period without linking periods
 * together: 7 days for symptom signals, 365 for training.
 */
export function rotatingKey(deviceSecret: string, time: number, periodDays: number): string {
  const period = Math.floor(time / (periodDays * DAY));
  let hash = 2166136261;
  for (const char of `${deviceSecret}:${periodDays}:${period}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
}
