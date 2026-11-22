import { Point } from '../types/world';

/**
 * Shoelace polygon area in square units.
 */
export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Geometric centroid of a closed polygon.
 */
export function polygonCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length < 3) {
    const sx = points.reduce((acc, p) => acc + p.x, 0);
    const sy = points.reduce((acc, p) => acc + p.y, 0);
    return { x: sx / points.length, y: sy / points.length };
  }

  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    signedArea += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }

  if (Math.abs(signedArea) < 1e-6) {
    const sx = points.reduce((acc, p) => acc + p.x, 0);
    const sy = points.reduce((acc, p) => acc + p.y, 0);
    return { x: sx / points.length, y: sy / points.length };
  }

  const denom = 3 * signedArea;
  return { x: cx / denom, y: cy / denom };
}

/**
 * Ray-casting point-in-polygon check.
 */
export function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonBounds(points: Point[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
} {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
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

export function pointsToSvgPath(points: Point[], closed = true): string {
  if (points.length === 0) return '';
  const cmds = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  if (closed) cmds.push('Z');
  return cmds.join(' ');
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Sutherland-Hodgman polygon clipping against a half-plane:
 * keeps points where (p.x - px)*nx + (p.y - py)*ny <= 0
 */
export function clipPolygonHalfPlane(
  poly: Point[],
  px: number,
  py: number,
  nx: number,
  ny: number
): Point[] {
  if (poly.length === 0) return [];
  const out: Point[] = [];
  const evalDist = (p: Point) => (p.x - px) * nx + (p.y - py) * ny;

  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const dCurr = evalDist(curr);
    const dPrev = evalDist(prev);

    const currIn = dCurr <= 1e-6;
    const prevIn = dPrev <= 1e-6;

    if (currIn) {
      if (!prevIn) {
        const t = dPrev / (dPrev - dCurr);
        out.push({
          x: prev.x + t * (curr.x - prev.x),
          y: prev.y + t * (curr.y - prev.y),
        });
      }
      out.push(curr);
    } else if (prevIn) {
      const t = dPrev / (dPrev - dCurr);
      out.push({
        x: prev.x + t * (curr.x - prev.x),
        y: prev.y + t * (curr.y - prev.y),
      });
    }
  }
  return out;
}

export function signedPolygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function pointToLineDist(pt: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return distance(pt, a);
  return Math.abs(dx * (pt.y - a.y) - dy * (pt.x - a.x)) / len;
}

/**
 * Closed-polygon Ramer-Douglas-Peucker simplification preserving sharp corners & deep bays.
 */
export function rdpSimplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 4) return points;

  // Split closed loop at the two most distant vertices along an axis/diameter
  let maxD = -1;
  let idxA = 0;
  let idxB = Math.floor(points.length / 2);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = distance(points[i], points[j]);
      if (d > maxD) {
        maxD = d;
        idxA = i;
        idxB = j;
      }
    }
  }

  const rdpOpen = (chain: Point[], eps: number): Point[] => {
    if (chain.length <= 2) return chain;
    let bestDist = -1;
    let bestIdx = -1;
    const start = chain[0];
    const end = chain[chain.length - 1];
    for (let i = 1; i < chain.length - 1; i++) {
      const d = pointToLineDist(chain[i], start, end);
      if (d > bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestDist <= eps || bestIdx === -1) {
      return [start, end];
    }
    const left = rdpOpen(chain.slice(0, bestIdx + 1), eps);
    const right = rdpOpen(chain.slice(bestIdx), eps);
    return [...left.slice(0, -1), ...right];
  };

  const arc1: Point[] = [];
  let k = idxA;
  while (true) {
    arc1.push(points[k]);
    if (k === idxB) break;
    k = (k + 1) % points.length;
  }

  const arc2: Point[] = [];
  k = idxB;
  while (true) {
    arc2.push(points[k]);
    if (k === idxA) break;
    k = (k + 1) % points.length;
  }

  const s1 = rdpOpen(arc1, tolerance);
  const s2 = rdpOpen(arc2, tolerance);
  const combined = [...s1.slice(0, -1), ...s2.slice(0, -1)];
  return combined.length >= 4 ? combined : points;
}

