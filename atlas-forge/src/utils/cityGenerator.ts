import {
  BUILDING_PURPOSES,
  SETTLEMENT_TIER_META,
} from '../data/presets';
import {
  BiomeType,
  BuildingFootprint,
  BuildingPurpose,
  BuildingShape,
  InteriorLink,
  Point,
  Region,
  RoadSegment,
  Settlement,
  SettlementFeature,
  SettlementTier,
} from '../types/world';
import {
  distance,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
} from './polygonOps';
import { createRng } from './prng';

export const CITY_WIDTH = 1000;
export const CITY_HEIGHT = 760;

const DISTRICTS_BY_TIER: Record<SettlementTier, string[]> = {
  hamlet: ['Crossroads', 'Millbrook'],
  town: ['Market Square', 'Artisan Row', 'Riverward', 'Old Quarter'],
  city: ['High Ward', 'Guild Quarter', 'Harbor Ward', 'Merchants Walk', 'Temple Precinct'],
  capital: [
    'Citadel Crown',
    'Grand Exchange',
    'Arcanum Ward',
    'Silver Docks',
    'Sovereign Row',
    'Artisan Commons',
  ],
};

export function rotatePoint(pt: Point, origin: Point, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pt.x - origin.x;
  const dy = pt.y - origin.y;
  return {
    x: Number((origin.x + dx * cos - dy * sin).toFixed(1)),
    y: Number((origin.y + dx * sin + dy * cos).toFixed(1)),
  };
}

/**
 * Snaps a point to an architectural drafting grid that rotates with the building.
 */
export function snapToRotatedGrid(
  pt: Point,
  _origin: Point,
  rotationDeg: number,
  gridStepFt = 5
): Point {
  const scale = 0.68; // px per ft
  const stepPx = Math.max(1, gridStepFt * scale);
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = pt.x * cos - pt.y * sin;
  const ly = pt.x * sin + pt.y * cos;

  const snappedLx = Math.round(lx / stepPx) * stepPx;
  const snappedLy = Math.round(ly / stepPx) * stepPx;

  const wRad = (rotationDeg * Math.PI) / 180;
  const wCos = Math.cos(wRad);
  const wSin = Math.sin(wRad);
  return {
    x: Number((snappedLx * wCos - snappedLy * wSin).toFixed(1)),
    y: Number((snappedLx * wSin + snappedLy * wCos).toFixed(1)),
  };
}

/**
 * Updates a building's polygon vertices and automatically recalculates its centroid
 * and oriented local width/depth in feet.
 */
export function updateBuildingPolygon(
  building: BuildingFootprint,
  newPolygon: Point[]
): BuildingFootprint {
  if (newPolygon.length < 3) return building;
  const newCenter = polygonCentroid(newPolygon);
  const rad = (-building.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const localPts = newPolygon.map((p) => {
    const dx = p.x - newCenter.x;
    const dy = p.y - newCenter.y;
    return {
      x: dx * cos - dy * sin,
      y: dx * sin + dy * cos,
    };
  });

  const minX = Math.min(...localPts.map((p) => p.x));
  const maxX = Math.max(...localPts.map((p) => p.x));
  const minY = Math.min(...localPts.map((p) => p.y));
  const maxY = Math.max(...localPts.map((p) => p.y));

  const scale = 0.68;
  const widthFt = Math.max(12, Math.round((maxX - minX) / scale));
  const depthFt = Math.max(12, Math.round((maxY - minY) / scale));

  return {
    ...building,
    center: {
      x: Number(newCenter.x.toFixed(1)),
      y: Number(newCenter.y.toFixed(1)),
    },
    polygon: newPolygon,
    widthFt,
    depthFt,
  };
}

/**
 * Inserts a new vertex at the midpoint of edge [edgeIndex -> edgeIndex + 1].
 */
export function insertBuildingVertex(polygon: Point[], edgeIndex: number): Point[] {
  if (polygon.length < 3) return polygon;
  const n = polygon.length;
  const idx = ((edgeIndex % n) + n) % n;
  const a = polygon[idx];
  const b = polygon[(idx + 1) % n];
  const mid: Point = {
    x: Number(((a.x + b.x) / 2).toFixed(1)),
    y: Number(((a.y + b.y) / 2).toFixed(1)),
  };
  const next = [...polygon];
  next.splice(idx + 1, 0, mid);
  return next;
}

/**
 * Removes a vertex from a building footprint polygon if at least 3 vertices remain.
 */
export function removeBuildingVertex(polygon: Point[], vertexIndex: number): Point[] {
  if (polygon.length <= 3) return polygon;
  if (vertexIndex < 0 || vertexIndex >= polygon.length) return polygon;
  return polygon.filter((_, idx) => idx !== vertexIndex);
}

/**
 * Generates top-down 2D architectural polygon + optional courtyard cutout
 * scaled to map pixels (1 ft ~= 0.65 px).
 */
export function buildFootprintGeometry(
  center: Point,
  widthFt: number,
  depthFt: number,
  shape: BuildingShape,
  rotationDeg: number
): { polygon: Point[]; courtyard?: Point[] } {
  const scale = 0.68;
  const w = Math.max(16, widthFt * scale);
  const d = Math.max(14, depthFt * scale);
  const hw = w / 2;
  const hd = d / 2;
  const cx = center.x;
  const cy = center.y;

  let localPoly: Point[] = [];

  if (shape === 'rectangle' || shape === 'courtyard') {
    localPoly = [
      { x: cx - hw, y: cy - hd },
      { x: cx + hw, y: cy - hd },
      { x: cx + hw, y: cy + hd },
      { x: cx - hw, y: cy + hd },
    ];
  } else if (shape === 'l-shape') {
    const wingW = w * 0.44;
    const wingD = d * 0.46;
    localPoly = [
      { x: cx - hw, y: cy - hd },
      { x: cx + hw, y: cy - hd },
      { x: cx + hw, y: cy - hd + wingD },
      { x: cx - hw + wingW, y: cy - hd + wingD },
      { x: cx - hw + wingW, y: cy + hd },
      { x: cx - hw, y: cy + hd },
    ];
  } else if (shape === 'u-shape') {
    const armW = w * 0.3;
    const baseD = d * 0.36;
    localPoly = [
      { x: cx - hw, y: cy - hd },
      { x: cx - hw + armW, y: cy - hd },
      { x: cx - hw + armW, y: cy + hd - baseD },
      { x: cx + hw - armW, y: cy + hd - baseD },
      { x: cx + hw - armW, y: cy - hd },
      { x: cx + hw, y: cy - hd },
      { x: cx + hw, y: cy + hd },
      { x: cx - hw, y: cy + hd },
    ];
  } else {
    // round-tower (12-gon silhouette)
    const r = Math.min(hw, hd);
    const sides = 12;
    for (let i = 0; i < sides; i++) {
      const ang = (i / sides) * Math.PI * 2;
      localPoly.push({
        x: cx + Math.cos(ang) * r,
        y: cy + Math.sin(ang) * r,
      });
    }
  }

  return {
    polygon: localPoly.map((p) => rotatePoint(p, center, rotationDeg)),
    courtyard: undefined,
  };
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return distance(p, proj);
}

function pointNearPolyline(p: Point, pts: Point[], threshold: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (distToSegment(p, pts[i], pts[i + 1]) < threshold) return true;
  }
  return false;
}

