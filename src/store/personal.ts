// Personal data. It lives on this device only and is never sent anywhere by this module.
import { useSyncExternalStore } from 'react';
import type { Medicine } from '../core/meds';
import type { Note, Profile } from '../core/note';
import type { PracticeScore } from '../core/signal';
import type { Lang } from '../data/protocol';
import type { Skill } from '../data/scripts';
import type { ThemeChoice } from '../theme';

export interface PracticeRecord extends PracticeScore { skill: Skill; at: number }

export interface Personal {
  profile: Profile;
  medicines: Medicine[];
  /** doses['2026-11-23']['<medicineId>@08:00'] = true */
  doses: Record<string, Record<string, boolean>>;
  practice: PracticeRecord[];
  /** Copies of the notes this person sent, newest first. */
  notes: Note[];
  pulses: { at: number; bpm: number }[];
  theme: ThemeChoice;
  /** Random, never leaves the device. Community keys are derived from it one way. */
  secret: string;
  ownerId: string;
  welcomed: boolean;
  /** Send anonymous community signals. On by default; explained at first run. */
  share: boolean;
}

const KEY = 'kin.personal.v1';
const random = () => crypto.randomUUID().replace(/-/g, '');

function initial(): Personal {
  const lang: Lang = navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en';
  return {
    profile: { name: '', area: 'East Side', allergies: '', conditions: '', contact: '', lang },
    medicines: [], doses: {}, practice: [], notes: [], pulses: [], theme: 'auto', secret: random(), ownerId: `local-${random().slice(0, 12)}`, welcomed: false, share: true,
  };
}

function stored(): Partial<Personal> | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Personal>) : null;
  } catch { return null; /* unreadable storage: start clean */ }
}

let state: Personal = { ...initial(), ...(stored() ?? {}) };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode or full: keep working in memory */ }
  notify();
}

// Another tab (the clinic view, a second window) may have written since this one loaded.
window.addEventListener('storage', event => {
  if (event.key !== KEY) return;
  state = { ...state, ...(stored() ?? {}) };
  notify();
});

export const personal = {
  get: () => state,
  set(change: Partial<Personal> | ((current: Personal) => Partial<Personal>)) {
    // Start from what is stored, so a change made here never overwrites another tab's newer data.
    state = { ...state, ...(stored() ?? {}) };
    state = { ...state, ...(typeof change === 'function' ? change(state) : change) };
    save();
  },
  reset() {
    const lang = state.profile.lang, theme = state.theme;
    state = { ...initial(), theme };
    state.profile.lang = lang;
    save();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function usePersonal(): Personal {
  return useSyncExternalStore(personal.subscribe, personal.get);
}

export const todayKey = (time = Date.now()) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