function dedupePolygonRing(pts: Point[], minStep = 0.6): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    if (out.length === 0 || distance(out[out.length - 1], p) >= minStep) {
      out.push({ x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) });
    }
  }
  while (out.length > 2 && distance(out[0], out[out.length - 1]) < minStep) {
    out.pop();
  }
  return out;
}

/**
 * Concave-safe half-plane polygon clipper: returns separate simple closed polygons
 * instead of creating artificial bridges across bays when a concave polygon is split.
 */
export function clipPolygonHalfPlaneMulti(
  poly: Point[],
  px: number,
  py: number,
  nx: number,
  ny: number
): Point[][] {
  if (poly.length < 3) return [];
  const oriented = signedPolygonArea(poly) >= 0 ? poly : [...poly].reverse();
  const nLen = Math.hypot(nx, ny) || 1;
  const unx = nx / nLen;
  const uny = ny / nLen;

  const evalDist = (p: Point): number => {
    const v = (p.x - px) * unx + (p.y - py) * uny;
    return Math.abs(v) < 1e-4 ? 1e-4 : v;
  };

  const dists = oriented.map(evalDist);
  const allIn = dists.every((d) => d <= 0);
  if (allIn) return [oriented.map((p) => ({ ...p }))];
  const allOut = dists.every((d) => d > 0);
  if (allOut) return [];

  // Find first out -> in transition
  const n = oriented.length;
  let startEdge = -1;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    if (dists[i] > 0 && dists[next] <= 0) {
      startEdge = i;
      break;
    }
  }
  if (startEdge === -1) return [];

  interface Chain {
    enterPt: Point;
    exitPt: Point;
    pts: Point[];
  }

  const chains: Chain[] = [];
  let currentChain: { enterPt: Point; pts: Point[] } | null = null;

  for (let step = 0; step < n; step++) {
    const i = (startEdge + step) % n;
    const next = (i + 1) % n;
    const pA = oriented[i];
    const pB = oriented[next];
    const dA = dists[i];
    const dB = dists[next];

    if (dA > 0 && dB <= 0) {
      const t = dA / (dA - dB);
      const enterPt = {
        x: pA.x + t * (pB.x - pA.x),
        y: pA.y + t * (pB.y - pA.y),
      };
      currentChain = { enterPt, pts: [enterPt, pB] };
    } else if (dA <= 0 && dB <= 0) {
      if (currentChain) {
        currentChain.pts.push(pB);
      }
    } else if (dA <= 0 && dB > 0) {
      const t = dA / (dA - dB);
      const exitPt = {
        x: pA.x + t * (pB.x - pA.x),
        y: pA.y + t * (pB.y - pA.y),
      };
      if (currentChain) {
        currentChain.pts.push(exitPt);
        chains.push({
          enterPt: currentChain.enterPt,
          exitPt,
          pts: currentChain.pts,
        });
        currentChain = null;
      }
    }
  }

  if (chains.length === 0) return [];
  if (chains.length === 1) {
    const cleaned = dedupePolygonRing(chains[0].pts);
    return cleaned.length >= 3 && polygonArea(cleaned) >= 40 ? [cleaned] : [];
  }

  // Tangent along clip line keeping d <= 0 on left of positive-area boundary
  const tx = -uny;
  const ty = unx;
  const proj = (p: Point) => (p.x - px) * tx + (p.y - py) * ty;

  interface Crossing {
    kind: 'enter' | 'exit';
    chainIdx: number;
    t: number;
  }

  const crossings: Crossing[] = [];
  chains.forEach((ch, idx) => {
    crossings.push({ kind: 'enter', chainIdx: idx, t: proj(ch.enterPt) });
    crossings.push({ kind: 'exit', chainIdx: idx, t: proj(ch.exitPt) });
  });
  crossings.sort((a, b) => a.t - b.t);

  const nextChainFromExit = new Map<number, number>();
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    const c0 = crossings[k];
    const c1 = crossings[k + 1];
    if (c0.kind === 'exit' && c1.kind === 'enter') {
      nextChainFromExit.set(c0.chainIdx, c1.chainIdx);
    } else if (c0.kind === 'enter' && c1.kind === 'exit') {
      nextChainFromExit.set(c1.chainIdx, c0.chainIdx);
    } else {
      // Degenerate numeric tie fallback: clip single loop
      const single = clipPolygonHalfPlane(oriented, px, py, unx, uny);
      const cleaned = dedupePolygonRing(single);
      return cleaned.length >= 3 && polygonArea(cleaned) >= 40 ? [cleaned] : [];
    }
  }

  const visited = new Set<number>();
  const loops: Point[][] = [];

  for (let i = 0; i < chains.length; i++) {
    if (visited.has(i)) continue;
    const pts: Point[] = [];
    let curr: number | undefined = i;
    let guard = 0;
    while (curr !== undefined && !visited.has(curr) && guard <= chains.length) {
      visited.add(curr);
      pts.push(...chains[curr].pts);
      curr = nextChainFromExit.get(curr);
      guard++;
    }
    const cleaned = dedupePolygonRing(pts);
    if (cleaned.length >= 3 && polygonArea(cleaned) >= 40) {
      loops.push(cleaned);
    }
  }

  return loops;
}

