import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { Breadcrumb, Crumb } from './components/Breadcrumb';
import { ContinentView } from './components/ContinentView';
import { ExportView } from './components/ExportView';
import {
  AttachableBuilding,
  InteriorLibraryView,
  LibraryAttachment,
} from './components/InteriorLibraryView';
import { RegionLedgerView } from './components/RegionLedgerView';
import { SettlementView } from './components/SettlementView';
import { AppView, TopBar, TopSection, TOP_SECTIONS } from './components/TopBar';
import { BIOMES, FACTION_PRESETS } from './data/presets';
import { createEmptyMapPreset } from './interior/data/presets';
import { InteriorEditor } from './interior/InteriorEditor';
import type { MapDocument, SavedMapEntry } from './interior/types/map';
import { generateProceduralLayout } from './interior/utils/proceduralLayout';
import {
  ColorCodingMode,
  ContinentConfig,
  ContinentShape,
  InteriorEntry,
  Point,
  Region,
  SettlementTier,
  WorldState,
} from './types/world';
import { stripLegacyFields } from './utils/bundle';
import { generateSettlementLayout } from './utils/cityGenerator';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  generateContinentName,
  generateContinentRegions,
} from './utils/continentGenerator';
import {
  applyInteriorToBuilding,
  countLinkedBuildings,
  findLinkedBuilding,
  generatorOptionsForBuilding,
  reconcileLinkedBuildings,
  seedInteriorFromBuilding,
} from './utils/interiorLink';
import {
  deleteInteriorFromStore,
  flushPendingSaves,
  loadAllInteriors,
  replaceAllInteriors,
  saveInteriorSoon,
} from './utils/interiorStore';
import { findNonOverlappingRegionSpot } from './utils/polygonOps';

type MapLevel = 'continent' | 'settlement' | 'interior';
const isMapLevel = (v: AppView): v is MapLevel =>
  v === 'continent' || v === 'settlement' || v === 'interior';

