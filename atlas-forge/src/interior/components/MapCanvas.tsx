import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  Ban,
  BoxSelect,
  Check,
  CheckCircle2,
  ChevronDown,
  DoorOpen,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Link2,
  Lock,
  Magnet,
  Maximize2,
  Minus,
  Pentagon,
  Plus,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Square,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { MATERIAL_PALETTE } from '../data/presets';
import {
  AccessibilityDiagnostics,
  CustomFloorTexture,
  DoorKind,
  Doorway,
  FloorMaterial,
  MapDocument,
  PathResult,
  PathStop,
  Point,
  Room,
  SecretPassage,
  SliceMode,
  SliceRegion,
  StairKind,
  ToolMode,
  ViewportState,
} from '../types/map';
import {
  applyLinkedCurveBend,
  applyLinkedEdgeMove,
  applyLinkedVertexMove,
  buildRoomHiddenWallPath,
  buildRoomSvgPath,
  buildRoomWallPath,
  computeBendFromHandle,
  computeFloorSliceWalls,
  detectDoorPassageOverlaps,
  distance,
  findClosestRoomEdge,
  findLinkedStairRoomOnFloor,
  findOverlappingCurveEdges,
  findOverlappingRoomVertices,
  getAdjacentFloorTowardGround,
  getEdgeHandlePoint,
  getEffectiveRoomAreaSqFt,
  getEffectiveRoomLabelAnchor,
  getOrientedStairBox,
  getPointAlongRoomEdge,
  getPolygonBoundingBox,
  getRoomRotationHandleGeometry,
  isDoorwaySliced,
  isPointInSlice,
  LinkedEdgeTarget,
  LinkedVertexOrigTarget,
  LinkedVertexTarget,
  NODE_OVERLAP_TOLERANCE,
  pickNearestDoorway,
  pickNearestPolygonEdge,
  pickNearestRoomHandle,
  pickNearestSecretPassage,
  pickNearestSecretPassageHandle,
  pickNearestSliceHandle,
  pointInPolygon,
  pointToSegmentDistance,
  resolveSecretPassagePolyline,
  rotateRoomGeometry,
  sampleRoomPolygon,
  slideDoorwayAlongWall,
  snapPoint,
  snapPointFullGrid,
} from '../utils/geometry';

function DeleteNodeIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 9a6 6 0 0 1 12 0" fill="currentColor" fillOpacity="0.2" />
      <path d="M3 9h18" />
      <path d="M19 9v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9" />
      <path d="M10 13.5v4.5" />
      <path d="M14 13.5v4.5" />
    </svg>
  );
}

interface MapCanvasProps {
  doc: MapDocument;
  darkTheme: boolean;
  activeTool: ToolMode;
  onSwitchTool: (tool: ToolMode) => void;
  viewport: ViewportState;
  onViewportChange: React.Dispatch<React.SetStateAction<ViewportState>>;
  selectedRoomId: string | null;
  selectedDoorId: string | null;
  selectedSecretPassageId: string | null;
  selectedSliceId: string | null;
  onSelectRoom: (id: string | null) => void;
  onSelectDoor: (id: string | null) => void;
  onSelectSecretPassage: (id: string | null) => void;
  onSelectSlice: (id: string | null) => void;
  activeSliceMode: SliceMode;
  onChangeActiveSliceMode: (mode: SliceMode) => void;
  onAddSlice: (slice: SliceRegion) => void;
  onSlicesLivePreview: (slices: SliceRegion[]) => void;
  onSlicesCommit: (slices: SliceRegion[]) => void;
  onUpdateSlice: (sliceId: string, patch: Partial<SliceRegion>) => void;
  onDeleteSlice: (sliceId: string) => void;
  onInsertSliceEdgeVertex: (sliceId: string, edgeIndex: number) => void;
  onDeleteSliceVertex: (sliceId: string, vertexIndex: number) => void;
  onRoomsCommit: (rooms: Room[], label?: string) => void;
  onRoomsLivePreview: (rooms: Room[]) => void;
  onCancelLivePreview?: () => void;
  onAddRoom: (room: Room) => void;
  onDeleteRoom: (roomId: string) => void;
  onToggleRoomUnwalled: (roomId: string) => void;
  onRenameRoom: (roomId: string, name: string) => void;
  onSetRoomFloorMaterial: (roomId: string, material: FloorMaterial) => void;
  onToggleRoomRotateStairTexture: (roomId: string) => void;
  onImportRoomCustomTexture: (roomId: string, texture: CustomFloorTexture) => void;
  onApplyRoomCustomTexture: (roomId: string, textureId: string) => void;
  onUpdateCustomTextureTileSize: (textureId: string, tileSize: number) => void;
  onDeleteCustomTexture: (textureId: string) => void;
  onToast?: (msg: string) => void;
  onInsertEdgeVertex: (roomId: string, edgeIndex: number) => void;
  onDeleteRoomVertex: (roomId: string, vertexIndex: number) => void;
  onToggleDoorway: (doorId: string) => void;
  onUpdateDoorway: (doorId: string, patch: Partial<Doorway>) => void;
  onDeleteDoorway: (doorId: string) => void;
  onDoorwaysLivePreview: (doorways: Doorway[]) => void;
  onDoorwaysCommit: (doorways: Doorway[]) => void;
  onAddDoorwayAtPoint: (pt: Point) => void;
  activeDoorKind: DoorKind;
  onChangeActiveDoorKind: (kind: DoorKind) => void;
  onAddSecretPassage: (passage: SecretPassage) => void;
  onSecretPassagesLivePreview: (passages: SecretPassage[]) => void;
  onSecretPassagesCommit: (passages: SecretPassage[]) => void;
  onDeleteSecretPassage: (id: string) => void;
  onPathRoomTap: (roomId: string) => void;
  pathStops: PathStop[];
  pathResult: PathResult | null;
  accessibility: AccessibilityDiagnostics;
  onJumpToFloorAndRoom?: (floorId: string, roomId: string) => void;
  onToggleRoomTagSetting: (roomId: string, setting: 'secret' | 'locked') => void;
  onCreateStairLink: (params: {
    fromFloorId: string;
    fromRoomId: string;
    toFloorId: string;
    toRoomId?: string;
    createMatchingRoom?: boolean;
    kind: StairKind;
    label: string;
  }) => void;
  onDeleteStairLink: (id: string) => void;
  onToggleSnap: () => void;
  rotationSnap: boolean;
  onToggleRotationSnap: () => void;
  onToggleAutoConnectDoors: () => void;
  linkOverlappingNodes: boolean;
  onToggleLinkOverlappingNodes: () => void;
  onFitToScreen: () => void;
}

type SecretHandleKind =
  | { role: 'start-anchor' }
  | { role: 'end-anchor' }
  | { role: 'start-protrusion' }
  | { role: 'end-protrusion' }
  | { role: 'mid-point'; midIndex: number };

type DragState =
  | { kind: 'pan'; startClient: Point; startVp: ViewportState; moved: boolean }
  | {
      kind: 'move-room';
      roomId: string;
      startWorld: Point;
      origPoints: Point[];
      moved: boolean;
    }
  | {
      kind: 'move-vertex';
      roomId: string;
      vertexIndex: number;
      origPoints: Point[];
      linkedVertices: LinkedVertexTarget[];
      moved: boolean;
    }
  | {
      kind: 'bend-edge';
      roomId: string;
      edgeIndex: number;
      origCurves: number[];
      linkedEdges: LinkedEdgeTarget[];
      moved: boolean;
    }
  | {
      kind: 'move-edge';
      roomId: string;
      edgeIndex: number;
      startWorld: Point;
      origPoints: Point[];
      linkedVertices: LinkedVertexOrigTarget[];
      moved: boolean;
    }
  | {
      kind: 'rotate-room';
      roomId: string;
      center: Point;
      startAngle: number;
      origPoints: Point[];
      origRotationDeg: number;
      currentDeg: number;
      moved: boolean;
    }
  | {
      kind: 'move-slice';
      sliceId: string;
      startWorld: Point;
      origPoints: Point[];
      moved: boolean;
    }
  | {
      kind: 'move-slice-vertex';
      sliceId: string;
      vertexIndex: number;
      origPoints: Point[];
      moved: boolean;
    }
  | {
      kind: 'bend-slice-edge';
      sliceId: string;
      edgeIndex: number;
      origCurves: number[];
      moved: boolean;
    }
  | {
      kind: 'move-slice-edge';
      sliceId: string;
      edgeIndex: number;
      startWorld: Point;
      origPoints: Point[];
      moved: boolean;
    }
  | {
      kind: 'slide-doorway';
      doorId: string;
      startWorld: Point;
      moved: boolean;
    }
  | {
      kind: 'drag-secret-handle';
      passageId: string;
      handle: SecretHandleKind;
      moved: boolean;
    }
  | {
      kind: 'draw-rect';
      mode: 'rect-room' | 'hallway' | 'slice';
      startWorld: Point;
      currWorld: Point;
    };