/**
 * Merges two simple polygons that share an internal straight boundary segment
 * (e.g., an orphan peninsula tip cut by a Voronoi bisector).
 */
export function mergePolygonsAlongSharedEdge(polyA: Point[], polyB: Point[]): Point[] | null {
  if (polyA.length < 3 || polyB.length < 3) return null;
  const a = signedPolygonArea(polyA) >= 0 ? [...polyA] : [...polyA].reverse();
  const b = signedPolygonArea(polyB) >= 0 ? [...polyB] : [...polyB].reverse();

  const trySpliceExact = (pA: Point[], pB: Point[]): Point[] | null => {
    const eps = 1.4;
    for (let i = 0; i < pA.length; i++) {
      const a1 = pA[i];
      const a2 = pA[(i + 1) % pA.length];
      if (distance(a1, a2) < 2) continue;

      for (let j = 0; j < pB.length; j++) {
        const b1 = pB[j];
        const b2 = pB[(j + 1) % pB.length];
        if (distance(a1, b2) <= eps && distance(a2, b1) <= eps) {
          const merged: Point[] = [];
          for (let k = 0; k <= i; k++) merged.push(pA[k]);
          for (let step = 2; step < pB.length; step++) {
            merged.push(pB[(j + step) % pB.length]);
          }
          for (let k = i + 1; k < pA.length; k++) merged.push(pA[k]);
          const cleaned = dedupePolygonRing(merged);
          if (cleaned.length >= 3 && !hasSelfIntersection(cleaned)) {
            return cleaned;
          }
        }
      }
    }
    return null;
  };

  const exact = trySpliceExact(a, b);
  if (exact) return exact;

  // Sub-segment collinear overlap fallback
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    const dx = a2.x - a1.x;
    const dy = a2.y - a1.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) continue;
    const ux = dx / len;
    const uy = dy / len;

    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      const d1 = Math.abs(ux * (b1.y - a1.y) - uy * (b1.x - a1.x));
      const d2 = Math.abs(ux * (b2.y - a1.y) - uy * (b2.x - a1.x));
      if (d1 > 1.2 || d2 > 1.2) continue;

      // Opposite orientation along edge: dot((b2-b1), u) < 0
      const bDir = (b2.x - b1.x) * ux + (b2.y - b1.y) * uy;
      if (bDir >= -2) continue;

      const tB1 = (b1.x - a1.x) * ux + (b1.y - a1.y) * uy;
      const tB2 = (b2.x - a1.x) * ux + (b2.y - a1.y) * uy;
      const lo = Math.max(0, Math.min(tB1, tB2));
      const hi = Math.min(len, Math.max(tB1, tB2));
      if (hi - lo < 4) continue;

      const ptLo = { x: a1.x + ux * lo, y: a1.y + uy * lo };
      const ptHi = { x: a1.x + ux * hi, y: a1.y + uy * hi };

      // Insert ptLo and ptHi on a's edge i -> i+1 (ascending t along a)
      const nextA: Point[] = [];
      for (let k = 0; k < a.length; k++) {
        nextA.push(a[k]);
        if (k === i) {
          if (lo > 1.2) nextA.push(ptLo);
          if (hi < len - 1.2) nextA.push(ptHi);
        }
      }

      // Insert ptHi and ptLo on b's edge j -> j+1 (descending t along a)
      const nextB: Point[] = [];
      for (let k = 0; k < b.length; k++) {
        nextB.push(b[k]);
        if (k === j) {
          if (tB1 > hi + 1.2) nextB.push(ptHi);
          if (tB2 < lo - 1.2) nextB.push(ptLo);
        }
      }

      const spliced = trySpliceExact(dedupePolygonRing(nextA), dedupePolygonRing(nextB));
      if (spliced) return spliced;
    }
  }

  return null;
}

