import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  Grid,
  Layers,
  Link2,
  Maximize2,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BUILDING_PURPOSES,
  BUILDING_PURPOSE_LIST,
  SETTLEMENT_TIER_META,
} from '../data/presets';
import {
  BuildingFootprint,
  BuildingPurpose,
  BuildingShape,
  ClaimStatus,
  Point,
  Region,
  SettlementTier,
} from '../types/world';
import {
  CITY_HEIGHT,
  CITY_WIDTH,
  buildFootprintGeometry,
  claimBuilding,
  computeBuildingAreaSqFt,
  createCustomBuilding,
  populateEssentialBuildings,
  unclaimBuilding,
} from '../utils/cityGenerator';
import {
  distance,
  pointsToSvgPath,
  polygonArea,
  polygonBounds,
  polygonCentroid,
} from '../utils/polygonOps';
import { useCanvasWheel } from '../hooks/useCanvasWheel';
import { findOverlappingBuildingIds, nudgeBuildingClear } from '../utils/interiorLink';

interface SettlementViewProps {
  continentName: string;
  region: Region;
  regions: Region[];
  onCreateInterior: (regionId: string, buildingId: string, mode: 'blank' | 'generate') => void;
  onOpenInterior: (regionId: string, buildingId: string) => void;
  onDetachInterior: (regionId: string, buildingId: string) => void;
  /** Building to select on arrival, for example when coming back from its interior */
  initialBuildingId?: string | null;
  onBackToContinent: () => void;
  onSwitchRegion: (regionId: string) => void;
  onUpdateRegion: (regionId: string, updater: (r: Region) => Region, recordHistory?: boolean) => void;
  onRegenerateSettlement: (regionId: string, tier: SettlementTier, seed: number) => void;
}

type ClaimFilter = 'all' | ClaimStatus;

const SUGGESTED_NAMES: Record<BuildingPurpose, string[]> = {
  tavern: ['The Copper Lantern', 'The Weary Stag', 'Wayfarer’s Rest', 'The Salt & Anchor'],
  smith: ['Ironbark Anvil', 'Cinder & Hammer Forge', 'Redhearth Smithy'],
  alchemist: ['Vellum & Vial', 'Nightshade Apothecary', 'The Amber Alembic'],
  guildhall: ['Merchants’ Guildhall', 'Chartered Factors Hall', 'Syndic House'],
  temple: ['Sanctuary of the Dawn', 'Chapel of Quiet Waters', 'High Vigil Shrine'],
  manor: ['Vanecrest Manor', 'House Aldermere', 'Thornhill Estate'],
  barracks: ['Watchtower Garrison', 'Eastgate Wardens', 'Civic Guardhouse'],
  tower: ['Astral Spire', 'Observatory of Solis', 'Magister’s Tower'],
  market: ['Granary Exchange', 'Bonded Spice Depot', 'Harbor Storehouse'],
  archive: ['Cartographer’s Archive', 'Hall of Deeds', 'Scriptorium'],
  residence: ['Stonebrook House', 'Merchant’s Townhouse', 'Alder Row'],
  custom: ['Chartered Hall', 'Surveyed Annex'],
};

