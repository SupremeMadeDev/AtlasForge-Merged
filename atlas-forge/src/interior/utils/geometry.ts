import {
  AccessibilityDiagnostics,
  Doorway,
  MapFloor,
  PathResult,
  PathStep,
  PathStop,
  Point,
  Room,
  SecretPassage,
  SliceMode,
  SliceRegion,
  StairLink,
  WallHighlight,
} from '../types/map';

// ---------------------------------------------------------------------------
// Geometry Caching (WeakMap keyed by room.points array reference)
// ---------------------------------------------------------------------------

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface SubSegment {
  a: Point;
  b: Point;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface RoomGeoCache {
  curvesRef: number[];
  svgPath?: string;
  sampled: Map<number, Point[]>;
  bbox?: BoundingBox;
  areaPx?: number;
  labelAnchor?: Point;
  edgeSegs: Map<number, SubSegment[][]>;
}

const roomCache = new WeakMap<Point[], RoomGeoCache>();

function getRoomCache(room: Pick<Room, 'points' | 'edgeCurves'>): RoomGeoCache {
  let entry = roomCache.get(room.points);
  if (!entry || entry.curvesRef !== room.edgeCurves) {
    entry = {
      curvesRef: room.edgeCurves,
      sampled: new Map(),
      edgeSegs: new Map(),
    };
    roomCache.set(room.points, entry);
  }
  return entry;
}

/**
 * Lightweight Binary Min-Heap for fast O(log N) A* and Dijkstra open sets.
 */
class MinHeap<T> {
  private data: T[] = [];
  private getScore: (item: T) => number;

  constructor(getScore: (item: T) => number) {
    this.getScore = getScore;
  }

  get size(): number {
    return this.data.length;
  }

  push(item: T): void {
    const arr = this.data;
    arr.push(item);
    let idx = arr.length - 1;
    const score = this.getScore(item);
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (score >= this.getScore(arr[parent])) break;
      arr[idx] = arr[parent];
      idx = parent;
    }
    arr[idx] = item;
  }

  pop(): T | undefined {
    const arr = this.data;
    const len = arr.length;
    if (len === 0) return undefined;
    const top = arr[0];
    const last = arr.pop()!;
    if (len > 1) {
      let idx = 0;
      const lastScore = this.getScore(last);
      const half = (len - 1) >> 1;
      while (idx < half) {
        let child = (idx << 1) + 1;
        const right = child + 1;
        if (right < len - 1 && this.getScore(arr[right]) < this.getScore(arr[child])) {
          child = right;
        }
        if (lastScore <= this.getScore(arr[child])) break;
        arr[idx] = arr[child];
        idx = child;
      }
      arr[idx] = last;
    }
    return top;
  }
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function snapValue(val: number, step: number): number {
  return Math.round(val / step) * step;
}

export function snapPoint(p: Point, cellSize: number, snap: boolean): Point {
  if (!snap) return p;
  const subStep = cellSize / 2;
  return {
    x: snapValue(p.x, subStep),
    y: snapValue(p.y, subStep),
  };
}

export function snapPointFullGrid(p: Point, cellSize: number, snap: boolean): Point {
  if (!snap) return p;
  return {
    x: snapValue(p.x, cellSize),
    y: snapValue(p.y, cellSize),
  };
}

export function getEdgeControlPoint(a: Point, b: Point, bend: number): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4 || Math.abs(bend) < 1e-3) {
    return { x: mx, y: my };
  }
  const nx = -dy / len;
  const ny = dx / len;
  return {
    x: mx + nx * bend,
    y: my + ny * bend,
  };
}

export function getEdgeHandlePoint(a: Point, b: Point, bend: number): Point {
  const ctrl = getEdgeControlPoint(a, b, bend);
  return {
    x: 0.25 * a.x + 0.5 * ctrl.x + 0.25 * b.x,
    y: 0.25 * a.y + 0.5 * ctrl.y + 0.25 * b.y,
  };
}

export function computeRawBendFromHandle(a: Point, b: Point, handlePos: Point): number {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-4) return 0;
  const nx = -dy / len;
  const ny = dx / len;
  const proj = (handlePos.x - mx) * nx + (handlePos.y - my) * ny;
  return proj * 2;
}

export function computeBendFromHandle(a: Point, b: Point, handlePos: Point): number {
  const bend = computeRawBendFromHandle(a, b, handlePos);
  return Math.abs(bend) < 6 ? 0 : bend;
}

export const NODE_OVERLAP_TOLERANCE = 8;

export interface LinkedVertexTarget {
  roomId: string;
  vertexIndex: number;
}

export interface LinkedVertexOrigTarget {
  roomId: string;
  vertexIndex: number;
  origPt: Point;
}

export interface LinkedEdgeTarget {
  roomId: string;
  edgeIndex: number;
}

export function findOverlappingRoomVertices(
  rooms: Room[],
  pt: Point,
  tolerance = NODE_OVERLAP_TOLERANCE
): LinkedVertexTarget[] {
  const matches: LinkedVertexTarget[] = [];
  for (const r of rooms) {
    for (let vIdx = 0; vIdx < r.points.length; vIdx++) {
      if (distance(r.points[vIdx], pt) <= tolerance) {
        matches.push({ roomId: r.id, vertexIndex: vIdx });
      }
    }
  }
  return matches;
}

export function findOverlappingCurveEdges(
  rooms: Room[],
  handlePt: Point,
  tolerance = NODE_OVERLAP_TOLERANCE
): LinkedEdgeTarget[] {
  const matches: LinkedEdgeTarget[] = [];
  for (const r of rooms) {
    const n = r.points.length;
    if (n < 3) continue;
    for (let eIdx = 0; eIdx < n; eIdx++) {
      const a = r.points[eIdx];
      const b = r.points[(eIdx + 1) % n];
      const bend = r.edgeCurves[eIdx] ?? 0;
      const eHandle = getEdgeHandlePoint(a, b, bend);
      if (distance(eHandle, handlePt) <= tolerance) {
        matches.push({ roomId: r.id, edgeIndex: eIdx });
      }
    }
  }
  return matches;
}

export function applyLinkedVertexMove(
  rooms: Room[],
  linkedVertices: LinkedVertexTarget[],
  targetPt: Point
): Room[] {
  const byRoom = new Map<string, Set<number>>();
  for (const item of linkedVertices) {
    let set = byRoom.get(item.roomId);
    if (!set) {
      set = new Set<number>();
      byRoom.set(item.roomId, set);
    }
    set.add(item.vertexIndex);
  }
  return rooms.map((r) => {
    const vertSet = byRoom.get(r.id);
    if (!vertSet || vertSet.size === 0) return r;
    const pts = r.points.map((p, idx) =>
      vertSet.has(idx) ? { x: targetPt.x, y: targetPt.y } : p
    );
    return { ...r, points: pts };
  });
}

export function applyLinkedCurveBend(
  rooms: Room[],
  primaryRoomId: string,
  primaryEdgeIndex: number,
  linkedEdges: LinkedEdgeTarget[],
  worldPt: Point
): { rooms: Room[]; primaryBend: number } {
  const primaryRoom = rooms.find((r) => r.id === primaryRoomId);
  if (!primaryRoom || primaryRoom.points.length < 3) {
    return { rooms, primaryBend: 0 };
  }
  const safePrimaryEdge = Math.max(0, Math.min(primaryRoom.points.length - 1, primaryEdgeIndex));
  const pa = primaryRoom.points[safePrimaryEdge];
  const pb = primaryRoom.points[(safePrimaryEdge + 1) % primaryRoom.points.length];
  const primaryBend = Math.round(computeBendFromHandle(pa, pb, worldPt));
  const targetHandlePt = getEdgeHandlePoint(pa, pb, primaryBend);

  const byRoom = new Map<string, Set<number>>();
  for (const item of linkedEdges) {
    let set = byRoom.get(item.roomId);
    if (!set) {
      set = new Set<number>();
      byRoom.set(item.roomId, set);
    }
    set.add(item.edgeIndex);
  }
  let primarySet = byRoom.get(primaryRoomId);
  if (!primarySet) {
    primarySet = new Set<number>();
    byRoom.set(primaryRoomId, primarySet);
  }
  primarySet.add(safePrimaryEdge);

  const nextRooms = rooms.map((r) => {
    const edgeSet = byRoom.get(r.id);
    if (!edgeSet || edgeSet.size === 0) return r;
    const curves = [...r.edgeCurves];
    for (const eIdx of edgeSet) {
      if (eIdx < 0 || eIdx >= r.points.length) continue;
      if (r.id === primaryRoomId && eIdx === safePrimaryEdge) {
        curves[eIdx] = primaryBend;
      } else {
        const oa = r.points[eIdx];
        const ob = r.points[(eIdx + 1) % r.points.length];
        const raw = Math.round(computeRawBendFromHandle(oa, ob, targetHandlePt));
        curves[eIdx] = primaryBend === 0 && Math.abs(raw) < 6 ? 0 : raw;
      }
    }
    return { ...r, edgeCurves: curves };
  });

  return { rooms: nextRooms, primaryBend };
}

export function applyLinkedEdgeMove(
  rooms: Room[],
  primaryRoomId: string,
  primaryEdgeIndex: number,
  primaryOrigPoints: Point[],
  linkedVertices: LinkedVertexOrigTarget[],
  dx: number,
  dy: number
): Room[] {
  const byRoom = new Map<string, Map<number, Point>>();
  const addTarget = (roomId: string, vertexIndex: number, origPt: Point) => {
    let roomMap = byRoom.get(roomId);
    if (!roomMap) {
      roomMap = new Map<number, Point>();
      byRoom.set(roomId, roomMap);
    }
    if (!roomMap.has(vertexIndex)) {
      roomMap.set(vertexIndex, origPt);
    }
  };

  const n = primaryOrigPoints.length;
  if (n > 0) {
    const i1 = primaryEdgeIndex;
    const i2 = (primaryEdgeIndex + 1) % n;
    addTarget(primaryRoomId, i1, primaryOrigPoints[i1]);
    addTarget(primaryRoomId, i2, primaryOrigPoints[i2]);
  }
  for (const item of linkedVertices) {
    addTarget(item.roomId, item.vertexIndex, item.origPt);
  }

  return rooms.map((r) => {
    const roomMap = byRoom.get(r.id);
    if (!roomMap || roomMap.size === 0) return r;
    const nextPts = r.points.map((p, idx) => {
      const origPt = roomMap.get(idx);
      return origPt ? { x: origPt.x + dx, y: origPt.y + dy } : p;
    });
    return { ...r, points: nextPts };
  });
}

export function evalQuadBezier(a: Point, ctrl: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
  };
}

export function getEdgePositionAndAngleAtT(
  room: Pick<Room, 'points' | 'edgeCurves'>,
  edgeIndex: number,
  t: number
): { position: Point; angle: number } {
  const a = room.points[edgeIndex];
  const b = room.points[(edgeIndex + 1) % room.points.length];
  if (!a || !b) return { position: { x: 0, y: 0 }, angle: 0 };
  const clampedT = Math.max(0, Math.min(1, t));
  const bend = room.edgeCurves[edgeIndex] ?? 0;
  if (Math.abs(bend) <= 0.5) {
    return {
      position: {
        x: a.x + (b.x - a.x) * clampedT,
        y: a.y + (b.y - a.y) * clampedT,
      },
      angle: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }
  const ctrl = getEdgeControlPoint(a, b, bend);
  const pos = evalQuadBezier(a, ctrl, b, clampedT);
  const tx = 2 * (1 - clampedT) * (ctrl.x - a.x) + 2 * clampedT * (b.x - ctrl.x);
  const ty = 2 * (1 - clampedT) * (ctrl.y - a.y) + 2 * clampedT * (b.y - ctrl.y);
  const angle =
    Math.hypot(tx, ty) > 1e-4 ? Math.atan2(ty, tx) : Math.atan2(b.y - a.y, b.x - a.x);
  return { position: pos, angle };
}

export function getPointAlongRoomEdge(
  room: Pick<Room, 'points' | 'edgeCurves'>,
  edgeIndex: number,
  t: number
): Point {
  const a = room.points[edgeIndex];
  const b = room.points[(edgeIndex + 1) % room.points.length];
  const bend = room.edgeCurves[edgeIndex] ?? 0;
  if (Math.abs(bend) <= 0.5) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }
  const ctrl = getEdgeControlPoint(a, b, bend);
  return evalQuadBezier(a, ctrl, b, t);
}

export function buildRoomSvgPath(room: Pick<Room, 'points' | 'edgeCurves'>): string {
  const cache = getRoomCache(room);
  if (cache.svgPath !== undefined) return cache.svgPath;

  const pts = room.points;
  if (pts.length < 3) {
    cache.svgPath = '';
    return '';
  }
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const bend = room.edgeCurves[i] ?? 0;
    if (Math.abs(bend) > 0.5) {
      const ctrl = getEdgeControlPoint(a, b, bend);
      d += ` Q ${ctrl.x.toFixed(2)} ${ctrl.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    } else {
      d += ` L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }
  }
  d += ' Z';
  cache.svgPath = d;
  return d;
}

export function buildRoomWallPath(
  room: Pick<Room, 'points' | 'edgeCurves' | 'hiddenEdges' | 'unwalled'>
): string {
  if (room.unwalled) return '';
  const hidden = room.hiddenEdges;
  if (!hidden || !hidden.some(Boolean)) {
    return buildRoomSvgPath(room);
  }
  const pts = room.points;
  if (pts.length < 3) return '';
  let d = '';
  let penUp = true;
  for (let i = 0; i < pts.length; i++) {
    if (hidden[i]) {
      penUp = true;
      continue;
    }
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (penUp) {
      d += `${d ? ' ' : ''}M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`;
      penUp = false;
    }
    const bend = room.edgeCurves[i] ?? 0;
    if (Math.abs(bend) > 0.5) {
      const ctrl = getEdgeControlPoint(a, b, bend);
      d += ` Q ${ctrl.x.toFixed(2)} ${ctrl.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    } else {
      d += ` L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }
  }
  return d;
}

export function buildRoomHiddenWallPath(
  room: Pick<Room, 'points' | 'edgeCurves' | 'hiddenEdges'>
): string {
  const hidden = room.hiddenEdges;
  if (!hidden || !hidden.some(Boolean)) return '';
  const pts = room.points;
  if (pts.length < 3) return '';
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    if (!hidden[i]) continue;
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    d += `${d ? ' ' : ''}M ${a.x.toFixed(2)} ${a.y.toFixed(2)}`;
    const bend = room.edgeCurves[i] ?? 0;
    if (Math.abs(bend) > 0.5) {
      const ctrl = getEdgeControlPoint(a, b, bend);
      d += ` Q ${ctrl.x.toFixed(2)} ${ctrl.y.toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    } else {
      d += ` L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }
  }
  return d;
}

export function sampleRoomPolygon(
  room: Pick<Room, 'points' | 'edgeCurves'>,
  curveSubdivisions = 12
): Point[] {
  const cache = getRoomCache(room);
  const cached = cache.sampled.get(curveSubdivisions);
  if (cached) return cached;

  const pts = room.points;
  const sampled: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const bend = room.edgeCurves?.[i] ?? 0;
    sampled.push(a);
    if (Math.abs(bend) > 0.5) {
      const ctrl = getEdgeControlPoint(a, b, bend);
      for (let s = 1; s < curveSubdivisions; s++) {
        sampled.push(evalQuadBezier(a, ctrl, b, s / curveSubdivisions));
      }
    }
  }
  cache.sampled.set(curveSubdivisions, sampled);
  return sampled;
}

function getRoomBoundingBox(room: Pick<Room, 'points' | 'edgeCurves'>): BoundingBox {
  const cache = getRoomCache(room);
  if (cache.bbox) return cache.bbox;
  const poly = sampleRoomPolygon(room, 8);
  cache.bbox = getPolygonBoundingBox(poly);
  return cache.bbox;
}

export function polygonAreaPx(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum) / 2;
}

export function getRoomAreaSqFt(
  room: Pick<Room, 'points' | 'edgeCurves'>,
  cellSize: number,
  feetPerCell: number
): number {
  const cache = getRoomCache(room);
  if (cache.areaPx === undefined) {
    const sampled = sampleRoomPolygon(room, 10);
    cache.areaPx = polygonAreaPx(sampled);
  }
  const sqPerCell = cache.areaPx / (cellSize * cellSize);
  return Math.round(sqPerCell * feetPerCell * feetPerCell);
}

export function pointInPolygon(pt: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function getPolygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const cross = p1.x * p2.y - p2.x * p1.y;
    area += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-4) {
    const sx = points.reduce((acc, p) => acc + p.x, 0) / points.length;
    const sy = points.reduce((acc, p) => acc + p.y, 0) / points.length;
    return { x: sx, y: sy };
  }
  return {
    x: cx / (6 * area),
    y: cy / (6 * area),
  };
}

export function getRoomLabelAnchor(room: Pick<Room, 'points' | 'edgeCurves'>): Point {
  const cache = getRoomCache(room);
  if (cache.labelAnchor) return cache.labelAnchor;

  const sampled = sampleRoomPolygon(room, 8);
  const centroid = getPolygonCentroid(sampled);
  if (pointInPolygon(centroid, sampled)) {
    cache.labelAnchor = centroid;
    return centroid;
  }

  const bbox = getRoomBoundingBox(room);
  let bestPt = centroid;
  let bestDist = -1;
  const steps = 9;
  for (let gx = 1; gx < steps; gx++) {
    for (let gy = 1; gy < steps; gy++) {
      const candidate = {
        x: bbox.minX + (bbox.width * gx) / steps,
        y: bbox.minY + (bbox.height * gy) / steps,
      };
      if (pointInPolygon(candidate, sampled)) {
        const d = minDistToBoundary(candidate, sampled);
        if (d > bestDist) {
          bestDist = d;
          bestPt = candidate;
        }
      }
    }
  }
  cache.labelAnchor = bestPt;
  return bestPt;
}

export function minDistToBoundary(pt: Point, poly: Point[]): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = pointToSegmentDistance(pt, poly[i], poly[(i + 1) % poly.length]).dist;
    if (d < minD) minD = d;
  }
  return minD;
}

