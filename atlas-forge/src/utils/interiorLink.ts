/**
 * Two-way link between an Atlas Forge building and its KeepCraft interior.
 *
 * Ownership:
 *   - The interior owns the building's outline, shape, size, floor count and
 *     room summary. `applyInteriorToBuilding` re-derives them after every edit.
 *   - Atlas owns position and rotation. The interior is drawn north-up in its
 *     own frame and is rotated/placed by the building's center + rotationDeg.
 *   - The name is a single field on the building (`assignedName`).
 */
import * as pcNs from 'polygon-clipping';
import type { Pair, Polygon, MultiPolygon } from 'polygon-clipping';
import { createEmptyMapPreset } from '../interior/data/presets';
import type {
  Doorway,
  LayoutArchetype,
  LayoutComplexity,
  MapDocument,
  MapFloor,
  ProceduralLayoutOptions,
  Room,
} from '../interior/types/map';
import { sampleRoomPolygon } from '../interior/utils/geometry';
import type {
  BuildingFootprint,
  BuildingPurpose,
  BuildingShape,
  InteriorEntry,
  Point,
  Region,
} from '../types/world';
import { buildFootprintGeometry } from './cityGenerator';
import {
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonsOverlap,
  rdpSimplify,
} from './polygonOps';

/** KeepCraft: 40 px = one 5 ft square */
export const KEEP_PX_PER_FT = 8;
/** Atlas Forge settlement map */
export const ATLAS_PX_PER_FT = 0.68;

const pc = ((pcNs as unknown as { default?: typeof pcNs }).default ?? pcNs) as Pick<
  typeof pcNs,
  'union'
>;

// ---------------------------------------------------------------------------
// small geometry helpers
// ---------------------------------------------------------------------------