export const MapCanvas: React.FC<MapCanvasProps> = React.memo(({
  doc,
  darkTheme,
  activeTool,
  onSwitchTool,
  viewport,
  onViewportChange,
  selectedRoomId,
  selectedDoorId,
  selectedSecretPassageId,
  selectedSliceId,
  onSelectRoom,
  onSelectDoor,
  onSelectSecretPassage,
  onSelectSlice,
  activeSliceMode,
  onChangeActiveSliceMode,
  onAddSlice,
  onSlicesLivePreview,
  onSlicesCommit,
  onUpdateSlice,
  onDeleteSlice,
  onInsertSliceEdgeVertex,
  onDeleteSliceVertex,
  onRoomsCommit,
  onRoomsLivePreview,
  onCancelLivePreview,
  onAddRoom,
  onDeleteRoom,
  onToggleRoomUnwalled,
  onRenameRoom,
  onSetRoomFloorMaterial,
  onToggleRoomRotateStairTexture,
  onImportRoomCustomTexture,
  onApplyRoomCustomTexture,
  onUpdateCustomTextureTileSize,
  onDeleteCustomTexture,
  onToast,
  onInsertEdgeVertex,
  onDeleteRoomVertex,
  onToggleDoorway,
  onUpdateDoorway,
  onDeleteDoorway,
  onDoorwaysLivePreview,
  onDoorwaysCommit,
  onAddDoorwayAtPoint,
  activeDoorKind,
  onChangeActiveDoorKind,
  onAddSecretPassage,
  onSecretPassagesLivePreview,
  onSecretPassagesCommit,
  onDeleteSecretPassage,
  onPathRoomTap,
  pathStops: _pathStops,
  pathResult,
  accessibility,
  onJumpToFloorAndRoom,
  onToggleRoomTagSetting,
  onCreateStairLink,
  onDeleteStairLink,
  onToggleSnap,
  rotationSnap,
  onToggleRotationSnap,
  onToggleAutoConnectDoors,
  linkOverlappingNodes,
  onToggleLinkOverlappingNodes,
  onFitToScreen,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textureFileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastDragKeyRef = useRef<string>('');
  const lastHoverKeyRef = useRef<string>('');
  const latestLiveRoomsRef = useRef<Room[] | null>(null);
  const latestLiveDoorwaysRef = useRef<Doorway[] | null>(null);
  const latestLivePassagesRef = useRef<SecretPassage[] | null>(null);
  const latestLiveSlicesRef = useRef<SliceRegion[] | null>(null);
  const [dragPreview, setDragPreview] = useState<DragState | null>(null);
  const [hoverWorld, setHoverWorld] = useState<Point | null>(null);
  const [hoveredSliceId, setHoveredSliceId] = useState<string | null>(null);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [selectedSliceVertexIndex, setSelectedSliceVertexIndex] = useState<number | null>(null);
  const [selectedSecretMidIndex, setSelectedSecretMidIndex] = useState<number | null>(null);
  const [linkTargetVal, setLinkTargetVal] = useState<string>('');
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [roomPanelSection, setRoomPanelSection] = useState<'state' | 'links' | 'texture' | null>(null);
  const [roomNameDraft, setRoomNameDraft] = useState('');
  const [editingSecretPassageId, setEditingSecretPassageId] = useState<string | null>(null);
  const [secretLabelDraft, setSecretLabelDraft] = useState('');
  const [polyDraft, setPolyDraft] = useState<Point[]>([]);
  const [sliceShapeMode, setSliceShapeMode] = useState<'rect' | 'polygon'>('rect');
  const [slicePolyDraft, setSlicePolyDraft] = useState<Point[]>([]);
  const [secretDraft, setSecretDraft] = useState<{
    fromRoomId: string;
    startAnchor: Point;
    startElbow: Point;
    midPoints: Point[];
  } | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);

  const docRef = useRef<MapDocument>(doc);
  docRef.current = doc;
  const prevSelectedKeyRef = useRef<string | null>(null);
  const prevFloorIdRef = useRef<string>(doc.activeFloorId);

  const pinchRef = useRef<{
    active: boolean;
    prevDist: number;
    prevMid: Point;
  }>({ active: false, prevDist: 0, prevMid: { x: 0, y: 0 } });

  const activeSlices = useMemo(() => doc.slices ?? [], [doc.slices]);

  const selectedElementKey =
    activeTool === 'select'
      ? selectedRoomId
        ? `room:${selectedRoomId}`
        : selectedDoorId
          ? `door:${selectedDoorId}`
          : selectedSliceId
            ? `slice:${selectedSliceId}`
            : selectedSecretPassageId
              ? `passage:${selectedSecretPassageId}`
              : null
      : null;

  const teleportCameraToRoom = useCallback(
    (room: Room) => {
      if (room.points.length < 3) return;
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      const viewW = rect?.width ?? window.innerWidth;
      const viewH = rect?.height ?? window.innerHeight;
      const box = getPolygonBoundingBox(sampleRoomPolygon(room, 6));
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      onViewportChange((vp) => ({
        ...vp,
        x: viewW / 2 - cx * vp.zoom,
        y: viewH / 2 + 10 - cy * vp.zoom,
      }));
    },
    [onViewportChange]
  );

  useEffect(() => {
    setPolyDraft([]);
    setSlicePolyDraft([]);
    setSecretDraft(null);
    setHoverWorld(null);
    setHoveredSliceId(null);
    setInspectorOpen(false);
    setRoomPanelSection(null);
    setSelectedVertexIndex(null);
    setSelectedSliceVertexIndex(null);
    setSelectedSecretMidIndex(null);
    lastHoverKeyRef.current = '';
    dragRef.current = null;
    setDragPreview(null);
  }, [activeTool]);

  useEffect(() => {
    const floorChanged = doc.activeFloorId !== prevFloorIdRef.current;
    const prevFloorId = prevFloorIdRef.current;
    prevFloorIdRef.current = doc.activeFloorId;

    const selectionChanged = selectedElementKey !== prevSelectedKeyRef.current;
    prevSelectedKeyRef.current = selectedElementKey;

    if (!floorChanged && !selectionChanged) return;

    setInspectorOpen(false);
    setRoomPanelSection(null);

    if (floorChanged) {
      const currentDoc = docRef.current;
      const targetRoom = selectedRoomId
        ? currentDoc.rooms.find((r) => r.id === selectedRoomId) ?? null
        : findLinkedStairRoomOnFloor(
            currentDoc.floors,
            currentDoc.stairLinks,
            currentDoc.activeFloorId,
            prevFloorId
          );
      if (targetRoom) {
        teleportCameraToRoom(targetRoom);
      }
    }
  }, [
    doc.activeFloorId,
    selectedElementKey,
    selectedRoomId,
    teleportCameraToRoom,
  ]);

  useEffect(() => {
    setSelectedVertexIndex(null);
  }, [selectedRoomId]);

  const currentSelectedRoomObj = useMemo(
    () => doc.rooms.find((r) => r.id === selectedRoomId) ?? null,
    [doc.rooms, selectedRoomId]
  );

  useEffect(() => {
    setRoomNameDraft(currentSelectedRoomObj?.name ?? '');
  }, [currentSelectedRoomObj?.id, currentSelectedRoomObj?.name]);

  useEffect(() => {
    setSelectedSliceVertexIndex(null);
  }, [selectedSliceId]);

  useEffect(() => {
    setSelectedSecretMidIndex(null);
    setEditingSecretPassageId(null);
  }, [selectedSecretPassageId]);

  const commitSecretLabelRename = useCallback(
    (passage: SecretPassage) => {
      const trimmed = secretLabelDraft.trim();
      if (trimmed && trimmed !== passage.label) {
        onSecretPassagesCommit(
          doc.secretPassages.map((sp) =>
            sp.id === passage.id ? { ...sp, label: trimmed } : sp
          )
        );
      }
      setEditingSecretPassageId(null);
    },
    [doc.secretPassages, onSecretPassagesCommit, secretLabelDraft]
  );

  const handleDeleteSecretPassageMidNode = useCallback(
    (passageId: string, midIndex: number) => {
      onSecretPassagesCommit(
        doc.secretPassages.map((item) => {
          if (item.id !== passageId) return item;
          const nextMidPoints = item.midPoints.filter((_, mIdx) => mIdx !== midIndex);
          const updated = { ...item, midPoints: nextMidPoints };
          const nextRes = resolveSecretPassagePolyline(updated, doc.rooms);
          return { ...updated, points: nextRes.points };
        })
      );
      setSelectedSecretMidIndex(null);
    },
    [doc.rooms, doc.secretPassages, onSecretPassagesCommit]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(true);
      } else if (e.code === 'Escape') {
        if (dragRef.current) {
          dragRef.current = null;
          setDragPreview(null);
          latestLiveRoomsRef.current = null;
          latestLiveDoorwaysRef.current = null;
          latestLivePassagesRef.current = null;
          latestLiveSlicesRef.current = null;
          onCancelLivePreview?.();
        }
        setPolyDraft([]);
        setSlicePolyDraft([]);
        setSecretDraft(null);
        setSelectedVertexIndex(null);
        setSelectedSliceVertexIndex(null);
        setSelectedSecretMidIndex(null);
        setRoomPanelSection(null);
        setInspectorOpen(false);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRoomId && selectedVertexIndex !== null) {
          const rm = doc.rooms.find((r) => r.id === selectedRoomId);
          if (rm && rm.points.length > 3) {
            e.preventDefault();
            onDeleteRoomVertex(selectedRoomId, selectedVertexIndex);
            setSelectedVertexIndex(null);
          }
        } else if (selectedSliceId && selectedSliceVertexIndex !== null) {
          const sl = activeSlices.find((s) => s.id === selectedSliceId);
          if (sl && sl.points.length > 3) {
            e.preventDefault();
            onDeleteSliceVertex(selectedSliceId, selectedSliceVertexIndex);
            setSelectedSliceVertexIndex(null);
          }
        } else if (selectedSecretPassageId && selectedSecretMidIndex !== null) {
          const sp = doc.secretPassages.find((p) => p.id === selectedSecretPassageId);
          if (
            sp &&
            selectedSecretMidIndex >= 0 &&
            selectedSecretMidIndex < sp.midPoints.length
          ) {
            e.preventDefault();
            handleDeleteSecretPassageMidNode(
              selectedSecretPassageId,
              selectedSecretMidIndex
            );
          }
        } else if (selectedSliceId) {
          e.preventDefault();
          onDeleteSlice(selectedSliceId);
        } else if (selectedRoomId) {
          e.preventDefault();
          onDeleteRoom(selectedRoomId);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    activeSlices,
    doc.rooms,
    doc.secretPassages,
    handleDeleteSecretPassageMidNode,
    onCancelLivePreview,
    onDeleteRoom,
    onDeleteRoomVertex,
    onDeleteSlice,
    onDeleteSliceVertex,
    selectedRoomId,
    selectedSecretMidIndex,
    selectedSecretPassageId,
    selectedSliceId,
    selectedSliceVertexIndex,
    selectedVertexIndex,
  ]);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number, vp = viewport): Point => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - vp.x) / vp.zoom,
        y: (clientY - rect.top - vp.y) / vp.zoom,
      };
    },
    [viewport]
  );

  // Native wheel listener for 2-finger trackpad panning + Ctrl/Meta pinch-to-zoom (mounted once)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        onViewportChange((prev) => {
          const nextZoom = Math.min(4, Math.max(0.2, prev.zoom * factor));
          const ratio = nextZoom / prev.zoom;
          return {
            zoom: nextZoom,
            x: cx - (cx - prev.x) * ratio,
            y: cy - (cy - prev.y) * ratio,
          };
        });
      } else {
        onViewportChange((prev) => ({
          ...prev,
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }));
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [onViewportChange]);

  const findRoomAtPoint = useCallback(
    (pt: Point): Room | null => {
      for (let i = doc.rooms.length - 1; i >= 0; i--) {
        const r = doc.rooms[i];
        const poly = sampleRoomPolygon(r, 8);
        const box = getPolygonBoundingBox(poly);
        if (
          pt.x < box.minX ||
          pt.x > box.maxX ||
          pt.y < box.minY ||
          pt.y > box.maxY
        ) {
          continue;
        }
        if (pointInPolygon(pt, poly)) return r;
      }
      return null;
    },
    [doc.rooms]
  );

  const findSliceHitAtPoint = useCallback(
    (pt: Point, hitTol: number): SliceRegion | null => {
      for (let i = activeSlices.length - 1; i >= 0; i--) {
        const sl = activeSlices[i];
        if (sl.points.length < 3) continue;
        // Edge distance hit
        for (let e = 0; e < sl.points.length; e++) {
          const a = sl.points[e];
          const b = sl.points[(e + 1) % sl.points.length];
          const bend = sl.edgeCurves[e] ?? 0;
          let dEdge = Infinity;
          if (Math.abs(bend) > 0.5) {
            let prev = a;
            for (let s = 1; s <= 16; s++) {
              const next = getPointAlongRoomEdge(sl, e, s / 16);
              dEdge = Math.min(dEdge, pointToSegmentDistance(pt, prev, next).dist);
              prev = next;
            }
          } else {
            dEdge = pointToSegmentDistance(pt, a, b).dist;
          }
          if (dEdge <= hitTol) return sl;
        }
        if (isPointInSlice(pt, sl)) {
          if (sl.mode === 'floor') return sl;
          const box = getPolygonBoundingBox(sl.points);
          if (Math.min(box.width, box.height) <= 96) return sl;
          const nearRoomWall = doc.rooms.some((r) => findClosestRoomEdge(r, pt).dist <= 26);
          if (nearRoomWall) return sl;
        }
      }
      return null;
    },
    [activeSlices, doc.rooms]
  );

  const finalizePolygon = useCallback(
    (pts: Point[]) => {
      if (pts.length < 3) return;
      const newRoom: Room = {
        id: `room-${Date.now()}`,
        name: `Chamber ${doc.rooms.length + 1}`,
        type: 'room',
        points: pts,
        edgeCurves: new Array(pts.length).fill(0),
        floorMaterial: 'stone',
        lighting: 'bright',
        elevationFt: 0,
        notes: '',
        showLabel: true,
      };
      onAddRoom(newRoom);
      setPolyDraft([]);
    },
    [doc.rooms.length, onAddRoom]
  );

  const finalizeSlicePolygon = useCallback(
    (pts: Point[]) => {
      if (pts.length < 3) return;
      const newSlice: SliceRegion = {
        id: `slice-${Date.now()}`,
        mode: activeSliceMode,
        points: pts,
        edgeCurves: new Array(pts.length).fill(0),
      };
      onAddSlice(newSlice);
      setSlicePolyDraft([]);
    },
    [activeSliceMode, onAddSlice]
  );

  const handlePointerStart = useCallback(
    (clientX: number, clientY: number, button: number, shiftKey: boolean) => {
      const worldPt = clientToWorld(clientX, clientY);
      const snappedPt = snapPoint(worldPt, doc.grid.cellSize, doc.grid.snapToGrid);
      const hitTol = 18 / viewport.zoom;
      lastDragKeyRef.current = '';
      latestLiveRoomsRef.current = null;
      latestLiveDoorwaysRef.current = null;
      latestLivePassagesRef.current = null;
      latestLiveSlicesRef.current = null;

      if (button === 1 || spacePressed || activeTool === 'pan') {
        const state: DragState = {
          kind: 'pan',
          startClient: { x: clientX, y: clientY },
          startVp: viewport,
          moved: false,
        };
        dragRef.current = state;
        setDragPreview(state);
        return;
      }

      if (activeTool === 'rect-room' || activeTool === 'hallway') {
        const fullSnap = snapPointFullGrid(
          worldPt,
          doc.grid.cellSize,
          doc.grid.snapToGrid
        );
        const state: DragState = {
          kind: 'draw-rect',
          mode: activeTool,
          startWorld: fullSnap,
          currWorld: fullSnap,
        };
        dragRef.current = state;
        setDragPreview(state);
        return;
      }

      if (activeTool === 'slice') {
        if (sliceShapeMode === 'rect') {
          const fullSnap = snapPoint(worldPt, doc.grid.cellSize, doc.grid.snapToGrid);
          const state: DragState = {
            kind: 'draw-rect',
            mode: 'slice',
            startWorld: fullSnap,
            currWorld: fullSnap,
          };
          dragRef.current = state;
          setDragPreview(state);
        } else {
          if (
            slicePolyDraft.length >= 3 &&
            distance(worldPt, slicePolyDraft[0]) < 22 / viewport.zoom
          ) {
            finalizeSlicePolygon(slicePolyDraft);
          } else {
            setSlicePolyDraft((prev) => [...prev, snappedPt]);
          }
        }
        return;
      }

      if (activeTool === 'polygon') {
        if (
          polyDraft.length >= 3 &&
          distance(worldPt, polyDraft[0]) < 22 / viewport.zoom
        ) {
          finalizePolygon(polyDraft);
        } else {
          setPolyDraft((prev) => [...prev, snappedPt]);
        }
        return;
      }

      if (activeTool === 'doorway') {
        const hitDoor = pickNearestDoorway(
          doc.doorways,
          activeSlices,
          worldPt,
          Math.max(hitTol, 18)
        );
        if (hitDoor) {
          onSelectDoor(hitDoor.door.id);
          const state: DragState = {
            kind: 'slide-doorway',
            doorId: hitDoor.door.id,
            startWorld: worldPt,
            moved: false,
          };
          dragRef.current = state;
          setDragPreview(state);
          return;
        }
        onAddDoorwayAtPoint(worldPt);
        return;
      }

      if (activeTool === 'secret-passage') {
        const hitRoom = findRoomAtPoint(worldPt);
        if (!secretDraft) {
          let startRoom = hitRoom;
          let startWallPt = snappedPt;
          if (!startRoom && doc.rooms.length > 0) {
            let bestDist = Infinity;
            for (const r of doc.rooms) {
              const edge = findClosestRoomEdge(r, worldPt);
              if (edge.dist < bestDist && edge.dist < 36 / viewport.zoom) {
                bestDist = edge.dist;
                startRoom = r;
                startWallPt = edge.closest;
              }
            }
          } else if (startRoom) {
            startWallPt = findClosestRoomEdge(startRoom, worldPt).closest;
          }

          if (startRoom) {
            const resolvedStart = resolveSecretPassagePolyline(
              {
                fromRoomId: startRoom.id,
                toRoomId: null,
                startAnchor: startWallPt,
                startProtrusion: 28,
                endAnchor: startWallPt,
                endProtrusion: 0,
                midPoints: [],
              },
              doc.rooms
            );
            setSecretDraft({
              fromRoomId: startRoom.id,
              startAnchor: resolvedStart.startAnchor,
              startElbow: resolvedStart.startElbow,
              midPoints: [],
            });
          }
        } else {
          if (shiftKey) {
            setSecretDraft((prev) =>
              prev ? { ...prev, midPoints: [...prev.midPoints, snappedPt] } : null
            );
            return;
          }

          if (hitRoom && hitRoom.id !== secretDraft.fromRoomId) {
            const endAnchor = findClosestRoomEdge(hitRoom, worldPt).closest;
            const base = {
              fromRoomId: secretDraft.fromRoomId,
              toRoomId: hitRoom.id,
              startAnchor: secretDraft.startAnchor,
              startProtrusion: 28,
              endAnchor,
              endProtrusion: 28,
              midPoints: secretDraft.midPoints,
            };
            const resolved = resolveSecretPassagePolyline(base, doc.rooms);
            onAddSecretPassage({
              id: `sp-${Date.now()}`,
              ...base,
              startAnchor: resolved.startAnchor,
              endAnchor: resolved.endAnchor,
              points: resolved.points,
              label: 'secret passage',
              dcInvestigation: 15,
              isSecret: true,
            });
            setSecretDraft(null);
          } else if (!hitRoom) {
            const base = {
              fromRoomId: secretDraft.fromRoomId,
              toRoomId: null,
              startAnchor: secretDraft.startAnchor,
              startProtrusion: 28,
              endAnchor: snappedPt,
              endProtrusion: 0,
              midPoints: secretDraft.midPoints,
            };
            const resolved = resolveSecretPassagePolyline(base, doc.rooms);
            onAddSecretPassage({
              id: `sp-${Date.now()}`,
              ...base,
              startAnchor: resolved.startAnchor,
              endAnchor: resolved.endAnchor,
              points: resolved.points,
              label: 'secret passage',
              dcInvestigation: 15,
              isSecret: true,
            });
            setSecretDraft(null);
          } else {
            setSecretDraft((prev) =>
              prev ? { ...prev, midPoints: [...prev.midPoints, snappedPt] } : null
            );
          }
        }
        return;
      }

      if (activeTool === 'pathing') {
        const hitRoom = findRoomAtPoint(worldPt);
        if (hitRoom) {
          onPathRoomTap(hitRoom.id);
        }
        return;
      }

      // SELECT / EDIT MODE
      const nearestDoor = pickNearestDoorway(
        doc.doorways,
        activeSlices,
        worldPt,
        Math.max(hitTol, 14)
      );
      const handleVsDoorTiePx = 2 / viewport.zoom;

      const selectedSP = doc.secretPassages.find((s) => s.id === selectedSecretPassageId);
      if (selectedSP) {
        const spHit = pickNearestSecretPassageHandle(
          selectedSP,
          doc.rooms,
          worldPt,
          hitTol,
          viewport.zoom
        );
        if (spHit && (!nearestDoor || spHit.dist <= nearestDoor.dist + handleVsDoorTiePx)) {
          if (spHit.kind === 'existing') {
            if (spHit.handle.role === 'mid-point') {
              setSelectedSecretMidIndex(spHit.handle.midIndex);
            } else {
              setSelectedSecretMidIndex(null);
            }
            const state: DragState = {
              kind: 'drag-secret-handle',
              passageId: selectedSP.id,
              handle: spHit.handle,
              moved: false,
            };
            dragRef.current = state;
            setDragPreview(state);
            return;
          }
          const nextPassages = doc.secretPassages.map((sp) => {
            if (sp.id !== selectedSP.id) return sp;
            const nextMidPoints = [
              ...sp.midPoints.slice(0, spHit.insertIndex),
              spHit.point,
              ...sp.midPoints.slice(spHit.insertIndex),
            ];
            const updated = { ...sp, midPoints: nextMidPoints };
            const nextRes = resolveSecretPassagePolyline(updated, doc.rooms);
            return { ...updated, points: nextRes.points };
          });
          onSecretPassagesLivePreview(nextPassages);
          setSelectedSecretMidIndex(spHit.insertIndex);
          const state: DragState = {
            kind: 'drag-secret-handle',
            passageId: selectedSP.id,
            handle: { role: 'mid-point', midIndex: spHit.insertIndex },
            moved: true,
          };
          dragRef.current = state;
          setDragPreview(state);
          return;
        }
      }

      const selectedSlice = activeSlices.find((s) => s.id === selectedSliceId);
      if (selectedSlice) {
        const sliceHit = pickNearestSliceHandle(
          selectedSlice,
          worldPt,
          hitTol,
          viewport.zoom
        );
        if (
          sliceHit &&
          (!nearestDoor || sliceHit.dist <= nearestDoor.dist + handleVsDoorTiePx)
        ) {
          if (sliceHit.kind === 'add-vertex') {
            onInsertSliceEdgeVertex(selectedSlice.id, sliceHit.edgeIndex);
            return;
          }
          if (sliceHit.kind === 'curve') {
            const state: DragState = {
              kind: 'bend-slice-edge',
              sliceId: selectedSlice.id,
              edgeIndex: sliceHit.edgeIndex,
              origCurves: [...selectedSlice.edgeCurves],
              moved: false,
            };
            dragRef.current = state;
            setDragPreview(state);
            return;
          }
          setSelectedSliceVertexIndex(sliceHit.vertexIndex);
          const state: DragState = {
            kind: 'move-slice-vertex',
            sliceId: selectedSlice.id,
            vertexIndex: sliceHit.vertexIndex,
            origPoints: selectedSlice.points.map((p) => ({ ...p })),
            moved: false,
          };
          dragRef.current = state;
          setDragPreview(state);
          return;
        }
      }

      const selectedRoom = doc.rooms.find((r) => r.id === selectedRoomId);
      if (selectedRoom) {
        const roomHit = pickNearestRoomHandle(
          selectedRoom,
          worldPt,
          hitTol,
          viewport.zoom
        );
        if (
          roomHit &&
          (!nearestDoor || roomHit.dist <= nearestDoor.dist + handleVsDoorTiePx)
        ) {
          if (roomHit.kind === 'rotate') {
            const rotGeo = getRoomRotationHandleGeometry(selectedRoom);
            const startAngle = Math.atan2(
              worldPt.y - rotGeo.center.y,
              worldPt.x - rotGeo.center.x
            );
            const state: DragState = {
              kind: 'rotate-room',
              roomId: selectedRoom.id,
              center: rotGeo.center,
              startAngle,
              origPoints: selectedRoom.points.map((p) => ({ ...p })),
              origRotationDeg: selectedRoom.rotationDeg ?? 0,
              currentDeg: 0,
              moved: false,
            };
            dragRef.current = state;
            setDragPreview(state);
            return;
          }
          if (roomHit.kind === 'add-vertex') {
            onInsertEdgeVertex(selectedRoom.id, roomHit.edgeIndex);
            return;
          }
          if (roomHit.kind === 'curve') {
            const a = selectedRoom.points[roomHit.edgeIndex];
            const b = selectedRoom.points[(roomHit.edgeIndex + 1) % selectedRoom.points.length];
            const bend = selectedRoom.edgeCurves[roomHit.edgeIndex] ?? 0;
            const handle = getEdgeHandlePoint(a, b, bend);
            const linkedEdges = linkOverlappingNodes
              ? findOverlappingCurveEdges(doc.rooms, handle, NODE_OVERLAP_TOLERANCE)
              : [{ roomId: selectedRoom.id, edgeIndex: roomHit.edgeIndex }];
            const state: DragState = {
              kind: 'bend-edge',
              roomId: selectedRoom.id,
              edgeIndex: roomHit.edgeIndex,
              origCurves: [...selectedRoom.edgeCurves],
              linkedEdges,
              moved: false,
            };
            dragRef.current = state;
            setDragPreview(state);
            return;
          }
          setSelectedVertexIndex(roomHit.vertexIndex);
          const linkedVertices = linkOverlappingNodes
            ? findOverlappingRoomVertices(
                doc.rooms,
                selectedRoom.points[roomHit.vertexIndex],
                NODE_OVERLAP_TOLERANCE
              )
            : [{ roomId: selectedRoom.id, vertexIndex: roomHit.vertexIndex }];
          const state: DragState = {
            kind: 'move-vertex',
            roomId: selectedRoom.id,
            vertexIndex: roomHit.vertexIndex,
            origPoints: selectedRoom.points.map((p) => ({ ...p })),
            linkedVertices,
            moved: false,
          };
          dragRef.current = state;
          setDragPreview(state);
          return;
        }
      }

      if (nearestDoor) {
        onSelectDoor(nearestDoor.door.id);
        const state: DragState = {
          kind: 'slide-doorway',
          doorId: nearestDoor.door.id,
          startWorld: worldPt,
          moved: false,
        };
        dragRef.current = state;
        setDragPreview(state);
        return;
      }

      if (selectedSlice) {
        const sliceEdge = pickNearestPolygonEdge(selectedSlice, worldPt, hitTol);
        if (sliceEdge) {
          const state: DragState = {
            kind: 'move-slice-edge',
            sliceId: selectedSlice.id,
            edgeIndex: sliceEdge.edgeIndex,
            startWorld: worldPt,
            origPoints: selectedSlice.points.map((p) => ({ ...p })),
            moved: false,
          };
          dragRef.current = state;
          setDragPreview(state);
          return;
        }

        if (isPointInSlice(worldPt, selectedSlice)) {
          const state: DragState = {
            kind: 'move-slice',
            sliceId: selectedSlice.id,
            startWorld: worldPt,
            origPoints: selectedSlice.points.map((p) => ({ ...p })),
            moved: false,
          };
          dragRef.current = state;
          setDragPreview(state);
          return;
        }
      }

      const hitSP = pickNearestSecretPassage(doc.secretPassages, worldPt, hitTol);
      if (hitSP) {
        setSelectedSecretMidIndex(null);
        onSelectSecretPassage(hitSP.passage.id);
        return;
      }

      const hitSlice = findSliceHitAtPoint(worldPt, hitTol);
      if (hitSlice) {
        onSelectSlice(hitSlice.id);
        const state: DragState = {
          kind: 'move-slice',
          sliceId: hitSlice.id,
          startWorld: worldPt,
          origPoints: hitSlice.points.map((p) => ({ ...p })),
          moved: false,
        };
        dragRef.current = state;
        setDragPreview(state);
        return;
      }

      if (selectedRoom) {
        const roomEdge = pickNearestPolygonEdge(selectedRoom, worldPt, hitTol);
        if (roomEdge) {
          const n = selectedRoom.points.length;
          const i1 = roomEdge.edgeIndex;
          const i2 = (roomEdge.edgeIndex + 1) % n;
          const linkedVertices: LinkedVertexOrigTarget[] = [];
          if (linkOverlappingNodes) {
            const seen = new Set<string>();
            const addMatches = (pt: Point) => {
              for (const m of findOverlappingRoomVertices(
                doc.rooms,
                pt,
                NODE_OVERLAP_TOLERANCE
              )) {
                const k = `${m.roomId}:${m.vertexIndex}`;
                if (seen.has(k)) continue;
                seen.add(k);
                const mr = doc.rooms.find((r) => r.id === m.roomId);
                if (!mr || !mr.points[m.vertexIndex]) continue;
                linkedVertices.push({
                  roomId: m.roomId,
                  vertexIndex: m.vertexIndex,
                  origPt: { ...mr.points[m.vertexIndex] },
                });
              }
            };
            addMatches(selectedRoom.points[i1]);
            addMatches(selectedRoom.points[i2]);
          }
          const state: DragState = {
            kind: 'move-edge',
            roomId: selectedRoom.id,
            edgeIndex: roomEdge.edgeIndex,
            startWorld: worldPt,
            origPoints: selectedRoom.points.map((p) => ({ ...p })),
            linkedVertices,
            moved: false,
          };
          dragRef.current = state;
          setDragPreview(state);
          return;
        }
      }

      const hitRoom = findRoomAtPoint(worldPt);
      if (hitRoom) {
        onSelectRoom(hitRoom.id);
        const state: DragState = {
          kind: 'move-room',
          roomId: hitRoom.id,
          startWorld: worldPt,
          origPoints: hitRoom.points.map((p) => ({ ...p })),
          moved: false,
        };
        dragRef.current = state;
        setDragPreview(state);
        return;
      }

      const state: DragState = {
        kind: 'pan',
        startClient: { x: clientX, y: clientY },
        startVp: viewport,
        moved: false,
      };
      dragRef.current = state;
      setDragPreview(state);
    },
    [
      activeSlices,
      activeTool,
      clientToWorld,
      doc.doorways,
      doc.grid.cellSize,
      doc.grid.snapToGrid,
      doc.rooms,
      doc.secretPassages,
      finalizePolygon,
      finalizeSlicePolygon,
      findRoomAtPoint,
      findSliceHitAtPoint,
      linkOverlappingNodes,
      onAddDoorwayAtPoint,
      onAddSecretPassage,
      onInsertEdgeVertex,
      onInsertSliceEdgeVertex,
      onPathRoomTap,
      onSecretPassagesLivePreview,
      onSelectDoor,
      onSelectRoom,
      onSelectSecretPassage,
      onSelectSlice,
      polyDraft,
      secretDraft,
      selectedRoomId,
      selectedSecretPassageId,
      selectedSliceId,
      slicePolyDraft,
      sliceShapeMode,
      spacePressed,
      viewport,
    ]
  );

  const handlePointerMove = useCallback(
    (clientX: number, clientY: number) => {
      const d = dragRef.current;

      if (!d) {
        if (
          activeTool === 'polygon' ||
          (activeTool === 'slice' && sliceShapeMode === 'polygon') ||
          (activeTool === 'secret-passage' && secretDraft !== null)
        ) {
          const worldPt = clientToWorld(clientX, clientY);
          const snapped = snapPoint(worldPt, doc.grid.cellSize, doc.grid.snapToGrid);
          const hKey = `${snapped.x.toFixed(1)},${snapped.y.toFixed(1)}`;
          if (hKey !== lastHoverKeyRef.current) {
            lastHoverKeyRef.current = hKey;
            setHoverWorld(snapped);
          }
        } else if (activeTool === 'select' && activeSlices.length > 0) {
          const worldPt = clientToWorld(clientX, clientY);
          const hitTol = 18 / viewport.zoom;
          const hit = findSliceHitAtPoint(worldPt, hitTol);
          const nextId = hit ? hit.id : null;
          setHoveredSliceId((curr) => (curr === nextId ? curr : nextId));
        } else if (hoveredSliceId !== null) {
          setHoveredSliceId(null);
        }
        return;
      }

      if (d.kind === 'pan') {
        const dx = clientX - d.startClient.x;
        const dy = clientY - d.startClient.y;
        const moved = d.moved || Math.hypot(dx, dy) > 4;
        dragRef.current = { ...d, moved };
        onViewportChange({
          ...d.startVp,
          x: d.startVp.x + dx,
          y: d.startVp.y + dy,
        });
        return;
      }

      const worldPt = clientToWorld(clientX, clientY);

      if (d.kind === 'draw-rect') {
        const snapped =
          d.mode === 'slice'
            ? snapPoint(worldPt, doc.grid.cellSize, doc.grid.snapToGrid)
            : snapPointFullGrid(worldPt, doc.grid.cellSize, doc.grid.snapToGrid);
        const key = `${snapped.x},${snapped.y}`;
        if (key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        const next: DragState = { ...d, currWorld: snapped };
        dragRef.current = next;
        setDragPreview(next);
        return;
      }

      if (d.kind === 'slide-doorway') {
        const moved = d.moved || distance(worldPt, d.startWorld) > 4;
        if (!moved) return;
        dragRef.current = { ...d, moved: true };
        const nextDoors = doc.doorways.map((door) => {
          if (door.id !== d.doorId) return door;
          const slid = slideDoorwayAlongWall(
            door,
            doc.rooms,
            worldPt,
            doc.autoConnectTolerance + 8
          );
          return {
            ...door,
            position: slid.position,
            angle: slid.angle,
            roomAId: slid.roomAId,
            edgeAIndex: slid.edgeAIndex,
            roomBId: slid.roomBId,
            edgeBIndex: slid.edgeBIndex,
            wallT: slid.wallT,
            customPlaced: true,
          };
        });
        latestLiveDoorwaysRef.current = nextDoors;
        onDoorwaysLivePreview(nextDoors);
        return;
      }

      if (d.kind === 'drag-secret-handle') {
        const snapped = snapPoint(worldPt, doc.grid.cellSize, doc.grid.snapToGrid);
        dragRef.current = { ...d, moved: true };
        const nextPassages = doc.secretPassages.map((sp) => {
          if (sp.id !== d.passageId) return sp;

          let nextSP = { ...sp };
          const h = d.handle;

          if (h.role === 'start-anchor') {
            const hitRoom = findRoomAtPoint(worldPt);
            if (hitRoom && hitRoom.id !== sp.toRoomId) {
              const closest = findClosestRoomEdge(hitRoom, worldPt).closest;
              nextSP = { ...sp, fromRoomId: hitRoom.id, startAnchor: closest };
            } else {
              const fromRoom = doc.rooms.find((r) => r.id === sp.fromRoomId);
              if (fromRoom) {
                const closest = findClosestRoomEdge(fromRoom, worldPt).closest;
                nextSP = { ...sp, startAnchor: closest };
              }
            }
          } else if (h.role === 'end-anchor') {
            const hitRoom = findRoomAtPoint(worldPt);
            if (hitRoom && hitRoom.id !== sp.fromRoomId) {
              const closest = findClosestRoomEdge(hitRoom, worldPt).closest;
              nextSP = {
                ...sp,
                toRoomId: hitRoom.id,
                endAnchor: closest,
                endProtrusion: sp.endProtrusion > 0 ? sp.endProtrusion : 28,
              };
            } else if (!hitRoom) {
              nextSP = {
                ...sp,
                toRoomId: null,
                endAnchor: snapped,
                endProtrusion: 0,
              };
            }
          } else if (h.role === 'start-protrusion') {
            const currentRes = resolveSecretPassagePolyline(sp, doc.rooms);
            const proj =
              (worldPt.x - currentRes.startAnchor.x) * currentRes.startNormal.x +
              (worldPt.y - currentRes.startAnchor.y) * currentRes.startNormal.y;
            const rawProt = Math.max(14, Math.min(140, proj));
            const prot = doc.grid.snapToGrid
              ? Math.max(14, Math.round(rawProt / 5) * 5)
              : Math.round(rawProt);
            if (prot === sp.startProtrusion) return sp;
            nextSP = { ...sp, startProtrusion: prot };
          } else if (h.role === 'end-protrusion') {
            const currentRes = resolveSecretPassagePolyline(sp, doc.rooms);
            if (currentRes.endNormal) {
              const proj =
                (worldPt.x - currentRes.endAnchor.x) * currentRes.endNormal.x +
                (worldPt.y - currentRes.endAnchor.y) * currentRes.endNormal.y;
              const rawProt = Math.max(14, Math.min(140, proj));
              const prot = doc.grid.snapToGrid
                ? Math.max(14, Math.round(rawProt / 5) * 5)
                : Math.round(rawProt);
              if (prot === sp.endProtrusion) return sp;
              nextSP = { ...sp, endProtrusion: prot };
            }
          } else if (h.role === 'mid-point') {
            const existing = sp.midPoints[h.midIndex];
            if (existing && existing.x === snapped.x && existing.y === snapped.y) return sp;
            const nextMids = sp.midPoints.map((m, idx) =>
              idx === h.midIndex ? snapped : m
            );
            nextSP = { ...sp, midPoints: nextMids };
          }

          const resolved = resolveSecretPassagePolyline(nextSP, doc.rooms);
          return {
            ...nextSP,
            startAnchor: resolved.startAnchor,
            endAnchor: resolved.endAnchor,
            points: resolved.points,
          };
        });
        latestLivePassagesRef.current = nextPassages;
        onSecretPassagesLivePreview(nextPassages);
        return;
      }

      if (d.kind === 'move-room') {
        const rawDx = worldPt.x - d.startWorld.x;
        const rawDy = worldPt.y - d.startWorld.y;
        const step = doc.grid.snapToGrid ? doc.grid.cellSize / 2 : 1;
        const dx = Math.round(rawDx / step) * step;
        const dy = Math.round(rawDy / step) * step;
        if (!d.moved && Math.hypot(rawDx, rawDy) < 4) return;
        const key = `${dx},${dy}`;
        if (d.moved && key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        dragRef.current = { ...d, moved: true };

        const nextRooms = doc.rooms.map((r) =>
          r.id === d.roomId
            ? {
                ...r,
                points: d.origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })),
              }
            : r
        );
        latestLiveRoomsRef.current = nextRooms;
        onRoomsLivePreview(nextRooms);
        return;
      }

      if (d.kind === 'move-vertex') {
        const snapped = snapPoint(worldPt, doc.grid.cellSize, doc.grid.snapToGrid);
        const key = `${snapped.x},${snapped.y}`;
        if (d.moved && key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        dragRef.current = { ...d, moved: true };
        const nextRooms = applyLinkedVertexMove(doc.rooms, d.linkedVertices, snapped);
        latestLiveRoomsRef.current = nextRooms;
        onRoomsLivePreview(nextRooms);
        return;
      }

      if (d.kind === 'bend-edge') {
        const targetRoom = doc.rooms.find((r) => r.id === d.roomId);
        if (!targetRoom) return;
        const a = targetRoom.points[d.edgeIndex];
        const b = targetRoom.points[(d.edgeIndex + 1) % targetRoom.points.length];
        const roundedBend = Math.round(computeBendFromHandle(a, b, worldPt));
        const key = `${roundedBend}`;
        if (key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        if (!d.moved && roundedBend === (d.origCurves[d.edgeIndex] ?? 0)) return;
        dragRef.current = { ...d, moved: true };

        const { rooms: nextRooms } = applyLinkedCurveBend(
          doc.rooms,
          d.roomId,
          d.edgeIndex,
          d.linkedEdges,
          worldPt
        );
        latestLiveRoomsRef.current = nextRooms;
        onRoomsLivePreview(nextRooms);
        return;
      }

      if (d.kind === 'move-edge') {
        const rawDx = worldPt.x - d.startWorld.x;
        const rawDy = worldPt.y - d.startWorld.y;
        const step = doc.grid.snapToGrid ? doc.grid.cellSize / 2 : 1;
        const dx = Math.round(rawDx / step) * step;
        const dy = Math.round(rawDy / step) * step;
        if (!d.moved && Math.hypot(rawDx, rawDy) < 4) return;
        const key = `${dx},${dy}`;
        if (d.moved && key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        dragRef.current = { ...d, moved: true };

        const nextRooms = applyLinkedEdgeMove(
          doc.rooms,
          d.roomId,
          d.edgeIndex,
          d.origPoints,
          d.linkedVertices,
          dx,
          dy
        );
        latestLiveRoomsRef.current = nextRooms;
        onRoomsLivePreview(nextRooms);
        return;
      }

      if (d.kind === 'rotate-room') {
        const currAngle = Math.atan2(worldPt.y - d.center.y, worldPt.x - d.center.x);
        let rawDeg = ((currAngle - d.startAngle) * 180) / Math.PI;
        while (rawDeg > 180) rawDeg -= 360;
        while (rawDeg <= -180) rawDeg += 360;
        const step = rotationSnap ? 15 : 1;
        const snappedDeg = Math.round(rawDeg / step) * step;
        if (!d.moved && Math.abs(rawDeg) < 2) return;
        const key = `${snappedDeg}`;
        if (d.moved && key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        const nextState: DragState = { ...d, currentDeg: snappedDeg, moved: true };
        dragRef.current = nextState;
        setDragPreview(nextState);
        const nextRooms = doc.rooms.map((r) =>
          r.id === d.roomId
            ? rotateRoomGeometry(
                { ...r, points: d.origPoints, rotationDeg: d.origRotationDeg },
                snappedDeg,
                d.center
              )
            : r
        );
        latestLiveRoomsRef.current = nextRooms;
        onRoomsLivePreview(nextRooms);
        return;
      }

      if (d.kind === 'move-slice') {
        const rawDx = worldPt.x - d.startWorld.x;
        const rawDy = worldPt.y - d.startWorld.y;
        const step = doc.grid.snapToGrid ? doc.grid.cellSize / 2 : 1;
        const dx = Math.round(rawDx / step) * step;
        const dy = Math.round(rawDy / step) * step;
        if (!d.moved && Math.hypot(rawDx, rawDy) < 4) return;
        const key = `${dx},${dy}`;
        if (d.moved && key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        dragRef.current = { ...d, moved: true };
        const nextSlices = activeSlices.map((s) =>
          s.id === d.sliceId
            ? { ...s, points: d.origPoints.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : s
        );
        latestLiveSlicesRef.current = nextSlices;
        onSlicesLivePreview(nextSlices);
        return;
      }

      if (d.kind === 'move-slice-vertex') {
        const snapped = snapPoint(worldPt, doc.grid.cellSize, doc.grid.snapToGrid);
        const key = `${snapped.x},${snapped.y}`;
        if (d.moved && key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        dragRef.current = { ...d, moved: true };
        const nextSlices = activeSlices.map((s) =>
          s.id === d.sliceId
            ? { ...s, points: s.points.map((p, idx) => (idx === d.vertexIndex ? snapped : p)) }
            : s
        );
        latestLiveSlicesRef.current = nextSlices;
        onSlicesLivePreview(nextSlices);
        return;
      }

      if (d.kind === 'bend-slice-edge') {
        const targetSlice = activeSlices.find((s) => s.id === d.sliceId);
        if (!targetSlice) return;
        const a = targetSlice.points[d.edgeIndex];
        const b = targetSlice.points[(d.edgeIndex + 1) % targetSlice.points.length];
        const roundedBend = Math.round(computeBendFromHandle(a, b, worldPt));
        const key = `${roundedBend}`;
        if (key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        if (!d.moved && roundedBend === (d.origCurves[d.edgeIndex] ?? 0)) return;
        dragRef.current = { ...d, moved: true };
        const nextSlices = activeSlices.map((s) => {
          if (s.id !== d.sliceId) return s;
          const curves = [...s.edgeCurves];
          curves[d.edgeIndex] = roundedBend;
          return { ...s, edgeCurves: curves };
        });
        latestLiveSlicesRef.current = nextSlices;
        onSlicesLivePreview(nextSlices);
        return;
      }

      if (d.kind === 'move-slice-edge') {
        const rawDx = worldPt.x - d.startWorld.x;
        const rawDy = worldPt.y - d.startWorld.y;
        const step = doc.grid.snapToGrid ? doc.grid.cellSize / 2 : 1;
        const dx = Math.round(rawDx / step) * step;
        const dy = Math.round(rawDy / step) * step;
        if (!d.moved && Math.hypot(rawDx, rawDy) < 4) return;
        const key = `${dx},${dy}`;
        if (d.moved && key === lastDragKeyRef.current) return;
        lastDragKeyRef.current = key;
        dragRef.current = { ...d, moved: true };
        const n = d.origPoints.length;
        const i1 = d.edgeIndex;
        const i2 = (d.edgeIndex + 1) % n;
        const nextSlices = activeSlices.map((s) =>
          s.id === d.sliceId
            ? {
                ...s,
                points: d.origPoints.map((p, idx) =>
                  idx === i1 || idx === i2 ? { x: p.x + dx, y: p.y + dy } : p
                ),
              }
            : s
        );
        latestLiveSlicesRef.current = nextSlices;
        onSlicesLivePreview(nextSlices);
      }
    },
    [
      activeSlices,
      activeTool,
      clientToWorld,
      doc.autoConnectTolerance,
      doc.doorways,
      doc.grid.cellSize,
      doc.grid.snapToGrid,
      doc.rooms,
      doc.secretPassages,
      findRoomAtPoint,
      findSliceHitAtPoint,
      hoveredSliceId,
      onDoorwaysLivePreview,
      onRoomsLivePreview,
      onSecretPassagesLivePreview,
      onSlicesLivePreview,
      onViewportChange,
      rotationSnap,
      secretDraft,
      sliceShapeMode,
      viewport.zoom,
    ]
  );

  const handlePointerEnd = useCallback(() => {
    const d = dragRef.current;
    const latestRooms = latestLiveRoomsRef.current;
    const latestDoorways = latestLiveDoorwaysRef.current;
    const latestPassages = latestLivePassagesRef.current;
    const latestSlices = latestLiveSlicesRef.current;
    dragRef.current = null;
    lastDragKeyRef.current = '';
    latestLiveRoomsRef.current = null;
    latestLiveDoorwaysRef.current = null;
    latestLivePassagesRef.current = null;
    latestLiveSlicesRef.current = null;
    setDragPreview(null);
    if (!d) return;

    if (d.kind === 'pan' && !d.moved && activeTool === 'select') {
      onSelectRoom(null);
      onSelectDoor(null);
      onSelectSecretPassage(null);
      onSelectSlice(null);
      setSelectedVertexIndex(null);
      setSelectedSliceVertexIndex(null);
      setSelectedSecretMidIndex(null);
      return;
    }

    if (d.kind === 'slide-doorway') {
      if (d.moved) {
        onDoorwaysCommit(latestDoorways ?? doc.doorways);
      }
      return;
    }

    if (d.kind === 'drag-secret-handle') {
      if (d.moved) {
        onSecretPassagesCommit(latestPassages ?? doc.secretPassages);
      }
      return;
    }

    if (
      (d.kind === 'move-slice' ||
        d.kind === 'move-slice-vertex' ||
        d.kind === 'move-slice-edge') &&
      d.moved
    ) {
      onSlicesCommit(latestSlices ?? activeSlices);
      return;
    }

    if (d.kind === 'bend-slice-edge') {
      if (d.moved) {
        onSlicesCommit(latestSlices ?? activeSlices);
      }
      return;
    }

    if (d.kind === 'move-room' && d.moved) {
      onRoomsCommit(latestRooms ?? doc.rooms, 'Move room');
      return;
    }

    if (d.kind === 'move-vertex' && d.moved) {
      onRoomsCommit(latestRooms ?? doc.rooms, 'Reshape vertex');
      return;
    }

    if (d.kind === 'bend-edge') {
      if (d.moved) {
        onRoomsCommit(latestRooms ?? doc.rooms, 'Curve wall');
      }
      return;
    }

    if (d.kind === 'move-edge' && d.moved) {
      onRoomsCommit(latestRooms ?? doc.rooms, 'Push wall');
      return;
    }

    if (d.kind === 'rotate-room' && d.moved) {
      onRoomsCommit(latestRooms ?? doc.rooms, 'Rotate room');
      return;
    }

    if (d.kind === 'draw-rect') {
      let x1 = Math.min(d.startWorld.x, d.currWorld.x);
      let y1 = Math.min(d.startWorld.y, d.currWorld.y);
      let x2 = Math.max(d.startWorld.x, d.currWorld.x);
      let y2 = Math.max(d.startWorld.y, d.currWorld.y);

      const cs = doc.grid.cellSize;
      if (d.mode === 'slice') {
        if (x2 - x1 < 16 && y2 - y1 < 16) {
          x1 = d.startWorld.x - cs * 0.75;
          x2 = d.startWorld.x + cs * 0.75;
          y1 = d.startWorld.y - cs * 0.5;
          y2 = d.startWorld.y + cs * 0.5;
        }
        if (x2 - x1 >= 12 && y2 - y1 >= 12) {
          onAddSlice({
            id: `slice-${Date.now()}`,
            mode: activeSliceMode,
            points: [
              { x: x1, y: y1 },
              { x: x2, y: y1 },
              { x: x2, y: y2 },
              { x: x1, y: y2 },
            ],
            edgeCurves: [0, 0, 0, 0],
          });
        }
        return;
      }

      if (x2 - x1 < cs * 0.6 && y2 - y1 < cs * 0.6) {
        if (d.mode === 'hallway') {
          x1 = d.startWorld.x - cs * 2;
          x2 = d.startWorld.x + cs * 2;
          y1 = d.startWorld.y - cs * 0.5;
          y2 = d.startWorld.y + cs * 0.5;
        } else {
          x1 = d.startWorld.x - cs * 2;
          x2 = d.startWorld.x + cs * 2;
          y1 = d.startWorld.y - cs * 1.5;
          y2 = d.startWorld.y + cs * 1.5;
        }
      }

      if (x2 - x1 >= cs * 0.5 && y2 - y1 >= cs * 0.5) {
        const isHall = d.mode === 'hallway';
        const newRoom: Room = {
          id: `room-${Date.now()}`,
          name: isHall
            ? `Corridor ${doc.rooms.filter((r) => r.type === 'hallway').length + 1}`
            : `Chamber ${doc.rooms.filter((r) => r.type !== 'hallway').length + 1}`,
          type: isHall ? 'hallway' : 'room',
          points: [
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 },
          ],
          edgeCurves: [0, 0, 0, 0],
          floorMaterial: isHall ? 'stone' : 'wood',
          lighting: isHall ? 'dim' : 'bright',
          elevationFt: 0,
          notes: '',
          showLabel: true,
        };
        onAddRoom(newRoom);
      }
    }
  }, [
    activeSliceMode,
    activeSlices,
    activeTool,
    doc.doorways,
    doc.grid.cellSize,
    doc.rooms,
    doc.secretPassages,
    onAddRoom,
    onAddSlice,
    onDoorwaysCommit,
    onRoomsCommit,
    onSecretPassagesCommit,
    onSelectDoor,
    onSelectRoom,
    onSelectSecretPassage,
    onSelectSlice,
    onSlicesCommit,
  ]);

  // Keep latest pointer handlers in a ref so touch listeners mount ONCE and never detach mid-pinch
  const handlersRef = useRef({
    start: handlePointerStart,
    move: handlePointerMove,
    end: handlePointerEnd,
  });
  handlersRef.current = {
    start: handlePointerStart,
    move: handlePointerMove,
    end: handlePointerEnd,
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const getTouchMetrics = (touches: TouchList) => {
      const t0 = touches[0];
      const t1 = touches[1];
      const dx = t1.clientX - t0.clientX;
      const dy = t1.clientY - t0.clientY;
      return {
        dist: Math.hypot(dx, dy),
        mid: {
          x: (t0.clientX + t1.clientX) / 2,
          y: (t0.clientY + t1.clientY) / 2,
        },
      };
    };

    const isCanvasUiTarget = (target: EventTarget | null) =>
      target instanceof Element && Boolean(target.closest('[data-canvas-ui]'));

    const onTouchStart = (e: TouchEvent) => {
      if (isCanvasUiTarget(e.target)) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        if (dragRef.current) {
          dragRef.current = null;
          setDragPreview(null);
          latestLiveRoomsRef.current = null;
          latestLiveDoorwaysRef.current = null;
          latestLivePassagesRef.current = null;
          latestLiveSlicesRef.current = null;
          onCancelLivePreview?.();
        }
        const { dist, mid } = getTouchMetrics(e.touches);
        pinchRef.current = { active: true, prevDist: dist, prevMid: mid };
      } else if (e.touches.length === 1 && !pinchRef.current.active) {
        e.preventDefault();
        const t = e.touches[0];
        handlersRef.current.start(t.clientX, t.clientY, 0, false);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isCanvasUiTarget(e.target) && !dragRef.current && !pinchRef.current.active) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const { dist, mid } = getTouchMetrics(e.touches);
        const prev = pinchRef.current;
        if (!prev.active) {
          pinchRef.current = { active: true, prevDist: dist, prevMid: mid };
          return;
        }
        const rect = el.getBoundingClientRect();
        const localMidX = mid.x - rect.left;
        const localMidY = mid.y - rect.top;
        const panDx = mid.x - prev.prevMid.x;
        const panDy = mid.y - prev.prevMid.y;
        const scaleRatio = prev.prevDist > 5 ? dist / prev.prevDist : 1;

        onViewportChange((vp) => {
          const nextZoom = Math.min(4, Math.max(0.2, vp.zoom * scaleRatio));
          const actualRatio = nextZoom / vp.zoom;
          return {
            zoom: nextZoom,
            x: localMidX - (localMidX - (vp.x + panDx)) * actualRatio,
            y: localMidY - (localMidY - (vp.y + panDy)) * actualRatio,
          };
        });

        pinchRef.current = { active: true, prevDist: dist, prevMid: mid };
      } else if (e.touches.length === 1 && !pinchRef.current.active) {
        e.preventDefault();
        const t = e.touches[0];
        handlersRef.current.move(t.clientX, t.clientY);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (isCanvasUiTarget(e.target) && !dragRef.current && !pinchRef.current.active) return;
      if (e.touches.length < 2 && pinchRef.current.active) {
        pinchRef.current.active = false;
      }
      if (e.touches.length === 0) {
        handlersRef.current.end();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('touchcancel', onTouchEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onCancelLivePreview, onViewportChange]);

  const bgColor = darkTheme ? '#22242A' : '#F4F1EA';
  const inkColor = darkTheme ? '#F1F5F9' : '#1C1917';
  const mutedInk = darkTheme ? '#9CA3AF' : '#57534E';
  const secretColor = darkTheme ? '#FBBF24' : '#B45309';
  const selectedRoom = doc.rooms.find((r) => r.id === selectedRoomId) ?? null;
  const selectedDoor = doc.doorways.find((d) => d.id === selectedDoorId) ?? null;
  const selectedSecretPassage =
    doc.secretPassages.find((sp) => sp.id === selectedSecretPassageId) ?? null;
  const selectedSlice = activeSlices.find((sl) => sl.id === selectedSliceId) ?? null;

  const visibleDoorways = useMemo(
    () => doc.doorways.filter((d) => !isDoorwaySliced(d, activeSlices)),
    [activeSlices, doc.doorways]
  );

  const overlapWarning = useMemo(
    () => detectDoorPassageOverlaps(visibleDoorways, doc.secretPassages),
    [doc.secretPassages, visibleDoorways]
  );

  useEffect(() => {
    setLinkTargetVal('');
  }, [selectedRoomId, doc.activeFloorId]);

  const cs = doc.grid.cellSize;
  const majorCs = cs * 5;

  const cursorClass =
    spacePressed || activeTool === 'pan'
      ? 'cursor-grab active:cursor-grabbing'
      : activeTool === 'select'
        ? 'cursor-default'
        : 'cursor-crosshair';

  // Memoize realistic SVG floor pattern defs (only recomputes on theme toggle)
  const floorPatternDefs = useMemo(() => {
    const materials = Object.keys(MATERIAL_PALETTE) as FloorMaterial[];
    const hiLite = darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)';
    const shdw = darkTheme ? 'rgba(0,0,0,0.48)' : 'rgba(28,25,23,0.18)';
    const deepShdw = darkTheme ? 'rgba(0,0,0,0.65)' : 'rgba(28,25,23,0.28)';

    return materials.map((matKey) => {
      const mat = MATERIAL_PALETTE[matKey];
      const base = darkTheme ? mat.darkFill : mat.lightFill;
      const alt = darkTheme ? mat.secondaryDark : mat.secondaryLight;
      const line = darkTheme ? mat.patternDark : mat.patternLight;
      const pid = `floor-tex-${matKey}`;

      if (matKey === 'stone') {
        return (
          <pattern key={pid} id={pid} width={64} height={64} patternUnits="userSpaceOnUse">
            <rect width={64} height={64} fill={base} />
            <rect x={1} y={1} width={30} height={20} fill={alt} fillOpacity={0.45} />
            <rect x={33} y={23} width={30} height={19} fill={alt} fillOpacity={0.38} />
            <rect x={16} y={44} width={28} height={19} fill={alt} fillOpacity={0.5} />
            {/* Chiseled bevel highlights */}
            <path
              d="M 1 20 V 1 H 31 M 33 20 V 1 H 63 M 1 42 V 23 H 15 M 17 42 V 23 H 47 M 49 42 V 23 H 63 M 1 62 V 44 H 39 M 41 62 V 44 H 63"
              stroke={hiLite}
              strokeWidth={1.1}
              fill="none"
            />
            {/* Deep ashlar mortar grooves */}
            <path
              d="M 0 21.5 H 64 M 0 43 H 64 M 0 63.5 H 64 M 32 0 V 21.5 M 16 21.5 V 43 M 48 21.5 V 43 M 40 43 V 64"
              stroke={shdw}
              strokeWidth={1.4}
              fill="none"
            />
            {/* Weathering cracks & mineral pits */}
            <path
              d="M 8 8 L 14 12 L 17 10 M 44 28 L 51 33 L 55 31 M 22 50 L 27 56"
              stroke={line}
              strokeWidth={0.75}
              strokeOpacity={0.6}
              fill="none"
            />
            <circle cx={24} cy={14} r={0.9} fill={line} />
            <circle cx={56} cy={11} r={0.8} fill={line} />
            <circle cx={10} cy={34} r={1.1} fill={line} />
            <circle cx={53} cy={53} r={0.9} fill={line} />
          </pattern>
        );
      }
      if (matKey === 'wood') {
        return (
          <pattern key={pid} id={pid} width={80} height={40} patternUnits="userSpaceOnUse">
            <rect width={80} height={40} fill={base} />
            <rect x={0} y={0} width={80} height={10} fill={alt} fillOpacity={0.42} />
            <rect x={0} y={20} width={80} height={10} fill={alt} fillOpacity={0.28} />
            {/* Plank top bevel highlights */}
            <path
              d="M 0 1 H 80 M 0 11 H 80 M 0 21 H 80 M 0 31 H 80"
              stroke={hiLite}
              strokeWidth={0.85}
              fill="none"
            />
            {/* Plank seams & staggered butt joints */}
            <path
              d="M 0 10 H 80 M 0 20 H 80 M 0 30 H 80 M 0 39.5 H 80 M 22 0 V 10 M 58 10 V 20 M 14 20 V 30 M 46 30 V 40"
              stroke={shdw}
              strokeWidth={1.15}
              fill="none"
            />
            {/* Organic timber grain & knots */}
            <path
              d="M 3 4 Q 12 6 19 4 M 26 5 Q 48 2 76 6 M 4 15 Q 24 13 54 16 M 62 14 Q 72 16 78 14 M 18 25 Q 38 28 74 24 M 6 35 Q 24 33 42 36 M 50 35 Q 64 37 78 34"
              stroke={line}
              strokeWidth={0.65}
              strokeOpacity={0.65}
              fill="none"
            />
            <ellipse cx={42} cy={5} rx={3.5} ry={1.6} fill="none" stroke={line} strokeWidth={0.65} strokeOpacity={0.7} />
            <ellipse cx={30} cy={25} rx={2.8} ry={1.4} fill="none" stroke={line} strokeWidth={0.65} strokeOpacity={0.65} />
            {/* Iron peg nails at butt joints */}
            <circle cx={20} cy={3} r={0.8} fill={deepShdw} />
            <circle cx={20} cy={7} r={0.8} fill={deepShdw} />
            <circle cx={56} cy={13} r={0.8} fill={deepShdw} />
            <circle cx={56} cy={17} r={0.8} fill={deepShdw} />
            <circle cx={12} cy={23} r={0.8} fill={deepShdw} />
            <circle cx={44} cy={33} r={0.8} fill={deepShdw} />
          </pattern>
        );
      }
      if (matKey === 'marble') {
        return (
          <pattern key={pid} id={pid} width={72} height={72} patternUnits="userSpaceOnUse">
            <rect width={72} height={72} fill={base} />
            <rect x={0} y={0} width={36} height={36} fill={alt} fillOpacity={0.32} />
            <rect x={36} y={36} width={36} height={36} fill={alt} fillOpacity={0.32} />
            {/* Polished sheen diagonal highlights */}
            <path d="M 4 32 L 32 4 M 40 68 L 68 40" stroke={hiLite} strokeWidth={3} strokeOpacity={0.45} />
            {/* Mineral veins */}
            <path
              d="M 2 14 Q 14 10 22 20 T 34 32 M 38 6 Q 48 16 58 14 T 70 28 M 6 48 Q 18 44 26 56 T 34 68 M 40 46 Q 52 54 66 44"
              stroke={line}
              strokeWidth={1.1}
              strokeOpacity={0.65}
              fill="none"
            />
            <path
              d="M 10 2 Q 16 14 12 28 M 50 38 Q 56 50 48 66"
              stroke={line}
              strokeWidth={0.55}
              strokeOpacity={0.45}
              fill="none"
            />
            {/* Slab bevel & grout */}
            <path d="M 36 0 V 72 M 0 36 H 72 M 72 0 V 72 M 0 72 H 72" stroke={shdw} strokeWidth={0.95} fill="none" />
          </pattern>
        );
      }
      if (matKey === 'checkered') {
        return (
          <pattern key={pid} id={pid} width={40} height={40} patternUnits="userSpaceOnUse">
            <rect width={40} height={40} fill={base} />
            <rect x={0} y={0} width={20} height={20} fill={alt} />
            <rect x={20} y={20} width={20} height={20} fill={alt} />
            {/* Tile inner chamfer highlights */}
            <rect x={2} y={2} width={16} height={16} fill="none" stroke={hiLite} strokeWidth={0.75} strokeOpacity={0.5} />
            <rect x={22} y={2} width={16} height={16} fill="none" stroke={hiLite} strokeWidth={0.75} strokeOpacity={0.65} />
            <rect x={2} y={22} width={16} height={16} fill="none" stroke={hiLite} strokeWidth={0.75} strokeOpacity={0.65} />
            <rect x={22} y={22} width={16} height={16} fill="none" stroke={hiLite} strokeWidth={0.75} strokeOpacity={0.5} />
            <path d="M 20 0 V 40 M 0 20 H 40 M 40 0 V 40 M 0 40 H 40" stroke={shdw} strokeWidth={1.1} fill="none" />
          </pattern>
        );
      }
      if (matKey === 'cobble') {
        return (
          <pattern key={pid} id={pid} width={44} height={44} patternUnits="userSpaceOnUse">
            <rect width={44} height={44} fill={deepShdw} />
            <rect width={44} height={44} fill={alt} fillOpacity={0.65} />
            <rect x={2} y={2} width={17} height={15} rx={6} fill={base} stroke={shdw} strokeWidth={1.3} />
            <path d="M 5 5 Q 10 3 16 5" stroke={hiLite} strokeWidth={1.1} fill="none" strokeLinecap="round" />
            <rect x={22} y={3} width={19} height={13} rx={6} fill={base} stroke={shdw} strokeWidth={1.3} />
            <path d="M 25 6 Q 31 4 37 6" stroke={hiLite} strokeWidth={1.1} fill="none" strokeLinecap="round" />
            <rect x={3} y={20} width={14} height={18} rx={5.5} fill={base} stroke={shdw} strokeWidth={1.3} />
            <path d="M 6 23 Q 10 21 14 23" stroke={hiLite} strokeWidth={1.1} fill="none" strokeLinecap="round" />
            <rect x={20} y={19} width={21} height={14} rx={6} fill={base} stroke={shdw} strokeWidth={1.3} />
            <path d="M 24 22 Q 31 20 37 22" stroke={hiLite} strokeWidth={1.1} fill="none" strokeLinecap="round" />
            <rect x={19} y={35} width={13} height={7} rx={3.5} fill={base} stroke={shdw} strokeWidth={1.1} />
            <rect x={34} y={35} width={8} height={7} rx={3} fill={base} stroke={shdw} strokeWidth={1.1} />
          </pattern>
        );
      }
      if (matKey === 'carpet') {
        return (
          <pattern key={pid} id={pid} width={36} height={36} patternUnits="userSpaceOnUse">
            <rect width={36} height={36} fill={base} />
            {/* Fine woven textile crosshatch */}
            <path
              d="M 0 6 H 36 M 0 18 H 36 M 0 30 H 36 M 6 0 V 36 M 18 0 V 36 M 30 0 V 36"
              stroke={alt}
              strokeWidth={0.75}
              strokeOpacity={0.55}
            />
            <path d="M 0 0 L 36 36 M 36 0 L 0 36" stroke={alt} strokeWidth={1} strokeOpacity={0.45} />
            {/* Gold-embroidered damask medallion */}
            <path d="M 18 4 L 32 18 L 18 32 L 4 18 Z" stroke={line} strokeWidth={1.2} fill="none" />
            <path d="M 18 9 L 27 18 L 18 27 L 9 18 Z" stroke={line} strokeWidth={0.75} strokeOpacity={0.75} fill="none" />
            <circle cx={18} cy={18} r={2.5} fill={line} />
          </pattern>
        );
      }
      if (matKey === 'staircase') {
        const runnerFill = darkTheme ? '#6F1D24' : '#8B262D';
        const runnerEdge = darkTheme ? '#D97706' : '#EAB308';
        return (
          <pattern key={pid} id={pid} width={64} height={48} patternUnits="userSpaceOnUse">
            <rect width={64} height={48} fill={base} />
            {/* Side wooden balustrade curbs */}
            <rect x={0} y={0} width={5} height={48} fill={alt} />
            <rect x={59} y={0} width={5} height={48} fill={alt} />
            {/* 4 distinct step treads (each 12px high) with riser shadows & nosing highlights */}
            {[0, 12, 24, 36].map((y) => (
              <g key={y}>
                <rect x={5} y={y} width={54} height={3.5} fill={deepShdw} />
                <line x1={5} y1={y + 4} x2={59} y2={y + 4} stroke={hiLite} strokeWidth={1} />
                <line x1={5} y1={y + 11.5} x2={59} y2={y + 11.5} stroke={shdw} strokeWidth={0.8} />
              </g>
            ))}
            {/* Central plush crimson stair runner + gold borders + brass rods */}
            <rect x={16} y={0} width={32} height={48} fill={runnerFill} fillOpacity={0.92} />
            <line x1={17.5} y1={0} x2={17.5} y2={48} stroke={runnerEdge} strokeWidth={1.2} strokeOpacity={0.8} />
            <line x1={46.5} y1={0} x2={46.5} y2={48} stroke={runnerEdge} strokeWidth={1.2} strokeOpacity={0.8} />
            {[0, 12, 24, 36].map((y) => (
              <g key={`rod-${y}`}>
                <rect x={16} y={y} width={32} height={3.2} fill="rgba(0,0,0,0.34)" />
                <line x1={15} y1={y + 3.2} x2={49} y2={y + 3.2} stroke={runnerEdge} strokeWidth={1.1} strokeOpacity={0.85} />
              </g>
            ))}
            {/* Carved balustrade rail lines */}
            <line x1={5} y1={0} x2={5} y2={48} stroke={shdw} strokeWidth={1.4} />
            <line x1={59} y1={0} x2={59} y2={48} stroke={shdw} strokeWidth={1.4} />
          </pattern>
        );
      }
      if (matKey === 'stairway') {
        return (
          <pattern key={pid} id={pid} width={56} height={48} patternUnits="userSpaceOnUse">
            <rect width={56} height={48} fill={base} />
            {[0, 12, 24, 36].map((y, idx) => (
              <g key={y}>
                <rect x={0} y={y} width={56} height={12} fill={idx % 2 === 0 ? base : alt} fillOpacity={idx % 2 === 0 ? 1 : 0.48} />
                {/* Deep riser step shadow */}
                <rect x={0} y={y} width={56} height={3.2} fill={deepShdw} />
                {/* Chiseled nosing highlight */}
                <line x1={0} y1={y + 3.6} x2={56} y2={y + 3.6} stroke={hiLite} strokeWidth={1} />
                {/* Staggered stone step joints */}
                <line
                  x1={idx % 2 === 0 ? 22 : 36}
                  y1={y}
                  x2={idx % 2 === 0 ? 22 : 36}
                  y2={y + 12}
                  stroke={shdw}
                  strokeWidth={1.1}
                />
                <path
                  d={`M ${idx % 2 === 0 ? 8 : 14} ${y + 7} L ${idx % 2 === 0 ? 14 : 20} ${y + 9}`}
                  stroke={line}
                  strokeWidth={0.65}
                  strokeOpacity={0.55}
                  fill="none"
                />
              </g>
            ))}
            {/* Subtle side stone stringer curbs */}
            <rect x={0} y={0} width={3} height={48} fill={shdw} fillOpacity={0.35} />
            <rect x={53} y={0} width={3} height={48} fill={shdw} fillOpacity={0.35} />
          </pattern>
        );
      }
      if (matKey === 'arcane') {
        return (
          <pattern key={pid} id={pid} width={48} height={48} patternUnits="userSpaceOnUse">
            <rect width={48} height={48} fill={base} />
            <rect x={1} y={1} width={46} height={46} fill="none" stroke={shdw} strokeWidth={1} />
            <circle cx={24} cy={24} r={17} stroke={line} strokeWidth={1} fill="none" />
            <circle cx={24} cy={24} r={12} stroke={line} strokeWidth={0.6} strokeDasharray="3 3" fill="none" />
            <circle cx={24} cy={24} r={6} fill={alt} stroke={line} strokeWidth={0.9} />
            <path d="M 24 3 V 45 M 3 24 H 45 M 10 10 L 38 38 M 38 10 L 10 38" stroke={line} strokeWidth={0.6} strokeOpacity={0.65} fill="none" />
            <circle cx={24} cy={24} r={1.8} fill={line} />
          </pattern>
        );
      }
      if (matKey === 'water') {
        return (
          <pattern key={pid} id={pid} width={48} height={26} patternUnits="userSpaceOnUse">
            <rect width={48} height={26} fill={base} />
            <rect x={0} y={12} width={48} height={14} fill={alt} fillOpacity={0.45} />
            <path
              d="M 0 7 Q 12 2 24 7 T 48 7 M 0 19 Q 12 14 24 19 T 48 19"
              stroke={line}
              strokeWidth={1.3}
              fill="none"
            />
            <path
              d="M 6 5 Q 12 3 18 5 M 28 17 Q 34 15 40 17"
              stroke={hiLite}
              strokeWidth={0.9}
              fill="none"
              strokeLinecap="round"
            />
          </pattern>
        );
      }
      // earth
      return (
        <pattern key={pid} id={pid} width={44} height={44} patternUnits="userSpaceOnUse">
          <rect width={44} height={44} fill={base} />
          <ellipse cx={12} cy={14} rx={8} ry={6} fill={alt} fillOpacity={0.55} />
          <ellipse cx={33} cy={31} rx={9} ry={7} fill={alt} fillOpacity={0.48} />
          <path
            d="M 8 13 L 6 8 M 10 13 L 10 7 M 12 13 L 14 8 M 30 28 L 28 23 M 32 28 L 33 22 M 34 28 L 37 24"
            stroke={line}
            strokeWidth={1.05}
            strokeLinecap="round"
          />
          <circle cx={26} cy={9} r={1.3} fill={shdw} />
          <circle cx={15} cy={34} r={1.5} fill={alt} stroke={shdw} strokeWidth={0.5} />
          <circle cx={38} cy={12} r={1} fill={line} />
        </pattern>
      );
    });
  }, [darkTheme]);

  const stepNumbersByRoom = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!pathResult?.reachable) return map;
    pathResult.steps.forEach((step, idx) => {
      if (step.floorId !== doc.activeFloorId) return;
      const list = map.get(step.roomId) ?? [];
      list.push(idx + 1);
      map.set(step.roomId, list);
    });
    return map;
  }, [doc.activeFloorId, pathResult]);

  // Memoized Rooms Layer (unaffected by pan/zoom/hover/draw-rect)
  const roomsLayer = useMemo(
    () =>
      doc.rooms.map((room) => {
        const mat = MATERIAL_PALETTE[room.floorMaterial] ?? MATERIAL_PALETTE.stone;
        const isStairTex =
          room.floorMaterial === 'staircase' || room.floorMaterial === 'stairway';
        const baseFillColor = darkTheme ? mat.darkFill : mat.lightFill;
        const altFillColor = darkTheme ? mat.secondaryDark : mat.secondaryLight;
        const customTex = room.customTextureId
          ? (doc.customTextures ?? []).find((t) => t.id === room.customTextureId)
          : undefined;
        const fill = customTex
          ? `url(#floor-custom-${customTex.id})`
          : room.customColor ||
            (isStairTex ? baseFillColor : `url(#floor-tex-${room.floorMaterial})`);
        const stroke = darkTheme ? mat.strokeDark : mat.strokeLight;
        const d = buildRoomSvgPath(room);
        const wallD = buildRoomWallPath(room);
        const hiddenWallD = buildRoomHiddenWallPath(room);
        const isSelected = room.id === selectedRoomId;
        const isInaccessible = accessibility.inaccessibleRoomIds.has(room.id);
        const stepNums = stepNumbersByRoom.get(room.id);
        const anchor = room.showLabel || (stepNums && stepNums.length > 0)
          ? getEffectiveRoomLabelAnchor(room, activeSlices)
          : null;

        const clipId = `room-clip-${room.id}`;
        const stairOriented =
          !customTex && !room.customColor && (isStairTex || room.type === 'stairs')
            ? getOrientedStairBox(room)
            : null;
        const stairBox = stairOriented?.box ?? null;
        const stairTransform =
          stairOriented && stairOriented.rotationDeg !== 0
            ? `rotate(${stairOriented.rotationDeg} ${stairOriented.center.x} ${stairOriented.center.y})`
            : undefined;

        return (
          <g key={room.id}>
            <clipPath id={clipId}>
              <path d={d} />
            </clipPath>

            {/* Floor Fill, Stair Treads, Wall Shadows & Inaccessible Tint (masked cleanly by Floor Slices) */}
            <g mask="url(#floor-slice-cutout-mask)">
              <path d={d} fill={fill} stroke="none" />

            {/* Room-Centered Staircase / Stairway Texture & Subtle Wall Drop Shadows */}
            <g clipPath={`url(#${clipId})`} className="pointer-events-none">
              {!customTex && !room.customColor && room.floorMaterial === 'staircase' && stairBox && (() => {
                const bx = stairBox.minX;
                const by = stairBox.minY;
                const bw = stairBox.width;
                const bh = stairBox.height;
                const cx = (stairBox.minX + stairBox.maxX) / 2;
                const curbW = Math.min(6, Math.max(3.5, bw * 0.06));
                const treadX = bx + curbW;
                const treadW = Math.max(0, bw - curbW * 2);
                const runnerW = Math.max(14, Math.min(48, bw * 0.52));
                const runnerX = cx - runnerW / 2;
                const runnerFill = darkTheme ? '#6F1D24' : '#8B262D';
                const runnerEdge = darkTheme ? '#D97706' : '#EAB308';
                const hiLite = darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)';
                const shdw = darkTheme ? 'rgba(0,0,0,0.48)' : 'rgba(28,25,23,0.18)';
                const deepShdw = darkTheme ? 'rgba(0,0,0,0.65)' : 'rgba(28,25,23,0.28)';
                const pitch = 12;
                const remY = bh % pitch;
                const startY = by + remY / 2 - (remY > 0 ? pitch : 0);
                const stepYs: number[] = [];
                for (let y = startY; y < stairBox.maxY; y += pitch) {
                  stepYs.push(y);
                }

                return (
                  <g transform={stairTransform}>
                    <rect x={bx} y={by} width={curbW} height={bh} fill={altFillColor} />
                    <rect
                      x={stairBox.maxX - curbW}
                      y={by}
                      width={curbW}
                      height={bh}
                      fill={altFillColor}
                    />
                    {stepYs.map((y, idx) => (
                      <g key={`sc-step-${idx}`}>
                        <rect x={treadX} y={y} width={treadW} height={3.5} fill={deepShdw} />
                        <line
                          x1={treadX}
                          y1={y + 4}
                          x2={stairBox.maxX - curbW}
                          y2={y + 4}
                          stroke={hiLite}
                          strokeWidth={1}
                        />
                        <line
                          x1={treadX}
                          y1={y + 11.5}
                          x2={stairBox.maxX - curbW}
                          y2={y + 11.5}
                          stroke={shdw}
                          strokeWidth={0.8}
                        />
                      </g>
                    ))}
                    <rect
                      x={runnerX}
                      y={by}
                      width={runnerW}
                      height={bh}
                      fill={runnerFill}
                      fillOpacity={0.92}
                    />
                    <line
                      x1={runnerX + 1.5}
                      y1={by}
                      x2={runnerX + 1.5}
                      y2={stairBox.maxY}
                      stroke={runnerEdge}
                      strokeWidth={1.2}
                      strokeOpacity={0.85}
                    />
                    <line
                      x1={runnerX + runnerW - 1.5}
                      y1={by}
                      x2={runnerX + runnerW - 1.5}
                      y2={stairBox.maxY}
                      stroke={runnerEdge}
                      strokeWidth={1.2}
                      strokeOpacity={0.85}
                    />
                    {stepYs.map((y, idx) => (
                      <g key={`sc-rod-${idx}`}>
                        <rect
                          x={runnerX}
                          y={y}
                          width={runnerW}
                          height={3.2}
                          fill="rgba(0,0,0,0.34)"
                        />
                        <line
                          x1={runnerX - 1}
                          y1={y + 3.2}
                          x2={runnerX + runnerW + 1}
                          y2={y + 3.2}
                          stroke={runnerEdge}
                          strokeWidth={1.1}
                          strokeOpacity={0.85}
                        />
                      </g>
                    ))}
                    <line x1={treadX} y1={by} x2={treadX} y2={stairBox.maxY} stroke={shdw} strokeWidth={1.4} />
                    <line
                      x1={stairBox.maxX - curbW}
                      y1={by}
                      x2={stairBox.maxX - curbW}
                      y2={stairBox.maxY}
                      stroke={shdw}
                      strokeWidth={1.4}
                    />
                  </g>
                );
              })()}

              {!customTex && !room.customColor && room.floorMaterial === 'stairway' && stairBox && (() => {
                const bx = stairBox.minX;
                const by = stairBox.minY;
                const bw = stairBox.width;
                const bh = stairBox.height;
                const cx = (stairBox.minX + stairBox.maxX) / 2;
                const lineCol = darkTheme ? mat.patternDark : mat.patternLight;
                const hiLite = darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)';
                const shdw = darkTheme ? 'rgba(0,0,0,0.48)' : 'rgba(28,25,23,0.18)';
                const deepShdw = darkTheme ? 'rgba(0,0,0,0.65)' : 'rgba(28,25,23,0.28)';
                const pitch = 12;
                const remY = bh % pitch;
                const startY = by + remY / 2 - (remY > 0 ? pitch : 0);
                const stepYs: number[] = [];
                for (let y = startY; y < stairBox.maxY; y += pitch) {
                  stepYs.push(y);
                }

                return (
                  <g transform={stairTransform}>
                    {stepYs.map((y, idx) => {
                      const jointOffset = bw * 0.16;
                      const jx = idx % 2 === 0 ? cx - jointOffset : cx + jointOffset;
                      return (
                        <g key={`sw-step-${idx}`}>
                          {idx % 2 === 1 && (
                            <rect
                              x={bx}
                              y={y}
                              width={bw}
                              height={pitch}
                              fill={altFillColor}
                              fillOpacity={0.48}
                            />
                          )}
                          <rect x={bx} y={y} width={bw} height={3.2} fill={deepShdw} />
                          <line
                            x1={bx}
                            y1={y + 3.6}
                            x2={stairBox.maxX}
                            y2={y + 3.6}
                            stroke={hiLite}
                            strokeWidth={1}
                          />
                          {bw >= 30 && (
                            <line
                              x1={jx}
                              y1={y}
                              x2={jx}
                              y2={y + pitch}
                              stroke={shdw}
                              strokeWidth={1.1}
                            />
                          )}
                          <path
                            d={`M ${cx - (idx % 2 === 0 ? 10 : -4)} ${y + 7} L ${cx - (idx % 2 === 0 ? 4 : -10)} ${y + 9}`}
                            stroke={lineCol}
                            strokeWidth={0.65}
                            strokeOpacity={0.55}
                            fill="none"
                          />
                        </g>
                      );
                    })}
                    <rect x={bx} y={by} width={3.5} height={bh} fill={shdw} fillOpacity={0.35} />
                    <rect
                      x={stairBox.maxX - 3.5}
                      y={by}
                      width={3.5}
                      height={bh}
                      fill={shdw}
                      fillOpacity={0.35}
                    />
                  </g>
                );
              })()}

              {wallD && (
                <>
                  <g transform="translate(2.5 3)">
                    <path
                      d={wallD}
                      fill="none"
                      stroke="#000000"
                      strokeOpacity={darkTheme ? 0.055 : 0.03}
                      strokeWidth={20}
                      strokeLinejoin="round"
                    />
                    <path
                      d={wallD}
                      fill="none"
                      stroke="#000000"
                      strokeOpacity={darkTheme ? 0.075 : 0.045}
                      strokeWidth={13}
                      strokeLinejoin="round"
                    />
                    <path
                      d={wallD}
                      fill="none"
                      stroke="#000000"
                      strokeOpacity={darkTheme ? 0.1 : 0.06}
                      strokeWidth={7}
                      strokeLinejoin="round"
                    />
                  </g>
                  <path
                    d={wallD}
                    fill="none"
                    stroke="#000000"
                    strokeOpacity={darkTheme ? 0.08 : 0.04}
                    strokeWidth={10}
                    strokeLinejoin="round"
                  />
                  <path
                    d={wallD}
                    fill="none"
                    stroke="#000000"
                    strokeOpacity={darkTheme ? 0.14 : 0.07}
                    strokeWidth={4.5}
                    strokeLinejoin="round"
                  />
                </>
              )}

              {room.type === 'stairs' &&
                !isStairTex &&
                stairBox &&
                (() => {
                  const lines: number[] = [];
                  for (let y = stairBox.minY + 12; y < stairBox.maxY - 8; y += 11) {
                    lines.push(y);
                  }
                  return (
                    <g transform={stairTransform}>
                      {lines.map((y) => (
                        <line
                          key={y}
                          x1={stairBox.minX}
                          y1={y}
                          x2={stairBox.maxX}
                          y2={y}
                          stroke={inkColor}
                          strokeOpacity={0.22}
                          strokeWidth={1.2}
                        />
                      ))}
                    </g>
                  );
                })()}
            </g>

            {isInaccessible && (
              <path
                d={d}
                fill={
                  darkTheme
                    ? 'rgba(0, 0, 0, 0.56)'
                    : 'rgba(28, 25, 23, 0.38)'
                }
                stroke="none"
                className="pointer-events-none"
              />
            )}
            </g>

            {/* Room Perimeter Walls (masked cleanly by doors + Wall & Floor Slices) */}
            {wallD && (
              <path
                d={wallD}
                fill="none"
                stroke={isSelected ? '#0D9488' : stroke}
                strokeWidth={
                  isSelected ? 4 : room.type === 'courtyard' ? 2 : 3.5
                }
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={room.type === 'secret' ? '7 5' : undefined}
                mask="url(#door-wall-cutout-mask)"
              />
            )}

            {/* Architectural balustrade / parapet railing for open balcony & courtyard edges */}
            {!room.unwalled && room.type === 'courtyard' && hiddenWallD && (
              <path
                d={hiddenWallD}
                fill="none"
                stroke={isSelected ? '#0D9488' : stroke}
                strokeOpacity={isSelected ? 0.85 : 0.72}
                strokeWidth={isSelected ? 2.4 : 2}
                strokeDasharray="6 4"
                strokeLinecap="round"
                className="pointer-events-none"
              />
            )}

            {/* Subtle boundary guide for unwalled rooms or removed walls while editing */}
            {isSelected && room.unwalled && (
              <path
                d={d}
                fill="none"
                stroke="#0D9488"
                strokeOpacity={0.55}
                strokeWidth={1.8}
                strokeDasharray="5 4"
                className="pointer-events-none"
              />
            )}
            {isSelected && !room.unwalled && room.type !== 'courtyard' && hiddenWallD && (
              <path
                d={hiddenWallD}
                fill="none"
                stroke="#0D9488"
                strokeOpacity={0.45}
                strokeWidth={1.6}
                strokeDasharray="4 4"
                className="pointer-events-none"
              />
            )}

            {room.showLabel && anchor && (
              <g className="pointer-events-none">
                <text
                  x={anchor.x}
                  y={anchor.y - 3}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={700}
                  fill={inkColor}
                  style={{ fontFamily: 'var(--font-sans)' }}
                >
                  {room.name}
                </text>
                <text
                  x={anchor.x}
                  y={anchor.y + 13}
                  textAnchor="middle"
                  fontSize={10}
                  fill={mutedInk}
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  {getEffectiveRoomAreaSqFt(
                    room,
                    activeSlices,
                    doc.grid.cellSize,
                    doc.grid.feetPerCell
                  )}{' '}
                  sq ft
                  {isInaccessible ? ' · sealed' : ''}
                </text>
              </g>
            )}

            {stepNums && stepNums.length > 0 && anchor && (
              <g className="pointer-events-none">
                <g transform={`translate(${anchor.x} ${anchor.y - 26})`}>
                  <circle
                    r={11}
                    fill={stepNums[0] === 1 ? '#0D9488' : '#1C1917'}
                    stroke="#FFF"
                    strokeWidth={2}
                  />
                  <text
                    y={3.8}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={700}
                    fill="#FFF"
                  >
                    {stepNums.join(',')}
                  </text>
                </g>
              </g>
            )}
          </g>
        );
      }),
    [
      accessibility.inaccessibleRoomIds,
      activeSlices,
      darkTheme,
      doc.customTextures,
      doc.grid.cellSize,
      doc.grid.feetPerCell,
      doc.rooms,
      inkColor,
      mutedInk,
      selectedRoomId,
      stepNumbersByRoom,
    ]
  );

  // Encapsulating walls around Floor Slices (only drawn along boundaries bordering room floor)
  const floorSliceWallsLayer = useMemo(() => {
    const runs = computeFloorSliceWalls(doc.rooms, activeSlices);
    if (runs.length === 0) return null;
    const roomByIdMap = new Map(doc.rooms.map((r) => [r.id, r]));
    return (
      <g className="pointer-events-none">
        <g mask="url(#floor-slice-cutout-mask)">
          {runs.map((fw, i) => (
            <g key={`fsw-shdw-${fw.sliceId}-${i}`}>
              <g transform="translate(2.5 3)">
                <path
                  d={fw.pathD}
                  fill="none"
                  stroke="#000000"
                  strokeOpacity={darkTheme ? 0.055 : 0.03}
                  strokeWidth={20}
                  strokeLinejoin="round"
                />
                <path
                  d={fw.pathD}
                  fill="none"
                  stroke="#000000"
                  strokeOpacity={darkTheme ? 0.075 : 0.045}
                  strokeWidth={13}
                  strokeLinejoin="round"
                />
              </g>
              <path
                d={fw.pathD}
                fill="none"
                stroke="#000000"
                strokeOpacity={darkTheme ? 0.09 : 0.05}
                strokeWidth={9}
                strokeLinejoin="round"
              />
            </g>
          ))}
        </g>
        {runs.map((fw, i) => {
          const rm = roomByIdMap.get(fw.roomId);
          const mat = rm
            ? (MATERIAL_PALETTE[rm.floorMaterial] ?? MATERIAL_PALETTE.stone)
            : MATERIAL_PALETTE.stone;
          const stroke = darkTheme ? mat.strokeDark : mat.strokeLight;
          return (
            <path
              key={`fsw-${fw.sliceId}-${i}`}
              d={fw.pathD}
              fill="none"
              stroke={stroke}
              strokeWidth={fw.isCourtyard ? 2 : 3.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              mask="url(#wall-slice-only-mask)"
            />
          );
        })}
      </g>
    );
  }, [activeSlices, darkTheme, doc.rooms]);

  // Memoized Highlighted Walls Layer
  const highlightedWallsLayer = useMemo(
    () =>
      accessibility.highlightedWalls.map((wall, idx) => (
        <g
          key={`hw-${wall.roomId}-${wall.edgeIndex}-${idx}`}
          className="pointer-events-none"
        >
          <line
            x1={wall.a.x}
            y1={wall.a.y}
            x2={wall.b.x}
            y2={wall.b.y}
            stroke="#F59E0B"
            strokeWidth={9}
            strokeOpacity={0.32}
            strokeLinecap="round"
          />
          <line
            x1={wall.a.x}
            y1={wall.a.y}
            x2={wall.b.x}
            y2={wall.b.y}
            stroke="#E11D48"
            strokeWidth={3.5}
            strokeDasharray="7 5"
            strokeLinecap="round"
          />
        </g>
      )),
    [accessibility.highlightedWalls]
  );

  // Memoized Doorways Layer (Clean architectural visuals for Normal, Secret, Locked, Disabled)
  const doorwaysLayer = useMemo(
    () =>
      visibleDoorways.map((door) => {
        const deg = (door.angle * 180) / Math.PI;
        const hw = door.width / 2;
        const isSel = selectedDoorId === door.id;
        const isHighlightedDisabled = accessibility.highlightedDisabledDoorIds.has(door.id);
        const isOverlapping = overlapWarning.overlappingDoorIds.has(door.id);
        const isExterior = door.roomBId === null;
        const kind: DoorKind = door.kind ?? 'normal';
        const isSecret = kind === 'secret' || kind === 'locked-secret';
        const isLocked = kind === 'locked' || kind === 'locked-secret';
        const isDisabled = !door.enabled;

        return (
          <g
            key={door.id}
            transform={`translate(${door.position.x} ${door.position.y}) rotate(${deg})`}
            className="cursor-grab active:cursor-grabbing"
          >
            <rect x={-hw - 8} y={-15} width={door.width + 16} height={30} fill="transparent" />

            {/* Accessibility warning highlight */}
            {isHighlightedDisabled && (
              <rect
                x={-hw - 6}
                y={-12}
                width={door.width + 12}
                height={24}
                rx={6}
                fill="rgba(245, 158, 11, 0.24)"
                stroke="#F59E0B"
                strokeWidth={2.5}
                className="animate-pulse"
              />
            )}

            {/* Overlap warning highlight */}
            {isOverlapping && (
              <rect
                x={-hw - 5.5}
                y={-11.5}
                width={door.width + 11}
                height={23}
                rx={5}
                fill="rgba(225, 29, 72, 0.16)"
                stroke="#E11D48"
                strokeWidth={2}
                strokeDasharray="4 2"
              />
            )}

            {isSel && (
              <rect
                x={-hw - 5}
                y={-10.5}
                width={door.width + 10}
                height={21}
                rx={4.5}
                fill="none"
                stroke="#0D9488"
                strokeWidth={2}
              />
            )}

            {/* Door Sprite Body */}
            <g opacity={isDisabled ? 0.55 : 1}>
              {isSecret ? (
                <>
                  {/* Concealed stone-masonry secret wall panel */}
                  <rect
                    x={-hw + 1}
                    y={-3.5}
                    width={door.width - 2}
                    height={7}
                    rx={1.5}
                    fill={darkTheme ? '#451A03' : '#FDE68A'}
                    stroke={isLocked ? '#DC2626' : secretColor}
                    strokeWidth={1.4}
                    strokeDasharray="3.5 2"
                  />
                  <line
                    x1={-hw + 6}
                    y1={-3}
                    x2={-hw + 3}
                    y2={3}
                    stroke={secretColor}
                    strokeWidth={0.85}
                    strokeOpacity={0.7}
                  />
                  <line
                    x1={hw - 5}
                    y1={-3}
                    x2={hw - 8}
                    y2={3}
                    stroke={secretColor}
                    strokeWidth={0.85}
                    strokeOpacity={0.7}
                  />
                  {isLocked && (
                    <circle
                      cx={0}
                      cy={0}
                      r={1.8}
                      fill="#DC2626"
                      stroke="#FEF3C7"
                      strokeWidth={0.6}
                    />
                  )}
                </>
              ) : (
                <>
                  {/* Door leaf: iron-slate if Locked, warm oak plank if Unlocked */}
                  <rect
                    x={-hw + 1}
                    y={-3.5}
                    width={door.width - 2}
                    height={7}
                    rx={1}
                    fill={
                      isDisabled
                        ? '#78716C'
                        : isLocked
                          ? '#334155'
                          : isExterior
                            ? '#B45309'
                            : '#92400E'
                    }
                    stroke={isLocked ? '#DC2626' : inkColor}
                    strokeWidth={isLocked ? 1.4 : 1.1}
                  />
                  {isLocked ? (
                    <>
                      <line x1={-hw + 6} y1={-3.5} x2={-hw + 6} y2={3.5} stroke="#94A3B8" strokeWidth={1.3} />
                      <line x1={hw - 6} y1={-3.5} x2={hw - 6} y2={3.5} stroke="#94A3B8" strokeWidth={1.3} />
                      <rect x={-2.2} y={-1.4} width={4.4} height={3.2} rx={0.7} fill="#FBBF24" />
                    </>
                  ) : (
                    <>
                      <rect x={-hw + 1.5} y={-3.6} width={2} height={7.2} fill="#334155" />
                      <circle cx={hw - 4.5} cy={0} r={1.3} fill="#FBBF24" stroke="#451A03" strokeWidth={0.5} />
                    </>
                  )}
                </>
              )}

              {/* Subtle diagonal slash across the leaf when Disabled */}
              {isDisabled && (
                <line
                  x1={-hw + 4}
                  y1={-4.5}
                  x2={hw - 4}
                  y2={4.5}
                  stroke="#DC2626"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              )}
            </g>
          </g>
        );
      }),
    [
      accessibility.highlightedDisabledDoorIds,
      darkTheme,
      inkColor,
      overlapWarning.overlappingDoorIds,
      secretColor,
      selectedDoorId,
      visibleDoorways,
    ]
  );

  // Slice Overlays (hidden unless Slice tool active, hovered, selected, or blocking rooms)
  const slicesOverlayLayer = useMemo(
    () =>
      activeSlices.map((sl) => {
        const isSel = selectedSliceId === sl.id;
        const isHover = hoveredSliceId === sl.id;
        const isBlocking = accessibility.blockingSliceIds?.has(sl.id) ?? false;
        const showGuide = activeTool === 'slice' || isSel || isHover || isBlocking;
        if (!showGuide || sl.points.length < 3) return null;

        const d = buildRoomSvgPath(sl);
        const box = getPolygonBoundingBox(sl.points);
        const cx = box.minX + box.width / 2;
        const cy = box.minY + box.height / 2;
        const isFloor = sl.mode === 'floor';
        const strokeCol = isBlocking
          ? '#E11D48'
          : isFloor
            ? '#E11D48'
            : '#0284C7';
        const fillCol = isBlocking
          ? 'rgba(225, 29, 72, 0.14)'
          : isFloor
            ? isSel
              ? 'rgba(225, 29, 72, 0.12)'
              : 'rgba(225, 29, 72, 0.06)'
            : isSel
              ? 'rgba(2, 132, 199, 0.12)'
              : 'rgba(2, 132, 199, 0.06)';

        return (
          <g key={`slice-guide-${sl.id}`} className="pointer-events-none">
            {isBlocking && (
              <path
                d={d}
                fill="none"
                stroke="#F59E0B"
                strokeWidth={6}
                strokeOpacity={0.36}
                strokeLinejoin="round"
              />
            )}
            <path
              d={d}
              fill={fillCol}
              stroke={strokeCol}
              strokeWidth={isSel || isBlocking ? 2.2 : 1.5}
              strokeDasharray="6 4"
              strokeLinejoin="round"
            />
            {(isSel || activeTool === 'slice' || isBlocking) && (
              <text
                x={cx}
                y={cy + 3.5}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fill={strokeCol}
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {isBlocking
                  ? '⚠ BLOCKING'
                  : isFloor
                    ? 'FLOOR SLICE'
                    : 'WALL SLICE'}
              </text>
            )}
          </g>
        );
      }),
    [
      accessibility.blockingSliceIds,
      activeSlices,
      activeTool,
      hoveredSliceId,
      selectedSliceId,
    ]
  );

  // Memoized Secret Passages Layer (uses non-scaling-stroke so zoom never invalidates!)
  const secretPassagesLayer = useMemo(
    () =>
      doc.secretPassages.map((sp) => {
        if (sp.points.length < 2) return null;
        const resolved = resolveSecretPassagePolyline(sp, doc.rooms);
        const polyPts = resolved.points;
        const ptsAttr = polyPts.map((p) => `${p.x},${p.y}`).join(' ');
        const isSel = selectedSecretPassageId === sp.id;
        const isOverlapping = overlapWarning.overlappingPassageIds.has(sp.id);
        const p0 = polyPts[0];
        const pLast = polyPts[polyPts.length - 1];
        const midIdx = Math.floor(polyPts.length / 2);
        const labelPos =
          polyPts.length % 2 === 1
            ? polyPts[midIdx]
            : {
                x: (polyPts[midIdx - 1].x + polyPts[midIdx].x) / 2,
                y: (polyPts[midIdx - 1].y + polyPts[midIdx].y) / 2,
              };

        const middleChain: Point[] = [
          resolved.startElbow,
          ...sp.midPoints,
          ...(resolved.endElbow
            ? [resolved.endElbow]
            : distance(resolved.startElbow, resolved.endAnchor) > 8
              ? [resolved.endAnchor]
              : []),
        ];

        return (
          <g key={sp.id}>
            <polyline
              points={ptsAttr}
              fill="none"
              stroke="transparent"
              strokeWidth={22}
              vectorEffect="non-scaling-stroke"
              className="cursor-pointer"
            />
            {isOverlapping && (
              <polyline
                points={ptsAttr}
                fill="none"
                stroke="#E11D48"
                strokeWidth={9}
                strokeOpacity={0.35}
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none"
              />
            )}
            <polyline
              points={ptsAttr}
              fill="none"
              stroke={isOverlapping ? '#E11D48' : secretColor}
              strokeWidth={isSel ? 8 : 5}
              strokeOpacity={isSel ? 0.35 : 0.16}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none"
            />
            <polyline
              points={ptsAttr}
              fill="none"
              stroke={isOverlapping ? '#E11D48' : secretColor}
              strokeWidth={2.5}
              strokeDasharray="6 4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none"
            />

            <text
              x={labelPos.x}
              y={labelPos.y - 10}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill={secretColor}
              className="pointer-events-none"
            >
              {sp.label || 'secret passage'}
            </text>

            <circle
              cx={p0.x}
              cy={p0.y}
              r={8.5}
              fill={bgColor}
              stroke={isSel ? '#0D9488' : secretColor}
              strokeWidth={2}
            />
            <text
              x={p0.x}
              y={p0.y + 3.2}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill={secretColor}
              className="pointer-events-none"
            >
              S
            </text>

            <circle
              cx={pLast.x}
              cy={pLast.y}
              r={8.5}
              fill={bgColor}
              stroke={isSel ? '#0D9488' : secretColor}
              strokeWidth={2}
              strokeDasharray={sp.toRoomId ? undefined : '2.5 2'}
            />
            <text
              x={pLast.x}
              y={pLast.y + 3.2}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill={secretColor}
              className="pointer-events-none"
            >
              {sp.toRoomId ? 'S' : 'E'}
            </text>

            {isSel && activeTool === 'select' && (
              <g>
                <circle
                  cx={resolved.startAnchor.x}
                  cy={resolved.startAnchor.y}
                  r={11}
                  fill="transparent"
                  stroke="#0D9488"
                  strokeWidth={2}
                  className="cursor-move"
                />
                <circle
                  cx={resolved.endAnchor.x}
                  cy={resolved.endAnchor.y}
                  r={11}
                  fill="transparent"
                  stroke="#0D9488"
                  strokeWidth={2}
                  className="cursor-move"
                />

                <g
                  transform={`translate(${resolved.startElbow.x} ${resolved.startElbow.y})`}
                  className="cursor-ns-resize"
                >
                  <polygon
                    points="0,-7 7,0 0,7 -7,0"
                    fill="#FFFFFF"
                    stroke="#0D9488"
                    strokeWidth={2.2}
                  />
                </g>
                {resolved.endElbow && (
                  <g
                    transform={`translate(${resolved.endElbow.x} ${resolved.endElbow.y})`}
                    className="cursor-ns-resize"
                  >
                    <polygon
                      points="0,-7 7,0 0,7 -7,0"
                      fill="#FFFFFF"
                      stroke="#0D9488"
                      strokeWidth={2.2}
                    />
                  </g>
                )}

                {middleChain.slice(0, -1).map((a, idx) => {
                  const b = middleChain[idx + 1];
                  const mx = (a.x + b.x) / 2;
                  const my = (a.y + b.y) / 2;
                  return (
                    <g
                      key={`sp-mid-${idx}`}
                      transform={`translate(${mx} ${my})`}
                      className="cursor-move"
                    >
                      <circle
                        r={6.5}
                        fill="#FFFFFF"
                        stroke={secretColor}
                        strokeWidth={2}
                      />
                      <line x1={-2.5} y1={0} x2={2.5} y2={0} stroke={secretColor} strokeWidth={1.4} />
                      <line x1={0} y1={-2.5} x2={0} y2={2.5} stroke={secretColor} strokeWidth={1.4} />
                    </g>
                  );
                })}

                {sp.midPoints.map((pt, idx) => {
                  const isMidSelected = isSel && selectedSecretMidIndex === idx;
                  return (
                    <g key={`sp-bend-${idx}`}>
                      {isMidSelected && (
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={10.5}
                          fill="none"
                          stroke="#0D9488"
                          strokeWidth={2}
                          className="pointer-events-none"
                        />
                      )}
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isMidSelected ? 7.5 : 6.5}
                        fill={isMidSelected ? '#0D9488' : secretColor}
                        stroke="#FFFFFF"
                        strokeWidth={2}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSecretPassageMidNode(sp.id, idx);
                        }}
                        className="cursor-move"
                      />
                    </g>
                  );
                })}
              </g>
            )}
          </g>
        );
      }),
    [
      activeTool,
      bgColor,
      doc.rooms,
      doc.secretPassages,
      handleDeleteSecretPassageMidNode,
      overlapWarning.overlappingPassageIds,
      secretColor,
      selectedSecretMidIndex,
      selectedSecretPassageId,
    ]
  );

  // Memoized Interlinking Stairway Portal Badges on Active Floor
  const stairLinksLayer = useMemo(() => {
    const activeFloorObj = doc.floors.find((f) => f.id === doc.activeFloorId);
    const activeElev = activeFloorObj?.elevationOrder ?? 0;

    return doc.stairLinks.map((st) => {
      const isFrom = st.fromFloorId === doc.activeFloorId;
      const isTo = st.toFloorId === doc.activeFloorId && st.bidirectional !== false;
      if (!isFrom && !isTo) return null;

      const roomId = isFrom ? st.fromRoomId : st.toRoomId;
      const targetFloorId = isFrom ? st.toFloorId : st.fromFloorId;
      const targetRoomId = isFrom ? st.toRoomId : st.fromRoomId;
      const room = doc.rooms.find((r) => r.id === roomId);
      const targetFloor = doc.floors.find((f) => f.id === targetFloorId);
      if (!room || !targetFloor) return null;

      const anchor = getEffectiveRoomLabelAnchor(room, activeSlices);
      const arrow =
        targetFloor.elevationOrder > activeElev
          ? '↑'
          : targetFloor.elevationOrder < activeElev
            ? '↓'
            : '⇅';
      const kindTag = st.kind === 'ladder' ? 'Ladder · ' : st.kind === 'spiral' ? 'Spiral · ' : '';
      const label = `${arrow} ${kindTag}${targetFloor.name}`;
      const badgeWidth = Math.max(88, Math.min(148, label.length * 6.2 + 18));

      return (
        <g
          key={`stair-badge-${st.id}-${roomId}`}
          transform={`translate(${anchor.x} ${anchor.y + 28})`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onJumpToFloorAndRoom?.(targetFloorId, targetRoomId);
          }}
          className="cursor-pointer"
        >
          <title>{`Jump to ${targetFloor.name} via ${st.label}`}</title>
          <rect
            x={-badgeWidth / 2}
            y={-10}
            width={badgeWidth}
            height={20}
            rx={6}
            fill={darkTheme ? '#1E293B' : '#FFFFFF'}
            stroke={st.enabled ? '#0D9488' : '#DC2626'}
            strokeWidth={1.6}
          />
          <text
            y={3.5}
            textAnchor="middle"
            fontSize={9.5}
            fontWeight={700}
            fill={
              st.enabled
                ? darkTheme
                  ? '#5EEAD4'
                  : '#0F766E'
                : '#DC2626'
            }
          >
            {label}
          </text>
        </g>
      );
    });
  }, [activeSlices, darkTheme, doc.activeFloorId, doc.floors, doc.rooms, doc.stairLinks, onJumpToFloorAndRoom]);

  // Adjacent Floor Silhouette toward Ground Floor (shape, subtle walls, subtle doors, subtle linked stair indicators)
  const adjacentFloorTowardGround = useMemo(
    () => getAdjacentFloorTowardGround(doc.floors, doc.activeFloorId),
    [doc.floors, doc.activeFloorId]
  );

  const adjacentSlices = useMemo(
    () => adjacentFloorTowardGround?.slices ?? [],
    [adjacentFloorTowardGround]
  );

  const adjacentVisibleDoorways = useMemo(
    () =>
      adjacentFloorTowardGround
        ? adjacentFloorTowardGround.doorways.filter(
            (d) => !isDoorwaySliced(d, adjacentSlices)
          )
        : [],
    [adjacentFloorTowardGround, adjacentSlices]
  );

  const { adjacentFloorSilhouetteLayer, adjacentStairGhostLayer } = useMemo(() => {
    if (!adjacentFloorTowardGround || adjacentFloorTowardGround.rooms.length === 0) {
      return { adjacentFloorSilhouetteLayer: null, adjacentStairGhostLayer: null };
    }

    const adjId = adjacentFloorTowardGround.id;
    const adjRooms = adjacentFloorTowardGround.rooms;
    const floorFill = darkTheme
      ? 'rgba(148, 163, 184, 0.08)'
      : 'rgba(100, 116, 139, 0.09)';
    const floorPerimeter = darkTheme
      ? 'rgba(148, 163, 184, 0.16)'
      : 'rgba(71, 85, 105, 0.16)';
    const wallStroke = darkTheme
      ? 'rgba(148, 163, 184, 0.27)'
      : 'rgba(71, 85, 105, 0.25)';
    const doorStroke = darkTheme
      ? 'rgba(148, 163, 184, 0.38)'
      : 'rgba(71, 85, 105, 0.36)';
    const stairColor = darkTheme ? '#5EEAD4' : '#0F766E';

    const linkedStairInfoByRoomId = new Map<
      string,
      { kind: StairKind; connectsActive: boolean; targetAbove: boolean }
    >();
    const activeFloorObj = doc.floors.find((f) => f.id === doc.activeFloorId);
    const activeElev = activeFloorObj?.elevationOrder ?? 0;

    for (const st of doc.stairLinks) {
      const isFrom = st.fromFloorId === adjId;
      const isTo = st.toFloorId === adjId && st.bidirectional !== false;
      if (!isFrom && !isTo) continue;
      const roomId = isFrom ? st.fromRoomId : st.toRoomId;
      const otherFloorId = isFrom ? st.toFloorId : st.fromFloorId;
      const otherFloor = doc.floors.find((f) => f.id === otherFloorId);
      const connectsActive = otherFloorId === doc.activeFloorId;
      const targetAbove = (otherFloor?.elevationOrder ?? activeElev) > adjacentFloorTowardGround.elevationOrder;
      const existing = linkedStairInfoByRoomId.get(roomId);
      if (!existing || connectsActive) {
        linkedStairInfoByRoomId.set(roomId, {
          kind: st.kind,
          connectsActive: existing?.connectsActive || connectsActive,
          targetAbove,
        });
      }
    }

    const sliceWalls = computeFloorSliceWalls(adjRooms, adjacentSlices);

    const silhouette = (
      <g className="pointer-events-none">
        {/* Adjacent Floor Footprint Shape (masked by floor slices) */}
        <g mask="url(#adj-floor-slice-cutout-mask)">
          {adjRooms.map((room) => {
            if (room.points.length < 3) return null;
            const d = buildRoomSvgPath(room);
            const isLinkedStair = linkedStairInfoByRoomId.has(room.id);
            return (
              <path
                key={`adj-shape-${room.id}`}
                d={d}
                fill={
                  isLinkedStair
                    ? darkTheme
                      ? 'rgba(45, 212, 191, 0.11)'
                      : 'rgba(13, 148, 136, 0.10)'
                    : floorFill
                }
                stroke={floorPerimeter}
                strokeWidth={1}
              />
            );
          })}
        </g>

        {/* Adjacent Floor Subtle Walls (masked by doors & slices) */}
        <g mask="url(#adj-door-wall-cutout-mask)">
          {adjRooms.map((room) => {
            const wallD = buildRoomWallPath(room);
            if (!wallD) return null;
            return (
              <path
                key={`adj-wall-${room.id}`}
                d={wallD}
                fill="none"
                stroke={wallStroke}
                strokeWidth={3}
                strokeDasharray="6 3"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}
          {sliceWalls.map((fw, idx) => (
            <path
              key={`adj-swall-${idx}`}
              d={fw.pathD}
              fill="none"
              stroke={wallStroke}
              strokeWidth={2.5}
              strokeDasharray="6 3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </g>

        {/* Adjacent Floor Subtle Doors */}
        {adjacentVisibleDoorways.map((door) => {
          const kind: DoorKind = door.kind ?? 'normal';
          if (kind === 'secret' || kind === 'locked-secret') return null;
          if (
            !Number.isFinite(door.position.x) ||
            !Number.isFinite(door.position.y) ||
            !Number.isFinite(door.angle)
          ) {
            return null;
          }
          const deg = (door.angle * 180) / Math.PI;
          const hw = door.width / 2;
          return (
            <g
              key={`adj-door-${door.id}`}
              transform={`translate(${door.position.x} ${door.position.y}) rotate(${deg})`}
              opacity={door.enabled ? 0.9 : 0.42}
            >
              <line
                x1={-hw}
                y1={-3.5}
                x2={-hw}
                y2={3.5}
                stroke={doorStroke}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
              <line
                x1={hw}
                y1={-3.5}
                x2={hw}
                y2={3.5}
                stroke={doorStroke}
                strokeWidth={1.6}
                strokeLinecap="round"
              />
              <line
                x1={-hw}
                y1={0}
                x2={hw}
                y2={0}
                stroke={doorStroke}
                strokeWidth={1}
                strokeDasharray="2 2"
              />
            </g>
          );
        })}

        {/* Linked Stair Silhouette Highlights in Underlay */}
        {adjRooms.map((room) => {
          const info = linkedStairInfoByRoomId.get(room.id);
          if (!info || room.points.length < 3) return null;
          const d = buildRoomSvgPath(room);
          const anchor = getEffectiveRoomLabelAnchor(room, adjacentSlices);
          return (
            <g key={`adj-stair-under-${room.id}`} opacity={info.connectsActive ? 0.48 : 0.34}>
              <path
                d={d}
                fill="none"
                stroke={stairColor}
                strokeWidth={1.6}
                strokeDasharray="4 3"
              />
              <g transform={`translate(${anchor.x} ${anchor.y})`}>
                <circle r={11} fill="none" stroke={stairColor} strokeWidth={1.2} strokeDasharray="3 2" />
                {info.kind === 'spiral' ? (
                  <path
                    d="M -4 0 A 4 4 0 1 1 2 3.5 M -2 0 A 2 2 0 1 1 1 1.5"
                    fill="none"
                    stroke={stairColor}
                    strokeWidth={1.3}
                    strokeLinecap="round"
                  />
                ) : (
                  <path
                    d="M -5 -3 H 5 M -5 0 H 5 M -5 3 H 5"
                    stroke={stairColor}
                    strokeWidth={1.3}
                    strokeLinecap="round"
                  />
                )}
              </g>
            </g>
          );
        })}
      </g>
    );

    const stairGhost = (
      <g className="pointer-events-none">
        {adjRooms.map((room) => {
          const info = linkedStairInfoByRoomId.get(room.id);
          if (!info || room.points.length < 3) return null;
          const d = buildRoomSvgPath(room);
          const anchor = getEffectiveRoomLabelAnchor(room, adjacentSlices);
          return (
            <g
              key={`adj-stair-ghost-${room.id}`}
              opacity={info.connectsActive ? 0.28 : 0.18}
            >
              <path
                d={d}
                fill="none"
                stroke={stairColor}
                strokeWidth={1.4}
                strokeDasharray="4 3"
              />
              <g transform={`translate(${anchor.x} ${anchor.y})`}>
                <circle
                  r={8.5}
                  fill="none"
                  stroke={stairColor}
                  strokeWidth={1.2}
                  strokeDasharray="2.5 2"
                />
                <path
                  d={info.targetAbove ? 'M -3 1.5 L 0 -2 L 3 1.5' : 'M -3 -1.5 L 0 2 L 3 -1.5'}
                  fill="none"
                  stroke={stairColor}
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          );
        })}
      </g>
    );

    return {
      adjacentFloorSilhouetteLayer: silhouette,
      adjacentStairGhostLayer: stairGhost,
    };
  }, [
    adjacentFloorTowardGround,
    adjacentSlices,
    adjacentVisibleDoorways,
    darkTheme,
    doc.activeFloorId,
    doc.floors,
    doc.stairLinks,
  ]);

  // Memoized Path Route Layer (filtered per active floor so cross-floor steps never draw floating lines)
  const pathRouteLayer = useMemo(() => {
    if (!pathResult?.reachable || pathResult.steps.length === 0) return null;

    const runs: Point[][] = [];
    let currentRun: Point[] = [];
    for (const step of pathResult.steps) {
      if (step.floorId === doc.activeFloorId) {
        const pts = step.floorWaypoints ?? [];
        for (const p of pts) {
          const last = currentRun[currentRun.length - 1];
          if (!last || distance(last, p) > 1.5) {
            currentRun.push(p);
          }
        }
      } else if (currentRun.length > 0) {
        runs.push(currentRun);
        currentRun = [];
      }
    }
    if (currentRun.length > 0) runs.push(currentRun);

    const activeRuns = runs.filter((r) => r.length >= 2);

    return (
      <g className="pointer-events-none">
        {activeRuns.map((run, rIdx) => {
          const ptsStr = run.map((p) => `${p.x},${p.y}`).join(' ');
          return (
            <React.Fragment key={`path-run-${rIdx}`}>
              <polyline
                points={ptsStr}
                fill="none"
                stroke="#0D9488"
                strokeWidth={7}
                strokeOpacity={0.22}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={ptsStr}
                fill="none"
                stroke="#0D9488"
                strokeWidth={3.5}
                strokeDasharray="10 8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="animate-path-flow"
              />
            </React.Fragment>
          );
        })}

        {pathResult.steps.map((step, idx) => {
          if (step.floorId !== doc.activeFloorId) return null;
          if (!step.viaSecretPassageId || !step.portalPosition) return null;
          return (
            <g
              key={`path-sp-badge-${step.viaSecretPassageId}-${idx}`}
              transform={`translate(${step.portalPosition.x} ${step.portalPosition.y})`}
            >
              <rect
                x={-15}
                y={-10}
                width={30}
                height={20}
                rx={10}
                fill="#B45309"
                stroke="#FFF"
                strokeWidth={1.8}
              />
              <text
                y={3.5}
                textAnchor="middle"
                fontSize={9.5}
                fontWeight={700}
                fill="#FFF"
              >
                {idx}→{idx + 1}
              </text>
            </g>
          );
        })}

        {pathResult.steps[0]?.floorId === doc.activeFloorId &&
          pathResult.steps[0].floorWaypoints?.[0] && (
            <circle
              cx={pathResult.steps[0].floorWaypoints[0].x}
              cy={pathResult.steps[0].floorWaypoints[0].y}
              r={6.5}
              fill="#0D9488"
              stroke="#FFF"
              strokeWidth={2}
            />
          )}
        {(() => {
          const lastStep = pathResult.steps[pathResult.steps.length - 1];
          const lastPts = lastStep?.floorWaypoints;
          if (
            lastStep?.floorId === doc.activeFloorId &&
            lastPts &&
            lastPts.length > 0
          ) {
            const endPt = lastPts[lastPts.length - 1];
            return (
              <circle
                cx={endPt.x}
                cy={endPt.y}
                r={6.5}
                fill="#D97706"
                stroke="#FFF"
                strokeWidth={2}
              />
            );
          }
          return null;
        })()}
      </g>
    );
  }, [doc.activeFloorId, pathResult]);

  const rectPreviewBox = useMemo(() => {
    if (dragPreview?.kind !== 'draw-rect') return null;
    const x = Math.min(dragPreview.startWorld.x, dragPreview.currWorld.x);
    const y = Math.min(dragPreview.startWorld.y, dragPreview.currWorld.y);
    const w = Math.abs(dragPreview.currWorld.x - dragPreview.startWorld.x);
    const h = Math.abs(dragPreview.currWorld.y - dragPreview.startWorld.y);
    return { x, y, w, h, mode: dragPreview.mode };
  }, [dragPreview]);

  return (
    <div
      ref={containerRef}
      onMouseDown={(e) => {
        if (e.target instanceof Element && e.target.closest('[data-canvas-ui]')) return;
        if (e.button === 0 || e.button === 1) {
          handlePointerStart(e.clientX, e.clientY, e.button, e.shiftKey);
        }
      }}
      onMouseMove={(e) => handlePointerMove(e.clientX, e.clientY)}
      onMouseUp={(e) => {
        if (e.target instanceof Element && e.target.closest('[data-canvas-ui]') && !dragRef.current) {
          return;
        }
        handlePointerEnd();
      }}
      onMouseLeave={() => {
        if (dragRef.current) handlePointerEnd();
      }}
      className={`canvas-viewport relative flex-1 overflow-hidden ${cursorClass}`}
      style={{ backgroundColor: bgColor }}
    >
      <svg className="w-full h-full block">
        <defs>
          {floorPatternDefs}
          {(doc.customTextures ?? []).map((tex) => {
            const size = Math.max(20, Math.min(400, tex.tileSize || 80));
            return (
              <pattern
                key={`custom-tex-${tex.id}`}
                id={`floor-custom-${tex.id}`}
                width={size}
                height={size}
                patternUnits="userSpaceOnUse"
              >
                <image
                  href={tex.dataUrl}
                  x={0}
                  y={0}
                  width={size}
                  height={size}
                  preserveAspectRatio="xMidYMid slice"
                />
              </pattern>
            );
          })}
          <mask
            id="floor-slice-cutout-mask"
            maskUnits="userSpaceOnUse"
            x={-50000}
            y={-50000}
            width={100000}
            height={100000}
          >
            <rect x={-50000} y={-50000} width={100000} height={100000} fill="#FFFFFF" />
            {activeSlices
              .filter((sl) => sl.mode === 'floor' && sl.points.length >= 3)
              .map((sl) => (
                <path key={`fmask-${sl.id}`} d={buildRoomSvgPath(sl)} fill="#000000" />
              ))}
          </mask>
          <mask
            id="wall-slice-only-mask"
            maskUnits="userSpaceOnUse"
            x={-50000}
            y={-50000}
            width={100000}
            height={100000}
          >
            <rect x={-50000} y={-50000} width={100000} height={100000} fill="#FFFFFF" />
            {activeSlices
              .filter((sl) => sl.mode === 'wall' && sl.points.length >= 3)
              .map((sl) => (
                <path key={`wmask-${sl.id}`} d={buildRoomSvgPath(sl)} fill="#000000" />
              ))}
          </mask>
          <mask
            id="door-wall-cutout-mask"
            maskUnits="userSpaceOnUse"
            x={-50000}
            y={-50000}
            width={100000}
            height={100000}
          >
            <rect x={-50000} y={-50000} width={100000} height={100000} fill="#FFFFFF" />
            {visibleDoorways.map((door) => {
              const kind: DoorKind = door.kind ?? 'normal';
              if (kind === 'secret' || kind === 'locked-secret') return null;
              const deg = (door.angle * 180) / Math.PI;
              const hw = door.width / 2;
              return (
                <g
                  key={`mask-${door.id}`}
                  transform={`translate(${door.position.x} ${door.position.y}) rotate(${deg})`}
                >
                  <rect
                    x={-hw + 1.5}
                    y={-18}
                    width={Math.max(4, door.width - 3)}
                    height={36}
                    fill="#000000"
                  />
                </g>
              );
            })}
            {activeSlices
              .filter((sl) => sl.points.length >= 3)
              .map((sl) => (
                <path key={`smask-${sl.id}`} d={buildRoomSvgPath(sl)} fill="#000000" />
              ))}
          </mask>
          {doc.grid.showGrid && (
            <>
              <pattern
                id="grid-minor"
                width={cs}
                height={cs}
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
              >
                <path
                  d={`M ${cs} 0 L 0 0 0 ${cs}`}
                  fill="none"
                  stroke={
                    darkTheme
                      ? 'rgba(255, 255, 255, 0.08)'
                      : 'rgba(120, 113, 108, 0.15)'
                  }
                  strokeWidth={0.8 / viewport.zoom}
                />
              </pattern>
              <pattern
                id="grid-major"
                width={majorCs}
                height={majorCs}
                patternUnits="userSpaceOnUse"
                patternTransform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}
              >
                <rect width={majorCs} height={majorCs} fill="url(#grid-minor)" />
                <path
                  d={`M ${majorCs} 0 L 0 0 0 ${majorCs}`}
                  fill="none"
                  stroke={
                    darkTheme
                      ? 'rgba(255, 255, 255, 0.17)'
                      : 'rgba(120, 113, 108, 0.30)'
                  }
                  strokeWidth={1.15 / viewport.zoom}
                />
              </pattern>
            </>
          )}
          {adjacentFloorTowardGround && (
            <>
              <mask
                id="adj-floor-slice-cutout-mask"
                maskUnits="userSpaceOnUse"
                x={-50000}
                y={-50000}
                width={100000}
                height={100000}
              >
                <rect x={-50000} y={-50000} width={100000} height={100000} fill="#FFFFFF" />
                {adjacentSlices
                  .filter((sl) => sl.mode === 'floor' && sl.points.length >= 3)
                  .map((sl) => (
                    <path key={`adj-fmask-${sl.id}`} d={buildRoomSvgPath(sl)} fill="#000000" />
                  ))}
              </mask>
              <mask
                id="adj-door-wall-cutout-mask"
                maskUnits="userSpaceOnUse"
                x={-50000}
                y={-50000}
                width={100000}
                height={100000}
              >
                <rect x={-50000} y={-50000} width={100000} height={100000} fill="#FFFFFF" />
                {adjacentVisibleDoorways.map((door) => {
                  const kind: DoorKind = door.kind ?? 'normal';
                  if (kind === 'secret' || kind === 'locked-secret') return null;
                  const deg = (door.angle * 180) / Math.PI;
                  const hw = door.width / 2;
                  return (
                    <g
                      key={`adj-dmask-${door.id}`}
                      transform={`translate(${door.position.x} ${door.position.y}) rotate(${deg})`}
                    >
                      <rect
                        x={-hw + 1.5}
                        y={-18}
                        width={Math.max(4, door.width - 3)}
                        height={36}
                        fill="#000000"
                      />
                    </g>
                  );
                })}
                {adjacentSlices
                  .filter((sl) => sl.points.length >= 3)
                  .map((sl) => (
                    <path key={`adj-smask-${sl.id}`} d={buildRoomSvgPath(sl)} fill="#000000" />
                  ))}
              </mask>
            </>
          )}
        </defs>

        {doc.grid.showGrid && (
          <rect width="100%" height="100%" fill="url(#grid-major)" />
        )}

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {adjacentFloorSilhouetteLayer}
          {roomsLayer}
          {adjacentStairGhostLayer}
          {floorSliceWallsLayer}
          {highlightedWallsLayer}
          {doorwaysLayer}
          {stairLinksLayer}
          {secretPassagesLayer}
          {slicesOverlayLayer}
          {pathRouteLayer}

          {/* Selected Slice Handles */}
          {selectedSlice && activeTool === 'select' && (() => {
            const sliceCol = selectedSlice.mode === 'floor' ? '#E11D48' : '#0284C7';
            return (
              <g>
                {selectedSlice.points.map((_, idx) => {
                  const addPt = getPointAlongRoomEdge(selectedSlice, idx, 0.25);
                  return (
                    <g
                      key={`sl-add-node-${idx}`}
                      transform={`translate(${addPt.x} ${addPt.y})`}
                      className="cursor-pointer"
                    >
                      <circle r={6} fill="#FFFFFF" stroke={sliceCol} strokeWidth={1.5} />
                      <line x1={-2.5} y1={0} x2={2.5} y2={0} stroke={sliceCol} strokeWidth={1.4} />
                      <line x1={0} y1={-2.5} x2={0} y2={2.5} stroke={sliceCol} strokeWidth={1.4} />
                    </g>
                  );
                })}

                {selectedSlice.points.map((a, idx) => {
                  const b = selectedSlice.points[(idx + 1) % selectedSlice.points.length];
                  const bend = selectedSlice.edgeCurves[idx] ?? 0;
                  const handle = getEdgeHandlePoint(a, b, bend);
                  return (
                    <g
                      key={`sl-curve-${idx}`}
                      transform={`translate(${handle.x} ${handle.y})`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        const next = [...selectedSlice.edgeCurves];
                        next[idx] = 0;
                        onSlicesCommit(
                          activeSlices.map((s) =>
                            s.id === selectedSlice.id ? { ...s, edgeCurves: next } : s
                          )
                        );
                      }}
                      className="cursor-pointer"
                    >
                      <polygon
                        points="0,-6 6,0 0,6 -6,0"
                        fill={Math.abs(bend) > 1 ? '#D97706' : '#FFFFFF'}
                        stroke={sliceCol}
                        strokeWidth={2}
                      />
                    </g>
                  );
                })}

                {selectedSlice.points.map((pt, idx) => {
                  const isVertSelected = selectedSliceVertexIndex === idx;
                  return (
                    <rect
                      key={`sl-vert-${idx}`}
                      x={pt.x - 5.5}
                      y={pt.y - 5.5}
                      width={11}
                      height={11}
                      rx={2}
                      fill={isVertSelected ? sliceCol : '#FFFFFF'}
                      stroke={isVertSelected ? '#FFFFFF' : sliceCol}
                      strokeWidth={2}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (selectedSlice.points.length > 3) {
                          onDeleteSliceVertex(selectedSlice.id, idx);
                          setSelectedSliceVertexIndex(null);
                        }
                      }}
                      className="cursor-move"
                    />
                  );
                })}
              </g>
            );
          })()}

          {/* Selected Room Handles */}
          {selectedRoom && activeTool === 'select' && (() => {
            const rotGeo = getRoomRotationHandleGeometry(selectedRoom);
            const isRotating =
              dragPreview?.kind === 'rotate-room' &&
              dragPreview.roomId === selectedRoom.id;
            return (
              <g>
                {/* Room Rotation Stem & Handle */}
                <line
                  x1={rotGeo.stemStart.x}
                  y1={rotGeo.stemStart.y}
                  x2={rotGeo.handle.x}
                  y2={rotGeo.handle.y}
                  stroke="#0D9488"
                  strokeWidth={1.6}
                  strokeDasharray="3 3"
                  className="pointer-events-none"
                />
                <g
                  transform={`translate(${rotGeo.handle.x} ${rotGeo.handle.y})`}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <circle r={9.5} fill="#FFFFFF" stroke="#0D9488" strokeWidth={2.2} />
                  <g transform={`rotate(${rotGeo.angleDeg})`}>
                    <path
                      d="M -3.5 -1 A 3.8 3.8 0 1 1 2.2 3.2"
                      fill="none"
                      stroke="#0D9488"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                    />
                    <polygon points="-5,-2 -2,-3.2 -2.6,0.2" fill="#0D9488" />
                  </g>
                  {isRotating && (
                    <text
                      x={rotGeo.unitDir.x * 20}
                      y={rotGeo.unitDir.y * 20 + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={700}
                      fill={inkColor}
                    >
                      {dragPreview.currentDeg > 0
                        ? `+${dragPreview.currentDeg}`
                        : dragPreview.currentDeg}
                      °
                    </text>
                  )}
                </g>

                {selectedRoom.points.map((_, idx) => {
                  const addPt = getPointAlongRoomEdge(selectedRoom, idx, 0.25);
                  return (
                    <g
                      key={`add-node-${idx}`}
                      transform={`translate(${addPt.x} ${addPt.y})`}
                      className="cursor-pointer"
                    >
                      <circle r={6} fill="#FFFFFF" stroke="#57534E" strokeWidth={1.5} />
                      <line x1={-2.5} y1={0} x2={2.5} y2={0} stroke="#57534E" strokeWidth={1.4} />
                      <line x1={0} y1={-2.5} x2={0} y2={2.5} stroke="#57534E" strokeWidth={1.4} />
                    </g>
                  );
                })}

                {selectedRoom.points.map((a, idx) => {
                  const b =
                    selectedRoom.points[(idx + 1) % selectedRoom.points.length];
                  const bend = selectedRoom.edgeCurves[idx] ?? 0;
                  const handle = getEdgeHandlePoint(a, b, bend);
                  const isBending =
                    dragPreview?.kind === 'bend-edge' &&
                    dragPreview.edgeIndex === idx;
                  const overlappingCurveMatches = linkOverlappingNodes
                    ? findOverlappingCurveEdges(doc.rooms, handle, NODE_OVERLAP_TOLERANCE)
                    : [];
                  const hasLinkedCurve =
                    overlappingCurveMatches.filter(
                      (m) => !(m.roomId === selectedRoom.id && m.edgeIndex === idx)
                    ).length > 0;
                  const arcFt =
                    Math.round(
                      ((bend * 0.5) / doc.grid.cellSize) * doc.grid.feetPerCell * 10
                    ) / 10;

                  return (
                    <g
                      key={`curve-${idx}`}
                      transform={`translate(${handle.x} ${handle.y})`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if ((selectedRoom.edgeCurves[idx] ?? 0) === 0) return;
                        const straightenMatches = linkOverlappingNodes
                          ? findOverlappingCurveEdges(
                              doc.rooms,
                              handle,
                              NODE_OVERLAP_TOLERANCE
                            )
                          : [{ roomId: selectedRoom.id, edgeIndex: idx }];
                        const byRoom = new Map<string, Set<number>>();
                        for (const m of straightenMatches) {
                          let set = byRoom.get(m.roomId);
                          if (!set) {
                            set = new Set<number>();
                            byRoom.set(m.roomId, set);
                          }
                          set.add(m.edgeIndex);
                        }
                        onRoomsCommit(
                          doc.rooms.map((r) => {
                            const set = byRoom.get(r.id);
                            if (!set) return r;
                            const next = [...r.edgeCurves];
                            for (const eIdx of set) next[eIdx] = 0;
                            return { ...r, edgeCurves: next };
                          }),
                          'Straighten wall'
                        );
                      }}
                      className="cursor-pointer"
                    >
                      {hasLinkedCurve && (
                        <polygon
                          points="0,-10 10,0 0,10 -10,0"
                          fill="none"
                          stroke="#D97706"
                          strokeWidth={1.6}
                          strokeDasharray="2.5 2"
                          className="pointer-events-none"
                        />
                      )}
                      <polygon
                        points="0,-6.5 6.5,0 0,6.5 -6.5,0"
                        fill={Math.abs(bend) > 1 ? '#D97706' : '#FFFFFF'}
                        stroke="#0D9488"
                        strokeWidth={2}
                      />
                      {isBending && (
                        <text
                          y={-12}
                          textAnchor="middle"
                          fontSize={11}
                          fontWeight={600}
                          fill={inkColor}
                        >
                          {arcFt > 0 ? `+${arcFt}` : arcFt} ft curve
                        </text>
                      )}
                    </g>
                  );
                })}

                {selectedRoom.points.map((pt, idx) => {
                  const isVertSelected = selectedVertexIndex === idx;
                  const overlappingVertMatches = linkOverlappingNodes
                    ? findOverlappingRoomVertices(
                        doc.rooms,
                        pt,
                        NODE_OVERLAP_TOLERANCE
                      )
                    : [];
                  const hasLinkedVert =
                    overlappingVertMatches.filter(
                      (m) => !(m.roomId === selectedRoom.id && m.vertexIndex === idx)
                    ).length > 0;
                  return (
                    <g key={`vert-${idx}`}>
                      {hasLinkedVert && (
                        <rect
                          x={pt.x - 9.5}
                          y={pt.y - 9.5}
                          width={19}
                          height={19}
                          rx={4}
                          fill="none"
                          stroke="#D97706"
                          strokeWidth={1.6}
                          strokeDasharray="3 2"
                          className="pointer-events-none"
                        />
                      )}
                      <rect
                        x={pt.x - 6}
                        y={pt.y - 6}
                        width={12}
                        height={12}
                        rx={2}
                        fill={isVertSelected ? '#0D9488' : '#FFFFFF'}
                        stroke={isVertSelected ? '#FFFFFF' : '#0D9488'}
                        strokeWidth={2.2}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (selectedRoom.points.length > 3) {
                            onDeleteRoomVertex(selectedRoom.id, idx);
                            setSelectedVertexIndex(null);
                          }
                        }}
                        className="cursor-move"
                      />
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* Live Rectangle / Hallway / Slice Draw Preview */}
          {rectPreviewBox && (() => {
            const isSliceRect = rectPreviewBox.mode === 'slice';
            const strokeCol = isSliceRect
              ? activeSliceMode === 'floor'
                ? '#E11D48'
                : '#0284C7'
              : rectPreviewBox.mode === 'hallway'
                ? '#0D9488'
                : '#D97706';
            const fillCol = isSliceRect
              ? activeSliceMode === 'floor'
                ? 'rgba(225, 29, 72, 0.14)'
                : 'rgba(2, 132, 199, 0.14)'
              : rectPreviewBox.mode === 'hallway'
                ? 'rgba(13, 148, 136, 0.14)'
                : 'rgba(217, 119, 6, 0.14)';
            return (
              <g className="pointer-events-none">
                <rect
                  x={rectPreviewBox.x}
                  y={rectPreviewBox.y}
                  width={rectPreviewBox.w}
                  height={rectPreviewBox.h}
                  fill={fillCol}
                  stroke={strokeCol}
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                />
                {rectPreviewBox.w > 10 && rectPreviewBox.h > 10 && (
                  <text
                    x={rectPreviewBox.x + rectPreviewBox.w / 2}
                    y={rectPreviewBox.y + rectPreviewBox.h / 2}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill={inkColor}
                  >
                    {Math.round(
                      ((rectPreviewBox.w / doc.grid.cellSize) *
                        doc.grid.feetPerCell) * 10
                    ) / 10}{' '}
                    ft ×{' '}
                    {Math.round(
                      ((rectPreviewBox.h / doc.grid.cellSize) *
                        doc.grid.feetPerCell) * 10
                    ) / 10}{' '}
                    ft
                  </text>
                )}
              </g>
            );
          })()}

          {/* Live Polygon Draw Preview (Room Polygon or Slice Polygon) */}
          {((activeTool === 'polygon' && polyDraft.length > 0) ||
            (activeTool === 'slice' && sliceShapeMode === 'polygon' && slicePolyDraft.length > 0)) && (() => {
            const pts = activeTool === 'slice' ? slicePolyDraft : polyDraft;
            const col =
              activeTool === 'slice'
                ? activeSliceMode === 'floor'
                  ? '#E11D48'
                  : '#0284C7'
                : '#0D9488';
            const fillCol =
              activeTool === 'slice'
                ? activeSliceMode === 'floor'
                  ? 'rgba(225, 29, 72, 0.12)'
                  : 'rgba(2, 132, 199, 0.12)'
                : 'rgba(13, 148, 136, 0.12)';
            return (
              <g className="pointer-events-none">
                <polyline
                  points={[...pts, ...(hoverWorld ? [hoverWorld] : [])]
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill={fillCol}
                  stroke={col}
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                />
                {pts.map((p, idx) => (
                  <circle
                    key={idx}
                    cx={p.x}
                    cy={p.y}
                    r={idx === 0 && pts.length >= 3 ? 8 : 5}
                    fill={idx === 0 ? col : '#FFFFFF'}
                    stroke={col}
                    strokeWidth={2}
                  />
                ))}
              </g>
            );
          })()}

          {/* Live Secret Passage Draw Preview */}
          {activeTool === 'secret-passage' && secretDraft && (
            <g className="pointer-events-none">
              <polyline
                points={[
                  secretDraft.startAnchor,
                  secretDraft.startElbow,
                  ...secretDraft.midPoints,
                  ...(hoverWorld ? [hoverWorld] : []),
                ]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="none"
                stroke={secretColor}
                strokeWidth={2.5}
                strokeDasharray="6 4"
              />
              <circle
                cx={secretDraft.startAnchor.x}
                cy={secretDraft.startAnchor.y}
                r={8}
                fill={secretColor}
              />
              <circle
                cx={secretDraft.startElbow.x}
                cy={secretDraft.startElbow.y}
                r={4.5}
                fill="#FFFFFF"
                stroke={secretColor}
                strokeWidth={2}
              />
            </g>
          )}
        </g>
      </svg>

      {/* Contextual Floating Pop-up Trigger (Pen Icon) & Compact Accordion Pop Panel: Selected Room */}
      {activeTool === 'select' && selectedRoom && (() => {
        const connectedDoors = doc.doorways.filter(
          (d) => d.roomAId === selectedRoom.id || d.roomBId === selectedRoom.id
        );
        const connectedPassages = doc.secretPassages.filter(
          (sp) => sp.fromRoomId === selectedRoom.id || sp.toRoomId === selectedRoom.id
        );

        const isRoomSecret =
          connectedDoors.length > 0 || connectedPassages.length > 0
            ? connectedDoors.every(
                (d) => d.kind === 'secret' || d.kind === 'locked-secret'
              )
            : (selectedRoom.tags?.includes('secret') ?? false);

        const isRoomLocked =
          connectedDoors.length > 0
            ? connectedDoors.every(
                (d) => d.kind === 'locked' || d.kind === 'locked-secret'
              )
            : (selectedRoom.tags?.includes('locked') ?? false);

        const existingLinks = doc.stairLinks
          .map((st) => {
            const isFrom =
              st.fromFloorId === doc.activeFloorId && st.fromRoomId === selectedRoom.id;
            const isTo =
              st.toFloorId === doc.activeFloorId && st.toRoomId === selectedRoom.id;
            if (!isFrom && !isTo) return null;
            const targetFloorId = isFrom ? st.toFloorId : st.fromFloorId;
            const targetRoomId = isFrom ? st.toRoomId : st.fromRoomId;
            const targetFloor = doc.floors.find((f) => f.id === targetFloorId);
            const targetRoom = targetFloor?.rooms.find((r) => r.id === targetRoomId);
            return {
              link: st,
              targetFloorId,
              targetRoomId,
              display: targetRoom && targetFloor
                ? `${targetRoom.name} (${targetFloor.name})`
                : st.label,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const linkedTargetKeys = new Set(
          existingLinks.map((x) => `${x.targetFloorId}::${x.targetRoomId}`)
        );

        const otherFloorsSorted = [...doc.floors]
          .filter((fl) => fl.id !== doc.activeFloorId)
          .sort((a, b) => a.elevationOrder - b.elevationOrder);

        const stairCandidates = otherFloorsSorted.flatMap((fl) =>
          fl.rooms
            .filter(
              (r) => r.type === 'stairs' && !linkedTargetKeys.has(`${fl.id}::${r.id}`)
            )
            .map((r) => ({
              value: `${fl.id}::${r.id}`,
              floorId: fl.id,
              roomId: r.id,
              roomName: r.name,
              label: `${r.name} (${fl.name})`,
            }))
        );

        const fallbackCandidates =
          stairCandidates.length > 0
            ? stairCandidates
            : otherFloorsSorted.flatMap((fl) =>
                fl.rooms
                  .filter((r) => !linkedTargetKeys.has(`${fl.id}::${r.id}`))
                  .map((r) => ({
                    value: `${fl.id}::${r.id}`,
                    floorId: fl.id,
                    roomId: r.id,
                    roomName: r.name,
                    label: `${r.name} (${fl.name})`,
                  }))
              );

        const selectedTarget =
          fallbackCandidates.find((c) => c.value === linkTargetVal) ?? fallbackCandidates[0] ?? null;

        const customTextures = doc.customTextures ?? [];
        const activeCustomTex = selectedRoom.customTextureId
          ? customTextures.find((t) => t.id === selectedRoom.customTextureId)
          : undefined;
        const activeBuiltIn =
          MATERIAL_PALETTE[selectedRoom.floorMaterial] ?? MATERIAL_PALETTE.stone;
        const activeSwatch = darkTheme
          ? activeBuiltIn.darkFill
          : activeBuiltIn.lightFill;

        const handleTextureFileSelected = (file: File) => {
          const isImage =
            file.type.startsWith('image/') ||
            /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name);
          if (!isImage) {
            onToast?.('Please select a valid image file (PNG, JPG, WebP, or SVG).');
            return;
          }
          const cleanName =
            file.name
              .replace(/\.[^.]+$/, '')
              .replace(/[-_]+/g, ' ')
              .trim()
              .slice(0, 24) || 'Custom Texture';

          const reader = new FileReader();
          reader.onload = () => {
            const rawDataUrl =
              typeof reader.result === 'string' ? reader.result : '';
            if (!rawDataUrl) {
              onToast?.('Failed to read image file.');
              return;
            }
            const finishImport = (dataUrl: string) => {
              const newTex: CustomFloorTexture = {
                id: `tex-${Date.now()}`,
                name: cleanName,
                dataUrl,
                tileSize: Math.max(40, doc.grid.cellSize * 2),
              };
              onImportRoomCustomTexture(selectedRoom.id, newTex);
            };

            if (file.type === 'image/svg+xml') {
              finishImport(rawDataUrl);
              return;
            }
            const img = new window.Image();
            img.onload = () => {
              const maxDim = 512;
              if (Math.max(img.width, img.height) <= maxDim) {
                finishImport(rawDataUrl);
                return;
              }
              const scale = maxDim / Math.max(img.width, img.height);
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(img.width * scale));
              canvas.height = Math.max(1, Math.round(img.height * scale));
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                finishImport(rawDataUrl);
                return;
              }
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              finishImport(canvas.toDataURL('image/png'));
            };
            img.onerror = () => onToast?.('Could not decode selected image.');
            img.src = rawDataUrl;
          };
          reader.onerror = () => onToast?.('Failed to read image file.');
          reader.readAsDataURL(file);
        };

        const toggleSection = (section: 'state' | 'links' | 'texture') => {
          setRoomPanelSection((curr) => (curr === section ? null : section));
        };

        return (
          <div
            data-canvas-ui="true"
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 max-w-[94%] pointer-events-none"
          >
            {!inspectorOpen ? (
              <div className="kc-popover-in pointer-events-auto flex items-center gap-0.5 p-0.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-lg">
                <button
                  type="button"
                  onClick={() => setInspectorOpen(true)}
                  aria-expanded={false}
                  title={`Edit ${selectedRoom.name}`}
                  aria-label={`Open edit panel for ${selectedRoom.name}`}
                  className="min-h-[30px] px-2 flex items-center gap-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-white/10 text-xs font-semibold text-stone-800 dark:text-stone-100 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span className="max-w-[160px] truncate">{selectedRoom.name}</span>
                </button>
                <div className="w-px h-4 bg-[#E5E0D5] dark:bg-[#2E313A] mx-0.5" aria-hidden="true" />
                <div className="flex items-center shrink-0">
                  <button
                    type="button"
                    onClick={() => onDeleteRoom(selectedRoom.id)}
                    title="Delete selected room"
                    aria-label="Delete room"
                    className="relative z-10 w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <span
                    className="kc-node-del-slot"
                    data-open={
                      selectedVertexIndex !== null && selectedRoom.points.length > 3
                        ? 'true'
                        : 'false'
                    }
                  >
                    <button
                      type="button"
                      disabled={
                        !(selectedVertexIndex !== null && selectedRoom.points.length > 3)
                      }
                      tabIndex={
                        selectedVertexIndex !== null && selectedRoom.points.length > 3
                          ? 0
                          : -1
                      }
                      aria-hidden={
                        !(selectedVertexIndex !== null && selectedRoom.points.length > 3)
                      }
                      onClick={() => {
                        if (
                          selectedVertexIndex !== null &&
                          selectedRoom.points.length > 3
                        ) {
                          onDeleteRoomVertex(selectedRoom.id, selectedVertexIndex);
                          setSelectedVertexIndex(null);
                        }
                      }}
                      title={
                        selectedVertexIndex !== null
                          ? `Delete Node ${selectedVertexIndex + 1}`
                          : 'Delete Node'
                      }
                      aria-label={
                        selectedVertexIndex !== null
                          ? `Delete Node ${selectedVertexIndex + 1}`
                          : 'Delete Node'
                      }
                      className="kc-node-del-btn w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50"
                    >
                      <DeleteNodeIcon className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              </div>
            ) : (
              <div className="kc-popover-in pointer-events-auto w-[280px] sm:w-[304px] rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-xl p-2 flex flex-col gap-2 text-xs">
                {/* Compact Header: Editable Room Name + Delete + Delete Node + Collapse */}
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={roomNameDraft}
                    onChange={(e) => setRoomNameDraft(e.target.value)}
                    onBlur={() => {
                      const trimmed = roomNameDraft.trim();
                      if (trimmed && trimmed !== selectedRoom.name) {
                        onRenameRoom(selectedRoom.id, trimmed);
                      } else {
                        setRoomNameDraft(selectedRoom.name);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      } else if (e.key === 'Escape') {
                        setRoomNameDraft(selectedRoom.name);
                        e.currentTarget.blur();
                      }
                    }}
                    aria-label="Room name"
                    placeholder="Room name"
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] focus:border-teal-600 dark:focus:border-teal-500 font-display font-semibold text-xs text-stone-900 dark:text-white focus:outline-none transition-colors"
                  />
                  <div className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={() => onDeleteRoom(selectedRoom.id)}
                      title="Delete selected room"
                      aria-label="Delete room"
                      className="relative z-10 w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span
                      className="kc-node-del-slot kc-node-del-slot--sm"
                      data-open={
                        selectedVertexIndex !== null && selectedRoom.points.length > 3
                          ? 'true'
                          : 'false'
                      }
                    >
                      <button
                        type="button"
                        disabled={
                          !(selectedVertexIndex !== null && selectedRoom.points.length > 3)
                        }
                        tabIndex={
                          selectedVertexIndex !== null && selectedRoom.points.length > 3
                            ? 0
                            : -1
                        }
                        aria-hidden={
                          !(selectedVertexIndex !== null && selectedRoom.points.length > 3)
                        }
                        onClick={() => {
                          if (
                            selectedVertexIndex !== null &&
                            selectedRoom.points.length > 3
                          ) {
                            onDeleteRoomVertex(selectedRoom.id, selectedVertexIndex);
                            setSelectedVertexIndex(null);
                          }
                        }}
                        title={
                          selectedVertexIndex !== null
                            ? `Delete Node ${selectedVertexIndex + 1}`
                            : 'Delete Node'
                        }
                        aria-label={
                          selectedVertexIndex !== null
                            ? `Delete Node ${selectedVertexIndex + 1}`
                            : 'Delete Node'
                        }
                        className="kc-node-del-btn w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50"
                      >
                        <DeleteNodeIcon className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInspectorOpen(false);
                      setRoomPanelSection(null);
                    }}
                    title="Collapse edit panel"
                    aria-label="Close edit panel"
                    className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-stone-500 hover:text-stone-800 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Mutually-Exclusive Expanding Container Triggers */}
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => toggleSection('state')}
                    aria-expanded={roomPanelSection === 'state'}
                    className={`min-h-[30px] px-2 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                      roomPanelSection === 'state'
                        ? 'bg-teal-700 dark:bg-teal-600 border-teal-700 dark:border-teal-600 text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                    }`}
                  >
                    {isRoomLocked ? (
                      <Lock className="w-3 h-3 shrink-0" />
                    ) : isRoomSecret ? (
                      <EyeOff className="w-3 h-3 shrink-0" />
                    ) : (
                      <BoxSelect className="w-3 h-3 shrink-0" />
                    )}
                    <span>State</span>
                    <ChevronDown
                      className={`w-3 h-3 opacity-75 transition-transform duration-150 ${
                        roomPanelSection === 'state' ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSection('links')}
                    aria-expanded={roomPanelSection === 'links'}
                    className={`min-h-[30px] px-2 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                      roomPanelSection === 'links'
                        ? 'bg-teal-700 dark:bg-teal-600 border-teal-700 dark:border-teal-600 text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                    }`}
                  >
                    <ArrowUpDown className="w-3 h-3 shrink-0" />
                    <span>{existingLinks.length > 0 ? `Link (${existingLinks.length})` : 'Link'}</span>
                    <ChevronDown
                      className={`w-3 h-3 opacity-75 transition-transform duration-150 ${
                        roomPanelSection === 'links' ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSection('texture')}
                    aria-expanded={roomPanelSection === 'texture'}
                    className={`min-h-[30px] px-2 rounded-lg border text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                      roomPanelSection === 'texture'
                        ? 'bg-teal-700 dark:bg-teal-600 border-teal-700 dark:border-teal-600 text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                    }`}
                  >
                    {activeCustomTex ? (
                      <img
                        src={activeCustomTex.dataUrl}
                        alt=""
                        className="w-3 h-3 rounded-sm object-cover border border-black/15 shrink-0"
                      />
                    ) : (
                      <span
                        className="w-3 h-3 rounded-sm border border-black/20 shrink-0"
                        style={{ backgroundColor: activeSwatch }}
                      />
                    )}
                    <span>Texture</span>
                    <ChevronDown
                      className={`w-3 h-3 opacity-75 transition-transform duration-150 ${
                        roomPanelSection === 'texture' ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>

                {/* Expanding Container: State */}
                {roomPanelSection === 'state' && (
                  <div className="pt-1.5 border-t border-[#E5E0D5] dark:border-[#2E313A] grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      onClick={() => onToggleRoomTagSetting(selectedRoom.id, 'secret')}
                      aria-pressed={isRoomSecret}
                      title="Toggle secret state on connected doors"
                      className={`min-h-[30px] px-2 rounded-lg font-semibold whitespace-nowrap border flex items-center justify-center gap-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                        isRoomSecret
                          ? 'bg-amber-600 border-amber-600 text-white'
                          : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                      }`}
                    >
                      {isRoomSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>Secret</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleRoomTagSetting(selectedRoom.id, 'locked')}
                      aria-pressed={isRoomLocked}
                      title="Toggle locked state on connected doors"
                      className={`min-h-[30px] px-2 rounded-lg font-semibold whitespace-nowrap border flex items-center justify-center gap-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                        isRoomLocked
                          ? 'bg-rose-600 border-rose-600 text-white'
                          : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                      }`}
                    >
                      {isRoomLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      <span>Locked</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleRoomUnwalled(selectedRoom.id)}
                      aria-pressed={Boolean(selectedRoom.unwalled)}
                      title="Remove perimeter walls from this room only (keeps adjacent rooms' walls)"
                      className={`min-h-[30px] px-2 rounded-lg font-semibold whitespace-nowrap border flex items-center justify-center gap-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                        selectedRoom.unwalled
                          ? 'bg-teal-700 dark:bg-teal-600 border-teal-700 dark:border-teal-600 text-white'
                          : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                      }`}
                    >
                      <BoxSelect className="w-3 h-3" />
                      <span>Unwalled</span>
                    </button>
                  </div>
                )}

                {/* Expanding Container: Floor Link Choice Selection */}
                {roomPanelSection === 'links' && (
                  <div className="pt-1.5 border-t border-[#E5E0D5] dark:border-[#2E313A] flex flex-col gap-1.5">
                    {existingLinks.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {existingLinks.map((item) => (
                          <span
                            key={item.link.id}
                            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800/70 text-teal-800 dark:text-teal-200 text-[11px] font-medium"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                onJumpToFloorAndRoom?.(item.targetFloorId, item.targetRoomId)
                              }
                              className="hover:underline focus-visible:outline-none truncate max-w-[180px]"
                              title={`Go to ${item.display}`}
                            >
                              {item.display}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteStairLink(item.link.id)}
                              className="p-0.5 rounded hover:bg-teal-200/70 dark:hover:bg-teal-800/70 text-teal-700 dark:text-teal-300 transition-colors"
                              aria-label={`Unlink ${item.display}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {doc.floors.length <= 1 ? (
                      <span className="text-[11px] text-stone-400 dark:text-stone-500 py-0.5">
                        Add another floor to link stairways between levels.
                      </span>
                    ) : selectedTarget ? (
                      <div className="flex items-center gap-1">
                        <select
                          aria-label="Link to stairway on another floor"
                          value={selectedTarget.value}
                          onChange={(e) => setLinkTargetVal(e.target.value)}
                          className="flex-1 min-w-0 min-h-[30px] px-2 rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-800 dark:text-stone-100 text-[11px] focus:outline-none focus:ring-2 focus:ring-teal-600"
                        >
                          {fallbackCandidates.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            onCreateStairLink({
                              fromFloorId: doc.activeFloorId,
                              fromRoomId: selectedRoom.id,
                              toFloorId: selectedTarget.floorId,
                              toRoomId: selectedTarget.roomId,
                              kind: 'stairs',
                              label: `${selectedRoom.name} ↔ ${selectedTarget.roomName}`,
                            });
                            setLinkTargetVal('');
                          }}
                          className="min-h-[30px] px-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-[11px] font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
                        >
                          Link
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-stone-400 dark:text-stone-500 py-0.5">
                        {existingLinks.length > 0 ? 'All other-floor rooms linked' : 'No rooms on other floors'}
                      </span>
                    )}
                  </div>
                )}

                {/* Expanding Container: Floor Texture & Custom Importer */}
                {roomPanelSection === 'texture' && (
                  <div className="pt-1.5 border-t border-[#E5E0D5] dark:border-[#2E313A] flex flex-col gap-2">
                    <input
                      ref={textureFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleTextureFileSelected(file);
                          e.target.value = '';
                        }
                      }}
                    />

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-stone-600 dark:text-stone-300 flex items-center gap-1">
                        <ImageIcon className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                        <span>Materials</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => textureFileInputRef.current?.click()}
                        className="min-h-[26px] px-2 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
                      >
                        <Upload className="w-3 h-3" />
                        <span>Import Image</span>
                      </button>
                    </div>

                    {!activeCustomTex &&
                      !selectedRoom.customColor &&
                      (selectedRoom.floorMaterial === 'staircase' ||
                        selectedRoom.floorMaterial === 'stairway' ||
                        selectedRoom.type === 'stairs') && (
                        <button
                          type="button"
                          onClick={() => onToggleRoomRotateStairTexture(selectedRoom.id)}
                          aria-pressed={selectedRoom.rotateStairTexture !== false}
                          title="Rotate staircase texture along with room rotation"
                          className={`min-h-[30px] px-2.5 rounded-lg border text-[11px] font-semibold flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                            selectedRoom.rotateStairTexture !== false
                              ? 'bg-teal-50/80 dark:bg-teal-950/50 border-teal-600 text-teal-900 dark:text-teal-200'
                              : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            <RotateCw className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">Rotate stairs with room</span>
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0 ${
                              selectedRoom.rotateStairTexture !== false
                                ? 'bg-teal-700 dark:bg-teal-600 text-white'
                                : 'bg-stone-200 dark:bg-[#2C303A] text-stone-600 dark:text-stone-300'
                            }`}
                          >
                            {selectedRoom.rotateStairTexture !== false ? 'On' : 'Off'}
                          </span>
                        </button>
                      )}

                    <div className="grid grid-cols-2 gap-1 max-h-40 overflow-y-auto kc-scroll pr-0.5">
                      {(Object.keys(MATERIAL_PALETTE) as FloorMaterial[]).map((matKey) => {
                        const mat = MATERIAL_PALETTE[matKey];
                        const isSelectedMat =
                          !activeCustomTex && selectedRoom.floorMaterial === matKey;
                        const swatch = darkTheme ? mat.darkFill : mat.lightFill;
                        const accent = darkTheme
                          ? mat.secondaryDark
                          : mat.secondaryLight;
                        return (
                          <button
                            key={matKey}
                            type="button"
                            onClick={() => {
                              onSetRoomFloorMaterial(selectedRoom.id, matKey);
                            }}
                            className={`min-h-[30px] px-2 py-1 rounded-lg border text-left text-[11px] font-medium flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                              isSelectedMat
                                ? 'bg-teal-50/80 dark:bg-teal-950/50 border-teal-600 text-teal-900 dark:text-teal-200 font-semibold'
                                : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                            }`}
                          >
                            <span
                              className="w-3.5 h-3.5 rounded border border-black/20 shrink-0"
                              style={{
                                background: `linear-gradient(135deg, ${swatch} 55%, ${accent} 55%)`,
                              }}
                            />
                            <span className="truncate flex-1">{mat.label}</span>
                            {isSelectedMat && (
                              <Check className="w-3 h-3 text-teal-700 dark:text-teal-400 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {customTextures.length > 0 && (
                      <div className="border-t border-[#E5E0D5] dark:border-[#2E313A] pt-1.5 flex flex-col gap-1">
                        <span className="text-[10px] font-semibold text-stone-500 dark:text-stone-400">
                          Imported
                        </span>
                        <div className="flex flex-col gap-1 max-h-28 overflow-y-auto kc-scroll pr-0.5">
                          {customTextures.map((tex) => {
                            const isActiveCustom = selectedRoom.customTextureId === tex.id;
                            return (
                              <div
                                key={tex.id}
                                className={`flex items-center gap-1.5 p-1 rounded-lg border transition-colors ${
                                  isActiveCustom
                                    ? 'bg-teal-50/80 dark:bg-teal-950/50 border-teal-600'
                                    : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026]'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    onApplyRoomCustomTexture(selectedRoom.id, tex.id)
                                  }
                                  className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
                                >
                                  <img
                                    src={tex.dataUrl}
                                    alt={tex.name}
                                    className="w-5 h-5 rounded object-cover border border-black/15 shrink-0"
                                  />
                                  <span className="text-[11px] font-medium text-stone-800 dark:text-stone-100 truncate">
                                    {tex.name}
                                  </span>
                                </button>
                                <div className="flex items-center gap-1 shrink-0">
                                  <div className="flex items-center rounded-md border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#18191D] overflow-hidden">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateCustomTextureTileSize(
                                          tex.id,
                                          tex.tileSize - 20
                                        )
                                      }
                                      title="Decrease tile size"
                                      className="w-5 h-5 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
                                    >
                                      <Minus className="w-2.5 h-2.5" />
                                    </button>
                                    <span
                                      className="text-[10px] font-mono-tabular text-stone-700 dark:text-stone-200 w-7 text-center"
                                      title="Pattern tile size in pixels"
                                    >
                                      {tex.tileSize}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateCustomTextureTileSize(
                                          tex.id,
                                          tex.tileSize + 20
                                        )
                                      }
                                      title="Increase tile size"
                                      className="w-5 h-5 flex items-center justify-center text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
                                    >
                                      <Plus className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => onDeleteCustomTexture(tex.id)}
                                    title="Remove imported texture"
                                    aria-label={`Remove ${tex.name}`}
                                    className="w-5 h-5 rounded-md flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Contextual Floating Pop-up Trigger & Compact Panel: Selected Slice */}
      {activeTool === 'select' && selectedSlice && (
        <div
          data-canvas-ui="true"
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 max-w-[94%] pointer-events-none"
        >
          {!inspectorOpen ? (
            <div className="kc-popover-in pointer-events-auto flex items-center gap-0.5 p-0.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-lg">
              <button
                type="button"
                onClick={() => setInspectorOpen(true)}
                aria-expanded={false}
                title={`Edit ${selectedSlice.mode === 'floor' ? 'Closed Cutout' : 'Open Cutout'}`}
                aria-label="Open edit panel for cutout"
                className="min-h-[30px] px-2 flex items-center gap-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-white/10 text-xs font-semibold text-stone-800 dark:text-stone-100 transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                <span>{selectedSlice.mode === 'floor' ? 'Closed Cutout' : 'Open Cutout'}</span>
              </button>
              <div className="w-px h-4 bg-[#E5E0D5] dark:bg-[#2E313A] mx-0.5" aria-hidden="true" />
              <div className="flex items-center shrink-0">
                <button
                  type="button"
                  onClick={() => onDeleteSlice(selectedSlice.id)}
                  title="Delete cutout"
                  aria-label="Delete cutout"
                  className="relative z-10 w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <span
                  className="kc-node-del-slot"
                  data-open={
                    selectedSliceVertexIndex !== null && selectedSlice.points.length > 3
                      ? 'true'
                      : 'false'
                  }
                >
                  <button
                    type="button"
                    disabled={
                      !(selectedSliceVertexIndex !== null && selectedSlice.points.length > 3)
                    }
                    tabIndex={
                      selectedSliceVertexIndex !== null && selectedSlice.points.length > 3
                        ? 0
                        : -1
                    }
                    aria-hidden={
                      !(selectedSliceVertexIndex !== null && selectedSlice.points.length > 3)
                    }
                    onClick={() => {
                      if (
                        selectedSliceVertexIndex !== null &&
                        selectedSlice.points.length > 3
                      ) {
                        onDeleteSliceVertex(selectedSlice.id, selectedSliceVertexIndex);
                        setSelectedSliceVertexIndex(null);
                      }
                    }}
                    title={
                      selectedSliceVertexIndex !== null
                        ? `Delete Cutout Node ${selectedSliceVertexIndex + 1}`
                        : 'Delete Cutout Node'
                    }
                    aria-label={
                      selectedSliceVertexIndex !== null
                        ? `Delete Cutout Node ${selectedSliceVertexIndex + 1}`
                        : 'Delete Cutout Node'
                    }
                    className="kc-node-del-btn w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50"
                  >
                    <DeleteNodeIcon className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            </div>
          ) : (
            <div className="kc-popover-in pointer-events-auto w-[256px] sm:w-[276px] rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-xl p-2 flex flex-col gap-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display font-semibold text-stone-900 dark:text-white flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" />
                  <span>{selectedSlice.mode === 'floor' ? 'Closed Cutout' : 'Open Cutout'}</span>
                </span>
                <div className="flex items-center gap-1">
                  <div className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={() => onDeleteSlice(selectedSlice.id)}
                      className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                      aria-label="Delete cutout"
                      title="Delete cutout"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <span
                      className="kc-node-del-slot kc-node-del-slot--sm"
                      data-open={
                        selectedSliceVertexIndex !== null && selectedSlice.points.length > 3
                          ? 'true'
                          : 'false'
                      }
                    >
                      <button
                        type="button"
                        disabled={
                          !(selectedSliceVertexIndex !== null && selectedSlice.points.length > 3)
                        }
                        tabIndex={
                          selectedSliceVertexIndex !== null && selectedSlice.points.length > 3
                            ? 0
                            : -1
                        }
                        aria-hidden={
                          !(selectedSliceVertexIndex !== null && selectedSlice.points.length > 3)
                        }
                        onClick={() => {
                          if (
                            selectedSliceVertexIndex !== null &&
                            selectedSlice.points.length > 3
                          ) {
                            onDeleteSliceVertex(selectedSlice.id, selectedSliceVertexIndex);
                            setSelectedSliceVertexIndex(null);
                          }
                        }}
                        title={
                          selectedSliceVertexIndex !== null
                            ? `Delete Cutout Node ${selectedSliceVertexIndex + 1}`
                            : 'Delete Cutout Node'
                        }
                        aria-label={
                          selectedSliceVertexIndex !== null
                            ? `Delete Cutout Node ${selectedSliceVertexIndex + 1}`
                            : 'Delete Cutout Node'
                        }
                        className="kc-node-del-btn w-7 h-7 flex items-center justify-center rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50"
                      >
                        <DeleteNodeIcon className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectorOpen(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-800 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
                    aria-label="Close cutout panel"
                    title="Collapse edit panel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1 rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] p-0.5">
                <button
                  type="button"
                  onClick={() => onUpdateSlice(selectedSlice.id, { mode: 'wall' })}
                  aria-pressed={selectedSlice.mode === 'wall'}
                  className={`min-h-[28px] px-2 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    selectedSlice.mode === 'wall'
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
                  }`}
                  title="Cuts away walls inside polygon while preserving open floor"
                >
                  Open Cutout
                </button>
                <button
                  type="button"
                  onClick={() => onUpdateSlice(selectedSlice.id, { mode: 'floor' })}
                  aria-pressed={selectedSlice.mode === 'floor'}
                  className={`min-h-[28px] px-2 rounded-md text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    selectedSlice.mode === 'floor'
                      ? 'bg-rose-600 text-white shadow-2xs'
                      : 'text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
                  }`}
                  title="Cuts both walls and floors into empty void, enclosed in walls"
                >
                  Closed Cutout
                </button>
              </div>

              {accessibility.blockingSliceIds?.has(selectedSlice.id) && (
                <div className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-semibold px-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Blocks path to rooms</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Contextual Floating Pop-up Trigger (Pen Icon) & Compact Panel: Selected Doorway */}
      {activeTool === 'select' && selectedDoor && (() => {
        const doorKind: DoorKind = selectedDoor.kind ?? 'normal';
        const isHidden = doorKind === 'secret' || doorKind === 'locked-secret';
        const isLocked = doorKind === 'locked' || doorKind === 'locked-secret';
        const doorTitle = !selectedDoor.enabled
          ? 'Disabled Door'
          : isHidden && isLocked
            ? 'Locked Secret Door'
            : isHidden
              ? 'Secret Door'
              : isLocked
                ? 'Locked Door'
                : 'Doorway';

        const toggleHidden = () => {
          const nextHidden = !isHidden;
          const nextKind: DoorKind = nextHidden
            ? isLocked
              ? 'locked-secret'
              : 'secret'
            : isLocked
              ? 'locked'
              : 'normal';
          onUpdateDoorway(selectedDoor.id, {
            kind: nextKind,
            dcInvestigation: nextHidden ? (selectedDoor.dcInvestigation ?? 15) : undefined,
          });
        };

        const toggleLocked = () => {
          const nextLocked = !isLocked;
          const nextKind: DoorKind = isHidden
            ? nextLocked
              ? 'locked-secret'
              : 'secret'
            : nextLocked
              ? 'locked'
              : 'normal';
          onUpdateDoorway(selectedDoor.id, {
            kind: nextKind,
            dcLockpick: nextLocked ? (selectedDoor.dcLockpick ?? 15) : undefined,
          });
        };

        return (
          <div
            data-canvas-ui="true"
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 max-w-[94%] pointer-events-none"
          >
            {!inspectorOpen ? (
              <div className="kc-popover-in pointer-events-auto flex items-center gap-0.5 p-0.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-lg">
                <button
                  type="button"
                  onClick={() => setInspectorOpen(true)}
                  aria-expanded={false}
                  title={`Edit ${doorTitle}`}
                  aria-label={`Open edit panel for ${doorTitle}`}
                  className="min-h-[30px] px-2 flex items-center gap-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-white/10 text-xs font-semibold text-stone-800 dark:text-stone-100 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span>{doorTitle}</span>
                </button>
                <div className="w-px h-4 bg-[#E5E0D5] dark:bg-[#2E313A] mx-0.5" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => onDeleteDoorway(selectedDoor.id)}
                  title="Delete doorway"
                  aria-label="Delete doorway"
                  className="w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="kc-popover-in pointer-events-auto w-[264px] sm:w-[280px] rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-xl p-2 flex flex-col gap-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-semibold text-stone-900 dark:text-white flex items-center gap-1.5">
                    <DoorOpen className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
                    <span>{doorTitle}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onDeleteDoorway(selectedDoor.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
                      aria-label="Delete doorway"
                      title="Delete doorway"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectorOpen(false)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-stone-500 hover:text-stone-800 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
                      aria-label="Close doorway panel"
                      title="Collapse edit panel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={toggleHidden}
                    aria-pressed={isHidden}
                    className={`min-h-[30px] px-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap border flex items-center justify-center gap-1 transition-colors ${
                      isHidden
                        ? 'bg-amber-600 border-amber-600 text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                    }`}
                  >
                    {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{isHidden ? 'Hidden' : 'Normal'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={toggleLocked}
                    aria-pressed={isLocked}
                    className={`min-h-[30px] px-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap border flex items-center justify-center gap-1 transition-colors ${
                      isLocked
                        ? 'bg-rose-600 border-rose-600 text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
                    }`}
                  >
                    {isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    <span>{isLocked ? 'Locked' : 'Unlock'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleDoorway(selectedDoor.id)}
                    aria-pressed={selectedDoor.enabled}
                    className={`min-h-[30px] px-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap border flex items-center justify-center gap-1 transition-colors ${
                      selectedDoor.enabled
                        ? 'bg-teal-700 dark:bg-teal-600 border-teal-700 dark:border-teal-600 text-white'
                        : 'bg-stone-200 dark:bg-[#262931] border-[#E5E0D5] dark:border-[#2E313A] text-stone-800 dark:text-stone-100'
                    }`}
                  >
                    {selectedDoor.enabled ? (
                      <CheckCircle2 className="w-3 h-3" />
                    ) : (
                      <Ban className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                    )}
                    <span>{selectedDoor.enabled ? 'Open' : 'Off'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Contextual Floating Bar: Slice Tool Mode & Shape Selector */}
      {activeTool === 'slice' && (
        <div
          data-canvas-ui="true"
          onMouseDown={(e) => e.stopPropagation()}
          className="kc-popover-in absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-xl text-xs max-w-[94%]"
        >
          <Scissors className="w-3.5 h-3.5 text-stone-500 dark:text-stone-400" aria-hidden="true" />
          <div className="flex items-center rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => onChangeActiveSliceMode('wall')}
              aria-pressed={activeSliceMode === 'wall'}
              className={`min-h-[28px] px-2.5 rounded-md font-semibold whitespace-nowrap transition-colors ${
                activeSliceMode === 'wall'
                  ? 'bg-sky-600 text-white shadow-2xs'
                  : 'text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
              }`}
              title="Removes room walls inside the polygon while leaving floors open"
            >
              Open Cutout
            </button>
            <button
              type="button"
              onClick={() => onChangeActiveSliceMode('floor')}
              aria-pressed={activeSliceMode === 'floor'}
              className={`min-h-[28px] px-2.5 rounded-md font-semibold whitespace-nowrap transition-colors ${
                activeSliceMode === 'floor'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
              }`}
              title="Cuts walls & floors into deadspace and encloses perimeter in walls"
            >
              Closed Cutout
            </button>
          </div>

          <div className="w-px h-4 bg-[#E5E0D5] dark:bg-[#2E313A]" aria-hidden="true" />

          <div className="flex items-center rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] p-0.5 gap-0.5">
            <button
              type="button"
              onClick={() => {
                setSliceShapeMode('rect');
                setSlicePolyDraft([]);
              }}
              aria-pressed={sliceShapeMode === 'rect'}
              className={`min-h-[28px] px-2.5 rounded-md font-semibold whitespace-nowrap flex items-center gap-1 transition-colors ${
                sliceShapeMode === 'rect'
                  ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-2xs'
                  : 'text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
              }`}
            >
              <Square className="w-3 h-3" />
              <span>Rect</span>
            </button>
            <button
              type="button"
              onClick={() => setSliceShapeMode('polygon')}
              aria-pressed={sliceShapeMode === 'polygon'}
              className={`min-h-[28px] px-2.5 rounded-md font-semibold whitespace-nowrap flex items-center gap-1 transition-colors ${
                sliceShapeMode === 'polygon'
                  ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-2xs'
                  : 'text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5'
              }`}
            >
              <Pentagon className="w-3 h-3" />
              <span>Polygon</span>
            </button>
          </div>

          {sliceShapeMode === 'polygon' && (
            <>
              <span className="font-mono-tabular text-[11px] font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap ml-0.5">
                {slicePolyDraft.length === 0
                  ? 'Tap corners'
                  : `${slicePolyDraft.length} pts`}
              </span>
              {slicePolyDraft.length >= 3 && (
                <button
                  type="button"
                  onClick={() => finalizeSlicePolygon(slicePolyDraft)}
                  className="min-h-[28px] px-2.5 flex items-center gap-1 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white font-semibold whitespace-nowrap transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Close Shape</span>
                </button>
              )}
              {slicePolyDraft.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSlicePolyDraft([])}
                  className="min-h-[28px] px-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
                  aria-label="Cancel cutout polygon"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Contextual Floating Bar: Doorway Tool Variant Selector */}
      {activeTool === 'doorway' && (() => {
        const isPlaceHidden =
          activeDoorKind === 'secret' || activeDoorKind === 'locked-secret';
        const isPlaceLocked =
          activeDoorKind === 'locked' || activeDoorKind === 'locked-secret';

        const togglePlaceHidden = () => {
          const nextHidden = !isPlaceHidden;
          onChangeActiveDoorKind(
            nextHidden
              ? isPlaceLocked
                ? 'locked-secret'
                : 'secret'
              : isPlaceLocked
                ? 'locked'
                : 'normal'
          );
        };

        const togglePlaceLocked = () => {
          const nextLocked = !isPlaceLocked;
          onChangeActiveDoorKind(
            isPlaceHidden
              ? nextLocked
                ? 'locked-secret'
                : 'secret'
              : nextLocked
                ? 'locked'
                : 'normal'
          );
        };

        return (
          <div
            data-canvas-ui="true"
            onMouseDown={(e) => e.stopPropagation()}
            className="kc-popover-in absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-2 px-3 py-1.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-xl text-xs max-w-[92%]"
          >
            <span className="font-semibold text-stone-500 dark:text-stone-400 whitespace-nowrap">
              Place:
            </span>
            <button
              type="button"
              onClick={togglePlaceHidden}
              aria-pressed={isPlaceHidden}
              className={`min-h-[30px] px-2.5 rounded-lg font-semibold whitespace-nowrap border flex items-center gap-1.5 transition-colors ${
                isPlaceHidden
                  ? 'bg-amber-600 border-amber-600 text-white'
                  : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
              }`}
            >
              {isPlaceHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              <span>{isPlaceHidden ? 'Hidden' : 'Normal'}</span>
            </button>
            <button
              type="button"
              onClick={togglePlaceLocked}
              aria-pressed={isPlaceLocked}
              className={`min-h-[30px] px-2.5 rounded-lg font-semibold whitespace-nowrap border flex items-center gap-1.5 transition-colors ${
                isPlaceLocked
                  ? 'bg-rose-600 border-rose-600 text-white'
                  : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-[#262931]'
              }`}
            >
              {isPlaceLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              <span>{isPlaceLocked ? 'Locked' : 'Unlocked'}</span>
            </button>
          </div>
        );
      })()}

      {/* Contextual Floating Bar: Selected Secret Passage */}
      {activeTool === 'select' && selectedSecretPassage && (
        <div
          data-canvas-ui="true"
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 max-w-[94%] pointer-events-none"
        >
          <div className="kc-popover-in pointer-events-auto flex items-center gap-0.5 p-0.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-amber-300 dark:border-amber-700/80 shadow-lg">
            {editingSecretPassageId === selectedSecretPassage.id ? (
              <div className="min-h-[30px] px-1.5 flex items-center gap-1.5">
                <EyeOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <input
                  type="text"
                  value={secretLabelDraft}
                  autoFocus
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setSecretLabelDraft(e.target.value)}
                  onBlur={() => commitSecretLabelRename(selectedSecretPassage)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    } else if (e.key === 'Escape') {
                      setSecretLabelDraft(selectedSecretPassage.label);
                      setEditingSecretPassageId(null);
                    }
                  }}
                  aria-label="Secret passage name"
                  placeholder="secret passage"
                  className="w-32 sm:w-40 px-1.5 py-0.5 rounded-md bg-[#FAF9F6] dark:bg-[#1E2026] border border-amber-400 dark:border-amber-600 text-xs font-semibold text-stone-900 dark:text-white focus:outline-none"
                />
              </div>
            ) : (
              <button
                type="button"
                onDoubleClick={() => {
                  setEditingSecretPassageId(selectedSecretPassage.id);
                  setSecretLabelDraft(selectedSecretPassage.label);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'F2' || e.key === 'Enter') {
                    e.preventDefault();
                    setEditingSecretPassageId(selectedSecretPassage.id);
                    setSecretLabelDraft(selectedSecretPassage.label);
                  }
                }}
                title="Double-click to rename"
                aria-label={`${selectedSecretPassage.label} — double-click to rename`}
                className="min-h-[30px] px-2 flex items-center gap-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-white/10 text-xs font-semibold text-stone-800 dark:text-stone-100 transition-colors cursor-text"
              >
                <EyeOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="max-w-[160px] truncate">{selectedSecretPassage.label}</span>
              </button>
            )}
            <div className="w-px h-4 bg-amber-200 dark:bg-amber-800/70 mx-0.5" aria-hidden="true" />
            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => onDeleteSecretPassage(selectedSecretPassage.id)}
                title="Delete secret passage"
                aria-label="Delete secret passage"
                className="relative z-10 w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <span
                className="kc-node-del-slot"
                data-open={
                  selectedSecretMidIndex !== null &&
                  selectedSecretMidIndex >= 0 &&
                  selectedSecretMidIndex < selectedSecretPassage.midPoints.length
                    ? 'true'
                    : 'false'
                }
              >
                <button
                  type="button"
                  disabled={
                    !(
                      selectedSecretMidIndex !== null &&
                      selectedSecretMidIndex >= 0 &&
                      selectedSecretMidIndex < selectedSecretPassage.midPoints.length
                    )
                  }
                  tabIndex={
                    selectedSecretMidIndex !== null &&
                    selectedSecretMidIndex >= 0 &&
                    selectedSecretMidIndex < selectedSecretPassage.midPoints.length
                      ? 0
                      : -1
                  }
                  aria-hidden={
                    !(
                      selectedSecretMidIndex !== null &&
                      selectedSecretMidIndex >= 0 &&
                      selectedSecretMidIndex < selectedSecretPassage.midPoints.length
                    )
                  }
                  onClick={() => {
                    if (
                      selectedSecretMidIndex !== null &&
                      selectedSecretMidIndex >= 0 &&
                      selectedSecretMidIndex < selectedSecretPassage.midPoints.length
                    ) {
                      handleDeleteSecretPassageMidNode(
                        selectedSecretPassage.id,
                        selectedSecretMidIndex
                      );
                    }
                  }}
                  title={
                    selectedSecretMidIndex !== null
                      ? `Delete Node ${selectedSecretMidIndex + 1}`
                      : 'Delete Node'
                  }
                  aria-label={
                    selectedSecretMidIndex !== null
                      ? `Delete Node ${selectedSecretMidIndex + 1}`
                      : 'Delete Node'
                  }
                  className="kc-node-del-btn w-[30px] h-[30px] shrink-0 rounded-lg flex items-center justify-center text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/50"
                >
                  <DeleteNodeIcon className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Contextual Floating Action Bar for Polygon / Secret Passage Drawing */}
      {activeTool === 'polygon' && (
        <div
          data-canvas-ui="true"
          onMouseDown={(e) => e.stopPropagation()}
          className="kc-popover-in absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-[#E5E0D5] dark:border-[#2E313A] shadow-xl text-xs"
        >
          <span className="font-medium text-stone-700 dark:text-stone-200 whitespace-nowrap">
            {polyDraft.length === 0
              ? 'Tap canvas to place corners'
              : `${polyDraft.length} corners placed`}
          </span>
          {polyDraft.length >= 3 && (
            <button
              type="button"
              onClick={() => finalizePolygon(polyDraft)}
              className="min-h-[30px] px-2.5 flex items-center gap-1 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white font-semibold whitespace-nowrap transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Close Shape</span>
            </button>
          )}
          {polyDraft.length > 0 && (
            <button
              type="button"
              onClick={() => setPolyDraft([])}
              className="min-h-[30px] px-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
              aria-label="Cancel polygon"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {activeTool === 'secret-passage' && (
        <div
          data-canvas-ui="true"
          onMouseDown={(e) => e.stopPropagation()}
          className="kc-popover-in absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border border-amber-300 dark:border-amber-700/80 shadow-xl text-xs"
        >
          <span className="font-medium text-stone-700 dark:text-stone-200 whitespace-nowrap">
            {secretDraft
              ? 'Tap destination room or exterior space to finish'
              : 'Tap starting room to begin secret passage'}
          </span>
          {secretDraft && (
            <button
              type="button"
              onClick={() => setSecretDraft(null)}
              className="min-h-[30px] px-2 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10 transition-colors"
              aria-label="Cancel secret passage"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Bottom Alert Banners (Overlapping Doors/Passages + Accessibility Diagnostics) */}
      {(overlapWarning.message || accessibility.tooltipMessage) && (
        <div
          data-canvas-ui="true"
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute bottom-28 lg:bottom-5 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 max-w-md w-[calc(100%-24px)] sm:w-auto pointer-events-none"
        >
          {overlapWarning.message && (
            <div
              role="alert"
              className="kc-popover-in pointer-events-auto w-full sm:w-auto px-3.5 py-2.5 rounded-xl border border-rose-300 dark:border-rose-700/80 bg-rose-50/95 dark:bg-[#18191D]/95 backdrop-blur-md shadow-xl flex items-center gap-2.5 text-xs text-rose-950 dark:text-rose-200"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span className="leading-snug flex-1">{overlapWarning.message}</span>
            </div>
          )}

          {accessibility.tooltipMessage && (
            <div
              role="alert"
              className="kc-popover-in pointer-events-auto w-full sm:w-auto px-3.5 py-2.5 rounded-xl border border-amber-300 dark:border-amber-700/80 bg-amber-50/95 dark:bg-[#18191D]/95 backdrop-blur-md shadow-xl flex items-center gap-2.5 text-xs text-amber-950 dark:text-amber-200"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="leading-snug flex-1">{accessibility.tooltipMessage}</span>
              {accessibility.blockingSliceIds && accessibility.blockingSliceIds.size > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const firstId = accessibility.blockingSliceIds?.values().next().value;
                    onSwitchTool('select');
                    if (firstId) onSelectSlice(firstId);
                  }}
                  className="min-h-[30px] px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap transition-colors"
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Select Cutout</span>
                </button>
              )}
              {accessibility.highlightedWalls.length > 0 && activeTool !== 'doorway' && (
                <button
                  type="button"
                  onClick={() => onSwitchTool('doorway')}
                  className="min-h-[30px] px-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1 shrink-0 whitespace-nowrap transition-colors"
                >
                  <DoorOpen className="w-3.5 h-3.5" />
                  <span>Add Door</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Bottom-Left Zoom & Snap Controls */}
      <div
        data-canvas-ui="true"
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute bottom-16 lg:bottom-4 left-3 z-20 flex items-center gap-1 p-1 rounded-xl border border-[#E5E0D5] dark:border-[#2E313A] bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md shadow-lg"
      >
        <div className="flex items-center" role="group" aria-label="Zoom controls">
          <button
            type="button"
            onClick={() => {
              onViewportChange((vp) => ({
                ...vp,
                zoom: Math.max(0.2, vp.zoom * 0.85),
              }));
            }}
            title="Zoom out"
            aria-label="Zoom out"
            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono-tabular text-[11px] font-semibold px-1.5 text-stone-800 dark:text-stone-100 min-w-[44px] text-center">
            {Math.round(viewport.zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => {
              onViewportChange((vp) => ({
                ...vp,
                zoom: Math.min(4, vp.zoom * 1.15),
              }));
            }}
            title="Zoom in"
            aria-label="Zoom in"
            className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="w-px h-5 bg-[#E5E0D5] dark:bg-[#2E313A] mx-0.5" aria-hidden="true" />

        <button
          type="button"
          onClick={onFitToScreen}
          title="Fit map to screen"
          aria-label="Fit map to screen"
          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>

        <div className="w-px h-5 bg-[#E5E0D5] dark:bg-[#2E313A] mx-0.5" aria-hidden="true" />

        <button
          type="button"
          onClick={onToggleSnap}
          aria-pressed={doc.grid.snapToGrid}
          title={doc.grid.snapToGrid ? 'Grid snap ON' : 'Grid snap OFF'}
          aria-label="Toggle grid snap"
          className={`min-h-[34px] px-2.5 flex items-center gap-1.5 rounded-lg text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
            doc.grid.snapToGrid
              ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-2xs'
              : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10'
          }`}
        >
          <Magnet className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Grid</span>
        </button>

        <button
          type="button"
          onClick={onToggleRotationSnap}
          aria-pressed={rotationSnap}
          title={
            rotationSnap
              ? 'Rotation snap ON (15° increments)'
              : 'Rotation snap OFF (1° free rotation)'
          }
          aria-label="Toggle rotation snap"
          className={`min-h-[34px] px-2.5 flex items-center gap-1.5 rounded-lg text-[11px] font-semibold font-mono-tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
            rotationSnap
              ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-2xs'
              : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10'
          }`}
        >
          <RotateCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">15°</span>
        </button>

        <button
          type="button"
          onClick={onToggleAutoConnectDoors}
          aria-pressed={doc.autoConnectDoors}
          title={
            doc.autoConnectDoors
              ? 'Auto-door ON (automatically places doors on touching empty walls)'
              : 'Auto-door OFF (touching rooms will not auto-generate doors)'
          }
          aria-label="Toggle auto-door"
          className={`min-h-[34px] px-2.5 flex items-center gap-1.5 rounded-lg text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
            doc.autoConnectDoors
              ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-2xs'
              : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10'
          }`}
        >
          <DoorOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Auto-Door</span>
        </button>

        <button
          type="button"
          onClick={onToggleLinkOverlappingNodes}
          aria-pressed={linkOverlappingNodes}
          title={
            linkOverlappingNodes
              ? 'Link Nodes ON (dragging a corner or curve node also moves overlapping nodes from other rooms/walls)'
              : 'Link Nodes OFF (dragging moves only the selected room node)'
          }
          aria-label="Toggle linked overlapping nodes"
          className={`min-h-[34px] px-2.5 flex items-center gap-1.5 rounded-lg text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
            linkOverlappingNodes
              ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-2xs'
              : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-white/10'
          }`}
        >
          <Link2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Link Nodes</span>
        </button>
      </div>
    </div>
  );
});

MapCanvas.displayName = 'MapCanvas';