export function getPolygonBoundingBox(points: Point[]): BoundingBox {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function computeFocusViewportForBox(
  box: BoundingBox,
  viewW: number,
  viewH: number
): { x: number; y: number; zoom: number } {
  const safeW = Math.max(320, viewW);
  const safeH = Math.max(280, viewH);
  const availW = Math.max(180, safeW - 140);
  const availH = Math.max(180, safeH - 170);
  const fitW = Math.max(box.width, 80);
  const fitH = Math.max(box.height, 80);
  const rawZoom = Math.min(availW / fitW, availH / fitH) * 0.65;
  const targetZoom = Math.min(1.85, Math.max(0.35, rawZoom));
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  return {
    zoom: targetZoom,
    x: safeW / 2 - cx * targetZoom,
    y: safeH / 2 + 10 - cy * targetZoom,
  };
}

export function getOrientedStairBox(room: Room): {
  box: BoundingBox;
  center: Point;
  rotationDeg: number;
} {
  const sampled = sampleRoomPolygon(room, 6);
  const rawBox = getPolygonBoundingBox(sampled);
  const center: Point = {
    x: (rawBox.minX + rawBox.maxX) / 2,
    y: (rawBox.minY + rawBox.maxY) / 2,
  };
  const shouldRotate = room.rotateStairTexture !== false;
  const rawRot = shouldRotate ? (room.rotationDeg ?? 0) : 0;
  const normalizedRot = ((rawRot % 360) + 360) % 360;
  const rotationDeg =
    Math.abs(normalizedRot) < 1e-4 || Math.abs(normalizedRot - 360) < 1e-4
      ? 0
      : normalizedRot;
  if (rotationDeg === 0 || sampled.length === 0) {
    return { box: rawBox, center, rotationDeg: 0 };
  }
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const unrotated = sampled.map((p) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos,
    };
  });
  return {
    box: getPolygonBoundingBox(unrotated),
    center,
    rotationDeg,
  };
}