function rotate(p: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function boundsOf(pts: Point[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function signedArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function perimeter(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

// ---------------------------------------------------------------------------
// Interior summary (what the map shows without loading the interior)
// ---------------------------------------------------------------------------

export interface InteriorSummary {
  floors: number;
  cellars: number;
  roomCount: number;
  roomSummary: string;
}

export function summarizeInterior(doc: MapDocument): InteriorSummary {
  const withRooms = doc.floors.filter((f) => f.rooms.length > 0);
  const above = withRooms.filter((f) => f.elevationOrder >= 0);
  const below = withRooms.filter((f) => f.elevationOrder < 0);
  const roomCount = withRooms.reduce((sum, f) => sum + f.rooms.length, 0);

  const ground =
    above.find((f) => f.elevationOrder === 0) ?? above[0] ?? withRooms[0] ?? null;
  const named = (ground?.rooms ?? [])
    .filter((r) => r.type !== 'hallway' && r.name.trim().length > 0)
    .map((r) => ({ name: r.name.trim(), area: Math.abs(signedArea(sampleRoomPolygon(r, 4))) }))
    .sort((a, b) => b.area - a.area)
    .slice(0, 3)
    .map((r) => r.name);

  let roomSummary = named.join(', ');
  const rest = roomCount - named.length;
  if (named.length === 0) {
    roomSummary = roomCount === 0 ? 'Empty interior' : `${roomCount} rooms`;
  } else if (rest > 0) {
    roomSummary += ` and ${rest} more`;
  }

  return {
    floors: Math.max(1, above.length),
    cellars: below.length,
    roomCount,
    roomSummary,
  };
}

// ---------------------------------------------------------------------------
// Atlas -> interior: seed a blank interior that matches the building footprint
// ---------------------------------------------------------------------------

function makeRoom(id: string, name: string, points: Point[], type: Room['type'] = 'room'): Room {
  return {
    id,
    name,
    type,
    points,
    edgeCurves: points.map(() => 0),
    floorMaterial: 'stone',
    lighting: 'bright',
    elevationFt: 0,
    notes: '',
    showLabel: true,
  };
}

function rectPoints(minX: number, minY: number, maxX: number, maxY: number): Point[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

const FLOOR_NAMES = ['Ground Floor', 'Upper Floor', 'Third Floor', 'Fourth Floor'];

/** Exterior door centered on the lowest long edge among the given rooms (south-most on the map) */
function southFacingDoor(rooms: Room[], id: string): Doorway | null {
  let best: { room: Room; edge: number; midY: number; len: number } | null = null;
  for (const room of rooms) {
    if (room.type === 'courtyard') continue;
    const n = room.points.length;
    for (let i = 0; i < n; i++) {
      const a = room.points[i];
      const b = room.points[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 48) continue;
      const midY = (a.y + b.y) / 2;
      // Prefer edges that run mostly east-west and sit lowest on the map
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) * 0.7;
      if (!horizontal) continue;
      if (!best || midY > best.midY + 1 || (Math.abs(midY - best.midY) <= 1 && len > best.len)) {
        best = { room, edge: i, midY, len };
      }
    }
  }
  if (!best) return null;
  const a = best.room.points[best.edge];
  const b = best.room.points[(best.edge + 1) % best.room.points.length];
  return {
    id,
    roomAId: best.room.id,
    roomBId: null,
    edgeAIndex: best.edge,
    edgeBIndex: null,
    position: { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) },
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    width: 32,
    enabled: true,
    kind: 'normal',
    autoDetected: false,
    wallT: 0.5,
  };
}

export interface SeededInterior {
  doc: MapDocument;
  /** Interior-editor point that sits at the building's center */
  anchor: Point;
}

/**
 * Builds an interior whose rooms exactly cover the building's current footprint,
 * so linking it does not change the outline until the user edits the interior.
 * Courtyard keeps get a ring of wings around a courtyard room.
 */
export function seedInteriorFromBuilding(building: BuildingFootprint, title: string): SeededInterior {
  const toKeep = (p: Point): Point => {
    const local = rotate(
      { x: p.x - building.center.x, y: p.y - building.center.y },
      -building.rotationDeg
    );
    return {
      x: (local.x / ATLAS_PX_PER_FT) * KEEP_PX_PER_FT,
      y: (local.y / ATLAS_PX_PER_FT) * KEEP_PX_PER_FT,
    };
  };

  // Generated shapes are rebuilt un-rotated so their corners come out exact instead of
  // carrying float error from the rotated polygon. Hand-edited (custom) outlines are
  // un-rotated from the stored polygon.
  const outerRaw =
    building.shape === 'custom'
      ? building.polygon.map(toKeep)
      : buildFootprintGeometry(
          { x: 0, y: 0 },
          building.widthFt,
          building.depthFt,
          building.shape,
          0
        ).polygon.map((p) => ({
          x: (p.x / ATLAS_PX_PER_FT) * KEEP_PX_PER_FT,
          y: (p.y / ATLAS_PX_PER_FT) * KEEP_PX_PER_FT,
        }));
  const ob = boundsOf(outerRaw);
  const shift = { x: 240 - ob.minX, y: 200 - ob.minY };
  const place = (p: Point): Point => ({
    x: Math.round((p.x + shift.x) * 2) / 2,
    y: Math.round((p.y + shift.y) * 2) / 2,
  });
  const outer = outerRaw.map(place);

  const stamp = Date.now();
  const floorTotal = Math.max(1, Math.min(8, Math.round(building.floors) || 1));

  // Courtyard keeps: use the stored courtyard if there is one, otherwise an inset
  // rectangle, as long as the building is big enough to hold wings around it.
  let courtyardBox: ReturnType<typeof boundsOf> | null = null;
  if (building.shape === 'courtyard') {
    const o = boundsOf(outer);
    if (building.courtyard && building.courtyard.length >= 3) {
      courtyardBox = boundsOf(building.courtyard.map(toKeep).map(place));
    } else if (Math.min(o.width, o.height) >= 140) {
      const inset = Math.max(48, Math.round((Math.min(o.width, o.height) * 0.28) / 8) * 8);
      courtyardBox = boundsOf(rectPoints(o.minX + inset, o.minY + inset, o.maxX - inset, o.maxY - inset));
    }
  }

  const buildRooms = (floorIdx: number): Room[] => {
    const key = `room-${stamp}-${floorIdx}`;
    const suffix = floorIdx === 0 ? '' : ` ${floorIdx + 1}`;
    if (courtyardBox) {
      const o = boundsOf(outer);
      const i = courtyardBox;
      const rooms: Room[] = [];
      const add = (name: string, minX: number, minY: number, maxX: number, maxY: number, type: Room['type'] = 'room') => {
        if (maxX - minX < 8 || maxY - minY < 8) return;
        rooms.push(makeRoom(`${key}-${rooms.length}`, name, rectPoints(minX, minY, maxX, maxY), type));
      };
      add(`North Wing${suffix}`, o.minX, o.minY, o.maxX, i.minY);
      add(`South Wing${suffix}`, o.minX, i.maxY, o.maxX, o.maxY);
      add(`West Wing${suffix}`, o.minX, i.minY, i.minX, i.maxY);
      add(`East Wing${suffix}`, i.maxX, i.minY, o.maxX, i.maxY);
      if (floorIdx === 0) add('Courtyard', i.minX, i.minY, i.maxX, i.maxY, 'courtyard');
      return rooms;
    }
    return [makeRoom(`${key}-0`, floorIdx === 0 ? 'Main Hall' : `Hall${suffix}`, outer.map((p) => ({ ...p })))];
  };

  const floors: MapFloor[] = Array.from({ length: floorTotal }, (_, idx) => ({
    id: `floor-${stamp}-${idx}`,
    name: FLOOR_NAMES[idx] ?? `Floor ${idx + 1}`,
    elevationOrder: idx,
    rooms: buildRooms(idx),
    doorways: [],
    suppressedAutoDoorKeys: [],
    secretPassages: [],
    slices: [],
  }));

  // A front door on the south side, so the ground floor starts out with an entrance
  const ground = floors[0];
  const door = southFacingDoor(ground.rooms, `door-${stamp}-front`);
  if (door) ground.doorways = [door];

  const active = floors[0];
  const doc: MapDocument = {
    ...createEmptyMapPreset(),
    id: `interior-${stamp}`,
    title,
    floorLabel: active.name,
    activeFloorId: active.id,
    floors,
    stairLinks: [],
    rooms: active.rooms,
    doorways: ground.doorways,
    suppressedAutoDoorKeys: [],
    secretPassages: [],
    slices: [],
  };
  return { doc, anchor: shift };
}

// ---------------------------------------------------------------------------
// Interior -> Atlas: derive the building outline from the interior
// ---------------------------------------------------------------------------

export interface FootprintDerivation {
  /** Interior-editor point pinned to the building center (the given anchor, or the outline centroid on a fresh link) */
  anchor: Point;
  polygon: Point[];
  courtyard?: Point[];
  shape: BuildingShape;
  widthFt: number;
  depthFt: number;
}

const GAP_CLOSE_PX = 10;
const SIMPLIFY_TOLERANCE_PX = 1.5;
const MIN_COURTYARD_AREA_RATIO = 0.03;

function toClosedRing(pts: Point[]): Pair[] {
  const ring: Pair[] = pts.map((p) => [p.x, p.y]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) ring.push([first[0], first[1]]);
  return ring;
}

function fromRing(ring: Pair[]): Point[] {
  const pts = ring.map(([x, y]) => ({ x, y }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first.x === last.x && first.y === last.y) pts.pop();
  return pts;
}

/** Grows a polygon slightly about its bbox center so near-touching walls fuse in the union */
function inflate(pts: Point[], amount: number): Point[] {
  const b = boundsOf(pts);
  if (b.width < 1 || b.height < 1) return pts;
  const cx = b.minX + b.width / 2;
  const cy = b.minY + b.height / 2;
  const sx = (b.width + amount * 2) / b.width;
  const sy = (b.height + amount * 2) / b.height;
  return pts.map((p) => ({ x: cx + (p.x - cx) * sx, y: cy + (p.y - cy) * sy }));
}

function unionRooms(polys: Point[][]): MultiPolygon {
  const [first, ...rest] = polys.map((p): Polygon => [toClosedRing(p)]);
  return pc.union(first, ...rest);
}

function reflexFlags(ring: Point[]): boolean[] {
  const orient = Math.sign(signedArea(ring)) || 1;
  return ring.map((b, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const c = ring[(i + 1) % ring.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    return cross * orient < -1e-6;
  });
}

function classifyShape(ring: Point[], hasCourtyard: boolean): BuildingShape {
  if (hasCourtyard) return 'courtyard';
  const n = ring.length;
  const area = Math.abs(signedArea(ring));
  const per = perimeter(ring);
  const circularity = per > 0 ? (4 * Math.PI * area) / (per * per) : 0;
  if (n >= 10 && circularity > 0.9) return 'round-tower';
  if (n === 4) return 'rectangle';
  const reflex = reflexFlags(ring);
  const idx = reflex.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  if (n === 6 && idx.length === 1) return 'l-shape';
  if (n === 8 && idx.length === 2) {
    const adjacent = idx[1] - idx[0] === 1 || (idx[0] === 0 && idx[1] === n - 1);
    if (adjacent) return 'u-shape';
  }
  return 'custom';
}

/**
 * Roof silhouette of the interior: every above-ground room (courtyard rooms
 * excluded, so they appear as holes or notches), unioned into one outline.
 * Returns null when the interior has no usable rooms.
 */
export function deriveFootprint(
  doc: MapDocument,
  center: Point,
  rotationDeg: number,
  anchor?: Point
): FootprintDerivation | null {
  const roomPolys: Point[][] = [];
  for (const floor of doc.floors) {
    if (floor.elevationOrder < 0) continue;
    for (const room of floor.rooms) {
      if (room.type === 'courtyard') continue;
      const poly = sampleRoomPolygon(room, 8);
      if (poly.length >= 3 && Math.abs(signedArea(poly)) > 1) roomPolys.push(poly);
    }
  }
  if (roomPolys.length === 0) return null;

  let union = unionRooms(roomPolys);
  if (union.length > 1) {
    // Rooms drawn with small gaps: fuse near-touching walls and try again
    union = unionRooms(roomPolys.map((p) => inflate(p, GAP_CLOSE_PX)));
  }
  if (union.length === 0) return null;

  let outer: Point[];
  let holes: Point[][] = [];
  if (union.length === 1) {
    outer = fromRing(union[0][0]);
    holes = union[0].slice(1).map(fromRing);
  } else {
    // Genuinely detached parts: one building outline has to cover them all
    outer = convexHull(union.flatMap((poly) => fromRing(poly[0])));
  }
  if (outer.length < 3) return null;

  outer = rdpSimplify(outer, SIMPLIFY_TOLERANCE_PX);
  if (outer.length < 3) return null;

  const outerArea = Math.abs(signedArea(outer));
  let courtyardRing: Point[] | undefined;
  const bigHoles = holes
    .map((h) => ({ ring: rdpSimplify(h, SIMPLIFY_TOLERANCE_PX), area: Math.abs(signedArea(h)) }))
    .filter((h) => h.ring.length >= 3 && h.area >= outerArea * MIN_COURTYARD_AREA_RATIO)
    .sort((a, b) => b.area - a.area);
  if (bigHoles.length > 0) courtyardRing = bigHoles[0].ring;

  const shape = classifyShape(outer, Boolean(courtyardRing));
  const ob = boundsOf(outer);
  const c0 = anchor ?? polygonCentroid(outer);

  const toAtlas = (p: Point): Point => {
    const local = {
      x: ((p.x - c0.x) / KEEP_PX_PER_FT) * ATLAS_PX_PER_FT,
      y: ((p.y - c0.y) / KEEP_PX_PER_FT) * ATLAS_PX_PER_FT,
    };
    const world = rotate(local, rotationDeg);
    return { x: round1(center.x + world.x), y: round1(center.y + world.y) };
  };

  return {
    anchor: c0,
    polygon: outer.map(toAtlas),
    courtyard: courtyardRing ? courtyardRing.map(toAtlas) : undefined,
    shape,
    widthFt: Math.max(12, Math.round(ob.width / KEEP_PX_PER_FT)),
    depthFt: Math.max(12, Math.round(ob.height / KEEP_PX_PER_FT)),
  };
}

/**
 * Writes the interior's footprint and summary onto the building. Position and
 * rotation stay; the interior's anchor keeps the editor pinned to the map. If an
 * edit leaves the building's center outside its own outline (for example the
 * anchored wing was deleted), the center is re-pivoted to a point inside the
 * outline without moving the outline itself.
 */
export function applyInteriorToBuilding(
  building: BuildingFootprint,
  doc: MapDocument,
  interiorId: string,
  options?: { anchor?: Point }
): BuildingFootprint {
  const summary = summarizeInterior(doc);
  const sameLink = building.interiorLink?.linkedInteriorId === interiorId;
  const knownAnchor = options?.anchor ?? (sameLink ? building.interiorLink?.anchor : undefined);
  const derived = deriveFootprint(doc, building.center, building.rotationDeg, knownAnchor);

  let center = building.center;
  let anchor = derived?.anchor ?? knownAnchor;
  if (derived && anchor && !pointInPolygon(center, derived.polygon)) {
    const centroid = polygonCentroid(derived.polygon);
    const mean = {
      x: derived.polygon.reduce((s, p) => s + p.x, 0) / derived.polygon.length,
      y: derived.polygon.reduce((s, p) => s + p.y, 0) / derived.polygon.length,
    };
    const next = pointInPolygon(centroid, derived.polygon)
      ? centroid
      : pointInPolygon(mean, derived.polygon)
        ? mean
        : null;
    if (next) {
      const local = rotate({ x: next.x - center.x, y: next.y - center.y }, -building.rotationDeg);
      anchor = {
        x: anchor.x + (local.x / ATLAS_PX_PER_FT) * KEEP_PX_PER_FT,
        y: anchor.y + (local.y / ATLAS_PX_PER_FT) * KEEP_PX_PER_FT,
      };
      center = { x: round1(next.x), y: round1(next.y) };
    }
  }

  return {
    ...building,
    center,
    ...(derived
      ? {
          polygon: derived.polygon,
          courtyard: derived.courtyard,
          shape: derived.shape,
          widthFt: derived.widthFt,
          depthFt: derived.depthFt,
        }
      : {}),
    floors: summary.floors,
    interiorLink: {
      linkedInteriorId: interiorId,
      floors: summary.floors,
      cellars: summary.cellars,
      roomCount: summary.roomCount,
      roomSummary: summary.roomSummary,
      linkedAt: building.interiorLink?.linkedAt ?? new Date().toISOString(),
      anchor,
    },
  };
}

// ---------------------------------------------------------------------------
// Overlap warnings and nudging
// ---------------------------------------------------------------------------

/** Ids of buildings that overlap a neighbour where at least one side is interior-driven */
export function findOverlappingBuildingIds(buildings: BuildingFootprint[]): Set<string> {
  const flagged = new Set<string>();
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const a = buildings[i];
      const b = buildings[j];
      if (!a.interiorLink && !b.interiorLink) continue;
      if (polygonsOverlap(a.polygon, b.polygon)) {
        flagged.add(a.id);
        flagged.add(b.id);
      }
    }
  }
  return flagged;
}

function translateBuilding(b: BuildingFootprint, dx: number, dy: number): BuildingFootprint {
  const move = (p: Point): Point => ({ x: round1(p.x + dx), y: round1(p.y + dy) });
  return {
    ...b,
    center: move(b.center),
    polygon: b.polygon.map(move),
    courtyard: b.courtyard ? b.courtyard.map(move) : undefined,
  };
}

/**
 * Slides a building away from whatever it overlaps until it is clear.
 * Returns null if it cannot get clear within a reasonable distance.
 */
export function nudgeBuildingClear(
  building: BuildingFootprint,
  others: BuildingFootprint[]
): BuildingFootprint | null {
  const STEP = 3;
  const MAX_STEPS = 80;
  let current = building;
  for (let step = 0; step < MAX_STEPS; step++) {
    const hits = others.filter((o) => o.id !== current.id && polygonsOverlap(current.polygon, o.polygon));
    if (hits.length === 0) return step === 0 ? building : current;
    let vx = 0;
    let vy = 0;
    for (const h of hits) {
      const hc = polygonCentroid(h.polygon);
      const cc = polygonCentroid(current.polygon);
      const dx = cc.x - hc.x;
      const dy = cc.y - hc.y;
      const len = Math.hypot(dx, dy) || 1;
      vx += dx / len;
      vy += dy / len;
    }
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) {
      vx = 1;
      vy = 0;
    } else {
      vx /= len;
      vy /= len;
    }
    current = translateBuilding(current, vx * STEP, vy * STEP);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generator hookup (uses KeepCraft's generator as-is)
// ---------------------------------------------------------------------------

/**
 * Nearest existing archetype for each purpose. KeepCraft has 8 archetypes and
 * Atlas has 12 purposes, so some are approximations until the missing
 * archetypes get their own room sets.
 */
export const PURPOSE_ARCHETYPE: Record<BuildingPurpose, LayoutArchetype> = {
  tavern: 'tavern',
  smith: 'blacksmith',
  alchemist: 'blacksmith',
  guildhall: 'guildhall',
  temple: 'temple',
  manor: 'manor',
  barracks: 'fortress',
  tower: 'fortress',
  market: 'guildhall',
  archive: 'temple',
  residence: 'manor',
  custom: 'manor',
};

export function generatorOptionsForBuilding(building: BuildingFootprint): ProceduralLayoutOptions {
  const purpose = building.purpose ?? 'custom';
  const area = Math.round(polygonArea(building.polygon) / (ATLAS_PX_PER_FT * ATLAS_PX_PER_FT));
  const complexity: LayoutComplexity =
    area < 1400 || purpose === 'residence' || purpose === 'tower' ? 'simple' : 'standard';
  const floors = Math.round(building.floors) || 1;
  const floorCount: 1 | 2 | 3 = floors >= 3 ? 3 : floors === 2 ? 2 : 1;
  return {
    roomCount: Math.max(4, Math.min(16, Math.round(area / 200))),
    complexity,
    archetype: PURPOSE_ARCHETYPE[purpose],
    floorCount,
    includeCurves: purpose === 'temple' || purpose === 'tower' || purpose === 'manor',
    includeDiagonals: false,
    includeSecretPassages:
      purpose === 'manor' || purpose === 'guildhall' || purpose === 'archive' || purpose === 'temple',
  };
}

// ---------------------------------------------------------------------------
// World-level helpers
// ---------------------------------------------------------------------------

export function findLinkedBuilding(
  regions: Region[],
  interiorId: string
): { region: Region; building: BuildingFootprint } | null {
  for (const region of regions) {
    for (const building of region.settlement.buildings) {
      if (building.interiorLink?.linkedInteriorId === interiorId) return { region, building };
    }
  }
  return null;
}

export function countLinkedBuildings(regions: Region[]): number {
  let n = 0;
  for (const r of regions) for (const b of r.settlement.buildings) if (b.interiorLink) n++;
  return n;
}

export type MissingLinkPolicy =
  /** Leave links whose interior is not in the library */
  | 'keep'
  /** Clear only links made by the old Tool Bridge (they have no anchor) */
  | 'legacy'
  /** Clear every link whose interior is not in the library */
  | 'all';

function withoutLink(b: BuildingFootprint): BuildingFootprint {
  const { interiorLink: _link, ...rest } = b;
  return rest as BuildingFootprint;
}

/**
 * Makes every linked building agree with its interior: the outline is re-derived
 * from the stored document, and links to interiors that no longer exist are
 * handled according to `policy`.
 */
export function reconcileLinkedBuildings(
  regions: Region[],
  interiorsById: Map<string, InteriorEntry>,
  policy: MissingLinkPolicy
): Region[] {
  return regions.map((region) => {
    if (!region.settlement.buildings.some((b) => b.interiorLink)) return region;
    return {
      ...region,
      settlement: {
        ...region.settlement,
        buildings: region.settlement.buildings.map((b) => {
          const link = b.interiorLink;
          if (!link) return b;
          const entry = interiorsById.get(link.linkedInteriorId);
          if (entry) return applyInteriorToBuilding(b, entry.doc, entry.id);
          if (policy === 'all' || (policy === 'legacy' && !link.anchor)) return withoutLink(b);
          return b;
        }),
      },
    };
  });
}
