// Cloud Firestore implementation of the shared store. Loaded only when Firebase is configured.
// Offline behaviour is Firestore's own: writes are kept in the device cache and delivered
// when the connection returns.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { GoogleAuthProvider, getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, type User } from 'firebase/auth';
import { collection, doc, getDoc, initializeFirestore, limit, onSnapshot, orderBy, persistentLocalCache, persistentMultipleTabManager, query, setDoc, updateDoc, where } from 'firebase/firestore';
import type { Signal, Training } from '../core/community';
import type { Note } from '../core/note';
import { personal } from './personal';
import { firebaseConfig, type Shared } from './shared';

// reCAPTCHA v3 site key for Firebase App Check. A site key is public by design; App Check
// is enforced for Firebase AI Logic, so Gemini requests without a token are rejected.
const RECAPTCHA_SITE_KEY = (import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined) || '6LfY8jUuAAAAAAPpgHTjxDM4cdkD99gL6d81k11b';

let appInstance: FirebaseApp | null = null;
export function firebaseApp(): FirebaseApp {
  if (!appInstance) {
    appInstance = initializeApp(firebaseConfig);
    if (RECAPTCHA_SITE_KEY) {
      try {
        initializeAppCheck(appInstance, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
      } catch { /* App Check unavailable: Gemini falls back to the on-device tiers */ }
    }
  }
  return appInstance;
}

const HELD = 'kin.fs.held';
type Held = { path: string; id: string; value: object };

export function firestoreShared(): Shared {
  const app = firebaseApp();
  const auth = getAuth(app);
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const id = () => doc(collection(db, 'x')).id;

  // A person is signed in anonymously the first time the phone is online. Until then
  // anything they send is held on the device.
  const user = new Promise<User>(resolve => {
    const stop = onAuthStateChanged(auth, current => { if (current) { stop(); resolve(current); } });
  });
  const trySignIn = () => { if (!auth.currentUser && navigator.onLine) signInAnonymously(auth).catch(() => undefined); };
  trySignIn();
  window.addEventListener('online', trySignIn);

  const held = (): Held[] => { try { return JSON.parse(localStorage.getItem(HELD) ?? '[]') as Held[]; } catch { return []; } };
  const heldListeners = new Set<() => void>();
  const setHeld = (items: Held[]) => { localStorage.setItem(HELD, JSON.stringify(items)); heldListeners.forEach(listener => listener()); };
  const put = (path: string, docId: string, value: object) => {
    const current = auth.currentUser;
    if (!current) { setHeld([...held(), { path, id: docId, value }]); return; }
    const owned = path === 'notes' ? { ...value, ownerId: current.uid } : value;
    // Not awaited: offline, this promise settles only when the server confirms.
    void setDoc(doc(db, path, docId), owned).catch(() => undefined);
  };
  void user.then(current => {
    if (personal.get().ownerId !== current.uid && !current.isAnonymous) return;
    if (current.isAnonymous) personal.set({ ownerId: current.uid });
    const waiting = held();
    setHeld([]);
    waiting.forEach(item => put(item.path, item.id, item.value));
  });

  return {
    mode: 'firestore',
    async sendNote(note) { put('notes', note.id, stripLocal(note)); },
    async addSignals(signals) { signals.forEach(signal => put('signals', id(), signal)); },
    async addTraining(training) { put('training', id(), training); },
    watchPending(_ownerId, onChange) {
      let pending = new Set<string>(), seen = new Set<string>();
      const emit = () => onChange(new Set([...pending, ...held().filter(item => item.path === 'notes').map(item => item.id)]), seen);
      heldListeners.add(emit);
      emit();
      let stop = () => {};
      let cancelled = false;
      void user.then(current => {
        if (cancelled) return;
        stop = onSnapshot(query(collection(db, 'notes'), where('ownerId', '==', current.uid)), { includeMetadataChanges: true }, snapshot => {
          pending = new Set(snapshot.docs.filter(item => item.metadata.hasPendingWrites).map(item => item.id));
          seen = new Set(snapshot.docs.filter(item => item.get('status') === 'seen').map(item => item.id));
          emit();
        }, () => undefined);
      });
      return () => { cancelled = true; heldListeners.delete(emit); stop(); };
    },
    watchNotes(onChange, onError) {
      return onSnapshot(query(collection(db, 'notes'), orderBy('createdAt', 'desc'), limit(200)), snapshot => onChange(snapshot.docs.map(item => ({ ...(item.data() as Note), id: item.id }))), error => onError?.(error));
    },
    watchSignals(onChange) {
      return onSnapshot(query(collection(db, 'signals'), orderBy('day', 'desc'), limit(4000)), snapshot => onChange(snapshot.docs.map(item => item.data() as Signal)), () => onChange([]));
    },
    watchTraining(onChange) {
      return onSnapshot(query(collection(db, 'training'), orderBy('day', 'desc'), limit(4000)), snapshot => onChange(snapshot.docs.map(item => item.data() as Training)), () => onChange([]));
    },
    async markSeen(noteId) { await updateDoc(doc(db, 'notes', noteId), { status: 'seen' }); },
    async clinicAccess() {
      // A clinic device is enrolled by adding its id under /clinicians in the Firebase console.
      const current = auth.currentUser ?? (await Promise.race([user, new Promise<null>(resolve => setTimeout(() => resolve(null), 6000))]));
      if (!current) return { ok: false, reason: 'signed-out' as const };
      const listed = await getDoc(doc(db, 'clinicians', current.uid)).then(snapshot => snapshot.exists()).catch(() => false);
      return listed ? { ok: true, uid: current.uid } : { ok: false, uid: current.uid, reason: 'not-listed' as const };
    },
    async signIn() { await signInWithPopup(auth, new GoogleAuthProvider()); },
  };
}

/** Firestore refuses undefined fields; local-only fields stay on the device. */
function stripLocal(note: Note): object {
  const { pending: _pending, ...rest } = note;
  return JSON.parse(JSON.stringify(rest)) as object;
}