export function pointToSegmentDistance(
  p: Point,
  a: Point,
  b: Point
): { dist: number; closest: Point; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return { dist: distance(p, a), closest: a, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const closest = { x: a.x + t * dx, y: a.y + t * dy };
  return { dist: distance(p, closest), closest, t };
}

function makeSubSeg(a: Point, b: Point): SubSegment {
  return {
    a,
    b,
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function getAllEdgeSubSegments(room: Room, subdivisions = 8): SubSegment[][] {
  const cache = getRoomCache(room);
  const existing = cache.edgeSegs.get(subdivisions);
  if (existing) return existing;

  const all: SubSegment[][] = [];
  for (let edgeIndex = 0; edgeIndex < room.points.length; edgeIndex++) {
    const a = room.points[edgeIndex];
    const b = room.points[(edgeIndex + 1) % room.points.length];
    const bend = room.edgeCurves[edgeIndex] ?? 0;
    if (Math.abs(bend) <= 0.5) {
      all.push([makeSubSeg(a, b)]);
    } else {
      const ctrl = getEdgeControlPoint(a, b, bend);
      const segs: SubSegment[] = [];
      let prev = a;
      for (let s = 1; s <= subdivisions; s++) {
        const next = evalQuadBezier(a, ctrl, b, s / subdivisions);
        segs.push(makeSubSeg(prev, next));
        prev = next;
      }
      all.push(segs);
    }
  }
  cache.edgeSegs.set(subdivisions, all);
  return all;
}

function getEdgeSubSegments(
  room: Room,
  edgeIndex: number,
  subdivisions = 8
): SubSegment[] {
  return getAllEdgeSubSegments(room, subdivisions)[edgeIndex] ?? [];
}

export function findClosestRoomEdge(
  room: Room,
  pt: Point,
  includeHidden = false
): { edgeIndex: number; dist: number; closest: Point; angle: number; t: number } {
  const allSegs = getAllEdgeSubSegments(room, 16);
  const hasVisibleEdge =
    !room.unwalled && room.points.some((_, idx) => !room.hiddenEdges?.[idx]);
  let best = {
    edgeIndex: 0,
    dist: Infinity,
    closest: pt,
    angle: 0,
    t: 0.5,
  };
  for (let i = 0; i < allSegs.length; i++) {
    if (!includeHidden && hasVisibleEdge && room.hiddenEdges?.[i]) continue;
    const subSegs = allSegs[i];
    const subCount = Math.max(1, subSegs.length);
    for (let j = 0; j < subSegs.length; j++) {
      const seg = subSegs[j];
      const res = pointToSegmentDistance(pt, seg.a, seg.b);
      if (res.dist < best.dist) {
        const rawT = (j + res.t) / subCount;
        const bend = room.edgeCurves[i] ?? 0;
        if (Math.abs(bend) > 0.5) {
          const midPt = getPointAlongRoomEdge(room, i, 0.5);
          const snappedT = distance(res.closest, midPt) <= 6 ? 0.5 : rawT;
          const exact = getEdgePositionAndAngleAtT(room, i, snappedT);
          best = {
            edgeIndex: i,
            dist: res.dist,
            closest: exact.position,
            angle: exact.angle,
            t: snappedT,
          };
        } else {
          best = {
            edgeIndex: i,
            dist: res.dist,
            closest: res.closest,
            angle: Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x),
            t: rawT,
          };
        }
      }
    }
  }
  return best;
}

export function getOutwardWallNormal(room: Room, wallPt: Point): Point {
  const edge = findClosestRoomEdge(room, wallPt);
  const tx = Math.cos(edge.angle);
  const ty = Math.sin(edge.angle);
  const n1 = { x: -ty, y: tx };
  const n2 = { x: ty, y: -tx };
  const poly = sampleRoomPolygon(room, 8);
  const test1 = { x: edge.closest.x + n1.x * 6, y: edge.closest.y + n1.y * 6 };
  return pointInPolygon(test1, poly) ? n2 : n1;
}

export function resolveSecretPassagePolyline(
  passage: Pick<
    SecretPassage,
    | 'fromRoomId'
    | 'toRoomId'
    | 'startAnchor'
    | 'startProtrusion'
    | 'endAnchor'
    | 'endProtrusion'
    | 'midPoints'
  >,
  rooms: Room[]
): {
  points: Point[];
  startAnchor: Point;
  startElbow: Point;
  endElbow: Point | null;
  endAnchor: Point;
  startNormal: Point;
  endNormal: Point | null;
} {
  const fromRoom = rooms.find((r) => r.id === passage.fromRoomId);
  const toRoom = passage.toRoomId
    ? rooms.find((r) => r.id === passage.toRoomId)
    : undefined;

  let startAnchor = passage.startAnchor;
  let startNormal: Point = { x: 0, y: -1 };
  if (fromRoom) {
    const edge = findClosestRoomEdge(fromRoom, passage.startAnchor);
    startAnchor = edge.closest;
    startNormal = getOutwardWallNormal(fromRoom, startAnchor);
  }

  const startProt = Math.max(14, passage.startProtrusion);
  const startElbow: Point = {
    x: startAnchor.x + startNormal.x * startProt,
    y: startAnchor.y + startNormal.y * startProt,
  };

  if (toRoom) {
    const endEdge = findClosestRoomEdge(toRoom, passage.endAnchor);
    const endAnchor = endEdge.closest;
    const endNormal = getOutwardWallNormal(toRoom, endAnchor);
    const endProt = Math.max(14, passage.endProtrusion);
    const endElbow: Point = {
      x: endAnchor.x + endNormal.x * endProt,
      y: endAnchor.y + endNormal.y * endProt,
    };
    const points = [
      startAnchor,
      startElbow,
      ...passage.midPoints,
      endElbow,
      endAnchor,
    ];
    return {
      points,
      startAnchor,
      startElbow,
      endElbow,
      endAnchor,
      startNormal,
      endNormal,
    };
  }

  const hasCustomTail =
    passage.midPoints.length > 0 || distance(startElbow, passage.endAnchor) > 8;
  const points = hasCustomTail
    ? [startAnchor, startElbow, ...passage.midPoints, passage.endAnchor]
    : [startAnchor, startElbow];

  return {
    points,
    startAnchor,
    startElbow,
    endElbow: null,
    endAnchor: hasCustomTail ? passage.endAnchor : startElbow,
    startNormal,
    endNormal: null,
  };
}

function detectSegmentSharedContact(
  sA: SubSegment,
  sB: SubSegment,
  tolerance: number
): {
  mid: Point;
  segStart: Point;
  segEnd: Point;
  angle: number;
  overlapLen: number;
  gap: number;
} | null {
  // Fast AABB rejection before any trig or vector projections
  if (
    sA.maxX + tolerance < sB.minX ||
    sB.maxX + tolerance < sA.minX ||
    sA.maxY + tolerance < sB.minY ||
    sB.maxY + tolerance < sA.minY
  ) {
    return null;
  }

  const a1 = sA.a;
  const a2 = sA.b;
  const b1 = sB.a;
  const b2 = sB.b;

  const adx = a2.x - a1.x;
  const ady = a2.y - a1.y;
  const aLen = Math.hypot(adx, ady);
  if (aLen < 16) return null;

  const bdx = b2.x - b1.x;
  const bdy = b2.y - b1.y;
  const bLen = Math.hypot(bdx, bdy);
  if (bLen < 16) return null;

  const ux = adx / aLen;
  const uy = ady / aLen;
  const vx = bdx / bLen;
  const vy = bdy / bLen;

  const parallelDot = Math.abs(ux * vx + uy * vy);
  if (parallelDot < 0.92) return null;

  const nx = -uy;
  const ny = ux;

  const b1Along = (b1.x - a1.x) * ux + (b1.y - a1.y) * uy;
  const b1Perp = (b1.x - a1.x) * nx + (b1.y - a1.y) * ny;

  const b2Along = (b2.x - a1.x) * ux + (b2.y - a1.y) * uy;
  const b2Perp = (b2.x - a1.x) * nx + (b2.y - a1.y) * ny;

  const avgPerp = Math.abs((b1Perp + b2Perp) / 2);
  const minPerp = Math.min(Math.abs(b1Perp), Math.abs(b2Perp));
  if (avgPerp > tolerance && minPerp > tolerance) return null;

  const start = Math.max(0, Math.min(b1Along, b2Along));
  const end = Math.min(aLen, Math.max(b1Along, b2Along));
  const overlapLen = end - start;

  if (overlapLen < 22) return null;

  const midAlong = (start + end) / 2;
  const ptOnA = { x: a1.x + ux * midAlong, y: a1.y + uy * midAlong };
  const denom = b2Along - b1Along;
  const frac = Math.abs(denom) > 1e-4 ? (midAlong - b1Along) / denom : 0.5;
  const perpAtMid = b1Perp + frac * (b2Perp - b1Perp);
  if (Math.abs(perpAtMid) > tolerance) return null;

  const halfOffset = perpAtMid / 2;
  const segStart = {
    x: a1.x + ux * start + nx * halfOffset,
    y: a1.y + uy * start + ny * halfOffset,
  };
  const segEnd = {
    x: a1.x + ux * end + nx * halfOffset,
    y: a1.y + uy * end + ny * halfOffset,
  };
  const mid = {
    x: ptOnA.x + nx * halfOffset,
    y: ptOnA.y + ny * halfOffset,
  };

  return {
    mid,
    segStart,
    segEnd,
    angle: Math.atan2(uy, ux),
    overlapLen,
    gap: Math.abs(perpAtMid),
  };
}

export function getAutoPairKey(
  roomAId: string,
  roomBId: string,
  edgeAIndex: number,
  edgeBIndex: number
): string {
  if (roomAId < roomBId) {
    return `${roomAId}:${edgeAIndex}__${roomBId}:${edgeBIndex}`;
  }
  return `${roomBId}:${edgeBIndex}__${roomAId}:${edgeAIndex}`;
}

export function getDoorwayWallT(
  room: Pick<Room, 'points' | 'edgeCurves'>,
  edgeIndex: number,
  pt: Point
): number {
  const safeIdx = Math.max(0, Math.min(room.points.length - 1, edgeIndex));
  const a = room.points[safeIdx];
  const b = room.points[(safeIdx + 1) % room.points.length];
  if (!a || !b) return 0.5;
  const bend = room.edgeCurves[safeIdx] ?? 0;
  if (Math.abs(bend) > 0.5) {
    const subdivisions = 24;
    const ctrl = getEdgeControlPoint(a, b, bend);
    let bestDist = Infinity;
    let bestT = 0.5;
    let prev = a;
    for (let s = 1; s <= subdivisions; s++) {
      const next = evalQuadBezier(a, ctrl, b, s / subdivisions);
      const res = pointToSegmentDistance(pt, prev, next);
      if (res.dist < bestDist) {
        bestDist = res.dist;
        bestT = (s - 1 + res.t) / subdivisions;
      }
      prev = next;
    }
    return Math.max(0.05, Math.min(0.95, bestT));
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-4) return 0.5;
  const proj = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq;
  return Math.max(0.05, Math.min(0.95, proj));
}

export function isWallEligibleForDoorway(
  room: Pick<Room, 'points' | 'edgeCurves' | 'hiddenEdges' | 'unwalled'> | undefined,
  edgeIndex: number
): boolean {
  if (!room || room.unwalled || room.points.length < 3) return false;
  if (edgeIndex < 0 || edgeIndex >= room.points.length) return false;
  if (room.hiddenEdges?.[edgeIndex]) return false;
  const a = room.points[edgeIndex];
  const b = room.points[(edgeIndex + 1) % room.points.length];
  if (!a || !b) return false;
  return distance(a, b) >= 16;
}

function getRoomEdgeApproxLength(
  room: Pick<Room, 'points' | 'edgeCurves'>,
  edgeIndex: number
): number {
  const safeIdx = Math.max(0, Math.min(room.points.length - 1, edgeIndex));
  const a = room.points[safeIdx];
  const b = room.points[(safeIdx + 1) % room.points.length];
  if (!a || !b) return 0;
  const bend = room.edgeCurves[safeIdx] ?? 0;
  if (Math.abs(bend) <= 0.5) {
    return distance(a, b);
  }
  const ctrl = getEdgeControlPoint(a, b, bend);
  let len = 0;
  let prev = a;
  for (let s = 1; s <= 12; s++) {
    const next = evalQuadBezier(a, ctrl, b, s / 12);
    len += distance(prev, next);
    prev = next;
  }
  return len;
}

export function clampWallTForDoor(
  room: Pick<Room, 'points' | 'edgeCurves'>,
  edgeIndex: number,
  rawT: number,
  doorWidth = 32
): number {
  const safeT = Number.isFinite(rawT) ? rawT : 0.5;
  const len = Math.max(1, getRoomEdgeApproxLength(room, edgeIndex));
  const margin = len > doorWidth + 4 ? Math.min(0.45, (doorWidth * 0.52) / len) : 0.5;
  return Math.max(margin, Math.min(1 - margin, safeT));
}

function projectPointOntoRoomEdge(
  room: Room,
  edgeIndex: number,
  pt: Point
): { dist: number; t: number; closest: Point; angle: number } {
  const safeIdx = Math.max(0, Math.min(room.points.length - 1, edgeIndex));
  const a = room.points[safeIdx];
  const b = room.points[(safeIdx + 1) % room.points.length];
  if (!a || !b) {
    return { dist: Infinity, t: 0.5, closest: pt, angle: 0 };
  }
  const bend = room.edgeCurves[safeIdx] ?? 0;
  if (Math.abs(bend) > 0.5) {
    const subSegs = getEdgeSubSegments(room, safeIdx, 20);
    const subCount = Math.max(1, subSegs.length);
    let bestDist = Infinity;
    let bestT = 0.5;
    for (let j = 0; j < subSegs.length; j++) {
      const seg = subSegs[j];
      const res = pointToSegmentDistance(pt, seg.a, seg.b);
      if (res.dist < bestDist) {
        bestDist = res.dist;
        bestT = (j + res.t) / subCount;
      }
    }
    const exact = getEdgePositionAndAngleAtT(room, safeIdx, bestT);
    return {
      dist: bestDist,
      t: bestT,
      closest: exact.position,
      angle: exact.angle,
    };
  }
  const res = pointToSegmentDistance(pt, a, b);
  return {
    dist: res.dist,
    t: res.t,
    closest: res.closest,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

export function findClosestEligibleWall(
  rooms: Room[],
  pt: Point,
  doorWidth = 32,
  preferredWall?: { roomId: string; edgeIndex: number; bias?: number }
): {
  room: Room;
  edgeIndex: number;
  dist: number;
  wallT: number;
  position: Point;
  angle: number;
} | null {
  let best: {
    room: Room;
    edgeIndex: number;
    dist: number;
    score: number;
    wallT: number;
    position: Point;
    angle: number;
  } | null = null;

  for (const r of rooms) {
    if (r.unwalled || r.points.length < 3) continue;
    for (let eIdx = 0; eIdx < r.points.length; eIdx++) {
      if (!isWallEligibleForDoorway(r, eIdx)) continue;
      const proj = projectPointOntoRoomEdge(r, eIdx, pt);
      const clampedT = clampWallTForDoor(r, eIdx, proj.t, doorWidth);
      const midPt = getPointAlongRoomEdge(r, eIdx, 0.5);
      const candPt = getPointAlongRoomEdge(r, eIdx, clampedT);
      const finalT = distance(candPt, midPt) <= 5 ? 0.5 : clampedT;
      const exact = getEdgePositionAndAngleAtT(r, eIdx, finalT);
      const isPreferred =
        preferredWall &&
        preferredWall.roomId === r.id &&
        preferredWall.edgeIndex === eIdx;
      const score = proj.dist - (isPreferred ? (preferredWall?.bias ?? 6) : 0);
      if (!best || score < best.score) {
        best = {
          room: r,
          edgeIndex: eIdx,
          dist: proj.dist,
          score,
          wallT: finalT,
          position: exact.position,
          angle: exact.angle,
        };
      }
    }
  }

  if (!best) return null;
  return {
    room: best.room,
    edgeIndex: best.edgeIndex,
    dist: best.dist,
    wallT: best.wallT,
    position: best.position,
    angle: best.angle,
  };
}

export function findTouchingOppositeWall(
  hostRoom: Room,
  hostEdgeIndex: number,
  doorPos: Point,
  allRooms: Room[],
  tolerance: number,
  preferredRoomBId?: string | null,
  preferredEdgeBIndex?: number | null
): { roomBId: string; edgeBIndex: number } | null {
  const segsA = getEdgeSubSegments(hostRoom, hostEdgeIndex, 8);
  if (segsA.length === 0) return null;

  const hostBox = getRoomBoundingBox(hostRoom);
  const posTol = Math.max(tolerance + 4, 14);
  let bestMatch: { roomBId: string; edgeBIndex: number; score: number } | null = null;

  for (const rB of allRooms) {
    if (rB.id === hostRoom.id || rB.unwalled || rB.points.length < 3) continue;
    const boxB = getRoomBoundingBox(rB);
    if (
      hostBox.maxX + tolerance < boxB.minX ||
      boxB.maxX + tolerance < hostBox.minX ||
      hostBox.maxY + tolerance < boxB.minY ||
      boxB.maxY + tolerance < hostBox.minY
    ) {
      continue;
    }

    const allSegsB = getAllEdgeSubSegments(rB, 8);
    for (let eB = 0; eB < allSegsB.length; eB++) {
      if (!isWallEligibleForDoorway(rB, eB)) continue;
      const segsB = allSegsB[eB];
      for (const sA of segsA) {
        for (const sB of segsB) {
          const contact = detectSegmentSharedContact(sA, sB, tolerance);
          if (!contact) continue;
          const distToContact = pointToSegmentDistance(
            doorPos,
            contact.segStart,
            contact.segEnd
          ).dist;
          if (distToContact > posTol) continue;
          const isPreferred =
            preferredRoomBId === rB.id && preferredEdgeBIndex === eB;
          const score =
            contact.gap + distToContact * 0.5 - (isPreferred ? 4 : 0);
          if (!bestMatch || score < bestMatch.score) {
            bestMatch = {
              roomBId: rB.id,
              edgeBIndex: eB,
              score,
            };
          }
        }
      }
    }
  }

  return bestMatch
    ? { roomBId: bestMatch.roomBId, edgeBIndex: bestMatch.edgeBIndex }
    : null;
}

export function slideDoorwayAlongWall(
  door: Doorway,
  rooms: Room[],
  targetPt: Point,
  tolerance = 24
): {
  position: Point;
  angle: number;
  roomAId: string;
  edgeAIndex: number;
  roomBId: string | null;
  edgeBIndex: number | null;
  wallT: number;
} {
  const bestWall = findClosestEligibleWall(rooms, targetPt, door.width, {
    roomId: door.roomAId,
    edgeIndex: door.edgeAIndex,
    bias: 8,
  });

  if (!bestWall) {
    return {
      position: door.position,
      angle: door.angle,
      roomAId: door.roomAId,
      edgeAIndex: door.edgeAIndex,
      roomBId: door.roomBId,
      edgeBIndex: door.edgeBIndex,
      wallT: door.wallT ?? 0.5,
    };
  }

  const opposite = findTouchingOppositeWall(
    bestWall.room,
    bestWall.edgeIndex,
    bestWall.position,
    rooms,
    tolerance,
    door.roomBId,
    door.edgeBIndex
  );

  return {
    position: bestWall.position,
    angle: bestWall.angle,
    roomAId: bestWall.room.id,
    edgeAIndex: bestWall.edgeIndex,
    roomBId: opposite?.roomBId ?? null,
    edgeBIndex: opposite?.edgeBIndex ?? null,
    wallT: bestWall.wallT,
  };
}

export function rotateRoomGeometry(
  room: Room,
  deltaDeg: number,
  center?: Point
): Room {
  if (room.points.length < 3 || Math.abs(deltaDeg) < 1e-4) return room;
  const box = getPolygonBoundingBox(room.points);
  const cx = center ? center.x : (box.minX + box.maxX) / 2;
  const cy = center ? center.y : (box.minY + box.maxY) / 2;
  const normalized = ((deltaDeg % 360) + 360) % 360;

  let cos: number;
  let sin: number;
  const isRightAngle =
    Math.abs(normalized) < 1e-4 ||
    Math.abs(normalized - 90) < 1e-4 ||
    Math.abs(normalized - 180) < 1e-4 ||
    Math.abs(normalized - 270) < 1e-4 ||
    Math.abs(normalized - 360) < 1e-4;

  if (Math.abs(normalized - 90) < 1e-4) {
    cos = 0;
    sin = 1;
  } else if (Math.abs(normalized - 180) < 1e-4) {
    cos = -1;
    sin = 0;
  } else if (Math.abs(normalized - 270) < 1e-4) {
    cos = 0;
    sin = -1;
  } else if (Math.abs(normalized) < 1e-4 || Math.abs(normalized - 360) < 1e-4) {
    return room;
  } else {
    const rad = (deltaDeg * Math.PI) / 180;
    cos = Math.cos(rad);
    sin = Math.sin(rad);
  }

  const nextPoints = room.points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    return isRightAngle
      ? { x: Math.round(rx * 2) / 2, y: Math.round(ry * 2) / 2 }
      : { x: Math.round(rx * 10) / 10, y: Math.round(ry * 10) / 10 };
  });

  const rawNextRot = (room.rotationDeg ?? 0) + deltaDeg;
  const wrappedRot = ((rawNextRot % 360) + 360) % 360;
  const cleanRot =
    Math.abs(wrappedRot - 360) < 1e-4 ? 0 : Math.round(wrappedRot * 100) / 100;

  return {
    ...room,
    points: nextPoints,
    rotationDeg: cleanRot,
  };
}

export function getRoomRotationHandleGeometry(
  room: Room,
  stemOffset = 28
): {
  center: Point;
  stemStart: Point;
  handle: Point;
  unitDir: Point;
  angleDeg: number;
} {
  const box = getPolygonBoundingBox(room.points);
  const center = {
    x: (box.minX + box.maxX) / 2,
    y: (box.minY + box.maxY) / 2,
  };
  const angleDeg = room.rotationDeg ?? 0;
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.sin(rad);
  const uy = -Math.cos(rad);
  const sampled = sampleRoomPolygon(room, 6);

  let maxT = -Infinity;
  for (let i = 0; i < sampled.length; i++) {
    const a = sampled[i];
    const b = sampled[(i + 1) % sampled.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denom = ux * dy - uy * dx;
    if (Math.abs(denom) <= 1e-6) continue;
    const rx = a.x - center.x;
    const ry = a.y - center.y;
    const t = (rx * dy - ry * dx) / denom;
    const s = (rx * uy - ry * ux) / denom;
    if (t >= 0 && s >= -1e-4 && s <= 1 + 1e-4 && t > maxT) {
      maxT = t;
    }
  }

  if (!Number.isFinite(maxT) || maxT < 0) {
    maxT = 0;
    for (const p of sampled) {
      const proj = (p.x - center.x) * ux + (p.y - center.y) * uy;
      if (proj > maxT) maxT = proj;
    }
  }

  const stemStart = {
    x: center.x + ux * maxT,
    y: center.y + uy * maxT,
  };
  const handle = {
    x: center.x + ux * (maxT + stemOffset),
    y: center.y + uy * (maxT + stemOffset),
  };

  return {
    center,
    stemStart,
    handle,
    unitDir: { x: ux, y: uy },
    angleDeg,
  };
}

function doDoorwaysOverlap(
  d1: Pick<Doorway, 'position' | 'angle' | 'width'>,
  d2: Pick<Doorway, 'position' | 'angle' | 'width'>
): boolean {
  const [a1, a2, ux1, uy1] = doorwayEndpoints(d1 as Doorway);
  const [b1, b2, ux2, uy2] = doorwayEndpoints(d2 as Doorway);
  const dot = Math.abs(ux1 * ux2 + uy1 * uy2);
  const dx = d2.position.x - d1.position.x;
  const dy = d2.position.y - d1.position.y;

  if (dot > 0.92) {
    const perpDist = Math.abs(-uy1 * dx + ux1 * dy);
    const alongDist = Math.abs(ux1 * dx + uy1 * dy);
    if (perpDist < 14 && alongDist < (d1.width + d2.width) / 2 + 2) {
      return true;
    }
  }
  if (segmentToSegmentDist(a1, a2, b1, b2) < 4) {
    return true;
  }
  return distance(d1.position, d2.position) < 22;
}

export interface ReconcileDoorwaysOptions {
  /**
   * When true (interactive editing), auto-doors are only generated on touching wall pairs
   * where neither wall already has a doorway leading into either room.
   * Procedural / preset generation passes false (default) to preserve multi-room corridor connectivity + pruning.
   */
  requireEmptyWalls?: boolean;
}

export function reconcileDoorways(
  rooms: Room[],
  existingDoorways: Doorway[],
  autoConnect: boolean,
  tolerance: number,
  suppressedKeys: string[] = [],
  options: ReconcileDoorwaysOptions = {}
): Doorway[] {
  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const suppressedSet = new Set(suppressedKeys);
  const requireEmptyWalls = Boolean(options.requireEmptyWalls);

  // Preserve ALL existing doorways (manual, auto-generated, and generated) anchored to a real visible host wall.
  const preservedDoors: Doorway[] = [];

  for (const d of existingDoorways) {
    const rA = roomMap.get(d.roomAId);
    const rB = d.roomBId ? roomMap.get(d.roomBId) : undefined;
    if (!rA && !rB) continue;

    let hostRoom: Room | null = null;
    let hostEdge = 0;
    let wallT = 0.5;

    if (rA) {
      const safeEdgeA = Math.max(0, Math.min(rA.points.length - 1, d.edgeAIndex));
      if (isWallEligibleForDoorway(rA, safeEdgeA)) {
        hostRoom = rA;
        hostEdge = safeEdgeA;
        const rawT =
          typeof d.wallT === 'number' && Number.isFinite(d.wallT)
            ? d.wallT
            : getDoorwayWallT(rA, safeEdgeA, d.position);
        wallT = clampWallTForDoor(rA, safeEdgeA, rawT, d.width);
      }
    }

    // If host wall became unwalled/hidden/invalid while opposite room has a valid wall, transfer host ownership
    if (!hostRoom && rB && d.edgeBIndex !== null && d.edgeBIndex !== undefined) {
      const safeEdgeB = Math.max(0, Math.min(rB.points.length - 1, d.edgeBIndex));
      if (isWallEligibleForDoorway(rB, safeEdgeB)) {
        hostRoom = rB;
        hostEdge = safeEdgeB;
        const proj = projectPointOntoRoomEdge(rB, safeEdgeB, d.position);
        wallT = clampWallTForDoor(rB, safeEdgeB, proj.t, d.width);
      }
    }

    // Fallback: snap to closest remaining visible wall of rA if its previous edge was hidden/removed
    if (!hostRoom && rA && !rA.unwalled) {
      const fallback = findClosestEligibleWall([rA], d.position, d.width);
      if (fallback) {
        hostRoom = fallback.room;
        hostEdge = fallback.edgeIndex;
        wallT = fallback.wallT;
      }
    }

    if (!hostRoom) continue;

    const exact = getEdgePositionAndAngleAtT(hostRoom, hostEdge, wallT);
    if (!Number.isFinite(exact.position.x) || !Number.isFinite(exact.position.y)) {
      continue;
    }

    const opposite = findTouchingOppositeWall(
      hostRoom,
      hostEdge,
      exact.position,
      rooms,
      tolerance,
      d.roomBId === hostRoom.id ? d.roomAId : d.roomBId,
      d.roomBId === hostRoom.id ? d.edgeAIndex : d.edgeBIndex
    );

    preservedDoors.push({
      ...d,
      roomAId: hostRoom.id,
      edgeAIndex: hostEdge,
      roomBId: opposite?.roomBId ?? null,
      edgeBIndex: opposite?.edgeBIndex ?? null,
      wallT,
      position: exact.position,
      angle: Number.isFinite(exact.angle) ? exact.angle : 0,
      enabled: d.enabled !== false,
    });
  }

  if (!autoConnect) {
    return preservedDoors;
  }

  // Track walls & room pairs already covered by preserved doors
  const existingAutoByPair = new Map<string, Doorway>();
  const occupiedWalls = new Set<string>();

  for (const d of preservedDoors) {
    occupiedWalls.add(`${d.roomAId}:${d.edgeAIndex}`);
    if (d.roomBId !== null && d.edgeBIndex !== null && d.edgeBIndex !== undefined) {
      occupiedWalls.add(`${d.roomBId}:${d.edgeBIndex}`);
      const pairKey = getAutoPairKey(d.roomAId, d.roomBId, d.edgeAIndex, d.edgeBIndex);
      existingAutoByPair.set(pairKey, d);
    }
  }

  // Precompute room bounding boxes & edge segments once in O(N)
  const roomBoxes = rooms.map((r) => getRoomBoundingBox(r));
  const roomAllSegs = rooms.map((r) => getAllEdgeSubSegments(r, 6));

  type AutoCandidate = {
    door: Doorway;
    overlapLen: number;
  };
  const candidates: AutoCandidate[] = [];

  for (let i = 0; i < rooms.length; i++) {
    const rA = rooms[i];
    const boxA = roomBoxes[i];
    const allSegsA = roomAllSegs[i];

    for (let j = i + 1; j < rooms.length; j++) {
      const boxB = roomBoxes[j];
      if (
        boxA.maxX + tolerance < boxB.minX ||
        boxB.maxX + tolerance < boxA.minX ||
        boxA.maxY + tolerance < boxB.minY ||
        boxB.maxY + tolerance < boxA.minY
      ) {
        continue;
      }

      const rB = rooms[j];
      if (rA.unwalled && rB.unwalled) continue;

      for (let eA = 0; eA < allSegsA.length; eA++) {
        if (!isWallEligibleForDoorway(rA, eA) && !rA.unwalled) continue;
        if (rA.hiddenEdges?.[eA]) continue;
        const segsA = allSegsA[eA];
        const allSegsB = roomAllSegs[j];

        for (let eB = 0; eB < allSegsB.length; eB++) {
          if (rB.hiddenEdges?.[eB]) continue;
          if (!isWallEligibleForDoorway(rA, eA) && !isWallEligibleForDoorway(rB, eB)) continue;

          const pairKey = getAutoPairKey(rA.id, rB.id, eA, eB);
          if (suppressedSet.has(pairKey)) continue;
          if (existingAutoByPair.has(pairKey)) continue;

          if (requireEmptyWalls) {
            if (
              occupiedWalls.has(`${rA.id}:${eA}`) ||
              occupiedWalls.has(`${rB.id}:${eB}`)
            ) {
              continue;
            }
          }

          const segsB = allSegsB[eB];
          let bestContact: ReturnType<typeof detectSegmentSharedContact> = null;
          let minMatchedSa = Infinity;
          let maxMatchedSa = -1;

          for (let sa = 0; sa < segsA.length; sa++) {
            const sA = segsA[sa];
            for (let sb = 0; sb < segsB.length; sb++) {
              const contact = detectSegmentSharedContact(sA, segsB[sb], tolerance);
              if (contact) {
                minMatchedSa = Math.min(minMatchedSa, sa);
                maxMatchedSa = Math.max(maxMatchedSa, sa);
                if (
                  !bestContact ||
                  contact.overlapLen > bestContact.overlapLen ||
                  (contact.overlapLen === bestContact.overlapLen &&
                    contact.gap < bestContact.gap)
                ) {
                  bestContact = contact;
                }
              }
            }
          }

          if (bestContact) {
            // Choose primary host wall (never attach to an unwalled room; prefer indoor walled rooms over courtyards)
            const preferBAsHost =
              (!isWallEligibleForDoorway(rA, eA) && isWallEligibleForDoorway(rB, eB)) ||
              (rA.type === 'courtyard' &&
                rB.type !== 'courtyard' &&
                isWallEligibleForDoorway(rB, eB));

            const hostRoom = preferBAsHost ? rB : rA;
            const hostEdge = preferBAsHost ? eB : eA;
            const otherRoom = preferBAsHost ? rA : rB;
            const otherEdge = preferBAsHost ? eA : eB;

            const isCurvedPair =
              Math.abs(rA.edgeCurves[eA] ?? 0) > 0.5 ||
              Math.abs(rB.edgeCurves[eB] ?? 0) > 0.5;
            let rawPos = bestContact.mid;
            if (isCurvedPair && maxMatchedSa >= minMatchedSa) {
              const tMid = (minMatchedSa + maxMatchedSa + 1) / (2 * Math.max(1, segsA.length));
              rawPos = getEdgePositionAndAngleAtT(rA, eA, tMid).position;
            }

            const rawT = getDoorwayWallT(hostRoom, hostEdge, rawPos);
            const clampedT = clampWallTForDoor(hostRoom, hostEdge, rawT, 32);
            const exact = getEdgePositionAndAngleAtT(hostRoom, hostEdge, clampedT);

            candidates.push({
              door: {
                id: `auto-door-${pairKey}`,
                roomAId: hostRoom.id,
                roomBId: otherRoom.id,
                edgeAIndex: hostEdge,
                edgeBIndex: otherEdge,
                position: exact.position,
                angle: exact.angle,
                width: 32,
                enabled: true,
                autoDetected: true,
                wallT: clampedT,
              },
              overlapLen: bestContact.overlapLen,
            });
          }
        }
      }
    }
  }

  // Prioritize longer shared wall contacts and prevent overlapping or multi-door wall additions
  candidates.sort((a, b) => b.overlapLen - a.overlapLen);

  const occupiedDoors: Doorway[] = [...preservedDoors];
  const detectedAutoDoors: Doorway[] = [];

  for (const cand of candidates) {
    if (requireEmptyWalls) {
      if (
        occupiedWalls.has(`${cand.door.roomAId}:${cand.door.edgeAIndex}`) ||
        (cand.door.roomBId !== null &&
          cand.door.edgeBIndex !== null &&
          occupiedWalls.has(`${cand.door.roomBId}:${cand.door.edgeBIndex}`))
      ) {
        continue;
      }
    }
    const collides = occupiedDoors.some((occ) => doDoorwaysOverlap(cand.door, occ));
    if (collides) continue;
    detectedAutoDoors.push(cand.door);
    occupiedDoors.push(cand.door);
    if (requireEmptyWalls) {
      occupiedWalls.add(`${cand.door.roomAId}:${cand.door.edgeAIndex}`);
      if (cand.door.roomBId !== null && cand.door.edgeBIndex !== null) {
        occupiedWalls.add(`${cand.door.roomBId}:${cand.door.edgeBIndex}`);
      }
    }
  }

  return [...preservedDoors, ...detectedAutoDoors];
}

export function isWallEdgeExterior(
  room: Room,
  edgeIndex: number,
  allRooms: Room[]
): boolean {
  const mid = getPointAlongRoomEdge(room, edgeIndex, 0.5);
  const normal = getOutwardWallNormal(room, mid);
  const probe = { x: mid.x + normal.x * 18, y: mid.y + normal.y * 18 };
  for (let i = 0; i < allRooms.length; i++) {
    const other = allRooms[i];
    if (other.id === room.id) continue;
    const box = getRoomBoundingBox(other);
    if (
      probe.x < box.minX ||
      probe.x > box.maxX ||
      probe.y < box.minY ||
      probe.y > box.maxY
    ) {
      continue;
    }
    if (pointInPolygon(probe, sampleRoomPolygon(other, 6))) {
      return false;
    }
  }
  return true;
}

export function isDoorPassable(
  door: Doorway,
  options: { includeSecret?: boolean; includeLocked?: boolean } = {}
): boolean {
  const kind = door.kind ?? 'normal';
  if (!door.enabled) return false;
  if ((kind === 'secret' || kind === 'locked-secret') && options.includeSecret === false) {
    return false;
  }
  if ((kind === 'locked' || kind === 'locked-secret') && options.includeLocked === false) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Wall Slice & Floor Slice Geometry Helpers
// ---------------------------------------------------------------------------

export function isPointInSlice(
  pt: Point,
  slice: Pick<SliceRegion, 'points' | 'edgeCurves'>
): boolean {
  if (slice.points.length < 3) return false;
  const poly = sampleRoomPolygon(slice, 10);
  const box = getPolygonBoundingBox(poly);
  if (pt.x < box.minX || pt.x > box.maxX || pt.y < box.minY || pt.y > box.maxY) {
    return false;
  }
  return pointInPolygon(pt, poly);
}

export function isPointInAnySlice(
  pt: Point,
  slices: SliceRegion[] = [],
  mode?: SliceMode
): SliceRegion | null {
  for (let i = slices.length - 1; i >= 0; i--) {
    const s = slices[i];
    if (mode && s.mode !== mode) continue;
    if (isPointInSlice(pt, s)) return s;
  }
  return null;
}

export function isDoorwaySliced(door: Doorway, slices: SliceRegion[] = []): boolean {
  if (slices.length === 0) return false;
  return Boolean(isPointInAnySlice(door.position, slices));
}

export function getEffectiveRoomAreaSqFt(
  room: Room,
  slices: SliceRegion[] = [],
  cellSize: number,
  feetPerCell: number
): number {
  const floorSlices = slices.filter((s) => s.mode === 'floor' && s.points.length >= 3);
  if (floorSlices.length === 0) {
    return getRoomAreaSqFt(room, cellSize, feetPerCell);
  }
  const roomPoly = sampleRoomPolygon(room, 8);
  const roomBox = getPolygonBoundingBox(roomPoly);
  const sampledSlices = floorSlices
    .map((s) => {
      const poly = sampleRoomPolygon(s, 8);
      return { poly, box: getPolygonBoundingBox(poly) };
    })
    .filter(
      ({ box }) =>
        !(
          box.maxX < roomBox.minX ||
          roomBox.maxX < box.minX ||
          box.maxY < roomBox.minY ||
          roomBox.maxY < box.minY
        )
    );
  if (sampledSlices.length === 0) {
    return getRoomAreaSqFt(room, cellSize, feetPerCell);
  }

  const gridN = 24;
  let insideTotal = 0;
  let insideRemaining = 0;
  for (let gx = 0; gx < gridN; gx++) {
    const px = roomBox.minX + ((gx + 0.5) / gridN) * roomBox.width;
    for (let gy = 0; gy < gridN; gy++) {
      const py = roomBox.minY + ((gy + 0.5) / gridN) * roomBox.height;
      const pt = { x: px, y: py };
      if (!pointInPolygon(pt, roomPoly)) continue;
      insideTotal++;
      const cut = sampledSlices.some(
        ({ box, poly }) =>
          px >= box.minX &&
          px <= box.maxX &&
          py >= box.minY &&
          py <= box.maxY &&
          pointInPolygon(pt, poly)
      );
      if (!cut) insideRemaining++;
    }
  }
  const baseArea = getRoomAreaSqFt(room, cellSize, feetPerCell);
  if (insideTotal === 0) return baseArea;
  return Math.round(baseArea * (insideRemaining / insideTotal));
}

export function getEffectiveRoomLabelAnchor(
  room: Room,
  slices: SliceRegion[] = []
): Point {
  const base = getRoomLabelAnchor(room);
  const floorSlices = slices.filter((s) => s.mode === 'floor' && s.points.length >= 3);
  if (floorSlices.length === 0 || !isPointInAnySlice(base, floorSlices)) {
    return base;
  }

  const roomPoly = sampleRoomPolygon(room, 8);
  const bbox = getRoomBoundingBox(room);
  let bestPt = base;
  let bestScore = -1;
  const steps = 11;
  for (let gx = 1; gx < steps; gx++) {
    for (let gy = 1; gy < steps; gy++) {
      const candidate = {
        x: bbox.minX + (bbox.width * gx) / steps,
        y: bbox.minY + (bbox.height * gy) / steps,
      };
      if (!pointInPolygon(candidate, roomPoly)) continue;
      if (isPointInAnySlice(candidate, floorSlices)) continue;
      const d = minDistToBoundary(candidate, roomPoly);
      if (d > bestScore) {
        bestScore = d;
        bestPt = candidate;
      }
    }
  }
  return bestPt;
}

export interface FloorSliceWallRun {
  sliceId: string;
  roomId: string;
  pathD: string;
  isCourtyard: boolean;
}

export function computeFloorSliceWalls(
  rooms: Room[],
  slices: SliceRegion[] = []
): FloorSliceWallRun[] {
  const floorSlices = slices.filter((s) => s.mode === 'floor' && s.points.length >= 3);
  if (floorSlices.length === 0 || rooms.length === 0) return [];
  const wallSlices = slices.filter((s) => s.mode === 'wall' && s.points.length >= 3);

  const sampledRooms = rooms.map((r) => {
    const poly = sampleRoomPolygon(r, 10);
    return { room: r, poly, box: getPolygonBoundingBox(poly) };
  });
  const sampledFloorSlices = floorSlices.map((s) => {
    const poly = sampleRoomPolygon(s, 10);
    return { slice: s, poly, box: getPolygonBoundingBox(poly) };
  });
  const sampledWallSlices = wallSlices.map((s) => {
    const poly = sampleRoomPolygon(s, 10);
    return { slice: s, poly, box: getPolygonBoundingBox(poly) };
  });

  const findRoomAt = (pt: Point) => {
    for (let i = 0; i < sampledRooms.length; i++) {
      const { room, poly, box } = sampledRooms[i];
      if (pt.x < box.minX || pt.x > box.maxX || pt.y < box.minY || pt.y > box.maxY) {
        continue;
      }
      if (pointInPolygon(pt, poly)) return room;
    }
    return null;
  };

  const inAnyFloorSlice = (pt: Point) => {
    for (let i = 0; i < sampledFloorSlices.length; i++) {
      const { poly, box } = sampledFloorSlices[i];
      if (pt.x < box.minX || pt.x > box.maxX || pt.y < box.minY || pt.y > box.maxY) {
        continue;
      }
      if (pointInPolygon(pt, poly)) return true;
    }
    return false;
  };

  const inAnyWallSlice = (pt: Point) => {
    for (let i = 0; i < sampledWallSlices.length; i++) {
      const { poly, box } = sampledWallSlices[i];
      if (pt.x < box.minX || pt.x > box.maxX || pt.y < box.minY || pt.y > box.maxY) {
        continue;
      }
      if (pointInPolygon(pt, poly)) return true;
    }
    return false;
  };

  const runs: FloorSliceWallRun[] = [];

  for (const { slice, poly: slicePoly } of sampledFloorSlices) {
    let activeRoom: Room | null = null;
    let activePts: Point[] = [];

    const flushRun = () => {
      if (activeRoom && activePts.length >= 2) {
        let d = `M ${activePts[0].x.toFixed(2)} ${activePts[0].y.toFixed(2)}`;
        for (let k = 1; k < activePts.length; k++) {
          d += ` L ${activePts[k].x.toFixed(2)} ${activePts[k].y.toFixed(2)}`;
        }
        runs.push({
          sliceId: slice.id,
          roomId: activeRoom.id,
          pathD: d,
          isCourtyard: activeRoom.type === 'courtyard',
        });
      }
      activeRoom = null;
      activePts = [];
    };

    for (let eIdx = 0; eIdx < slice.points.length; eIdx++) {
      const a = slice.points[eIdx];
      const b = slice.points[(eIdx + 1) % slice.points.length];
      const bend = slice.edgeCurves?.[eIdx] ?? 0;
      const approxLen = Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(bend);
      const steps = Math.max(8, Math.min(120, Math.ceil(approxLen / 4)));

      let prevPt = getPointAlongRoomEdge(slice, eIdx, 0);
      for (let s = 1; s <= steps; s++) {
        const nextPt = getPointAlongRoomEdge(slice, eIdx, s / steps);
        const dx = nextPt.x - prevPt.x;
        const dy = nextPt.y - prevPt.y;
        const segLen = Math.hypot(dx, dy);
        if (segLen > 1e-4) {
          const mid = { x: (prevPt.x + nextPt.x) / 2, y: (prevPt.y + nextPt.y) / 2 };
          const nx = -dy / segLen;
          const ny = dx / segLen;
          // Determine outward normal (pointing outside the floor slice) regardless of winding
          const probe1 = { x: mid.x + nx * 2.5, y: mid.y + ny * 2.5 };
          const probe2 = { x: mid.x - nx * 2.5, y: mid.y - ny * 2.5 };
          const p1Out = !pointInPolygon(probe1, slicePoly);
          const p2Out = !pointInPolygon(probe2, slicePoly);
          const outDir = p1Out && !p2Out ? { x: nx, y: ny } : !p1Out && p2Out ? { x: -nx, y: -ny } : { x: nx, y: ny };

          const checkOut = { x: mid.x + outDir.x * 3.5, y: mid.y + outDir.y * 3.5 };
          const hitRoom =
            !inAnyFloorSlice(checkOut) && !inAnyWallSlice(mid)
              ? findRoomAt(checkOut)
              : null;

          if (hitRoom) {
            if (activeRoom && activeRoom.id !== hitRoom.id) {
              flushRun();
            }
            if (!activeRoom) {
              activeRoom = hitRoom;
              activePts = [prevPt, nextPt];
            } else {
              activePts.push(nextPt);
            }
          } else {
            flushRun();
          }
        }
        prevPt = nextPt;
      }
    }
    flushRun();
  }

  return runs;
}

export function getWallSliceConnections(
  rooms: Room[],
  slices: SliceRegion[] = [],
  tolerance = 22
): {
  exteriorRoomIds: Set<string>;
  exteriorEntries: Array<{ roomId: string; position: Point; sliceId: string }>;
  roomPairs: Array<{ roomAId: string; roomBId: string; position: Point; sliceId: string }>;
} {
  const exteriorRoomIds = new Set<string>();
  const exteriorEntries: Array<{ roomId: string; position: Point; sliceId: string }> = [];
  const roomPairs: Array<{ roomAId: string; roomBId: string; position: Point; sliceId: string }> = [];
  const wallSlices = slices.filter((s) => s.mode === 'wall' && s.points.length >= 3);
  if (wallSlices.length === 0 || rooms.length === 0) {
    return { exteriorRoomIds, exteriorEntries, roomPairs };
  }

  const floorSlices = slices.filter((s) => s.mode === 'floor' && s.points.length >= 3);
  const sampledRooms = rooms.map((r) => {
    const poly = sampleRoomPolygon(r, 8);
    return { room: r, poly, box: getPolygonBoundingBox(poly) };
  });

  const isInAnyRoom = (pt: Point, ignoreRoomId?: string): boolean => {
    for (let i = 0; i < sampledRooms.length; i++) {
      const { room, poly, box } = sampledRooms[i];
      if (room.id === ignoreRoomId) continue;
      if (pt.x < box.minX || pt.x > box.maxX || pt.y < box.minY || pt.y > box.maxY) {
        continue;
      }
      if (pointInPolygon(pt, poly)) return true;
    }
    return false;
  };

  for (const ws of wallSlices) {
    const wsPoly = sampleRoomPolygon(ws, 8);
    const wsBox = getPolygonBoundingBox(wsPoly);
    const touchedByRoom = new Map<string, Point[]>();

    for (const { room, poly: rPoly, box: rBox } of sampledRooms) {
      if (
        rBox.maxX < wsBox.minX ||
        wsBox.maxX < rBox.minX ||
        rBox.maxY < wsBox.minY ||
        wsBox.maxY < rBox.minY
      ) {
        continue;
      }
      const slicedPts: Point[] = [];
      let addedExtForRoomInWs = false;
      for (let eIdx = 0; eIdx < room.points.length; eIdx++) {
        if (room.hiddenEdges?.[eIdx]) continue;
        const a = room.points[eIdx];
        const b = room.points[(eIdx + 1) % room.points.length];
        const len = Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(room.edgeCurves[eIdx] ?? 0);
        const steps = Math.max(4, Math.min(48, Math.ceil(len / 8)));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const pt = getPointAlongRoomEdge(room, eIdx, t);
          if (!pointInPolygon(pt, wsPoly)) continue;
          if (floorSlices.length > 0 && isPointInAnySlice(pt, floorSlices)) continue;
          slicedPts.push(pt);

          // Check if outward side opens directly outside all rooms
          const pNext = getPointAlongRoomEdge(room, eIdx, Math.min(1, t + 0.02));
          const pPrev = getPointAlongRoomEdge(room, eIdx, Math.max(0, t - 0.02));
          const dx = pNext.x - pPrev.x;
          const dy = pNext.y - pPrev.y;
          const sl = Math.hypot(dx, dy);
          if (sl > 1e-4) {
            const nx = -dy / sl;
            const ny = dx / sl;
            const c1 = { x: pt.x + nx * 12, y: pt.y + ny * 12 };
            const c2 = { x: pt.x - nx * 12, y: pt.y - ny * 12 };
            const outPt = !pointInPolygon(c1, rPoly) ? c1 : !pointInPolygon(c2, rPoly) ? c2 : null;
            if (
              outPt &&
              !isInAnyRoom(outPt, room.id) &&
              !(floorSlices.length > 0 && isPointInAnySlice(outPt, floorSlices))
            ) {
              exteriorRoomIds.add(room.id);
              if (
                !addedExtForRoomInWs ||
                !exteriorEntries.some(
                  (ee) =>
                    ee.roomId === room.id &&
                    ee.sliceId === ws.id &&
                    distance(ee.position, pt) < 28
                )
              ) {
                exteriorEntries.push({ roomId: room.id, position: pt, sliceId: ws.id });
                addedExtForRoomInWs = true;
              }
            }
          }
        }
      }
      if (slicedPts.length > 0) {
        touchedByRoom.set(room.id, slicedPts);
      }
    }

    const roomIds = Array.from(touchedByRoom.keys());
    const maxBridgeDist = tolerance + 28;
    for (let i = 0; i < roomIds.length; i++) {
      for (let j = i + 1; j < roomIds.length; j++) {
        const ptsA = touchedByRoom.get(roomIds[i])!;
        const ptsB = touchedByRoom.get(roomIds[j])!;
        let bestDist = Infinity;
        let bestMid: Point | null = null;
        for (const pA of ptsA) {
          for (const pB of ptsB) {
            const d = distance(pA, pB);
            if (d < bestDist) {
              bestDist = d;
              bestMid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
            }
          }
        }
        if (bestMid && bestDist <= maxBridgeDist) {
          roomPairs.push({
            roomAId: roomIds[i],
            roomBId: roomIds[j],
            position: bestMid,
            sliceId: ws.id,
          });
        }
      }
    }
  }

  return { exteriorRoomIds, exteriorEntries, roomPairs };
}

export interface DoorPassageOverlapDiagnostics {
  overlappingDoorIds: Set<string>;
  overlappingPassageIds: Set<string>;
  overlapCount: number;
  message: string | null;
}

function segmentsIntersect2D(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const ccw = (p1: Point, p2: Point, p3: Point) =>
    (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return (
    ccw(a1, b1, b2) !== ccw(a2, b1, b2) &&
    ccw(a1, a2, b1) !== ccw(a1, a2, b2)
  );
}

function segmentToSegmentDist(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect2D(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointToSegmentDistance(a1, b1, b2).dist,
    pointToSegmentDistance(a2, b1, b2).dist,
    pointToSegmentDistance(b1, a1, a2).dist,
    pointToSegmentDistance(b2, a1, a2).dist
  );
}

function doorwayEndpoints(d: Doorway): [Point, Point, number, number] {
  const ux = Math.cos(d.angle);
  const uy = Math.sin(d.angle);
  const hw = d.width / 2;
  return [
    { x: d.position.x - ux * hw, y: d.position.y - uy * hw },
    { x: d.position.x + ux * hw, y: d.position.y + uy * hw },
    ux,
    uy,
  ];
}

export function detectDoorPassageOverlaps(
  doorways: Doorway[],
  secretPassages: SecretPassage[]
): DoorPassageOverlapDiagnostics {
  const overlappingDoorIds = new Set<string>();
  const overlappingPassageIds = new Set<string>();
  let overlapCount = 0;

  // 1. Doorway vs Doorway
  for (let i = 0; i < doorways.length; i++) {
    const d1 = doorways[i];
    const [a1, a2, ux1, uy1] = doorwayEndpoints(d1);
    for (let j = i + 1; j < doorways.length; j++) {
      const d2 = doorways[j];
      const [b1, b2, ux2, uy2] = doorwayEndpoints(d2);
      const dot = Math.abs(ux1 * ux2 + uy1 * uy2);
      const dx = d2.position.x - d1.position.x;
      const dy = d2.position.y - d1.position.y;

      let overlaps = false;
      if (dot > 0.92) {
        const perpDist = Math.abs(-uy1 * dx + ux1 * dy);
        const alongDist = Math.abs(ux1 * dx + uy1 * dy);
        if (perpDist < 10 && alongDist < (d1.width + d2.width) / 2 - 2) {
          overlaps = true;
        }
      }
      if (!overlaps && segmentToSegmentDist(a1, a2, b1, b2) < 5) {
        overlaps = true;
      }

      if (overlaps) {
        overlappingDoorIds.add(d1.id);
        overlappingDoorIds.add(d2.id);
        overlapCount++;
      }
    }
  }

  // 2. Doorway vs Secret Passage
  for (const d of doorways) {
    const [dA, dB] = doorwayEndpoints(d);
    for (const sp of secretPassages) {
      let overlaps =
        pointToSegmentDistance(sp.startAnchor, dA, dB).dist <= 10 ||
        (sp.toRoomId !== null &&
          pointToSegmentDistance(sp.endAnchor, dA, dB).dist <= 10);

      if (!overlaps && sp.points.length >= 2) {
        for (let k = 0; k < sp.points.length - 1; k++) {
          if (segmentToSegmentDist(dA, dB, sp.points[k], sp.points[k + 1]) < 6) {
            overlaps = true;
            break;
          }
        }
      }

      if (overlaps) {
        overlappingDoorIds.add(d.id);
        overlappingPassageIds.add(sp.id);
        overlapCount++;
      }
    }
  }

  // 3. Secret Passage vs Secret Passage
  for (let i = 0; i < secretPassages.length; i++) {
    const sp1 = secretPassages[i];
    for (let j = i + 1; j < secretPassages.length; j++) {
      const sp2 = secretPassages[j];
      let overlaps = distance(sp1.startAnchor, sp2.startAnchor) < 14;
      if (!overlaps && sp1.toRoomId !== null) {
        overlaps =
          distance(sp1.endAnchor, sp2.startAnchor) < 14 ||
          (sp2.toRoomId !== null && distance(sp1.endAnchor, sp2.endAnchor) < 14);
      }
      if (!overlaps && sp2.toRoomId !== null) {
        overlaps = distance(sp1.startAnchor, sp2.endAnchor) < 14;
      }
      if (!overlaps && sp1.points.length >= 2 && sp2.points.length >= 2) {
        for (let a = 0; a < sp1.points.length - 1 && !overlaps; a++) {
          for (let b = 0; b < sp2.points.length - 1; b++) {
            if (
              segmentToSegmentDist(
                sp1.points[a],
                sp1.points[a + 1],
                sp2.points[b],
                sp2.points[b + 1]
              ) < 6
            ) {
              overlaps = true;
              break;
            }
          }
        }
      }

      if (overlaps) {
        overlappingPassageIds.add(sp1.id);
        overlappingPassageIds.add(sp2.id);
        overlapCount++;
      }
    }
  }

  const totalItems = overlappingDoorIds.size + overlappingPassageIds.size;
  const message =
    overlapCount > 0
      ? `Warning: ${totalItems} overlapping doors/passages detected — drag or resize to separate them.`
      : null;

  return {
    overlappingDoorIds,
    overlappingPassageIds,
    overlapCount,
    message,
  };
}

interface SampledSlice {
  slice: SliceRegion;
  poly: Point[];
  box: BoundingBox;
}

function boxesOverlap2D(a: BoundingBox, b: BoundingBox, pad = 2): boolean {
  return !(
    a.maxX + pad < b.minX ||
    b.maxX + pad < a.minX ||
    a.maxY + pad < b.minY ||
    b.maxY + pad < a.minY
  );
}

function pointInSampledSlices(pt: Point, slices: SampledSlice[]): boolean {
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    if (pt.x < s.box.minX || pt.x > s.box.maxX || pt.y < s.box.minY || pt.y > s.box.maxY) {
      continue;
    }
    if (pointInPolygon(pt, s.poly)) return true;
  }
  return false;
}

function segmentBlockedBySlices(a: Point, b: Point, slices: SampledSlice[]): boolean {
  if (slices.length === 0) return false;
  const dist = distance(a, b);
  const steps = Math.max(2, Math.ceil(dist / 6));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (pointInSampledSlices(pt, slices)) return true;
  }
  return false;
}

interface RoomWalkabilityContext {
  componentCount: number;
  resolvePortalComponent: (pt: Point) => number;
}

function buildRoomWalkabilityContext(
  room: Room,
  sampledFloorSlices: SampledSlice[]
): RoomWalkabilityContext | null {
  if (sampledFloorSlices.length === 0) return null;
  const poly = sampleRoomPolygon(room, 8);
  if (poly.length < 3) return null;
  const bbox = getPolygonBoundingBox(poly);
  const overlapping = sampledFloorSlices.filter((s) => boxesOverlap2D(bbox, s.box, 2));
  if (overlapping.length === 0) return null;

  const step = Math.max(10, Math.min(18, Math.min(bbox.width, bbox.height) / 14));
  const cols = Math.min(34, Math.max(4, Math.ceil(bbox.width / step) + 1));
  const rows = Math.min(34, Math.max(4, Math.ceil(bbox.height / step) + 1));
  const cellW = bbox.width / cols;
  const cellH = bbox.height / rows;
  const cellCenter = (r: number, c: number): Point => ({
    x: bbox.minX + (c + 0.5) * cellW,
    y: bbox.minY + (r + 0.5) * cellH,
  });

  const comp = new Int32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pt = cellCenter(r, c);
      if (pointInPolygon(pt, poly) && !pointInSampledSlices(pt, overlapping)) {
        comp[r * cols + c] = -1;
      }
    }
  }

  let compId = 0;
  const dirs4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const queueR: number[] = [];
  const queueC: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (comp[idx] !== -1) continue;
      compId++;
      comp[idx] = compId;
      queueR.length = 0;
      queueC.length = 0;
      queueR.push(r);
      queueC.push(c);
      let head = 0;
      while (head < queueR.length) {
        const cr = queueR[head];
        const cc = queueC[head];
        head++;
        const pCurr = cellCenter(cr, cc);
        for (let d = 0; d < 4; d++) {
          const nr = cr + dirs4[d][0];
          const nc = cc + dirs4[d][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          const nIdx = nr * cols + nc;
          if (comp[nIdx] !== -1) continue;
          const pNext = cellCenter(nr, nc);
          if (segmentBlockedBySlices(pCurr, pNext, overlapping)) continue;
          comp[nIdx] = compId;
          queueR.push(nr);
          queueC.push(nc);
        }
      }
    }
  }

  const resolvePortalComponent = (pt: Point): number => {
    if (compId === 0) return 0;
    if (pointInSampledSlices(pt, overlapping)) return 0;

    let bestClearComp = 0;
    let bestClearDist = Infinity;
    let bestAnyComp = 0;
    let bestAnyDist = Infinity;
    const maxSnapDist = Math.max(36, Math.hypot(cellW, cellH) * 2.2);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cid = comp[r * cols + c];
        if (cid <= 0) continue;
        const centerPt = cellCenter(r, c);
        const d = distance(pt, centerPt);
        if (d < bestAnyDist) {
          bestAnyDist = d;
          bestAnyComp = cid;
        }
        if (d < bestClearDist && !segmentBlockedBySlices(pt, centerPt, overlapping)) {
          bestClearDist = d;
          bestClearComp = cid;
        }
      }
    }

    if (bestClearComp > 0 && bestClearDist <= maxSnapDist) {
      return bestClearComp;
    }
    if (bestAnyComp > 0 && bestAnyDist <= Math.max(18, step)) {
      return bestAnyComp;
    }
    return 0;
  };

  return { componentCount: compId, resolvePortalComponent };
}