function boundsOverlap(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
  pad: number
): boolean {
  return !(
    a.maxX + pad < b.minX ||
    a.minX - pad > b.maxX ||
    a.maxY + pad < b.minY ||
    a.minY - pad > b.maxY
  );
}

export interface GenerateSettlementInput {
  id: string;
  name: string;
  tier: SettlementTier;
  seed: number;
  biome: BiomeType;
  isCoastal: boolean;
  mapAnchor: Point;
}

/**
 * Generates a deterministic top-down 2D city silhouette layout.
 * All buildings start strictly 'unclaimed' with no assigned purpose yet.
 */
export function generateSettlementLayout(input: GenerateSettlementInput): Settlement {
  const rng = createRng(input.seed);
  const tierMeta = SETTLEMENT_TIER_META[input.tier];
  const center: Point = {
    x: CITY_WIDTH * (input.isCoastal ? 0.44 : 0.5),
    y: CITY_HEIGHT * 0.5,
  };

  const features: SettlementFeature[] = [];
  const roads: RoadSegment[] = [];
  const wallGatePositions: Point[] = [];

  // 1. Coastal harbor or winding river depending on region biome / coastality
  let riverPoints: Point[] = [];
  let coastPolygon: Point[] = [];

  if (input.isCoastal || input.biome === 'coastline') {
    const baseEdge = CITY_WIDTH * 0.78;
    const pts: Point[] = [{ x: CITY_WIDTH + 40, y: -20 }];
    for (let y = -20; y <= CITY_HEIGHT + 20; y += 55) {
      const wave = Math.sin(y * 0.012 + rng() * 2) * 36 + (rng() - 0.5) * 22;
      pts.push({ x: Number((baseEdge + wave).toFixed(1)), y });
    }
    pts.push({ x: CITY_WIDTH + 40, y: CITY_HEIGHT + 20 });
    coastPolygon = pts;
    features.push({
      id: `${input.id}-coast`,
      kind: 'coast',
      points: coastPolygon,
      closed: true,
    });
  } else if (rng() > 0.25 || input.biome === 'fenland' || input.biome === 'heartland') {
    const startY = input.biome === 'fenland' ? 280 : 120 + rng() * 140;
    const pts: Point[] = [];
    for (let x = -20; x <= CITY_WIDTH + 20; x += 65) {
      const y =
        startY +
        Math.sin(x * 0.008 + rng() * 0.4) * 75 +
        Math.cos(x * 0.014) * 25 +
        (rng() - 0.5) * 14;
      pts.push({ x, y: Number(y.toFixed(1)) });
    }
    riverPoints = pts;
    features.push({
      id: `${input.id}-river`,
      kind: 'river',
      points: riverPoints,
      width: input.tier === 'capital' ? 42 : 30,
      closed: false,
    });
  }

  // 2. Central Civic Plaza
  const plazaSize = input.tier === 'hamlet' ? 30 : input.tier === 'town' ? 42 : 52;
  const plazaPts: Point[] = [];
  const plazaSides = input.tier === 'capital' ? 8 : 6;
  for (let i = 0; i < plazaSides; i++) {
    const a = (i / plazaSides) * Math.PI * 2 + 0.2;
    plazaPts.push({
      x: Number((center.x + Math.cos(a) * plazaSize).toFixed(1)),
      y: Number((center.y + Math.sin(a) * plazaSize * 0.85).toFixed(1)),
    });
  }
  features.push({
    id: `${input.id}-plaza`,
    kind: 'plaza',
    points: plazaPts,
    closed: true,
  });

  // 3. Optional City Wall Ring for City & Capital tiers
  let wallRing: Point[] = [];
  if (tierMeta.hasWall) {
    const rx = input.tier === 'capital' ? 355 : 285;
    const ry = input.tier === 'capital' ? 275 : 225;
    const wallVerts = input.tier === 'capital' ? 10 : 8;
    for (let i = 0; i < wallVerts; i++) {
      const ang = (i / wallVerts) * Math.PI * 2;
      const jitter = 0.92 + rng() * 0.14;
      const wx = center.x + Math.cos(ang) * rx * jitter;
      const wy = center.y + Math.sin(ang) * ry * jitter;
      wallRing.push({
        x: Number(Math.max(40, Math.min(CITY_WIDTH - 60, wx)).toFixed(1)),
        y: Number(Math.max(40, Math.min(CITY_HEIGHT - 40, wy)).toFixed(1)),
      });
    }
    features.push({
      id: `${input.id}-wall`,
      kind: 'wall',
      points: wallRing,
      width: 6,
      closed: true,
    });
  }

  // 4. Arterial Avenues & Cross Streets
  const spokeCount = input.tier === 'hamlet' ? 3 : input.tier === 'town' ? 5 : 6;
  for (let i = 0; i < spokeCount; i++) {
    const angle = (i / spokeCount) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const pts: Point[] = [{ ...center }];
    const steps = 4;
    const maxLen = 460;
    let curAng = angle;
    for (let s = 1; s <= steps; s++) {
      curAng += (rng() - 0.5) * 0.28;
      const dist = (s / steps) * maxLen;
      const nextPt = {
        x: Number((center.x + Math.cos(curAng) * dist).toFixed(1)),
        y: Number((center.y + Math.sin(curAng) * dist).toFixed(1)),
      };
      if (coastPolygon.length > 0 && pointInPolygon(nextPt, coastPolygon)) {
        break;
      }
      pts.push(nextPt);
    }
    if (pts.length >= 2) {
      roads.push({
        id: `${input.id}-avenue-${i}`,
        points: pts,
        width: 14,
        kind: 'avenue',
      });
    }

    if (wallRing.length > 0) {
      const gateDist = input.tier === 'capital' ? 320 : 255;
      wallGatePositions.push({
        x: Number((center.x + Math.cos(angle) * gateDist).toFixed(1)),
        y: Number((center.y + Math.sin(angle) * gateDist).toFixed(1)),
      });
    }
  }

  // Ring/cross streets around the plaza
  const ringRadii =
    input.tier === 'hamlet'
      ? [110]
      : input.tier === 'town'
        ? [115, 205]
        : [115, 200, 290];

  ringRadii.forEach((radius, rIdx) => {
    const segs = 12;
    const pts: Point[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const rad = radius * (0.93 + rng() * 0.14);
      const px = center.x + Math.cos(a) * rad * 1.15;
      const py = center.y + Math.sin(a) * rad * 0.9;
      if (coastPolygon.length > 0 && px > CITY_WIDTH * 0.74) continue;
      pts.push({ x: Number(px.toFixed(1)), y: Number(py.toFixed(1)) });
    }
    if (pts.length >= 3) {
      roads.push({
        id: `${input.id}-ring-${rIdx}`,
        points: pts,
        width: 9,
        kind: 'street',
      });
    }
  });

  // 5. Place Top-Down 2D Building Silhouettes (ALL initially UNCLAIMED)
  const buildings: BuildingFootprint[] = [];
  const placedBounds: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  const districts = DISTRICTS_BY_TIER[input.tier];

  const target = tierMeta.targetBuildings;
  const maxAttempts = target * 28;
  let attempts = 0;

  const shapes: BuildingShape[] = ['rectangle', 'rectangle', 'l-shape', 'u-shape', 'courtyard', 'round-tower'];

  while (buildings.length < target && attempts < maxAttempts) {
    attempts++;

    // Bias placement near roads and within city bounds
    const anchorRoad = roads[Math.floor(rng() * roads.length)];
    const segIdx = Math.floor(rng() * Math.max(1, anchorRoad.points.length - 1));
    const pA = anchorRoad.points[segIdx];
    const pB = anchorRoad.points[Math.min(anchorRoad.points.length - 1, segIdx + 1)];
    const t = rng();
    const baseX = pA.x + (pB.x - pA.x) * t;
    const baseY = pA.y + (pB.y - pA.y) * t;

    const roadAngle = Math.atan2(pB.y - pA.y, pB.x - pA.x);
    const side = rng() > 0.5 ? 1 : -1;
    const perpOffset = 24 + rng() * 34;

    const cx = baseX + Math.cos(roadAngle + (side * Math.PI) / 2) * perpOffset;
    const cy = baseY + Math.sin(roadAngle + (side * Math.PI) / 2) * perpOffset;

    if (cx < 55 || cx > CITY_WIDTH - 55 || cy < 50 || cy > CITY_HEIGHT - 50) continue;

    const pt = { x: Number(cx.toFixed(1)), y: Number(cy.toFixed(1)) };

    // Keep out of plaza
    if (distance(pt, center) < plazaSize + 24) continue;
    // Keep out of water
    if (coastPolygon.length > 0 && pointInPolygon(pt, coastPolygon)) continue;
    if (riverPoints.length > 0 && pointNearPolyline(pt, riverPoints, 34)) continue;
    // Keep off roads
    const onRoad = roads.some((r) => pointNearPolyline(pt, r.points, r.width + 11));
    if (onRoad) continue;
    // If walled city, prefer mostly inside wall (allow 15% outside as extramural suburbs)
    if (wallRing.length > 0 && !pointInPolygon(pt, wallRing) && rng() > 0.14) continue;

    // Determine shape and dimensions in feet
    const distNorm = Math.min(1, distance(pt, center) / 340);
    const shapeRoll = rng();
    let shape: BuildingShape = shapes[Math.floor(rng() * shapes.length)];
    if (distNorm > 0.65 && shapeRoll > 0.25) {
      shape = rng() > 0.35 ? 'rectangle' : 'l-shape';
    } else if (distNorm < 0.35 && shapeRoll > 0.72) {
      shape = rng() > 0.45 ? 'courtyard' : 'u-shape';
    }

    const widthFt =
      shape === 'courtyard'
        ? Math.round(54 + rng() * 26)
        : shape === 'round-tower'
          ? Math.round(30 + rng() * 14)
          : Math.round(28 + rng() * 34);
    const depthFt =
      shape === 'courtyard'
        ? Math.round(48 + rng() * 24)
        : shape === 'round-tower'
          ? widthFt
          : Math.round(22 + rng() * 24);

    const rotationDeg = Math.round((roadAngle * 180) / Math.PI + (rng() > 0.8 ? 90 : 0));
    const geom = buildFootprintGeometry(pt, widthFt, depthFt, shape, rotationDeg);
    const bBox = polygonBounds(geom.polygon);

    // Check overlap with water or roads for corners
    const cornerHitsWater = geom.polygon.some(
      (v) =>
        (coastPolygon.length > 0 && pointInPolygon(v, coastPolygon)) ||
        (riverPoints.length > 0 && pointNearPolyline(v, riverPoints, 20))
    );
    if (cornerHitsWater) continue;

    const overlapsExisting = placedBounds.some((other) => boundsOverlap(bBox, other, 8));
    if (overlapsExisting) continue;

    placedBounds.push(bBox);

    const districtIndex = Math.min(
      districts.length - 1,
      Math.floor(((Math.atan2(pt.y - center.y, pt.x - center.x) + Math.PI) / (Math.PI * 2)) * districts.length)
    );

    const idxNum = buildings.length + 1;
    const lotCode = `Lot ${String(idxNum).padStart(2, '0')}`;
    const floors = shape === 'round-tower' ? 3 : shape === 'courtyard' ? 2 : rng() > 0.55 ? 2 : 1;

    buildings.push({
      id: `${input.id}-b-${idxNum}`,
      label: lotCode,
      shape,
      center: pt,
      widthFt,
      depthFt,
      rotationDeg,
      polygon: geom.polygon,
      courtyard: geom.courtyard,
      district: districts[districtIndex],
      floors,
      claimStatus: 'unclaimed',
    });
  }

  return {
    id: input.id,
    name: input.name,
    tier: input.tier,
    seed: input.seed,
    mapAnchor: input.mapAnchor,
    districtCount: districts.length,
    roads,
    features,
    buildings,
    wallGatePositions,
  };
}