function newInteriorId(): string {
  return `interior-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const STORAGE_KEY = 'atlas-forge-world-v4';

function createInitialWorld(config?: Partial<ContinentConfig>): WorldState {
  const continent: ContinentConfig = {
    name: config?.name ?? 'Aethelgard',
    seed: config?.seed ?? 4219,
    regionCount: config?.regionCount ?? 10,
    coastlineJaggedness: config?.coastlineJaggedness ?? 0.65,
    borderIrregularity: config?.borderIrregularity ?? 0.7,
    shape: config?.shape ?? 'auto',
  };

  const regions = generateContinentRegions(continent);

  return {
    continent,
    colorMode: 'biome',
    regions,
    updatedAt: new Date().toISOString(),
  };
}

function loadSavedWorld(): WorldState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialWorld();
    const parsed = JSON.parse(raw) as WorldState;
    if (
      parsed &&
      parsed.continent &&
      Array.isArray(parsed.regions) &&
      parsed.regions.length > 0
    ) {
      return stripLegacyFields(parsed);
    }
  } catch {
    // Fallback to deterministic seed
  }
  return createInitialWorld();
}

export default function App() {
  const [world, setWorld] = useState<WorldState>(() => loadSavedWorld());
  const [activeView, setActiveView] = useState<AppView>('continent');
  const [selectedRegionId, setSelectedRegionId] = useState<string>(
    () => world.regions[0]?.id ?? ''
  );

  // Undo / Redo history stacks of Region[]
  const [past, setPast] = useState<Region[][]>([]);
  const [future, setFuture] = useState<Region[][]>([]);

  // New Continent dialog state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSeed, setNewSeed] = useState(8374);
  const [newCount, setNewCount] = useState(11);
  const [newShape, setNewShape] = useState<ContinentShape>('auto');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(world));
    } catch {
      // Ignore quota errors
    }
  }, [world]);

  const activeRegion =
    world.regions.find((r) => r.id === selectedRegionId) ?? world.regions[0];

  // ---- Interiors ---------------------------------------------------------
  const [interiors, setInteriors] = useState<InteriorEntry[]>([]);
  const [interiorsReady, setInteriorsReady] = useState(false);
  const [interiorsPersistent, setInteriorsPersistent] = useState(true);
  const [activeInteriorId, setActiveInteriorId] = useState<string | null>(null);
  const [lastMapLevel, setLastMapLevel] = useState<MapLevel>('continent');
  const [notice, setNotice] = useState<string | null>(null);
  const [focusBuildingId, setFocusBuildingId] = useState<string | null>(null);

  const worldRef = useRef(world);
  worldRef.current = world;
  const interiorsRef = useRef(interiors);
  interiorsRef.current = interiors;

  const interiorMap = () => new Map(interiorsRef.current.map((e) => [e.id, e]));

  useEffect(() => {
    let cancelled = false;
    loadAllInteriors().then(({ entries, persistent }) => {
      if (cancelled) return;
      setInteriors(entries);
      setInteriorsPersistent(persistent);
      setInteriorsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Once the library is loaded, make every linked building agree with its interior
  // (and drop links left over from the old Tool Bridge, which pointed at nothing).
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (!interiorsReady || reconciledRef.current) return;
    reconciledRef.current = true;
    const byId = new Map(interiors.map((e) => [e.id, e]));
    setWorld((w) => ({ ...w, regions: reconcileLinkedBuildings(w.regions, byId, 'legacy') }));
  }, [interiorsReady, interiors]);

  useEffect(() => {
    const flush = () => {
      void flushPendingSaves();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (isMapLevel(activeView)) setLastMapLevel(activeView);
  }, [activeView]);

  const upsertInterior = (entry: InteriorEntry) => {
    setInteriors((prev) =>
      prev.some((e) => e.id === entry.id) ? prev.map((e) => (e.id === entry.id ? entry : e)) : [...prev, entry]
    );
    saveInteriorSoon(entry);
  };

  const patchBuilding = (
    regionId: string,
    buildingId: string,
    updater: (b: Region['settlement']['buildings'][number]) => Region['settlement']['buildings'][number],
    recordHistory = false
  ) => {
    handleUpdateRegion(
      regionId,
      (r) => ({
        ...r,
        settlement: {
          ...r.settlement,
          buildings: r.settlement.buildings.map((b) => (b.id === buildingId ? updater(b) : b)),
        },
      }),
      recordHistory
    );
  };

  const buildingName = (b: { assignedName?: string; label: string }) => b.assignedName ?? b.label;

  const handleCreateInterior = (regionId: string, buildingId: string, mode: 'blank' | 'generate') => {
    const region = world.regions.find((r) => r.id === regionId);
    const building = region?.settlement.buildings.find((b) => b.id === buildingId);
    if (!region || !building || building.interiorLink) return;
    const name = buildingName(building) || building.label;
    const id = newInteriorId();
    let doc: MapDocument;
    let anchor: Point | undefined;
    try {
      if (mode === 'blank') {
        const seeded = seedInteriorFromBuilding(building, name);
        doc = seeded.doc;
        anchor = seeded.anchor;
      } else {
        doc = generateProceduralLayout(generatorOptionsForBuilding(building));
      }
    } catch {
      setNotice('Could not create an interior for this building.');
      return;
    }
    doc = { ...doc, id, title: name };
    const now = Date.now();
    upsertInterior({ id, title: name, doc, createdAt: now, updatedAt: now });
    patchBuilding(
      regionId,
      buildingId,
      (b) => applyInteriorToBuilding(b, doc, id, anchor ? { anchor } : undefined),
      true
    );
    setActiveInteriorId(id);
    setActiveView('interior');
  };

  const handleOpenInteriorById = (id: string) => {
    if (!interiorsRef.current.some((e) => e.id === id)) {
      setNotice('That interior is not in the library.');
      return;
    }
    setActiveInteriorId(id);
    setActiveView('interior');
  };

  const handleOpenBuildingInterior = (regionId: string, buildingId: string) => {
    const region = world.regions.find((r) => r.id === regionId);
    const building = region?.settlement.buildings.find((b) => b.id === buildingId);
    const id = building?.interiorLink?.linkedInteriorId;
    if (!id) return;
    if (!interiorsRef.current.some((e) => e.id === id)) {
      setNotice('This interior is missing from the library. Detach it to start a new one.');
      return;
    }
    handleOpenInteriorById(id);
  };

  // Called by the editor after every committed edit, undo and redo. When the interior
  // is attached, the building's outline, floors and summary follow it.
  const handleInteriorCommit = (id: string, doc: MapDocument) => {
    const entry = interiorsRef.current.find((e) => e.id === id);
    if (!entry) return;
    const linked = findLinkedBuilding(worldRef.current.regions, id);
    const title = linked ? buildingName(linked.building) : entry.title;
    const nextDoc: MapDocument = { ...doc, id, title };
    upsertInterior({ ...entry, title, doc: nextDoc, updatedAt: Date.now() });
    if (linked) {
      patchBuilding(linked.region.id, linked.building.id, (b) => applyInteriorToBuilding(b, nextDoc, id), false);
    }
  };

  const handleRenameInterior = (id: string, title: string) => {
    const entry = interiorsRef.current.find((e) => e.id === id);
    if (!entry) return;
    const linked = findLinkedBuilding(worldRef.current.regions, id);
    if (linked) {
      patchBuilding(linked.region.id, linked.building.id, (b) => ({ ...b, assignedName: title }), false);
    }
    upsertInterior({ ...entry, title, doc: { ...entry.doc, title }, updatedAt: Date.now() });
  };

  const handleDeleteInterior = (id: string) => {
    const entry = interiorsRef.current.find((e) => e.id === id);
    if (!entry) return;
    const linked = findLinkedBuilding(worldRef.current.regions, id);
    const message = linked
      ? `Delete “${entry.title}”? It is attached to ${buildingName(linked.building)}, which keeps its current outline but loses its interior.`
      : `Delete “${entry.title}”? This cannot be undone.`;
    if (!window.confirm(message)) return;
    if (linked) {
      patchBuilding(
        linked.region.id,
        linked.building.id,
        (b) => {
          const { interiorLink: _link, ...rest } = b;
          return rest;
        },
        false
      );
    }
    setInteriors((prev) => prev.filter((e) => e.id !== id));
    void deleteInteriorFromStore(id);
    if (activeInteriorId === id) {
      setActiveInteriorId(null);
      setActiveView('library');
    }
  };

  const handleDuplicateInterior = (docOrId: MapDocument | string) => {
    const source =
      typeof docOrId === 'string' ? interiorsRef.current.find((e) => e.id === docOrId)?.doc : docOrId;
    if (!source) return;
    const id = newInteriorId();
    const base = (typeof docOrId === 'string'
      ? interiorsRef.current.find((e) => e.id === docOrId)?.title
      : source.title) ?? source.title;
    const title = `${base} copy`;
    const now = Date.now();
    upsertInterior({ id, title, doc: { ...source, id, title }, createdAt: now, updatedAt: now });
    setNotice(`Saved “${title}” to the library.`);
  };

  const handleNewInterior = () => {
    const id = newInteriorId();
    const title = 'Untitled interior';
    const now = Date.now();
    upsertInterior({ id, title, doc: { ...createEmptyMapPreset(), id, title }, createdAt: now, updatedAt: now });
    setActiveInteriorId(id);
    setActiveView('interior');
  };

  const handleAttachInterior = (id: string, regionId: string, buildingId: string) => {
    const entry = interiorsRef.current.find((e) => e.id === id);
    const region = world.regions.find((r) => r.id === regionId);
    const building = region?.settlement.buildings.find((b) => b.id === buildingId);
    if (!entry || !building || building.interiorLink) return;
    const name = buildingName(building) || building.label;
    const doc = { ...entry.doc, title: name };
    upsertInterior({ ...entry, title: name, doc, updatedAt: Date.now() });
    patchBuilding(regionId, buildingId, (b) => applyInteriorToBuilding(b, doc, id), true);
  };

  const handleDetachInterior = (id: string) => {
    const linked = findLinkedBuilding(worldRef.current.regions, id);
    if (!linked) return;
    patchBuilding(
      linked.region.id,
      linked.building.id,
      (b) => {
        const { interiorLink: _link, ...rest } = b;
        return rest;
      },
      true
    );
  };

  const handleDetachFromBuilding = (regionId: string, buildingId: string) => {
    const region = world.regions.find((r) => r.id === regionId);
    const id = region?.settlement.buildings.find((b) => b.id === buildingId)?.interiorLink?.linkedInteriorId;
    if (id) handleDetachInterior(id);
  };

  const confirmReplacingLinkedBuildings = (regions: Region[], what: string): boolean => {
    const n = countLinkedBuildings(regions);
    if (n === 0) return true;
    return window.confirm(
      `${what} ${n === 1 ? '1 building has an interior' : `${n} buildings have interiors`}. ` +
        'The interiors stay in the library, but they will no longer be attached to a building.'
    );
  };

  const pushHistory = (prevRegions: Region[]) => {
    setPast((p) => [...p.slice(-24), prevRegions]);
    setFuture([]);
  };

  const handleUndo = () => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [world.regions, ...f.slice(0, 24)]);
    setWorld((w) => ({
      ...w,
      regions: reconcileLinkedBuildings(previous, interiorMap(), 'keep'),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p.slice(-24), world.regions]);
    setWorld((w) => ({
      ...w,
      regions: reconcileLinkedBuildings(next, interiorMap(), 'keep'),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleUpdateContinentConfig = (
    nextConfig: ContinentConfig,
    regenerate: boolean
  ) => {
    if (!regenerate) {
      setWorld((w) => ({
        ...w,
        continent: nextConfig,
        updatedAt: new Date().toISOString(),
      }));
      return;
    }

    if (!confirmReplacingLinkedBuildings(world.regions, 'Regenerating the continent replaces every settlement.')) return;
    const nextRegions = generateContinentRegions(nextConfig);
    pushHistory(world.regions);
    setWorld((w) => ({
      ...w,
      continent: nextConfig,
      regions: nextRegions,
      updatedAt: new Date().toISOString(),
    }));
    if (nextRegions[0]) {
      setSelectedRegionId(nextRegions[0].id);
    }
  };

  const handleChangeColorMode = (mode: ColorCodingMode) => {
    setWorld((w) => ({ ...w, colorMode: mode }));
  };

  const handleUpdateRegion = (
    regionId: string,
    updater: (r: Region) => Region,
    recordHistory = false
  ) => {
    setWorld((w) => {
      if (recordHistory) pushHistory(w.regions);
      return {
        ...w,
        regions: w.regions.map((r) => (r.id === regionId ? updater(r) : r)),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleUpdateRegionsBatch = (
    updater: (regions: Region[]) => Region[],
    recordHistory = false
  ) => {
    setWorld((w) => {
      if (recordHistory) pushHistory(w.regions);
      return {
        ...w,
        regions: updater(w.regions),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleAddRegion = () => {
    const idx = world.regions.length + 1;
    const { center, polygon } = findNonOverlappingRegionSpot(
      world.regions.map((r) => r.polygon),
      MAP_WIDTH,
      MAP_HEIGHT,
      idx
    );

    const newRegionId = `region-custom-${Date.now()}`;
    const settlementSeed = (world.continent.seed + idx * 541) >>> 0;
    const presetFaction = FACTION_PRESETS[idx % FACTION_PRESETS.length];
    const settlement = generateSettlementLayout({
      id: `settlement-custom-${Date.now()}`,
      name: `Newstead ${idx}`,
      tier: 'town',
      seed: settlementSeed,
      biome: 'heartland',
      isCoastal: false,
      mapAnchor: { x: center.x, y: center.y },
    });

    const newRegion: Region = {
      id: newRegionId,
      name: `Frontier Province ${idx}`,
      biome: 'heartland',
      faction: presetFaction.name,
      factionColor: presetFaction.color,
      threat: 'tier-2',
      polygon,
      seedSite: { x: center.x, y: center.y },
      isCoastal: false,
      loreNotes: BIOMES.heartland.description,
      settlement,
    };

    pushHistory(world.regions);
    setWorld((w) => ({
      ...w,
      regions: [...w.regions, newRegion],
      updatedAt: new Date().toISOString(),
    }));
    setSelectedRegionId(newRegionId);
  };

  const handleDeleteRegion = (regionId: string) => {
    if (world.regions.length <= 1) return;
    const doomed = world.regions.find((r) => r.id === regionId);
    if (doomed && !confirmReplacingLinkedBuildings([doomed], 'Deleting this region removes its settlement.')) return;
    pushHistory(world.regions);
    const remaining = world.regions.filter((r) => r.id !== regionId);
    setWorld((w) => ({
      ...w,
      regions: remaining,
      updatedAt: new Date().toISOString(),
    }));
    if (selectedRegionId === regionId && remaining[0]) {
      setSelectedRegionId(remaining[0].id);
    }
  };

  const handleRegenerateSettlement = (
    regionId: string,
    tier: SettlementTier,
    seed: number
  ) => {
    const target = world.regions.find((r) => r.id === regionId);
    if (!target) return;
    if (!confirmReplacingLinkedBuildings([target], 'Regenerating this settlement replaces all of its buildings.')) return;
    const nextSettlement = generateSettlementLayout({
      id: target.settlement.id,
      name: target.settlement.name,
      tier,
      seed,
      biome: target.biome,
      isCoastal: target.isCoastal,
      mapAnchor: target.settlement.mapAnchor,
    });
    handleUpdateRegion(
      regionId,
      (r) => ({ ...r, settlement: nextSettlement }),
      true
    );
  };

  const handleOpenNewModal = () => {
    const randSeed = Math.floor(1000 + Math.random() * 89999);
    setNewSeed(randSeed);
    setNewName(generateContinentName(randSeed));
    setNewCount(world.continent.regionCount);
    setNewShape('auto');
    setShowNewModal(true);
  };

  const handleCreateNewContinent = (e: React.FormEvent) => {
    e.preventDefault();
    const config: ContinentConfig = {
      name: newName.trim() || generateContinentName(newSeed),
      seed: newSeed,
      regionCount: Math.max(5, Math.min(18, newCount)),
      coastlineJaggedness: world.continent.coastlineJaggedness,
      borderIrregularity: world.continent.borderIrregularity,
      shape: newShape,
    };
    if (!confirmReplacingLinkedBuildings(world.regions, 'A new continent replaces every settlement.')) return;
    const regions = generateContinentRegions(config);
    pushHistory(world.regions);
    setWorld((w) => ({
      ...w,
      continent: config,
      regions,
      updatedAt: new Date().toISOString(),
    }));
    if (regions[0]) setSelectedRegionId(regions[0].id);
    setActiveView('continent');
    setShowNewModal(false);
  };

  const handleImport = (imported: WorldState, importedInteriors: InteriorEntry[] | null) => {
    pushHistory(world.regions);
    if (importedInteriors) {
      setInteriors(importedInteriors);
      void replaceAllInteriors(importedInteriors);
      setActiveInteriorId(null);
    }
    const byId = new Map((importedInteriors ?? interiorsRef.current).map((e) => [e.id, e]));
    const next: WorldState = {
      ...imported,
      regions: reconcileLinkedBuildings(imported.regions, byId, 'all'),
    };
    setWorld(next);
    if (next.regions[0]) setSelectedRegionId(next.regions[0].id);
    setActiveView('continent');
  };

  // ---- Navigation -------------------------------------------------------
  const activeEntry = activeInteriorId ? interiors.find((e) => e.id === activeInteriorId) ?? null : null;
  const activeLinked = activeEntry ? findLinkedBuilding(world.regions, activeEntry.id) : null;
  const activeSection: TopSection = isMapLevel(activeView) ? 'map' : activeView;

  const handleSection = (section: TopSection) => {
    if (section !== 'map') {
      setActiveView(section);
      return;
    }
    setActiveView(lastMapLevel === 'interior' && !activeEntry ? 'continent' : lastMapLevel);
  };

  const library: SavedMapEntry[] = useMemo(
    () =>
      interiors.map((e) => ({
        id: e.id,
        title: e.title,
        doc: e.doc,
        savedAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    [interiors]
  );

  const attachments = useMemo(() => {
    const map = new Map<string, LibraryAttachment>();
    for (const r of world.regions) {
      for (const b of r.settlement.buildings) {
        if (b.interiorLink) {
          map.set(b.interiorLink.linkedInteriorId, {
            regionId: r.id,
            buildingId: b.id,
            buildingName: buildingName(b) || b.label,
            settlementName: r.settlement.name,
          });
        }
      }
    }
    return map;
  }, [world.regions]);

  const attachable = useMemo(() => {
    const list: AttachableBuilding[] = [];
    for (const r of world.regions) {
      for (const b of r.settlement.buildings) {
        if (b.claimStatus === 'claimed' && !b.interiorLink) {
          list.push({
            regionId: r.id,
            buildingId: b.id,
            label: `${buildingName(b) || b.label} · ${r.settlement.name}`,
          });
        }
      }
    }
    return list;
  }, [world.regions]);

  const goToSettlement = (regionId: string, buildingId: string | null = null) => {
    setSelectedRegionId(regionId);
    setFocusBuildingId(buildingId);
    setActiveView('settlement');
  };

  const crumbs: Crumb[] = (() => {
    const continent: Crumb = { label: world.continent.name, onClick: () => setActiveView('continent') };
    if (activeView === 'settlement' && activeRegion) {
      return [continent, { label: activeRegion.settlement.name, detail: activeRegion.name }];
    }
    if (activeView === 'interior' && activeEntry) {
      if (activeLinked) {
        return [
          continent,
          {
            label: activeLinked.region.settlement.name,
            onClick: () => goToSettlement(activeLinked.region.id, activeLinked.building.id),
          },
          { label: buildingName(activeLinked.building) || activeLinked.building.label },
        ];
      }
      return [continent, { label: 'Library', onClick: () => setActiveView('library') }, { label: activeEntry.title }];
    }
    return [];
  })();

  return (
    <div
      className="h-dvh w-full flex flex-col overflow-hidden bg-[#F5F6F8] text-slate-900"
      data-active-view={activeView}
      data-region-count={world.regions.length}
    >
      {/* On phones the interior editor takes the whole screen; the breadcrumb is the way back */}
      <div className={activeView === 'interior' ? 'hidden md:block' : ''}>
        <TopBar
          activeSection={activeSection}
          onNavigate={handleSection}
          onHome={() => setActiveView('continent')}
          onNewContinent={handleOpenNewModal}
        />

        <nav
          aria-label="Mobile sections"
          className="md:hidden bg-white border-b border-slate-200 px-2 h-[42px] grid grid-cols-4 gap-1 items-center shrink-0"
        >
          {TOP_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSection(item.id)}
              aria-current={activeSection === item.id ? 'page' : undefined}
              className={`h-8 text-xs font-medium rounded whitespace-nowrap cursor-pointer transition-colors ${
                activeSection === item.id ? 'bg-blue-700 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      {crumbs.length > 1 && <Breadcrumb crumbs={crumbs} />}

      {activeView === 'continent' && (
        <ContinentView
          continent={world.continent}
          regions={world.regions}
          colorMode={world.colorMode}
          selectedRegionId={activeRegion?.id ?? ''}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          onSelectRegion={setSelectedRegionId}
          onOpenSettlement={(id) => goToSettlement(id)}
          onUpdateContinentConfig={handleUpdateContinentConfig}
          onChangeColorMode={handleChangeColorMode}
          onUpdateRegion={handleUpdateRegion}
          onUpdateRegionsBatch={handleUpdateRegionsBatch}
          onAddRegion={handleAddRegion}
          onDeleteRegion={handleDeleteRegion}
          onUndo={handleUndo}
          onRedo={handleRedo}
        />
      )}

      {activeView === 'settlement' && activeRegion && (
        <SettlementView
          continentName={world.continent.name}
          region={activeRegion}
          regions={world.regions}
          key={`${activeRegion.id}:${focusBuildingId ?? ''}`}
          initialBuildingId={focusBuildingId}
          onCreateInterior={handleCreateInterior}
          onOpenInterior={handleOpenBuildingInterior}
          onDetachInterior={handleDetachFromBuilding}
          onBackToContinent={() => setActiveView('continent')}
          onSwitchRegion={setSelectedRegionId}
          onUpdateRegion={handleUpdateRegion}
          onRegenerateSettlement={handleRegenerateSettlement}
        />
      )}

      {activeView === 'interior' && (
        <div className="flex-1 min-h-0">
          {activeEntry ? (
            <InteriorEditor
              key={activeEntry.id}
              initialDoc={activeEntry.doc}
              displayName={activeLinked ? buildingName(activeLinked.building) : activeEntry.title}
              contextLabel={
                activeLinked
                  ? `${activeLinked.region.settlement.name} · ${activeLinked.region.name}`
                  : 'Not attached to a building'
              }
              library={library}
              activeEntryId={activeEntry.id}
              onDocCommit={(doc) => handleInteriorCommit(activeEntry.id, doc)}
              onRename={(title) => handleRenameInterior(activeEntry.id, title)}
              onOpenInterior={handleOpenInteriorById}
              onRenameInterior={handleRenameInterior}
              onDeleteInterior={handleDeleteInterior}
              onDuplicateInterior={handleDuplicateInterior}
            />
          ) : (
            <div className="h-full flex items-center justify-center p-6">
              <div className="max-w-sm text-center space-y-3">
                <h2 className="text-sm font-semibold text-slate-900">No interior open</h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Open one from the library, or claim a building on a settlement map and start its interior there.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveView('library')}
                  className="px-4 py-2 min-h-[36px] text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                >
                  Go to the library
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeView === 'ledger' && (
        <RegionLedgerView
          continent={world.continent}
          regions={world.regions}
          colorMode={world.colorMode}
          onOpenSettlement={(id) => goToSettlement(id)}
        />
      )}

      {activeView === 'library' && (
        <InteriorLibraryView
          entries={interiors}
          attachments={attachments}
          attachable={attachable}
          persistent={interiorsPersistent}
          onOpen={handleOpenInteriorById}
          onNew={handleNewInterior}
          onDuplicate={handleDuplicateInterior}
          onDelete={handleDeleteInterior}
          onAttach={handleAttachInterior}
          onDetach={handleDetachInterior}
          onGoToBuilding={goToSettlement}
        />
      )}

      {activeView === 'export' && <ExportView world={world} interiors={interiors} onImport={handleImport} />}

      {notice && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] px-3.5 py-2 text-xs text-white bg-slate-900 rounded-md shadow-lg"
        >
          {notice}
        </div>
      )}

      {/* New Continent Modal */}
      {showNewModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-continent-title"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-lg shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2
                id="new-continent-title"
                className="text-base font-semibold text-slate-900"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Generate New Continent
              </h2>
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
              >
                Cancel
              </button>
            </div>
            <form onSubmit={handleCreateNewContinent} className="p-5 space-y-4">
              <div>
                <label htmlFor="new-cont-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Continent Name
                </label>
                <input
                  id="new-cont-name"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="new-cont-seed" className="text-xs font-medium text-slate-700">
                      Seed
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const s = Math.floor(1000 + Math.random() * 89999);
                        setNewSeed(s);
                        setNewName(generateContinentName(s));
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:underline cursor-pointer"
                    >
                      <Shuffle className="w-3 h-3" aria-hidden="true" />
                      Random
                    </button>
                  </div>
                  <input
                    id="new-cont-seed"
                    type="number"
                    required
                    value={newSeed}
                    onChange={(e) => setNewSeed(Number(e.target.value) || 1)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="new-cont-count" className="block text-xs font-medium text-slate-700 mb-1">
                    Region Count (5–18)
                  </label>
                  <input
                    id="new-cont-count"
                    type="number"
                    min={5}
                    max={18}
                    required
                    value={newCount}
                    onChange={(e) => setNewCount(Number(e.target.value) || 10)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="new-cont-shape" className="block text-xs font-medium text-slate-700 mb-1">
                  Landmass Shape
                </label>
                <select
                  id="new-cont-shape"
                  value={newShape}
                  onChange={(e) => setNewShape(e.target.value as ContinentShape)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                >
                  <option value="auto">Auto (Varied Asymmetric)</option>
                  <option value="crescent">Crescent &amp; Inland Sea</option>
                  <option value="peninsula">Peninsula &amp; Capes</option>
                  <option value="isthmus">Twin-Lobe Isthmus</option>
                  <option value="sprawling">Sprawling Archipelago</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                >
                  Generate Continent
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