function evaluateMultiFloorReachability(
  floors: MapFloor[],
  stairLinks: StairLink[],
  includeSecret: boolean,
  tolerance: number,
  includeLocked: boolean,
  slicesOverrideByFloorId?: Map<string, SliceRegion[]>
): {
  accessibleKeys: Set<string>;
  inaccessibleCountByFloor: Map<string, number>;
} {
  const key = (floorId: string, roomId: string) => `${floorId}::${roomId}`;
  const compKey = (floorId: string, roomId: string, cId: number) =>
    `${floorId}::${roomId}#${cId}`;

  const adj = new Map<string, string[]>();
  adj.set('OUTSIDE', []);
  const ensureNode = (nodeId: string) => {
    if (!adj.has(nodeId)) adj.set(nodeId, []);
  };
  const connect = (a: string | null, b: string | null) => {
    if (!a || !b) return;
    ensureNode(a);
    ensureNode(b);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };

  const roomCtxMap = new Map<string, RoomWalkabilityContext | null>();
  const floorSlicesMap = new Map<string, SliceRegion[]>();

  const resolveRoomNode = (floorId: string, roomId: string, pt?: Point): string | null => {
    const ctx = roomCtxMap.get(key(floorId, roomId));
    if (ctx === undefined) return null;
    if (ctx === null) return compKey(floorId, roomId, 1);
    if (ctx.componentCount === 0) return null;
    if (!pt) return compKey(floorId, roomId, 1);
    const cid = ctx.resolvePortalComponent(pt);
    return cid > 0 ? compKey(floorId, roomId, cid) : null;
  };

  for (const fl of floors) {
    const flSlices = slicesOverrideByFloorId
      ? (slicesOverrideByFloorId.get(fl.id) ?? [])
      : (fl.slices ?? []);
    floorSlicesMap.set(fl.id, flSlices);

    const flFloorSlices = flSlices.filter((s) => s.mode === 'floor' && s.points.length >= 3);
    const sampledFloorSlices: SampledSlice[] = flFloorSlices.map((s) => {
      const poly = sampleRoomPolygon(s, 8);
      return { slice: s, poly, box: getPolygonBoundingBox(poly) };
    });

    const flWallSlices = flSlices.filter((s) => s.mode === 'wall' && s.points.length >= 3);
    const sampledWallSlices: SampledSlice[] = flWallSlices.map((s) => {
      const poly = sampleRoomPolygon(s, 8);
      return { slice: s, poly, box: getPolygonBoundingBox(poly) };
    });

    const roomMap = new Map(fl.rooms.map((r) => [r.id, r]));
    const sampledRooms = fl.rooms.map((r) => {
      const poly = sampleRoomPolygon(r, 8);
      return { room: r, poly, box: getPolygonBoundingBox(poly) };
    });

    for (const r of fl.rooms) {
      const ctx = buildRoomWalkabilityContext(r, sampledFloorSlices);
      roomCtxMap.set(key(fl.id, r.id), ctx);
      if (ctx === null) {
        ensureNode(compKey(fl.id, r.id, 1));
      } else {
        for (let c = 1; c <= ctx.componentCount; c++) {
          ensureNode(compKey(fl.id, r.id, c));
        }
      }
    }

    for (const d of fl.doorways) {
      if (isDoorwaySliced(d, flSlices)) continue;
      if (!isDoorPassable(d, { includeSecret, includeLocked })) continue;
      if (d.roomBId === null) {
        connect('OUTSIDE', resolveRoomNode(fl.id, d.roomAId, d.position));
      } else {
        connect(
          resolveRoomNode(fl.id, d.roomAId, d.position),
          resolveRoomNode(fl.id, d.roomBId, d.position)
        );
      }
    }

    const sliceConns = getWallSliceConnections(fl.rooms, flSlices, tolerance);
    if (sliceConns.exteriorEntries.length > 0) {
      for (const ext of sliceConns.exteriorEntries) {
        connect('OUTSIDE', resolveRoomNode(fl.id, ext.roomId, ext.position));
      }
    } else {
      for (const rid of sliceConns.exteriorRoomIds) {
        connect('OUTSIDE', resolveRoomNode(fl.id, rid));
      }
    }
    for (const pair of sliceConns.roomPairs) {
      connect(
        resolveRoomNode(fl.id, pair.roomAId, pair.position),
        resolveRoomNode(fl.id, pair.roomBId, pair.position)
      );
    }

    // Unwalled rooms have no perimeter walls of their own:
    // exterior edges open directly to OUTSIDE, and touching open/unwalled rooms connects openly.
    for (let i = 0; i < sampledRooms.length; i++) {
      const { room, poly } = sampledRooms[i];
      if (!room.unwalled) continue;
      for (let eIdx = 0; eIdx < room.points.length; eIdx++) {
        for (const t of [0.25, 0.5, 0.75]) {
          const pt = getPointAlongRoomEdge(room, eIdx, t);
          if (pointInSampledSlices(pt, sampledFloorSlices)) continue;
          const nodeA = resolveRoomNode(fl.id, room.id, pt);
          if (!nodeA) continue;

          const pNext = getPointAlongRoomEdge(room, eIdx, Math.min(1, t + 0.02));
          const pPrev = getPointAlongRoomEdge(room, eIdx, Math.max(0, t - 0.02));
          const dx = pNext.x - pPrev.x;
          const dy = pNext.y - pPrev.y;
          const sl = Math.hypot(dx, dy);
          if (sl < 1e-4) continue;
          const nx = -dy / sl;
          const ny = dx / sl;
          const c1 = { x: pt.x + nx * 12, y: pt.y + ny * 12 };
          const c2 = { x: pt.x - nx * 12, y: pt.y - ny * 12 };
          const outPt = !pointInPolygon(c1, poly) ? c1 : !pointInPolygon(c2, poly) ? c2 : null;
          if (!outPt || pointInSampledSlices(outPt, sampledFloorSlices)) continue;

          let hitOther: Room | null = null;
          for (let j = 0; j < sampledRooms.length; j++) {
            if (j === i) continue;
            const other = sampledRooms[j];
            if (
              outPt.x < other.box.minX ||
              outPt.x > other.box.maxX ||
              outPt.y < other.box.minY ||
              outPt.y > other.box.maxY
            ) {
              continue;
            }
            if (pointInPolygon(outPt, other.poly)) {
              hitOther = other.room;
              break;
            }
          }

          if (!hitOther) {
            connect('OUTSIDE', nodeA);
          } else {
            const closestB = findClosestRoomEdge(hitOther, pt, true);
            const bOpen =
              Boolean(hitOther.unwalled) ||
              Boolean(hitOther.hiddenEdges?.[closestB.edgeIndex]) ||
              pointInSampledSlices(pt, sampledWallSlices);
            if (bOpen) {
              connect(nodeA, resolveRoomNode(fl.id, hitOther.id, pt));
            }
          }
        }
      }
    }

    if (includeSecret) {
      for (const sp of fl.secretPassages) {
        if (sp.points.length < 2) continue;
        const startPt = sp.points[0];
        const endPt = sp.points[sp.points.length - 1];
        if (sp.toRoomId === null) {
          connect('OUTSIDE', resolveRoomNode(fl.id, sp.fromRoomId, startPt));
        } else if (roomMap.has(sp.fromRoomId) && roomMap.has(sp.toRoomId)) {
          connect(
            resolveRoomNode(fl.id, sp.fromRoomId, startPt),
            resolveRoomNode(fl.id, sp.toRoomId, endPt)
          );
        }
      }
    }
  }

  for (const st of stairLinks) {
    if (!st.enabled) continue;
    const fromFloor = floors.find((f) => f.id === st.fromFloorId);
    const toFloor = floors.find((f) => f.id === st.toFloorId);
    const fromRoom = fromFloor?.rooms.find((r) => r.id === st.fromRoomId);
    const toRoom = toFloor?.rooms.find((r) => r.id === st.toRoomId);
    if (!fromFloor || !toFloor || !fromRoom || !toRoom) continue;

    const fromAnchor = getEffectiveRoomLabelAnchor(fromRoom, floorSlicesMap.get(fromFloor.id) ?? []);
    const toAnchor = getEffectiveRoomLabelAnchor(toRoom, floorSlicesMap.get(toFloor.id) ?? []);
    const nFrom = resolveRoomNode(fromFloor.id, fromRoom.id, fromAnchor);
    const nTo = resolveRoomNode(toFloor.id, toRoom.id, toAnchor);
    if (!nFrom || !nTo) continue;

    ensureNode(nFrom);
    ensureNode(nTo);
    adj.get(nFrom)!.push(nTo);
    if (st.bidirectional !== false) {
      adj.get(nTo)!.push(nFrom);
    }
  }

  const queue: string[] = ['OUTSIDE'];
  const visited = new Set<string>(['OUTSIDE']);
  let qHead = 0;
  while (qHead < queue.length) {
    const curr = queue[qHead++];
    const neighbors = adj.get(curr) ?? [];
    for (let i = 0; i < neighbors.length; i++) {
      const nxt = neighbors[i];
      if (!visited.has(nxt)) {
        visited.add(nxt);
        queue.push(nxt);
      }
    }
  }

  const accessibleKeys = new Set<string>();
  const inaccessibleCountByFloor = new Map<string, number>();

  for (const fl of floors) {
    let inaccCnt = 0;
    for (const r of fl.rooms) {
      const k = key(fl.id, r.id);
      const ctx = roomCtxMap.get(k);
      const count = ctx ? ctx.componentCount : 1;
      let anyCompVisited = false;
      for (let c = 1; c <= count; c++) {
        if (visited.has(compKey(fl.id, r.id, c))) {
          anyCompVisited = true;
          break;
        }
      }
      if (anyCompVisited) {
        accessibleKeys.add(k);
      } else {
        inaccCnt++;
      }
    }
    inaccessibleCountByFloor.set(fl.id, inaccCnt);
  }

  return { accessibleKeys, inaccessibleCountByFloor };
}

