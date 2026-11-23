// Shared data: notes for the clinic and anonymous community signals.
//
// Two implementations behind one interface. With Firebase configured, Cloud Firestore
// carries everything and its offline queue delivers what was written without signal.
// With nothing configured, the same behaviour runs on this device (an outbox that empties
// when the connection returns), so the whole product can be tried with no account.
import type { Signal, Training } from '../core/community';
import type { Note } from '../core/note';

export interface Shared {
  mode: 'demo' | 'firestore';
  /** Resolves once the note is safely queued. Delivery may happen later. */
  sendNote(note: Note): Promise<void>;
  addSignals(signals: Signal[]): Promise<void>;
  addTraining(training: Training): Promise<void>;
  /** Ids of this person's notes that have not reached the shared store yet. */
  watchPending(ownerId: string, onChange: (pendingIds: Set<string>, seenIds: Set<string>) => void): () => void;
  /** Clinic side. */
  watchNotes(onChange: (notes: Note[]) => void, onError?: (error: Error) => void): () => void;
  watchSignals(onChange: (signals: Signal[]) => void): () => void;
  watchTraining(onChange: (training: Training[]) => void): () => void;
  markSeen(id: string): Promise<void>;
  /** Clinic sign-in. Demo mode has none. */
  clinicAccess(): Promise<{ ok: boolean; uid?: string; reason?: 'signed-out' | 'not-listed' }>;
  signIn?(): Promise<void>;
}

export type Queued = { kind: 'note'; value: Note } | { kind: 'signal'; value: Signal } | { kind: 'training'; value: Training };

const KEYS = { notes: 'kin.shared.notes', signals: 'kin.shared.signals', training: 'kin.shared.training', outbox: 'kin.outbox' } as const;

