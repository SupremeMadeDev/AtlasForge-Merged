import {
  BIOMES,
  CONTINENT_NAME_SUFFIXES,
  CONTINENT_NAME_SYLLABLES,
  FACTION_PRESETS,
  REGION_PREFIXES,
  REGION_ROOTS,
  SETTLEMENT_PREFIXES,
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
import { generateSettlementLayout } from './cityGenerator';
import {
  clipPolygonHalfPlaneMulti,
  distance,
  hasSelfIntersection,
  mergePolygonsAlongSharedEdge,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonsOverlap,
  rdpSimplify,
  signedPolygonArea,
} from './polygonOps';
import { createRng, fbm2D } from './prng';

export const MAP_WIDTH = 1200;
export const MAP_HEIGHT = 820;

function sdCapsule(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rA: number,
  rB: number
): number {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const lenSq = bax * bax + bay * bay || 1;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / lenSq));
  const dx = pax - bax * h;
  const dy = pay - bay * h;
  const r = rA + (rB - rA) * h;
  return Math.hypot(dx, dy) - r;
}

function sdRotatedEllipse(
  px: number,
  py: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  angle: number
): number {
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const k0 = Math.hypot(lx / rx, ly / ry);
  if (k0 < 1e-6) return -Math.min(rx, ry);
  const k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry));
  return (k0 * (k0 - 1)) / (k1 || 1e-6);
}

function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

interface CapsuleSpec {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  rA: number;
  rB: number;
}

interface EllipseSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
}

/**
 * Extracts closed boundary contours from a 2D scalar field using Marching Squares
 * and returns the largest-area simple closed loop.
 */
function extractLargestContour(
  cols: number,
  rows: number,
  field: Float32Array
): Point[] {
  const dx = MAP_WIDTH / cols;
  const dy = MAP_HEIGHT / rows;

  const val = (ix: number, iy: number) => field[iy * (cols + 1) + ix];

  const interp = (a: Point, b: Point, va: number, vb: number): Point => {
    const denom = va - vb;
    const t = Math.abs(denom) < 1e-6 ? 0.5 : Math.max(0.05, Math.min(0.95, va / denom));
    return {
      x: a.x + t * (b.x - a.x),
      y: a.y + t * (b.y - a.y),
    };
  };

  interface EdgeVertex {
    key: string;
    pt: Point;
  }

  const adj = new Map<string, string[]>();
  const ptsByKey = new Map<string, Point>();

  const linkEdges = (a: EdgeVertex, b: EdgeVertex) => {
    if (!ptsByKey.has(a.key)) ptsByKey.set(a.key, a.pt);
    if (!ptsByKey.has(b.key)) ptsByKey.set(b.key, b.pt);
    let listA = adj.get(a.key);
    if (!listA) {
      listA = [];
      adj.set(a.key, listA);
    }
    listA.push(b.key);
    let listB = adj.get(b.key);
    if (!listB) {
      listB = [];
      adj.set(b.key, listB);
    }
    listB.push(a.key);
  };

  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const v0 = val(ix, iy); // TL
      const v1 = val(ix + 1, iy); // TR
      const v2 = val(ix + 1, iy + 1); // BR
      const v3 = val(ix, iy + 1); // BL

      const mask =
        (v0 < 0 ? 8 : 0) |
        (v1 < 0 ? 4 : 0) |
        (v2 < 0 ? 2 : 0) |
        (v3 < 0 ? 1 : 0);

      if (mask === 0 || mask === 15) continue;

      const x0 = ix * dx;
      const x1 = (ix + 1) * dx;
      const y0 = iy * dy;
      const y1 = (iy + 1) * dy;

      const top: EdgeVertex = {
        key: `H:${ix},${iy}`,
        pt: interp({ x: x0, y: y0 }, { x: x1, y: y0 }, v0, v1),
      };
      const right: EdgeVertex = {
        key: `V:${ix + 1},${iy}`,
        pt: interp({ x: x1, y: y0 }, { x: x1, y: y1 }, v1, v2),
      };
      const bottom: EdgeVertex = {
        key: `H:${ix},${iy + 1}`,
        pt: interp({ x: x0, y: y1 }, { x: x1, y: y1 }, v3, v2),
      };
      const left: EdgeVertex = {
        key: `V:${ix},${iy}`,
        pt: interp({ x: x0, y: y0 }, { x: x0, y: y1 }, v0, v3),
      };

      switch (mask) {
        case 1:
        case 14:
          linkEdges(left, bottom);
          break;
        case 2:
        case 13:
          linkEdges(bottom, right);
          break;
        case 3:
        case 12:
          linkEdges(left, right);
          break;
        case 4:
        case 11:
          linkEdges(top, right);
          break;
        case 6:
        case 9:
          linkEdges(top, bottom);
          break;
        case 7:
        case 8:
          linkEdges(left, top);
          break;
        case 5: {
          // Saddle: TL & BR inside
          const center = (v0 + v1 + v2 + v3) * 0.25;
          if (center < 0) {
            linkEdges(top, right);
            linkEdges(left, bottom);
          } else {
            linkEdges(left, top);
            linkEdges(bottom, right);
          }
          break;
        }
        case 10: {
          // Saddle: TR & BL inside
          const center = (v0 + v1 + v2 + v3) * 0.25;
          if (center < 0) {
            linkEdges(left, top);
            linkEdges(bottom, right);
          } else {
            linkEdges(top, right);
            linkEdges(left, bottom);
          }
          break;
        }
      }
    }
  }

  const visited = new Set<string>();
  let bestLoop: Point[] = [];
  let bestArea = 0;

  for (const startKey of adj.keys()) {
    if (visited.has(startKey)) continue;
    const loop: Point[] = [];
    let prevKey: string | null = null;
    let currKey: string | undefined = startKey;

    while (currKey && !visited.has(currKey)) {
      visited.add(currKey);
      const pt = ptsByKey.get(currKey);
      if (pt) loop.push(pt);
      const neighbors: string[] = adj.get(currKey) ?? [];
      const nextKey = neighbors.find((k) => k !== prevKey && !visited.has(k));
      prevKey = currKey;
      currKey = nextKey;
    }

    if (loop.length >= 4) {
      const area = polygonArea(loop);
      if (area > bestArea) {
        bestArea = area;
        bestLoop = loop;
      }
    }
  }

  return bestLoop;
}