function detectSliceBlocking(
  floors: MapFloor[],
  activeFloorId: string,
  stairLinks: StairLink[],
  includeSecret: boolean,
  tolerance: number,
  includeLocked: boolean,
  baseResult: { accessibleKeys: Set<string>; inaccessibleCountByFloor: Map<string, number> }
): {
  blockingSliceIds: Set<string>;
  sliceBlockedRoomIds: Set<string>;
  sliceBlockingMessage: string | null;
} {
  const blockingSliceIds = new Set<string>();
  const sliceBlockedRoomIds = new Set<string>();
  const activeFloor = floors.find((f) => f.id === activeFloorId);
  if (!activeFloor) {
    return { blockingSliceIds, sliceBlockedRoomIds, sliceBlockingMessage: null };
  }

  const hasAnySlices = floors.some((f) => (f.slices?.length ?? 0) > 0);
  const totalInaccessible = Array.from(baseResult.inaccessibleCountByFloor.values()).reduce(
    (s, n) => s + n,
    0
  );
  if (!hasAnySlices || totalInaccessible === 0) {
    return { blockingSliceIds, sliceBlockedRoomIds, sliceBlockingMessage: null };
  }

  const emptySlicesMap = new Map<string, SliceRegion[]>();
  for (const fl of floors) emptySlicesMap.set(fl.id, []);

  const noSliceRes = evaluateMultiFloorReachability(
    floors,
    stairLinks,
    includeSecret,
    tolerance,
    includeLocked,
    emptySlicesMap
  );

  const key = (floorId: string, roomId: string) => `${floorId}::${roomId}`;
  const allBlockedKeys = new Set<string>();
  for (const fl of floors) {
    for (const r of fl.rooms) {
      const k = key(fl.id, r.id);
      if (!baseResult.accessibleKeys.has(k) && noSliceRes.accessibleKeys.has(k)) {
        allBlockedKeys.add(k);
        if (fl.id === activeFloorId) {
          sliceBlockedRoomIds.add(r.id);
        }
      }
    }
  }

  if (allBlockedKeys.size === 0) {
    return { blockingSliceIds, sliceBlockedRoomIds, sliceBlockingMessage: null };
  }

  const activeSlices = activeFloor.slices ?? [];
  const blockedNamesFromActive = new Set<string>();
  let blocksOtherFloorCount = 0;

  for (const sl of activeSlices) {
    const withoutSl = new Map<string, SliceRegion[]>();
    for (const fl of floors) {
      withoutSl.set(
        fl.id,
        fl.id === activeFloorId ? activeSlices.filter((x) => x.id !== sl.id) : (fl.slices ?? [])
      );
    }
    const testRes = evaluateMultiFloorReachability(
      floors,
      stairLinks,
      includeSecret,
      tolerance,
      includeLocked,
      withoutSl
    );

    let unblocksAny = false;
    for (const fl of floors) {
      for (const r of fl.rooms) {
        const k = key(fl.id, r.id);
        if (!baseResult.accessibleKeys.has(k) && testRes.accessibleKeys.has(k)) {
          unblocksAny = true;
          if (fl.id === activeFloorId) {
            blockedNamesFromActive.add(r.name);
          } else {
            blocksOtherFloorCount++;
          }
        }
      }
    }
    if (unblocksAny) {
      blockingSliceIds.add(sl.id);
    }
  }

  // Fallback for multi-slice overlapping blockades (removing just one didn't clear both)
  if (blockingSliceIds.size === 0 && activeSlices.length > 0) {
    for (const sl of activeSlices) {
      const onlySl = new Map<string, SliceRegion[]>();
      for (const fl of floors) {
        onlySl.set(fl.id, fl.id === activeFloorId ? [sl] : (fl.slices ?? []));
      }
      const soloRes = evaluateMultiFloorReachability(
        floors,
        stairLinks,
        includeSecret,
        tolerance,
        includeLocked,
        onlySl
      );
      for (const bk of allBlockedKeys) {
        if (!soloRes.accessibleKeys.has(bk)) {
          blockingSliceIds.add(sl.id);
          break;
        }
      }
    }
  }

  if (sliceBlockedRoomIds.size === 0 && blockingSliceIds.size === 0) {
    return { blockingSliceIds, sliceBlockedRoomIds, sliceBlockingMessage: null };
  }

  if (sliceBlockedRoomIds.size > 0) {
    const namesArr = activeFloor.rooms
      .filter((r) => sliceBlockedRoomIds.has(r.id))
      .map((r) => r.name);
    const shown =
      namesArr.length <= 2
        ? namesArr.join(', ')
        : `${namesArr.slice(0, 2).join(', ')} +${namesArr.length - 2} more`;
    return {
      blockingSliceIds,
      sliceBlockedRoomIds,
      sliceBlockingMessage: `Cutout blocks access to ${namesArr.length} room${
        namesArr.length > 1 ? 's' : ''
      } (${shown}) — resize, move, or delete the highlighted cutout, or add another route.`,
    };
  }

  return {
    blockingSliceIds,
    sliceBlockedRoomIds,
    sliceBlockingMessage: `Cutout on ${activeFloor.name} blocks stair access to ${Math.max(
      1,
      blocksOtherFloorCount || allBlockedKeys.size
    )} room(s) on another floor — resize, move, or delete the highlighted cutout.`,
  };
}