export const SettlementView: React.FC<SettlementViewProps> = ({
  continentName,
  region,
  regions,
  onCreateInterior,
  onOpenInterior,
  onDetachInterior,
  initialBuildingId,
  onBackToContinent,
  onSwitchRegion,
  onUpdateRegion,
  onRegenerateSettlement,
}) => {
  const { settlement } = region;
  const overlappingIds = useMemo(
    () => findOverlappingBuildingIds(settlement.buildings),
    [settlement.buildings]
  );
  const [filter, setFilter] = useState<ClaimFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(() =>
    initialBuildingId && settlement.buildings.some((b) => b.id === initialBuildingId)
      ? initialBuildingId
      : settlement.buildings[0]?.id ?? null
  );
  const [placingNewLot, setPlacingNewLot] = useState(false);
  const [populateNotice, setPopulateNotice] = useState<string | null>(null);

  // Noise-reduction & responsive drawer state
  const [showCitySettings, setShowCitySettings] = useState(false);
  const [showGeometryEditor, setShowGeometryEditor] = useState(true);
  const [desktopLeftOpen, setDesktopLeftOpen] = useState(true);
  const [desktopRightOpen, setDesktopRightOpen] = useState(true);
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'lots' | 'inspector'>('none');
  const [showKey, setShowKey] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );

  // Shape Node Editing & Rotated Grid Snap State
  const [isEditingShape, setIsEditingShape] = useState(false);
  const [selectedNodeIdx, setSelectedNodeIdx] = useState<number | null>(null);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [gridStepFt, setGridStepFt] = useState<number>(5);

  // Pan & zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);

  // Dragging or rotating selected building (synchronous refs prevent stale state on fast pointermove)
  const draggingBuildingRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    snapshotRecorded: boolean;
  } | null>(null);
  const draggingRotationRef = useRef<{
    id: string;
    center: Point;
    snapshotRecorded: boolean;
  } | null>(null);
  const draggingNodeRef = useRef<{
    buildingId: string;
    vertexIdx: number;
    snapshotRecorded: boolean;
  } | null>(null);
  const [isDraggingBuilding, setIsDraggingBuilding] = useState(false);

  // Claiming form state synced when selection changes
  const selectedBuilding = useMemo(
    () => settlement.buildings.find((b) => b.id === selectedBuildingId) ?? null,
    [settlement.buildings, selectedBuildingId]
  );
  const interiorDriven = Boolean(selectedBuilding?.interiorLink);

  const [formPurpose, setFormPurpose] = useState<BuildingPurpose>('tavern');
  const [formCustomPurpose, setFormCustomPurpose] = useState('');
  const [formName, setFormName] = useState('');
  const [formMapLabel, setFormMapLabel] = useState('');
  const [formFloors, setFormFloors] = useState(2);
  const [formNotes, setFormNotes] = useState('');

  // Interior Link modal state
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const handleWindowPointerUp = () => {
      setIsPanning(false);
      panStartRef.current = null;
      draggingBuildingRef.current = null;
      draggingRotationRef.current = null;
      draggingNodeRef.current = null;
      setIsDraggingBuilding(false);
    };
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
    };
  }, []);

  const syncFormFromBuilding = (b: BuildingFootprint | null) => {
    if (!b) return;
    setFormPurpose(b.purpose ?? 'tavern');
    setFormCustomPurpose(b.customPurposeLabel ?? '');
    setFormName(b.assignedName ?? '');
    setFormMapLabel(b.mapLabel ?? '');
    setFormFloors(b.floors);
    setFormNotes(b.notes ?? '');
  };

  // The form is filled when a lot is clicked; fill it for the lot that is already
  // selected when this view opens too, so it never shows blanks for a named building.
  const didInitialSyncRef = useRef(false);
  useEffect(() => {
    if (didInitialSyncRef.current) return;
    didInitialSyncRef.current = true;
    syncFormFromBuilding(settlement.buildings.find((b) => b.id === selectedBuildingId) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectBuilding = (b: BuildingFootprint) => {
    setSelectedBuildingId(b.id);
    syncFormFromBuilding(b);
  };

  const claimedCount = useMemo(
    () => settlement.buildings.filter((b) => b.claimStatus === 'claimed').length,
    [settlement.buildings]
  );
  const unclaimedCount = settlement.buildings.length - claimedCount;

  const filteredBuildings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return settlement.buildings.filter((b) => {
      if (filter !== 'all' && b.claimStatus !== filter) return false;
      if (!q) return true;
      const pLabel = b.purpose ? BUILDING_PURPOSES[b.purpose].label.toLowerCase() : 'unclaimed';
      return (
        b.label.toLowerCase().includes(q) ||
        (b.assignedName ?? '').toLowerCase().includes(q) ||
        (b.mapLabel ?? '').toLowerCase().includes(q) ||
        b.district.toLowerCase().includes(q) ||
        pLabel.includes(q)
      );
    });
  }, [settlement.buildings, filter, searchQuery]);

  const viewBoxStr = useMemo(() => {
    const vbW = CITY_WIDTH / zoom;
    const vbH = CITY_HEIGHT / zoom;
    const vbX = (CITY_WIDTH - vbW) / 2 - pan.x;
    const vbY = (CITY_HEIGHT - vbH) / 2 - pan.y;
    return `${vbX.toFixed(1)} ${vbY.toFixed(1)} ${vbW.toFixed(1)} ${vbH.toFixed(1)}`;
  }, [zoom, pan]);

  const clientToCityCoords = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: pt.x, y: pt.y };
    }
    const rect = svg.getBoundingClientRect();
    const vbW = CITY_WIDTH / zoom;
    const vbH = CITY_HEIGHT / zoom;
    const vbX = (CITY_WIDTH - vbW) / 2 - pan.x;
    const vbY = (CITY_HEIGHT - vbH) / 2 - pan.y;
    const scale = Math.min(rect.width / vbW, rect.height / vbH) || 1;
    const offsetX = (rect.width - vbW * scale) / 2;
    const offsetY = (rect.height - vbH * scale) / 2;
    return {
      x: vbX + (clientX - rect.left - offsetX) / scale,
      y: vbY + (clientY - rect.top - offsetY) / scale,
    };
  };

  const updateBuilding = (
    buildingId: string,
    updater: (b: BuildingFootprint) => BuildingFootprint,
    recordHistory = true
  ) => {
    onUpdateRegion(
      region.id,
      (r) => ({
        ...r,
        settlement: {
          ...r.settlement,
          buildings: r.settlement.buildings.map((b) =>
            b.id === buildingId ? updater(b) : b
          ),
        },
      }),
      recordHistory
    );
  };

  const snapPointToRotatedGrid = (
    pt: Point,
    _center: Point,
    rotationDeg: number,
    stepFt: number,
    enabled: boolean
  ): Point => {
    if (!enabled || stepFt <= 0) return pt;
    const scale = 0.68; // px per ft
    const stepPx = Math.max(1, stepFt * scale);
    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Project into world-origin frame rotated by building orientation (no center offset)
    const u = pt.x * cos + pt.y * sin;
    const v = -pt.x * sin + pt.y * cos;

    // Snap in rotated frame
    const snappedU = Math.round(u / stepPx) * stepPx;
    const snappedV = Math.round(v / stepPx) * stepPx;

    // Unproject back to world coordinates
    return {
      x: Number((snappedU * cos - snappedV * sin).toFixed(1)),
      y: Number((snappedU * sin + snappedV * cos).toFixed(1)),
    };
  };

  const recomputeBuildingGeometry = (
    b: BuildingFootprint,
    newPoly: Point[]
  ): BuildingFootprint => {
    const rad = (b.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const scale = 0.68;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    for (const p of newPoly) {
      const dx = p.x - b.center.x;
      const dy = p.y - b.center.y;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const widthFt = Math.max(12, Math.round((maxU - minU) / scale));
    const depthFt = Math.max(12, Math.round((maxV - minV) / scale));

    const c = polygonCentroid(newPoly);
    const center: Point = {
      x: Number(c.x.toFixed(1)),
      y: Number(c.y.toFixed(1)),
    };

    return {
      ...b,
      center,
      polygon: newPoly,
      shape: 'custom',
      widthFt,
      depthFt,
    };
  };

  const handleStartEditShape = (b: BuildingFootprint) => {
    if (b.interiorLink) return; // outline is driven by the interior
    handleSelectBuilding(b);
    setIsEditingShape(true);
    setSelectedNodeIdx(null);
    setShowGeometryEditor(true);

    // 2. Automatically zooms and centers to comfortable view and edit the building shape
    const targetPan: Point = {
      x: Number((CITY_WIDTH / 2 - b.center.x).toFixed(1)),
      y: Number((CITY_HEIGHT / 2 - b.center.y).toFixed(1)),
    };
    const maxDim = Math.max(b.widthFt, b.depthFt, 30);
    const comfortableZoom = Number(Math.max(2.4, Math.min(3.8, 200 / maxDim)).toFixed(2));

    setPan(targetPan);
    setZoom(comfortableZoom);

    if (mobileDrawer !== 'none') {
      setMobileDrawer('none');
    }
  };

  const handleExitEditShape = () => {
    setIsEditingShape(false);
    setSelectedNodeIdx(null);
  };

  const handleAddNodeAtPosition = (b: BuildingFootprint, edgeIdx: number, rawPt: Point) => {
    const snapped = snapPointToRotatedGrid(
      rawPt,
      b.center,
      b.rotationDeg,
      gridStepFt,
      gridSnapEnabled
    );
    const nextPoly = [...b.polygon];
    nextPoly.splice(edgeIdx + 1, 0, snapped);
    const updated = recomputeBuildingGeometry(b, nextPoly);
    updateBuilding(b.id, () => updated, true);
    setSelectedNodeIdx(edgeIdx + 1);
  };

  const handleDeleteNode = (vertexIdx: number) => {
    if (!selectedBuilding || selectedBuilding.polygon.length <= 3) return;
    const nextPoly = selectedBuilding.polygon.filter((_, idx) => idx !== vertexIdx);
    const updated = recomputeBuildingGeometry(selectedBuilding, nextPoly);
    updateBuilding(selectedBuilding.id, () => updated, true);
    setSelectedNodeIdx(null);
  };

  const renderRotatedGrid = (b: BuildingFootprint) => {
    const scale = 0.68;
    const stepPx = Math.max(1, gridStepFt * scale);
    const pad = 120;
    const halfW = (b.widthFt * scale) / 2 + pad;
    const halfD = (b.depthFt * scale) / 2 + pad;

    const rad = (b.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Project building center into the world-origin rotated (u, v) space
    // so grid lines rotate with the building without shifting when nodes move
    const uCenter = b.center.x * cos + b.center.y * sin;
    const vCenter = -b.center.x * sin + b.center.y * cos;

    const uMin = uCenter - halfW;
    const uMax = uCenter + halfW;
    const vMin = vCenter - halfD;
    const vMax = vCenter + halfD;

    const uStartIdx = Math.floor(uMin / stepPx);
    const uEndIdx = Math.ceil(uMax / stepPx);
    const vStartIdx = Math.floor(vMin / stepPx);
    const vEndIdx = Math.ceil(vMax / stepPx);

    const uIndices: number[] = [];
    for (let idx = uStartIdx; idx <= uEndIdx; idx++) {
      uIndices.push(idx);
    }

    const vIndices: number[] = [];
    for (let idx = vStartIdx; idx <= vEndIdx; idx++) {
      vIndices.push(idx);
    }

    return (
      <g
        transform={`rotate(${b.rotationDeg})`}
        pointerEvents="none"
      >
        {/* Drafting perimeter boundary */}
        <rect
          x={uMin}
          y={vMin}
          width={halfW * 2}
          height={halfD * 2}
          fill="#3B82F6"
          fillOpacity={0.035}
          stroke="#3B82F6"
          strokeWidth={1}
          strokeDasharray="4 4"
          strokeOpacity={0.4}
          rx={6}
        />

        {/* Grid lines along U */}
        {uIndices.map((idx) => {
          const u = idx * stepPx;
          const isMajor = idx % 4 === 0;
          return (
            <line
              key={`u-${idx}`}
              x1={u}
              y1={vMin}
              x2={u}
              y2={vMax}
              stroke={isMajor ? '#2563EB' : '#64748B'}
              strokeWidth={isMajor ? 0.9 : 0.55}
              strokeDasharray={isMajor ? undefined : '2 2'}
              strokeOpacity={isMajor ? 0.35 : 0.25}
            />
          );
        })}

        {/* Grid lines along V */}
        {vIndices.map((idx) => {
          const v = idx * stepPx;
          const isMajor = idx % 4 === 0;
          return (
            <line
              key={`v-${idx}`}
              x1={uMin}
              y1={v}
              x2={uMax}
              y2={v}
              stroke={isMajor ? '#2563EB' : '#64748B'}
              strokeWidth={isMajor ? 0.9 : 0.55}
              strokeDasharray={isMajor ? undefined : '2 2'}
              strokeOpacity={isMajor ? 0.35 : 0.25}
            />
          );
        })}

        {/* Orientation & Snap indicator */}
        <text
          x={uMin + 8}
          y={vMin + 16}
          fill="#2563EB"
          fontSize={10}
          fontWeight={700}
          fontFamily="var(--font-mono)"
          letterSpacing="0.05em"
        >
          {b.rotationDeg}° ROTATED GRID · {gridSnapEnabled ? `${gridStepFt} FT SNAP` : 'SNAP OFF'}
        </text>
      </g>
    );
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (isEditingShape && selectedBuilding) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIdx !== null) {
          if (selectedBuilding.polygon.length > 3) {
            e.preventDefault();
            handleDeleteNode(selectedNodeIdx);
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleExitEditShape();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditingShape, selectedBuilding, selectedNodeIdx]);

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draggingBuildingRef.current || draggingRotationRef.current) return;
    if (placingNewLot && e.button === 0) {
      const pt = clientToCityCoords(e.clientX, e.clientY);
      const created = createCustomBuilding(
        settlement.id,
        settlement.buildings.length + 1,
        { x: Number(pt.x.toFixed(1)), y: Number(pt.y.toFixed(1)) }
      );
      onUpdateRegion(
        region.id,
        (r) => ({
          ...r,
          settlement: {
            ...r.settlement,
            buildings: [...r.settlement.buildings, created],
          },
        }),
        true
      );
      setPlacingNewLot(false);
      handleSelectBuilding(created);
      return;
    }

    if (
      e.button === 0 &&
      (e.target === svgRef.current || (e.target as Element).getAttribute('data-ground') === 'true')
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
    const nodeDrag = draggingNodeRef.current;
    if (nodeDrag) {
      const pt = clientToCityCoords(e.clientX, e.clientY);
      const b = settlement.buildings.find((x) => x.id === nodeDrag.buildingId);
      if (b) {
        const snapped = snapPointToRotatedGrid(
          pt,
          b.center,
          b.rotationDeg,
          gridStepFt,
          gridSnapEnabled
        );
        const nextPoly = b.polygon.map((v, i) => (i === nodeDrag.vertexIdx ? snapped : v));
        const record = !nodeDrag.snapshotRecorded;
        nodeDrag.snapshotRecorded = true;
        const updated = recomputeBuildingGeometry(b, nextPoly);
        updateBuilding(b.id, () => updated, record);
      }
      return;
    }

    const rotDrag = draggingRotationRef.current;
    if (rotDrag) {
      const pt = clientToCityCoords(e.clientX, e.clientY);
      const rawDeg = (Math.atan2(pt.x - rotDrag.center.x, -(pt.y - rotDrag.center.y)) * 180) / Math.PI;
      const step = e.shiftKey ? 1 : 5;
      const snappedDeg = ((Math.round(rawDeg / step) * step) % 360 + 360) % 360;
      const record = !rotDrag.snapshotRecorded;
      rotDrag.snapshotRecorded = true;
      updateBuilding(
        rotDrag.id,
        (b) => {
          if (b.shape === 'custom') {
            const deltaRad = ((snappedDeg - b.rotationDeg) * Math.PI) / 180;
            const cos = Math.cos(deltaRad);
            const sin = Math.sin(deltaRad);
            const rotatedPoly = b.polygon.map((p) => {
              const dx = p.x - b.center.x;
              const dy = p.y - b.center.y;
              return {
                x: Number((b.center.x + dx * cos - dy * sin).toFixed(1)),
                y: Number((b.center.y + dx * sin + dy * cos).toFixed(1)),
              };
            });
            return {
              ...b,
              rotationDeg: snappedDeg,
              polygon: rotatedPoly,
              courtyard: undefined,
            };
          }
          const geom = buildFootprintGeometry(
            b.center,
            b.widthFt,
            b.depthFt,
            b.shape,
            snappedDeg
          );
          return {
            ...b,
            rotationDeg: snappedDeg,
            polygon: geom.polygon,
            courtyard: undefined,
          };
        },
        record
      );
      return;
    }

    const drag = draggingBuildingRef.current;
    if (drag) {
      const pt = clientToCityCoords(e.clientX, e.clientY);
      const nextCenter: Point = {
        x: Number(Math.max(30, Math.min(CITY_WIDTH - 30, pt.x - drag.offsetX)).toFixed(1)),
        y: Number(Math.max(30, Math.min(CITY_HEIGHT - 30, pt.y - drag.offsetY)).toFixed(1)),
      };
      const record = !drag.snapshotRecorded;
      drag.snapshotRecorded = true;
      updateBuilding(
        drag.id,
        (b) => {
          if (b.shape === 'custom') {
            const dx = nextCenter.x - b.center.x;
            const dy = nextCenter.y - b.center.y;
            return {
              ...b,
              center: nextCenter,
              polygon: b.polygon.map((p) => ({
                x: Number((p.x + dx).toFixed(1)),
                y: Number((p.y + dy).toFixed(1)),
              })),
              courtyard: undefined,
            };
          }
          const geom = buildFootprintGeometry(
            nextCenter,
            b.widthFt,
            b.depthFt,
            b.shape,
            b.rotationDeg
          );
          return {
            ...b,
            center: nextCenter,
            polygon: geom.polygon,
            courtyard: undefined,
          };
        },
        record
      );
      return;
    }

    if (isPanning && panStartRef.current && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const vbW = CITY_WIDTH / zoom;
      const vbH = CITY_HEIGHT / zoom;
      const scale = Math.min(rect.width / vbW, rect.height / vbH) || 1;
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
    draggingBuildingRef.current = null;
    draggingRotationRef.current = null;
    draggingNodeRef.current = null;
    setIsDraggingBuilding(false);
  };

  useCanvasWheel({
    svgRef,
    width: CITY_WIDTH,
    height: CITY_HEIGHT,
    zoom,
    pan,
    minZoom: 0.7,
    maxZoom: 3.8,
    onZoomChange: setZoom,
    onPanChange: setPan,
  });

  const handleClaimSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBuilding) return;
    const updated = claimBuilding(selectedBuilding, {
      purpose: formPurpose,
      assignedName: formName.trim() || SUGGESTED_NAMES[formPurpose][0] || selectedBuilding.label,
      customPurposeLabel: formPurpose === 'custom' ? formCustomPurpose : undefined,
      mapLabel: selectedBuilding.claimStatus === 'claimed' ? formMapLabel : undefined,
      notes: formNotes,
      // Floors follow the interior once one is attached
      floors: selectedBuilding.interiorLink ? selectedBuilding.floors : formFloors,
    });
    updateBuilding(selectedBuilding.id, () => updated, true);
    setFormName(updated.assignedName ?? '');
    setFormMapLabel(updated.mapLabel ?? '');
  };

  const handleMapLabelChange = (nextValue: string) => {
    setFormMapLabel(nextValue);
    if (!selectedBuilding || selectedBuilding.claimStatus !== 'claimed') return;
    updateBuilding(
      selectedBuilding.id,
      (b) => ({
        ...b,
        mapLabel: nextValue.length > 0 ? nextValue : undefined,
        showMapLabel: nextValue.trim().length > 0 ? true : b.showMapLabel,
      }),
      false
    );
  };

  const handleMapLabelBlur = () => {
    if (!selectedBuilding || selectedBuilding.claimStatus !== 'claimed') return;
    const trimmed = formMapLabel.trim();
    setFormMapLabel(trimmed);
    updateBuilding(
      selectedBuilding.id,
      (b) => ({
        ...b,
        mapLabel: trimmed || undefined,
      }),
      true
    );
  };

  const handleClearMapLabel = () => {
    setFormMapLabel('');
    if (!selectedBuilding || selectedBuilding.claimStatus !== 'claimed') return;
    updateBuilding(
      selectedBuilding.id,
      (b) => ({
        ...b,
        mapLabel: undefined,
      }),
      true
    );
  };

  const handleToggleMapLabelVisibility = () => {
    if (!selectedBuilding || selectedBuilding.claimStatus !== 'claimed') return;
    updateBuilding(
      selectedBuilding.id,
      (b) => ({
        ...b,
        showMapLabel: b.showMapLabel === false,
      }),
      true
    );
  };

  const handleUnclaim = () => {
    if (!selectedBuilding) return;
    if (
      selectedBuilding.interiorLink &&
      !window.confirm(
        'Unclaim this building? Its interior moves to the library and the building keeps its current outline.'
      )
    ) {
      return;
    }
    const next = unclaimBuilding(selectedBuilding);
    updateBuilding(selectedBuilding.id, () => next, true);
    setFormName('');
    setFormMapLabel('');
    setFormNotes('');
  };

  const handleDeleteLot = () => {
    if (!selectedBuilding) return;
    onUpdateRegion(
      region.id,
      (r) => ({
        ...r,
        settlement: {
          ...r.settlement,
          buildings: r.settlement.buildings.filter((b) => b.id !== selectedBuilding.id),
        },
      }),
      true
    );
    setSelectedBuildingId(null);
    setIsEditingShape(false);
    setSelectedNodeIdx(null);
  };

  const handlePopulateEssentials = () => {
    const { buildings, addedIds } = populateEssentialBuildings(settlement, region.isCoastal);
    if (addedIds.length === 0) {
      setPopulateNotice('Essential landmarks for this settlement are already placed.');
      window.setTimeout(() => setPopulateNotice(null), 2800);
      return;
    }

    onUpdateRegion(
      region.id,
      (r) => ({
        ...r,
        settlement: {
          ...r.settlement,
          buildings,
        },
      }),
      true
    );

    const centerpiece = buildings.find((b) => b.id === addedIds[0]) ?? null;
    if (centerpiece) {
      setSelectedBuildingId(centerpiece.id);
      syncFormFromBuilding(centerpiece);
    }
    setIsEditingShape(false);
    setSelectedNodeIdx(null);
    setPopulateNotice(
      `Placed ${addedIds.length} essential ${addedIds.length === 1 ? 'landmark' : 'landmarks'} (unclaimed NPC houses kept).`
    );
    window.setTimeout(() => setPopulateNotice(null), 3200);
  };

  const handleGeometryChange = (
    changes: Partial<Pick<BuildingFootprint, 'shape' | 'widthFt' | 'depthFt' | 'rotationDeg'>>
  ) => {
    if (!selectedBuilding) return;
    if (
      selectedBuilding.interiorLink &&
      (changes.shape !== undefined || changes.widthFt !== undefined || changes.depthFt !== undefined)
    ) {
      return; // shape and size follow the interior; rotation stays editable
    }
    const shape = changes.shape ?? selectedBuilding.shape;
    const widthFt = Math.max(18, Math.min(180, changes.widthFt ?? selectedBuilding.widthFt));
    const depthFt = Math.max(18, Math.min(180, changes.depthFt ?? selectedBuilding.depthFt));
    const rotationDeg = ((changes.rotationDeg ?? selectedBuilding.rotationDeg) % 360 + 360) % 360;

    let geom: { polygon: Point[]; courtyard?: Point[] };
    if (changes.shape && changes.shape !== 'custom') {
      geom = buildFootprintGeometry(selectedBuilding.center, widthFt, depthFt, shape, rotationDeg);
    } else if (selectedBuilding.shape === 'custom' && changes.rotationDeg !== undefined && !changes.shape) {
      const deltaDeg = rotationDeg - selectedBuilding.rotationDeg;
      const rad = (deltaDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rotatedPoly = selectedBuilding.polygon.map((p) => {
        const dx = p.x - selectedBuilding.center.x;
        const dy = p.y - selectedBuilding.center.y;
        return {
          x: Number((selectedBuilding.center.x + dx * cos - dy * sin).toFixed(1)),
          y: Number((selectedBuilding.center.y + dx * sin + dy * cos).toFixed(1)),
        };
      });
      geom = { polygon: rotatedPoly, courtyard: selectedBuilding.courtyard };
    } else {
      geom = buildFootprintGeometry(selectedBuilding.center, widthFt, depthFt, shape, rotationDeg);
    }

    updateBuilding(
      selectedBuilding.id,
      (b) => ({
        ...b,
        shape,
        widthFt,
        depthFt,
        rotationDeg,
        polygon: geom.polygon,
        courtyard: geom.courtyard,
      }),
      true
    );
  };

  const handleNudgeClear = () => {
    if (!selectedBuilding) return;
    const moved = nudgeBuildingClear(selectedBuilding, settlement.buildings);
    if (!moved) {
      setPopulateNotice('No clear ground nearby. Move the building by hand.');
      window.setTimeout(() => setPopulateNotice(null), 3200);
      return;
    }
    updateBuilding(selectedBuilding.id, () => moved, true);
  };

  const renderInteriorPanel = () => {
    if (!selectedBuilding || selectedBuilding.claimStatus !== 'claimed') return null;
    const link = selectedBuilding.interiorLink;
    const overlaps = overlappingIds.has(selectedBuilding.id);
    return (
      <div className="space-y-2.5">
        <h3 className="text-xs font-semibold text-slate-900">Interior</h3>
        {link ? (
          <>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
              <div className="text-[11px] font-medium text-slate-800 tabular-nums">
                {link.roomCount} {link.roomCount === 1 ? 'room' : 'rooms'} · {link.floors}{' '}
                {link.floors === 1 ? 'floor' : 'floors'}
                {link.cellars ? ` · ${link.cellars} ${link.cellars === 1 ? 'cellar' : 'cellars'}` : ''}
              </div>
              <p className="text-[11px] text-slate-600">{link.roomSummary}</p>
              <p className="text-[11px] text-slate-500">
                Shape and size follow the interior. Position and rotation are set here.
              </p>
            </div>
            {overlaps && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-[11px] text-red-900 space-y-1.5">
                <p>This outline overlaps a neighbouring building.</p>
                <button
                  type="button"
                  onClick={handleNudgeClear}
                  className="min-h-[32px] px-2.5 py-1 text-[11px] font-semibold text-red-900 bg-white border border-red-300 rounded cursor-pointer hover:bg-red-100"
                >
                  Move clear of neighbours
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => onOpenInterior(region.id, selectedBuilding.id)}
              className="w-full min-h-[38px] inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              Open interior
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    'Detach this interior? The building keeps its current outline and the interior moves to the library.'
                  )
                ) {
                  onDetachInterior(region.id, selectedBuilding.id);
                }
              }}
              className="w-full min-h-[32px] px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
            >
              Detach interior
            </button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Design this building’s rooms. Its footprint on the map follows what you build.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onCreateInterior(region.id, selectedBuilding.id, 'blank')}
                className="min-h-[38px] px-3 py-2 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer"
              >
                Start from outline
              </button>
              <button
                type="button"
                onClick={() => onCreateInterior(region.id, selectedBuilding.id, 'generate')}
                className="min-h-[38px] px-3 py-2 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer"
              >
                Generate layout
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Generating resizes the building to fit the new layout.
            </p>
          </>
        )}
      </div>
    );
  };

  const handleExportCitySvg = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(svgRef.current);
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${settlement.name.toLowerCase().replace(/\s+/g, '-')}-silhouette.svg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderLeftSidebarContent = (isMobile = false) => (
    <>
      {isMobile && (
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-semibold text-slate-900" style={{ fontFamily: 'var(--font-display)' }}>
            {settlement.name} Lots
          </h2>
          <button
            type="button"
            onClick={() => setMobileDrawer('none')}
            aria-label="Close lots drawer"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-b border-slate-200 shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2
              className="text-base font-semibold text-slate-900 leading-snug truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {settlement.name}
            </h2>
            <p className="text-[11px] text-slate-500 truncate">
              {SETTLEMENT_TIER_META[settlement.tier].label} · {region.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCitySettings((v) => !v)}
            aria-expanded={showCitySettings}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 hover:text-blue-800 py-1 px-1.5 rounded hover:bg-blue-50 cursor-pointer shrink-0"
          >
            <SlidersHorizontal className="w-3 h-3" aria-hidden="true" />
            Settings
            {showCitySettings ? (
              <ChevronUp className="w-3 h-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {showCitySettings && (
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-2.5 shrink-0">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={`city-tier-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                Settlement Tier
              </label>
              <select
                id={`city-tier-${isMobile ? 'm' : 'd'}`}
                value={settlement.tier}
                onChange={(e) =>
                  onRegenerateSettlement(
                    region.id,
                    e.target.value as SettlementTier,
                    settlement.seed
                  )
                }
                className="w-full px-1.5 py-1.5 text-[11px] border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              >
                <option value="hamlet">Hamlet</option>
                <option value="town">Market Town</option>
                <option value="city">Walled City</option>
                <option value="capital">Grand Capital</option>
              </select>
            </div>
            <div>
              <label htmlFor={`city-seed-${isMobile ? 'm' : 'd'}`} className="block text-[11px] font-medium text-slate-600 mb-1">
                City Seed
              </label>
              <input
                id={`city-seed-${isMobile ? 'm' : 'd'}`}
                type="number"
                value={settlement.seed}
                onChange={(e) =>
                  onRegenerateSettlement(
                    region.id,
                    settlement.tier,
                    Number(e.target.value) || 1
                  )
                }
                className="w-full px-2 py-1.5 text-[11px] font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              onRegenerateSettlement(
                region.id,
                settlement.tier,
                Math.floor(1000 + Math.random() * 89999)
              )
            }
            className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Regenerate Layout
          </button>
        </div>
      )}

      <div className="p-3 border-b border-slate-200 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search lots, names, purposes..."
            aria-label="Search buildings"
            className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 focus:bg-white focus:outline-none focus:border-blue-600"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {filteredBuildings.map((b) => {
          const isSelected = b.id === selectedBuilding?.id;
          const isClaimed = b.claimStatus === 'claimed';
          const purposeMeta = b.purpose ? BUILDING_PURPOSES[b.purpose] : null;
          const swatchColor = isClaimed && purposeMeta ? purposeMeta.fill : '#CBD5E1';
          const statusText = isClaimed
            ? b.purpose === 'custom' && b.customPurposeLabel
              ? b.customPurposeLabel
              : purposeMeta?.label ?? 'Claimed'
            : 'Unclaimed';

          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                handleSelectBuilding(b);
                if (isMobile) setMobileDrawer('none');
              }}
              className={`w-full px-4 py-2.5 flex items-start gap-2.5 text-left transition-colors cursor-pointer ${
                isSelected ? 'bg-blue-50/75' : 'hover:bg-slate-50'
              }`}
            >
              <span
                className="w-3 h-3 rounded-xs mt-1 shrink-0 border border-slate-600/35"
                style={{ backgroundColor: swatchColor }}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 truncate">
                    {b.assignedName || b.label}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                    {b.widthFt}×{b.depthFt}ft
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {statusText} · {b.district}
                  {b.interiorLink ? ' · Interior' : ''}
                  {overlappingIds.has(b.id) ? ' · Overlaps' : ''}
                </div>
                {b.claimStatus === 'claimed' && b.mapLabel?.trim() && (
                  <div className="mt-1">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200 rounded max-w-full truncate">
                      <Tag className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{b.mapLabel.trim()}</span>
                    </span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
        {filteredBuildings.length === 0 && (
          <div className="p-6 text-center text-xs text-slate-500">
            No buildings match the current filter.
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#F5F6F8] relative">
      {/* Contextual Settlement Breadcrumb & Filter Bar */}
      <div className="min-h-11 bg-white border-b border-slate-200 px-3 sm:px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onBackToContinent}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[34px] text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Continent Map</span>
            <span className="sm:hidden">Back</span>
          </button>
          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">/</span>
          <span className="text-xs text-slate-500 truncate hidden md:inline">
            {continentName}
          </span>
          <span className="text-slate-300 hidden md:inline" aria-hidden="true">/</span>
          <label htmlFor="switch-region-select" className="sr-only">
            Switch Region
          </label>
          <select
            id="switch-region-select"
            value={region.id}
            onChange={(e) => {
              const nextR = regions.find((r) => r.id === e.target.value);
              onSwitchRegion(e.target.value);
              setSelectedBuildingId(nextR?.settlement.buildings[0]?.id ?? null);
            }}
            className="text-xs font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded px-2 py-1.5 max-w-[180px] sm:max-w-none truncate focus:outline-none focus:border-blue-600 cursor-pointer"
          >
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.settlement.name}
              </option>
            ))}
          </select>
        </div>

        {/* Building Claim Filter */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="hidden xl:inline text-xs text-slate-500 tabular-nums">
            {unclaimedCount} unclaimed · {claimedCount} claimed
          </span>
          <div className="flex items-center gap-0.5 p-0.5 bg-slate-100 rounded-md" role="group" aria-label="Filter buildings by claim status">
            {(
              [
                { id: 'all', label: `All (${settlement.buildings.length})` },
                { id: 'unclaimed', label: `Unclaimed (${unclaimedCount})` },
                { id: 'claimed', label: `Claimed (${claimedCount})` },
              ] as { id: ClaimFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                aria-pressed={filter === tab.id}
                className={`px-2 py-1 text-[11px] sm:text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                  filter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Desktop Left Sidebar */}
        {desktopLeftOpen && (
          <aside className="hidden lg:flex w-[264px] shrink-0 bg-white border-r border-slate-200 flex-col min-h-0">
            {renderLeftSidebarContent(false)}
          </aside>
        )}

        {/* Center 2D Top-Down City Silhouette Viewport */}
        <main className="flex-1 relative min-w-0 blueprint-grid overflow-hidden">
          {/* Top Map Controls */}
          <div className="absolute top-2.5 inset-x-2.5 sm:top-3 sm:inset-x-3 z-10 flex items-center justify-between gap-2 pointer-events-none">
            <div className="flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                onClick={() => setDesktopLeftOpen((v) => !v)}
                aria-label={desktopLeftOpen ? 'Hide building list' : 'Show building list'}
                className="hidden lg:inline-flex items-center justify-center p-2 bg-white border border-slate-200 rounded-md shadow-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                {desktopLeftOpen ? (
                  <PanelLeftClose className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setPlacingNewLot((v) => !v)}
                aria-pressed={placingNewLot}
                className={`inline-flex items-center gap-1.5 px-2.5 py-2 min-h-[36px] rounded-md shadow-xs text-xs font-medium border cursor-pointer whitespace-nowrap ${
                  placingNewLot
                    ? 'bg-blue-700 text-white border-blue-700'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{placingNewLot ? 'Tap Map...' : 'Add Building'}</span>
              </button>

              <button
                type="button"
                onClick={handlePopulateEssentials}
                title="Place sized & positioned town landmarks (palace, temple, guildhall, tavern, forge) while keeping unclaimed NPC houses"
                className="inline-flex items-center gap-1.5 px-2.5 py-2 min-h-[36px] bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 rounded-md shadow-xs text-xs font-medium cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                <span className="hidden sm:inline">Populate Essentials</span>
                <span className="sm:hidden">Essentials</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 ml-auto pointer-events-auto">
              <div className="flex items-center gap-0.5 p-1 bg-white border border-slate-200 rounded-md shadow-xs">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Number(Math.max(0.7, z - 0.15).toFixed(2)))}
                  aria-label="Zoom out settlement"
                  className="p-1.5 min-h-[34px] min-w-[32px] inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <span className="px-1.5 text-xs font-mono tabular-nums text-slate-700 hidden sm:inline">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Number(Math.min(3.8, z + 0.15).toFixed(2)))}
                  aria-label="Zoom in settlement"
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
                  aria-label="Reset settlement view"
                  className="p-1.5 min-h-[34px] min-w-[32px] inline-flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded cursor-pointer"
                >
                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={handleExportCitySvg}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-md shadow-xs text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Export 2D Plan
              </button>
              <button
                type="button"
                onClick={() => setDesktopRightOpen((v) => !v)}
                aria-label={desktopRightOpen ? 'Hide building inspector' : 'Show building inspector'}
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

          {placingNewLot && (
            <div className="absolute top-14 left-3 z-10 bg-blue-700 text-white px-3 py-2 rounded-md shadow-xs text-xs font-medium max-w-xs">
              Tap anywhere on the plan to place a new Unclaimed NPC house silhouette
            </div>
          )}

          {!placingNewLot && populateNotice && (
            <div className="absolute top-14 left-3 z-10 bg-white border border-slate-200 text-slate-800 px-3 py-2 rounded-md shadow-xs text-xs font-medium max-w-sm">
              {populateNotice}
            </div>
          )}

          {/* Active Shape Editing Floating Toolbar */}
          {isEditingShape && selectedBuilding && (
            <div className="absolute top-14 sm:top-14 left-2.5 right-2.5 sm:left-3 sm:right-auto z-20 flex flex-wrap items-center gap-2 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="pointer-events-auto bg-slate-900/95 text-white border border-slate-700/80 rounded-lg px-3 py-2 shadow-lg flex flex-wrap items-center gap-2.5 backdrop-blur-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-xs font-semibold text-slate-100 max-w-[130px] sm:max-w-none truncate">
                    Editing: {selectedBuilding.assignedName || selectedBuilding.label}
                  </span>
                </div>

                <div className="h-4 w-px bg-slate-700 hidden sm:block" />

                {/* Rotated Grid Snap Toggle & Step */}
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setGridSnapEnabled((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                      gridSnapEnabled
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                    title="Toggle Rotated Grid Snapping (snaps along building orientation)"
                  >
                    <Grid className="w-3.5 h-3.5" />
                    Snap: {gridSnapEnabled ? `${gridStepFt}ft` : 'Off'}
                  </button>

                  {gridSnapEnabled && (
                    <div className="flex items-center gap-0.5 bg-slate-800 rounded p-0.5 border border-slate-700">
                      {[2.5, 5, 10].map((step) => (
                        <button
                          key={step}
                          type="button"
                          onClick={() => setGridStepFt(step)}
                          className={`px-1.5 py-0.5 text-[10px] font-mono rounded cursor-pointer ${
                            gridStepFt === step
                              ? 'bg-blue-600 text-white font-bold'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {step}ft
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Delete Node button if node selected */}
                {selectedNodeIdx !== null && selectedBuilding.polygon.length > 3 && (
                  <button
                    type="button"
                    onClick={() => handleDeleteNode(selectedNodeIdx)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-xs font-medium cursor-pointer transition-colors"
                    title="Delete selected node (Del / Backspace)"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete Node
                  </button>
                )}

                {/* Done Editing button */}
                <button
                  type="button"
                  onClick={handleExitEditShape}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-xs transition-colors ml-auto sm:ml-1"
                >
                  <Check className="w-3.5 h-3.5" />
                  Done
                </button>
              </div>
            </div>
          )}

          <svg
            ref={svgRef}
            data-testid="settlement-canvas"
            viewBox={viewBoxStr}
            onPointerDown={handleSvgPointerDown}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerUp}
            className={`w-full h-full select-none touch-none overscroll-none ${
              placingNewLot
                ? 'cursor-crosshair'
                : isDraggingBuilding || isPanning
                  ? 'cursor-grabbing'
                  : 'cursor-grab'
            }`}
          >
            <defs>
              {/* Diagonal drafting hatch pattern for Unclaimed building silhouettes */}
              <pattern
                id="unclaimed-hatch"
                width="8"
                height="8"
                patternTransform="rotate(45 0 0)"
                patternUnits="userSpaceOnUse"
              >
                <rect width="8" height="8" fill="#CBD5E1" />
                <line x1="0" y1="0" x2="0" y2="8" stroke="#94A3B8" strokeWidth="1.4" />
              </pattern>
              <filter id="bldg-shadow" x="-15%" y="-15%" width="130%" height="130%">
                <feDropShadow dx="1.5" dy="2" stdDeviation="1.6" floodColor="#0F172A" floodOpacity="0.22" />
              </filter>
            </defs>

            {/* Ground click surface */}
            <rect
              x={-800}
              y={-800}
              width={CITY_WIDTH + 1600}
              height={CITY_HEIGHT + 1600}
              fill="transparent"
              data-ground="true"
            />

            {/* Terrain features: coast & river */}
            {settlement.features
              .filter((f) => f.kind === 'coast')
              .map((f) => (
                <path
                  key={f.id}
                  d={pointsToSvgPath(f.points, true)}
                  fill="#B8D0E4"
                  stroke="#7AA0BE"
                  strokeWidth={2.5}
                  pointerEvents="none"
                />
              ))}

            {settlement.features
              .filter((f) => f.kind === 'river')
              .map((f) => (
                <path
                  key={f.id}
                  d={pointsToSvgPath(f.points, false)}
                  fill="none"
                  stroke="#A8C6DF"
                  strokeWidth={f.width ?? 30}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              ))}

            {/* Roads & Avenues */}
            <g pointerEvents="none">
              {settlement.roads.map((road) => (
                <path
                  key={road.id}
                  d={pointsToSvgPath(road.points, false)}
                  fill="none"
                  stroke="#D9DFE7"
                  strokeWidth={road.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {settlement.roads.map((road) => (
                <path
                  key={`${road.id}-edge`}
                  d={pointsToSvgPath(road.points, false)}
                  fill="none"
                  stroke="#F8FAFC"
                  strokeWidth={Math.max(2, road.width - 3)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>

            {/* Central Civic Plaza */}
            {settlement.features
              .filter((f) => f.kind === 'plaza')
              .map((f) => (
                <g key={f.id} pointerEvents="none">
                  <path
                    d={pointsToSvgPath(f.points, true)}
                    fill="#E9EDF2"
                    stroke="#94A3B8"
                    strokeWidth={1.5}
                  />
                  <circle
                    cx={f.points.reduce((s, p) => s + p.x, 0) / f.points.length}
                    cy={f.points.reduce((s, p) => s + p.y, 0) / f.points.length}
                    r={7}
                    fill="#CBD5E1"
                    stroke="#64748B"
                    strokeWidth={1.2}
                  />
                </g>
              ))}

            {/* City Wall Ring & Bastion Towers */}
            {settlement.features
              .filter((f) => f.kind === 'wall')
              .map((f) => (
                <g key={f.id} pointerEvents="none">
                  <path
                    d={pointsToSvgPath(f.points, true)}
                    fill="none"
                    stroke="#64748B"
                    strokeWidth={7}
                    strokeLinejoin="round"
                  />
                  <path
                    d={pointsToSvgPath(f.points, true)}
                    fill="none"
                    stroke="#CBD5E1"
                    strokeWidth={2.5}
                    strokeDasharray="8 6"
                  />
                  {f.points.map((wp, idx) => (
                    <circle
                      key={`bastion-${idx}`}
                      cx={wp.x}
                      cy={wp.y}
                      r={5.5}
                      fill="#475569"
                      stroke="#F8FAFC"
                      strokeWidth={1.2}
                    />
                  ))}
                </g>
              ))}

            {/* Rotated Drafting Grid for active building shape editing */}
            {isEditingShape && selectedBuilding && renderRotatedGrid(selectedBuilding)}

            {/* Top-Down 2D Building Silhouettes */}
            <g>
              {settlement.buildings.map((b) => {
                const isSelected = b.id === selectedBuilding?.id;
                const isClaimed = b.claimStatus === 'claimed';
                const matchesFilter = filter === 'all' || b.claimStatus === filter;
                const purposeMeta = b.purpose ? BUILDING_PURPOSES[b.purpose] : null;
                const fill = isClaimed && purposeMeta ? purposeMeta.fill : 'url(#unclaimed-hatch)';
                const stroke = isSelected
                  ? '#2563EB'
                  : isClaimed && purposeMeta
                    ? purposeMeta.stroke
                    : '#64748B';

                return (
                  <g
                    key={b.id}
                    opacity={matchesFilter ? 1 : 0.22}
                    filter={isClaimed || isSelected ? 'url(#bldg-shadow)' : undefined}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      try {
                        svgRef.current?.setPointerCapture(e.pointerId);
                      } catch {
                        // Ignore synthetic pointer events
                      }
                      handleSelectBuilding(b);
                      if (!isEditingShape) {
                        const pt = clientToCityCoords(e.clientX, e.clientY);
                        setIsDraggingBuilding(true);
                        draggingBuildingRef.current = {
                          id: b.id,
                          offsetX: pt.x - b.center.x,
                          offsetY: pt.y - b.center.y,
                          snapshotRecorded: false,
                        };
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <path
                      d={
                        pointsToSvgPath(b.polygon, true) +
                        (b.courtyard && b.courtyard.length >= 3
                          ? ' ' + pointsToSvgPath(b.courtyard, true)
                          : '')
                      }
                      fillRule="evenodd"
                      fill={fill}
                      stroke={overlappingIds.has(b.id) ? '#DC2626' : stroke}
                      strokeDasharray={overlappingIds.has(b.id) ? '5 3' : undefined}
                      strokeWidth={isSelected ? 2.6 : isClaimed ? 1.5 : 1.3}
                      strokeLinejoin="round"
                    />

                    {/* Interior Linked Marker Dot */}
                    {b.interiorLink && (
                      <circle
                        cx={b.center.x}
                        cy={b.center.y}
                        r={3.8}
                        fill="#FFFFFF"
                        stroke="#0F172A"
                        strokeWidth={1.3}
                        pointerEvents="none"
                      />
                    )}

                  </g>
                );
              })}
            </g>

            {/* Claimed Building Names & Custom Map Labels (always rendered above all silhouettes) */}
            <g pointerEvents="none">
              {settlement.buildings.map((b) => {
                if (b.claimStatus !== 'claimed') return null;
                const isSelected = b.id === selectedBuilding?.id;
                const matchesFilter = filter === 'all' || b.claimStatus === filter;
                const purposeMeta = b.purpose ? BUILDING_PURPOSES[b.purpose] : null;
                const customText = b.mapLabel?.trim();
                const showCustom = Boolean(customText) && b.showMapLabel !== false;
                const bBox = showCustom ? polygonBounds(b.polygon) : null;
                const tagW = customText
                  ? Math.max(44, Math.min(190, customText.length * 5.6 + 14))
                  : 0;
                const tagY = bBox ? Math.max(b.center.y + 14, bBox.maxY + 11) : 0;

                return (
                  <g key={`claimed-labels-${b.id}`} opacity={matchesFilter ? 1 : 0.22}>
                    {!isSelected && (
                      <text
                        x={b.center.x}
                        y={b.center.y - 16}
                        textAnchor="middle"
                        fill="#0F172A"
                        fontSize={10}
                        fontWeight={600}
                        style={{
                          fontFamily: 'var(--font-sans)',
                          paintOrder: 'stroke',
                          stroke: 'rgba(255,255,255,0.95)',
                          strokeWidth: 3,
                        }}
                      >
                        {b.assignedName || b.label}
                      </text>
                    )}

                    {showCustom && customText && (
                      <g transform={`translate(${b.center.x}, ${tagY})`}>
                        <rect
                          x={-tagW / 2}
                          y={-8.5}
                          width={tagW}
                          height={17}
                          rx={3}
                          fill="#FFFFFF"
                          fillOpacity={0.96}
                          stroke={purposeMeta?.stroke ?? '#B45309'}
                          strokeWidth={1}
                          filter="url(#bldg-shadow)"
                        />
                        <text
                          x={0}
                          y={3}
                          textAnchor="middle"
                          fill="#0F172A"
                          fontSize={9}
                          fontWeight={600}
                          style={{ fontFamily: 'var(--font-sans)' }}
                        >
                          {customText}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Architectural Scale Bar */}
            <g transform={`translate(${CITY_WIDTH - 190}, ${CITY_HEIGHT - 36})`} pointerEvents="none">
              <line x1={0} y1={10} x2={136} y2={10} stroke="#334155" strokeWidth={1.6} />
              <line x1={0} y1={5} x2={0} y2={15} stroke="#334155" strokeWidth={1.6} />
              <line x1={68} y1={7} x2={68} y2={13} stroke="#334155" strokeWidth={1.2} />
              <line x1={136} y1={5} x2={136} y2={15} stroke="#334155" strokeWidth={1.6} />
              <text
                x={136}
                y={24}
                textAnchor="end"
                fill="#475569"
                fontSize={10}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                0 — 200 ft
              </text>
            </g>

            {/* Top-most Interactive Overlay for Selected Building (always above all buildings) */}
            {selectedBuilding && (() => {
              const b = selectedBuilding;
              const hd = Math.max(14, b.depthFt * 0.68) / 2;
              const rad = (b.rotationDeg * Math.PI) / 180;
              const upX = Math.sin(rad);
              const upY = -Math.cos(rad);
              const invScale = 1 / Math.max(0.35, zoom);
              const maxUpProj = b.polygon.reduce(
                (max, p) => Math.max(max, (p.x - b.center.x) * upX + (p.y - b.center.y) * upY),
                hd
              );
              const stemStart = {
                x: b.center.x + maxUpProj * upX,
                y: b.center.y + maxUpProj * upY,
              };
              const knobDist = maxUpProj + 22 * invScale;
              const knob = {
                x: b.center.x + knobDist * upX,
                y: b.center.y + knobDist * upY,
              };
              const bBox = polygonBounds(b.polygon);
              const topClearance = Math.min(bBox.minY, knob.y - 12 * invScale);
              const popupX = b.center.x;
              const popupY = topClearance - 26 * invScale;
              const isRotatingThis =
                isDraggingBuilding && draggingRotationRef.current?.id === b.id;

              return (
                <g key={`selected-overlay-${b.id}`}>
                  {/* Selected building label */}
                  <text
                    x={b.center.x}
                    y={b.center.y - 16}
                    textAnchor="middle"
                    pointerEvents="none"
                    fill="#0F172A"
                    fontSize={10}
                    fontWeight={600}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      paintOrder: 'stroke',
                      stroke: 'rgba(255,255,255,0.95)',
                      strokeWidth: 3,
                    }}
                  >
                    {b.assignedName || b.label}
                  </text>

                  {/* On-canvas rotation node (available both on selection and during vertex editing) */}
                  <g>
                    <line
                      x1={stemStart.x}
                      y1={stemStart.y}
                      x2={knob.x}
                      y2={knob.y}
                      stroke="#2563EB"
                      strokeWidth={1.5 * invScale}
                      strokeDasharray={`${2.5 * invScale} ${2.5 * invScale}`}
                      pointerEvents="none"
                    />
                    <g
                      transform={`translate(${knob.x}, ${knob.y}) scale(${invScale})`}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        try {
                          svgRef.current?.setPointerCapture(e.pointerId);
                        } catch {
                          // Ignore synthetic pointer events
                        }
                        setIsDraggingBuilding(true);
                        draggingRotationRef.current = {
                          id: b.id,
                          center: { ...b.center },
                          snapshotRecorded: false,
                        };
                      }}
                      className="cursor-grab active:cursor-grabbing group"
                      role="button"
                      aria-label="Rotate building"
                    >
                      <title>Drag to rotate building (hold Shift for 1° precision)</title>
                      <circle cx={0} cy={0} r={14} fill="transparent" />
                      <circle
                        cx={0}
                        cy={0}
                        r={8.5}
                        fill="#FFFFFF"
                        stroke="#2563EB"
                        strokeWidth={1.8}
                        filter="url(#bldg-shadow)"
                        className="group-hover:fill-blue-50 transition-colors"
                      />
                      {/* Circular rotation arrow icon */}
                      <path
                        d="M 3.4 -1.6 A 3.8 3.8 0 1 0 3.2 2.2"
                        fill="none"
                        stroke="#2563EB"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                      />
                      <polyline
                        points="1.4,-1.6 3.7,-1.6 3.7,-3.9"
                        fill="none"
                        stroke="#2563EB"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {isRotatingThis && (
                        <g transform="translate(14, -10)">
                          <rect x={0} y={-9} width={36} height={18} rx={4} fill="#0F172A" />
                          <text
                            x={18}
                            y={3.5}
                            textAnchor="middle"
                            fill="#FFFFFF"
                            fontSize={10}
                            fontWeight={600}
                            fontFamily="var(--font-mono)"
                          >
                            {b.rotationDeg}°
                          </text>
                        </g>
                      )}
                    </g>
                  </g>

                  {/* Edit / Delete Floating Popup Bar on clicked building */}
                  {!isEditingShape && (
                    <g
                      transform={`translate(${popupX}, ${popupY}) scale(${invScale})`}
                      pointerEvents="auto"
                      className="select-none"
                    >
                      {/* Light card container matching app toolbar */}
                      <rect
                        x={-74}
                        y={-16}
                        width={148}
                        height={32}
                        rx={8}
                        fill="#FFFFFF"
                        stroke="#CBD5E1"
                        strokeWidth={1.25}
                        filter="url(#bldg-shadow)"
                      />
                      {/* Downward indicator caret */}
                      <polygon points="-5,16 5,16 0,21" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth={1.1} />
                      <line x1="-4.5" y1="16" x2="4.5" y2="16" stroke="#FFFFFF" strokeWidth={2.2} />

                      {/* EDIT BUTTON (Left half) */}
                      <g
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (b.interiorLink) {
                            onOpenInterior(region.id, b.id);
                          } else {
                            handleStartEditShape(b);
                          }
                        }}
                        className="cursor-pointer"
                        role="button"
                        aria-label={
                          b.interiorLink
                            ? `Open interior of ${b.assignedName || b.label}`
                            : `Edit ${b.assignedName || b.label} shape`
                        }
                      >
                        <rect
                          x={-72}
                          y={-14}
                          width={70}
                          height={28}
                          rx={6}
                          fill="transparent"
                          className="hover:fill-blue-50 transition-colors"
                        />
                        {/* Pencil icon */}
                        <path
                          d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"
                          fill="none"
                          stroke="#2563EB"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          transform="translate(-57, -6.5) scale(0.58)"
                        />
                        <text
                          x={-38}
                          y={3.8}
                          textAnchor="start"
                          fill="#0F172A"
                          fontSize={11}
                          fontWeight={600}
                          fontFamily="var(--font-sans)"
                        >
                          Edit
                        </text>
                      </g>

                      {/* Center Divider line */}
                      <line x1={0} y1={-8} x2={0} y2={8} stroke="#E2E8F0" strokeWidth={1.2} />

                      {/* DELETE BUTTON (Right half) */}
                      <g
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteLot();
                        }}
                        className="cursor-pointer"
                        role="button"
                        aria-label={`Delete ${b.assignedName || b.label}`}
                      >
                        <rect
                          x={2}
                          y={-14}
                          width={70}
                          height={28}
                          rx={6}
                          fill="transparent"
                          className="hover:fill-red-50 transition-colors"
                        />
                        {/* Trash icon */}
                        <path
                          d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"
                          fill="none"
                          stroke="#DC2626"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          transform="translate(10, -6.5) scale(0.58)"
                        />
                        <text
                          x={28}
                          y={3.8}
                          textAnchor="start"
                          fill="#B91C1C"
                          fontSize={11}
                          fontWeight={600}
                          fontFamily="var(--font-sans)"
                        >
                          Delete
                        </text>
                      </g>
                    </g>
                  )}

                  {/* Polygon Node & Edge Editor Layer (when isEditingShape is active) */}
                  {isEditingShape && (
                    <g className="select-none">
                      {/* Active drafting polygon outline highlight */}
                      <path
                        d={pointsToSvgPath(b.polygon, true)}
                        fill="none"
                        stroke="#2563EB"
                        strokeWidth={2.4}
                        strokeDasharray="6 3"
                        pointerEvents="none"
                      />

                      {/* Edge Midpoint '+' handles and Edge hit areas to insert nodes */}
                      {b.polygon.map((p1, idx) => {
                        const p2 = b.polygon[(idx + 1) % b.polygon.length];
                        const mid = {
                          x: (p1.x + p2.x) / 2,
                          y: (p1.y + p2.y) / 2,
                        };
                        const edgeInvScale = 1 / Math.max(0.4, zoom);

                        return (
                          <g key={`edge-${idx}`}>
                            {/* Invisible wide stroke along the edge for click-to-add */}
                            <line
                              x1={p1.x}
                              y1={p1.y}
                              x2={p2.x}
                              y2={p2.y}
                              stroke="transparent"
                              strokeWidth={14 * edgeInvScale}
                              className="cursor-copy"
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                const pt = clientToCityCoords(e.clientX, e.clientY);
                                handleAddNodeAtPosition(b, idx, pt);
                              }}
                            />

                            {/* Edge Midpoint '+' button */}
                            <g
                              transform={`translate(${mid.x}, ${mid.y}) scale(${edgeInvScale})`}
                              className="cursor-pointer group"
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                e.stopPropagation();
                                handleAddNodeAtPosition(b, idx, mid);
                              }}
                              role="button"
                              aria-label={`Insert vertex on edge ${idx + 1}`}
                            >
                              <circle cx={0} cy={0} r={12} fill="transparent" />
                              <circle
                                cx={0}
                                cy={0}
                                r={5.5}
                                fill="#2563EB"
                                stroke="#FFFFFF"
                                strokeWidth={1.5}
                                className="group-hover:scale-125 transition-transform"
                              />
                              <line
                                x1={-2.5}
                                y1={0}
                                x2={2.5}
                                y2={0}
                                stroke="#FFFFFF"
                                strokeWidth={1.4}
                                strokeLinecap="round"
                              />
                              <line
                                x1={0}
                                y1={-2.5}
                                x2={0}
                                y2={2.5}
                                stroke="#FFFFFF"
                                strokeWidth={1.4}
                                strokeLinecap="round"
                              />
                            </g>
                          </g>
                        );
                      })}

                      {/* Draggable Polygon Nodes (Vertices) */}
                      {b.polygon.map((p, idx) => {
                        const isNodeSelected = selectedNodeIdx === idx;
                        const nodeInvScale = 1 / Math.max(0.4, zoom);

                        return (
                          <g
                            key={`node-${idx}`}
                            transform={`translate(${p.x}, ${p.y})`}
                            className="cursor-move"
                            onPointerDown={(e) => {
                              if (e.button !== 0) return;
                              e.stopPropagation();
                              try {
                                svgRef.current?.setPointerCapture(e.pointerId);
                              } catch {
                                // Ignore synthetic pointer events
                              }
                              setSelectedNodeIdx(idx);
                              draggingNodeRef.current = {
                                buildingId: b.id,
                                vertexIdx: idx,
                                snapshotRecorded: false,
                              };
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              if (b.polygon.length > 3) {
                                handleDeleteNode(idx);
                              }
                            }}
                          >
                            {/* Generous touch/drag hit area */}
                            <circle cx={0} cy={0} r={15 * nodeInvScale} fill="transparent" />

                            {/* Outer dashed ring if selected */}
                            {isNodeSelected && (
                              <circle
                                cx={0}
                                cy={0}
                                r={9.5 * nodeInvScale}
                                fill="none"
                                stroke="#2563EB"
                                strokeWidth={2 * nodeInvScale}
                                strokeDasharray={`${3 * nodeInvScale} ${2 * nodeInvScale}`}
                              />
                            )}

                            {/* Node circle */}
                            <circle
                              cx={0}
                              cy={0}
                              r={5.5 * nodeInvScale}
                              fill={isNodeSelected ? '#2563EB' : '#FFFFFF'}
                              stroke={isNodeSelected ? '#FFFFFF' : '#1D4ED8'}
                              strokeWidth={2 * nodeInvScale}
                            />

                            {/* Node index number */}
                            <text
                              x={0}
                              y={-9 * nodeInvScale}
                              textAnchor="middle"
                              fill="#0F172A"
                              fontSize={9 * nodeInvScale}
                              fontWeight={700}
                              pointerEvents="none"
                              style={{
                                fontFamily: 'var(--font-mono)',
                                paintOrder: 'stroke',
                                stroke: '#FFFFFF',
                                strokeWidth: 2.5 * nodeInvScale,
                              }}
                            >
                              {idx + 1}
                            </text>

                            {/* Delete badge on selected node */}
                            {isNodeSelected && b.polygon.length > 3 && (
                              <g
                                transform={`translate(${14 * nodeInvScale}, ${-14 * nodeInvScale}) scale(${nodeInvScale})`}
                                className="cursor-pointer"
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteNode(idx);
                                }}
                                role="button"
                                aria-label={`Delete vertex ${idx + 1}`}
                              >
                                <circle cx={0} cy={0} r={8} fill="#EF4444" stroke="#FFFFFF" strokeWidth={1.5} />
                                <line
                                  x1={-3}
                                  y1={-3}
                                  x2={3}
                                  y2={3}
                                  stroke="#FFFFFF"
                                  strokeWidth={1.4}
                                  strokeLinecap="round"
                                />
                                <line
                                  x1={3}
                                  y1={-3}
                                  x2={-3}
                                  y2={3}
                                  stroke="#FFFFFF"
                                  strokeWidth={1.4}
                                  strokeLinecap="round"
                                />
                              </g>
                            )}
                          </g>
                        );
                      })}
                    </g>
                  )}
                </g>
              );
            })()}
          </svg>

          {/* Bottom Overlay Row: Compact Silhouette Key + Mobile Drawer Triggers */}
          <div className="absolute bottom-2.5 inset-x-2.5 sm:bottom-3 sm:inset-x-3 z-10 flex flex-wrap items-end justify-between gap-2 pointer-events-none">
            <div className="pointer-events-auto">
              {showKey ? (
                <div className="bg-white/95 border border-slate-200 rounded-md px-3 py-2 shadow-xs max-w-md">
                  <div className="flex items-center justify-between gap-4 mb-1">
                    <span className="text-[11px] font-semibold text-slate-700">
                      2D Silhouette Key
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowKey(false)}
                      aria-label="Hide settlement key"
                      className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-700">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-xs bg-slate-300 border border-slate-500 inline-block" aria-hidden="true" />
                      Unclaimed
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-xs bg-amber-500/80 border border-amber-800 inline-block" aria-hidden="true" />
                      Claimed
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-slate-900 inline-block" aria-hidden="true" />
                      Interior Linked
                    </span>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowKey(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] bg-white/95 border border-slate-200 rounded-md shadow-xs text-xs font-medium text-slate-700 hover:bg-white cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                  Key
                </button>
              )}
            </div>

            <div className="flex lg:hidden items-center gap-2 pointer-events-auto ml-auto">
              <button
                type="button"
                onClick={() => setMobileDrawer('lots')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-white border border-slate-300 rounded-md shadow-xs text-xs font-semibold text-slate-800 cursor-pointer"
              >
                Lots ({settlement.buildings.length})
              </button>
              {selectedBuilding && (
                <button
                  type="button"
                  onClick={() => setMobileDrawer('inspector')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] bg-blue-700 text-white rounded-md shadow-xs text-xs font-semibold cursor-pointer max-w-[165px] truncate"
                >
                  {selectedBuilding.assignedName || selectedBuilding.label}
                </button>
              )}
            </div>
          </div>
        </main>

        {/* Desktop Right Building Inspector */}
        {desktopRightOpen && (
          <aside className="hidden lg:flex w-[308px] shrink-0 bg-white border-l border-slate-200 flex-col min-h-0 overflow-y-auto">
            {selectedBuilding ? (
              <div className="p-4 space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-slate-600">
                      {selectedBuilding.claimStatus === 'claimed'
                        ? `Claimed · ${
                            selectedBuilding.purpose === 'custom' && selectedBuilding.customPurposeLabel
                              ? selectedBuilding.customPurposeLabel
                              : selectedBuilding.purpose
                                ? BUILDING_PURPOSES[selectedBuilding.purpose].label
                                : 'Assigned'
                          }`
                        : 'Unclaimed · NPC House'}
                    </span>
                    <button
                      type="button"
                      onClick={handleDeleteLot}
                      aria-label={`Delete building ${selectedBuilding.assignedName || selectedBuilding.label}`}
                      className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <h2
                    className="text-xl font-semibold text-slate-900 leading-tight"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {selectedBuilding.assignedName || selectedBuilding.label}
                  </h2>
                  <p className="text-xs text-slate-500 font-mono tabular-nums">
                    {selectedBuilding.widthFt}×{selectedBuilding.depthFt} ft ·{' '}
                    {computeBuildingAreaSqFt(selectedBuilding)} sq ft · {selectedBuilding.floors}F ·{' '}
                    {selectedBuilding.district}
                  </p>
                </div>

                {/* Collapsible Footprint Geometry Editor */}
                <div className="border-y border-slate-200 py-2">
                  <button
                    type="button"
                    onClick={() => setShowGeometryEditor((v) => !v)}
                    aria-expanded={showGeometryEditor}
                    className="w-full flex items-center justify-between text-xs font-medium text-slate-700 hover:text-slate-900 py-1 cursor-pointer"
                  >
                    <span>Footprint Shape &amp; Dimensions</span>
                    {showGeometryEditor ? (
                      <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                  </button>

                  {showGeometryEditor && (
                    <div className="pt-2.5 space-y-2.5">
                      {interiorDriven && (
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Shape and size follow the interior. Rotation is still set here.
                        </p>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="bldg-shape" className="block text-[11px] font-medium text-slate-600 mb-1">
                            Shape
                          </label>
                          <select
                            id="bldg-shape"
                            disabled={interiorDriven}
                            value={selectedBuilding.shape}
                            onChange={(e) =>
                              handleGeometryChange({ shape: e.target.value as BuildingShape })
                            }
                            className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                          >
                            <option value="rectangle">Rectangle Hall</option>
                            <option value="l-shape">L-Shape Wing</option>
                            <option value="u-shape">U-Shape Manor</option>
                            <option value="courtyard">Courtyard Keep</option>
                            <option value="round-tower">Round Tower</option>
                            <option value="custom">Custom Polygon</option>
                          </select>
                        </div>
                        <div>
                          <span className="block text-[11px] font-medium text-slate-600 mb-1">
                            Rotation ({selectedBuilding.rotationDeg}°)
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                handleGeometryChange({ rotationDeg: selectedBuilding.rotationDeg - 15 })
                              }
                              aria-label="Rotate building counter-clockwise"
                              className="flex-1 inline-flex items-center justify-center py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleGeometryChange({ rotationDeg: selectedBuilding.rotationDeg + 15 })
                              }
                              aria-label="Rotate building clockwise"
                              className="flex-1 inline-flex items-center justify-center py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 cursor-pointer"
                            >
                              <RotateCw className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="bldg-width" className="block text-[11px] font-medium text-slate-600 mb-1">
                            Width (ft)
                          </label>
                          <input
                            id="bldg-width"
                            disabled={interiorDriven}
                            type="number"
                            min={18}
                            max={180}
                            value={selectedBuilding.widthFt}
                            onChange={(e) =>
                              handleGeometryChange({ widthFt: Number(e.target.value) || 24 })
                            }
                            className="w-full px-2 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                          />
                        </div>
                        <div>
                          <label htmlFor="bldg-depth" className="block text-[11px] font-medium text-slate-600 mb-1">
                            Depth (ft)
                          </label>
                          <input
                            id="bldg-depth"
                            disabled={interiorDriven}
                            type="number"
                            min={18}
                            max={180}
                            value={selectedBuilding.depthFt}
                            onChange={(e) =>
                              handleGeometryChange({ depthFt: Number(e.target.value) || 24 })
                            }
                            className="w-full px-2 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={interiorDriven}
                        onClick={() => {
                          if (isEditingShape) {
                            handleExitEditShape();
                          } else {
                            handleStartEditShape(selectedBuilding);
                          }
                        }}
                        className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border cursor-pointer transition-colors ${
                          isEditingShape
                            ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                            : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                        }`}
                      >
                        {isEditingShape ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Done Editing Shape</span>
                          </>
                        ) : (
                          <>
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit Shape (Nodes &amp; Snapping)</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Claim Building & Purpose Assignment Form */}
                <form onSubmit={handleClaimSubmit} className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-900">
                    {selectedBuilding.claimStatus === 'claimed'
                      ? 'Claimed Assignment'
                      : 'Claim Building'}
                  </h3>

                  <div>
                    <label htmlFor="claim-purpose" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Assigned Purpose
                    </label>
                    <select
                      id="claim-purpose"
                      value={formPurpose}
                      onChange={(e) => setFormPurpose(e.target.value as BuildingPurpose)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                    >
                      {BUILDING_PURPOSE_LIST.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {formPurpose === 'custom' && (
                    <div>
                      <label htmlFor="claim-custom-purpose" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Custom Purpose Label
                      </label>
                      <input
                        id="claim-custom-purpose"
                        type="text"
                        value={formCustomPurpose}
                        onChange={(e) => setFormCustomPurpose(e.target.value)}
                        placeholder="e.g. Clockmaker Workshop"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="claim-name" className="text-[11px] font-medium text-slate-600">
                        Building Name
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const pool = SUGGESTED_NAMES[formPurpose];
                          const pick = pool[Math.floor(Math.random() * pool.length)];
                          setFormName(pick);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" aria-hidden="true" />
                        Suggest
                      </button>
                    </div>
                    <input
                      id="claim-name"
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder={SUGGESTED_NAMES[formPurpose][0]}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label htmlFor="claim-floors" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Stories
                      </label>
                      <input
                        id="claim-floors"
                        disabled={interiorDriven}
                        type="number"
                        min={1}
                        max={8}
                        value={formFloors}
                        onChange={(e) => setFormFloors(Number(e.target.value) || 1)}
                        className="w-full px-2 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                    <div className="col-span-2">
                      <label htmlFor="claim-notes" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Interior Notes
                      </label>
                      <input
                        id="claim-notes"
                        type="text"
                        value={formNotes}
                        onChange={(e) => setFormNotes(e.target.value)}
                        placeholder="NPC proprietor, hooks..."
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="submit"
                      className="flex-1 min-h-[38px] px-3 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors cursor-pointer"
                    >
                      {selectedBuilding.claimStatus === 'claimed'
                        ? 'Save Assignment'
                        : 'Claim Building'}
                    </button>
                    {selectedBuilding.claimStatus === 'claimed' && (
                      <button
                        type="button"
                        onClick={handleUnclaim}
                        className="min-h-[38px] px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md cursor-pointer"
                      >
                        Unclaim
                      </button>
                    )}
                  </div>
                </form>

                {/* Custom Map Label Controls for Claimed Buildings */}
                {selectedBuilding.claimStatus === 'claimed' && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="claim-map-label"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800"
                      >
                        <Tag className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                        Custom Map Label
                      </label>
                      <button
                        type="button"
                        onClick={handleToggleMapLabelVisibility}
                        aria-label={
                          selectedBuilding.showMapLabel === false
                            ? 'Show custom label on map'
                            : 'Hide custom label on map'
                        }
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border cursor-pointer transition-colors ${
                          selectedBuilding.showMapLabel === false
                            ? 'bg-white text-slate-500 border-slate-200 hover:text-slate-800'
                            : 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                        }`}
                      >
                        {selectedBuilding.showMapLabel === false ? (
                          <>
                            <EyeOff className="w-3 h-3" aria-hidden="true" />
                            <span>Hidden</span>
                          </>
                        ) : (
                          <>
                            <Eye className="w-3 h-3" aria-hidden="true" />
                            <span>On Map</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        id="claim-map-label"
                        type="text"
                        maxLength={36}
                        value={formMapLabel}
                        onChange={(e) => handleMapLabelChange(e.target.value)}
                        onBlur={handleMapLabelBlur}
                        placeholder="e.g. Safe House, Quest Hook..."
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:border-blue-600"
                      />
                      {formMapLabel.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearMapLabel}
                          aria-label="Clear custom map label"
                          className="p-1.5 text-slate-400 hover:text-slate-700 bg-white border border-slate-300 rounded cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Displays as a callout tag beneath this building on the settlement map.
                    </p>
                  </div>
                )}

                {selectedBuilding.claimStatus === 'claimed' && (
                  <>
                    <hr className="border-slate-200" />
                    {renderInteriorPanel()}
                  </>
                )}
              </div>
            ) : (
              <div className="p-6 space-y-3 text-center">
                <h3 className="text-sm font-semibold text-slate-900">
                  Select a Building Silhouette
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Tap any top-down footprint on the map to inspect its dimensions, claim it with a
                  fantasy RPG purpose, or design its interior.
                </p>
                <div className="pt-2 text-xs text-slate-600 tabular-nums">
                  {unclaimedCount} Unclaimed · {claimedCount} Claimed
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

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
            {mobileDrawer === 'lots' ? (
              renderLeftSidebarContent(true)
            ) : selectedBuilding ? (
              <div className="p-4 space-y-4 overflow-y-auto">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="text-xs font-semibold text-slate-600">Building Inspector</span>
                  <button
                    type="button"
                    onClick={() => setMobileDrawer('none')}
                    aria-label="Close building inspector drawer"
                    className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2
                      className="text-lg font-semibold text-slate-900"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {selectedBuilding.assignedName || selectedBuilding.label}
                    </h2>
                    <p className="text-xs text-slate-500 font-mono tabular-nums">
                      {selectedBuilding.widthFt}×{selectedBuilding.depthFt} ft ·{' '}
                      {computeBuildingAreaSqFt(selectedBuilding)} sq ft · {selectedBuilding.rotationDeg}°
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleDeleteLot();
                      setMobileDrawer('none');
                    }}
                    aria-label="Delete building lot"
                    className="p-2 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Mobile Footprint Shape, Size & Rotation */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
                  {interiorDriven && (
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Shape and size follow the interior. Rotation is still set here.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="m-bldg-shape" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Shape
                      </label>
                      <select
                        id="m-bldg-shape"
                        disabled={interiorDriven}
                        value={selectedBuilding.shape}
                        onChange={(e) =>
                          handleGeometryChange({ shape: e.target.value as BuildingShape })
                        }
                        className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white text-slate-900"
                      >
                        <option value="rectangle">Rectangle Hall</option>
                        <option value="l-shape">L-Shape Wing</option>
                        <option value="u-shape">U-Shape Manor</option>
                        <option value="courtyard">Courtyard Keep</option>
                        <option value="round-tower">Round Tower</option>
                        <option value="custom">Custom Polygon</option>
                      </select>
                    </div>
                    <div>
                      <span className="block text-[11px] font-medium text-slate-600 mb-1">
                        Rotate ({selectedBuilding.rotationDeg}°)
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleGeometryChange({ rotationDeg: selectedBuilding.rotationDeg - 15 })
                          }
                          aria-label="Rotate building counter-clockwise"
                          className="flex-1 inline-flex items-center justify-center py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleGeometryChange({ rotationDeg: selectedBuilding.rotationDeg + 15 })
                          }
                          aria-label="Rotate building clockwise"
                          className="flex-1 inline-flex items-center justify-center py-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="m-bldg-width" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Width (ft)
                      </label>
                      <input
                        id="m-bldg-width"
                        disabled={interiorDriven}
                        type="number"
                        min={18}
                        max={180}
                        value={selectedBuilding.widthFt}
                        onChange={(e) =>
                          handleGeometryChange({ widthFt: Number(e.target.value) || 24 })
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="m-bldg-depth" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Depth (ft)
                      </label>
                      <input
                        id="m-bldg-depth"
                        disabled={interiorDriven}
                        type="number"
                        min={18}
                        max={180}
                        value={selectedBuilding.depthFt}
                        onChange={(e) =>
                          handleGeometryChange({ depthFt: Number(e.target.value) || 24 })
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={interiorDriven}
                    onClick={() => {
                      if (isEditingShape) {
                        handleExitEditShape();
                      } else {
                        handleStartEditShape(selectedBuilding);
                      }
                    }}
                    className={`w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md border cursor-pointer transition-colors ${
                      isEditingShape
                        ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                        : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                    }`}
                  >
                    {isEditingShape ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Done Editing Shape</span>
                      </>
                    ) : (
                      <>
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit Shape (Nodes &amp; Snapping)</span>
                      </>
                    )}
                  </button>
                </div>

                <form onSubmit={handleClaimSubmit} className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="m-claim-purpose" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Purpose
                      </label>
                      <select
                        id="m-claim-purpose"
                        value={formPurpose}
                        onChange={(e) => setFormPurpose(e.target.value as BuildingPurpose)}
                        className="w-full px-2 py-2 text-xs border border-slate-300 rounded bg-white text-slate-900"
                      >
                        {BUILDING_PURPOSE_LIST.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="m-claim-floors" className="block text-[11px] font-medium text-slate-600 mb-1">
                        Stories
                      </label>
                      <input
                        id="m-claim-floors"
                        disabled={interiorDriven}
                        type="number"
                        min={1}
                        max={8}
                        value={formFloors}
                        onChange={(e) => setFormFloors(Number(e.target.value) || 1)}
                        className="w-full px-2 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded bg-white text-slate-900"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="m-claim-name" className="block text-[11px] font-medium text-slate-600 mb-1">
                      Building Name
                    </label>
                    <input
                      id="m-claim-name"
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder={SUGGESTED_NAMES[formPurpose][0]}
                      className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded bg-white text-slate-900"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="flex-1 min-h-[42px] px-3 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                    >
                      {selectedBuilding.claimStatus === 'claimed' ? 'Save Assignment' : 'Claim Building'}
                    </button>
                  </div>
                </form>

                {renderInteriorPanel()}

                {selectedBuilding.claimStatus === 'claimed' && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="m-claim-map-label"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800"
                      >
                        <Tag className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
                        Custom Map Label
                      </label>
                      <button
                        type="button"
                        onClick={handleToggleMapLabelVisibility}
                        aria-label={
                          selectedBuilding.showMapLabel === false
                            ? 'Show custom label on map'
                            : 'Hide custom label on map'
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border cursor-pointer ${
                          selectedBuilding.showMapLabel === false
                            ? 'bg-white text-slate-500 border-slate-200'
                            : 'bg-amber-50 text-amber-900 border-amber-200'
                        }`}
                      >
                        {selectedBuilding.showMapLabel === false ? 'Hidden' : 'On Map'}
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        id="m-claim-map-label"
                        type="text"
                        maxLength={36}
                        value={formMapLabel}
                        onChange={(e) => handleMapLabelChange(e.target.value)}
                        onBlur={handleMapLabelBlur}
                        placeholder="e.g. Safe House, Quest Hook..."
                        className="flex-1 min-w-0 px-2.5 py-2 text-xs border border-slate-300 rounded bg-white text-slate-900"
                      />
                      {formMapLabel.length > 0 && (
                        <button
                          type="button"
                          onClick={handleClearMapLabel}
                          aria-label="Clear custom map label"
                          className="p-2 text-slate-400 hover:text-slate-700 bg-white border border-slate-300 rounded cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500">
                Select a building silhouette first.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interior Tool Handoff & Link Dialog */}

    </div>
  );
};