/**
 * Insert a new vertex at the midpoint of edge [edgeIndex -> edgeIndex+1].
 */
export function insertVertexOnEdge(polygon: Point[], edgeIndex: number): Point[] {
  if (polygon.length < 3) return polygon;
  const idx = ((edgeIndex % polygon.length) + polygon.length) % polygon.length;
  const a = polygon[idx];
  const b = polygon[(idx + 1) % polygon.length];
  const mid: Point = {
    x: Number(((a.x + b.x) / 2).toFixed(1)),
    y: Number(((a.y + b.y) / 2).toFixed(1)),
  };
  const next = [...polygon];
  next.splice(idx + 1, 0, mid);
  return next;
}

/**
 * Remove a vertex from a polygon if at least 4 vertices remain (minimum triangle preserved).
 */
export function removeVertex(polygon: Point[], vertexIndex: number): Point[] {
  if (polygon.length <= 3) return polygon;
  if (vertexIndex < 0 || vertexIndex >= polygon.length) return polygon;
  return polygon.filter((_, idx) => idx !== vertexIndex);
}

/**
 * Move a vertex in a polygon, optionally clamping to map bounds.
 */
export function moveVertex(
  polygon: Point[],
  vertexIndex: number,
  target: Point,
  bounds = { minX: 20, minY: 20, maxX: 1180, maxY: 800 }
): Point[] {
  if (vertexIndex < 0 || vertexIndex >= polygon.length) return polygon;
  const clamped: Point = {
    x: Number(Math.max(bounds.minX, Math.min(bounds.maxX, target.x)).toFixed(1)),
    y: Number(Math.max(bounds.minY, Math.min(bounds.maxY, target.y)).toFixed(1)),
  };
  return polygon.map((p, idx) => (idx === vertexIndex ? clamped : p));
}

function perpendicularDist(pt: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return distance(pt, a);
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
  return distance(pt, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * Iterative closed-polygon simplification removing vertices with smallest
 * perpendicular deviation under `tolerance`, while preserving at least `minVertices`.
 */
export function simplifyPolygon(
  polygon: Point[],
  tolerance = 7,
  minVertices = 4
): Point[] {
  if (polygon.length <= minVertices) return polygon;
  const pts = [...polygon];

  while (pts.length > minVertices) {
    let minErr = Infinity;
    let minIdx = -1;

    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const curr = pts[i];
      const next = pts[(i + 1) % pts.length];
      const err = perpendicularDist(curr, prev, next);
      if (err < minErr) {
        minErr = err;
        minIdx = i;
      }
    }

    if (minIdx === -1 || minErr > tolerance) break;
    pts.splice(minIdx, 1);
  }

  return pts;
}

export function closestPointOnSegment(pt: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return { ...a };
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
  return {
    x: Number((a.x + t * dx).toFixed(1)),
    y: Number((a.y + t * dy).toFixed(1)),
  };
}

export interface SnapResult {
  point: Point;
  kind: 'none' | 'vertex' | 'edge';
  edgeSegment?: [Point, Point];
}

/**
 * Finds the nearest neighboring node (vertex) or line (edge) within threshold distances.
 * Supports both node-to-node snapping and node-to-line snapping.
 */
export function findSnapTarget(
  pt: Point,
  otherPolygons: Point[][],
  vertexThreshold = 15,
  edgeThreshold = 12
): SnapResult {
  let bestVertex: Point | null = null;
  let bestVertexDist = vertexThreshold;

  for (const poly of otherPolygons) {
    for (const v of poly) {
      const d = distance(pt, v);
      if (d <= bestVertexDist) {
        bestVertexDist = d;
        bestVertex = { x: v.x, y: v.y };
      }
    }
  }

  let bestEdgePt: Point | null = null;
  let bestEdgeDist = edgeThreshold;
  let bestSeg: [Point, Point] | undefined;

  for (const poly of otherPolygons) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const proj = closestPointOnSegment(pt, a, b);
      const d = distance(pt, proj);
      if (d <= bestEdgeDist) {
        bestEdgeDist = d;
        bestEdgePt = proj;
        bestSeg = [a, b];
      }
    }
  }

  // Prefer node-to-node snap when close to a corner, otherwise allow smooth node-to-line snap
  if (bestVertex && (!bestEdgePt || bestVertexDist <= 9 || bestVertexDist <= bestEdgeDist + 4)) {
    return { point: bestVertex, kind: 'vertex' };
  }

  if (bestEdgePt && bestSeg) {
    return { point: bestEdgePt, kind: 'edge', edgeSegment: bestSeg };
  }

  if (bestVertex) {
    return { point: bestVertex, kind: 'vertex' };
  }

  return { point: pt, kind: 'none' };
}

