import type { InteriorEntry, WorldState } from '../types/world';

export interface AtlasForgeBundle {
  kind: 'atlas-forge-bundle';
  version: 2;
  exportedAt: string;
  world: WorldState;
  interiors: InteriorEntry[];
}

export function createBundle(world: WorldState, interiors: InteriorEntry[]): AtlasForgeBundle {
  return {
    kind: 'atlas-forge-bundle',
    version: 2,
    exportedAt: new Date().toISOString(),
    world,
    interiors,
  };
}

export type ParsedImport =
  | { ok: true; world: WorldState; interiors: InteriorEntry[] | null }
  | { ok: false; error: string };

function looksLikeWorld(value: unknown): value is WorldState {
  const w = value as WorldState | null;
  return Boolean(w && w.continent && Array.isArray(w.regions) && w.regions.length > 0);
}

function looksLikeEntry(value: unknown): value is InteriorEntry {
  const e = value as InteriorEntry | null;
  return Boolean(
    e &&
      typeof e.id === 'string' &&
      typeof e.title === 'string' &&
      e.doc &&
      Array.isArray(e.doc.floors) &&
      e.doc.floors.length > 0
  );
}

/** Accepts a full bundle or a plain world file from before interiors were linked */
export function parseImport(text: string): ParsedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  const asBundle = parsed as Partial<AtlasForgeBundle> | null;
  if (asBundle && asBundle.kind === 'atlas-forge-bundle') {
    if (!looksLikeWorld(asBundle.world)) {
      return { ok: false, error: 'The bundle has no continent or regions.' };
    }
    const interiors = Array.isArray(asBundle.interiors) ? asBundle.interiors.filter(looksLikeEntry) : [];
    return { ok: true, world: stripLegacyFields(asBundle.world), interiors };
  }

  if (looksLikeWorld(parsed)) {
    return { ok: true, world: stripLegacyFields(parsed), interiors: null };
  }
  return { ok: false, error: 'That file is not an Atlas Forge world or bundle.' };
}

/** Worlds saved before the interior link carried a Tool Bridge config */
export function stripLegacyFields(world: WorldState): WorldState {
  const { bridgeConfig: _bridge, ...rest } = world as WorldState & { bridgeConfig?: unknown };
  return rest as WorldState;
}
