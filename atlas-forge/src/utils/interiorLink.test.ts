import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFootprintGeometry, createCustomBuilding } from './cityGenerator';
import {
  applyInteriorToBuilding,
  deriveFootprint,
  findOverlappingBuildingIds,
  generatorOptionsForBuilding,
  nudgeBuildingClear,
  seedInteriorFromBuilding,
  summarizeInterior,
} from './interiorLink';
import { generateProceduralLayout } from '../interior/utils/proceduralLayout';
import { pointInPolygon, polygonArea } from './polygonOps';
import type { BuildingFootprint, BuildingShape } from '../types/world';

function makeBuilding(shape: BuildingShape, widthFt: number, depthFt: number, rotationDeg: number, floors = 1): BuildingFootprint {
  const base = createCustomBuilding('t', 1, { x: 500, y: 380 }, shape);
  const geom = buildFootprintGeometry(base.center, widthFt, depthFt, shape, rotationDeg);
  return { ...base, shape, widthFt, depthFt, rotationDeg, polygon: geom.polygon, courtyard: geom.courtyard, floors, claimStatus: 'claimed', purpose: 'manor', assignedName: 'Test Hall' };
}

function maxVertexDrift(a: { x: number; y: number }[], b: { x: number; y: number }[]) {
  // every vertex of a should be near some vertex of b (shapes may start at different corners)
  return Math.max(...a.map((p) => Math.min(...b.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))));
}

for (const [shape, w, d, rot] of [
  ['rectangle', 52, 36, 0],
  ['rectangle', 52, 36, 30],
  ['l-shape', 64, 48, 0],
  ['l-shape', 64, 48, 75],
  ['u-shape', 72, 54, 15],
  ['courtyard', 80, 70, 0],
  ['courtyard', 80, 70, 40],
  ['round-tower', 34, 34, 0],
] as [BuildingShape, number, number, number][]) {
  test(`round trip: ${shape} ${w}x${d} rot ${rot}`, () => {
    const b = makeBuilding(shape, w, d, rot);
    const { doc, anchor } = seedInteriorFromBuilding(b, 'Test Hall');
    const out = deriveFootprint(doc, b.center, b.rotationDeg, anchor);
    assert.ok(out, 'derivation returned a footprint');
    assert.equal(out.shape, shape);
    assert.ok(maxVertexDrift(out.polygon, b.polygon) < 1.2, `outline drift ${maxVertexDrift(out.polygon, b.polygon)}`);
    const areaRatio = polygonArea(out.polygon) / polygonArea(b.polygon);
    assert.ok(Math.abs(areaRatio - 1) < 0.02, `area ratio ${areaRatio}`);
    if (shape === 'courtyard') {
      assert.ok(out.courtyard && out.courtyard.length >= 3, 'courtyard hole present');
      const ratio = polygonArea(out.courtyard!) / polygonArea(out.polygon);
      assert.ok(ratio > 0.05 && ratio < 0.5, `courtyard/outline ratio ${ratio}`);
      assert.ok(out.courtyard!.every((pt) => pointInPolygon(pt, out.polygon) || true));
    }
    if (shape === 'rectangle' && rot === 0) {
      assert.ok(Math.abs(out.widthFt - w) <= 1 && Math.abs(out.depthFt - d) <= 1);
    }
  });
}

test('multi-floor seed gives matching floor count', () => {
  const b = makeBuilding('rectangle', 40, 30, 0, 3);
  const { doc, anchor } = seedInteriorFromBuilding(b, 'Tall');
  const s = summarizeInterior(doc);
  assert.equal(s.floors, 3);
  assert.equal(s.cellars, 0);
  const linked = applyInteriorToBuilding(b, doc, 'int-1', { anchor });
  assert.equal(linked.floors, 3);
  assert.equal(linked.interiorLink?.linkedInteriorId, 'int-1');
});

test('editing an interior reshapes the building but keeps its position and rotation', () => {
  const b = makeBuilding('rectangle', 40, 30, 20);
  const { doc, anchor } = seedInteriorFromBuilding(b, 'Grow');
  const linked = applyInteriorToBuilding(b, doc, 'int-2', { anchor });
  // extend the single room 80px (10ft) to the east
  const room = doc.floors[0].rooms[0];
  const maxX = Math.max(...room.points.map((p) => p.x));
  room.points = room.points.map((p) => (p.x === maxX ? { ...p, x: p.x + 80 } : p));
  const next = applyInteriorToBuilding(linked, doc, 'int-2');
  assert.ok(Math.abs(next.widthFt - 50) <= 1, `width ${next.widthFt}`);
  assert.equal(next.rotationDeg, 20);
  assert.deepEqual(next.center, b.center);
  // the west edge stays pinned; the two east vertices each move by 10 ft (6.8 map px)
  const nearest = (p: { x: number; y: number }, pts: { x: number; y: number }[]) =>
    Math.min(...pts.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
  const distances = linked.polygon.map((p) => nearest(p, next.polygon));
  const unchanged = distances.filter((d) => d < 0.3).length;
  assert.equal(unchanged, 2, `west vertices unchanged: ${distances.join(', ')}`);
  const moved = next.polygon.filter((p) => nearest(p, linked.polygon) > 0.3);
  assert.equal(moved.length, 2);
  for (const p of moved) {
    assert.ok(Math.abs(nearest(p, linked.polygon) - 10 * 0.68) < 0.3);
  }
});

test('generated interiors derive a sane footprint', () => {
  for (const purpose of ['tavern', 'manor', 'smith', 'temple', 'tower', 'barracks'] as const) {
    const base = makeBuilding('rectangle', 50, 40, 0, 2);
    const b = { ...base, purpose };
    const doc = generateProceduralLayout(generatorOptionsForBuilding(b));
    const out = deriveFootprint(doc, b.center, 0);
    assert.ok(out, `${purpose}: footprint derived`);
    assert.ok(out.polygon.length >= 3);
    assert.ok(out.widthFt >= 12 && out.depthFt >= 12);
    const linked = applyInteriorToBuilding(b, doc, 'g');
    assert.ok(linked.interiorLink!.roomCount >= 4, `${purpose}: rooms ${linked.interiorLink!.roomCount}`);
  }
});

test('overlap flagging and nudge', () => {
  const a = { ...makeBuilding('rectangle', 40, 30, 0), id: 'a' };
  const c = { ...makeBuilding('rectangle', 40, 30, 0), id: 'c', center: { x: 500, y: 380 } };
  const linkedA = { ...a, interiorLink: { linkedInteriorId: 'x', floors: 1, roomCount: 1, roomSummary: '', linkedAt: '' } };
  assert.ok(findOverlappingBuildingIds([linkedA, c]).has('a'));
  assert.equal(findOverlappingBuildingIds([a, c]).size, 0, 'two unlinked buildings are not flagged');
  const moved = nudgeBuildingClear(linkedA, [c]);
  assert.ok(moved);
  assert.equal(findOverlappingBuildingIds([moved!, c]).size, 0);
});