/**
 * Returns true if pt lies within `eps` units of any edge of `poly`.
 */
export function pointOnPolygonBoundary(pt: Point, poly: Point[], eps = 0.25): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const proj = closestPointOnSegment(pt, a, b);
    if (distance(pt, proj) <= eps) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if pt is strictly inside `poly` (not on its boundary).
 */
export function pointStrictlyInPolygon(pt: Point, poly: Point[], eps = 0.25): boolean {
  if (poly.length < 3) return false;
  if (pointOnPolygonBoundary(pt, poly, eps)) return false;
  return pointInPolygon(pt, poly);
}

function signedPerpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return distance(p, a);
  return (dx * (p.y - a.y) - dy * (p.x - a.x)) / len;
}

/**
 * Returns true if two line segments strictly cross each other (interior intersection > `eps`).
 * Shared endpoints or collinear touching segments return false.
 */
export function segmentsProperlyIntersect(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
  eps = 0.25
): boolean {
  if (
    Math.max(a1.x, a2.x) < Math.min(b1.x, b2.x) - eps ||
    Math.max(b1.x, b2.x) < Math.min(a1.x, a2.x) - eps ||
    Math.max(a1.y, a2.y) < Math.min(b1.y, b2.y) - eps ||
    Math.max(b1.y, b2.y) < Math.min(a1.y, a2.y) - eps
  ) {
    return false;
  }

  const da1 = signedPerpDist(a1, b1, b2);
  const da2 = signedPerpDist(a2, b1, b2);
  const db1 = signedPerpDist(b1, a1, a2);
  const db2 = signedPerpDist(b2, a1, a2);

  const crossesA = (da1 > eps && da2 < -eps) || (da1 < -eps && da2 > eps);
  const crossesB = (db1 > eps && db2 < -eps) || (db1 < -eps && db2 > eps);
  return crossesA && crossesB;
}

/**
 * Detects whether a closed polygon has any self-intersection or degenerate area.
 */
export function hasSelfIntersection(poly: Point[]): boolean {
  const n = poly.length;
  if (n < 3 || polygonArea(poly) < 120) return true;

  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2, 0.25)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Returns true if two simple closed polygons share strictly positive interior area
 * (edge/vertex touching along shared borders is allowed).
 */
