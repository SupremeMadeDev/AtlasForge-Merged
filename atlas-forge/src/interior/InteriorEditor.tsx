import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { FloorBar } from './components/FloorBar';
import { GeneratorModal } from './components/GeneratorModal';
import { MapCanvas } from './components/MapCanvas';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import {
  createBlackwoodManorPreset,
  createEmptyMapPreset,
  createFortressPreset,
  createTavernPreset,
} from './data/presets';
import {
  CustomFloorTexture,
  DoorKind,
  Doorway,
  FloorMaterial,
  MapDocument,
  MapFloor,
  PathStop,
  Point,
  ProceduralLayoutOptions,
  Room,
  SavedMapEntry,
  SecretPassage,
  SliceMode,
  SliceRegion,
  StairKind,
  StairLink,
  ToolMode,
  ViewportState,
} from './types/map';
import { cloneMapDocument } from './utils/savedMaps';
import { exportMapAsJSON, exportMapAsPNG, importMapFromJSON } from './utils/exportMap';
import {
  computeMultiFloorRoomPath,
  diagnoseMultiFloorAccessibility,
  findClosestEligibleWall,
  findTouchingOppositeWall,
  getAutoPairKey,
  getPointAlongRoomEdge,
  getPolygonBoundingBox,
  reconcileDoorways,
  resolveSecretPassagePolyline,
  rotateRoomGeometry,
  sampleRoomPolygon,
} from './utils/geometry';
import { generateProceduralLayout } from './utils/proceduralLayout';

function syncFloorToDocument(
  prev: MapDocument,
  targetFloorId: string,
  floors: MapFloor[],
  stairLinks: StairLink[] = prev.stairLinks
): MapDocument {
  const active = floors.find((f) => f.id === targetFloorId) ?? floors[0];
  if (!active) return { ...prev, floors, stairLinks };
  return {
    ...prev,
    activeFloorId: active.id,
    floorLabel: active.name,
    floors,
    stairLinks,
    rooms: active.rooms,
    doorways: active.doorways,
    suppressedAutoDoorKeys: active.suppressedAutoDoorKeys ?? [],
    secretPassages: active.secretPassages,
    slices: active.slices ?? [],
  };
}

function updateActiveFloorInDoc(
  prev: MapDocument,
  updater: (floor: MapFloor) => Partial<MapFloor>,
  stairLinks: StairLink[] = prev.stairLinks
): MapDocument {
  const nextFloors = prev.floors.map((fl) => {
    if (fl.id !== prev.activeFloorId) return fl;
    return { ...fl, ...updater(fl) };
  });
  return syncFloorToDocument(prev, prev.activeFloorId, nextFloors, stairLinks);
}

function arePointsEqual(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
}

function areActiveFloorGeometriesEqual(a: MapDocument, b: MapDocument): boolean {
  if (a === b) return true;
  if (
    a.activeFloorId !== b.activeFloorId ||
    a.rooms.length !== b.rooms.length ||
    a.doorways.length !== b.doorways.length ||
    a.secretPassages.length !== b.secretPassages.length ||
    (a.slices?.length ?? 0) !== (b.slices?.length ?? 0)
  ) {
    return false;
  }
  for (let i = 0; i < a.rooms.length; i++) {
    const rA = a.rooms[i];
    const rB = b.rooms[i];
    if (
      rA.id !== rB.id ||
      rA.rotationDeg !== rB.rotationDeg ||
      rA.unwalled !== rB.unwalled ||
      !arePointsEqual(rA.points, rB.points) ||
      rA.edgeCurves.length !== rB.edgeCurves.length ||
      rA.edgeCurves.some((c, idx) => c !== rB.edgeCurves[idx])
    ) {
      return false;
    }
  }
  for (let i = 0; i < a.doorways.length; i++) {
    const dA = a.doorways[i];
    const dB = b.doorways[i];
    if (
      dA.id !== dB.id ||
      dA.roomAId !== dB.roomAId ||
      dA.roomBId !== dB.roomBId ||
      dA.edgeAIndex !== dB.edgeAIndex ||
      dA.edgeBIndex !== dB.edgeBIndex ||
      dA.wallT !== dB.wallT ||
      dA.position.x !== dB.position.x ||
      dA.position.y !== dB.position.y
    ) {
      return false;
    }
  }
  for (let i = 0; i < a.secretPassages.length; i++) {
    const sA = a.secretPassages[i];
    const sB = b.secretPassages[i];
    if (
      sA.id !== sB.id ||
      sA.fromRoomId !== sB.fromRoomId ||
      sA.toRoomId !== sB.toRoomId ||
      sA.startProtrusion !== sB.startProtrusion ||
      sA.endProtrusion !== sB.endProtrusion ||
      !arePointsEqual(sA.points, sB.points)
    ) {
      return false;
    }
  }
  const slicesA = a.slices ?? [];
  const slicesB = b.slices ?? [];
  for (let i = 0; i < slicesA.length; i++) {
    const slA = slicesA[i];
    const slB = slicesB[i];
    if (
      slA.id !== slB.id ||
      !arePointsEqual(slA.points, slB.points) ||
      slA.edgeCurves.length !== slB.edgeCurves.length ||
      slA.edgeCurves.some((c, idx) => c !== slB.edgeCurves[idx])
    ) {
      return false;
    }
  }
  return true;
}

interface DocHistoryState {
  doc: MapDocument;
  past: MapDocument[];
  future: MapDocument[];
  preDragDoc: MapDocument | null;
}

type DocHistoryAction =
  | { type: 'LIVE_PREVIEW'; updater: (baseline: MapDocument) => MapDocument }
  | { type: 'COMMIT'; updater: (baseline: MapDocument) => MapDocument }
  | { type: 'CANCEL_PREVIEW' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'PATCH_NO_HISTORY'; updater: (prev: MapDocument) => MapDocument };

function docHistoryReducer(
  state: DocHistoryState,
  action: DocHistoryAction
): DocHistoryState {
  switch (action.type) {
    case 'LIVE_PREVIEW': {
      const baseline = state.preDragDoc ?? state.doc;
      const nextDoc = action.updater(baseline);
      return {
        ...state,
        doc: nextDoc,
        preDragDoc: baseline,
      };
    }
    case 'COMMIT': {
      const baseline = state.preDragDoc ?? state.doc;
      const nextDoc = action.updater(baseline);
      if (
        nextDoc === baseline ||
        (state.preDragDoc !== null && areActiveFloorGeometriesEqual(baseline, nextDoc))
      ) {
        if (state.preDragDoc === null && state.doc === baseline) return state;
        return {
          ...state,
          doc: baseline,
          preDragDoc: null,
        };
      }
      return {
        doc: nextDoc,
        past: [...state.past.slice(-39), baseline],
        future: [],
        preDragDoc: null,
      };
    }
    case 'CANCEL_PREVIEW': {
      if (state.preDragDoc === null) return state;
      return {
        ...state,
        doc: state.preDragDoc,
        preDragDoc: null,
      };
    }
    case 'UNDO': {
      if (state.preDragDoc !== null) {
        return {
          ...state,
          doc: state.preDragDoc,
          preDragDoc: null,
        };
      }
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        doc: previous,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future.slice(0, 39)],
        preDragDoc: null,
      };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        doc: next,
        past: [...state.past.slice(-39), state.doc],
        future: state.future.slice(1),
        preDragDoc: null,
      };
    }
    case 'PATCH_NO_HISTORY': {
      const nextDoc = action.updater(state.doc);
      if (nextDoc === state.doc && state.preDragDoc === null) return state;
      return {
        ...state,
        doc: nextDoc,
        preDragDoc: state.preDragDoc ? action.updater(state.preDragDoc) : null,
      };
    }
    default:
      return state;
  }
}

