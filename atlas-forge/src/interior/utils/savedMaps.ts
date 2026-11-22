import { MapDocument, SavedMapEntry } from '../types/map';

const SAVED_MAPS_STORAGE_KEY = 'keepcraft_saved_maps_v1';
const ACTIVE_SAVED_MAP_ID_KEY = 'keepcraft_active_saved_map_id_v1';

export function cloneMapDocument(doc: MapDocument): MapDocument {
  return JSON.parse(JSON.stringify(doc)) as MapDocument;
}

export function loadSavedMapsFromStorage(): SavedMapEntry[] {
  try {
    const raw = window.localStorage.getItem(SAVED_MAPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is SavedMapEntry =>
          Boolean(entry) &&
          typeof entry.id === 'string' &&
          typeof entry.title === 'string' &&
          Boolean(entry.doc) &&
          Array.isArray(entry.doc.floors) &&
          entry.doc.floors.length > 0
      )
      .map((entry) => ({
        id: entry.id,
        title: entry.title.trim() || 'Untitled Keep',
        doc: entry.doc,
        savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : Date.now(),
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

export function persistSavedMapsToStorage(entries: SavedMapEntry[]): boolean {
  try {
    window.localStorage.setItem(SAVED_MAPS_STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

export function loadActiveSavedMapId(): string | null {
  try {
    const id = window.localStorage.getItem(ACTIVE_SAVED_MAP_ID_KEY);
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}

export function persistActiveSavedMapId(id: string | null): void {
  try {
    if (id) {
      window.localStorage.setItem(ACTIVE_SAVED_MAP_ID_KEY, id);
    } else {
      window.localStorage.removeItem(ACTIVE_SAVED_MAP_ID_KEY);
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function getMapChamberCount(doc: MapDocument): number {
  return doc.floors.reduce((sum, fl) => sum + fl.rooms.length, 0);
}

export function formatSavedTimestamp(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
