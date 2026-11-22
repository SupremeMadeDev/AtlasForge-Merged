/**
 * Interior library persistence.
 *
 * Interiors can carry imported floor textures as data URLs, so they live in
 * IndexedDB instead of localStorage (which tops out around 5 MB). The world
 * itself stays in localStorage.
 */
import type { SavedMapEntry } from '../interior/types/map';
import type { InteriorEntry } from '../types/world';

const DB_NAME = 'atlas-forge';
const DB_VERSION = 1;
const STORE = 'interiors';
const SAVE_DEBOUNCE_MS = 300;

/** localStorage key the standalone KeepCraft app used for its saved maps */
const LEGACY_KEEPCRAFT_KEY = 'keepcraft_saved_maps_v1';
const LEGACY_MIGRATED_FLAG = 'atlas-forge-keepcraft-migrated-v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function putEntries(entries: InteriorEntry[]): Promise<boolean> {
  const db = await openDb();
  if (!db || entries.length === 0) return Boolean(db);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const entry of entries) store.put(entry);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function readLegacyKeepcraftMaps(): InteriorEntry[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEEPCRAFT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedMapEntry[])
      .filter(
        (e) =>
          e &&
          typeof e.id === 'string' &&
          e.doc &&
          Array.isArray(e.doc.floors) &&
          e.doc.floors.length > 0
      )
      .map((e) => {
        const id = `legacy-${e.id}`;
        const title = (e.title ?? '').trim() || 'Untitled Keep';
        return {
          id,
          title,
          doc: { ...e.doc, id, title },
          createdAt: typeof e.savedAt === 'number' ? e.savedAt : Date.now(),
          updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now(),
        };
      });
  } catch {
    return [];
  }
}

export interface LoadedInteriors {
  entries: InteriorEntry[];
  /** False when IndexedDB is unavailable, so interiors only last for this session */
  persistent: boolean;
}

export async function loadAllInteriors(): Promise<LoadedInteriors> {
  const db = await openDb();
  if (!db) return { entries: [], persistent: false };

  let entries: InteriorEntry[] = [];
  try {
    const tx = db.transaction(STORE, 'readonly');
    const all = await requestToPromise(tx.objectStore(STORE).getAll());
    entries = Array.isArray(all) ? (all as InteriorEntry[]) : [];
  } catch {
    entries = [];
  }

  // One-time import of maps saved by the standalone KeepCraft app (same origin).
  // The originals are left untouched in localStorage.
  try {
    if (!window.localStorage.getItem(LEGACY_MIGRATED_FLAG)) {
      const known = new Set(entries.map((e) => e.id));
      const legacy = readLegacyKeepcraftMaps().filter((e) => !known.has(e.id));
      if (legacy.length > 0 && (await putEntries(legacy))) {
        entries = [...entries, ...legacy];
      }
      window.localStorage.setItem(LEGACY_MIGRATED_FLAG, '1');
    }
  } catch {
    // Migration is best-effort
  }

  return { entries, persistent: true };
}

const pending = new Map<string, InteriorEntry>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced write-through for one interior (the last call per id wins) */
export function saveInteriorSoon(entry: InteriorEntry): void {
  pending.set(entry.id, entry);
  const existing = timers.get(entry.id);
  if (existing) clearTimeout(existing);
  timers.set(
    entry.id,
    setTimeout(() => {
      timers.delete(entry.id);
      const next = pending.get(entry.id);
      if (!next) return;
      pending.delete(entry.id);
      void putEntries([next]);
    }, SAVE_DEBOUNCE_MS)
  );
}

/** Writes anything still waiting on a debounce timer (call on page hide) */
export function flushPendingSaves(): Promise<boolean> {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const batch = [...pending.values()];
  pending.clear();
  return putEntries(batch);
}

export async function deleteInteriorFromStore(id: string): Promise<void> {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  pending.delete(id);
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
  } catch {
    // ignore
  }
}

/** Replaces the whole library (used when importing a bundle) */
export async function replaceAllInteriors(entries: InteriorEntry[]): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.clear();
      for (const entry of entries) store.put(entry);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