export interface InteriorEditorProps {
  /** The interior to edit. Give the component a `key` so a different entry remounts it. */
  initialDoc: MapDocument;
  /** The name shown in the title field (the building's name when the interior is attached) */
  displayName: string;
  /** Short location line shown instead of the standalone app brand */
  contextLabel: string;
  /** Library shown in the Load menu's first tab */
  library: SavedMapEntry[];
  activeEntryId: string;
  /** Called after every committed edit, undo and redo (not during a drag preview) */
  onDocCommit: (doc: MapDocument) => void;
  onRename: (title: string) => void;
  onOpenInterior: (id: string) => void;
  onRenameInterior: (id: string, title: string) => void;
  onDeleteInterior: (id: string) => void;
  onDuplicateInterior: (doc: MapDocument) => void;
}

export function InteriorEditor({
  initialDoc,
  displayName,
  contextLabel,
  library,
  activeEntryId,
  onDocCommit,
  onRename,
  onOpenInterior,
  onRenameInterior,
  onDeleteInterior,
  onDuplicateInterior,
}: InteriorEditorProps) {
  const [historyState, dispatchHistory] = useReducer(
    docHistoryReducer,
    undefined,
    (): DocHistoryState => ({
      doc: cloneMapDocument(initialDoc),
      past: [],
      future: [],
      preDragDoc: null,
    })
  );
  const { doc, past, future } = historyState;
  const docRef = useRef(doc);
  docRef.current = doc;

  const [darkTheme, setDarkTheme] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedDoorId, setSelectedDoorId] = useState<string | null>(null);
  const [selectedSecretPassageId, setSelectedSecretPassageId] = useState<string | null>(null);
  const [selectedSliceId, setSelectedSliceId] = useState<string | null>(null);

  const [pathStops, setPathStops] = useState<PathStop[]>([]);
  const [includeSecretInPath] = useState(true);
  const [includeLockedInPath] = useState(true);
  const [activeDoorKind, setActiveDoorKind] = useState<DoorKind>('normal');
  const [activeSliceMode, setActiveSliceMode] = useState<SliceMode>('wall');

  const [viewport, setViewport] = useState<ViewportState>({ x: 60, y: 40, zoom: 0.92 });
  const [rotationSnap, setRotationSnap] = useState(true);
  const [linkOverlappingNodes, setLinkOverlappingNodes] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkTheme);
    return () => {
      // The dark class is only meaningful while the interior editor is mounted
      document.documentElement.classList.remove('dark');
    };
  }, [darkTheme]);

  // Hand every committed document to the shell. Drag previews are skipped; undo and
  // redo are included because they change `doc` with no pending preview.
  const onDocCommitRef = useRef(onDocCommit);
  onDocCommitRef.current = onDocCommit;
  const lastEmittedDocRef = useRef<MapDocument | null>(null);
  useEffect(() => {
    if (lastEmittedDocRef.current === null) {
      lastEmittedDocRef.current = doc;
      return;
    }
    if (historyState.preDragDoc !== null) return;
    if (lastEmittedDocRef.current === doc) return;
    lastEmittedDocRef.current = doc;
    onDocCommitRef.current(doc);
  }, [doc, historyState.preDragDoc]);

  // The shell owns the name (it is the building's name when attached), so presets,
  // generated layouts and imports never rename the interior.
  useEffect(() => {
    if (docRef.current.title !== displayName) {
      dispatchHistory({
        type: 'PATCH_NO_HISTORY',
        updater: (prev) => ({ ...prev, title: displayName }),
      });
    }
  }, [displayName, doc.title]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const commitDoc = useCallback((updater: (prev: MapDocument) => MapDocument) => {
    dispatchHistory({ type: 'COMMIT', updater });
  }, []);

  const previewDoc = useCallback((updater: (baseline: MapDocument) => MapDocument) => {
    dispatchHistory({ type: 'LIVE_PREVIEW', updater });
  }, []);

  const patchDocWithoutHistory = useCallback((updater: (prev: MapDocument) => MapDocument) => {
    dispatchHistory({ type: 'PATCH_NO_HISTORY', updater });
  }, []);

  const handleCancelLivePreview = useCallback(() => {
    dispatchHistory({ type: 'CANCEL_PREVIEW' });
  }, []);

  const handleUndo = useCallback(() => {
    dispatchHistory({ type: 'UNDO' });
  }, []);

  const handleRedo = useCallback(() => {
    dispatchHistory({ type: 'REDO' });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo]);

  const rootRef = useRef<HTMLDivElement | null>(null);

  const fitToDocument = useCallback((targetDoc: MapDocument) => {
    const pts = targetDoc.rooms.flatMap((r) => sampleRoomPolygon(r, 4));
    if (pts.length === 0) {
      setViewport({ x: 80, y: 60, zoom: 1 });
      return;
    }
    const box = getPolygonBoundingBox(pts);
    // Size to this editor's own box (it sits below the shell's chrome), not the window
    const rootRect = rootRef.current?.getBoundingClientRect();
    const availW = rootRect && rootRect.width > 0 ? rootRect.width : window.innerWidth;
    const availH = rootRect && rootRect.height > 0 ? rootRect.height : window.innerHeight;
    const viewW = Math.max(320, availW - (window.innerWidth >= 1024 ? 96 : 24));
    const viewH = Math.max(320, availH - 130);
    const pad = 90;
    const zoom = Math.min(
      1.35,
      Math.max(0.28, Math.min(viewW / (box.width + pad), viewH / (box.height + pad)))
    );
    const cx = box.minX + box.width / 2;
    const cy = box.minY + box.height / 2;
    setViewport({
      zoom,
      x: viewW / 2 - cx * zoom,
      y: viewH / 2 - cy * zoom,
    });
  }, []);

  const handleFitToScreen = useCallback(() => {
    fitToDocument(docRef.current);
  }, [fitToDocument]);

  useEffect(() => {
    fitToDocument(docRef.current);
  }, [fitToDocument]);

  const applyRoomsWithDoorways = useCallback(
    (prev: MapDocument, rooms: Room[]): MapDocument => {
      const doorways = reconcileDoorways(
        rooms,
        prev.doorways,
        prev.autoConnectDoors,
        prev.autoConnectTolerance,
        prev.suppressedAutoDoorKeys ?? [],
        { requireEmptyWalls: true }
      );
      const secretPassages = prev.secretPassages.map((sp) => {
        const res = resolveSecretPassagePolyline(sp, rooms);
        return {
          ...sp,
          startAnchor: res.startAnchor,
          endAnchor: res.endAnchor,
          points: res.points,
        };
      });
      return updateActiveFloorInDoc(prev, () => ({
        rooms,
        doorways,
        secretPassages,
      }));
    },
    []
  );

  const handleRoomsLivePreview = useCallback(
    (rooms: Room[]) => {
      previewDoc((baseline) => applyRoomsWithDoorways(baseline, rooms));
    },
    [applyRoomsWithDoorways, previewDoc]
  );

  const handleRoomsCommit = useCallback(
    (rooms: Room[]) => {
      commitDoc((prev) => applyRoomsWithDoorways(prev, rooms));
    },
    [applyRoomsWithDoorways, commitDoc]
  );

  const handleAddRoom = useCallback(
    (room: Room) => {
      commitDoc((prev) => applyRoomsWithDoorways(prev, [...prev.rooms, room]));
      setSelectedRoomId(room.id);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
      setActiveTool('select');
    },
    [applyRoomsWithDoorways, commitDoc]
  );

  const handleToggleRoomTagSetting = useCallback(
    (roomId: string, setting: 'secret' | 'locked') => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => {
          const room = fl.rooms.find((r) => r.id === roomId);
          if (!room) return {};

          const connectedDoors = fl.doorways.filter(
            (d) => d.roomAId === roomId || d.roomBId === roomId
          );
          const connectedPassages = fl.secretPassages.filter(
            (sp) => sp.fromRoomId === roomId || sp.toRoomId === roomId
          );

          const isCurrentlySecret =
            connectedDoors.length > 0 || connectedPassages.length > 0
              ? connectedDoors.every(
                  (d) => d.kind === 'secret' || d.kind === 'locked-secret'
                )
              : (room.tags?.includes('secret') ?? false);

          const isCurrentlyLocked =
            connectedDoors.length > 0
              ? connectedDoors.every(
                  (d) => d.kind === 'locked' || d.kind === 'locked-secret'
                )
              : (room.tags?.includes('locked') ?? false);

          const nextValue =
            setting === 'secret' ? !isCurrentlySecret : !isCurrentlyLocked;

          const nextDoorways = fl.doorways.map((d) => {
            if (d.roomAId !== roomId && d.roomBId !== roomId) return d;
            const kind = d.kind ?? 'normal';

            const wasSecret = kind === 'secret' || kind === 'locked-secret';
            const wasLocked = kind === 'locked' || kind === 'locked-secret';

            const nextSecret = setting === 'secret' ? nextValue : wasSecret;
            const nextLocked = setting === 'locked' ? nextValue : wasLocked;

            const nextKind: DoorKind =
              nextSecret && nextLocked
                ? 'locked-secret'
                : nextSecret
                  ? 'secret'
                  : nextLocked
                    ? 'locked'
                    : 'normal';

            return {
              ...d,
              kind: nextKind,
              dcInvestigation: nextSecret ? (d.dcInvestigation ?? 15) : undefined,
              dcLockpick: nextLocked ? (d.dcLockpick ?? 15) : undefined,
            };
          });

          const nextRooms = fl.rooms.map((r) => {
            if (r.id !== roomId) return r;
            const currentTags = new Set(r.tags ?? []);
            if (nextValue) {
              currentTags.add(setting);
            } else {
              currentTags.delete(setting);
            }
            return {
              ...r,
              tags: currentTags.size > 0 ? Array.from(currentTags) : undefined,
            };
          });

          return {
            rooms: nextRooms,
            doorways: nextDoorways,
          };
        })
      );
    },
    [commitDoc]
  );

  const handleInsertEdgeVertex = useCallback(
    (roomId: string, edgeIndex: number) => {
      commitDoc((prev) => {
        const rooms = prev.rooms.map((r) => {
          if (r.id !== roomId) return r;
          const ptOnEdge = getPointAlongRoomEdge(r, edgeIndex, 0.5);
          const newPt = {
            x: Math.round(ptOnEdge.x),
            y: Math.round(ptOnEdge.y),
          };
          const nextPts = [
            ...r.points.slice(0, edgeIndex + 1),
            newPt,
            ...r.points.slice(edgeIndex + 1),
          ];
          const nextCurves = [
            ...r.edgeCurves.slice(0, edgeIndex),
            0,
            0,
            ...r.edgeCurves.slice(edgeIndex + 1),
          ];
          const nextHidden = r.hiddenEdges
            ? [
                ...r.hiddenEdges.slice(0, edgeIndex),
                Boolean(r.hiddenEdges[edgeIndex]),
                Boolean(r.hiddenEdges[edgeIndex]),
                ...r.hiddenEdges.slice(edgeIndex + 1),
              ]
            : undefined;
          return {
            ...r,
            points: nextPts,
            edgeCurves: nextCurves,
            hiddenEdges: nextHidden,
          };
        });

        const adjustedDoors = prev.doorways.map((d) => {
          let nextD = { ...d };
          if (d.roomAId === roomId) {
            if (d.edgeAIndex > edgeIndex) {
              nextD.edgeAIndex = d.edgeAIndex + 1;
            } else if (d.edgeAIndex === edgeIndex) {
              const curT = d.wallT ?? 0.5;
              if (curT >= 0.5) {
                nextD.edgeAIndex = edgeIndex + 1;
                nextD.wallT = Math.max(0.05, Math.min(0.95, (curT - 0.5) * 2));
              } else {
                nextD.wallT = Math.max(0.05, Math.min(0.95, curT * 2));
              }
            }
          }
          if (d.roomBId === roomId && d.edgeBIndex !== null && d.edgeBIndex !== undefined) {
            if (d.edgeBIndex > edgeIndex) {
              nextD.edgeBIndex = d.edgeBIndex + 1;
            } else if (d.edgeBIndex === edgeIndex) {
              nextD.edgeBIndex = edgeIndex;
            }
          }
          return nextD;
        });

        const doorways = reconcileDoorways(
          rooms,
          adjustedDoors,
          prev.autoConnectDoors,
          prev.autoConnectTolerance,
          prev.suppressedAutoDoorKeys ?? [],
          { requireEmptyWalls: true }
        );

        return updateActiveFloorInDoc(prev, () => ({
          rooms,
          doorways,
        }));
      });
    },
    [commitDoc]
  );

  const handleDeleteRoomVertex = useCallback(
    (roomId: string, vertexIndex: number) => {
      commitDoc((prev) => {
        let validPtsLen = 0;
        const rooms = prev.rooms.map((r) => {
          if (r.id !== roomId || r.points.length <= 3) return r;
          const nextPts = r.points.filter((_, idx) => idx !== vertexIndex);
          validPtsLen = nextPts.length;
          const nextCurves = r.edgeCurves.filter((_, idx) => idx !== vertexIndex);
          const nextHidden = r.hiddenEdges
            ? r.hiddenEdges.filter((_, idx) => idx !== vertexIndex)
            : undefined;
          return {
            ...r,
            points: nextPts,
            edgeCurves: nextCurves,
            hiddenEdges: nextHidden,
          };
        });

        const adjustedDoors = prev.doorways.map((d) => {
          let nextD = { ...d };
          if (d.roomAId === roomId) {
            if (d.edgeAIndex > vertexIndex) {
              nextD.edgeAIndex = d.edgeAIndex - 1;
            } else if (d.edgeAIndex === vertexIndex && validPtsLen > 0) {
              nextD.edgeAIndex = Math.max(0, Math.min(validPtsLen - 1, d.edgeAIndex));
            }
          }
          if (d.roomBId === roomId && d.edgeBIndex !== null && d.edgeBIndex !== undefined) {
            if (d.edgeBIndex > vertexIndex) {
              nextD.edgeBIndex = d.edgeBIndex - 1;
            } else if (d.edgeBIndex === vertexIndex && validPtsLen > 0) {
              nextD.edgeBIndex = Math.max(0, Math.min(validPtsLen - 1, d.edgeBIndex));
            }
          }
          return nextD;
        });

        const doorways = reconcileDoorways(
          rooms,
          adjustedDoors,
          prev.autoConnectDoors,
          prev.autoConnectTolerance,
          prev.suppressedAutoDoorKeys ?? [],
          { requireEmptyWalls: true }
        );

        return updateActiveFloorInDoc(prev, () => ({
          rooms,
          doorways,
        }));
      });
    },
    [commitDoc]
  );

  const handleDeleteRoom = useCallback(
    (roomId: string) => {
      const floorId = docRef.current.activeFloorId;
      const target = docRef.current.rooms.find((r) => r.id === roomId);
      commitDoc((prev) => {
        const nextRooms = prev.rooms.filter((r) => r.id !== roomId);
        const filteredDoors = prev.doorways.filter(
          (d) => d.roomAId !== roomId && d.roomBId !== roomId
        );
        const doorways = reconcileDoorways(
          nextRooms,
          filteredDoors,
          prev.autoConnectDoors,
          prev.autoConnectTolerance,
          prev.suppressedAutoDoorKeys ?? [],
          { requireEmptyWalls: true }
        );
        const secretPassages = prev.secretPassages.filter(
          (sp) => sp.fromRoomId !== roomId && sp.toRoomId !== roomId
        );
        const nextStairs = prev.stairLinks.filter(
          (st) =>
            !(
              (st.fromFloorId === prev.activeFloorId && st.fromRoomId === roomId) ||
              (st.toFloorId === prev.activeFloorId && st.toRoomId === roomId)
            )
        );
        return updateActiveFloorInDoc(
          prev,
          () => ({
            rooms: nextRooms,
            doorways,
            secretPassages,
          }),
          nextStairs
        );
      });
      setSelectedRoomId((curr) => (curr === roomId ? null : curr));
      setPathStops((stops) =>
        stops.filter((s) => !(s.floorId === floorId && s.roomId === roomId))
      );
      setToast(target ? `Deleted "${target.name}".` : 'Deleted room.');
    },
    [commitDoc]
  );

  const handleToggleRoomUnwalled = useCallback(
    (roomId: string) => {
      commitDoc((prev) => {
        const nextRooms = prev.rooms.map((r) =>
          r.id === roomId ? { ...r, unwalled: r.unwalled ? undefined : true } : r
        );
        return applyRoomsWithDoorways(prev, nextRooms);
      });
    },
    [applyRoomsWithDoorways, commitDoc]
  );

  const handleRenameRoom = useCallback(
    (roomId: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => {
          const existing = fl.rooms.find((r) => r.id === roomId);
          if (!existing || existing.name === trimmed) return {};
          return {
            rooms: fl.rooms.map((r) =>
              r.id === roomId ? { ...r, name: trimmed } : r
            ),
          };
        })
      );
    },
    [commitDoc]
  );

  const handleSetRoomFloorMaterial = useCallback(
    (roomId: string, floorMaterial: FloorMaterial) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          rooms: fl.rooms.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  floorMaterial,
                  customColor: undefined,
                  customTextureId: undefined,
                }
              : r
          ),
        }))
      );
    },
    [commitDoc]
  );

  const handleToggleRoomRotateStairTexture = useCallback(
    (roomId: string) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          rooms: fl.rooms.map((r) =>
            r.id === roomId
              ? {
                  ...r,
                  rotateStairTexture: r.rotateStairTexture === false ? true : false,
                }
              : r
          ),
        }))
      );
    },
    [commitDoc]
  );

  const handleImportRoomCustomTexture = useCallback(
    (roomId: string, texture: CustomFloorTexture) => {
      commitDoc((prev) => {
        const existing = prev.customTextures ?? [];
        const nextTextures = [...existing, texture];
        const nextDoc = updateActiveFloorInDoc(prev, (fl) => ({
          rooms: fl.rooms.map((r) =>
            r.id === roomId
              ? { ...r, customColor: undefined, customTextureId: texture.id }
              : r
          ),
        }));
        return { ...nextDoc, customTextures: nextTextures };
      });
      setToast(`Imported & applied "${texture.name}".`);
    },
    [commitDoc]
  );

  const handleApplyRoomCustomTexture = useCallback(
    (roomId: string, textureId: string) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          rooms: fl.rooms.map((r) =>
            r.id === roomId
              ? { ...r, customColor: undefined, customTextureId: textureId }
              : r
          ),
        }))
      );
    },
    [commitDoc]
  );

  const handleUpdateCustomTextureTileSize = useCallback(
    (textureId: string, tileSize: number) => {
      const clamped = Math.max(20, Math.min(400, Math.round(tileSize)));
      commitDoc((prev) => ({
        ...prev,
        customTextures: (prev.customTextures ?? []).map((t) =>
          t.id === textureId ? { ...t, tileSize: clamped } : t
        ),
      }));
    },
    [commitDoc]
  );

  const handleDeleteCustomTexture = useCallback(
    (textureId: string) => {
      commitDoc((prev) => {
        const nextTextures = (prev.customTextures ?? []).filter(
          (t) => t.id !== textureId
        );
        const nextFloors = prev.floors.map((fl) => ({
          ...fl,
          rooms: fl.rooms.map((r) =>
            r.customTextureId === textureId
              ? { ...r, customTextureId: undefined }
              : r
          ),
        }));
        const synced = syncFloorToDocument(prev, prev.activeFloorId, nextFloors);
        return {
          ...synced,
          customTextures: nextTextures.length > 0 ? nextTextures : undefined,
        };
      });
    },
    [commitDoc]
  );

  const handleToggleDoorway = useCallback(
    (doorId: string) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          doorways: fl.doorways.map((d) =>
            d.id === doorId ? { ...d, enabled: !d.enabled } : d
          ),
        }))
      );
    },
    [commitDoc]
  );

  const handleUpdateDoorway = useCallback(
    (doorId: string, patch: Partial<Doorway>) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          doorways: fl.doorways.map((d) => {
            if (d.id !== doorId) return d;
            const merged: Doorway = { ...d, ...patch };
            if (merged.width !== undefined) {
              merged.width = Math.max(20, Math.min(240, Math.round(merged.width)));
            }
            return merged;
          }),
        }))
      );
    },
    [commitDoc]
  );

  const handleDeleteDoorway = useCallback(
    (doorId: string) => {
      commitDoc((prev) => {
        const target = prev.doorways.find((d) => d.id === doorId);
        const suppressed = [...(prev.suppressedAutoDoorKeys ?? [])];
        if (target?.autoDetected && target.roomBId !== null) {
          const key = getAutoPairKey(
            target.roomAId,
            target.roomBId,
            target.edgeAIndex,
            target.edgeBIndex ?? 0
          );
          if (!suppressed.includes(key)) suppressed.push(key);
        }
        return updateActiveFloorInDoc(prev, (fl) => ({
          doorways: fl.doorways.filter((d) => d.id !== doorId),
          suppressedAutoDoorKeys: suppressed,
        }));
      });
      setSelectedDoorId((curr) => (curr === doorId ? null : curr));
    },
    [commitDoc]
  );



  const handleDoorwaysLivePreview = useCallback(
    (doorways: Doorway[]) => {
      previewDoc((baseline) => updateActiveFloorInDoc(baseline, () => ({ doorways })));
    },
    [previewDoc]
  );

  const handleDoorwaysCommit = useCallback(
    (doorways: Doorway[]) => {
      commitDoc((prev) => {
        const suppressed = [...(prev.suppressedAutoDoorKeys ?? [])];
        for (const d of doorways) {
          const old = prev.doorways.find((o) => o.id === d.id);
          if (!old || !old.autoDetected || old.roomBId === null) continue;
          const oldKey = getAutoPairKey(
            old.roomAId,
            old.roomBId,
            old.edgeAIndex,
            old.edgeBIndex ?? 0
          );
          const sameSharedWall =
            d.roomBId !== null &&
            getAutoPairKey(
              d.roomAId,
              d.roomBId,
              d.edgeAIndex,
              d.edgeBIndex ?? 0
            ) === oldKey;
          if (!sameSharedWall && !suppressed.includes(oldKey)) {
            suppressed.push(oldKey);
          }
        }
        return updateActiveFloorInDoc(prev, () => ({
          doorways,
          suppressedAutoDoorKeys: suppressed,
        }));
      });
    },
    [commitDoc]
  );

  const handleAddDoorwayAtPoint = useCallback(
    (pt: Point) => {
      const currentRooms = docRef.current.rooms;
      if (currentRooms.length === 0) {
        setToast('Draw a room first to place a doorway.');
        return;
      }

      const best = findClosestEligibleWall(currentRooms, pt, 34);
      if (!best || best.dist > 36) {
        setToast('Click directly on a walled room edge to place a doorway.');
        return;
      }

      const opposite = findTouchingOppositeWall(
        best.room,
        best.edgeIndex,
        best.position,
        currentRooms,
        docRef.current.autoConnectTolerance + 8
      );
      const isInteriorPair = opposite !== null;

      const newDoor: Doorway = {
        id: `door-${Date.now()}`,
        roomAId: best.room.id,
        roomBId: opposite?.roomBId ?? null,
        edgeAIndex: best.edgeIndex,
        edgeBIndex: opposite?.edgeBIndex ?? null,
        position: best.position,
        angle: best.angle,
        width: isInteriorPair ? 32 : 34,
        enabled: true,
        kind: activeDoorKind,
        dcLockpick:
          activeDoorKind === 'locked' || activeDoorKind === 'locked-secret'
            ? 15
            : undefined,
        dcInvestigation:
          activeDoorKind === 'secret' || activeDoorKind === 'locked-secret'
            ? 15
            : undefined,
        customPlaced: true,
        autoDetected: false,
        wallT: best.wallT,
      };
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          doorways: [...fl.doorways, newDoor],
        }))
      );
      setSelectedDoorId(newDoor.id);
      setSelectedRoomId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
      const kindLabel =
        activeDoorKind === 'locked-secret'
          ? 'locked secret'
          : activeDoorKind === 'secret'
            ? 'secret'
            : activeDoorKind === 'locked'
              ? 'locked'
              : '';
      setToast(
        isInteriorPair
          ? `Added ${kindLabel ? `${kindLabel} ` : ''}interior doorway.`
          : `Added ${kindLabel ? `${kindLabel} ` : ''}exterior doorway.`
      );
    },
    [activeDoorKind, commitDoc]
  );

  const handleAddSecretPassage = useCallback(
    (passage: SecretPassage) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          secretPassages: [...fl.secretPassages, passage],
        }))
      );
      setSelectedSecretPassageId(passage.id);
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSliceId(null);
      setToast(
        passage.toRoomId
          ? 'Added secret passage between rooms.'
          : 'Added secret passage to exterior wall.'
      );
    },
    [commitDoc]
  );

  const handleSecretPassagesLivePreview = useCallback(
    (secretPassages: SecretPassage[]) => {
      previewDoc((baseline) => updateActiveFloorInDoc(baseline, () => ({ secretPassages })));
    },
    [previewDoc]
  );

  const handleSecretPassagesCommit = useCallback(
    (secretPassages: SecretPassage[]) => {
      commitDoc((prev) => updateActiveFloorInDoc(prev, () => ({ secretPassages })));
    },
    [commitDoc]
  );

  const handleDeleteSecretPassage = useCallback(
    (id: string) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          secretPassages: fl.secretPassages.filter((sp) => sp.id !== id),
        }))
      );
      setSelectedSecretPassageId((curr) => (curr === id ? null : curr));
    },
    [commitDoc]
  );

  // Wall Slice & Floor Slice Management
  const checkSliceBlockingMessage = useCallback(
    (projectedDoc: MapDocument): string | null => {
      const diag = diagnoseMultiFloorAccessibility(
        projectedDoc.floors,
        projectedDoc.activeFloorId,
        projectedDoc.stairLinks,
        includeSecretInPath,
        projectedDoc.autoConnectTolerance,
        includeLockedInPath
      );
      return diag.sliceBlockingMessage ?? null;
    },
    [includeLockedInPath, includeSecretInPath]
  );

  const handleAddSlice = useCallback(
    (slice: SliceRegion) => {
      const projected = updateActiveFloorInDoc(docRef.current, (fl) => ({
        slices: [...(fl.slices ?? []), slice],
      }));
      const blockMsg = checkSliceBlockingMessage(projected);
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          slices: [...(fl.slices ?? []), slice],
        }))
      );
      setSelectedSliceId(slice.id);
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setActiveTool('select');
      setToast(
        blockMsg ??
          (slice.mode === 'floor'
            ? 'Added Closed Cutout (cuts walls & floor, enclosed in walls).'
            : 'Added Open Cutout (removes enclosed walls).')
      );
    },
    [checkSliceBlockingMessage, commitDoc]
  );

  const handleSlicesLivePreview = useCallback(
    (slices: SliceRegion[]) => {
      previewDoc((baseline) => updateActiveFloorInDoc(baseline, () => ({ slices })));
    },
    [previewDoc]
  );

  const handleSlicesCommit = useCallback(
    (slices: SliceRegion[]) => {
      const projected = updateActiveFloorInDoc(docRef.current, () => ({ slices }));
      const blockMsg = checkSliceBlockingMessage(projected);
      commitDoc((prev) => updateActiveFloorInDoc(prev, () => ({ slices })));
      if (blockMsg) {
        setToast(blockMsg);
      }
    },
    [checkSliceBlockingMessage, commitDoc]
  );

  const handleUpdateSlice = useCallback(
    (sliceId: string, patch: Partial<SliceRegion>) => {
      const projected = updateActiveFloorInDoc(docRef.current, (fl) => ({
        slices: (fl.slices ?? []).map((s) =>
          s.id === sliceId ? { ...s, ...patch } : s
        ),
      }));
      const blockMsg = checkSliceBlockingMessage(projected);
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          slices: (fl.slices ?? []).map((s) =>
            s.id === sliceId ? { ...s, ...patch } : s
          ),
        }))
      );
      if (blockMsg) {
        setToast(blockMsg);
      }
    },
    [checkSliceBlockingMessage, commitDoc]
  );

  const handleDeleteSlice = useCallback(
    (sliceId: string) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          slices: (fl.slices ?? []).filter((s) => s.id !== sliceId),
        }))
      );
      setSelectedSliceId((curr) => (curr === sliceId ? null : curr));
    },
    [commitDoc]
  );

  const handleInsertSliceEdgeVertex = useCallback(
    (sliceId: string, edgeIndex: number) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          slices: (fl.slices ?? []).map((s) => {
            if (s.id !== sliceId) return s;
            const ptOnEdge = getPointAlongRoomEdge(s, edgeIndex, 0.5);
            const newPt = {
              x: Math.round(ptOnEdge.x),
              y: Math.round(ptOnEdge.y),
            };
            const nextPts = [
              ...s.points.slice(0, edgeIndex + 1),
              newPt,
              ...s.points.slice(edgeIndex + 1),
            ];
            const nextCurves = [
              ...s.edgeCurves.slice(0, edgeIndex),
              0,
              0,
              ...s.edgeCurves.slice(edgeIndex + 1),
            ];
            return { ...s, points: nextPts, edgeCurves: nextCurves };
          }),
        }))
      );
    },
    [commitDoc]
  );

  const handleDeleteSliceVertex = useCallback(
    (sliceId: string, vertexIndex: number) => {
      commitDoc((prev) =>
        updateActiveFloorInDoc(prev, (fl) => ({
          slices: (fl.slices ?? []).map((s) => {
            if (s.id !== sliceId || s.points.length <= 3) return s;
            return {
              ...s,
              points: s.points.filter((_, idx) => idx !== vertexIndex),
              edgeCurves: s.edgeCurves.filter((_, idx) => idx !== vertexIndex),
            };
          }),
        }))
      );
    },
    [commitDoc]
  );

  // Multi-floor Management & Interlinking Stairways
  const handleSelectFloor = useCallback(
    (floorId: string) => {
      patchDocWithoutHistory((prev) => {
        if (prev.activeFloorId === floorId) return prev;
        return syncFloorToDocument(prev, floorId, prev.floors);
      });
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
    },
    [patchDocWithoutHistory]
  );

  const handleAddFloor = useCallback(
    (direction: 'above' | 'below') => {
      const newId = `floor-${Date.now()}`;
      commitDoc((prev) => {
        const orders = prev.floors.map((f) => f.elevationOrder);
        const nextOrder =
          direction === 'above' ? Math.max(...orders) + 1 : Math.min(...orders) - 1;
        const defaultName =
          nextOrder < 0
            ? nextOrder === -1
              ? 'Cellar'
              : `Sub-Level ${Math.abs(nextOrder)}`
            : nextOrder === 0
              ? 'Ground Floor'
              : `Floor ${nextOrder + 1}`;
        const newFloor: MapFloor = {
          id: newId,
          name: defaultName,
          elevationOrder: nextOrder,
          rooms: [],
          doorways: [],
          suppressedAutoDoorKeys: [],
          secretPassages: [],
          slices: [],
        };
        const nextFloors = [...prev.floors, newFloor];
        return syncFloorToDocument(prev, newId, nextFloors);
      });
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
      setToast(
        direction === 'above'
          ? 'Added upper floor. Draw chambers or link stairways from a lower floor.'
          : 'Added lower level. Link a stairway or ladder hatch to connect floors.'
      );
    },
    [commitDoc]
  );

  const handleRenameFloor = useCallback(
    (floorId: string, name: string) => {
      commitDoc((prev) => {
        const nextFloors = prev.floors.map((fl) =>
          fl.id === floorId ? { ...fl, name } : fl
        );
        return syncFloorToDocument(prev, prev.activeFloorId, nextFloors);
      });
    },
    [commitDoc]
  );

  const handleDeleteFloor = useCallback(
    (floorId: string) => {
      if (docRef.current.floors.length <= 1) {
        setToast('Cannot delete the last remaining floor.');
        return;
      }
      commitDoc((prev) => {
        if (prev.floors.length <= 1) return prev;
        const remaining = prev.floors.filter((f) => f.id !== floorId);
        const nextStairs = prev.stairLinks.filter(
          (st) => st.fromFloorId !== floorId && st.toFloorId !== floorId
        );
        const nextActiveId =
          prev.activeFloorId === floorId ? remaining[0].id : prev.activeFloorId;
        return syncFloorToDocument(prev, nextActiveId, remaining, nextStairs);
      });
      setPathStops((stops) => stops.filter((s) => s.floorId !== floorId));
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
    },
    [commitDoc]
  );

  const handleCreateStairLink = useCallback(
    (params: {
      fromFloorId: string;
      fromRoomId: string;
      toFloorId: string;
      toRoomId?: string;
      createMatchingRoom?: boolean;
      kind: StairKind;
      label: string;
    }) => {
      commitDoc((prev) => {
        const fromFloor = prev.floors.find((f) => f.id === params.fromFloorId);
        const toFloor = prev.floors.find((f) => f.id === params.toFloorId);
        const fromRoom = fromFloor?.rooms.find((r) => r.id === params.fromRoomId);
        if (!fromFloor || !toFloor || !fromRoom) return prev;

        let targetRoomId = params.toRoomId;
        let nextFloors = prev.floors;

        if (params.createMatchingRoom || !targetRoomId) {
          const clonedRoomId = `room-stair-${Date.now()}`;
          const clonedRoom: Room = {
            ...fromRoom,
            id: clonedRoomId,
            name: params.label || `${fromRoom.name} Landing`,
            type: 'stairs',
            points: fromRoom.points.map((p) => ({ ...p })),
            edgeCurves: [...fromRoom.edgeCurves],
            notes: `Stair landing linking directly to ${fromFloor.name} (${fromRoom.name}).`,
          };
          targetRoomId = clonedRoomId;
          nextFloors = prev.floors.map((fl) => {
            if (fl.id !== toFloor.id) return fl;
            const nextRooms = [...fl.rooms, clonedRoom];
            const nextDoors = reconcileDoorways(
              nextRooms,
              fl.doorways,
              prev.autoConnectDoors,
              prev.autoConnectTolerance,
              fl.suppressedAutoDoorKeys ?? [],
              { requireEmptyWalls: true }
            );
            return { ...fl, rooms: nextRooms, doorways: nextDoors };
          });
        }

        const newLink: StairLink = {
          id: `stair-${Date.now()}`,
          label: params.label,
          kind: params.kind,
          fromFloorId: params.fromFloorId,
          fromRoomId: params.fromRoomId,
          toFloorId: params.toFloorId,
          toRoomId: targetRoomId,
          bidirectional: true,
          enabled: true,
        };

        return syncFloorToDocument(
          prev,
          prev.activeFloorId,
          nextFloors,
          [...prev.stairLinks, newLink]
        );
      });
      setToast(`Linked "${params.label}" between floors.`);
    },
    [commitDoc]
  );



  const handleDeleteStairLink = useCallback(
    (id: string) => {
      commitDoc((prev) => ({
        ...prev,
        stairLinks: prev.stairLinks.filter((st) => st.id !== id),
      }));
    },
    [commitDoc]
  );

  const handleJumpToFloorAndRoom = useCallback(
    (floorId: string, roomId: string) => {
      patchDocWithoutHistory((prev) => {
        if (prev.activeFloorId === floorId) return prev;
        return syncFloorToDocument(prev, floorId, prev.floors);
      });
      setSelectedRoomId(roomId);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
    },
    [patchDocWithoutHistory]
  );

  const handlePathRoomTap = useCallback((roomId: string) => {
    const floorId = docRef.current.activeFloorId;
    const stop: PathStop = { floorId, roomId };
    setPathStops((prev) => {
      if (prev.length === 0) return [stop];
      if (prev.length === 1) {
        if (prev[0].floorId === floorId && prev[0].roomId === roomId) return prev;
        return [prev[0], stop];
      }
      return [stop];
    });
  }, []);

  const pathResult = useMemo(() => {
    if (pathStops.length < 2) return null;
    return computeMultiFloorRoomPath(doc.floors, doc.stairLinks, pathStops, {
      includeSecret: includeSecretInPath,
      includeLocked: includeLockedInPath,
      cellSize: doc.grid.cellSize,
      feetPerCell: doc.grid.feetPerCell,
    });
  }, [
    doc.floors,
    doc.grid.cellSize,
    doc.grid.feetPerCell,
    doc.stairLinks,
    includeLockedInPath,
    includeSecretInPath,
    pathStops,
  ]);

  const accessibility = useMemo(() => {
    return diagnoseMultiFloorAccessibility(
      doc.floors,
      doc.activeFloorId,
      doc.stairLinks,
      includeSecretInPath,
      doc.autoConnectTolerance,
      includeLockedInPath
    );
  }, [
    doc.activeFloorId,
    doc.autoConnectTolerance,
    doc.floors,
    doc.stairLinks,
    includeLockedInPath,
    includeSecretInPath,
  ]);

  // Interiors save automatically through onDocCommit, so there is no manual save step.
  const handleSaveMap = useCallback(() => {
    setToast('Changes save automatically.');
  }, []);

  useEffect(() => {
    const onSaveKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveMap();
      }
    };
    window.addEventListener('keydown', onSaveKeyDown);
    return () => window.removeEventListener('keydown', onSaveKeyDown);
  }, [handleSaveMap]);

  const handleSaveAsNewMap = useCallback(() => {
    onDuplicateInterior(docRef.current);
    setToast('Saved a copy to the library.');
  }, [onDuplicateInterior]);

  const handleSelectSavedMap = useCallback(
    (id: string) => {
      if (id === activeEntryId) return;
      onOpenInterior(id);
    },
    [activeEntryId, onOpenInterior]
  );

  const handleRenameSavedMap = useCallback(
    (id: string, title: string) => {
      onRenameInterior(id, title);
    },
    [onRenameInterior]
  );

  const handleDeleteSavedMap = useCallback(
    (id: string) => {
      onDeleteInterior(id);
    },
    [onDeleteInterior]
  );

  const handleLoadPreset = useCallback(
    (preset: 'manor' | 'tavern' | 'fortress' | 'empty') => {
      const nextDoc =
        preset === 'manor'
          ? createBlackwoodManorPreset()
          : preset === 'tavern'
            ? createTavernPreset()
            : preset === 'fortress'
              ? createFortressPreset()
              : createEmptyMapPreset();
      commitDoc(() => nextDoc);
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
      setPathStops([]);
      fitToDocument(nextDoc);
    },
    [commitDoc, fitToDocument]
  );

  const handleGenerateRandomLayout = useCallback(
    (options: ProceduralLayoutOptions) => {
      const generated = generateProceduralLayout(options);
      commitDoc(() => generated);
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
      setPathStops([]);
      fitToDocument(generated);
      const totalChambers = generated.floors.reduce((s, f) => s + f.rooms.length, 0);
      setToast(
        generated.floors.length > 1
          ? `Generated ${totalChambers}-chamber, ${generated.floors.length}-floor "${generated.title}".`
          : `Generated ${totalChambers}-chamber layout "${generated.title}".`
      );
    },
    [commitDoc, fitToDocument]
  );

  const handleExportPNG = useCallback(async () => {
    try {
      await exportMapAsPNG(docRef.current, {
        darkTheme,
        includeGrid: docRef.current.grid.showGrid,
        includeLabels: true,
        includePath: Boolean(pathResult?.reachable),
        pathResult,
        includeSecretInReachability: includeSecretInPath,
        includeLockedInReachability: includeLockedInPath,
      });
      setToast('Exported map PNG.');
    } catch {
      setToast('Failed to export PNG.');
    }
  }, [darkTheme, includeLockedInPath, includeSecretInPath, pathResult]);

  const handleExportJSON = useCallback(() => {
    exportMapAsJSON(docRef.current);
    setToast('Exported map JSON.');
  }, []);

  const handleImportJSON = useCallback(
    async (file: File) => {
      try {
        const imported = await importMapFromJSON(file);
        commitDoc(() => imported);
          setSelectedRoomId(null);
        setSelectedDoorId(null);
        setSelectedSecretPassageId(null);
        setSelectedSliceId(null);
        setPathStops([]);
        fitToDocument(imported);
        setToast(`Loaded "${imported.title}".`);
      } catch (err) {
        setToast(err instanceof Error ? err.message : 'Invalid JSON map file.');
      }
    },
    [commitDoc, fitToDocument]
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      onRename(title);
    },
    [onRename]
  );

  const handleToggleTheme = useCallback(() => setDarkTheme((d) => !d), []);
  const handleOpenGenerator = useCallback(() => setGeneratorOpen(true), []);
  const handleCloseGenerator = useCallback(() => setGeneratorOpen(false), []);

  const handleCanvasSelectRoom = useCallback((id: string | null) => {
    setSelectedRoomId(id);
    if (id) {
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
    }
  }, []);

  const handleCanvasSelectDoor = useCallback((id: string | null) => {
    setSelectedDoorId(id);
    if (id) {
      setSelectedRoomId(null);
      setSelectedSecretPassageId(null);
      setSelectedSliceId(null);
    }
  }, []);

  const handleCanvasSelectSecretPassage = useCallback((id: string | null) => {
    setSelectedSecretPassageId(id);
    if (id) {
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSliceId(null);
    }
  }, []);

  const handleCanvasSelectSlice = useCallback((id: string | null) => {
    setSelectedSliceId(id);
    if (id) {
      setSelectedRoomId(null);
      setSelectedDoorId(null);
      setSelectedSecretPassageId(null);
    }
  }, []);

  const handleToggleSnap = useCallback(() => {
    patchDocWithoutHistory((prev) => ({
      ...prev,
      grid: { ...prev.grid, snapToGrid: !prev.grid.snapToGrid },
    }));
  }, [patchDocWithoutHistory]);

  const handleToggleRotationSnap = useCallback(() => {
    setRotationSnap((prev) => !prev);
  }, []);

  const handleToggleAutoConnectDoors = useCallback(() => {
    patchDocWithoutHistory((prev) => ({
      ...prev,
      autoConnectDoors: !prev.autoConnectDoors,
    }));
  }, [patchDocWithoutHistory]);

  const handleToggleLinkOverlappingNodes = useCallback(() => {
    setLinkOverlappingNodes((prev) => !prev);
  }, []);

  return (
    <div ref={rootRef}
      className="kc-root h-full w-full overflow-hidden flex flex-col bg-[#F4F1EA] dark:bg-[#22242A] text-stone-900 dark:text-stone-100">
      <TopBar
        title={displayName}
        floorLabel={doc.floorLabel}
        onTitleChange={handleTitleChange}
        canUndo={past.length > 0 || historyState.preDragDoc !== null}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        darkTheme={darkTheme}
        onToggleTheme={handleToggleTheme}
        onOpenGenerator={handleOpenGenerator}
        onQuickGenerate={handleGenerateRandomLayout}
        onLoadPreset={handleLoadPreset}
        savedMaps={library}
        activeSavedMapId={activeEntryId}
        hasUnsavedChanges={false}
        embedded
        contextLabel={contextLabel}
        onSaveMap={handleSaveMap}
        onSaveAsNewMap={handleSaveAsNewMap}
        onSelectSavedMap={handleSelectSavedMap}
        onRenameSavedMap={handleRenameSavedMap}
        onDeleteSavedMap={handleDeleteSavedMap}
        onExportPNG={handleExportPNG}
        onExportJSON={handleExportJSON}
        onImportJSON={handleImportJSON}
      />

      <FloorBar
        floors={doc.floors}
        activeFloorId={doc.activeFloorId}
        stairLinks={doc.stairLinks}
        inaccessibleCountByFloor={accessibility.inaccessibleCountByFloor}
        onSelectFloor={handleSelectFloor}
        onAddFloor={handleAddFloor}
        onRenameFloor={handleRenameFloor}
        onDeleteFloor={handleDeleteFloor}
      />

      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <Toolbar activeTool={activeTool} onSelectTool={setActiveTool} />

        <MapCanvas
          doc={doc}
          darkTheme={darkTheme}
          activeTool={activeTool}
          onSwitchTool={setActiveTool}
          viewport={viewport}
          onViewportChange={setViewport}
          selectedRoomId={selectedRoomId}
          selectedDoorId={selectedDoorId}
          selectedSecretPassageId={selectedSecretPassageId}
          selectedSliceId={selectedSliceId}
          onSelectRoom={handleCanvasSelectRoom}
          onSelectDoor={handleCanvasSelectDoor}
          onSelectSecretPassage={handleCanvasSelectSecretPassage}
          onSelectSlice={handleCanvasSelectSlice}
          activeSliceMode={activeSliceMode}
          onChangeActiveSliceMode={setActiveSliceMode}
          onAddSlice={handleAddSlice}
          onSlicesLivePreview={handleSlicesLivePreview}
          onSlicesCommit={handleSlicesCommit}
          onUpdateSlice={handleUpdateSlice}
          onDeleteSlice={handleDeleteSlice}
          onInsertSliceEdgeVertex={handleInsertSliceEdgeVertex}
          onDeleteSliceVertex={handleDeleteSliceVertex}
          onRoomsCommit={handleRoomsCommit}
          onRoomsLivePreview={handleRoomsLivePreview}
          onCancelLivePreview={handleCancelLivePreview}
          onAddRoom={handleAddRoom}
          onDeleteRoom={handleDeleteRoom}
          onToggleRoomUnwalled={handleToggleRoomUnwalled}
          onRenameRoom={handleRenameRoom}
          onSetRoomFloorMaterial={handleSetRoomFloorMaterial}
          onToggleRoomRotateStairTexture={handleToggleRoomRotateStairTexture}
          onImportRoomCustomTexture={handleImportRoomCustomTexture}
          onApplyRoomCustomTexture={handleApplyRoomCustomTexture}
          onUpdateCustomTextureTileSize={handleUpdateCustomTextureTileSize}
          onDeleteCustomTexture={handleDeleteCustomTexture}
          onToast={setToast}
          onInsertEdgeVertex={handleInsertEdgeVertex}
          onDeleteRoomVertex={handleDeleteRoomVertex}
          onToggleDoorway={handleToggleDoorway}
          onUpdateDoorway={handleUpdateDoorway}
          onDeleteDoorway={handleDeleteDoorway}
          onDoorwaysLivePreview={handleDoorwaysLivePreview}
          onDoorwaysCommit={handleDoorwaysCommit}
          onAddDoorwayAtPoint={handleAddDoorwayAtPoint}
          activeDoorKind={activeDoorKind}
          onChangeActiveDoorKind={setActiveDoorKind}
          onAddSecretPassage={handleAddSecretPassage}
          onSecretPassagesLivePreview={handleSecretPassagesLivePreview}
          onSecretPassagesCommit={handleSecretPassagesCommit}
          onDeleteSecretPassage={handleDeleteSecretPassage}
          onPathRoomTap={handlePathRoomTap}
          pathStops={pathStops}
          pathResult={pathResult}
          accessibility={accessibility}
          onJumpToFloorAndRoom={handleJumpToFloorAndRoom}
          onToggleRoomTagSetting={handleToggleRoomTagSetting}
          onCreateStairLink={handleCreateStairLink}
          onDeleteStairLink={handleDeleteStairLink}
          onToggleSnap={handleToggleSnap}
          rotationSnap={rotationSnap}
          onToggleRotationSnap={handleToggleRotationSnap}
          onToggleAutoConnectDoors={handleToggleAutoConnectDoors}
          linkOverlappingNodes={linkOverlappingNodes}
          onToggleLinkOverlappingNodes={handleToggleLinkOverlappingNodes}
          onFitToScreen={handleFitToScreen}
        />
      </div>

      <GeneratorModal
        open={generatorOpen}
        onClose={handleCloseGenerator}
        onGenerate={handleGenerateRandomLayout}
      />

      {toast && (
        <div
          role="status"
          className="kc-popover-in fixed bottom-18 lg:bottom-5 right-4 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-stone-900 dark:bg-[#18191D] text-white text-xs font-medium shadow-xl border border-stone-700/80 dark:border-[#2E313A] pointer-events-none"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 shrink-0" aria-hidden="true" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
