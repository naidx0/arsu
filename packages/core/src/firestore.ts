// SPEC.md §1 — FirestoreBlackboard: the production blackboard seam.
// Same interface as LocalBlackboard, backed by @google-cloud/firestore.
// Activated when FIREBASE_* env is present. The package is an optional
// peer — this module ships the seam and throws a clear error until
// credentials + dependency exist. Nothing outside this file may import
// firestore.

import { Blackboard, Doc, Where } from './blackboard.js';

type FirestoreDb = {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): unknown }>;
      set(data: unknown, opts?: { merge?: boolean }): Promise<unknown>;
      update(p: Record<string, unknown>): Promise<unknown>;
      delete?(): Promise<unknown>;
    };
    get(): Promise<{ docs: { id: string; data(): unknown }[] }>;
    add(data: unknown): Promise<{ id: string }>;
    onSnapshot(cb: (snap: { docs: { id: string; data(): unknown }[] }) => void): () => void;
  };
};

export class FirestoreBlackboard implements Blackboard {
  private db: FirestoreDb | null = null;

  private async dbOrThrow(): Promise<FirestoreDb> {
    if (this.db) return this.db;
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
      process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      throw new Error(
        'FirestoreBlackboard: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
          'FIREBASE_PRIVATE_KEY required — falling back is LocalBlackboard',
      );
    }
    // Optional dependency — only resolvable once installed for the prod deploy.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any;
    try {
      // @ts-ignore optional dep, resolved at deploy time
      mod = await import('@google-cloud/firestore');
    } catch {
      throw new Error(
        'FirestoreBlackboard: install @google-cloud/firestore to use the ' +
          'Firestore backend',
      );
    }
    this.db = new mod.Firestore({
      projectId: FIREBASE_PROJECT_ID,
      credentials: {
        client_email: FIREBASE_CLIENT_EMAIL,
        private_key: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
    }) as FirestoreDb;
    return this.db;
  }

  async get<T>(col: string, id: string): Promise<Doc<T> | null> {
    const db = await this.dbOrThrow();
    const snap = await db.collection(col).doc(id).get();
    return snap.exists ? { id, data: snap.data() as T } : null;
  }

  async put<T>(col: string, id: string, data: T): Promise<void> {
    const db = await this.dbOrThrow();
    await db.collection(col).doc(id).set(data);
  }

  async add<T>(col: string, data: T): Promise<Doc<T>> {
    const db = await this.dbOrThrow();
    const ref = await db.collection(col).add(data);
    (data as { id?: string }).id = ref.id;
    await db.collection(col).doc(ref.id).set(data);
    return { id: ref.id, data };
  }

  async patch<T>(col: string, id: string, p: Partial<T>): Promise<void> {
    const db = await this.dbOrThrow();
    await db.collection(col).doc(id).update(p as Record<string, unknown>);
  }

  async query<T>(col: string, where?: Where<T>): Promise<Doc<T>[]> {
    const db = await this.dbOrThrow();
    const snap = await db.collection(col).get();
    const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
    if (!where) return docs;
    return docs.filter((d) =>
      Object.entries(where).every(
        ([k, v]) => (d.data as Record<string, unknown>)[k] === v,
      ),
    );
  }

  watch<T>(
    col: string,
    cb: (docs: Doc<T>[]) => void,
    where?: Where<T>,
  ): () => void {
    let unsub: (() => void) | null = null;
    void this.dbOrThrow().then((db) => {
      unsub = db.collection(col).onSnapshot((snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() as T }));
        cb(
          where
            ? docs.filter((d) =>
                Object.entries(where).every(
                  ([k, v]) =>
                    (d.data as Record<string, unknown>)[k] === v,
                ),
              )
            : docs,
        );
      });
    });
    return () => unsub?.();
  }

  async emit(type: string, payload: object): Promise<void> {
    await this.add('events', {
      ts: Date.now(),
      type,
      severity: 'info',
      actor: 'system',
      msg: type,
      ...(payload as object),
    });
  }
}
