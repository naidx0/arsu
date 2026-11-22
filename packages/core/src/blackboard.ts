// SPEC.md §1 — the Blackboard interface + LocalBlackboard.
// All agent communication flows through this surface. No exceptions.

import fs from 'node:fs';
import path from 'node:path';
import { EventDoc } from './types.js';

export interface Doc<T> {
  id: string;
  data: T;
}

export type Where<T> = Partial<{ [K in keyof T]: T[K] }>;

export interface Blackboard {
  get<T>(col: string, id: string): Promise<Doc<T> | null>;
  put<T>(col: string, id: string, data: T): Promise<void>; // upsert
  add<T>(col: string, data: T): Promise<Doc<T>>; // auto-id
  patch<T>(col: string, id: string, p: Partial<T>): Promise<void>;
  query<T>(col: string, where?: Where<T>): Promise<Doc<T>[]>;
  watch<T>(
    col: string,
    cb: (docs: Doc<T>[]) => void,
    where?: Where<T>,
  ): () => void;
  emit(type: string, payload: object): Promise<void>; // → events
}

function matches<T extends Record<string, unknown>>(
  data: T,
  where?: Where<T>,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(
    ([k, v]) => (data as Record<string, unknown>)[k] === v,
  );
}

interface Watcher {
  col: string;
  cb: (docs: Doc<unknown>[]) => void;
  where?: Where<Record<string, unknown>>;
}

let counter = 0;
function autoId(): string {
  counter = (counter + 1) % 0xffff;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`;
}

/**
 * In-memory blackboard with debounced JSON persistence and synchronous
 * watcher notification on write. The dev/default board — zero credentials.
 */
export class LocalBlackboard implements Blackboard {
  private cols = new Map<string, Map<string, unknown>>();
  private watchers = new Set<Watcher>();
  private file: string | null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(file?: string) {
    this.file = file ?? null;
    if (this.file) this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.file!)) return;
      const raw = JSON.parse(fs.readFileSync(this.file!, 'utf8')) as Record<
        string,
        Record<string, unknown>
      >;
      for (const [col, docs] of Object.entries(raw)) {
        this.cols.set(col, new Map(Object.entries(docs)));
      }
    } catch {
      // corrupt or absent persistence — start clean
    }
  }

  private persist(): void {
    if (!this.file) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(this.file!), { recursive: true });
      const out: Record<string, Record<string, unknown>> = {};
      for (const [col, docs] of this.cols) {
        out[col] = Object.fromEntries(docs);
      }
      fs.writeFileSync(this.file!, JSON.stringify(out, null, 2));
    }, 250);
  }

  private col(name: string): Map<string, unknown> {
    let c = this.cols.get(name);
    if (!c) {
      c = new Map();
      this.cols.set(name, c);
    }
    return c;
  }

  private notify(col: string): void {
    const docs = [...this.col(col).entries()].map(([id, data]) => ({
      id,
      data,
    }));
    for (const w of this.watchers) {
      if (w.col !== col) continue;
      w.cb(
        docs.filter((d) =>
          matches(d.data as Record<string, unknown>, w.where),
        ),
      );
    }
  }

  async get<T>(col: string, id: string): Promise<Doc<T> | null> {
    const data = this.col(col).get(id);
    return data === undefined ? null : { id, data: data as T };
  }

  async put<T>(col: string, id: string, data: T): Promise<void> {
    this.col(col).set(id, data);
    this.persist();
    this.notify(col);
  }

  async add<T>(col: string, data: T): Promise<Doc<T>> {
    const id = autoId();
    (data as { id?: string }).id = id;
    await this.put(col, id, data);
    return { id, data };
  }

  async patch<T>(col: string, id: string, p: Partial<T>): Promise<void> {
    const cur = this.col(col).get(id) as T | undefined;
    if (cur === undefined) return;
    this.col(col).set(id, { ...(cur as object), ...p });
    this.persist();
    this.notify(col);
  }

  async query<T>(col: string, where?: Where<T>): Promise<Doc<T>[]> {
    return [...this.col(col).entries()]
      .map(([id, data]) => ({ id, data: data as T }))
      .filter((d) =>
        matches(d.data as unknown as Record<string, unknown>, where as never),
      );
  }

  watch<T>(
    col: string,
    cb: (docs: Doc<T>[]) => void,
    where?: Where<T>,
  ): () => void {
    const w: Watcher = {
      col,
      cb: cb as (docs: Doc<unknown>[]) => void,
      where: where as Where<Record<string, unknown>>,
    };
    this.watchers.add(w);
    // initial snapshot
    void this.query(col).then((docs) =>
      cb(
        docs.filter((d) =>
          matches(
            d.data as unknown as Record<string, unknown>,
            where as never,
          ),
        ) as Doc<T>[],
      ),
    );
    return () => this.watchers.delete(w);
  }

  async emit(type: string, payload: object): Promise<void> {
    const ev: Omit<EventDoc, 'id'> & { id?: string } = {
      ts: Date.now(),
      type,
      severity: 'info',
      actor: 'system',
      msg: type,
      ...(payload as object),
    } as EventDoc;
    await this.add<EventDoc>('events', ev as EventDoc);
  }

  /** Used by /api/reset: drop every collection except the named ones. */
  async clearExcept(keep: string[]): Promise<void> {
    for (const col of [...this.cols.keys()]) {
      if (keep.includes(col)) continue;
      this.cols.delete(col);
      this.notify(col);
    }
    this.persist();
  }
}