/**
 * Generates an aggressive, non-circular fantasy continent coastline polygon using
 * SDF multi-lobe/spine sculpting, fBM domain warping, and Marching Squares extraction.
 */
export function generateContinentMask(
  seed: number,
  coastlineJaggedness: number,
  shape: ContinentShape = 'auto'
): Point[] {
  const rng = createRng(seed + 17);
  const profiles: Exclude<ContinentShape, 'auto'>[] = [
    'crescent',
    'peninsula',
    'isthmus',
    'sprawling',
  ];
  const resolvedShape =
    shape === 'auto' ? profiles[Math.abs(seed) % profiles.length] : shape;

  const capsules: CapsuleSpec[] = [];
  const addLobes: EllipseSpec[] = [];
  const cutBays: EllipseSpec[] = [];
  const cutFjords: CapsuleSpec[] = [];

  const cx = MAP_WIDTH * 0.5;
  const cy = MAP_HEIGHT * 0.5;

  if (resolvedShape === 'crescent') {
    // Deep hooked sickle / horseshoe crescent wrapping an inland sea
    const rot = rng() * Math.PI * 2;
    const flip = rng() < 0.5 ? 1 : -1;
    const arcSpan = Math.PI * (1.22 + rng() * 0.22); // 220°–260°
    const startA = rot - arcSpan * 0.5;
    const endA = rot + arcSpan * 0.5;
    const rx = 315 + rng() * 40;
    const ry = 225 + rng() * 28;
    const shiftX = -Math.cos(rot) * 52;
    const shiftY = -Math.sin(rot) * 38;

    const segs = 7;
    const spinePts: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = startA + (endA - startA) * t;
      // Thick shoulder around middle, dramatic curved narrow horns at ends
      const bell = Math.sin(t * Math.PI);
      const asym = 1 + flip * (t - 0.5) * 0.28;
      const r = (44 + 86 * Math.pow(bell, 0.85)) * asym;
      const wobble = 1 + (rng() - 0.5) * 0.14;
      spinePts.push({
        x: cx + shiftX + Math.cos(a) * rx * wobble,
        y: cy + shiftY + Math.sin(a) * ry * wobble,
        r,
      });
    }
    for (let i = 0; i < segs; i++) {
      capsules.push({
        ax: spinePts[i].x,
        ay: spinePts[i].y,
        bx: spinePts[i + 1].x,
        by: spinePts[i + 1].y,
        rA: spinePts[i].r,
        rB: spinePts[i + 1].r,
      });
    }

    // Outer projecting cape off shoulder
    const capeA = rot + flip * (0.2 + rng() * 0.45);
    capsules.push({
      ax: cx + shiftX + Math.cos(capeA) * (rx * 0.9),
      ay: cy + shiftY + Math.sin(capeA) * (ry * 0.9),
      bx: cx + shiftX + Math.cos(capeA) * (rx * 1.48),
      by: cy + shiftY + Math.sin(capeA) * (ry * 1.42),
      rA: 82,
      rB: 42,
    });

    // Huge deep inner bay carving out the crescent mouth
    const openAngle = rot + Math.PI;
    cutBays.push({
      cx: cx + shiftX + Math.cos(openAngle) * 70,
      cy: cy + shiftY + Math.sin(openAngle) * 52,
      rx: 225,
      ry: 175,
      angle: rot,
    });

    // 1 outer fjord bite on the back rim
    const fjordA = rot - flip * (0.5 + rng() * 0.5);
    cutFjords.push({
      ax: cx + shiftX + Math.cos(fjordA) * (rx + 185),
      ay: cy + shiftY + Math.sin(fjordA) * (ry + 150),
      bx: cx + shiftX + Math.cos(fjordA) * (rx + 12),
      by: cy + shiftY + Math.sin(fjordA) * (ry + 10),
      rA: 56,
      rB: 26,
    });
  } else if (resolvedShape === 'peninsula') {
    // Off-center mainland core with 3 long crooked peninsula arms & deep cutting bays
    const sideX = rng() < 0.5 ? -1 : 1;
    const sideY = (rng() - 0.5) * 0.6;
    const coreX = cx + sideX * (225 + rng() * 55);
    const coreY = cy + sideY * 150;

    addLobes.push({
      cx: coreX,
      cy: coreY,
      rx: 190,
      ry: 148,
      angle: (rng() - 0.5) * 0.8,
    });

    const baseDir = sideX > 0 ? Math.PI : 0;
    const armAngles = [
      baseDir - 0.62 + (rng() - 0.5) * 0.16,
      baseDir + 0.04 + (rng() - 0.5) * 0.18,
      baseDir + 0.68 + (rng() - 0.5) * 0.16,
    ];

    for (let i = 0; i < armAngles.length; i++) {
      const a1 = armAngles[i];
      const len1 = 235 + rng() * 90;
      const midX = coreX + Math.cos(a1) * len1;
      const midY = coreY + Math.sin(a1) * len1 * 0.82;
      const bend = (i === 1 ? (rng() < 0.5 ? -1 : 1) : i === 0 ? -1 : 1) * (0.35 + rng() * 0.35);
      const a2 = a1 + bend;
      const len2 = 190 + rng() * 115;
      const tipX = Math.max(105, Math.min(MAP_WIDTH - 105, midX + Math.cos(a2) * len2));
      const tipY = Math.max(95, Math.min(MAP_HEIGHT - 95, midY + Math.sin(a2) * len2 * 0.85));

      const rootR = i === 1 ? 90 : 78;
      const elbowR = i === 1 ? 64 + rng() * 12 : 54 + rng() * 14;
      const tipR = i === 1 ? 58 : 44 + rng() * 14;

      capsules.push({ ax: coreX, ay: coreY, bx: midX, by: midY, rA: rootR, rB: elbowR });
      capsules.push({ ax: midX, ay: midY, bx: tipX, by: tipY, rA: elbowR, rB: tipR });
    }

    // Back stub headland on core side
    const backA = baseDir + Math.PI + (rng() - 0.5) * 0.7;
    capsules.push({
      ax: coreX,
      ay: coreY,
      bx: Math.max(115, Math.min(MAP_WIDTH - 115, coreX + Math.cos(backA) * 195)),
      by: Math.max(105, Math.min(MAP_HEIGHT - 105, coreY + Math.sin(backA) * 155)),
      rA: 80,
      rB: 45,
    });

    // Deep bays carved sharply between adjacent peninsula arms
    for (let b = 0; b < 2; b++) {
      const bayA = (armAngles[b] + armAngles[b + 1]) * 0.5;
      cutFjords.push({
        ax: coreX + Math.cos(bayA) * 560,
        ay: coreY + Math.sin(bayA) * 420,
        bx: coreX + Math.cos(bayA) * 165,
        by: coreY + Math.sin(bayA) * 145,
        rA: 72,
        rB: 32,
      });
    }
  } else if (resolvedShape === 'isthmus') {
    // Two asymmetric sub-continents joined by a genuinely narrow S-curved land bridge
    const axisAngle = (rng() - 0.5) * 0.9 + (rng() < 0.5 ? 0 : Math.PI);
    const cosA = Math.cos(axisAngle);
    const sinA = Math.sin(axisAngle);
    const perpX = -sinA;
    const perpY = cosA;

    const aX = cx - cosA * 315 + perpX * ((rng() - 0.5) * 70);
    const aY = cy - sinA * 205 + perpY * ((rng() - 0.5) * 55);
    const bX = cx + cosA * 315 + perpX * ((rng() - 0.5) * 70);
    const bY = cy + sinA * 205 + perpY * ((rng() - 0.5) * 55);

    // Sub-continent A (multi-lobed)
    addLobes.push({ cx: aX, cy: aY, rx: 195, ry: 155, angle: axisAngle + 0.5 });
    addLobes.push({
      cx: aX + perpX * 105,
      cy: aY + perpY * 85,
      rx: 125,
      ry: 90,
      angle: axisAngle - 0.4,
    });

    // Sub-continent B (contrasting skewed mass)
    addLobes.push({ cx: bX, cy: bY, rx: 175, ry: 162, angle: axisAngle - 0.65 });
    addLobes.push({
      cx: bX - perpX * 110,
      cy: bY - perpY * 88,
      rx: 120,
      ry: 86,
      angle: axisAngle + 0.35,
    });

    // Narrow crooked 3-segment land bridge (36-44px radius -> genuinely thin waist)
    const swing = (rng() < 0.5 ? 1 : -1) * (58 + rng() * 36);
    const p1x = cx - cosA * 115 + perpX * swing;
    const p1y = cy - sinA * 75 + perpY * swing;
    const p2x = cx + cosA * 115 - perpX * (swing * 0.75);
    const p2y = cy + sinA * 75 - perpY * (swing * 0.75);

    capsules.push({ ax: aX, ay: aY, bx: p1x, by: p1y, rA: 72, rB: 38 });
    capsules.push({ ax: p1x, ay: p1y, bx: p2x, by: p2y, rA: 38, rB: 36 });
    capsules.push({ ax: p2x, ay: p2y, bx: bX, by: bY, rA: 36, rB: 70 });

    // Twin opposing sea gulfs pressing tightly against both sides of the waist
    cutBays.push({
      cx: cx + perpX * 195,
      cy: cy + perpY * 165,
      rx: 165,
      ry: 132,
      angle: axisAngle,
    });
    cutBays.push({
      cx: cx - perpX * 195,
      cy: cy - perpY * 165,
      rx: 165,
      ry: 132,
      angle: axisAngle,
    });
  } else {
    // 'sprawling': Aggressive L-bend / dog-leg tectonic spine with bold headlands & deep fjords
    const flipX = rng() < 0.5 ? 1 : -1;
    const flipY = rng() < 0.5 ? 1 : -1;

    const spine = [
      { x: cx - flipX * (330 + rng() * 75), y: cy + flipY * (185 + rng() * 55), r: 105 },
      { x: cx - flipX * (150 + rng() * 65), y: cy - flipY * (145 + rng() * 60), r: 128 },
      { x: cx + flipX * (120 + rng() * 70), y: cy - flipY * (45 + rng() * 85), r: 118 },
      { x: cx + flipX * (350 + rng() * 75), y: cy + flipY * (140 + rng() * 70), r: 92 },
    ];

    for (let i = 0; i < spine.length - 1; i++) {
      capsules.push({
        ax: spine[i].x,
        ay: spine[i].y,
        bx: spine[i + 1].x,
        by: spine[i + 1].y,
        rA: spine[i].r,
        rB: spine[i + 1].r,
      });
    }

    // Two jutting jagged promontories
    const promA = rng() * Math.PI * 2;
    capsules.push({
      ax: spine[1].x,
      ay: spine[1].y,
      bx: Math.max(105, Math.min(MAP_WIDTH - 105, spine[1].x + Math.cos(promA) * 235)),
      by: Math.max(95, Math.min(MAP_HEIGHT - 95, spine[1].y + Math.sin(promA) * 185)),
      rA: 72,
      rB: 42,
    });
    const promB = promA + Math.PI * (0.75 + rng() * 0.5);
    capsules.push({
      ax: spine[2].x,
      ay: spine[2].y,
      bx: Math.max(105, Math.min(MAP_WIDTH - 105, spine[2].x + Math.cos(promB) * 225)),
      by: Math.max(95, Math.min(MAP_HEIGHT - 95, spine[2].y + Math.sin(promB) * 175)),
      rA: 68,
      rB: 38,
    });

    // Two deep sea-fjords slicing deep inward into the core flanks
    cutFjords.push({
      ax: cx - flipX * 15,
      ay: cy + flipY * 365,
      bx: cx - flipX * 15,
      by: cy + flipY * 25,
      rA: 120,
      rB: 48,
    });
    cutFjords.push({
      ax: cx + flipX * 110,
      ay: cy - flipY * 355,
      bx: cx + flipX * 65,
      by: cy - flipY * 75,
      rA: 96,
      rB: 36,
    });
  }

  const evalSdf = (x: number, y: number): number => {
    const warpAmp = 34 + coastlineJaggedness * 86;
    const wx = x + (fbm2D(x * 0.0052 + 11.3, y * 0.0052 + 4.7, seed + 31, 3) - 0.5) * warpAmp;
    const wy = y + (fbm2D(x * 0.0052 + 23.1, y * 0.0052 + 19.4, seed + 79, 3) - 0.5) * warpAmp;

    let d = 1e6;
    for (const c of capsules) {
      d = smin(d, sdCapsule(wx, wy, c.ax, c.ay, c.bx, c.by, c.rA, c.rB), 28);
    }
    for (const e of addLobes) {
      d = smin(d, sdRotatedEllipse(wx, wy, e.cx, e.cy, e.rx, e.ry, e.angle), 32);
    }
    for (const bay of cutBays) {
      d = smax(d, -sdRotatedEllipse(wx, wy, bay.cx, bay.cy, bay.rx, bay.ry, bay.angle), 20);
    }
    for (const fjord of cutFjords) {
      d = smax(d, -sdCapsule(wx, wy, fjord.ax, fjord.ay, fjord.bx, fjord.by, fjord.rA, fjord.rB), 16);
    }

    // Crisp coastal ridges
    const ridge = (fbm2D(x * 0.0115 + 3.1, y * 0.0115 + 7.4, seed + 137, 2) - 0.5) * (14 + coastlineJaggedness * 26);
    d += ridge;

    // Soft containment inside canvas padding [48..MAP_WIDTH-48, 48..MAP_HEIGHT-48]
    const margin = 48;
    const borderDist = Math.max(
      margin - x,
      x - (MAP_WIDTH - margin),
      margin - y,
      y - (MAP_HEIGHT - margin)
    );
    return smax(d, borderDist, 14);
  };

  const cols = 92;
  const rows = 64;
  const field = new Float32Array((cols + 1) * (rows + 1));

  for (let iy = 0; iy <= rows; iy++) {
    const y = (iy / rows) * MAP_HEIGHT;
    for (let ix = 0; ix <= cols; ix++) {
      const x = (ix / cols) * MAP_WIDTH;
      let v =
        ix === 0 || ix === cols || iy === 0 || iy === rows
          ? 60
          : evalSdf(x, y);
      if (Math.abs(v) < 1e-3) v = -1e-3;
      field[iy * (cols + 1) + ix] = v;
    }
  }

  const rawContour = extractLargestContour(cols, rows, field);
  if (rawContour.length < 4) {
    return [
      { x: 220, y: 200 },
      { x: 960, y: 180 },
      { x: 900, y: 620 },
      { x: 280, y: 640 },
    ];
  }

  // Simplify contour aggressively enough to keep coastal vertex counts clean (<= 30 pts)
  // while guaranteeing zero self-intersections.
  for (const tol of [19, 15, 12, 9, 6]) {
    const simplified = rdpSimplify(rawContour, tol);
    if (simplified.length >= 8 && simplified.length <= 32 && !hasSelfIntersection(simplified)) {
      return simplified.map((p) => ({
        x: Number(p.x.toFixed(1)),
        y: Number(p.y.toFixed(1)),
      }));
    }
  }

  for (const tol of [14, 10, 6]) {
    const simplified = rdpSimplify(rawContour, tol);
    if (simplified.length >= 6 && !hasSelfIntersection(simplified)) {
      return simplified.map((p) => ({
        x: Number(p.x.toFixed(1)),
        y: Number(p.y.toFixed(1)),
      }));
    }
  }

  return rawContour.map((p) => ({
    x: Number(p.x.toFixed(1)),
    y: Number(p.y.toFixed(1)),
  }));
}