export function claimBuilding(
  building: BuildingFootprint,
  params: {
    purpose: BuildingPurpose;
    assignedName: string;
    customPurposeLabel?: string;
    mapLabel?: string;
    showMapLabel?: boolean;
    notes?: string;
    floors?: number;
  }
): BuildingFootprint {
  const nextMapLabel =
    params.mapLabel !== undefined ? params.mapLabel.trim() || undefined : building.mapLabel;
  return {
    ...building,
    claimStatus: 'claimed',
    purpose: params.purpose,
    assignedName: params.assignedName.trim() || building.label,
    customPurposeLabel: params.customPurposeLabel?.trim() || undefined,
    mapLabel: nextMapLabel,
    showMapLabel:
      params.showMapLabel !== undefined
        ? params.showMapLabel
        : building.showMapLabel ?? true,
    notes: params.notes?.trim() || undefined,
    floors: params.floors ?? building.floors,
  };
}

export function unclaimBuilding(building: BuildingFootprint): BuildingFootprint {
  const {
    purpose: _purpose,
    customPurposeLabel: _customPurposeLabel,
    assignedName: _assignedName,
    mapLabel: _mapLabel,
    showMapLabel: _showMapLabel,
    notes: _notes,
    interiorLink: _interiorLink,
    ...rest
  } = building;
  return {
    ...rest,
    claimStatus: 'unclaimed',
  };
}