function read<T>(key: string): T[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') as T[]; } catch { return []; }
}
function write(key: string, value: unknown[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export interface SharedData { notes: Note[]; signals: Signal[]; training: Training[] }
const signalId = (item: Signal | Training) => `${item.area}|${'group' in item ? item.group : item.skill}|${item.day}|${item.key}`;

/**
 * Moves queued items into the shared data. Delivering the same outbox twice changes nothing:
 * two tabs can both come back online and each try to deliver it.
 */
export function deliver(data: SharedData, outbox: Queued[]): SharedData {
  const notes = [...data.notes], signals = [...data.signals], training = [...data.training];
  const noteIds = new Set(notes.map(note => note.id)), signalIds = new Set(signals.map(signalId)), trainingIds = new Set(training.map(signalId));
  for (const item of outbox) {
    if (item.kind === 'note') { if (!noteIds.has(item.value.id)) { noteIds.add(item.value.id); notes.unshift(item.value); } }
    else if (item.kind === 'signal') { if (!signalIds.has(signalId(item.value))) { signalIds.add(signalId(item.value)); signals.push(item.value); } }
    else if (!trainingIds.has(signalId(item.value))) { trainingIds.add(signalId(item.value)); training.push(item.value); }
  }
  return { notes, signals, training };
}

/** On-device stand-in for Firestore. Other tabs see changes through storage events. */
export function demoShared(): Shared {
  const listeners = new Set<() => void>();
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('kin') : null;
  const announce = () => { listeners.forEach(listener => listener()); channel?.postMessage('changed'); };
  const hear = () => listeners.forEach(listener => listener());
  channel?.addEventListener('message', hear);
  window.addEventListener('storage', hear);

  const flush = () => {
    if (!navigator.onLine) return;
    const outbox = read<Queued>(KEYS.outbox);
    if (!outbox.length) return;
    const merged = deliver({ notes: read<Note>(KEYS.notes), signals: read<Signal>(KEYS.signals), training: read<Training>(KEYS.training) }, outbox);
    write(KEYS.notes, merged.notes.slice(0, 200));
    write(KEYS.signals, merged.signals.slice(-4000));
    write(KEYS.training, merged.training.slice(-4000));
    write(KEYS.outbox, []);
    announce();
  };
  window.addEventListener('online', flush);
  window.addEventListener('offline', announce);
  flush();

  const queue = (items: Queued[]) => { write(KEYS.outbox, [...read<Queued>(KEYS.outbox), ...items]); announce(); flush(); };
  const watch = <T,>(key: string, onChange: (value: T[]) => void) => {
    const listener = () => onChange(read<T>(key));
    listeners.add(listener);
    listener();
    return () => { listeners.delete(listener); };
  };

  return {
    mode: 'demo',
    async sendNote(note) { queue([{ kind: 'note', value: note }]); },
    async addSignals(signals) { queue(signals.map(value => ({ kind: 'signal' as const, value }))); },
    async addTraining(training) { queue([{ kind: 'training', value: training }]); },
    watchPending(ownerId, onChange) {
      const listener = () => {
        const pending = new Set(read<Queued>(KEYS.outbox).filter(item => item.kind === 'note' && item.value.ownerId === ownerId).map(item => (item.value as Note).id));
        const seen = new Set(read<Note>(KEYS.notes).filter(note => note.ownerId === ownerId && note.status === 'seen').map(note => note.id));
        onChange(pending, seen);
      };
      listeners.add(listener);
      listener();
      return () => { listeners.delete(listener); };
    },
    watchNotes: onChange => watch<Note>(KEYS.notes, onChange),
    watchSignals: onChange => watch<Signal>(KEYS.signals, onChange),
    watchTraining: onChange => watch<Training>(KEYS.training, onChange),
    async markSeen(id) {
      write(KEYS.notes, read<Note>(KEYS.notes).map(note => (note.id === id ? { ...note, status: 'seen' as const } : note)));
      announce();
    },
    async clinicAccess() { return { ok: true }; },
  };
}

/** Sample community history for the clinic view. Always labelled as sample data on screen. */
export function sampleWeek(today: number): { signals: Signal[]; training: Training[] } {
  const day = (ago: number) => new Date(today - ago * 86_400_000).toISOString().slice(0, 10);
  const signals: Signal[] = [];
  const add = (area: string, group: Signal['group'], ago: number, count: number, tag: string) => {
    for (let i = 0; i < count; i++) signals.push({ area, group, day: day(ago), key: `sample-${tag}-${area}-${group}-${ago}-${i}` });
  };
  // A quiet month everywhere, then a respiratory jump on the East Side this week.
  for (const area of ['East Side', 'Lakeshore', 'Hilltop', 'Old Town', 'North Road']) {
    for (const ago of [25, 18, 11]) { add(area, 'respiratory', ago, 1, 'base'); if (area !== 'Hilltop') add(area, 'stomach', ago + 1, 1, 'base'); }
  }
  [[6, 1], [5, 1], [4, 2], [3, 2], [2, 2], [1, 3]].forEach(([ago, count]) => add('East Side', 'respiratory', ago, count, 'jump'));
  add('Lakeshore', 'respiratory', 3, 2, 'now');
  add('Old Town', 'stomach', 2, 2, 'now');
  add('Hilltop', 'fever', 4, 1, 'now');
  const training: Training[] = [];
  const trained: Record<string, number> = { 'East Side': 9, Lakeshore: 14, Hilltop: 4, 'Old Town': 11, 'North Road': 6 };
  for (const [area, count] of Object.entries(trained)) for (let i = 0; i < count; i++) training.push({ area, skill: 'cpr', day: day(10 + i * 9), key: `sample-${area}-${i}` });
  return { signals, training };
}

export function loadSample(today = Date.now()) {
  const { signals, training } = sampleWeek(today);
  write(KEYS.signals, [...read<Signal>(KEYS.signals).filter(item => !item.key.startsWith('sample-')), ...signals]);
  write(KEYS.training, [...read<Training>(KEYS.training).filter(item => !item.key.startsWith('sample-')), ...training]);
  window.dispatchEvent(new StorageEvent('storage'));
}

export function clearSample() {
  write(KEYS.signals, read<Signal>(KEYS.signals).filter(item => !item.key.startsWith('sample-')));
  write(KEYS.training, read<Training>(KEYS.training).filter(item => !item.key.startsWith('sample-')));
  window.dispatchEvent(new StorageEvent('storage'));
}

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};
export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let instance: Promise<Shared> | null = null;
/** The shared store for this build. Firebase is only downloaded when it is configured. */
export function shared(): Promise<Shared> {
  instance ??= firebaseReady ? import('./firestore').then(module => module.firestoreShared()).catch(() => demoShared()) : Promise.resolve(demoShared());
  return instance;
}