/**
 * Sample region sites inside a potentially deep/concave continent mask using
 * geodesic farthest-point sampling across connected land grid cells.
 */
function sampleGeodesicSites(
  mask: Point[],
  regionCount: number,
  rng: () => number
): Point[] {
  const gCols = 78;
  const gRows = 54;
  const dx = MAP_WIDTH / gCols;
  const dy = MAP_HEIGHT / gRows;

  const isLand = new Uint8Array(gCols * gRows);
  const coastDist = new Int16Array(gCols * gRows).fill(-1);
  const box = polygonBounds(mask);

  const landCells: number[] = [];
  for (let gy = 0; gy < gRows; gy++) {
    const y = (gy + 0.5) * dy;
    if (y < box.minY || y > box.maxY) continue;
    for (let gx = 0; gx < gCols; gx++) {
      const x = (gx + 0.5) * dx;
      if (x < box.minX || x > box.maxX) continue;
      if (pointInPolygon({ x, y }, mask)) {
        const idx = gy * gCols + gx;
        isLand[idx] = 1;
        landCells.push(idx);
      }
    }
  }

  if (landCells.length === 0) {
    const c = polygonCentroid(mask);
    return Array.from({ length: regionCount }, (_, i) => ({
      x: c.x + (i % 3) * 12,
      y: c.y + Math.floor(i / 3) * 12,
    }));
  }

  // BFS from sea cells to find interior distance-from-coast for every land cell
  const queue: number[] = [];
  for (const idx of landCells) {
    const gx = idx % gCols;
    const gy = Math.floor(idx / gCols);
    const touchesSea =
      gx === 0 ||
      gx === gCols - 1 ||
      gy === 0 ||
      gy === gRows - 1 ||
      !isLand[idx - 1] ||
      !isLand[idx + 1] ||
      !isLand[idx - gCols] ||
      !isLand[idx + gCols];
    if (touchesSea) {
      coastDist[idx] = 0;
      queue.push(idx);
    }
  }

  let qHead = 0;
  while (qHead < queue.length) {
    const curr = queue[qHead++];
    const d = coastDist[curr];
    const gx = curr % gCols;
    const gy = Math.floor(curr / gCols);
    const neighbors = [
      gx > 0 ? curr - 1 : -1,
      gx < gCols - 1 ? curr + 1 : -1,
      gy > 0 ? curr - gCols : -1,
      gy < gRows - 1 ? curr + gCols : -1,
    ];
    for (const nb of neighbors) {
      if (nb >= 0 && isLand[nb] && coastDist[nb] === -1) {
        coastDist[nb] = d + 1;
        queue.push(nb);
      }
    }
  }

  // Start at the deepest interior land cell (ideal capital core)
  let firstCell = landCells[0];
  let maxCoast = -1;
  for (const idx of landCells) {
    if (coastDist[idx] > maxCoast) {
      maxCoast = coastDist[idx];
      firstCell = idx;
    }
  }

  // Keep only the connected land component containing firstCell
  const compVisited = new Uint8Array(gCols * gRows);
  const compCells: number[] = [];
  const bfsComp = [firstCell];
  compVisited[firstCell] = 1;
  let cHead = 0;
  while (cHead < bfsComp.length) {
    const curr = bfsComp[cHead++];
    compCells.push(curr);
    const gx = curr % gCols;
    const gy = Math.floor(curr / gCols);
    const neighbors = [
      gx > 0 ? curr - 1 : -1,
      gx < gCols - 1 ? curr + 1 : -1,
      gy > 0 ? curr - gCols : -1,
      gy < gRows - 1 ? curr + gCols : -1,
    ];
    for (const nb of neighbors) {
      if (nb >= 0 && isLand[nb] && !compVisited[nb]) {
        compVisited[nb] = 1;
        bfsComp.push(nb);
      }
    }
  }

  const chosenCells = [firstCell];
  const geoDist = new Float32Array(gCols * gRows).fill(Infinity);
  const minQueue: number[] = [];

  const updateGeodesicFrom = (seedIdx: number) => {
    geoDist[seedIdx] = 0;
    minQueue.length = 0;
    minQueue.push(seedIdx);
    let h = 0;
    while (h < minQueue.length) {
      const curr = minQueue[h++];
      const baseD = geoDist[curr];
      const gx = curr % gCols;
      const gy = Math.floor(curr / gCols);
      const dirs: [number, number, number][] = [
        [gx - 1, gy, 1],
        [gx + 1, gy, 1],
        [gx, gy - 1, 1],
        [gx, gy + 1, 1],
        [gx - 1, gy - 1, 1.414],
        [gx + 1, gy - 1, 1.414],
        [gx - 1, gy + 1, 1.414],
        [gx + 1, gy + 1, 1.414],
      ];
      for (const [nx, ny, w] of dirs) {
        if (nx < 0 || nx >= gCols || ny < 0 || ny >= gRows) continue;
        const nb = ny * gCols + nx;
        if (!compVisited[nb]) continue;
        const nd = baseD + w;
        if (nd + 1e-3 < geoDist[nb]) {
          geoDist[nb] = nd;
          minQueue.push(nb);
        }
      }
    }
  };

  updateGeodesicFrom(firstCell);

  for (let k = 1; k < regionCount; k++) {
    let bestCell = compCells[0];
    let bestScore = -1;
    for (const idx of compCells) {
      const score =
        geoDist[idx] +
        Math.min(2, coastDist[idx]) * 0.45 +
        rng() * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestCell = idx;
      }
    }
    chosenCells.push(bestCell);
    updateGeodesicFrom(bestCell);
  }

  return chosenCells.map((idx) => {
    const gx = idx % gCols;
    const gy = Math.floor(idx / gCols);
    return {
      x: (gx + 0.5) * dx,
      y: (gy + 0.5) * dy,
    };
  });
}