export function diagnoseAccessibilityFromOutside(
  rooms: Room[],
  doorways: Doorway[],
  secretPassages: SecretPassage[],
  includeSecret: boolean,
  tolerance = 22,
  includeLocked = true,
  slices: SliceRegion[] = []
): AccessibilityDiagnostics {
  const singleFloor: MapFloor = {
    id: 'single-floor',
    name: 'Level 1',
    elevationOrder: 0,
    rooms,
    doorways,
    secretPassages,
    slices,
  };
  return diagnoseMultiFloorAccessibility(
    [singleFloor],
    singleFloor.id,
    [],
    includeSecret,
    tolerance,
    includeLocked
  );
}

export function diagnoseMultiFloorAccessibility(
  floors: MapFloor[],
  activeFloorId: string,
  stairLinks: StairLink[],
  includeSecret: boolean,
  tolerance = 22,
  includeLocked = true
): AccessibilityDiagnostics {
  const floorMap = new Map(floors.map((f) => [f.id, f]));
  const key = (floorId: string, roomId: string) => `${floorId}::${roomId}`;

  const baseResult = evaluateMultiFloorReachability(
    floors,
    stairLinks,
    includeSecret,
    tolerance,
    includeLocked
  );
  const { accessibleKeys, inaccessibleCountByFloor } = baseResult;

  const activeFloor = floorMap.get(activeFloorId);
  if (!activeFloor || activeFloor.rooms.length === 0) {
    return {
      accessibleRoomIds: new Set(),
      inaccessibleRoomIds: new Set(),
      highlightedDisabledDoorIds: new Set(),
      highlightedWalls: [],
      tooltipMessage: null,
      inaccessibleCountByFloor,
      blockingSliceIds: new Set(),
      sliceBlockedRoomIds: new Set(),
      sliceBlockingMessage: null,
    };
  }

  const accessibleRoomIds = new Set<string>();
  const inaccessibleRoomIds = new Set<string>();
  for (const r of activeFloor.rooms) {
    if (accessibleKeys.has(key(activeFloor.id, r.id))) {
      accessibleRoomIds.add(r.id);
    } else {
      inaccessibleRoomIds.add(r.id);
    }
  }

  const sliceDiag = detectSliceBlocking(
    floors,
    activeFloorId,
    stairLinks,
    includeSecret,
    tolerance,
    includeLocked,
    baseResult
  );

  if (inaccessibleRoomIds.size === 0) {
    return {
      accessibleRoomIds,
      inaccessibleRoomIds,
      highlightedDisabledDoorIds: new Set(),
      highlightedWalls: [],
      tooltipMessage: sliceDiag.sliceBlockingMessage,
      inaccessibleCountByFloor,
      blockingSliceIds: sliceDiag.blockingSliceIds,
      sliceBlockedRoomIds: sliceDiag.sliceBlockedRoomIds,
      sliceBlockingMessage: sliceDiag.sliceBlockingMessage,
    };
  }

  const nonSliceInaccRooms = activeFloor.rooms.filter(
    (r) => inaccessibleRoomIds.has(r.id) && !sliceDiag.sliceBlockedRoomIds.has(r.id)
  );

  const highlightedDisabledDoorIds = new Set<string>();
  if (nonSliceInaccRooms.length > 0) {
    const nonSliceInaccSet = new Set(nonSliceInaccRooms.map((r) => r.id));
    for (const d of activeFloor.doorways) {
      if (isDoorPassable(d, { includeSecret, includeLocked })) continue;
      if (d.roomBId === null) {
        if (nonSliceInaccSet.has(d.roomAId)) highlightedDisabledDoorIds.add(d.id);
      } else {
        const aAcc = accessibleRoomIds.has(d.roomAId);
        const bAcc = accessibleRoomIds.has(d.roomBId);
        if (aAcc !== bAcc && (nonSliceInaccSet.has(d.roomAId) || nonSliceInaccSet.has(d.roomBId))) {
          highlightedDisabledDoorIds.add(d.id);
        }
      }
    }

    if (highlightedDisabledDoorIds.size === 0) {
      for (const d of activeFloor.doorways) {
        if (
          !isDoorPassable(d, { includeSecret, includeLocked }) &&
          (nonSliceInaccSet.has(d.roomAId) ||
            (d.roomBId && nonSliceInaccSet.has(d.roomBId)))
        ) {
          highlightedDisabledDoorIds.add(d.id);
        }
      }
    }
  }

  if (sliceDiag.sliceBlockingMessage && nonSliceInaccRooms.length === 0) {
    return {
      accessibleRoomIds,
      inaccessibleRoomIds,
      highlightedDisabledDoorIds,
      highlightedWalls: [],
      tooltipMessage: sliceDiag.sliceBlockingMessage,
      inaccessibleCountByFloor,
      blockingSliceIds: sliceDiag.blockingSliceIds,
      sliceBlockedRoomIds: sliceDiag.sliceBlockedRoomIds,
      sliceBlockingMessage: sliceDiag.sliceBlockingMessage,
    };
  }

  if (highlightedDisabledDoorIds.size > 0) {
    return {
      accessibleRoomIds,
      inaccessibleRoomIds,
      highlightedDisabledDoorIds,
      highlightedWalls: [],
      tooltipMessage:
        sliceDiag.sliceBlockingMessage ??
        `${inaccessibleRoomIds.size} room${
          inaccessibleRoomIds.size > 1 ? 's' : ''
        } on ${activeFloor.name} cannot be reached — select a highlighted doorway to enable or unlock it.`,
      inaccessibleCountByFloor,
      blockingSliceIds: sliceDiag.blockingSliceIds,
      sliceBlockedRoomIds: sliceDiag.sliceBlockedRoomIds,
      sliceBlockingMessage: sliceDiag.sliceBlockingMessage,
    };
  }

  const highlightedWalls: WallHighlight[] = [];
  if (accessibleRoomIds.size === 0) {
    const hasOtherFloors = floors.length > 1;
    const entryCandidate = activeFloor.rooms[0];
    for (let e = 0; e < entryCandidate.points.length; e++) {
      if (isWallEdgeExterior(entryCandidate, e, activeFloor.rooms)) {
        highlightedWalls.push({
          roomId: entryCandidate.id,
          edgeIndex: e,
          a: entryCandidate.points[e],
          b: entryCandidate.points[(e + 1) % entryCandidate.points.length],
        });
      }
    }
    return {
      accessibleRoomIds,
      inaccessibleRoomIds,
      highlightedDisabledDoorIds,
      highlightedWalls,
      tooltipMessage:
        sliceDiag.sliceBlockingMessage ??
        (hasOtherFloors
          ? `${activeFloor.name} has no reachable entrance! Link a stairway from an accessible floor or add an exterior door.`
          : 'No entrance leads outside! Use the Door tool to add a main door on a highlighted exterior wall.'),
      inaccessibleCountByFloor,
      blockingSliceIds: sliceDiag.blockingSliceIds,
      sliceBlockedRoomIds: sliceDiag.sliceBlockedRoomIds,
      sliceBlockingMessage: sliceDiag.sliceBlockingMessage,
    };
  }

  const accRooms = activeFloor.rooms.filter((r) => accessibleRoomIds.has(r.id));
  const inaccRooms =
    nonSliceInaccRooms.length > 0
      ? nonSliceInaccRooms
      : activeFloor.rooms.filter((r) => inaccessibleRoomIds.has(r.id));
  const wallTol = tolerance + 6;

  for (const rInacc of inaccRooms) {
    const boxInacc = getRoomBoundingBox(rInacc);
    const segsInaccAll = getAllEdgeSubSegments(rInacc, 4);
    let foundShared = false;

    for (const rAcc of accRooms) {
      const boxAcc = getRoomBoundingBox(rAcc);
      if (
        boxInacc.maxX + wallTol < boxAcc.minX ||
        boxAcc.maxX + wallTol < boxInacc.minX ||
        boxInacc.maxY + wallTol < boxAcc.minY ||
        boxAcc.maxY + wallTol < boxInacc.minY
      ) {
        continue;
      }

      const segsAccAll = getAllEdgeSubSegments(rAcc, 4);
      for (let eA = 0; eA < segsInaccAll.length; eA++) {
        const segsA = segsInaccAll[eA];
        for (let eB = 0; eB < segsAccAll.length; eB++) {
          const segsB = segsAccAll[eB];
          for (let sa = 0; sa < segsA.length; sa++) {
            for (let sb = 0; sb < segsB.length; sb++) {
              const contact = detectSegmentSharedContact(segsA[sa], segsB[sb], wallTol);
              if (contact) {
                highlightedWalls.push({
                  roomId: rInacc.id,
                  edgeIndex: eA,
                  a: contact.segStart,
                  b: contact.segEnd,
                });
                foundShared = true;
              }
            }
          }
        }
      }
    }

    if (!foundShared) {
      for (let e = 0; e < rInacc.points.length; e++) {
        if (isWallEdgeExterior(rInacc, e, activeFloor.rooms)) {
          highlightedWalls.push({
            roomId: rInacc.id,
            edgeIndex: e,
            a: rInacc.points[e],
            b: rInacc.points[(e + 1) % rInacc.points.length],
          });
          break;
        }
      }
    }
  }

  return {
    accessibleRoomIds,
    inaccessibleRoomIds,
    highlightedDisabledDoorIds,
    highlightedWalls,
    tooltipMessage:
      sliceDiag.sliceBlockingMessage ??
      `${inaccessibleRoomIds.size} room${
        inaccessibleRoomIds.size > 1 ? 's are' : ' is'
      } unreachable on ${activeFloor.name} — add a door on the highlighted wall(s) or link a stairway.`,
    inaccessibleCountByFloor,
    blockingSliceIds: sliceDiag.blockingSliceIds,
    sliceBlockedRoomIds: sliceDiag.sliceBlockedRoomIds,
    sliceBlockingMessage: sliceDiag.sliceBlockingMessage,
  };
}

// ---------------------------------------------------------------------------
// Room-to-Room Automatic Pathing Sequence + Interior Geometry A*
// ---------------------------------------------------------------------------

function segmentInsidePolygon(
  a: Point,
  b: Point,
  poly: Point[],
  blockedSlices: SampledSlice[] = []
): boolean {
  const steps = Math.max(4, Math.ceil(distance(a, b) / 10));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const pt = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (!pointInPolygon(pt, poly)) {
      return false;
    }
    if (blockedSlices.length > 0 && pointInSampledSlices(pt, blockedSlices)) {
      return false;
    }
  }
  return true;
}

function findWalkablePathInsideRoom(
  room: Room,
  start: Point,
  end: Point,
  floorSlices: SliceRegion[] = []
): Point[] | null {
  const poly = sampleRoomPolygon(room, 8);
  if (poly.length < 3) return [start, end];

  const bbox = getRoomBoundingBox(room);
  const overlappingSlices: SampledSlice[] = floorSlices
    .filter((s) => s.mode === 'floor' && s.points.length >= 3)
    .map((s) => {
      const sPoly = sampleRoomPolygon(s, 8);
      return { slice: s, poly: sPoly, box: getPolygonBoundingBox(sPoly) };
    })
    .filter((s) => boxesOverlap2D(bbox, s.box, 2));

  if (
    pointInSampledSlices(start, overlappingSlices) ||
    pointInSampledSlices(end, overlappingSlices)
  ) {
    return null;
  }

  if (segmentInsidePolygon(start, end, poly, overlappingSlices)) {
    return [start, end];
  }

  const step = Math.max(12, Math.min(22, Math.min(bbox.width, bbox.height) / 12));
  const cols = Math.min(44, Math.max(4, Math.ceil(bbox.width / step) + 1));
  const rows = Math.min(44, Math.max(4, Math.ceil(bbox.height / step) + 1));

  const cellX = (c: number) => bbox.minX + (c + 0.5) * (bbox.width / cols);
  const cellY = (r: number) => bbox.minY + (r + 0.5) * (bbox.height / rows);

  const walkable = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const py = cellY(r);
    for (let c = 0; c < cols; c++) {
      const pt = { x: cellX(c), y: py };
      if (pointInPolygon(pt, poly) && !pointInSampledSlices(pt, overlappingSlices)) {
        walkable[r * cols + c] = 1;
      }
    }
  }

  const nearestWalkable = (pt: Point): { r: number; c: number } | null => {
    let bestClear: { r: number; c: number } | null = null;
    let bestClearD = Infinity;
    let bestAny: { r: number; c: number } | null = null;
    let bestAnyD = Infinity;
    for (let r = 0; r < rows; r++) {
      const py = cellY(r);
      for (let c = 0; c < cols; c++) {
        if (!walkable[r * cols + c]) continue;
        const centerPt = { x: cellX(c), y: py };
        const d = distance(centerPt, pt);
        if (d < bestAnyD) {
          bestAnyD = d;
          bestAny = { r, c };
        }
        if (d < bestClearD && !segmentBlockedBySlices(pt, centerPt, overlappingSlices)) {
          bestClearD = d;
          bestClear = { r, c };
        }
      }
    }
    if (bestClear && bestClearD <= Math.max(36, step * 2.5)) return bestClear;
    if (overlappingSlices.length === 0) return bestAny;
    return bestAny && bestAnyD <= Math.max(18, step) ? bestAny : null;
  };

  const sCell = nearestWalkable(start);
  const eCell = nearestWalkable(end);
  if (!sCell || !eCell) return overlappingSlices.length > 0 ? null : [start, end];

  const totalCells = rows * cols;
  const gScore = new Float64Array(totalCells).fill(Infinity);
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const closed = new Uint8Array(totalCells);

  const startIdx = sCell.r * cols + sCell.c;
  const endIdx = eCell.r * cols + eCell.c;
  gScore[startIdx] = 0;

  const open = new MinHeap<{ idx: number; r: number; c: number; f: number; g: number }>(
    (n) => n.f
  );
  open.push({
    idx: startIdx,
    r: sCell.r,
    c: sCell.c,
    g: 0,
    f: Math.hypot(eCell.r - sCell.r, eCell.c - sCell.c),
  });

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  let found = false;
  while (open.size > 0) {
    const curr = open.pop()!;
    if (curr.idx === endIdx) {
      found = true;
      break;
    }
    if (closed[curr.idx]) continue;
    closed[curr.idx] = 1;

    const pCurr = { x: cellX(curr.c), y: cellY(curr.r) };
    for (let d = 0; d < 8; d++) {
      const nr = curr.r + dirs[d][0];
      const nc = curr.c + dirs[d][1];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nIdx = nr * cols + nc;
      if (!walkable[nIdx] || closed[nIdx]) continue;
      if (overlappingSlices.length > 0) {
        const pNext = { x: cellX(nc), y: cellY(nr) };
        if (segmentBlockedBySlices(pCurr, pNext, overlappingSlices)) continue;
      }

      const moveCost = d >= 4 ? Math.SQRT2 : 1;
      const tentG = curr.g + moveCost;
      if (tentG < gScore[nIdx]) {
        gScore[nIdx] = tentG;
        cameFrom[nIdx] = curr.idx;
        const h = Math.hypot(eCell.r - nr, eCell.c - nc);
        open.push({ idx: nIdx, r: nr, c: nc, g: tentG, f: tentG + h });
      }
    }
  }

  if (!found) return overlappingSlices.length > 0 ? null : [start, end];

  const rawPoints: Point[] = [];
  let trace = endIdx;
  while (trace !== -1) {
    const r = Math.floor(trace / cols);
    const c = trace % cols;
    rawPoints.unshift({ x: cellX(c), y: cellY(r) });
    trace = cameFrom[trace];
  }

  const full = [start, ...rawPoints, end];
  const smoothed: Point[] = [full[0]];
  let idx = 0;
  while (idx < full.length - 1) {
    let nextIdx = idx + 1;
    for (let test = full.length - 1; test > idx + 1; test--) {
      if (segmentInsidePolygon(full[idx], full[test], poly, overlappingSlices)) {
        nextIdx = test;
        break;
      }
    }
    smoothed.push(full[nextIdx]);
    idx = nextIdx;
  }

  return smoothed;
}

export interface PathingOptions {
  includeSecret: boolean;
  includeLocked?: boolean;
  cellSize: number;
  feetPerCell: number;
}

