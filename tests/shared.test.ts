import { describe, expect, it } from 'vitest';
import type { Note } from '../src/core/note';
import { deliver, sampleWeek, type Queued } from '../src/store/shared';
import { clusters, readiness } from '../src/core/community';

const note = (id: string) => ({ id, ownerId: 'u', createdAt: 1 }) as Note;
const outbox: Queued[] = [
  { kind: 'note', value: note('a') },
  { kind: 'signal', value: { area: 'East Side', group: 'respiratory', day: '2026-11-23', key: 'k1' } },
  { kind: 'training', value: { area: 'East Side', skill: 'cpr', day: '2026-11-23', key: 'k2' } },
];

describe('delivering the outbox', () => {
  it('moves each queued item into the shared data', () => {
    const data = deliver({ notes: [note('old')], signals: [], training: [] }, outbox);
    expect(data.notes.map(item => item.id)).toEqual(['a', 'old']);
    expect(data.signals).toHaveLength(1);
    expect(data.training).toHaveLength(1);
  });
  it('changes nothing when the same outbox is delivered again by another tab', () => {
    const once = deliver({ notes: [], signals: [], training: [] }, outbox);
    expect(deliver(once, outbox)).toEqual(once);
  });
  it('keeps two different notes and two different households apart', () => {
    const data = deliver({ notes: [], signals: [], training: [] }, [...outbox, { kind: 'note', value: note('b') }, { kind: 'signal', value: { area: 'East Side', group: 'respiratory', day: '2026-11-23', key: 'other' } }]);
    expect(data.notes).toHaveLength(2);
    expect(data.signals).toHaveLength(2);
  });
});

describe('sample month', () => {
  const today = Date.parse('2026-11-23T12:00:00Z');
  const { signals, training } = sampleWeek(today);
  it('is marked as sample on every row', () => {
    expect([...signals, ...training].every(item => item.key.startsWith('sample-'))).toBe(true);
  });
  it('shows exactly one cluster, on the East Side', () => {
    const flagged = clusters(signals, '2026-11-23').filter(cluster => cluster.flagged);
    expect(flagged.map(cluster => `${cluster.area}/${cluster.group}`)).toEqual(['East Side/respiratory']);
  });
  it('has trained households in every area', () => {
    expect(Object.keys(readiness(training, '2026-11-23'))).toHaveLength(5);
  });
});