/**
 * Hash a canonical undirected edge key so shared borders between two regions
 * receive identical midpoint perturbation (zero gaps or overlaps).
 */
function canonicalEdgeKey(a: Point, b: Point): { key: string; reversed: boolean } {
  const ax = Math.round(a.x * 2);
  const ay = Math.round(a.y * 2);
  const bx = Math.round(b.x * 2);
  const by = Math.round(b.y * 2);

  if (ax < bx || (ax === bx && ay < by)) {
    return { key: `${ax},${ay}->${bx},${by}`, reversed: false };
  }
  return { key: `${bx},${by}->${ax},${ay}`, reversed: true };
}

function collapseShortEdgesAcrossCells(
  cells: Point[][],
  minEdgeLen = 32
): Point[][] {
  let current = cells.map((poly) =>
    poly.map((p) => ({
      x: Number(p.x.toFixed(1)),
      y: Number(p.y.toFixed(1)),
    }))
  );

  for (let pass = 0; pass < 20; pass++) {
    let targetA: Point | null = null;
    let targetB: Point | null = null;

    outer: for (const poly of current) {
      if (poly.length <= 4) continue;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (distance(a, b) < minEdgeLen && !isTJunctionEdge(a, b, current)) {
          const mid: Point = {
            x: Number(((a.x + b.x) / 2).toFixed(1)),
            y: Number(((a.y + b.y) / 2).toFixed(1)),
          };
          const safe = current.every((other) => {
            const hasA = other.some((v) => distance(v, a) < 1.5);
            const hasB = other.some((v) => distance(v, b) < 1.5);
            if (!hasA && !hasB) return true;
            if (hasA && hasB && other.length <= 4) return false;
            const mapped = other.map((v) =>
              distance(v, a) < 1.5 || distance(v, b) < 1.5 ? { ...mid } : v
            );
            const deduped: Point[] = [];
            for (const v of mapped) {
              if (deduped.length === 0 || distance(deduped[deduped.length - 1], v) >= 1.5) {
                deduped.push(v);
              }
            }
            if (deduped.length > 3 && distance(deduped[0], deduped[deduped.length - 1]) < 1.5) {
              deduped.pop();
            }
            return deduped.length >= 4 && !hasSelfIntersection(deduped);
          });
          if (safe) {
            targetA = a;
            targetB = b;
            break outer;
          }
        }
      }
    }

    if (!targetA || !targetB) break;

    const mid: Point = {
      x: Number(((targetA.x + targetB.x) / 2).toFixed(1)),
      y: Number(((targetA.y + targetB.y) / 2).toFixed(1)),
    };

    current = current.map((poly) => {
      const mapped = poly.map((v) =>
        distance(v, targetA!) < 1.5 || distance(v, targetB!) < 1.5 ? { ...mid } : v
      );
      const deduped: Point[] = [];
      for (const v of mapped) {
        if (deduped.length === 0 || distance(deduped[deduped.length - 1], v) >= 1.5) {
          deduped.push(v);
        }
      }
      if (deduped.length > 3 && distance(deduped[0], deduped[deduped.length - 1]) < 1.5) {
        deduped.pop();
      }
      return deduped;
    });
  }

  return current;
}

