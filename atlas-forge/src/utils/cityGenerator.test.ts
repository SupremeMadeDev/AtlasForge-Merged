import test from 'node:test';
import assert from 'node:assert/strict';
import { applyInteriorToBuilding, seedInteriorFromBuilding } from './interiorLink';
import {
  claimBuilding,
  computeBuildingAreaSqFt,
  generateSettlementLayout,
  insertBuildingVertex,
  populateEssentialBuildings,
  removeBuildingVertex,
  snapToRotatedGrid,
  unclaimBuilding,
  updateBuildingPolygon,
} from './cityGenerator';
import { generateContinentRegions } from './continentGenerator';

test('generateSettlementLayout initializes all buildings as unclaimed', () => {
  const settlement = generateSettlementLayout({
    id: 's-1',
    name: 'Oakhaven',
    tier: 'city',
    seed: 777,
    biome: 'heartland',
    isCoastal: false,
    mapAnchor: { x: 400, y: 300 },
  });

  assert.ok(settlement.buildings.length >= 25);
  assert.ok(settlement.roads.length >= 4);
  for (const b of settlement.buildings) {
    assert.equal(b.claimStatus, 'unclaimed');
    assert.equal(b.purpose, undefined);
    assert.ok(b.polygon.length >= 4);
    assert.ok(computeBuildingAreaSqFt(b) > 100);
  }
});

test('claiming, linking an interior, and unclaiming buildings', () => {
  const [region] = generateContinentRegions({
    name: 'Solvgard',
    seed: 888,
    regionCount: 6,
    coastlineJaggedness: 0.5,
    borderIrregularity: 0.5,
  });

  const targetBuilding = region.settlement.buildings[0];
  assert.equal(targetBuilding.claimStatus, 'unclaimed');

  const claimed = claimBuilding(targetBuilding, {
    purpose: 'tavern',
    assignedName: 'The Brass Compass',
    mapLabel: '  Quest Hub · Dockside  ',
    notes: 'Harborfront inn with hidden cellar',
    floors: 2,
  });
  assert.equal(claimed.claimStatus, 'claimed');
  assert.equal(claimed.purpose, 'tavern');
  assert.equal(claimed.assignedName, 'The Brass Compass');
  assert.equal(claimed.mapLabel, 'Quest Hub · Dockside');
  assert.equal(claimed.showMapLabel, true);

  const linked = applyInteriorToBuilding(
    claimed,
    seedInteriorFromBuilding(claimed, 'The Brass Compass').doc,
    'INT-9042'
  );
  assert.equal(linked.interiorLink?.linkedInteriorId, 'INT-9042');
  assert.equal(linked.interiorLink?.floors, 2);
  assert.ok((linked.interiorLink?.roomCount ?? 0) >= 2);
  assert.ok(computeBuildingAreaSqFt(linked) > 0);

  const unclaimed = unclaimBuilding(linked);
  assert.equal(unclaimed.claimStatus, 'unclaimed');
  assert.equal(unclaimed.purpose, undefined);
  assert.equal(unclaimed.mapLabel, undefined);
  assert.equal(unclaimed.showMapLabel, undefined);
  assert.equal(unclaimed.interiorLink, undefined);
});

test('snapToRotatedGrid snaps coordinates along the building orientation angle without center offset', () => {
  const centerA = { x: 200, y: 200 };
  const centerB = { x: 243.7, y: 317.9 };
  const rotationDeg = 45;
  const testPt = { x: 215, y: 212 };

  const snappedA = snapToRotatedGrid(testPt, centerA, rotationDeg, 5);
  const snappedB = snapToRotatedGrid(testPt, centerB, rotationDeg, 5);
  assert.deepEqual(snappedA, snappedB, 'grid snap must rotate with building angle without shifting by center');

  // Snap with 0 rotation should align to 6.8px (10ft * 0.68) multiples from world origin
  const snapped0 = snapToRotatedGrid({ x: 204, y: 208 }, centerA, 0, 10);
  assert.ok(Math.abs(snapped0.x - 204) <= 3.5);
  assert.ok(Math.abs(snapped0.y - 208) <= 3.5);
});

test('insertBuildingVertex, removeBuildingVertex, and updateBuildingPolygon handle node editing', () => {
  const initialPoly = [
    { x: 100, y: 100 },
    { x: 150, y: 100 },
    { x: 150, y: 140 },
    { x: 100, y: 140 },
  ];

  const withInserted = insertBuildingVertex(initialPoly, 0);
  assert.equal(withInserted.length, 5);
  assert.deepEqual(withInserted[1], { x: 125, y: 100 });

  const withRemoved = removeBuildingVertex(withInserted, 1);
  assert.equal(withRemoved.length, 4);

  // Cannot delete below 3 vertices
  const threeVerts = [
    { x: 100, y: 100 },
    { x: 150, y: 100 },
    { x: 100, y: 140 },
  ];
  const cannotRemove = removeBuildingVertex(threeVerts, 0);
  assert.equal(cannotRemove.length, 3);
});

test('populateEssentialBuildings places oversized civic landmarks and keeps unclaimed NPC houses', () => {
  const capital = generateSettlementLayout({
    id: 's-cap',
    name: 'Valenreach',
    tier: 'capital',
    seed: 101,
    biome: 'coastline',
    isCoastal: true,
    mapAnchor: { x: 500, y: 380 },
  });

  const { buildings, addedIds } = populateEssentialBuildings(capital, true);
  assert.ok(addedIds.length >= 6);

  const palace = buildings.find((b) => b.assignedName === "The King's Palace");
  assert.ok(palace, 'capital should receive The King\'s Palace');
  assert.equal(palace.claimStatus, 'claimed');
  assert.equal(palace.mapLabel, 'Royal Palace');
  assert.ok(palace.widthFt >= 130 && palace.depthFt >= 90);
  assert.ok(palace.center.y < 380, 'palace should overlook north of the civic plaza');

  const unclaimedNpcHouses = buildings.filter((b) => b.claimStatus === 'unclaimed');
  assert.ok(unclaimedNpcHouses.length >= 30, 'non-overlapping unclaimed NPC houses remain intact');

  const avgNpcArea =
    unclaimedNpcHouses.reduce((s, b) => s + computeBuildingAreaSqFt(b), 0) /
    unclaimedNpcHouses.length;
  assert.ok(
    computeBuildingAreaSqFt(palace) > avgNpcArea * 3,
    'King\'s Palace must be dramatically larger than average NPC houses'
  );

  // Idempotent on second call
  const secondRun = populateEssentialBuildings({ ...capital, buildings }, true);
  assert.equal(secondRun.addedIds.length, 0);
});
