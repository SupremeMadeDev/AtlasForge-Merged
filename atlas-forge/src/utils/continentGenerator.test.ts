import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateContinentRegions,
  getRegionColorSpec,
} from './continentGenerator';
import { hasSelfIntersection, polygonArea, polygonsOverlap } from './polygonOps';

test('generateContinentRegions creates deterministic simplified non-overlapping region polygons', () => {
  const config = {
    name: 'Aethelgard',
    seed: 4219,
    regionCount: 10,
    coastlineJaggedness: 0.65,
    borderIrregularity: 0.7,
  };

  const regionsA = generateContinentRegions(config);
  const regionsB = generateContinentRegions(config);

  assert.equal(regionsA.length, 10);
  assert.equal(regionsA.length, regionsB.length);

  for (let i = 0; i < regionsA.length; i++) {
    const rA = regionsA[i];
    const rB = regionsB[i];
    assert.equal(rA.name, rB.name);
    assert.equal(rA.biome, rB.biome);
    assert.ok(rA.polygon.length >= 4, 'region polygon should have >= 4 vertices');
    assert.ok(
      rA.polygon.length <= 13,
      `expected simplified polygon <= 13 vertices, got ${rA.polygon.length} for ${rA.name}`
    );
    assert.equal(hasSelfIntersection(rA.polygon), false, `${rA.name} should not self-intersect`);
    assert.ok(polygonArea(rA.polygon) > 500, 'region area should be substantial');
    assert.ok(rA.settlement.buildings.length >= 10, 'region should have a generated settlement');
  }

  for (const seed of [4219, 1001, 8374, 9999]) {
    for (const shape of ['auto', 'crescent', 'peninsula', 'isthmus', 'sprawling'] as const) {
      const generated = generateContinentRegions({
        name: 'Testia',
        seed,
        regionCount: 10,
        coastlineJaggedness: 0.7,
        borderIrregularity: 0.8,
        shape,
      });
      assert.ok(generated.length >= 9, `Seed ${seed} (${shape}) should generate regions`);
      for (let i = 0; i < generated.length; i++) {
        assert.equal(
          hasSelfIntersection(generated[i].polygon),
          false,
          `Seed ${seed} (${shape}): ${generated[i].name} self-intersects`
        );
        assert.ok(
          generated[i].polygon.length <= 15,
          `Seed ${seed} (${shape}): ${generated[i].name} has ${generated[i].polygon.length} nodes`
        );
        for (let j = i + 1; j < generated.length; j++) {
          assert.equal(
            polygonsOverlap(generated[i].polygon, generated[j].polygon),
            false,
            `Seed ${seed} (${shape}): ${generated[i].name} and ${generated[j].name} must not overlap`
          );
        }
      }
    }
  }
});

test('getRegionColorSpec respects color modes and customColor overrides', () => {
  const [region] = generateContinentRegions({
    name: 'Valenmere',
    seed: 1001,
    regionCount: 6,
    coastlineJaggedness: 0.5,
    borderIrregularity: 0.5,
  });

  const biomeSpec = getRegionColorSpec(region, 'biome');
  const factionSpec = getRegionColorSpec(region, 'faction');
  const threatSpec = getRegionColorSpec(region, 'threat');

  assert.ok(biomeSpec.fill.startsWith('#'));
  assert.ok(factionSpec.legendLabel.length > 0);
  assert.ok(threatSpec.legendLabel.includes('Tier'));

  const overridden = { ...region, customColor: '#123456' };
  assert.equal(getRegionColorSpec(overridden, 'biome').fill, '#123456');
});