function isTJunctionEdge(a: Point, b: Point, allCells: Point[][]): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return false;
  const len = Math.sqrt(lenSq);

  for (const poly of allCells) {
    for (const v of poly) {
      if (distance(v, a) < 2 || distance(v, b) < 2) continue;
      const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / lenSq;
      if (t <= 0.02 || t >= 0.98) continue;
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      if (Math.hypot(v.x - px, v.y - py) < 3.5) {
        return true;
      }
      // Also avoid perturbing edges passing very close to another vertex
      if (t > 0.2 && t < 0.8 && len > 0 && Math.hypot(v.x - px, v.y - py) < 22) {
        return true;
      }
    }
  }
  return false;
}

function perturbPolygonEdges(
  poly: Point[],
  irregularity: number,
  seed: number,
  edgeCache: Map<string, Point[]>,
  allCells: Point[][]
): Point[] {
  if (poly.length < 3 || irregularity <= 0.08) return poly;
  const result: Point[] = [];

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = distance(a, b);

    if (len < 155 || isTJunctionEdge(a, b, allCells)) {
      result.push(a);
      continue;
    }

    const { key, reversed } = canonicalEdgeKey(a, b);
    let innerPts = edgeCache.get(key);

    if (!innerPts) {
      const start = reversed ? b : a;
      const end = reversed ? a : b;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const nx = -dy / (len || 1);
      const ny = dx / (len || 1);

      let h = seed;
      for (let c = 0; c < key.length; c++) {
        h = (h * 31 + key.charCodeAt(c)) | 0;
      }
      const erng = createRng(h);
      const amp = Math.min(14, len * 0.09) * (0.25 + irregularity * 0.75);
      const t = 0.5 + (erng() - 0.5) * 0.1;
      const offset = (erng() - 0.5) * 2 * amp;

      innerPts = [
        {
          x: Number((start.x + dx * t + nx * offset).toFixed(1)),
          y: Number((start.y + dy * t + ny * offset).toFixed(1)),
        },
      ];
      edgeCache.set(key, innerPts);
    }

    result.push(a);
    const ordered = reversed ? [...innerPts].reverse() : innerPts;
    for (const pt of ordered) {
      result.push(pt);
    }
  }

  return result;
}

