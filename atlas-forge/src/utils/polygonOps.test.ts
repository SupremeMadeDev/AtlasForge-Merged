import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findNonOverlappingRegionSpot,
  findSnapTarget,
  hasSelfIntersection,
  insertVertexOnEdge,
  moveVertex,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonsOverlap,
  removeVertex,
  resolveVertexMoveNoOverlap,
  simplifyPolygon,
} from './polygonOps';

test('polygonArea computes exact shoelace area for square and triangle', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  assert.equal(polygonArea(square), 100);

  const tri = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];
  assert.equal(polygonArea(tri), 50);
});

test('polygonCentroid and pointInPolygon behave accurately', () => {
  const rect = [
    { x: 10, y: 20 },
    { x: 50, y: 20 },
    { x: 50, y: 60 },
    { x: 10, y: 60 },
  ];
  const center = polygonCentroid(rect);
  assert.equal(center.x, 30);
  assert.equal(center.y, 40);
  assert.equal(pointInPolygon(center, rect), true);
  assert.equal(pointInPolygon({ x: 5, y: 5 }, rect), false);
});

test('insertVertexOnEdge, moveVertex, and removeVertex preserve minimum triangle', () => {
  const tri = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 100 },
  ];
  // Removing from triangle should keep 3 vertices
  assert.equal(removeVertex(tri, 0).length, 3);

  // Inserting adds midpoint vertex
  const quad = insertVertexOnEdge(tri, 0);
  assert.equal(quad.length, 4);
  assert.deepEqual(quad[1], { x: 50, y: 0 });

  // Moving clamps to bounds
  const moved = moveVertex(quad, 1, { x: 2000, y: -10 });
  assert.equal(moved[1].x, 1180);
  assert.equal(moved[1].y, 20);

  // Removing from quad returns 3 vertices
  assert.equal(removeVertex(moved, 1).length, 3);
});

test('simplifyPolygon removes near-collinear nodes and respects minVertices', () => {
  const denseSquare = [
    { x: 0, y: 0 },
    { x: 50, y: 1 },
    { x: 100, y: 0 },
    { x: 101, y: 50 },
    { x: 100, y: 100 },
    { x: 50, y: 99 },
    { x: 0, y: 100 },
    { x: 1, y: 50 },
  ];
  const simplified = simplifyPolygon(denseSquare, 5, 4);
  assert.equal(simplified.length, 4);
  assert.deepEqual(simplified, [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]);

  // Should never reduce below minVertices
  const minKept = simplifyPolygon(denseSquare, 200, 5);
  assert.equal(minKept.length, 5);
});

test('findSnapTarget snaps to vertex first, then edge, else none', () => {
  const neighbor = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ];

  // Near vertex (100, 100)
  const vertexSnap = findSnapTarget({ x: 106, y: 94 }, [neighbor], 15, 11);
  assert.equal(vertexSnap.kind, 'vertex');
  assert.deepEqual(vertexSnap.point, { x: 100, y: 100 });

  // Near top edge (150, 100) -> node-to-line snap
  const edgeSnap = findSnapTarget({ x: 150, y: 107 }, [neighbor], 15, 12);
  assert.equal(edgeSnap.kind, 'edge');
  assert.deepEqual(edgeSnap.point, { x: 150, y: 100 });
  assert.ok(edgeSnap.edgeSegment);

  // Along edge near corner (113, 102) -> closer to line (2px) than corner (13.2px) => node-to-line snap
  const lineNearCorner = findSnapTarget({ x: 113, y: 102 }, [neighbor], 16, 12);
  assert.equal(lineNearCorner.kind, 'edge');
  assert.deepEqual(lineNearCorner.point, { x: 113, y: 100 });

  // Far away -> none
  const noSnap = findSnapTarget({ x: 50, y: 50 }, [neighbor], 15, 12);
  assert.equal(noSnap.kind, 'none');
  assert.deepEqual(noSnap.point, { x: 50, y: 50 });
});

test('polygonsOverlap allows shared edges/vertices but detects interior overlaps', () => {
  const left = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ];
  const touchingRight = [
    { x: 200, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 200 },
    { x: 200, y: 200 },
  ];
  const overlappingRight = [
    { x: 180, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 200 },
    { x: 180, y: 200 },
  ];

  assert.equal(polygonsOverlap(left, touchingRight), false);
  assert.equal(polygonsOverlap(left, overlappingRight), true);
  assert.equal(polygonsOverlap(left, left), true);
  assert.equal(hasSelfIntersection(left), false);

  const bowtie = [
    { x: 100, y: 100 },
    { x: 200, y: 200 },
    { x: 200, y: 100 },
    { x: 100, y: 200 },
  ];
  assert.equal(hasSelfIntersection(bowtie), true);
});

test('resolveVertexMoveNoOverlap stops vertex cleanly before entering neighbor polygon', () => {
  const left = [
    { x: 100, y: 100 },
    { x: 180, y: 100 },
    { x: 180, y: 200 },
    { x: 100, y: 200 },
  ];
  const right = [
    { x: 220, y: 100 },
    { x: 320, y: 100 },
    { x: 320, y: 200 },
    { x: 220, y: 200 },
  ];
  const regions = [
    { id: 'left', polygon: left },
    { id: 'right', polygon: right },
  ];

  // Attempt to drag top-right corner of left (180,100) deep into right (260, 140)
  const resolved = resolveVertexMoveNoOverlap({
    regions,
    draggedRegionId: 'left',
    vertexIndex: 1,
    sharedLinks: [],
    currentPt: { x: 180, y: 100 },
    targetPt: { x: 260, y: 140 },
  });

  const movedLeft = moveVertex(left, 1, resolved);
  assert.equal(polygonsOverlap(movedLeft, right), false);
  assert.ok(resolved.x <= 220.2, `expected x <= 220.2, got ${resolved.x}`);
});

test('findNonOverlappingRegionSpot finds a clear non-overlapping placement', () => {
  const existing = [
    [
      { x: 400, y: 300 },
      { x: 800, y: 300 },
      { x: 800, y: 550 },
      { x: 400, y: 550 },
    ],
  ];
  const spot = findNonOverlappingRegionSpot(existing, 1200, 820, 1);
  assert.equal(polygonsOverlap(spot.polygon, existing[0]), false);
});