export function computeMultiStopRoomPath(
  rooms: Room[],
  doorways: Doorway[],
  stopRoomIds: string[],
  options: PathingOptions,
  secretPassages: SecretPassage[] = [],
  slices: SliceRegion[] = []
): PathResult {
  if (stopRoomIds.length < 2) {
    return {
      reachable: false,
      waypoints: [],
      steps: [],
      totalDistanceFt: 0,
      totalSquares: 0,
      roundsAt30Ft: 0,
      reason: 'Select at least a Start room and a Destination room.',
    };
  }

  const roomMap = new Map(rooms.map((r) => [r.id, r]));
  const anchors = new Map<string, Point>();
  for (const r of rooms) {
    anchors.set(r.id, getEffectiveRoomLabelAnchor(r, slices));
  }

  const activeDoors = doorways.filter(
    (d) =>
      !isDoorwaySliced(d, slices) &&
      isDoorPassable(d, {
        includeSecret: options.includeSecret,
        includeLocked: options.includeLocked ?? true,
      }) &&
      d.roomBId !== null &&
      roomMap.has(d.roomAId) &&
      roomMap.has(d.roomBId)
  );

  type PortalLink = {
    neighborId: string;
    exitPoint: Point;
    entryPoint: Point;
    passagePoints: Point[];
    passageCostPx: number;
    door?: Doorway;
    sliceId?: string;
    secretPassage?: SecretPassage;
  };

  const adj = new Map<string, PortalLink[]>();
  for (const r of rooms) adj.set(r.id, []);

  for (const d of activeDoors) {
    if (!d.roomBId) continue;
    adj.get(d.roomAId)?.push({
      neighborId: d.roomBId,
      exitPoint: d.position,
      entryPoint: d.position,
      passagePoints: [d.position],
      passageCostPx: 0,
      door: d,
    });
    adj.get(d.roomBId)?.push({
      neighborId: d.roomAId,
      exitPoint: d.position,
      entryPoint: d.position,
      passagePoints: [d.position],
      passageCostPx: 0,
      door: d,
    });
  }

  const sliceConns = getWallSliceConnections(rooms, slices);
  for (const pair of sliceConns.roomPairs) {
    adj.get(pair.roomAId)?.push({
      neighborId: pair.roomBId,
      exitPoint: pair.position,
      entryPoint: pair.position,
      passagePoints: [pair.position],
      passageCostPx: 0,
      sliceId: pair.sliceId,
    });
    adj.get(pair.roomBId)?.push({
      neighborId: pair.roomAId,
      exitPoint: pair.position,
      entryPoint: pair.position,
      passagePoints: [pair.position],
      passageCostPx: 0,
      sliceId: pair.sliceId,
    });
  }

  if (options.includeSecret) {
    for (const sp of secretPassages) {
      if (!sp.toRoomId) continue;
      if (!roomMap.has(sp.fromRoomId) || !roomMap.has(sp.toRoomId)) continue;
      if (sp.points.length < 2) continue;

      let tunnelPx = 0;
      for (let i = 1; i < sp.points.length; i++) {
        tunnelPx += distance(sp.points[i - 1], sp.points[i]);
      }

      adj.get(sp.fromRoomId)?.push({
        neighborId: sp.toRoomId,
        exitPoint: sp.points[0],
        entryPoint: sp.points[sp.points.length - 1],
        passagePoints: sp.points,
        passageCostPx: tunnelPx,
        secretPassage: sp,
      });
      adj.get(sp.toRoomId)?.push({
        neighborId: sp.fromRoomId,
        exitPoint: sp.points[sp.points.length - 1],
        entryPoint: sp.points[0],
        passagePoints: [...sp.points].reverse(),
        passageCostPx: tunnelPx,
        secretPassage: sp,
      });
    }
  }

  // Memoize interior room paths across legs/iterations in this invocation
  const floorSlicesOnly = slices.filter((s) => s.mode === 'floor' && s.points.length >= 3);
  const interiorCache = new Map<string, Point[] | null>();
  const getCachedInteriorPath = (room: Room, a: Point, b: Point): Point[] | null => {
    const key = `${room.id}:${a.x.toFixed(1)},${a.y.toFixed(1)}->${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    let pts = interiorCache.get(key);
    if (pts === undefined) {
      pts = findWalkablePathInsideRoom(room, a, b, floorSlicesOnly);
      interiorCache.set(key, pts);
    }
    return pts;
  };

  const allWaypoints: Point[] = [];
  const allSteps: PathStep[] = [];
  let cumulativePx = 0;

  for (let legIdx = 0; legIdx < stopRoomIds.length - 1; legIdx++) {
    const startId = stopRoomIds[legIdx];
    const endId = stopRoomIds[legIdx + 1];
    const startRoom = roomMap.get(startId);
    const endRoom = roomMap.get(endId);

    if (!startRoom || !endRoom) {
      return {
        reachable: false,
        waypoints: [],
        steps: [],
        totalDistanceFt: 0,
        totalSquares: 0,
        roundsAt30Ft: 0,
        reason: 'One or more selected rooms no longer exist.',
      };
    }

    if (startId === endId) {
      if (legIdx === 0) {
        allSteps.push({
          floorId: 'floor-1',
          floorName: 'Level 1',
          roomId: startRoom.id,
          roomName: startRoom.name,
          roomType: startRoom.type,
          distanceFromPrevFt: 0,
          cumulativeDistanceFt: 0,
        });
        allWaypoints.push(anchors.get(startRoom.id)!);
      }
      continue;
    }

    type QueueNode = {
      roomId: string;
      entryPoint: Point;
      costPx: number;
      viaDoor?: Doorway;
      viaSecretPassage?: SecretPassage;
      pathTrace: Array<{
        roomId: string;
        viaDoor?: Doorway;
        viaSecretPassage?: SecretPassage;
        segmentPoints: Point[];
        segmentCostPx: number;
      }>;
    };

    const startAnchor = anchors.get(startId)!;
    const endAnchor = anchors.get(endId)!;

    const visitedBest = new Map<string, number>();
    const pq = new MinHeap<QueueNode>((n) => n.costPx);
    pq.push({
      roomId: startId,
      entryPoint: startAnchor,
      costPx: 0,
      pathTrace: [
        {
          roomId: startId,
          segmentPoints: [startAnchor],
          segmentCostPx: 0,
        },
      ],
    });

    let winningTrace: QueueNode['pathTrace'] | null = null;
    let bestGoalCost = Infinity;

    while (pq.size > 0) {
      const curr = pq.pop()!;

      if (curr.costPx >= bestGoalCost) {
        break;
      }

      if (curr.roomId === endId) {
        const finalSeg = getCachedInteriorPath(endRoom, curr.entryPoint, endAnchor);
        if (!finalSeg) continue;
        let segCost = 0;
        for (let k = 1; k < finalSeg.length; k++) {
          segCost += distance(finalSeg[k - 1], finalSeg[k]);
        }
        const totalWithFinal = curr.costPx + segCost;
        if (totalWithFinal < bestGoalCost) {
          bestGoalCost = totalWithFinal;
          const traceCopy = [...curr.pathTrace];
          traceCopy[traceCopy.length - 1] = {
            ...traceCopy[traceCopy.length - 1],
            segmentPoints: finalSeg,
            segmentCostPx: segCost,
          };
          winningTrace = traceCopy;
        }
        continue;
      }

      const currRoom = roomMap.get(curr.roomId)!;
      const neighbors = adj.get(curr.roomId) ?? [];

      for (const link of neighbors) {
        if (curr.pathTrace.some((t) => t.roomId === link.neighborId)) continue;
        const portalId = link.door?.id ?? link.secretPassage?.id ?? 'portal';
        const stateKey = `${curr.roomId}->${portalId}->${link.neighborId}`;
        const segPts = getCachedInteriorPath(currRoom, curr.entryPoint, link.exitPoint);
        if (!segPts) continue;
        let segPx = 0;
        for (let k = 1; k < segPts.length; k++) {
          segPx += distance(segPts[k - 1], segPts[k]);
        }
        const combinedSegPts =
          link.passagePoints.length > 1 ? [...segPts, ...link.passagePoints.slice(1)] : segPts;
        const combinedSegPx = segPx + link.passageCostPx;
        const nextCost = curr.costPx + combinedSegPx;
        if (nextCost >= (visitedBest.get(stateKey) ?? Infinity)) continue;
        visitedBest.set(stateKey, nextCost);

        const nextTrace = [...curr.pathTrace];
        nextTrace[nextTrace.length - 1] = {
          ...nextTrace[nextTrace.length - 1],
          segmentPoints: combinedSegPts,
          segmentCostPx: combinedSegPx,
        };
        nextTrace.push({
          roomId: link.neighborId,
          viaDoor: link.door,
          viaSecretPassage: link.secretPassage,
          segmentPoints: [link.entryPoint],
          segmentCostPx: 0,
        });

        pq.push({
          roomId: link.neighborId,
          entryPoint: link.entryPoint,
          costPx: nextCost,
          viaDoor: link.door,
          viaSecretPassage: link.secretPassage,
          pathTrace: nextTrace,
        });
      }
    }

    if (!winningTrace) {
      return {
        reachable: false,
        waypoints: [],
        steps: [],
        totalDistanceFt: 0,
        totalSquares: 0,
        roundsAt30Ft: 0,
        reason: `No valid doorway path from "${startRoom.name}" to "${endRoom.name}". Connect rooms or adjust door locks/secret settings.`,
      };
    }

    for (let sIdx = 0; sIdx < winningTrace.length; sIdx++) {
      const seg = winningTrace[sIdx];
      const r = roomMap.get(seg.roomId)!;

      for (const pt of seg.segmentPoints) {
        const last = allWaypoints[allWaypoints.length - 1];
        if (!last || distance(last, pt) > 2) {
          allWaypoints.push(pt);
        }
      }

      if (legIdx > 0 && sIdx === 0) {
        const prevStep = allSteps[allSteps.length - 1];
        if (prevStep) {
          cumulativePx += seg.segmentCostPx;
          prevStep.cumulativeDistanceFt = Math.round(
            (cumulativePx / options.cellSize) * options.feetPerCell
          );
        }
        continue;
      }

      const prevRoomCostPx = sIdx > 0 ? winningTrace[sIdx - 1].segmentCostPx : 0;
      cumulativePx += sIdx === 0 ? 0 : prevRoomCostPx;
      const stepDistFt =
        sIdx === 0
          ? 0
          : Math.round((prevRoomCostPx / options.cellSize) * options.feetPerCell);

      let portalPosition: Point | undefined;
      if (seg.viaDoor) {
        portalPosition = seg.viaDoor.position;
      } else if (seg.viaSecretPassage && seg.viaSecretPassage.points.length >= 2) {
        const pts = seg.viaSecretPassage.points;
        const midIdx = Math.floor(pts.length / 2);
        portalPosition =
          pts.length % 2 === 1
            ? pts[midIdx]
            : {
                x: (pts[midIdx - 1].x + pts[midIdx].x) / 2,
                y: (pts[midIdx - 1].y + pts[midIdx].y) / 2,
              };
      }

      allSteps.push({
        floorId: 'floor-1',
        floorName: 'Level 1',
        roomId: r.id,
        roomName: r.name,
        roomType: r.type,
        viaDoorId: seg.viaDoor?.id,
        viaDoorKind: seg.viaDoor?.kind,
        viaSecretPassageId: seg.viaSecretPassage?.id,
        viaSecretPassageLabel: seg.viaSecretPassage?.label,
        portalPosition,
        floorWaypoints: seg.segmentPoints,
        distanceFromPrevFt: stepDistFt,
        cumulativeDistanceFt: Math.round(
          (cumulativePx / options.cellSize) * options.feetPerCell
        ),
      });

      if (sIdx === winningTrace.length - 1) {
        cumulativePx += seg.segmentCostPx;
        allSteps[allSteps.length - 1].cumulativeDistanceFt = Math.round(
          (cumulativePx / options.cellSize) * options.feetPerCell
        );
      }
    }
  }

  const totalDistanceFt = Math.round(
    (cumulativePx / options.cellSize) * options.feetPerCell
  );
  const totalSquares = Math.ceil(totalDistanceFt / options.feetPerCell);
  const roundsAt30Ft = Math.max(1, Math.ceil(totalDistanceFt / 30));

  return {
    reachable: true,
    waypoints: allWaypoints,
    steps: allSteps,
    totalDistanceFt,
    totalSquares,
    roundsAt30Ft,
  };
}

export function computeMultiFloorRoomPath(
  floors: MapFloor[],
  stairLinks: StairLink[],
  stops: PathStop[],
  options: PathingOptions
): PathResult {
  if (stops.length < 2) {
    return {
      reachable: false,
      waypoints: [],
      steps: [],
      totalDistanceFt: 0,
      totalSquares: 0,
      roundsAt30Ft: 0,
      reason: 'Select at least a Start room and a Destination room.',
    };
  }

  const nodeKey = (floorId: string, roomId: string) => `${floorId}::${roomId}`;
  const floorMap = new Map(floors.map((f) => [f.id, f]));
  const roomNodeMap = new Map<string, { floor: MapFloor; room: Room; anchor: Point }>();

  for (const fl of floors) {
    const flSlices = fl.slices ?? [];
    for (const r of fl.rooms) {
      roomNodeMap.set(nodeKey(fl.id, r.id), {
        floor: fl,
        room: r,
        anchor: getEffectiveRoomLabelAnchor(r, flSlices),
      });
    }
  }

  type MultiPortalLink = {
    neighborKey: string;
    exitPoint: Point;
    entryPoint: Point;
    passagePoints: Point[];
    passageCostPx: number;
    door?: Doorway;
    sliceId?: string;
    secretPassage?: SecretPassage;
    stairLink?: StairLink;
  };

  const adj = new Map<string, MultiPortalLink[]>();
  for (const k of roomNodeMap.keys()) adj.set(k, []);

  for (const fl of floors) {
    const flSlices = fl.slices ?? [];
    const activeDoors = fl.doorways.filter(
      (d) =>
        !isDoorwaySliced(d, flSlices) &&
        isDoorPassable(d, {
          includeSecret: options.includeSecret,
          includeLocked: options.includeLocked ?? true,
        }) &&
        d.roomBId !== null &&
        roomNodeMap.has(nodeKey(fl.id, d.roomAId)) &&
        roomNodeMap.has(nodeKey(fl.id, d.roomBId))
    );
    for (const d of activeDoors) {
      if (!d.roomBId) continue;
      const kA = nodeKey(fl.id, d.roomAId);
      const kB = nodeKey(fl.id, d.roomBId);
      adj.get(kA)?.push({
        neighborKey: kB,
        exitPoint: d.position,
        entryPoint: d.position,
        passagePoints: [d.position],
        passageCostPx: 0,
        door: d,
      });
      adj.get(kB)?.push({
        neighborKey: kA,
        exitPoint: d.position,
        entryPoint: d.position,
        passagePoints: [d.position],
        passageCostPx: 0,
        door: d,
      });
    }

    const sliceConns = getWallSliceConnections(fl.rooms, flSlices);
    for (const pair of sliceConns.roomPairs) {
      const kA = nodeKey(fl.id, pair.roomAId);
      const kB = nodeKey(fl.id, pair.roomBId);
      adj.get(kA)?.push({
        neighborKey: kB,
        exitPoint: pair.position,
        entryPoint: pair.position,
        passagePoints: [pair.position],
        passageCostPx: 0,
        sliceId: pair.sliceId,
      });
      adj.get(kB)?.push({
        neighborKey: kA,
        exitPoint: pair.position,
        entryPoint: pair.position,
        passagePoints: [pair.position],
        passageCostPx: 0,
        sliceId: pair.sliceId,
      });
    }

    if (options.includeSecret) {
      for (const sp of fl.secretPassages) {
        if (!sp.toRoomId || sp.points.length < 2) continue;
        const kA = nodeKey(fl.id, sp.fromRoomId);
        const kB = nodeKey(fl.id, sp.toRoomId);
        if (!roomNodeMap.has(kA) || !roomNodeMap.has(kB)) continue;
        let tunnelPx = 0;
        for (let i = 1; i < sp.points.length; i++) {
          tunnelPx += distance(sp.points[i - 1], sp.points[i]);
        }
        adj.get(kA)?.push({
          neighborKey: kB,
          exitPoint: sp.points[0],
          entryPoint: sp.points[sp.points.length - 1],
          passagePoints: sp.points,
          passageCostPx: tunnelPx,
          secretPassage: sp,
        });
        adj.get(kB)?.push({
          neighborKey: kA,
          exitPoint: sp.points[sp.points.length - 1],
          entryPoint: sp.points[0],
          passagePoints: [...sp.points].reverse(),
          passageCostPx: tunnelPx,
          secretPassage: sp,
        });
      }
    }
  }

  // Interlinking stairways across floors (adds 10ft / 2 squares vertical climb cost)
  const stairClimbPx = (10 / options.feetPerCell) * options.cellSize;
  for (const st of stairLinks) {
    if (!st.enabled) continue;
    const kFrom = nodeKey(st.fromFloorId, st.fromRoomId);
    const kTo = nodeKey(st.toFloorId, st.toRoomId);
    const nFrom = roomNodeMap.get(kFrom);
    const nTo = roomNodeMap.get(kTo);
    if (!nFrom || !nTo) continue;

    adj.get(kFrom)?.push({
      neighborKey: kTo,
      exitPoint: nFrom.anchor,
      entryPoint: nTo.anchor,
      passagePoints: [nFrom.anchor],
      passageCostPx: stairClimbPx,
      stairLink: st,
    });
    if (st.bidirectional !== false) {
      adj.get(kTo)?.push({
        neighborKey: kFrom,
        exitPoint: nTo.anchor,
        entryPoint: nFrom.anchor,
        passagePoints: [nTo.anchor],
        passageCostPx: stairClimbPx,
        stairLink: st,
      });
    }
  }

  const interiorCache = new Map<string, Point[] | null>();
  const getCachedInteriorPath = (
    floor: MapFloor,
    room: Room,
    a: Point,
    b: Point
  ): Point[] | null => {
    const k = `${floor.id}::${room.id}:${a.x.toFixed(1)},${a.y.toFixed(1)}->${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    let pts = interiorCache.get(k);
    if (pts === undefined) {
      pts = findWalkablePathInsideRoom(room, a, b, floor.slices ?? []);
      interiorCache.set(k, pts);
    }
    return pts;
  };

  const allWaypoints: Point[] = [];
  const allSteps: PathStep[] = [];
  let cumulativePx = 0;

  for (let legIdx = 0; legIdx < stops.length - 1; legIdx++) {
    const startKey = nodeKey(stops[legIdx].floorId, stops[legIdx].roomId);
    const endKey = nodeKey(stops[legIdx + 1].floorId, stops[legIdx + 1].roomId);
    const startNode = roomNodeMap.get(startKey);
    const endNode = roomNodeMap.get(endKey);

    if (!startNode || !endNode) {
      return {
        reachable: false,
        waypoints: [],
        steps: [],
        totalDistanceFt: 0,
        totalSquares: 0,
        roundsAt30Ft: 0,
        reason: 'One or more selected rooms no longer exist.',
      };
    }

    if (startKey === endKey) {
      if (legIdx === 0) {
        allSteps.push({
          floorId: startNode.floor.id,
          floorName: startNode.floor.name,
          roomId: startNode.room.id,
          roomName: startNode.room.name,
          roomType: startNode.room.type,
          floorWaypoints: [startNode.anchor],
          distanceFromPrevFt: 0,
          cumulativeDistanceFt: 0,
        });
        allWaypoints.push(startNode.anchor);
      }
      continue;
    }

    type MultiQueueNode = {
      nodeKey: string;
      entryPoint: Point;
      costPx: number;
      pathTrace: Array<{
        nodeKey: string;
        viaDoor?: Doorway;
        viaSliceId?: string;
        viaSlicePos?: Point;
        viaSecretPassage?: SecretPassage;
        viaStairLink?: StairLink;
        segmentPoints: Point[];
        sameFloorPoints: Point[];
        segmentCostPx: number;
      }>;
    };

    const visitedBest = new Map<string, number>();
    const pq = new MinHeap<MultiQueueNode>((n) => n.costPx);
    pq.push({
      nodeKey: startKey,
      entryPoint: startNode.anchor,
      costPx: 0,
      pathTrace: [
        {
          nodeKey: startKey,
          segmentPoints: [startNode.anchor],
          sameFloorPoints: [startNode.anchor],
          segmentCostPx: 0,
        },
      ],
    });

    let winningTrace: MultiQueueNode['pathTrace'] | null = null;
    let bestGoalCost = Infinity;

    while (pq.size > 0) {
      const curr = pq.pop()!;
      if (curr.costPx >= bestGoalCost) break;

      if (curr.nodeKey === endKey) {
        const finalSeg = getCachedInteriorPath(
          endNode.floor,
          endNode.room,
          curr.entryPoint,
          endNode.anchor
        );
        if (!finalSeg) continue;
        let segCost = 0;
        for (let k = 1; k < finalSeg.length; k++) {
          segCost += distance(finalSeg[k - 1], finalSeg[k]);
        }
        const totalWithFinal = curr.costPx + segCost;
        if (totalWithFinal < bestGoalCost) {
          bestGoalCost = totalWithFinal;
          const traceCopy = [...curr.pathTrace];
          traceCopy[traceCopy.length - 1] = {
            ...traceCopy[traceCopy.length - 1],
            segmentPoints: finalSeg,
            sameFloorPoints: finalSeg,
            segmentCostPx: segCost,
          };
          winningTrace = traceCopy;
        }
        continue;
      }

      const currRoomNode = roomNodeMap.get(curr.nodeKey)!;
      const neighbors = adj.get(curr.nodeKey) ?? [];

      for (const link of neighbors) {
        if (curr.pathTrace.some((t) => t.nodeKey === link.neighborKey)) continue;
        const portalId =
          link.door?.id ?? link.sliceId ?? link.secretPassage?.id ?? link.stairLink?.id ?? 'portal';
        const stateKey = `${curr.nodeKey}->${portalId}->${link.neighborKey}`;
        const segPts = getCachedInteriorPath(
          currRoomNode.floor,
          currRoomNode.room,
          curr.entryPoint,
          link.exitPoint
        );
        if (!segPts) continue;
        let segPx = 0;
        for (let k = 1; k < segPts.length; k++) {
          segPx += distance(segPts[k - 1], segPts[k]);
        }
        const combinedSegPts =
          link.passagePoints.length > 1 ? [...segPts, ...link.passagePoints.slice(1)] : segPts;
        const combinedSegPx = segPx + link.passageCostPx;
        const nextCost = curr.costPx + combinedSegPx;
        if (nextCost >= (visitedBest.get(stateKey) ?? Infinity)) continue;
        visitedBest.set(stateKey, nextCost);

        const nextTrace = [...curr.pathTrace];
        nextTrace[nextTrace.length - 1] = {
          ...nextTrace[nextTrace.length - 1],
          segmentPoints: combinedSegPts,
          sameFloorPoints: link.stairLink ? segPts : combinedSegPts,
          segmentCostPx: combinedSegPx,
        };
        nextTrace.push({
          nodeKey: link.neighborKey,
          viaDoor: link.door,
          viaSliceId: link.sliceId,
          viaSlicePos: link.sliceId ? link.exitPoint : undefined,
          viaSecretPassage: link.secretPassage,
          viaStairLink: link.stairLink,
          segmentPoints: [link.entryPoint],
          sameFloorPoints: [link.entryPoint],
          segmentCostPx: 0,
        });

        pq.push({
          nodeKey: link.neighborKey,
          entryPoint: link.entryPoint,
          costPx: nextCost,
          pathTrace: nextTrace,
        });
      }
    }

    if (!winningTrace) {
      const startFloorName = floorMap.get(stops[legIdx].floorId)?.name ?? '';
      const endFloorName = floorMap.get(stops[legIdx + 1].floorId)?.name ?? '';
      return {
        reachable: false,
        waypoints: [],
        steps: [],
        totalDistanceFt: 0,
        totalSquares: 0,
        roundsAt30Ft: 0,
        reason:
          stops[legIdx].floorId !== stops[legIdx + 1].floorId
            ? `No valid path from "${startNode.room.name}" (${startFloorName}) to "${endNode.room.name}" (${endFloorName}). Check doorways and interlinking stairways.`
            : `No valid doorway path from "${startNode.room.name}" to "${endNode.room.name}". Connect rooms or adjust door locks/secret settings.`,
      };
    }

    for (let sIdx = 0; sIdx < winningTrace.length; sIdx++) {
      const seg = winningTrace[sIdx];
      const rNode = roomNodeMap.get(seg.nodeKey)!;

      for (const pt of seg.segmentPoints) {
        const last = allWaypoints[allWaypoints.length - 1];
        if (!last || distance(last, pt) > 2) {
          allWaypoints.push(pt);
        }
      }

      if (legIdx > 0 && sIdx === 0) {
        const prevStep = allSteps[allSteps.length - 1];
        if (prevStep) {
          cumulativePx += seg.segmentCostPx;
          prevStep.floorWaypoints = [
            ...(prevStep.floorWaypoints ?? []),
            ...seg.sameFloorPoints,
          ];
          prevStep.cumulativeDistanceFt = Math.round(
            (cumulativePx / options.cellSize) * options.feetPerCell
          );
        }
        continue;
      }

      const prevRoomCostPx = sIdx > 0 ? winningTrace[sIdx - 1].segmentCostPx : 0;
      cumulativePx += sIdx === 0 ? 0 : prevRoomCostPx;
      const stepDistFt =
        sIdx === 0
          ? 0
          : Math.round((prevRoomCostPx / options.cellSize) * options.feetPerCell);

      let portalPosition: Point | undefined;
      if (seg.viaDoor) {
        portalPosition = seg.viaDoor.position;
      } else if (seg.viaSecretPassage && seg.viaSecretPassage.points.length >= 2) {
        const pts = seg.viaSecretPassage.points;
        const midIdx = Math.floor(pts.length / 2);
        portalPosition =
          pts.length % 2 === 1
            ? pts[midIdx]
            : {
                x: (pts[midIdx - 1].x + pts[midIdx].x) / 2,
                y: (pts[midIdx - 1].y + pts[midIdx].y) / 2,
              };
      } else if (seg.viaStairLink) {
        portalPosition = rNode.anchor;
      } else if (seg.viaSliceId) {
        portalPosition = seg.viaSlicePos;
      }

      allSteps.push({
        floorId: rNode.floor.id,
        floorName: rNode.floor.name,
        roomId: rNode.room.id,
        roomName: rNode.room.name,
        roomType: rNode.room.type,
        viaDoorId: seg.viaDoor?.id,
        viaDoorKind: seg.viaDoor?.kind,
        viaSliceId: seg.viaSliceId,
        viaSecretPassageId: seg.viaSecretPassage?.id,
        viaSecretPassageLabel: seg.viaSecretPassage?.label,
        viaStairLinkId: seg.viaStairLink?.id,
        viaStairLabel: seg.viaStairLink?.label,
        portalPosition,
        floorWaypoints: seg.sameFloorPoints,
        distanceFromPrevFt: stepDistFt,
        cumulativeDistanceFt: Math.round(
          (cumulativePx / options.cellSize) * options.feetPerCell
        ),
      });

      if (sIdx === winningTrace.length - 1) {
        cumulativePx += seg.segmentCostPx;
        allSteps[allSteps.length - 1].cumulativeDistanceFt = Math.round(
          (cumulativePx / options.cellSize) * options.feetPerCell
        );
      }
    }
  }

  const totalDistanceFt = Math.round(
    (cumulativePx / options.cellSize) * options.feetPerCell
  );
  const totalSquares = Math.ceil(totalDistanceFt / options.feetPerCell);
  const roundsAt30Ft = Math.max(1, Math.ceil(totalDistanceFt / 30));

  return {
    reachable: true,
    waypoints: allWaypoints,
    steps: allSteps,
    totalDistanceFt,
    totalSquares,
    roundsAt30Ft,
  };
}

export type RoomHandleHit =
  | { kind: 'vertex'; vertexIndex: number; dist: number }
  | { kind: 'curve'; edgeIndex: number; dist: number }
  | { kind: 'rotate'; dist: number }
  | { kind: 'add-vertex'; edgeIndex: number; dist: number };

export type SliceHandleHit =
  | { kind: 'vertex'; vertexIndex: number; dist: number }
  | { kind: 'curve'; edgeIndex: number; dist: number }
  | { kind: 'add-vertex'; edgeIndex: number; dist: number };

export type SecretPassageHandleHit =
  | {
      kind: 'existing';
      handle:
        | { role: 'start-anchor' }
        | { role: 'end-anchor' }
        | { role: 'start-protrusion' }
        | { role: 'end-protrusion' }
        | { role: 'mid-point'; midIndex: number };
      dist: number;
    }
  | {
      kind: 'add-mid';
      insertIndex: number;
      point: Point;
      dist: number;
    };

export function pickNearestRoomHandle(
  room: Room,
  worldPt: Point,
  hitTol: number,
  zoom = 1
): RoomHandleHit | null {
  const safeZoom = Math.max(0.1, zoom);
  const addTol = hitTol * 0.72;
  let bestHit: RoomHandleHit | null = null;
  let bestScore = Infinity;

  const consider = (hit: RoomHandleHit, biasPx: number) => {
    const score = hit.dist + biasPx / safeZoom;
    if (score < bestScore) {
      bestScore = score;
      bestHit = hit;
    }
  };

  for (let i = 0; i < room.points.length; i++) {
    const d = distance(worldPt, room.points[i]);
    if (d <= hitTol) {
      consider({ kind: 'vertex', vertexIndex: i, dist: d }, 0);
    }
  }

  for (let i = 0; i < room.points.length; i++) {
    const a = room.points[i];
    const b = room.points[(i + 1) % room.points.length];
    const bend = room.edgeCurves[i] ?? 0;
    const handle = getEdgeHandlePoint(a, b, bend);
    const d = distance(worldPt, handle);
    if (d <= hitTol) {
      consider({ kind: 'curve', edgeIndex: i, dist: d }, 1.0);
    }
  }

  const rotGeo = getRoomRotationHandleGeometry(room);
  const dRot = distance(worldPt, rotGeo.handle);
  if (dRot <= hitTol) {
    consider({ kind: 'rotate', dist: dRot }, 1.5);
  }

  for (let i = 0; i < room.points.length; i++) {
    const addPt = getPointAlongRoomEdge(room, i, 0.25);
    const d = distance(worldPt, addPt);
    if (d <= addTol) {
      consider({ kind: 'add-vertex', edgeIndex: i, dist: d }, 2.5);
    }
  }

  return bestHit;
}

export function pickNearestSliceHandle(
  slice: SliceRegion,
  worldPt: Point,
  hitTol: number,
  zoom = 1
): SliceHandleHit | null {
  const safeZoom = Math.max(0.1, zoom);
  const addTol = hitTol * 0.72;
  let bestHit: SliceHandleHit | null = null;
  let bestScore = Infinity;

  const consider = (hit: SliceHandleHit, biasPx: number) => {
    const score = hit.dist + biasPx / safeZoom;
    if (score < bestScore) {
      bestScore = score;
      bestHit = hit;
    }
  };

  for (let i = 0; i < slice.points.length; i++) {
    const d = distance(worldPt, slice.points[i]);
    if (d <= hitTol) {
      consider({ kind: 'vertex', vertexIndex: i, dist: d }, 0);
    }
  }

  for (let i = 0; i < slice.points.length; i++) {
    const a = slice.points[i];
    const b = slice.points[(i + 1) % slice.points.length];
    const bend = slice.edgeCurves[i] ?? 0;
    const handle = getEdgeHandlePoint(a, b, bend);
    const d = distance(worldPt, handle);
    if (d <= hitTol) {
      consider({ kind: 'curve', edgeIndex: i, dist: d }, 1.0);
    }
  }

  for (let i = 0; i < slice.points.length; i++) {
    const addPt = getPointAlongRoomEdge(slice, i, 0.25);
    const d = distance(worldPt, addPt);
    if (d <= addTol) {
      consider({ kind: 'add-vertex', edgeIndex: i, dist: d }, 2.5);
    }
  }

  return bestHit;
}

export function pickNearestSecretPassageHandle(
  passage: SecretPassage,
  rooms: Room[],
  worldPt: Point,
  hitTol: number,
  zoom = 1
): SecretPassageHandleHit | null {
  const safeZoom = Math.max(0.1, zoom);
  const addTol = hitTol * 0.72;
  const resolved = resolveSecretPassagePolyline(passage, rooms);
  let bestHit: SecretPassageHandleHit | null = null;
  let bestScore = Infinity;

  const consider = (hit: SecretPassageHandleHit, biasPx: number) => {
    const score = hit.dist + biasPx / safeZoom;
    if (score < bestScore) {
      bestScore = score;
      bestHit = hit;
    }
  };

  const dStart = distance(worldPt, resolved.startAnchor);
  if (dStart <= hitTol) {
    consider({ kind: 'existing', handle: { role: 'start-anchor' }, dist: dStart }, 0);
  }

  const dEnd = distance(worldPt, resolved.endAnchor);
  if (dEnd <= hitTol) {
    consider({ kind: 'existing', handle: { role: 'end-anchor' }, dist: dEnd }, 0);
  }

  const dStartElbow = distance(worldPt, resolved.startElbow);
  if (dStartElbow <= hitTol) {
    consider(
      { kind: 'existing', handle: { role: 'start-protrusion' }, dist: dStartElbow },
      1.0
    );
  }

  if (resolved.endElbow) {
    const dEndElbow = distance(worldPt, resolved.endElbow);
    if (dEndElbow <= hitTol) {
      consider(
        { kind: 'existing', handle: { role: 'end-protrusion' }, dist: dEndElbow },
        1.0
      );
    }
  }

  for (let mIdx = 0; mIdx < passage.midPoints.length; mIdx++) {
    const dMid = distance(worldPt, passage.midPoints[mIdx]);
    if (dMid <= hitTol) {
      consider(
        { kind: 'existing', handle: { role: 'mid-point', midIndex: mIdx }, dist: dMid },
        1.0
      );
    }
  }

  const middleChain: Point[] = [
    resolved.startElbow,
    ...passage.midPoints,
    ...(resolved.endElbow
      ? [resolved.endElbow]
      : distance(resolved.startElbow, resolved.endAnchor) > 8
        ? [resolved.endAnchor]
        : []),
  ];
  for (let i = 0; i < middleChain.length - 1; i++) {
    const mid = {
      x: (middleChain[i].x + middleChain[i + 1].x) / 2,
      y: (middleChain[i].y + middleChain[i + 1].y) / 2,
    };
    const dAdd = distance(worldPt, mid);
    if (dAdd <= addTol) {
      consider(
        { kind: 'add-mid', insertIndex: i, point: mid, dist: dAdd },
        2.5
      );
    }
  }

  return bestHit;
}

export function pickNearestDoorway(
  doorways: Doorway[],
  activeSlices: SliceRegion[],
  worldPt: Point,
  hitTol: number
): { door: Doorway; dist: number } | null {
  let best: { door: Doorway; dist: number } | null = null;
  for (const door of doorways) {
    if (isDoorwaySliced(door, activeSlices)) continue;
    if (
      !Number.isFinite(door.position.x) ||
      !Number.isFinite(door.position.y) ||
      !Number.isFinite(door.angle)
    ) {
      continue;
    }
    const hw = door.width / 2;
    const ux = Math.cos(door.angle);
    const uy = Math.sin(door.angle);
    const pA = { x: door.position.x - ux * hw, y: door.position.y - uy * hw };
    const pB = { x: door.position.x + ux * hw, y: door.position.y + uy * hw };
    const d = pointToSegmentDistance(worldPt, pA, pB).dist;
    if (d <= hitTol && (!best || d < best.dist)) {
      best = { door, dist: d };
    }
  }
  return best;
}

export function pickNearestPolygonEdge(
  poly: { points: Point[]; edgeCurves: number[] },
  worldPt: Point,
  hitTol: number
): { edgeIndex: number; dist: number } | null {
  let best: { edgeIndex: number; dist: number } | null = null;
  for (let i = 0; i < poly.points.length; i++) {
    const a = poly.points[i];
    const b = poly.points[(i + 1) % poly.points.length];
    const bend = poly.edgeCurves[i] ?? 0;
    let distToEdge = Infinity;
    if (Math.abs(bend) > 0.5) {
      let prev = a;
      for (let s = 1; s <= 16; s++) {
        const next = getPointAlongRoomEdge(poly, i, s / 16);
        const res = pointToSegmentDistance(worldPt, prev, next);
        if (res.dist < distToEdge) distToEdge = res.dist;
        prev = next;
      }
    } else {
      distToEdge = pointToSegmentDistance(worldPt, a, b).dist;
    }
    if (distToEdge <= hitTol && (!best || distToEdge < best.dist)) {
      best = { edgeIndex: i, dist: distToEdge };
    }
  }
  return best;
}

export function pickNearestSecretPassage(
  passages: SecretPassage[],
  worldPt: Point,
  hitTol: number
): { passage: SecretPassage; dist: number } | null {
  let best: { passage: SecretPassage; dist: number } | null = null;
  for (const sp of passages) {
    for (let i = 0; i < sp.points.length - 1; i++) {
      const seg = pointToSegmentDistance(worldPt, sp.points[i], sp.points[i + 1]);
      if (seg.dist <= hitTol && (!best || seg.dist < best.dist)) {
        best = { passage: sp, dist: seg.dist };
      }
    }
  }
  return best;
}

export function getAdjacentFloorTowardGround(
  floors: MapFloor[],
  activeFloorId: string
): MapFloor | null {
  const activeFloor = floors.find((f) => f.id === activeFloorId);
  if (!activeFloor) return null;
  const activeElev = activeFloor.elevationOrder;
  if (activeElev === 0) return null;

  if (activeElev > 0) {
    let best: MapFloor | null = null;
    for (const fl of floors) {
      if (fl.id === activeFloorId) continue;
      if (fl.elevationOrder < activeElev && fl.elevationOrder >= 0) {
        if (!best || fl.elevationOrder > best.elevationOrder) {
          best = fl;
        }
      }
    }
    if (!best) {
      for (const fl of floors) {
        if (fl.id === activeFloorId) continue;
        if (fl.elevationOrder < activeElev) {
          if (!best || fl.elevationOrder > best.elevationOrder) {
            best = fl;
          }
        }
      }
    }
    return best;
  }

  let best: MapFloor | null = null;
  for (const fl of floors) {
    if (fl.id === activeFloorId) continue;
    if (fl.elevationOrder > activeElev && fl.elevationOrder <= 0) {
      if (!best || fl.elevationOrder < best.elevationOrder) {
        best = fl;
      }
    }
  }
  if (!best) {
    for (const fl of floors) {
      if (fl.id === activeFloorId) continue;
      if (fl.elevationOrder > activeElev) {
        if (!best || fl.elevationOrder < best.elevationOrder) {
          best = fl;
        }
      }
    }
  }
  return best;
}

export function findLinkedStairRoomOnFloor(
  floors: MapFloor[],
  stairLinks: StairLink[],
  targetFloorId: string,
  prevFloorId?: string | null
): Room | null {
  const targetFloor = floors.find((f) => f.id === targetFloorId);
  if (!targetFloor) return null;

  const findRoomForLink = (st: StairLink): Room | null => {
    let roomId: string | null = null;
    if (st.fromFloorId === targetFloorId) {
      roomId = st.fromRoomId;
    } else if (st.toFloorId === targetFloorId && st.bidirectional !== false) {
      roomId = st.toRoomId;
    }
    if (!roomId) return null;
    return targetFloor.rooms.find((r) => r.id === roomId) ?? null;
  };

  if (prevFloorId && prevFloorId !== targetFloorId) {
    for (const st of stairLinks) {
      const connectsBoth =
        (st.fromFloorId === prevFloorId &&
          st.toFloorId === targetFloorId &&
          st.bidirectional !== false) ||
        (st.fromFloorId === targetFloorId && st.toFloorId === prevFloorId);
      if (!connectsBoth) continue;
      const room = findRoomForLink(st);
      if (room) return room;
    }
  }

  for (const st of stairLinks) {
    if (!st.enabled) continue;
    const room = findRoomForLink(st);
    if (room) return room;
  }

  for (const st of stairLinks) {
    const room = findRoomForLink(st);
    if (room) return room;
  }

  return null;
}