function pickBiome(
  centroid: Point,
  isCoastal: boolean,
  seed: number,
  rng: () => number
): BiomeType {
  const normY = centroid.y / MAP_HEIGHT;
  const elev = fbm2D(centroid.x * 0.0045, centroid.y * 0.0045, seed + 101, 3);

  if (normY < 0.22 && elev > 0.35) return 'frostmarch';
  if (elev > 0.68) return 'highlands';
  if (isCoastal && rng() > 0.58) return 'coastline';
  if (normY > 0.74 && elev < 0.45) return 'ashlands';
  if (normY > 0.62 && rng() > 0.45) return 'steppe';
  if (elev < 0.36 && rng() > 0.45) return 'fenland';
  if (rng() > 0.48) return 'timberland';
  return 'heartland';
}

export function generateContinentName(seed: number): string {
  const rng = createRng(seed + 5);
  const a = CONTINENT_NAME_SYLLABLES[Math.floor(rng() * CONTINENT_NAME_SYLLABLES.length)];
  const b = CONTINENT_NAME_SUFFIXES[Math.floor(rng() * CONTINENT_NAME_SUFFIXES.length)];
  return `${a}${b}`;
}

function computeVoronoiCellsSafe(
  mask: Point[],
  sites: Point[]
): { cells: Point[][]; orphans: Point[][] } {
  const mainCells: Point[][] = [];
  const orphans: Point[][] = [];

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    let pieces: Point[][] = [signedPolygonArea(mask) >= 0 ? mask : [...mask].reverse()];

    for (let j = 0; j < sites.length; j++) {
      if (i === j || pieces.length === 0) continue;
      const other = sites[j];
      const mx = (site.x + other.x) / 2;
      const my = (site.y + other.y) / 2;
      const nx = other.x - site.x;
      const ny = other.y - site.y;

      const nextPieces: Point[][] = [];
      for (const piece of pieces) {
        const split = clipPolygonHalfPlaneMulti(piece, mx, my, nx, ny);
        for (const s of split) {
          if (s.length >= 3 && polygonArea(s) >= 150) {
            nextPieces.push(s);
          }
        }
      }
      pieces = nextPieces;
    }

    if (pieces.length === 0) {
      mainCells.push([]);
      continue;
    }

    if (pieces.length === 1) {
      mainCells.push(pieces[0]);
      continue;
    }

    // Choose the piece containing the site (or largest area if on boundary)
    let mainIdx = pieces.findIndex((p) => pointInPolygon(site, p));
    if (mainIdx === -1) {
      let bestArea = -1;
      pieces.forEach((p, idx) => {
        const a = polygonArea(p);
        if (a > bestArea) {
          bestArea = a;
          mainIdx = idx;
        }
      });
    }

    mainCells.push(pieces[mainIdx]);
    pieces.forEach((p, idx) => {
      if (idx !== mainIdx && polygonArea(p) >= 240) {
        orphans.push(p);
      }
    });
  }

  return { cells: mainCells, orphans };
}