export function createCustomBuilding(
  settlementId: string,
  indexNum: number,
  center: Point,
  shape: BuildingShape = 'rectangle'
): BuildingFootprint {
  const widthFt = shape === 'courtyard' ? 60 : shape === 'round-tower' ? 34 : 40;
  const depthFt = shape === 'round-tower' ? 34 : 30;
  const geom = buildFootprintGeometry(center, widthFt, depthFt, shape, 0);
  return {
    id: `${settlementId}-custom-${Date.now()}-${indexNum}`,
    label: `Lot ${String(indexNum).padStart(2, '0')}`,
    shape,
    center,
    widthFt,
    depthFt,
    rotationDeg: 0,
    polygon: geom.polygon,
    courtyard: geom.courtyard,
    district: 'Surveyed Plot',
    floors: 1,
    claimStatus: 'unclaimed',
  };
}

export function computeBuildingAreaSqFt(building: BuildingFootprint): number {
  const pixelArea = polygonArea(building.polygon);
  // scale is 0.68 px per ft -> 1 sq ft = 0.4624 sq px
  return Math.round(pixelArea / (0.68 * 0.68));
}

interface EssentialSpec {
  purpose: BuildingPurpose;
  name: string;
  mapLabel: string;
  shape: BuildingShape;
  widthFt: number;
  depthFt: number;
  floors: number;
  districtHint: string;
  notes: string;
  idealCenter: Point;
  rotationDeg: number;
  allowOutsideWall?: boolean;
}