export function polygonsOverlap(polyA: Point[], polyB: Point[]): boolean {
  if (polyA.length < 3 || polyB.length < 3) return false;

  const bA = polygonBounds(polyA);
  const bB = polygonBounds(polyB);
  if (
    bA.maxX <= bB.minX - 0.1 ||
    bB.maxX <= bA.minX - 0.1 ||
    bA.maxY <= bB.minY - 0.1 ||
    bB.maxY <= bA.minY - 0.1
  ) {
    return false;
  }

  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsProperlyIntersect(a1, a2, b1, b2, 0.25)) {
        return true;
      }
    }
  }

  for (let i = 0; i < polyA.length; i++) {
    const a = polyA[i];
    const next = polyA[(i + 1) % polyA.length];
    if (pointStrictlyInPolygon(a, polyB, 0.25)) return true;
    const mid = { x: (a.x + next.x) / 2, y: (a.y + next.y) / 2 };
    if (pointStrictlyInPolygon(mid, polyB, 0.25)) return true;
  }

  for (let i = 0; i < polyB.length; i++) {
    const b = polyB[i];
    const next = polyB[(i + 1) % polyB.length];
    if (pointStrictlyInPolygon(b, polyA, 0.25)) return true;
    const mid = { x: (b.x + next.x) / 2, y: (b.y + next.y) / 2 };
    if (pointStrictlyInPolygon(mid, polyA, 0.25)) return true;
  }

  const cA = polygonCentroid(polyA);
  if (pointStrictlyInPolygon(cA, polyA, 0.25) && pointStrictlyInPolygon(cA, polyB, 0.25)) {
    return true;
  }
  const cB = polygonCentroid(polyB);
  if (pointStrictlyInPolygon(cB, polyB, 0.25) && pointStrictlyInPolygon(cB, polyA, 0.25)) {
    return true;
  }

  return false;
}

/**
 * Checks whether a set of polygons contains any self-intersection or pairwise overlap.
 */
export function hasAnyPolygonOverlap(polygons: Point[][]): boolean {
  for (let i = 0; i < polygons.length; i++) {
    if (hasSelfIntersection(polygons[i])) return true;
    for (let j = i + 1; j < polygons.length; j++) {
      if (polygonsOverlap(polygons[i], polygons[j])) return true;
    }
  }
  return false;
}

/**
 * Resolves a vertex move to the closest non-overlapping, non-self-intersecting point
 * along the drag path (with orthogonal/angled slide fallback so borders glide smoothly).
 */