export function generateContinentRegions(config: ContinentConfig): Region[] {
  const { seed, regionCount, coastlineJaggedness, borderIrregularity, shape = 'auto' } = config;
  const rng = createRng(seed);
  const mask = generateContinentMask(seed, coastlineJaggedness, shape);
  const maskCentroid = polygonCentroid(mask);

  // 1. Geodesic farthest-point site placement along every arm/horn/lobe
  let relaxedSites = sampleGeodesicSites(mask, regionCount, rng);

  // 2. Gentle Lloyd relaxation constrained strictly inside each site's connected piece
  for (let pass = 0; pass < 2; pass++) {
    const { cells } = computeVoronoiCellsSafe(mask, relaxedSites);
    relaxedSites = cells.map((cell, idx) => {
      if (cell.length < 3) return relaxedSites[idx];
      const c = polygonCentroid(cell);
      const blended = {
        x: relaxedSites[idx].x * 0.45 + c.x * 0.55,
        y: relaxedSites[idx].y * 0.45 + c.y * 0.55,
      };
      return pointInPolygon(blended, cell) ? blended : relaxedSites[idx];
    });
  }

  const { cells: rawCells, orphans } = computeVoronoiCellsSafe(mask, relaxedSites);

  // Reattach any split orphan tips into adjacent neighbor cells sharing a Voronoi bisector edge
  const mergedCells = rawCells.map((c) => [...c]);
  for (const orphan of orphans) {
    for (let i = 0; i < mergedCells.length; i++) {
      if (mergedCells[i].length < 3) continue;
      const merged = mergePolygonsAlongSharedEdge(mergedCells[i], orphan);
      if (merged) {
        mergedCells[i] = merged;
        break;
      }
    }
  }

  const finalCells = collapseShortEdgesAcrossCells(
    mergedCells.filter((c) => c.length >= 3),
    34
  );
  const edgeCache = new Map<string, Point[]>();
  const perturbedCells = finalCells.map((rawPoly) => {
    const candidatePoly = perturbPolygonEdges(
      rawPoly,
      borderIrregularity,
      seed,
      edgeCache,
      finalCells
    );
    return !hasSelfIntersection(candidatePoly) ? candidatePoly : rawPoly;
  });

  // Guarantee zero pairwise overlaps even under extreme border irregularity
  for (let pass = 0; pass < perturbedCells.length; pass++) {
    let anyReverted = false;
    for (let i = 0; i < perturbedCells.length; i++) {
      for (let j = i + 1; j < perturbedCells.length; j++) {
        if (polygonsOverlap(perturbedCells[i], perturbedCells[j])) {
          if (perturbedCells[i] !== finalCells[i]) {
            perturbedCells[i] = finalCells[i];
            anyReverted = true;
          }
          if (perturbedCells[j] !== finalCells[j]) {
            perturbedCells[j] = finalCells[j];
            anyReverted = true;
          }
        }
      }
    }
    if (!anyReverted) break;
  }

  // 3. Faction clusters (3-5 political realms)
  const factionCount = Math.min(FACTION_PRESETS.length, Math.max(3, Math.round(regionCount / 3)));
  const factionHubs = relaxedSites
    .slice(0, factionCount)
    .map((site, idx) => ({ site, preset: FACTION_PRESETS[idx % FACTION_PRESETS.length] }));

  // Used names tracking to avoid duplicate names
  const usedRegionNames = new Set<string>();
  const usedSettlementNames = new Set<string>();

  const regions: Region[] = [];

  for (let i = 0; i < finalCells.length; i++) {
    const rawPoly = finalCells[i];
    if (rawPoly.length < 3) continue;

    const irregularPoly = perturbedCells[i];
    const centroid = polygonCentroid(irregularPoly);

    // Determine if region touches continent outer boundary
    const isCoastal = rawPoly.some((v) =>
      mask.some((m) => distance(v, m) < 12)
    );

    const biome = pickBiome(centroid, isCoastal, seed, rng);

    // Assign nearest faction hub
    let nearestFaction = factionHubs[0].preset;
    let bestDist = Infinity;
    for (const hub of factionHubs) {
      const d = distance(centroid, hub.site);
      if (d < bestDist) {
        bestDist = d;
        nearestFaction = hub.preset;
      }
    }

    const threatKeys: ThreatTier[] = ['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5'];
    const distFromCenter = distance(centroid, maskCentroid) / (MAP_WIDTH * 0.42);
    const threatIdx = Math.min(
      4,
      Math.max(0, Math.floor(distFromCenter * 3.4 + rng() * 1.8))
    );
    const threat = threatKeys[threatIdx];

    // Unique biome-coherent region name
    const BIOME_NAME_PARTS: Record<BiomeType, { prefixes: string[]; roots: string[] }> = {
      heartland: { prefixes: ['Green', 'Golden', 'Fair', 'West', 'Alder'], roots: ['Vale', 'Shire', 'Downs', 'Meadow', 'Heartland'] },
      timberland: { prefixes: ['Deep', 'Elder', 'Silver', 'Whisper', 'Briar'], roots: ['Weald', 'Wood', 'Hollow', 'Glade', 'Thicket'] },
      highlands: { prefixes: ['Iron', 'High', 'Storm', 'Granite', 'Grey'], roots: ['Crag', 'Fells', 'Ridge', 'Peaks', 'Hold'] },
      steppe: { prefixes: ['Sunlit', 'Ochre', 'Amber', 'Wind', 'Dust'], roots: ['Steppe', 'Plains', 'Expanse', 'Mesa', 'March'] },
      fenland: { prefixes: ['Mist', 'Gilded', 'Reed', 'Sunken', 'Moss'], roots: ['Fen', 'Mire', 'Basin', 'Marsh', 'Hollow'] },
      frostmarch: { prefixes: ['Frost', 'Winter', 'Glacier', 'North', 'Pale'], roots: ['Reach', 'March', 'Fjord', 'Tundra', 'Crown'] },
      ashlands: { prefixes: ['Ashen', 'Cinder', 'Obsidian', 'Char', 'Basalt'], roots: ['Wastes', 'Rift', 'Caldera', 'Barrens', 'Scars'] },
      coastline: { prefixes: ['Sapphire', 'Tide', 'Gull', 'Salt', 'Dawn'], roots: ['Coast', 'Strand', 'Cove', 'Bay', 'Headland'] },
    };

    const namePool = BIOME_NAME_PARTS[biome];
    let regionName = '';
    for (let t = 0; t < 24; t++) {
      const pre =
        t < 12
          ? namePool.prefixes[Math.floor(rng() * namePool.prefixes.length)]
          : REGION_PREFIXES[Math.floor(rng() * REGION_PREFIXES.length)];
      const root =
        t < 12
          ? namePool.roots[Math.floor(rng() * namePool.roots.length)]
          : REGION_ROOTS[Math.floor(rng() * REGION_ROOTS.length)];
      const candidate = `${pre.charAt(0).toUpperCase() + pre.slice(1)} ${root}`;
      if (!usedRegionNames.has(candidate)) {
        regionName = candidate;
        usedRegionNames.add(candidate);
        break;
      }
    }
    if (!regionName) regionName = `Province ${i + 1}`;

    // Unique settlement name
    let settlementName = '';
    for (let t = 0; t < 20; t++) {
      const base = SETTLEMENT_PREFIXES[Math.floor(rng() * SETTLEMENT_PREFIXES.length)];
      if (!usedSettlementNames.has(base)) {
        settlementName = base;
        usedSettlementNames.add(base);
        break;
      }
    }
    if (!settlementName) settlementName = `${regionName.split(' ')[0]}stead`;

    const area = polygonArea(irregularPoly);
    const tier: SettlementTier =
      i === 0
        ? 'capital'
        : area > 42000
          ? 'city'
          : area > 22000
            ? 'town'
            : 'hamlet';

    const settlementSeed = (seed * 73 + (i + 1) * 997) >>> 0;
    const settlement = generateSettlementLayout({
      id: `settlement-${i + 1}-${seed}`,
      name: settlementName,
      tier,
      seed: settlementSeed,
      biome,
      isCoastal,
      mapAnchor: {
        x: Number(centroid.x.toFixed(1)),
        y: Number(centroid.y.toFixed(1)),
      },
    });

    regions.push({
      id: `region-${i + 1}-${seed}`,
      name: regionName,
      biome,
      faction: nearestFaction.name,
      factionColor: nearestFaction.color,
      threat,
      polygon: irregularPoly,
      seedSite: relaxedSites[i],
      isCoastal,
      loreNotes: `${BIOMES[biome].description} Governed by ${nearestFaction.name}.`,
      settlement,
    });
  }

  return regions;
}

export function getRegionColorSpec(
  region: Region,
  mode: ColorCodingMode
): { fill: string; stroke: string; legendLabel: string } {
  if (region.customColor) {
    return {
      fill: region.customColor,
      stroke: '#334155',
      legendLabel: 'Custom Tint',
    };
  }
  if (mode === 'biome') {
    const meta = BIOMES[region.biome];
    return { fill: meta.fill, stroke: meta.stroke, legendLabel: meta.label };
  }
  if (mode === 'threat') {
    const meta = THREAT_TIERS[region.threat];
    return { fill: meta.fill, stroke: meta.stroke, legendLabel: meta.shortLabel };
  }
  return {
    fill: region.factionColor,
    stroke: '#334155',
    legendLabel: region.faction,
  };
}