/**
 * Populates a settlement with landmark essential buildings that look the part
 * (distinct architectural shapes, monumental sizing for palaces/keeps/temples,
 * and unique civic/strategic positions) while keeping all already-claimed
 * buildings intact and leaving non-overlapping unclaimed lots as NPC houses.
 */
export function populateEssentialBuildings(
  settlement: Settlement,
  isCoastal: boolean
): { buildings: BuildingFootprint[]; addedIds: string[] } {
  const rng = createRng(settlement.seed + 4099);
  const center: Point = { x: CITY_WIDTH / 2, y: CITY_HEIGHT / 2 };

  const plaza = settlement.features.find((f) => f.kind === 'plaza');
  const plazaRadius = plaza
    ? Math.max(...plaza.points.map((p) => distance(p, center)))
    : 45;
  const coastFeature = settlement.features.find((f) => f.kind === 'coast');
  const coastPolygon = coastFeature?.points ?? [];
  const riverFeature = settlement.features.find((f) => f.kind === 'river');
  const riverPoints = riverFeature?.points ?? [];
  const wallFeature = settlement.features.find((f) => f.kind === 'wall');
  const wallRing = wallFeature?.points ?? [];

  const existingClaimedPurposes = new Set(
    settlement.buildings
      .filter((b) => b.claimStatus === 'claimed' && b.purpose)
      .map((b) => b.purpose as BuildingPurpose)
  );

  // Pick a gate position pulled slightly inside the city walls for the guardhouse
  const firstGate = settlement.wallGatePositions[0];
  const gateAnchor: Point = firstGate
    ? {
        x: Number((firstGate.x + (center.x - firstGate.x) * 0.22).toFixed(1)),
        y: Number((firstGate.y + (center.y - firstGate.y) * 0.22).toFixed(1)),
      }
    : { x: center.x + 150, y: center.y - 40 };
  const gateAngleDeg = firstGate
    ? Math.round((Math.atan2(center.y - firstGate.y, center.x - firstGate.x) * 180) / Math.PI)
    : 0;

  const districts = DISTRICTS_BY_TIER[settlement.tier];
  const pickDistrict = (idx: number) => districts[idx % districts.length] ?? 'Central Ward';

  const specs: EssentialSpec[] = [];

  if (settlement.tier === 'capital') {
    specs.push(
      {
        purpose: 'manor',
        name: "The King's Palace",
        mapLabel: 'Royal Palace',
        shape: 'u-shape',
        widthFt: 142,
        depthFt: 98,
        floors: 3,
        districtHint: pickDistrict(0),
        notes: 'Grand throne hall, royal court, and sovereign chambers overlooking the civic plaza.',
        idealCenter: { x: center.x, y: center.y - 142 },
        rotationDeg: 0,
      },
      {
        purpose: 'temple',
        name: 'Sanctuary of the Dawn',
        mapLabel: 'High Temple',
        shape: 'u-shape',
        widthFt: 88,
        depthFt: 58,
        floors: 2,
        districtHint: pickDistrict(4),
        notes: 'Columned cathedral and sunlit cloister flanking the central square.',
        idealCenter: { x: center.x - 145, y: center.y - 10 },
        rotationDeg: 90,
      },
      {
        purpose: 'guildhall',
        name: isCoastal ? 'Harbor Exchange' : "Merchants' Guildhall",
        mapLabel: isCoastal ? 'Harbor Guilds' : 'Grand Exchange',
        shape: 'l-shape',
        widthFt: 86,
        depthFt: 56,
        floors: 2,
        districtHint: pickDistrict(isCoastal ? 3 : 1),
        notes: isCoastal
          ? 'Chartered maritime customs house and dockside trade floor.'
          : 'Chartered trade exchange and merchant council hall.',
        idealCenter: isCoastal
          ? { x: 675, y: center.y + 15 }
          : { x: center.x + 145, y: center.y + 15 },
        rotationDeg: isCoastal ? -80 : -90,
      },
      {
        purpose: 'barracks',
        name: 'Eastgate Bastion',
        mapLabel: 'City Watch',
        shape: 'courtyard',
        widthFt: 74,
        depthFt: 54,
        floors: 3,
        districtHint: pickDistrict(0),
        notes: 'Fortified garrison guarding the primary approach and city gate.',
        idealCenter: gateAnchor,
        rotationDeg: gateAngleDeg,
      },
      {
        purpose: 'tavern',
        name: 'The Copper Lantern',
        mapLabel: 'Wayfarer’s Inn',
        shape: 'l-shape',
        widthFt: 68,
        depthFt: 48,
        floors: 2,
        districtHint: pickDistrict(1),
        notes: 'Sprawling coaching inn with stables, taproom, and rumor board.',
        idealCenter: { x: center.x - 145, y: center.y + 125 },
        rotationDeg: 25,
      },
      {
        purpose: 'smith',
        name: 'Ironbark Forge',
        mapLabel: 'Smithy & Forge',
        shape: 'rectangle',
        widthFt: 58,
        depthFt: 42,
        floors: 1,
        districtHint: pickDistrict(5),
        notes: 'Double-hearth smithy supplying armor, horseshoes, and ironwork.',
        idealCenter: { x: center.x + 170, y: center.y + 130 },
        rotationDeg: -30,
      },
      {
        purpose: 'tower',
        name: 'Astral Spire',
        mapLabel: 'Arcane Spire',
        shape: 'round-tower',
        widthFt: 48,
        depthFt: 48,
        floors: 4,
        districtHint: pickDistrict(2),
        notes: 'Observatory tower and arcane archive overlooking the upper ward.',
        idealCenter: { x: center.x - 190, y: center.y - 135 },
        rotationDeg: 0,
      }
    );
  } else if (settlement.tier === 'city') {
    specs.push(
      {
        purpose: 'manor',
        name: "Lord's Citadel",
        mapLabel: 'Governor’s Keep',
        shape: 'courtyard',
        widthFt: 114,
        depthFt: 82,
        floors: 3,
        districtHint: pickDistrict(0),
        notes: 'Fortified keep and civic council hall commanding the city square.',
        idealCenter: { x: center.x, y: center.y - 138 },
        rotationDeg: 0,
      },
      {
        purpose: 'temple',
        name: 'High Vigil Shrine',
        mapLabel: 'City Temple',
        shape: 'u-shape',
        widthFt: 76,
        depthFt: 52,
        floors: 2,
        districtHint: pickDistrict(4),
        notes: 'Stone sanctuary and bell tower beside the central plaza.',
        idealCenter: { x: center.x - 140, y: center.y },
        rotationDeg: 90,
      },
      {
        purpose: 'guildhall',
        name: isCoastal ? 'Harbor Exchange' : "Merchants' Guildhall",
        mapLabel: isCoastal ? 'Harbor Guilds' : 'Guildhall',
        shape: 'l-shape',
        widthFt: 78,
        depthFt: 50,
        floors: 2,
        districtHint: pickDistrict(isCoastal ? 2 : 1),
        notes: 'Trade brokerage, assay office, and guild assembly hall.',
        idealCenter: isCoastal
          ? { x: 675, y: center.y + 10 }
          : { x: center.x + 140, y: center.y + 12 },
        rotationDeg: isCoastal ? -80 : -90,
      },
      {
        purpose: 'barracks',
        name: 'Gatehouse Barracks',
        mapLabel: 'City Watch',
        shape: 'rectangle',
        widthFt: 64,
        depthFt: 46,
        floors: 2,
        districtHint: pickDistrict(0),
        notes: 'Watch garrison, armory, and holding cells near the main gate.',
        idealCenter: gateAnchor,
        rotationDeg: gateAngleDeg,
      },
      {
        purpose: 'tavern',
        name: 'The Weary Stag',
        mapLabel: 'Main Inn',
        shape: 'l-shape',
        widthFt: 62,
        depthFt: 44,
        floors: 2,
        districtHint: pickDistrict(3),
        notes: 'Bustling two-story tavern along the southern trade avenue.',
        idealCenter: { x: center.x - 125, y: center.y + 115 },
        rotationDeg: 20,
      },
      {
        purpose: 'smith',
        name: 'Cinder & Hammer',
        mapLabel: 'Blacksmith',
        shape: 'rectangle',
        widthFt: 54,
        depthFt: 38,
        floors: 1,
        districtHint: pickDistrict(1),
        notes: 'Busy forge repairing wagons, tools, and bladework.',
        idealCenter: { x: center.x + 150, y: center.y + 115 },
        rotationDeg: -25,
      }
    );
  } else if (settlement.tier === 'town') {
    specs.push(
      {
        purpose: 'manor',
        name: "Magistrate's Hall",
        mapLabel: 'Town Hall',
        shape: 'l-shape',
        widthFt: 82,
        depthFt: 58,
        floors: 2,
        districtHint: pickDistrict(0),
        notes: 'Council chamber and manor overlooking the market square.',
        idealCenter: { x: center.x, y: center.y - 135 },
        rotationDeg: 0,
      },
      {
        purpose: 'temple',
        name: 'Chapel of Quiet Waters',
        mapLabel: 'Town Chapel',
        shape: 'rectangle',
        widthFt: 64,
        depthFt: 44,
        floors: 2,
        districtHint: pickDistrict(3),
        notes: 'Peaceful parish sanctuary and herbarium.',
        idealCenter: { x: center.x - 135, y: center.y - 10 },
        rotationDeg: 90,
      },
      {
        purpose: 'market',
        name: isCoastal ? 'Saltwater Wharfhouse' : 'Granary & Exchange',
        mapLabel: isCoastal ? 'Harbor Market' : 'Market Hall',
        shape: 'rectangle',
        widthFt: 68,
        depthFt: 44,
        floors: 1,
        districtHint: pickDistrict(0),
        notes: 'Covered trade hall, grain scales, and merchant stalls.',
        idealCenter: isCoastal
          ? { x: 675, y: center.y + 10 }
          : { x: center.x + 135, y: center.y + 10 },
        rotationDeg: isCoastal ? -80 : -90,
      },
      {
        purpose: 'tavern',
        name: "Wayfarer's Rest",
        mapLabel: 'Crossroads Inn',
        shape: 'l-shape',
        widthFt: 58,
        depthFt: 42,
        floors: 2,
        districtHint: pickDistrict(2),
        notes: 'Warm hearth, common room, and lodging for road travelers.',
        idealCenter: { x: center.x - 100, y: center.y + 105 },
        rotationDeg: 15,
      },
      {
        purpose: 'smith',
        name: 'Redhearth Smithy',
        mapLabel: 'Blacksmith',
        shape: 'rectangle',
        widthFt: 50,
        depthFt: 36,
        floors: 1,
        districtHint: pickDistrict(1),
        notes: 'Town forge, farrier yard, and ironmonger.',
        idealCenter: { x: center.x + 120, y: center.y + 105 },
        rotationDeg: -20,
      }
    );
  } else {
    // Hamlet
    specs.push(
      {
        purpose: 'tavern',
        name: 'The Salt & Anchor',
        mapLabel: 'Village Tavern',
        shape: 'l-shape',
        widthFt: 56,
        depthFt: 40,
        floors: 2,
        districtHint: pickDistrict(0),
        notes: 'The heart of village news, ale, and traveler beds.',
        idealCenter: { x: center.x - 85, y: center.y + 68 },
        rotationDeg: 15,
      },
      {
        purpose: 'temple',
        name: 'Elderwood Shrine',
        mapLabel: 'Shrine',
        shape: 'rectangle',
        widthFt: 52,
        depthFt: 36,
        floors: 1,
        districtHint: pickDistrict(1),
        notes: 'Moss-roofed shrine watching over the village green.',
        idealCenter: { x: center.x, y: center.y - 96 },
        rotationDeg: 0,
      },
      {
        purpose: 'market',
        name: 'Crossroads Trading Post',
        mapLabel: 'Trading Post',
        shape: 'rectangle',
        widthFt: 54,
        depthFt: 36,
        floors: 1,
        districtHint: pickDistrict(0),
        notes: 'Provisioner storehouse and weekly produce stall.',
        idealCenter: isCoastal
          ? { x: 670, y: center.y + 10 }
          : { x: center.x + 95, y: center.y + 10 },
        rotationDeg: isCoastal ? -80 : -90,
      },
      {
        purpose: 'smith',
        name: 'Brookside Smithy',
        mapLabel: 'Smithy',
        shape: 'rectangle',
        widthFt: 48,
        depthFt: 34,
        floors: 1,
        districtHint: pickDistrict(1),
        notes: 'Small forge for farm tools, nails, and shoeing horses.',
        idealCenter: { x: center.x + 90, y: center.y + 85 },
        rotationDeg: -20,
      }
    );
  }

  let currentBuildings = [...settlement.buildings];
  const addedIds: string[] = [];

  const isSpotValid = (
    candidate: Point,
    widthFt: number,
    depthFt: number,
    shape: BuildingShape,
    rotationDeg: number,
    requireRoadClearance: boolean,
    allowOutsideWall: boolean
  ): { ok: boolean; polygon: Point[]; bounds: ReturnType<typeof polygonBounds> } => {
    const geom = buildFootprintGeometry(candidate, widthFt, depthFt, shape, rotationDeg);
    const bBox = polygonBounds(geom.polygon);

    if (
      bBox.minX < 42 ||
      bBox.maxX > CITY_WIDTH - 42 ||
      bBox.minY < 42 ||
      bBox.maxY > CITY_HEIGHT - 42
    ) {
      return { ok: false, polygon: geom.polygon, bounds: bBox };
    }

    const samplePts: Point[] = [candidate, ...geom.polygon];
    for (let i = 0; i < geom.polygon.length; i++) {
      const a = geom.polygon[i];
      const b = geom.polygon[(i + 1) % geom.polygon.length];
      samplePts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }

    // Keep out of central civic plaza
    if (samplePts.some((p) => distance(p, center) < plazaRadius + 10)) {
      return { ok: false, polygon: geom.polygon, bounds: bBox };
    }

    // Keep out of water
    if (
      coastPolygon.length > 0 &&
      samplePts.some((p) => pointInPolygon(p, coastPolygon))
    ) {
      return { ok: false, polygon: geom.polygon, bounds: bBox };
    }
    if (
      riverPoints.length > 0 &&
      samplePts.some((p) => pointNearPolyline(p, riverPoints, 24))
    ) {
      return { ok: false, polygon: geom.polygon, bounds: bBox };
    }

    // Keep inside walls for fortified cities unless specified
    if (!allowOutsideWall && wallRing.length > 0 && !pointInPolygon(candidate, wallRing)) {
      return { ok: false, polygon: geom.polygon, bounds: bBox };
    }

    // Never overlap already-claimed buildings (including previously added essentials)
    const hitsClaimed = currentBuildings.some(
      (existing) =>
        existing.claimStatus === 'claimed' &&
        boundsOverlap(bBox, polygonBounds(existing.polygon), 10)
    );
    if (hitsClaimed) {
      return { ok: false, polygon: geom.polygon, bounds: bBox };
    }

    if (requireRoadClearance) {
      const hitsRoad = settlement.roads.some((r) =>
        samplePts.some((p) => pointNearPolyline(p, r.points, r.width * 0.5 + 3))
      );
      if (hitsRoad) {
        return { ok: false, polygon: geom.polygon, bounds: bBox };
      }
    }

    return { ok: true, polygon: geom.polygon, bounds: bBox };
  };

  for (let sIdx = 0; sIdx < specs.length; sIdx++) {
    const spec = specs[sIdx];
    if (existingClaimedPurposes.has(spec.purpose)) continue;

    let chosenCenter: Point | null = null;
    let chosenPoly: Point[] | null = null;
    let chosenBounds: ReturnType<typeof polygonBounds> | null = null;

    // Spiral search outward from the ideal civic location
    const radii = [0, 14, 28, 42, 58, 76, 96, 120];
    for (const strictRoads of [true, false]) {
      for (const r of radii) {
        const steps = r === 0 ? 1 : 12;
        for (let i = 0; i < steps; i++) {
          const ang = (i / steps) * Math.PI * 2 + (rng() - 0.5) * 0.1;
          const candidate: Point = {
            x: Number((spec.idealCenter.x + Math.cos(ang) * r).toFixed(1)),
            y: Number((spec.idealCenter.y + Math.sin(ang) * r).toFixed(1)),
          };
          const check = isSpotValid(
            candidate,
            spec.widthFt,
            spec.depthFt,
            spec.shape,
            spec.rotationDeg,
            strictRoads,
            Boolean(spec.allowOutsideWall)
          );
          if (check.ok) {
            chosenCenter = candidate;
            chosenPoly = check.polygon;
            chosenBounds = check.bounds;
            break;
          }
        }
        if (chosenCenter) break;
      }
      if (chosenCenter) break;
    }

    if (!chosenCenter || !chosenPoly || !chosenBounds) continue;

    // Clear any unclaimed NPC house silhouettes directly under the new landmark's footprint
    const landmarkBounds = chosenBounds;
    currentBuildings = currentBuildings.filter((b) => {
      if (b.claimStatus === 'claimed') return true;
      return !boundsOverlap(landmarkBounds, polygonBounds(b.polygon), 8);
    });

    const newId = `${settlement.id}-essential-${spec.purpose}-${Math.round(rng() * 1e6)}`;
    const landmark: BuildingFootprint = {
      id: newId,
      label: spec.name,
      shape: spec.shape,
      center: chosenCenter,
      widthFt: spec.widthFt,
      depthFt: spec.depthFt,
      rotationDeg: spec.rotationDeg,
      polygon: chosenPoly,
      courtyard: undefined,
      district: spec.districtHint,
      floors: spec.floors,
      claimStatus: 'claimed',
      purpose: spec.purpose,
      assignedName: spec.name,
      mapLabel: spec.mapLabel,
      showMapLabel: true,
      notes: spec.notes,
    };

    // Place essential landmarks first in the array so they appear at the top of lists
    currentBuildings = [landmark, ...currentBuildings];
    existingClaimedPurposes.add(spec.purpose);
    addedIds.push(newId);
  }

  return { buildings: currentBuildings, addedIds };
}