export function resolveVertexMoveNoOverlap(params: {
  regions: { id: string; polygon: Point[] }[];
  draggedRegionId: string;
  vertexIndex: number;
  sharedLinks: { regionId: string; vertexIndex: number }[];
  currentPt: Point;
  targetPt: Point;
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}): Point {
  const {
    regions,
    draggedRegionId,
    vertexIndex,
    sharedLinks,
    currentPt,
    targetPt,
    bounds = { minX: 20, minY: 20, maxX: 1180, maxY: 800 },
  } = params;

  const clampAndRound = (p: Point): Point => ({
    x: Number(Math.max(bounds.minX, Math.min(bounds.maxX, p.x)).toFixed(1)),
    y: Number(Math.max(bounds.minY, Math.min(bounds.maxY, p.y)).toFixed(1)),
  });

  const sharedByRegion = new Map<string, Set<number>>();
  for (const link of sharedLinks) {
    let set = sharedByRegion.get(link.regionId);
    if (!set) {
      set = new Set<number>();
      sharedByRegion.set(link.regionId, set);
    }
    set.add(link.vertexIndex);
  }

  const isValidCandidate = (candidatePt: Point): boolean => {
    const modifiedPolys: { id: string; poly: Point[] }[] = [];
    const unmodifiedPolys: Point[][] = [];

    for (const r of regions) {
      if (r.id === draggedRegionId) {
        const nextPoly = r.polygon.map((v, idx) => (idx === vertexIndex ? candidatePt : v));
        if (hasSelfIntersection(nextPoly)) return false;
        modifiedPolys.push({ id: r.id, poly: nextPoly });
      } else {
        const linkedSet = sharedByRegion.get(r.id);
        if (linkedSet && linkedSet.size > 0) {
          const nextPoly = r.polygon.map((v, idx) => (linkedSet.has(idx) ? candidatePt : v));
          if (hasSelfIntersection(nextPoly)) return false;
          modifiedPolys.push({ id: r.id, poly: nextPoly });
        } else {
          unmodifiedPolys.push(r.polygon);
        }
      }
    }

    for (let i = 0; i < modifiedPolys.length; i++) {
      for (let j = i + 1; j < modifiedPolys.length; j++) {
        if (polygonsOverlap(modifiedPolys[i].poly, modifiedPolys[j].poly)) return false;
      }
      for (const other of unmodifiedPolys) {
        if (polygonsOverlap(modifiedPolys[i].poly, other)) return false;
      }
    }

    return true;
  };

  const target = clampAndRound(targetPt);
  if (isValidCandidate(target)) return target;

  const start = clampAndRound(currentPt);
  const binaryAdvance = (from: Point, to: Point, steps = 11): Point => {
    let best = from;
    let lo = 0;
    let hi = 1;
    for (let s = 0; s < steps; s++) {
      const mid = (lo + hi) / 2;
      const probe = clampAndRound({
        x: from.x + (to.x - from.x) * mid,
        y: from.y + (to.y - from.y) * mid,
      });
      if (isValidCandidate(probe)) {
        best = probe;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return best;
  };

  let best = binaryAdvance(start, target, 12);

  // Try sliding along X, Y, and tilted tangents if blocked mid-drag
  const remX = target.x - best.x;
  const remY = target.y - best.y;
  const remDist = Math.hypot(remX, remY);
  if (remDist > 1.2) {
    const slideTargets: Point[] = [
      { x: target.x, y: best.y },
      { x: best.x, y: target.y },
    ];
    const baseAngle = Math.atan2(remY, remX);
    for (const delta of [-Math.PI / 4, Math.PI / 4, -Math.PI / 2.6, Math.PI / 2.6]) {
      slideTargets.push({
        x: best.x + Math.cos(baseAngle + delta) * remDist,
        y: best.y + Math.sin(baseAngle + delta) * remDist,
      });
    }

    let bestCandidate = best;
    let bestDistToTarget = distance(best, target);
    for (const st of slideTargets) {
      const slid = binaryAdvance(best, clampAndRound(st), 8);
      const d = distance(slid, target);
      if (d < bestDistToTarget - 0.3) {
        bestDistToTarget = d;
        bestCandidate = slid;
      }
    }
    best = bestCandidate;
  }

  return isValidCandidate(best) ? best : start;
}

/**
 * Finds a free non-overlapping spot on the map for adding a new region polygon.
 */
export function findNonOverlappingRegionSpot(
  existingPolygons: Point[][],
  mapWidth: number,
  mapHeight: number,
  seedIndex: number
): { center: Point; polygon: Point[] } {
  const buildHex = (cx: number, cy: number, radius: number): Point[] =>
    Array.from({ length: 7 }, (_, i) => {
      const a = (i / 7) * Math.PI * 2 + seedIndex * 0.37;
      const r = radius * (i % 2 === 0 ? 1.08 : 0.88);
      return {
        x: Number((cx + Math.cos(a) * r).toFixed(1)),
        y: Number((cy + Math.sin(a) * r).toFixed(1)),
      };
    });

  const radii = [58, 44, 34];
  for (const radius of radii) {
    const margin = radius + 24;
    // Try coastal rings outward from center first so new provinces sit close to the landmass
    const candidates: Point[] = [];
    const ringCount = 28;
    for (const ringScale of [0.22, 0.29, 0.36, 0.43]) {
      for (let k = 0; k < ringCount; k++) {
        const angle = ((k + seedIndex * 5) / ringCount) * Math.PI * 2;
        const cx = mapWidth / 2 + Math.cos(angle) * (mapWidth * ringScale);
        const cy = mapHeight / 2 + Math.sin(angle) * (mapHeight * ringScale);
        candidates.push({
          x: Math.max(margin, Math.min(mapWidth - margin, cx)),
          y: Math.max(margin, Math.min(mapHeight - margin, cy)),
        });
      }
    }
    for (let y = margin; y <= mapHeight - margin; y += 72) {
      for (let x = margin; x <= mapWidth - margin; x += 84) {
        candidates.push({ x, y });
      }
    }

    for (const c of candidates) {
      const poly = buildHex(c.x, c.y, radius);
      const overlaps = existingPolygons.some((existing) => polygonsOverlap(poly, existing));
      if (!overlaps) {
        return {
          center: { x: Number(c.x.toFixed(1)), y: Number(c.y.toFixed(1)) },
          polygon: poly,
        };
      }
    }
  }

  // Fallback top-left corner clamped inside bounds
  const fallbackCenter = { x: 84, y: 84 };
  return { center: fallbackCenter, polygon: buildHex(84, 84, 34) };
}


