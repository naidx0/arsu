import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { bestTier } from '../ai/brain';
import type { AiTier } from '../core/note';
import type { Lang } from '../data/protocol';
import { STRINGS } from '../i18n';
import { usePersonal } from '../store/personal';
import { shared, type Shared } from '../store/shared';

// ---- Route (hash based, so the app works from any path and offline) --------------------

const readRoute = () => window.location.hash.replace(/^#/, '') || '/';
const subscribeRoute = (listener: () => void) => { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); };
export const useRoute = () => useSyncExternalStore(subscribeRoute, readRoute);
export const go = (path: string) => { window.location.hash = path; window.scrollTo(0, 0); };
export const back = (fallback: string) => { if (window.history.length > 1) window.history.back(); else go(fallback); };

/** Demo runs never place a real call. Set by opening the app with ?demo. */
export const isDemoRun = () => new URLSearchParams(window.location.search).has('demo');

// ---- Connection ---------------------------------------------------------------------------

const subscribeOnline = (listener: () => void) => {
  window.addEventListener('online', listener); window.addEventListener('offline', listener);
  return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener); };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine);

// ---- Words ----------------------------------------------------------------------------------

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function translate(lang: Lang, key: string, values?: Record<string, string | number>): string {
  const entry = STRINGS[key];
  let text = entry ? entry[lang === 'fr' ? 1 : 0] : key;
  if (values) for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

export function useT(): { t: Translate; lang: Lang } {
  const lang = usePersonal().profile.lang;
  const t = useCallback<Translate>((key, values) => translate(lang, key, values), [lang]);
  return { t, lang };
}

// ---- Shared store and AI tier ---------------------------------------------------------------

export function useShared(): Shared | null {
  const [store, setStore] = useState<Shared | null>(null);
  useEffect(() => { let live = true; void shared().then(value => { if (live) setStore(value); }); return () => { live = false; }; }, []);
  return store;
}

export function useTier(): AiTier {
  const online = useOnline();
  const [tier, setTier] = useState<AiTier>('rules');
  useEffect(() => { let live = true; void bestTier().then(value => { if (live) setTier(value); }); return () => { live = false; }; }, [online]);
  return tier;
}

/** Which of this person's notes are still waiting for signal, and which a nurse has opened. */
export function useNoteStatus(ownerId: string): { pending: Set<string>; seen: Set<string> } {
  const store = useShared();
  const [status, setStatus] = useState({ pending: new Set<string>(), seen: new Set<string>() });
  useEffect(() => store?.watchPending(ownerId, (pending, seen) => setStatus({ pending, seen })), [store, ownerId]);
  return status;
}

export function timeAgo(time: number, lang: Lang, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - time) / 60000));
  const format = new Intl.RelativeTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { numeric: 'auto' });
  if (minutes < 60) return format.format(-minutes, 'minute');
  if (minutes < 60 * 24) return format.format(-Math.round(minutes / 60), 'hour');
  return format.format(-Math.round(minutes / 1440), 'day');
}
