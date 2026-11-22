import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FolderOpen,
  Layers,
  Maximize2,
  MousePointer,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BIOMES,
  BIOME_LIST,
  FACTION_PRESETS,
  THREAT_LIST,
  THREAT_TIERS,
} from '../data/presets';
import {
  BiomeType,
  ColorCodingMode,
  ContinentConfig,
  ContinentShape,
  Point,
  Region,
  SettlementTier,
  ThreatTier,
} from '../types/world';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  getRegionColorSpec,
} from '../utils/continentGenerator';
import {
  SnapResult,
  distance,
  findSnapTarget,
  hasSelfIntersection,
  insertVertexOnEdge,
  moveVertex,
  pointsToSvgPath,
  polygonArea,
  polygonCentroid,
  polygonsOverlap,
  removeVertex,
  resolveVertexMoveNoOverlap,
} from '../utils/polygonOps';
import { useCanvasWheel } from '../hooks/useCanvasWheel';

interface ContinentViewProps {
  continent: ContinentConfig;
  regions: Region[];
  colorMode: ColorCodingMode;
  selectedRegionId: string;
  canUndo: boolean;
  canRedo: boolean;
  onSelectRegion: (id: string) => void;
  onOpenSettlement: (regionId: string) => void;
  onUpdateContinentConfig: (next: ContinentConfig, regenerate: boolean) => void;
  onChangeColorMode: (mode: ColorCodingMode) => void;
  onUpdateRegion: (regionId: string, updater: (r: Region) => Region, recordHistory?: boolean) => void;
  onUpdateRegionsBatch: (updater: (regions: Region[]) => Region[], recordHistory?: boolean) => void;
  onAddRegion: () => void;
  onDeleteRegion: (regionId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

type MapTool = 'select' | 'edit-vertices';
type MobileDrawer = 'none' | 'regions' | 'inspector';

export const ContinentView: React.FC<ContinentViewProps> = ({
  continent,
  regions,
  colorMode,
  selectedRegionId,
  canUndo,
  canRedo,
  onSelectRegion,
  onOpenSettlement,
  onUpdateContinentConfig,
  onChangeColorMode,
  onUpdateRegion,
  onUpdateRegionsBatch,
  onAddRegion,
  onDeleteRegion,
  onUndo,
  onRedo,
}) => {
  const [tool, setTool] = useState<MapTool>('select');
  const [snapNodesAndEdges, setSnapNodesAndEdges] = useState(true);
  const [activeSnap, setActiveSnap] = useState<SnapResult | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);

  // Noise-reduction & responsive drawer state
  const [showGeneratorControls, setShowGeneratorControls] = useState(false);
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(true);
  const [desktopRightOpen, setDesktopRightOpen] = useState(true);
  const [mobileDrawer, setMobileDrawer] = useState<MobileDrawer>('none');
  const [showLegend, setShowLegend] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  // Pan & Zoom state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);

  // Synchronous drag refs (avoid stale React state during rapid pointermove)
  const regionsRef = useRef<Region[]>(regions);
  regionsRef.current = regions;

  const draggingVertexRef = useRef<{
    regionId: string;
    vertexIndex: number;
    lastValidPt: Point;
    snapshotRecorded: boolean;
  } | null>(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleWindowPointerUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
      draggingVertexRef.current = null;
      setIsDraggingNode(false);
      setActiveSnap(null);
    };
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, []);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.id === selectedRegionId) ?? regions[0],
    [regions, selectedRegionId]
  );

  const filteredRegions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return regions;
    return regions.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.faction.toLowerCase().includes(q) ||
        r.settlement.name.toLowerCase().includes(q) ||
        BIOMES[r.biome].label.toLowerCase().includes(q)
    );
  }, [regions, searchQuery]);

  const legendItems = useMemo(() => {
    if (colorMode === 'biome') {
      const used = new Set(regions.map((r) => r.biome));
      return BIOME_LIST.filter((b) => used.has(b.id)).map((b) => ({
        key: b.id,
        label: b.label,
        color: b.fill,
      }));
    }
    if (colorMode === 'threat') {
      return THREAT_LIST.map((t) => ({
        key: t.id,
        label: t.shortLabel,
        color: t.fill,
      }));
    }
    const factionMap = new Map<string, string>();
    for (const r of regions) {
      if (!factionMap.has(r.faction)) {
        factionMap.set(r.faction, r.factionColor);
      }
    }
    return Array.from(factionMap.entries()).map(([name, color]) => ({
      key: name,
      label: name,
      color,
    }));
  }, [colorMode, regions]);

  const clientToMapCoords = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: pt.x, y: pt.y };
    }
    const rect = svg.getBoundingClientRect();
    const vbWidth = MAP_WIDTH / zoom;
    const vbHeight = MAP_HEIGHT / zoom;
    const vbX = (MAP_WIDTH - vbWidth) / 2 - pan.x;
    const vbY = (MAP_HEIGHT - vbHeight) / 2 - pan.y;
    const scale = Math.min(rect.width / vbWidth, rect.height / vbHeight) || 1;
    const offsetX = (rect.width - vbWidth * scale) / 2;
    const offsetY = (rect.height - vbHeight * scale) / 2;
    return {
      x: vbX + (clientX - rect.left - offsetX) / scale,
      y: vbY + (clientY - rect.top - offsetY) / scale,
    };
  };

  const viewBoxStr = useMemo(() => {
    const vbWidth = MAP_WIDTH / zoom;
    const vbHeight = MAP_HEIGHT / zoom;
    const vbX = (MAP_WIDTH - vbWidth) / 2 - pan.x;
    const vbY = (MAP_HEIGHT - vbHeight) / 2 - pan.y;
    return `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbWidth.toFixed(1)} ${vbHeight.toFixed(1)}`;
  }, [zoom, pan]);

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingVertexRef.current) return;
    if (
      e.button === 0 &&
      (e.target === svgRef.current || (e.target as Element).getAttribute('data-ocean') === 'true')
    ) {
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = draggingVertexRef.current;
    if (drag) {
      const rawPt = clientToMapCoords(e.clientX, e.clientY);
      const clampedRaw: Point = {
        x: Number(Math.max(20, Math.min(MAP_WIDTH - 20, rawPt.x)).toFixed(1)),
        y: Number(Math.max(20, Math.min(MAP_HEIGHT - 20, rawPt.y)).toFixed(1)),
      };
      const shouldRecord = !drag.snapshotRecorded;
      drag.snapshotRecorded = true;

      const workingRegions = regionsRef.current;

      let candidatePt = clampedRaw;
      let candidateSnap: SnapResult | null = null;

      if (snapNodesAndEdges) {
        const snapCandidates: Point[][] = [];
        for (const r of workingRegions) {
          if (r.id === drag.regionId) continue;
          snapCandidates.push(r.polygon);
        }

        const snap = findSnapTarget(clampedRaw, snapCandidates, 16, 12);
        if (snap.kind !== 'none') {
          candidatePt = {
            x: Number(Math.max(20, Math.min(MAP_WIDTH - 20, snap.point.x)).toFixed(1)),
            y: Number(Math.max(20, Math.min(MAP_HEIGHT - 20, snap.point.y)).toFixed(1)),
          };
          candidateSnap = snap;
        }
      }

      // Enforce strict non-overlapping polygon constraint on every drag frame
      const finalPt = resolveVertexMoveNoOverlap({
        regions: workingRegions,
        draggedRegionId: drag.regionId,
        vertexIndex: drag.vertexIndex,
        sharedLinks: [],
        currentPt: drag.lastValidPt,
        targetPt: candidatePt,
        bounds: { minX: 20, minY: 20, maxX: MAP_WIDTH - 20, maxY: MAP_HEIGHT - 20 },
      });

      drag.lastValidPt = finalPt;
      setActiveSnap(
        candidateSnap && distance(finalPt, candidateSnap.point) < 0.6 ? candidateSnap : null
      );

      const applyMove = (all: Region[]): Region[] =>
        all.map((r) => {
          if (r.id !== drag.regionId) return r;
          const nextPoly = moveVertex(r.polygon, drag.vertexIndex, finalPt);
          const c = polygonCentroid(nextPoly);
          return {
            ...r,
            polygon: nextPoly,
            settlement: {
              ...r.settlement,
              mapAnchor: { x: Number(c.x.toFixed(1)), y: Number(c.y.toFixed(1)) },
            },
          };
        });

      regionsRef.current = applyMove(workingRegions);
      onUpdateRegionsBatch(applyMove, shouldRecord);
      return;
    }

    if (isPanning && panStartRef.current && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const vbWidth = MAP_WIDTH / zoom;
      const vbHeight = MAP_HEIGHT / zoom;
      const scale = Math.min(rect.width / vbWidth, rect.height / vbHeight) || 1;
      const dx = (e.clientX - panStartRef.current.clientX) / scale;
      const dy = (e.clientY - panStartRef.current.clientY) / scale;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    }
  };

  const handleSvgPointerUp = () => {
    setIsPanning(false);
    panStartRef.current = null;
    draggingVertexRef.current = null;
    setIsDraggingNode(false);
    setActiveSnap(null);
  };

  useCanvasWheel({
    svgRef,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    zoom,
    pan,
    minZoom: 0.65,
    maxZoom: 3.5,
    onZoomChange: setZoom,
    onPanChange: setPan,
  });

  const handleExportSvg = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(svgRef.current);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${continent.name.toLowerCase().replace(/\s+/g, '-')}-continent.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleInsertMidpoint = (edgeIndex: number) => {
    if (!selectedRegion) return;
    onUpdateRegion(
      selectedRegion.id,
      (r) => ({
        ...r,
        polygon: insertVertexOnEdge(r.polygon, edgeIndex),
      }),
      true
    );
  };

  const canRemoveVertex = (region: Region, vertexIdx: number): boolean => {
    if (region.polygon.length <= 3) return false;
    const nextPoly = removeVertex(region.polygon, vertexIdx);
    if (hasSelfIntersection(nextPoly)) return false;
    for (const other of regions) {
      if (other.id === region.id) continue;
      if (polygonsOverlap(nextPoly, other.polygon)) return false;
    }
    return true;
  };

  const handleRemoveVertex = (vertexIdx: number) => {
    if (!selectedRegion || !canRemoveVertex(selectedRegion, vertexIdx)) return;
    onUpdateRegion(
      selectedRegion.id,
      (r) => ({
        ...r,
        polygon: removeVertex(r.polygon, vertexIdx),
      }),
      true
    );
    setSelectedVertexIndex(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (tool !== 'edit-vertices' || selectedVertexIndex === null || !selectedRegion) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleRemoveVertex(selectedVertexIndex);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const renderLeftPanelContent = (isMobile = false) => (
    <>
      {isMobile && (
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-slate-900" style={{ fontFamily: 'var(--font-display)' }}>
            Regions &amp; Generator
          </h2>
          <button
            type="button"
            onClick={() => setMobileDrawer('none')}
            aria-label="Close regions drawer"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Color Coding Mode */}
      <div className="px-4 py-3 border-b border-slate-200 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-slate-600">
            Color Mode
          </span>
          <button
            type="button"
            onClick={() => setShowGeneratorControls((v) => !v)}
            aria-expanded={showGeneratorControls}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800 cursor-pointer py-1 px-1.5 rounded hover:bg-blue-50"
          >
            <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
            Generator
            {showGeneratorControls ? (
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-md" role="group" aria-label="Color coding mode">
          {(['biome', 'faction', 'threat'] as ColorCodingMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChangeColorMode(mode)}
              aria-pressed={colorMode === mode}
              className={`px-2 py-1.5 text-xs font-medium rounded transition-colors capitalize cursor-pointer whitespace-nowrap ${
                colorMode === mode
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Collapsible Continent Generator Parameters */}
      {showGeneratorControls && (
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-3 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-800">
              Continent Seed &amp; Shape
            </span>
            <button
              type="button"
              onClick={() =>
                onUpdateContinentConfig(
                  { ...continent, seed: Math.floor(1000 + Math.random() * 89999) },
                  true
                )
              }
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer whitespace-nowrap"
              aria-label="Randomize Seed and Regenerate"
            >
              <Shuffle className="w-3.5 h-3.5" aria-hidden="true" />
              Randomize
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor={`continent-shape-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Shape
              </label>
              <select
                id={`continent-shape-${isMobile ? 'm' : 'd'}`}
                value={continent.shape ?? 'auto'}
                onChange={(e) =>
                  onUpdateContinentConfig(
                    { ...continent, shape: e.target.value as ContinentShape },
                    true
                  )
                }
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="auto">Auto</option>
                <option value="crescent">Crescent</option>
                <option value="peninsula">Peninsula</option>
                <option value="isthmus">Isthmus</option>
                <option value="sprawling">Sprawling</option>
              </select>
            </div>
            <div>
              <label htmlFor={`continent-seed-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                World Seed
              </label>
              <input
                id={`continent-seed-${isMobile ? 'm' : 'd'}`}
                type="number"
                value={continent.seed}
                onChange={(e) =>
                  onUpdateContinentConfig(
                    { ...continent, seed: Number(e.target.value) || 1 },
                    false
                  )
                }
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`region-count-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
              Regions ({continent.regionCount})
            </label>
            <input
              id={`region-count-${isMobile ? 'm' : 'd'}`}
              type="range"
              min={5}
              max={18}
              value={continent.regionCount}
              onChange={(e) =>
                onUpdateContinentConfig(
                  { ...continent, regionCount: Number(e.target.value) },
                  true
                )
              }
              className="w-full accent-blue-700 cursor-pointer"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor={`coast-jagged-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Coastline ({Math.round(continent.coastlineJaggedness * 100)}%)
              </label>
              <input
                id={`coast-jagged-${isMobile ? 'm' : 'd'}`}
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={continent.coastlineJaggedness}
                onChange={(e) =>
                  onUpdateContinentConfig(
                    { ...continent, coastlineJaggedness: Number(e.target.value) },
                    true
                  )
                }
                className="w-full accent-blue-700 cursor-pointer"
              />
            </div>
            <div>
              <label htmlFor={`border-irreg-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Borders ({Math.round(continent.borderIrregularity * 100)}%)
              </label>
              <input
                id={`border-irreg-${isMobile ? 'm' : 'd'}`}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={continent.borderIrregularity}
                onChange={(e) =>
                  onUpdateContinentConfig(
                    { ...continent, borderIrregularity: Number(e.target.value) },
                    true
                  )
                }
                className="w-full accent-blue-700 cursor-pointer"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => onUpdateContinentConfig(continent, true)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Regenerate Continent
          </button>
        </div>
      )}

      {/* Region Search */}
      <div className="p-3 border-b border-slate-200 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter regions or settlements..."
            aria-label="Filter regions"
            className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-600"
          />
        </div>
      </div>

      {/* Region List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {filteredRegions.map((region) => {
          const spec = getRegionColorSpec(region, colorMode);
          const isSelected = region.id === selectedRegion?.id;
          const claimedCount = region.settlement.buildings.filter(
            (b) => b.claimStatus === 'claimed'
          ).length;

          return (
            <div
              key={region.id}
              className={`px-4 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelectRegion(region.id);
                  if (isMobile) setMobileDrawer('none');
                }}
                className="flex items-start gap-2.5 text-left min-w-0 flex-1 min-h-[36px] py-0.5 cursor-pointer focus:outline-none"
              >
                <span
                  className="w-3 h-3 rounded-xs mt-1 shrink-0 border border-slate-700/25"
                  style={{ backgroundColor: spec.fill }}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {region.name}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate tabular-nums">
                    {region.settlement.name} · {claimedCount}/{region.settlement.buildings.length} claimed
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onOpenSettlement(region.id)}
                aria-label={`Open settlement ${region.settlement.name}`}
                className="px-2.5 py-1.5 min-h-[34px] text-[11px] font-medium text-blue-700 hover:bg-blue-100/70 rounded cursor-pointer whitespace-nowrap shrink-0"
              >
                Open
              </button>
            </div>
          );
        })}
        {filteredRegions.length === 0 && (
          <div className="p-6 text-center text-xs text-slate-500">
            No regions match &ldquo;{searchQuery}&rdquo;.
          </div>
        )}
      </div>
    </>
  );

  const renderInspectorContent = (isMobile = false) =>
    selectedRegion ? (
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {isMobile && (
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <span className="text-xs font-semibold text-slate-600">Region Inspector</span>
            <button
              type="button"
              onClick={() => setMobileDrawer('none')}
              aria-label="Close inspector drawer"
              className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Region Header + Primary CTA */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-500">
              {selectedRegion.isCoastal ? 'Coastal Region' : 'Inland Region'}
            </span>
            {regions.length > 1 && (
              <button
                type="button"
                onClick={() => onDeleteRegion(selectedRegion.id)}
                aria-label={`Delete region ${selectedRegion.name}`}
                className="p-1.5 text-slate-400 hover:text-red-600 rounded cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <h2
              className="text-xl font-semibold text-slate-900 leading-tight truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {selectedRegion.name}
            </h2>
            <button
              type="button"
              onClick={() => {
                nameInputRef.current?.focus();
                nameInputRef.current?.select();
              }}
              aria-label="Rename region"
              title="Rename region"
              className="p-1.5 text-slate-400 hover:text-blue-700 hover:bg-blue-50 rounded cursor-pointer shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenSettlement(selectedRegion.id)}
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer"
          >
            <FolderOpen className="w-4 h-4" aria-hidden="true" />
            Open Settlement ({selectedRegion.settlement.name})
          </button>
        </div>

        <hr className="border-slate-200" />

        {/* Region Metadata Editor */}
        <div className="space-y-3">
          <div>
            <label htmlFor={`reg-name-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
              Region Name
            </label>
            <input
              ref={isMobile ? undefined : nameInputRef}
              id={`reg-name-${isMobile ? 'm' : 'd'}`}
              type="text"
              value={selectedRegion.name}
              onChange={(e) =>
                onUpdateRegion(selectedRegion.id, (r) => ({ ...r, name: e.target.value }))
              }
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor={`reg-biome-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Biome
              </label>
              <select
                id={`reg-biome-${isMobile ? 'm' : 'd'}`}
                value={selectedRegion.biome}
                onChange={(e) =>
                  onUpdateRegion(
                    selectedRegion.id,
                    (r) => ({ ...r, biome: e.target.value as BiomeType }),
                    true
                  )
                }
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              >
                {BIOME_LIST.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`reg-threat-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Threat Tier
              </label>
              <select
                id={`reg-threat-${isMobile ? 'm' : 'd'}`}
                value={selectedRegion.threat}
                onChange={(e) =>
                  onUpdateRegion(
                    selectedRegion.id,
                    (r) => ({ ...r, threat: e.target.value as ThreatTier }),
                    true
                  )
                }
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              >
                {THREAT_LIST.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.shortLabel}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor={`reg-faction-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Faction / Realm
              </label>
              <input
                id={`reg-faction-${isMobile ? 'm' : 'd'}`}
                type="text"
                list="faction-presets-list"
                value={selectedRegion.faction}
                onChange={(e) => {
                  const val = e.target.value;
                  const match = FACTION_PRESETS.find((f) => f.name === val);
                  onUpdateRegion(selectedRegion.id, (r) => ({
                    ...r,
                    faction: val,
                    factionColor: match ? match.color : r.factionColor,
                  }));
                }}
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              />
              <datalist id="faction-presets-list">
                {FACTION_PRESETS.map((f) => (
                  <option key={f.name} value={f.name} />
                ))}
              </datalist>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor={`reg-color-${isMobile ? 'm' : 'd'}`} className="text-[11px] font-medium text-slate-600">
                  Color Tint
                </label>
                {selectedRegion.customColor && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateRegion(
                        selectedRegion.id,
                        (r) => ({ ...r, customColor: undefined }),
                        true
                      )
                    }
                    className="text-[10px] text-blue-700 hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id={`reg-color-${isMobile ? 'm' : 'd'}`}
                  type="color"
                  value={
                    selectedRegion.customColor ??
                    getRegionColorSpec(selectedRegion, colorMode).fill
                  }
                  onChange={(e) =>
                    onUpdateRegion(
                      selectedRegion.id,
                      (r) => ({ ...r, customColor: e.target.value }),
                      true
                    )
                  }
                  className="w-8 h-[30px] p-0.5 border border-slate-300 rounded bg-white cursor-pointer shrink-0"
                />
                <span className="text-[11px] font-mono text-slate-500 truncate">
                  {selectedRegion.customColor ?? `Auto`}
                </span>
              </div>
            </div>
          </div>

          <div>
            <label htmlFor={`reg-lore-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
              Campaign Notes
            </label>
            <textarea
              id={`reg-lore-${isMobile ? 'm' : 'd'}`}
              rows={2}
              value={selectedRegion.loreNotes}
              onChange={(e) =>
                onUpdateRegion(selectedRegion.id, (r) => ({ ...r, loreNotes: e.target.value }))
              }
              className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        <hr className="border-slate-200" />

        {/* Simplified Polygon Geometry Controls */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                Region Borders
              </h3>
              <p className="text-[11px] font-mono tabular-nums text-slate-500">
                {selectedRegion.polygon.length} border points ·{' '}
                {Math.round(polygonArea(selectedRegion.polygon) * 0.42).toLocaleString()} sq mi
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setTool(tool === 'edit-vertices' ? 'select' : 'edit-vertices');
                  if (isMobile) setMobileDrawer('none');
                }}
                className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded cursor-pointer whitespace-nowrap shrink-0"
              >
                {tool === 'edit-vertices' ? 'Done' : 'Edit Borders'}
              </button>
            </div>
          </div>

          {tool === 'edit-vertices' && selectedVertexIndex !== null && (
            <div className="flex items-center justify-between px-2.5 py-2 bg-blue-50 border border-blue-200 rounded text-xs">
              <span className="font-mono text-blue-900 tabular-nums">
                Node #{selectedVertexIndex + 1}
              </span>
              <button
                type="button"
                disabled={!canRemoveVertex(selectedRegion, selectedVertexIndex)}
                onClick={() => handleRemoveVertex(selectedVertexIndex)}
                className="text-red-700 font-medium hover:underline disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                Remove Node
              </button>
            </div>
          )}
        </div>

        <hr className="border-slate-200" />

        {/* Main Settlement Summary */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900">
              Main Settlement
            </h3>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {
                selectedRegion.settlement.buildings.filter((b) => b.claimStatus === 'claimed')
                  .length
              }
              /{selectedRegion.settlement.buildings.length} claimed
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor={`set-name-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Name
              </label>
              <input
                id={`set-name-${isMobile ? 'm' : 'd'}`}
                type="text"
                value={selectedRegion.settlement.name}
                onChange={(e) =>
                  onUpdateRegion(selectedRegion.id, (r) => ({
                    ...r,
                    settlement: { ...r.settlement, name: e.target.value },
                  }))
                }
                className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
            <div>
              <label htmlFor={`set-tier-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Tier
              </label>
              <select
                id={`set-tier-${isMobile ? 'm' : 'd'}`}
                value={selectedRegion.settlement.tier}
                onChange={(e) =>
                  onUpdateRegion(
                    selectedRegion.id,
                    (r) => ({
                      ...r,
                      settlement: { ...r.settlement, tier: e.target.value as SettlementTier },
                    }),
                    true
                  )
                }
                className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="hamlet">Hamlet</option>
                <option value="town">Market Town</option>
                <option value="city">Walled City</option>
                <option value="capital">Grand Capital</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    ) : (
      <div className="p-6 text-center text-xs text-slate-500">
        Select a region on the continent map to inspect its borders and settlement.
      </div>
    );

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden bg-[#F5F6F8] relative">
      {/* Desktop Left Sidebar */}
      {desktopLeftOpen && (
        <aside className="hidden lg:flex w-[264px] shrink-0 bg-white border-r border-slate-200 flex-col min-h-0">
          {renderLeftPanelContent(false)}
        </aside>
      )}

      {/* Center Map Viewport */}
      <main className="flex-1 relative min-w-0 flex flex-col cartography-grid overflow-hidden">
        {/* Unified Top Map Toolbar Row */}
        <div className="absolute top-2.5 inset-x-2.5 sm:top-3 sm:inset-x-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pointer-events-auto">
            {/* Desktop Left Panel Toggle */}
            <button
              type="button"
              onClick={() => setDesktopLeftOpen((v) => !v)}
              aria-label={desktopLeftOpen ? 'Hide region list' : 'Show region list'}
              className="hidden lg:inline-flex items-center justify-center p-2 bg-white border border-slate-200 rounded-md shadow-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 cursor-pointer"
            >
              {desktopLeftOpen ? (
                <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
              )}
            </button>

            <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-md shadow-xs">
              <button
                type="button"
                onClick={() => {
                  setTool('select');
                  setSelectedVertexIndex(null);
                }}
                aria-pressed={tool === 'select'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                  tool === 'select'
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <MousePointer className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Select &amp; Pan</span>
                <span className="sm:hidden">Pan</span>
              </button>
              <button
                type="button"
                onClick={() => setTool('edit-vertices')}
                aria-pressed={tool === 'edit-vertices'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-xs font-medium rounded cursor-pointer whitespace-nowrap ${
                  tool === 'edit-vertices'
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                Edit Borders
              </button>
            </div>

            {tool === 'edit-vertices' && (
              <div className="flex items-center gap-1.5">
                <label className="inline-flex items-center gap-1.5 px-2.5 py-2 min-h-[40px] bg-white border border-slate-200 rounded-md shadow-xs text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={snapNodesAndEdges}
                    onChange={(e) => setSnapNodesAndEdges(e.target.checked)}
                    className="accent-blue-700 rounded cursor-pointer"
                  />
                  Edge Snap
                </label>
                {selectedRegion && selectedVertexIndex !== null && (
                  <button
                    type="button"
                    disabled={!canRemoveVertex(selectedRegion, selectedVertexIndex)}
                    onClick={() => handleRemoveVertex(selectedVertexIndex)}
                    title={
                      canRemoveVertex(selectedRegion, selectedVertexIndex)
                        ? 'Delete selected node (Del)'
                        : 'Cannot delete: minimum 3 nodes or would overlap neighbor'
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[40px] bg-white border border-slate-200 rounded-md shadow-xs text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Delete Node</span>
                    <span className="sm:hidden">Delete</span>
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-0.5 p-1 bg-white border border-slate-200 rounded-md shadow-xs">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Undo map change"
                className="p-1.5 min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-35 rounded cursor-pointer disabled:cursor-not-allowed"
              >
                <Undo2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                aria-label="Redo map change"
                className="p-1.5 min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-35 rounded cursor-pointer disabled:cursor-not-allowed"
              >
                <Redo2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="w-px h-4 bg-slate-200 mx-0.5" aria-hidden="true" />
              <button
                type="button"
                onClick={() => {
                  onAddRegion();
                  if (desktopRightOpen && window.innerWidth >= 1024) {
                    setTimeout(() => {
                      nameInputRef.current?.focus();
                      nameInputRef.current?.select();
                    }, 40);
                  }
                }}
                aria-label="Add Region"
                className="inline-flex items-center gap-1 px-2 py-1 min-h-[34px] text-xs font-medium text-slate-700 hover:bg-slate-100 rounded cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Add Region</span>
                <span className="sm:hidden">Region</span>
              </button>
            </div>
          </div>

          {/* Right Zoom, Export & Inspector Toggle */}
          <div className="flex items-center gap-1.5 sm:gap-2 pointer-events-auto">
            <div className="flex items-center gap-0.5 p-1 bg-white border border-slate-200 rounded-md shadow-xs">
              <button
                type="button"
                onClick={() => setZoom((z) => Number(Math.max(0.65, z - 0.15).toFixed(2)))}
                aria-label="Zoom out"
                className="p-1.5 min-h-[34px] min-w-[32px] inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
              >
                <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="px-1.5 text-xs font-mono tabular-nums text-slate-700 hidden sm:inline">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Number(Math.min(3.5, z + 0.15).toFixed(2)))}
                aria-label="Zoom in"
                className="p-1.5 min-h-[34px] min-w-[32px] inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
              >
                <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                aria-label="Reset map view"
                className="p-1.5 min-h-[34px] min-w-[32px] inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleExportSvg}
              aria-label="Export SVG"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-md shadow-xs text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export SVG
            </button>

            <button
              type="button"
              onClick={() => setDesktopRightOpen((v) => !v)}
              aria-label={desktopRightOpen ? 'Hide region inspector' : 'Show region inspector'}
              className="hidden lg:inline-flex items-center justify-center p-2 bg-white border border-slate-200 rounded-md shadow-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 cursor-pointer"
            >
              {desktopRightOpen ? (
                <PanelRightClose className="w-4 h-4" aria-hidden="true" />
              ) : (
                <PanelRightOpen className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Continent Cartography SVG */}
        <svg
          ref={svgRef}
          data-testid="continent-canvas"
          viewBox={viewBoxStr}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerUp}
          className={`w-full h-full select-none touch-none overscroll-none ${
            isDraggingNode
              ? 'cursor-grabbing'
              : isPanning
                ? 'cursor-grabbing'
                : tool === 'edit-vertices'
                  ? 'cursor-crosshair'
                  : 'cursor-grab'
          }`}
        >
          <defs>
            <filter id="coast-halo" x="-8%" y="-8%" width="116%" height="116%">
              <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#64748B" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* Ocean backdrop click target */}
          <rect
            x={-1200}
            y={-1200}
            width={MAP_WIDTH + 2400}
            height={MAP_HEIGHT + 2400}
            fill="transparent"
            data-ocean="true"
          />

          {/* Subtle Latitude/Longitude graticule */}
          <g stroke="#94A3B8" strokeOpacity="0.2" strokeWidth={0.8} pointerEvents="none">
            {[180, 360, 540, 720, 900, 1080].map((x) => (
              <line key={`gx-${x}`} x1={x} y1={0} x2={x} y2={MAP_HEIGHT} strokeDasharray="4 6" />
            ))}
            {[160, 320, 480, 640].map((y) => (
              <line key={`gy-${y}`} x1={0} y1={y} x2={MAP_WIDTH} y2={y} strokeDasharray="4 6" />
            ))}
          </g>

          {/* Continent Shoreline Outer Halo */}
          <g filter="url(#coast-halo)" pointerEvents="none">
            {regions.map((r) => (
              <path
                key={`halo-${r.id}`}
                d={pointsToSvgPath(r.polygon)}
                fill="#C7D7E6"
                stroke="#9DB6CE"
                strokeWidth={8}
                strokeLinejoin="round"
              />
            ))}
          </g>

          {/* Irregular Color-Coded Region Polygons */}
          <g>
            {regions.map((region) => {
              const isSelected = region.id === selectedRegion?.id;
              const spec = getRegionColorSpec(region, colorMode);
              const centroid = polygonCentroid(region.polygon);

              return (
                <g key={region.id}>
                  <path
                    d={pointsToSvgPath(region.polygon)}
                    fill={spec.fill}
                    fillOpacity={isSelected ? 0.96 : 0.86}
                    stroke={isSelected ? '#0F172A' : spec.stroke}
                    strokeWidth={isSelected ? 2.4 : 1.25}
                    strokeLinejoin="round"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRegion(region.id);
                      setSelectedVertexIndex(null);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onOpenSettlement(region.id);
                    }}
                    className="cursor-pointer transition-opacity"
                  />

                  {/* Region Title */}
                  <text
                    x={centroid.x}
                    y={centroid.y - 11}
                    textAnchor="middle"
                    pointerEvents="none"
                    fill="#0F172A"
                    fontSize={12.5}
                    fontWeight={600}
                    style={{
                      fontFamily: 'var(--font-display)',
                      paintOrder: 'stroke',
                      stroke: 'rgba(255,255,255,0.78)',
                      strokeWidth: 3.5,
                      strokeLinejoin: 'round',
                    }}
                  >
                    {region.name}
                  </text>

                  {/* Main Settlement Marker */}
                  <g
                    transform={`translate(${region.settlement.mapAnchor.x}, ${region.settlement.mapAnchor.y + 8})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectRegion(region.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onOpenSettlement(region.id);
                    }}
                    className="cursor-pointer"
                  >
                    <circle
                      r={region.settlement.tier === 'capital' ? 6.5 : 5}
                      fill={isSelected ? '#1D4ED8' : '#FFFFFF'}
                      stroke="#0F172A"
                      strokeWidth={1.6}
                    />
                    {region.settlement.tier === 'capital' && (
                      <circle r={2.2} fill={isSelected ? '#FFFFFF' : '#0F172A'} />
                    )}
                    <text
                      y={15}
                      textAnchor="middle"
                      fill="#1E293B"
                      fontSize={10.5}
                      fontWeight={600}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        paintOrder: 'stroke',
                        stroke: 'rgba(255,255,255,0.85)',
                        strokeWidth: 3,
                      }}
                    >
                      {region.settlement.name}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>

          {/* Vertex & Edge Editing Overlay */}
          {tool === 'edit-vertices' && selectedRegion && (
            <g>
              {/* Highlight selected polygon outline */}
              <path
                d={pointsToSvgPath(selectedRegion.polygon)}
                fill="none"
                stroke="#1D4ED8"
                strokeWidth={2.2}
                strokeDasharray="6 3"
                pointerEvents="none"
              />

              {/* Active Snap Target Feedback */}
              {activeSnap && activeSnap.kind !== 'none' && (
                <g pointerEvents="none">
                  {activeSnap.kind === 'edge' && activeSnap.edgeSegment && (
                    <line
                      x1={activeSnap.edgeSegment[0].x}
                      y1={activeSnap.edgeSegment[0].y}
                      x2={activeSnap.edgeSegment[1].x}
                      y2={activeSnap.edgeSegment[1].y}
                      stroke="#2563EB"
                      strokeWidth={3.2}
                      strokeLinecap="round"
                    />
                  )}
                  <circle
                    cx={activeSnap.point.x}
                    cy={activeSnap.point.y}
                    r={11}
                    fill="none"
                    stroke={activeSnap.kind === 'vertex' ? '#D97706' : '#2563EB'}
                    strokeWidth={2}
                    strokeDasharray="3 2"
                  />
                </g>
              )}

              {/* Edge midpoint handles (click to insert node) */}
              {selectedRegion.polygon.map((pt, idx) => {
                const nextPt = selectedRegion.polygon[(idx + 1) % selectedRegion.polygon.length];
                if (distance(pt, nextPt) < 34) return null;
                const mx = (pt.x + nextPt.x) / 2;
                const my = (pt.y + nextPt.y) / 2;
                return (
                  <g
                    key={`mid-${idx}`}
                    transform={`translate(${mx}, ${my})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleInsertMidpoint(idx);
                    }}
                    className="cursor-pointer"
                  >
                    <circle r={12} fill="transparent" />
                    <circle r={5.5} fill="#FFFFFF" stroke="#1D4ED8" strokeWidth={1.5} />
                    <line x1={-2.5} y1={0} x2={2.5} y2={0} stroke="#1D4ED8" strokeWidth={1.4} />
                    <line x1={0} y1={-2.5} x2={0} y2={2.5} stroke="#1D4ED8" strokeWidth={1.4} />
                  </g>
                );
              })}

              {/* Adjustable polygon node handles */}
              {selectedRegion.polygon.map((pt, idx) => {
                const isActiveVertex = selectedVertexIndex === idx;
                return (
                  <g
                    key={`v-${idx}`}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      try {
                        svgRef.current?.setPointerCapture(e.pointerId);
                      } catch {
                        // Ignore synthetic pointer events
                      }
                      setSelectedVertexIndex(idx);
                      setIsDraggingNode(true);
                      draggingVertexRef.current = {
                        regionId: selectedRegion.id,
                        vertexIndex: idx,
                        lastValidPt: { x: pt.x, y: pt.y },
                        snapshotRecorded: false,
                      };
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleRemoveVertex(idx);
                    }}
                    className="cursor-move"
                  >
                    {/* Large touch-friendly invisible hit circle */}
                    <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isActiveVertex ? 7.5 : 6}
                      fill={isActiveVertex ? '#1D4ED8' : '#FFFFFF'}
                      stroke="#0F172A"
                      strokeWidth={1.8}
                    />
                  </g>
                );
              })}
            </g>
          )}

          {/* Map Title Cartouche & Scale Bar (Bottom-Right inside SVG) */}
          <g transform={`translate(${MAP_WIDTH - 220}, ${MAP_HEIGHT - 64})`} pointerEvents="none">
            <text
              x={190}
              y={14}
              textAnchor="end"
              fill="#0F172A"
              fontSize={16}
              fontWeight={600}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {continent.name}
            </text>
            <line x1={70} y1={28} x2={190} y2={28} stroke="#334155" strokeWidth={1.8} />
            <line x1={70} y1={23} x2={70} y2={33} stroke="#334155" strokeWidth={1.8} />
            <line x1={130} y1={25} x2={130} y2={31} stroke="#334155" strokeWidth={1.2} />
            <line x1={190} y1={23} x2={190} y2={33} stroke="#334155" strokeWidth={1.8} />
            <text
              x={190}
              y={42}
              textAnchor="end"
              fill="#475569"
              fontSize={10}
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              0 — 150 leagues
            </text>
          </g>
        </svg>

        {/* Bottom Overlay Row: Compact Legend + Mobile Drawer Triggers */}
        <div className="absolute bottom-2.5 inset-x-2.5 sm:bottom-3 sm:inset-x-3 z-10 flex flex-wrap items-end justify-between gap-2 pointer-events-none">
          <div className="pointer-events-auto">
            {showLegend ? (
              <div className="bg-white/95 border border-slate-200 rounded-md px-3 py-2 shadow-xs max-w-md">
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span className="text-[11px] font-semibold text-slate-700 capitalize">
                    {colorMode} Key
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowLegend(false)}
                    aria-label="Hide map key"
                    className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {legendItems.map((item) => (
                    <div key={item.key} className="flex items-center gap-1.5 text-[11px] text-slate-700">
                      <span
                        className="w-2.5 h-2.5 rounded-xs border border-slate-700/25 shrink-0"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowLegend(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] bg-white/95 border border-slate-200 rounded-md shadow-xs text-xs font-medium text-slate-700 hover:bg-white cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                Key
              </button>
            )}
          </div>

          {/* Mobile Drawer Action Bar (< lg) */}
          <div className="flex lg:hidden items-center gap-2 pointer-events-auto ml-auto">
            <button
              type="button"
              onClick={() => setMobileDrawer('regions')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-white border border-slate-300 rounded-md shadow-xs text-xs font-semibold text-slate-800 cursor-pointer"
            >
              Regions ({regions.length})
            </button>
            {selectedRegion && (
              <button
                type="button"
                onClick={() => setMobileDrawer('inspector')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-blue-700 text-white rounded-md shadow-xs text-xs font-semibold cursor-pointer max-w-[165px] truncate"
              >
                {selectedRegion.name}
              </button>
            )}
          </div>

          {tool === 'edit-vertices' && selectedRegion && (
            <div className="hidden lg:block bg-white/95 border border-slate-200 rounded-md px-3 py-2 shadow-xs text-[11px] text-slate-600 pointer-events-auto">
              Drag nodes freely (node-to-node &amp; node-to-line snap) · Click <strong className="text-slate-900">+</strong> to add · Right-click to remove
            </div>
          )}
        </div>
      </main>

      {/* Desktop Right Inspector */}
      {desktopRightOpen && (
        <aside className="hidden lg:flex w-[304px] shrink-0 bg-white border-l border-slate-200 flex-col min-h-0">
          {renderInspectorContent(false)}
        </aside>
      )}

      {/* Mobile Overlay Sheet (< lg) */}
      {mobileDrawer !== 'none' && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/40 flex flex-col justify-end"
          onClick={() => setMobileDrawer('none')}
        >
          <div
            className="bg-white border-t border-slate-200 rounded-t-xl shadow-xl max-h-[78vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {mobileDrawer === 'regions' ? renderLeftPanelContent(true) : renderInspectorContent(true)}
          </div>
        </div>
      )}
    </div>
  );
};
