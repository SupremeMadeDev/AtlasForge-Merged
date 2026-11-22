import {
  DoorKind,
  Doorway,
  FloorMaterial,
  LayoutArchetype,
  LayoutComplexity,
  LightingLevel,
  MapDocument,
  MapFloor,
  Point,
  ProceduralLayoutOptions,
  Room,
  RoomType,
  SecretPassage,
  StairLink,
} from '../types/map';
import {
  detectDoorPassageOverlaps,
  findClosestRoomEdge,
  findTouchingOppositeWall,
  getAutoPairKey,
  getPointAlongRoomEdge,
  getPolygonBoundingBox,
  isWallEdgeExterior,
  minDistToBoundary,
  pointInPolygon,
  pointToSegmentDistance,
  reconcileDoorways,
  resolveSecretPassagePolyline,
  sampleRoomPolygon,
} from './geometry';

interface GridRect {
  gx: number;
  gy: number;
  gw: number;
  gh: number;
}

interface RoomFlavor {
  name: string;
  type: RoomType;
  material: FloorMaterial;
  lighting: LightingLevel;
  notes: string;
}

type SimpleTopology = 'linear-h' | 'linear-v' | 'l-wing' | 'u-wing' | 'central-commons';
type StandardTopology =
  | 'bilateral-wings'
  | 'l-wing'
  | 'u-courtyard'
  | 'o-ring'
  | 'cruciform-nave'
  | 'radial-spire'
  | 'staggered-compound';
type LabyrinthTopology =
  | 'grand-ring-cross'
  | 'figure-eight-loops'
  | 'cloister-bypass'
  | 'o-ring'
  | 'skewed-warren-ring';

type PlanPattern =
  | 'bilateral-manor'
  | 'courtyard-u'
  | 'compact-l'
  | 'compact-block';

interface ArchetypeStructureProfile {
  simpleWeights: Array<[SimpleTopology, number]>;
  standardWeights: Array<[StandardTopology, number]>;
  labyrinthWeights: Array<[LabyrinthTopology, number]>;
  balconyChanceGround: number;
  balconyChanceUpper: number;
  balconyFlavors: Array<{ name: string; material: FloorMaterial; notes: string }>;
  courtyardChance: number;
  courtyardFlavor: { name: string; material: FloorMaterial; notes: string };
  curves: {
    baseChance: number;
    drumTowerChance: number;
    apseChance: number;
    concaveChance: number;
    preferOutward: boolean;
  };
  diagonals: {
    pairTiltChance: number;
    acuteProwChance: number;
    wedgeSkewChance: number;
    obtuseChamferChance: number;
    bayChance: number;
  };
  bizarreDims: Array<[number, number]>;
}

const ARCHETYPE_STRUCTURE_PROFILES: Record<LayoutArchetype, ArchetypeStructureProfile> = {
  manor: {
    simpleWeights: [
      ['linear-h', 0.34],
      ['l-wing', 0.32],
      ['u-wing', 0.18],
      ['linear-v', 0.16],
    ],
    standardWeights: [
      ['bilateral-wings', 0.24],
      ['u-courtyard', 0.26],
      ['l-wing', 0.16],
      ['o-ring', 0.14],
      ['staggered-compound', 0.12],
      ['cruciform-nave', 0.08],
    ],
    labyrinthWeights: [
      ['cloister-bypass', 0.32],
      ['grand-ring-cross', 0.28],
      ['o-ring', 0.22],
      ['figure-eight-loops', 0.18],
    ],
    balconyChanceGround: 0.55,
    balconyChanceUpper: 0.92,
    balconyFlavors: [
      {
        name: 'Veranda Balcony',
        material: 'wood',
        notes: 'Carved stone balustrades overlook trimmed hedges and moonlit estate grounds.',
      },
      {
        name: 'Garden Terrace',
        material: 'marble',
        notes: 'Flagstone terrace bordered by urn planters and twin French doors.',
      },
      {
        name: 'Juliet Balcony',
        material: 'marble',
        notes: 'Cantilevered semicircular marble overlook with wrought-iron railings.',
      },
    ],
    courtyardChance: 0.8,
    courtyardFlavor: {
      name: 'Conservatory Court',
      material: 'earth',
      notes: 'Manicured night-blooming hedges frame a central marble fountain.',
    },
    curves: {
      baseChance: 0.46,
      drumTowerChance: 0.55,
      apseChance: 0.5,
      concaveChance: 0.22,
      preferOutward: true,
    },
    diagonals: {
      pairTiltChance: 0.25,
      acuteProwChance: 0.18,
      wedgeSkewChance: 0.14,
      obtuseChamferChance: 0.52,
      bayChance: 0.52,
    },
    bizarreDims: [
      [4, 4],
      [3, 5],
      [5, 3],
      [2, 5],
      [5, 2],
      [3, 4],
      [4, 3],
      [2, 3],
    ],
  },
  fortress: {
    simpleWeights: [
      ['central-commons', 0.32],
      ['l-wing', 0.26],
      ['u-wing', 0.22],
      ['linear-h', 0.2],
    ],
    standardWeights: [
      ['u-courtyard', 0.26],
      ['o-ring', 0.24],
      ['cruciform-nave', 0.22],
      ['bilateral-wings', 0.16],
      ['l-wing', 0.12],
    ],
    labyrinthWeights: [
      ['grand-ring-cross', 0.34],
      ['o-ring', 0.28],
      ['cloister-bypass', 0.22],
      ['skewed-warren-ring', 0.16],
    ],
    balconyChanceGround: 0.45,
    balconyChanceUpper: 0.82,
    balconyFlavors: [
      {
        name: 'Parapet Walk',
        material: 'stone',
        notes: 'Crenellated wall-walk with arrow loops and brazier iron baskets.',
      },
      {
        name: 'Battlement Overlook',
        material: 'cobble',
        notes: 'Projecting bartizan platform commanding approaches below.',
      },
    ],
    courtyardChance: 0.78,
    courtyardFlavor: {
      name: 'Inner Bailey',
      material: 'cobble',
      notes: 'Training yard packed with archery targets, sparring dummies, and a stone well.',
    },
    curves: {
      baseChance: 0.16,
      drumTowerChance: 0.6,
      apseChance: 0.1,
      concaveChance: 0.05,
      preferOutward: true,
    },
    diagonals: {
      pairTiltChance: 0.22,
      acuteProwChance: 0.64,
      wedgeSkewChance: 0.32,
      obtuseChamferChance: 0.58,
      bayChance: 0.24,
    },
    bizarreDims: [
      [4, 4],
      [3, 4],
      [4, 3],
      [2, 6],
      [6, 2],
      [3, 3],
      [2, 4],
    ],
  },
  crypt: {
    simpleWeights: [
      ['l-wing', 0.36],
      ['linear-v', 0.26],
      ['central-commons', 0.2],
      ['u-wing', 0.18],
    ],
    standardWeights: [
      ['staggered-compound', 0.28],
      ['cruciform-nave', 0.24],
      ['l-wing', 0.2],
      ['o-ring', 0.16],
      ['radial-spire', 0.12],
    ],
    labyrinthWeights: [
      ['skewed-warren-ring', 0.34],
      ['figure-eight-loops', 0.26],
      ['o-ring', 0.22],
      ['grand-ring-cross', 0.18],
    ],
    balconyChanceGround: 0,
    balconyChanceUpper: 0,
    balconyFlavors: [],
    courtyardChance: 0.15,
    courtyardFlavor: {
      name: 'Sunken Ossuary Pit',
      material: 'stone',
      notes: 'Open pit lined with bone alcoves descending into cold mist.',
    },
    curves: {
      baseChance: 0.44,
      drumTowerChance: 0.45,
      apseChance: 0.62,
      concaveChance: 0.48,
      preferOutward: false,
    },
    diagonals: {
      pairTiltChance: 0.56,
      acuteProwChance: 0.32,
      wedgeSkewChance: 0.46,
      obtuseChamferChance: 0.34,
      bayChance: 0.2,
    },
    bizarreDims: [
      [2, 6],
      [6, 2],
      [2, 5],
      [5, 2],
      [3, 3],
      [2, 3],
      [3, 2],
      [4, 2],
    ],
  },
  tavern: {
    simpleWeights: [
      ['central-commons', 0.36],
      ['l-wing', 0.28],
      ['u-wing', 0.2],
      ['linear-h', 0.16],
    ],
    standardWeights: [
      ['staggered-compound', 0.28],
      ['u-courtyard', 0.26],
      ['l-wing', 0.22],
      ['o-ring', 0.12],
      ['radial-spire', 0.12],
    ],
    labyrinthWeights: [
      ['skewed-warren-ring', 0.36],
      ['figure-eight-loops', 0.26],
      ['o-ring', 0.2],
      ['cloister-bypass', 0.18],
    ],
    balconyChanceGround: 0.58,
    balconyChanceUpper: 0.88,
    balconyFlavors: [
      {
        name: 'Timber Veranda',
        material: 'wood',
        notes: 'Creaking pine deck strung with paper lanterns and ale-stained rail benches.',
      },
      {
        name: 'Upper Loft Balcony',
        material: 'wood',
        notes: 'Rail-lined wooden deck looking down over the street cobbles.',
      },
    ],
    courtyardChance: 0.62,
    courtyardFlavor: {
      name: 'Beer & Stable Yard',
      material: 'earth',
      notes: 'Cobble-edged yard with hitching posts, stacked empty casks, and outdoor benches.',
    },
    curves: {
      baseChance: 0.34,
      drumTowerChance: 0.35,
      apseChance: 0.3,
      concaveChance: 0.32,
      preferOutward: true,
    },
    diagonals: {
      pairTiltChance: 0.42,
      acuteProwChance: 0.22,
      wedgeSkewChance: 0.38,
      obtuseChamferChance: 0.34,
      bayChance: 0.36,
    },
    bizarreDims: [
      [4, 3],
      [3, 4],
      [3, 3],
      [2, 4],
      [4, 2],
      [2, 3],
      [3, 5],
    ],
  },
  temple: {
    simpleWeights: [
      ['linear-v', 0.38],
      ['central-commons', 0.24],
      ['u-wing', 0.22],
      ['l-wing', 0.16],
    ],
    standardWeights: [
      ['cruciform-nave', 0.36],
      ['u-courtyard', 0.26],
      ['o-ring', 0.22],
      ['bilateral-wings', 0.16],
    ],
    labyrinthWeights: [
      ['cloister-bypass', 0.36],
      ['o-ring', 0.28],
      ['grand-ring-cross', 0.24],
      ['figure-eight-loops', 0.12],
    ],
    balconyChanceGround: 0.3,
    balconyChanceUpper: 0.8,
    balconyFlavors: [
      {
        name: 'Choir Balcony',
        material: 'marble',
        notes: 'Carved alabaster gallery overlooking the cloister garden and bell court.',
      },
      {
        name: 'Bell Overlook',
        material: 'stone',
        notes: 'Open stone terrace with brass chimes catching the wind.',
      },
    ],
    courtyardChance: 0.85,
    courtyardFlavor: {
      name: 'Cloister Garth',
      material: 'earth',
      notes: 'Quiet herb garden surrounding a sacred reflection font.',
    },
    curves: {
      baseChance: 0.56,
      drumTowerChance: 0.65,
      apseChance: 0.86,
      concaveChance: 0.28,
      preferOutward: true,
    },
    diagonals: {
      pairTiltChance: 0.16,
      acuteProwChance: 0.16,
      wedgeSkewChance: 0.12,
      obtuseChamferChance: 0.56,
      bayChance: 0.28,
    },
    bizarreDims: [
      [3, 6],
      [6, 3],
      [4, 4],
      [3, 4],
      [4, 3],
      [2, 5],
      [5, 2],
    ],
  },
  blacksmith: {
    simpleWeights: [
      ['central-commons', 0.36],
      ['l-wing', 0.3],
      ['u-wing', 0.2],
      ['linear-h', 0.14],
    ],
    standardWeights: [
      ['u-courtyard', 0.3],
      ['staggered-compound', 0.28],
      ['l-wing', 0.24],
      ['o-ring', 0.18],
    ],
    labyrinthWeights: [
      ['skewed-warren-ring', 0.34],
      ['o-ring', 0.26],
      ['figure-eight-loops', 0.22],
      ['cloister-bypass', 0.18],
    ],
    balconyChanceGround: 0.28,
    balconyChanceUpper: 0.72,
    balconyFlavors: [
      {
        name: 'Loft Loading Deck',
        material: 'wood',
        notes: 'Timber hoist platform jutting above the smithy yard for hauling coal sacks.',
      },
      {
        name: 'Smokestack Catwalk',
        material: 'cobble',
        notes: 'Soot-stained iron-railed walkway beside the main chimney flues.',
      },
    ],
    courtyardChance: 0.76,
    courtyardFlavor: {
      name: 'Shoeing & Slag Yard',
      material: 'cobble',
      notes: 'Open cobbled workyard with hitching posts, grindstones, and cooling anvil blocks.',
    },
    curves: {
      baseChance: 0.28,
      drumTowerChance: 0.56,
      apseChance: 0.42,
      concaveChance: 0.16,
      preferOutward: true,
    },
    diagonals: {
      pairTiltChance: 0.38,
      acuteProwChance: 0.22,
      wedgeSkewChance: 0.34,
      obtuseChamferChance: 0.52,
      bayChance: 0.36,
    },
    bizarreDims: [
      [3, 4],
      [4, 3],
      [4, 4],
      [2, 5],
      [5, 2],
      [3, 5],
      [5, 3],
    ],
  },
  guildhall: {
    simpleWeights: [
      ['l-wing', 0.36],
      ['u-wing', 0.24],
      ['linear-h', 0.24],
      ['central-commons', 0.16],
    ],
    standardWeights: [
      ['staggered-compound', 0.28],
      ['l-wing', 0.24],
      ['u-courtyard', 0.24],
      ['o-ring', 0.14],
      ['bilateral-wings', 0.1],
    ],
    labyrinthWeights: [
      ['figure-eight-loops', 0.32],
      ['o-ring', 0.26],
      ['skewed-warren-ring', 0.24],
      ['grand-ring-cross', 0.18],
    ],
    balconyChanceGround: 0.42,
    balconyChanceUpper: 0.78,
    balconyFlavors: [
      {
        name: 'Syndicate Balcony',
        material: 'wood',
        notes: 'Private upper lookout where guild officers survey cargo carts below.',
      },
      {
        name: 'Harbor Veranda',
        material: 'stone',
        notes: 'Timber-rail terrace above the rear loading dock.',
      },
    ],
    courtyardChance: 0.68,
    courtyardFlavor: {
      name: 'Cargo Courtyard',
      material: 'cobble',
      notes: 'Walled loading court with hoist cranes and tarped merchant wagons.',
    },
    curves: {
      baseChance: 0.32,
      drumTowerChance: 0.48,
      apseChance: 0.3,
      concaveChance: 0.2,
      preferOutward: true,
    },
    diagonals: {
      pairTiltChance: 0.62,
      acuteProwChance: 0.26,
      wedgeSkewChance: 0.42,
      obtuseChamferChance: 0.44,
      bayChance: 0.38,
    },
    bizarreDims: [
      [4, 3],
      [3, 4],
      [2, 5],
      [5, 2],
      [3, 5],
      [5, 3],
      [3, 3],
    ],
  },
  jail: {
    simpleWeights: [
      ['linear-h', 0.36],
      ['u-wing', 0.24],
      ['linear-v', 0.24],
      ['l-wing', 0.16],
    ],
    standardWeights: [
      ['o-ring', 0.28],
      ['radial-spire', 0.26],
      ['u-courtyard', 0.24],
      ['bilateral-wings', 0.22],
    ],
    labyrinthWeights: [
      ['grand-ring-cross', 0.38],
      ['o-ring', 0.3],
      ['figure-eight-loops', 0.2],
      ['cloister-bypass', 0.12],
    ],
    balconyChanceGround: 0.25,
    balconyChanceUpper: 0.72,
    balconyFlavors: [
      {
        name: 'Guard Catwalk',
        material: 'stone',
        notes: 'Iron-railed exterior watch gallery overlooking the prison perimeter.',
      },
      {
        name: 'Watch Parapet',
        material: 'cobble',
        notes: 'Narrow elevated post with hanging search lanterns and bell pull.',
      },
    ],
    courtyardChance: 0.72,
    courtyardFlavor: {
      name: 'Exercise Yard',
      material: 'earth',
      notes: 'Iron-fenced gravel yard watched by barred slit windows.',
    },
    curves: {
      baseChance: 0.24,
      drumTowerChance: 0.78,
      apseChance: 0.15,
      concaveChance: 0.1,
      preferOutward: true,
    },
    diagonals: {
      pairTiltChance: 0.34,
      acuteProwChance: 0.44,
      wedgeSkewChance: 0.4,
      obtuseChamferChance: 0.48,
      bayChance: 0.18,
    },
    bizarreDims: [
      [2, 6],
      [6, 2],
      [2, 4],
      [4, 2],
      [3, 3],
      [4, 4],
      [3, 4],
    ],
  },
};

const ARCHETYPE_FLAVORS: Record<LayoutArchetype, RoomFlavor[]> = {
  manor: [
    {
      name: 'Grand Salon',
      type: 'room',
      material: 'carpet',
      lighting: 'bright',
      notes: 'Velvet drapes frame tall arched windows; a gilded harpsichord rests in the corner.',
    },
    {
      name: 'Dining Parlor',
      type: 'room',
      material: 'wood',
      lighting: 'dim',
      notes: 'Long banquet table set with tarnished silver. A hearth still holds warm embers.',
    },
    {
      name: 'Arcane Library',
      type: 'room',
      material: 'wood',
      lighting: 'dim',
      notes: 'Mahogany shelves packed with occult treatises; pulling the silver tome reveals a hidden latch.',
    },
    {
      name: 'Treasury Vault',
      type: 'room',
      material: 'marble',
      lighting: 'darkness',
      notes: 'Reinforced iron-banded chests rest atop velvet dais pads; DC 15 Investigation spots a needle ward.',
    },
    {
      name: 'Kitchen & Pantry',
      type: 'room',
      material: 'checkered',
      lighting: 'bright',
      notes: 'Suspended copper pots hang above a wide stone hearth and salted provision barrels.',
    },
    {
      name: 'Servants Quarters',
      type: 'room',
      material: 'wood',
      lighting: 'dim',
      notes: 'Simple straw mattresses and cedar chests smelling of lavender soap and tallow.',
    },
    {
      name: 'Master Bedchamber',
      type: 'room',
      material: 'marble',
      lighting: 'dim',
      notes: 'Canopy bed draped in moth-eaten silk; jewelry box locked (DC 14 Thieves’ Tools).',
    },
    {
      name: 'Conservatory',
      type: 'courtyard',
      material: 'earth',
      lighting: 'bright',
      notes: 'Overgrown night-blooming vines creep along mossy stone planters.',
    },
    {
      name: 'Hidden Sanctum',
      type: 'secret',
      material: 'arcane',
      lighting: 'darkness',
      notes: 'Concealed ritual chamber with chalk astrolabe etched into slate.',
    },
  ],
  fortress: [
    {
      name: 'Guard Barracks',
      type: 'room',
      material: 'stone',
      lighting: 'dim',
      notes: 'Rows of iron bunks, weapon racks with halberds, and a half-played dragonchess board.',
    },
    {
      name: 'Armory',
      type: 'room',
      material: 'cobble',
      lighting: 'dim',
      notes: 'Oiled mail shirts, heavy crossbows, and bundled arrows stacked in iron-bound crates.',
    },
    {
      name: 'War Room',
      type: 'room',
      material: 'wood',
      lighting: 'bright',
      notes: 'Topographical map table pinned with wooden battalion markers and wax-sealed dispatches.',
    },
    {
      name: 'Torture Chamber',
      type: 'room',
      material: 'cobble',
      lighting: 'dim',
      notes: 'Cold iron wall shackles above a floor drain; glowing brazier lights rusted manacles and a confession ledger.',
    },
    {
      name: 'Treasury',
      type: 'room',
      material: 'marble',
      lighting: 'darkness',
      notes: 'Heavy steel coffer bolted to flagstones holding paymaster coin pouches and tax ledgers.',
    },
    {
      name: 'Mess Hall',
      type: 'room',
      material: 'stone',
      lighting: 'bright',
      notes: 'Long trestle benches scarred by boot spurs and spilled ale.',
    },
    {
      name: 'Commandant Study',
      type: 'room',
      material: 'carpet',
      lighting: 'bright',
      notes: 'Oak desk with signet ring and cipher key locked in the lower drawer.',
    },
    {
      name: 'Sapper Tunnel',
      type: 'secret',
      material: 'cobble',
      lighting: 'darkness',
      notes: 'Shored-up timber passage hidden behind a loose masonry block.',
    },
  ],
  crypt: [
    {
      name: 'Ossuary Hall',
      type: 'room',
      material: 'stone',
      lighting: 'darkness',
      notes: 'Stacked femurs and skulls fill recessed wall niches; cold drafts carry faint whispers.',
    },
    {
      name: 'Reliquary Vault',
      type: 'room',
      material: 'arcane',
      lighting: 'darkness',
      notes: 'Gilded reliquary urns rest on obsidian pedestals guarded by a glyph of warding.',
    },
    {
      name: 'Embalming Room',
      type: 'room',
      material: 'marble',
      lighting: 'dim',
      notes: 'Sloped alabaster slab surrounded by myrrh jars, linen wrappings, and brass hooks.',
    },
    {
      name: 'Torture Pit',
      type: 'room',
      material: 'cobble',
      lighting: 'darkness',
      notes: 'Rusted cages hang from chains over a sunken grate.',
    },
    {
      name: 'Chapel of Ash',
      type: 'room',
      material: 'checkered',
      lighting: 'dim',
      notes: 'Shattered stone pews face a blackened altar smeared with dried wax.',
    },
    {
      name: 'Flooded Cistern',
      type: 'room',
      material: 'water',
      lighting: 'darkness',
      notes: 'Ankle-deep stagnant water conceals submerged stepping stones and a rusted iron chest.',
    },
    {
      name: 'Sarcophagus Chamber',
      type: 'secret',
      material: 'arcane',
      lighting: 'darkness',
      notes: 'Sealed limestone tomb of the founding patriarch; faint necromantic aura lingers.',
    },
  ],
  tavern: [
    {
      name: 'Common Taproom',
      type: 'room',
      material: 'wood',
      lighting: 'bright',
      notes: 'Crackling hearth, six oak tables, and spilled mead beside a raised bard stage.',
    },
    {
      name: 'Kitchen & Cellar',
      type: 'room',
      material: 'checkered',
      lighting: 'bright',
      notes: 'Sizzling mutton spit, flour sacks, and stacked kegs of dwarven stout.',
    },
    {
      name: 'Private Booth',
      type: 'room',
      material: 'carpet',
      lighting: 'dim',
      notes: 'Heavy velvet curtain muffles whispered deals; dagger gouges mark the tabletop.',
    },
    {
      name: 'Innkeeper Office',
      type: 'room',
      material: 'wood',
      lighting: 'dim',
      notes: 'Ledger of debts, brass lockbox, and key ring hanging on a peg.',
    },
    {
      name: 'Guest Suite',
      type: 'room',
      material: 'wood',
      lighting: 'dim',
      notes: 'Feather mattress, washbasin, and shuttered window overlooking the stables.',
    },
    {
      name: 'Smuggler Cache',
      type: 'secret',
      material: 'cobble',
      lighting: 'darkness',
      notes: 'False wine rack conceals stolen merchant crates and an escape grate.',
    },
  ],
  temple: [
    {
      name: 'Sanctuary Nave',
      type: 'room',
      material: 'checkered',
      lighting: 'bright',
      notes: 'Carved alabaster pews face a gilded altar illuminated by tallow candelabras.',
    },
    {
      name: 'High Reliquary',
      type: 'room',
      material: 'marble',
      lighting: 'dim',
      notes: 'Glass-domed cases display gilded bones, silver censers, and sacred vestments.',
    },
    {
      name: 'Scriptorium',
      type: 'room',
      material: 'wood',
      lighting: 'bright',
      notes: 'Sloped copying desks littered with illuminated vellum scrolls and gold-leaf inkwells.',
    },
    {
      name: 'Cloister Garden',
      type: 'courtyard',
      material: 'earth',
      lighting: 'bright',
      notes: 'Fragrant medicinal herbs ring a quiet stone font fed by clear spring water.',
    },
    {
      name: 'Confessional Alcove',
      type: 'room',
      material: 'carpet',
      lighting: 'dim',
      notes: 'Latticework cedar screens divide kneeling benches; a loose tile hides a vow ledger.',
    },
    {
      name: 'Purification Bath',
      type: 'room',
      material: 'water',
      lighting: 'dim',
      notes: 'Steaming mineral basin ringed with mosaic serpents and brass braziers.',
    },
    {
      name: 'Inquisitor Vault',
      type: 'secret',
      material: 'arcane',
      lighting: 'darkness',
      notes: 'Warded chamber behind the apse tapestry holding confiscated heretical relics.',
    },
  ],
  blacksmith: [
    {
      name: 'Main Forge Hall',
      type: 'room',
      material: 'cobble',
      lighting: 'bright',
      notes: 'Roaring twin stone forges fed by leather bellows; heavy iron anvils ring beside tongs and hammers.',
    },
    {
      name: 'Quenching Basin',
      type: 'room',
      material: 'water',
      lighting: 'dim',
      notes: 'Steam rises from stone-lined brine and oil troughs used to temper glowing steel blades.',
    },
    {
      name: 'Bellows & Coal Store',
      type: 'room',
      material: 'stone',
      lighting: 'darkness',
      notes: 'Piled anthracite bins and creaking oak-ribbed bellows pumping drafts into the furnace.',
    },
    {
      name: 'Armory & Showroom',
      type: 'room',
      material: 'wood',
      lighting: 'bright',
      notes: 'Oiled racks of broadswords, lamellar breastplates, and finished horseshoes ready for trade.',
    },
    {
      name: 'Smelting Foundry',
      type: 'room',
      material: 'cobble',
      lighting: 'bright',
      notes: 'Brick crucible ovens, slag ladles, and iron ingot molds lined along soot-darkened walls.',
    },
    {
      name: 'Grindshop & Tinker Bench',
      type: 'room',
      material: 'checkered',
      lighting: 'bright',
      notes: 'Pedal-driven whetstones, brass calipers, rivets, and fine mail-linking workbenches.',
    },
    {
      name: "Smith's Quarters",
      type: 'room',
      material: 'wood',
      lighting: 'dim',
      notes: 'Warm bunk, iron-bound commission ledger, and strongbox tucked beneath a scarred chest.',
    },
    {
      name: 'Hidden Ingot Cache',
      type: 'secret',
      material: 'stone',
      lighting: 'darkness',
      notes: 'False chimney-back alcove (DC 15 Investigation) concealing mithral bars and guild stamps.',
    },
  ],
  guildhall: [
    {
      name: 'Counting House',
      type: 'room',
      material: 'wood',
      lighting: 'bright',
      notes: 'Iron teller cages, brass balance scales, and ciphered promissory notes.',
    },
    {
      name: 'Fence Parlor',
      type: 'room',
      material: 'carpet',
      lighting: 'dim',
      notes: 'Velvet-draped appraisal table cluttered with magnifying loupes and hot-stamped bullion.',
    },
    {
      name: 'Sparring Pit',
      type: 'room',
      material: 'cobble',
      lighting: 'bright',
      notes: 'Sunken sand ring circled by wagering chalkboards and wooden practice blades.',
    },
    {
      name: 'Guildmaster Lounge',
      type: 'room',
      material: 'marble',
      lighting: 'bright',
      notes: 'Mahogany humidor, city-watch bribe ledger, and concealed dagger beneath the armchair.',
    },
    {
      name: 'Lockbox Vault',
      type: 'room',
      material: 'stone',
      lighting: 'darkness',
      notes: 'Heavy steel vault door (DC 18 Thieves’ Tools) guarding guild reserves and blackmail dossiers.',
    },
    {
      name: 'Sewer Escape Dock',
      type: 'secret',
      material: 'water',
      lighting: 'darkness',
      notes: 'Moored flat-bottom skiff hidden behind a rotating wine cask.',
    },
  ],
  jail: [
    {
      name: 'Warden Office',
      type: 'room',
      material: 'wood',
      lighting: 'bright',
      notes: 'Iron key cabinet, prisoner intake manifests, and a heavy crossbow mounted behind the desk.',
    },
    {
      name: 'Cell Block A',
      type: 'room',
      material: 'stone',
      lighting: 'dim',
      notes: 'Row of barred iron cells with straw pallets, tin bowls, and scratched tally marks.',
    },
    {
      name: 'Cell Block B',
      type: 'room',
      material: 'cobble',
      lighting: 'darkness',
      notes: 'Solitary stone pens with heavy chain rings bolted into the floor.',
    },
    {
      name: 'Interrogation Room',
      type: 'room',
      material: 'checkered',
      lighting: 'dim',
      notes: 'Single iron chair bolted to the flagstones beneath a hooded lantern and brazier.',
    },
    {
      name: 'Guard Ready Room',
      type: 'room',
      material: 'stone',
      lighting: 'bright',
      notes: 'Quarterstaff rack, manacle hooks, and cold stew simmering over an iron stove.',
    },
    {
      name: 'Exercise Yard',
      type: 'courtyard',
      material: 'earth',
      lighting: 'bright',
      notes: 'High barbed-iron walls enclose gravel exercise ground and a stone pump.',
    },
    {
      name: 'Contraband Tunnel',
      type: 'secret',
      material: 'cobble',
      lighting: 'darkness',
      notes: 'Half-dug escape crawlspace concealed behind a loose flagstone slab.',
    },
  ],
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rectsOverlap(a: GridRect, b: GridRect): boolean {
  return (
    a.gx < b.gx + b.gw &&
    a.gx + a.gw > b.gx &&
    a.gy < b.gy + b.gh &&
    a.gy + a.gh > b.gy
  );
}

function rectsTouchEdgeLen(a: GridRect, b: GridRect): number {
  if (a.gx + a.gw === b.gx || b.gx + b.gw === a.gx) {
    return Math.min(a.gy + a.gh, b.gy + b.gh) - Math.max(a.gy, b.gy);
  }
  if (a.gy + a.gh === b.gy || b.gy + b.gh === a.gy) {
    return Math.min(a.gx + a.gw, b.gx + b.gw) - Math.max(a.gx, b.gx);
  }
  return 0;
}

function pickWeighted<T>(items: Array<[T, number]>): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [val, w] of items) {
    r -= w;
    if (r <= 0) return val;
  }
  return items[items.length - 1][0];
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function choosePattern(
  archetype: LayoutArchetype,
  complexity: LayoutComplexity
): PlanPattern {
  const roll = Math.random();
  if (complexity === 'simple') {
    if (archetype === 'manor' || archetype === 'temple') {
      return roll < 0.62 ? 'compact-block' : 'compact-l';
    }
    return roll < 0.68 ? 'compact-block' : 'compact-l';
  }
  if (complexity === 'labyrinthine') {
    if (archetype === 'manor' || archetype === 'temple' || archetype === 'guildhall') {
      if (roll < 0.44) return 'courtyard-u';
      if (roll < 0.82) return 'bilateral-manor';
      return 'compact-l';
    }
    if (roll < 0.36) return 'courtyard-u';
    if (roll < 0.7) return 'bilateral-manor';
    return 'compact-l';
  }
  if (archetype === 'manor' || archetype === 'temple' || archetype === 'guildhall') {
    if (roll < 0.45) return 'bilateral-manor';
    if (roll < 0.78) return 'courtyard-u';
    return 'compact-l';
  }
  if (archetype === 'blacksmith' || archetype === 'fortress') {
    if (roll < 0.38) return 'courtyard-u';
    if (roll < 0.72) return 'bilateral-manor';
    return 'compact-l';
  }
  if (roll < 0.28) return 'bilateral-manor';
  if (roll < 0.56) return 'compact-block';
  if (roll < 0.84) return 'compact-l';
  return 'courtyard-u';
}

/**
 * Splits a horizontal strip into `count` flush, contiguous rooms of minimum width `minW`
 * with slight natural size variations.
 */
function splitStripHorizontally(
  rect: GridRect,
  count: number,
  minW = 3,
  symmetricMirror = false
): GridRect[] {
  if (count <= 1 || rect.gw < minW * 2) return [rect];
  const maxSplits = Math.floor(rect.gw / minW);
  const k = Math.max(1, Math.min(count, maxSplits));
  if (k === 1) return [rect];

  const widths: number[] = new Array(k).fill(minW);
  let remaining = rect.gw - k * minW;

  if (symmetricMirror && k >= 2) {
    let i = 0;
    let j = k - 1;
    while (remaining > 0 && i <= j) {
      if (i === j) {
        widths[i] += remaining;
        remaining = 0;
      } else if (remaining >= 2) {
        const give = randInt(1, Math.floor(remaining / 2));
        widths[i] += give;
        widths[j] += give;
        remaining -= give * 2;
      } else {
        widths[Math.floor(k / 2)] += remaining;
        remaining = 0;
      }
      i++;
      j--;
    }
  } else {
    while (remaining > 0) {
      const idx = randInt(0, k - 1);
      widths[idx]++;
      remaining--;
    }
  }

  const out: GridRect[] = [];
  let cx = rect.gx;
  for (const w of widths) {
    out.push({ gx: cx, gy: rect.gy, gw: w, gh: rect.gh });
    cx += w;
  }
  return out;
}

/**
 * Splits a vertical strip into `count` flush, contiguous rooms of minimum height `minH`.
 */
function splitStripVertically(rect: GridRect, count: number, minH = 3): GridRect[] {
  if (count <= 1 || rect.gh < minH * 2) return [rect];
  const maxSplits = Math.floor(rect.gh / minH);
  const k = Math.max(1, Math.min(count, maxSplits));
  if (k === 1) return [rect];

  const heights: number[] = new Array(k).fill(minH);
  let remaining = rect.gh - k * minH;
  while (remaining > 0) {
    heights[randInt(0, k - 1)]++;
    remaining--;
  }

  const out: GridRect[] = [];
  let cy = rect.gy;
  for (const h of heights) {
    out.push({ gx: rect.gx, gy: cy, gw: rect.gw, gh: h });
    cy += h;
  }
  return out;
}

/**
 * Carves out any occupied fixed rectangles (like foyer or stairwell shafts) from a zone
 * cleanly into rectangular sub-bays, avoiding overlaps while staying 100% flush.
 */
function subtractRectFromStripHorizontal(
  strip: GridRect,
  blocker: GridRect
): GridRect[] {
  if (!rectsOverlap(strip, blocker)) return [strip];
  const res: GridRect[] = [];
  if (blocker.gx > strip.gx) {
    res.push({
      gx: strip.gx,
      gy: strip.gy,
      gw: blocker.gx - strip.gx,
      gh: strip.gh,
    });
  }
  const blockerEnd = blocker.gx + blocker.gw;
  const stripEnd = strip.gx + strip.gw;
  if (blockerEnd < stripEnd) {
    res.push({
      gx: blockerEnd,
      gy: strip.gy,
      gw: stripEnd - blockerEnd,
      gh: strip.gh,
    });
  }
  return res.filter((r) => r.gw >= 2 && r.gh >= 2);
}

interface PlacedChamber {
  rect: GridRect;
  subRects?: GridRect[];
  isHallway: boolean;
  stairRole?: 'up' | 'down';
  flavor: RoomFlavor;
  customPoints?: Point[];
  isFoyer?: boolean;
  isBalcony?: boolean;
  isSignatureWing?: boolean;
  zone?: 'north' | 'south' | 'wing' | 'flank-left' | 'flank-right' | 'other';
  tiltedCorners?: Set<number>;
}

function chamberSubRects(p: Pick<PlacedChamber, 'rect' | 'subRects'>): GridRect[] {
  return p.subRects && p.subRects.length > 0 ? p.subRects : [p.rect];
}

function chamberOverlapsRect(p: Pick<PlacedChamber, 'rect' | 'subRects'>, r: GridRect): boolean {
  return chamberSubRects(p).some((sr) => rectsOverlap(sr, r));
}

function chamberTouchEdgeLen(
  a: Pick<PlacedChamber, 'rect' | 'subRects'>,
  b: GridRect | Pick<PlacedChamber, 'rect' | 'subRects'>
): number {
  const bRects = 'rect' in b ? chamberSubRects(b) : [b];
  let best = 0;
  for (const srA of chamberSubRects(a)) {
    for (const srB of bRects) {
      best = Math.max(best, rectsTouchEdgeLen(srA, srB));
    }
  }
  return best;
}

function boundingGridRect(rects: GridRect[]): GridRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.gx);
    minY = Math.min(minY, r.gy);
    maxX = Math.max(maxX, r.gx + r.gw);
    maxY = Math.max(maxY, r.gy + r.gh);
  }
  return { gx: minX, gy: minY, gw: Math.max(1, maxX - minX), gh: Math.max(1, maxY - minY) };
}

function gridRectsToClockwisePolygon(subRects: GridRect[], cellSize: number): Point[] {
  const occupied = new Set<string>();
  for (const r of subRects) {
    for (let x = r.gx; x < r.gx + r.gw; x++) {
      for (let y = r.gy; y < r.gy + r.gh; y++) {
        occupied.add(`${x},${y}`);
      }
    }
  }
  if (occupied.size === 0) return [];

  interface HalfEdge {
    fx: number;
    fy: number;
    tx: number;
    ty: number;
    dir: number; // 0:E, 1:S, 2:W, 3:N
    used: boolean;
  }

  const edges: HalfEdge[] = [];
  const outgoing = new Map<string, HalfEdge[]>();
  const addEdge = (fx: number, fy: number, tx: number, ty: number, dir: number) => {
    const e: HalfEdge = { fx, fy, tx, ty, dir, used: false };
    edges.push(e);
    const k = `${fx},${fy}`;
    const arr = outgoing.get(k);
    if (arr) arr.push(e);
    else outgoing.set(k, [e]);
  };

  for (const key of occupied) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    if (!occupied.has(`${x},${y - 1}`)) addEdge(x, y, x + 1, y, 0);
    if (!occupied.has(`${x + 1},${y}`)) addEdge(x + 1, y, x + 1, y + 1, 1);
    if (!occupied.has(`${x},${y + 1}`)) addEdge(x + 1, y + 1, x, y + 1, 2);
    if (!occupied.has(`${x - 1},${y}`)) addEdge(x, y + 1, x, y, 3);
  }

  if (edges.length === 0) return [];
  // Pick outer top-leftmost East-going edge
  let startEdge = edges[0];
  for (const e of edges) {
    if (
      e.fy < startEdge.fy ||
      (e.fy === startEdge.fy && e.fx < startEdge.fx)
    ) {
      startEdge = e;
    }
  }

  const rawPts: Array<{ x: number; y: number }> = [];
  let curr: HalfEdge | undefined = startEdge;
  let guard = 0;
  while (curr && !curr.used && guard <= edges.length + 2) {
    guard++;
    curr.used = true;
    rawPts.push({ x: curr.fx, y: curr.fy });
    const nextCandidates: HalfEdge[] = (outgoing.get(`${curr.tx},${curr.ty}`) ?? []).filter((c) => !c.used);
    if (nextCandidates.length === 0) break;
    // Prefer clockwise right turn > straight > left turn > reverse
    const prefOrder = [(curr.dir + 1) % 4, curr.dir, (curr.dir + 3) % 4, (curr.dir + 2) % 4];
    let picked: HalfEdge | undefined;
    for (const d of prefOrder) {
      picked = nextCandidates.find((c) => c.dir === d);
      if (picked) break;
    }
    curr = picked ?? nextCandidates[0];
    if (curr === startEdge) break;
  }

  // Strip collinear vertices
  const simplified: Point[] = [];
  const n = rawPts.length;
  for (let i = 0; i < n; i++) {
    const prev = rawPts[(i - 1 + n) % n];
    const p = rawPts[i];
    const next = rawPts[(i + 1) % n];
    const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x);
    if (cross !== 0) {
      simplified.push({ x: p.x * cellSize, y: p.y * cellSize });
    }
  }
  return simplified;
}

function buildHallwayChamber(
  subRects: GridRect[],
  flavor: RoomFlavor,
  zone?: PlacedChamber['zone']
): PlacedChamber {
  const validSubs = subRects.filter((r) => r.gw >= 1 && r.gh >= 1);
  const subs = validSubs.length > 0 ? validSubs : [{ gx: 8, gy: 8, gw: 4, gh: 2 }];
  const bbox = boundingGridRect(subs);
  const customPoints = subs.length > 1 ? gridRectsToClockwisePolygon(subs, 40) : undefined;
  return {
    rect: bbox,
    subRects: subs.length > 1 ? subs : undefined,
    isHallway: true,
    flavor,
    ...(zone ? { zone } : {}),
    ...(customPoints && customPoints.length >= 4 ? { customPoints } : {}),
  };
}

function subtractRect2D(rect: GridRect, blocker: GridRect): GridRect[] {
  if (!rectsOverlap(rect, blocker)) return [rect];
  const res: GridRect[] = [];
  const rx2 = rect.gx + rect.gw;
  const ry2 = rect.gy + rect.gh;
  const bx2 = blocker.gx + blocker.gw;
  const by2 = blocker.gy + blocker.gh;

  if (blocker.gy > rect.gy) {
    res.push({ gx: rect.gx, gy: rect.gy, gw: rect.gw, gh: blocker.gy - rect.gy });
  }
  if (by2 < ry2) {
    res.push({ gx: rect.gx, gy: by2, gw: rect.gw, gh: ry2 - by2 });
  }
  const midY1 = Math.max(rect.gy, blocker.gy);
  const midY2 = Math.min(ry2, by2);
  if (midY2 - midY1 >= 2) {
    if (blocker.gx > rect.gx) {
      res.push({ gx: rect.gx, gy: midY1, gw: blocker.gx - rect.gx, gh: midY2 - midY1 });
    }
    if (bx2 < rx2) {
      res.push({ gx: bx2, gy: midY1, gw: rx2 - bx2, gh: midY2 - midY1 });
    }
  }
  return res.filter((r) => r.gw >= 2 && r.gh >= 2);
}

function splitStripWithVariety(
  rect: GridRect,
  horizontal: boolean,
  targetCount: number,
  minSpan = 2,
  preferContrast = true
): GridRect[] {
  const totalLen = horizontal ? rect.gw : rect.gh;
  const k = Math.max(1, Math.min(targetCount, Math.floor(totalLen / minSpan)));
  if (k <= 1) return [rect];

  const spans = new Array(k).fill(minSpan);
  let rem = totalLen - k * minSpan;

  if (preferContrast && rem >= 2) {
    const anchorIdx = k === 2 ? (Math.random() < 0.5 ? 0 : 1) : pickRandom([0, Math.floor(k / 2), k - 1]);
    const anchorGive = Math.min(rem, Math.max(1, Math.min(4, Math.ceil(rem * (k === 2 ? 0.65 : 0.48)))));
    spans[anchorIdx] += anchorGive;
    rem -= anchorGive;
  }

  let guard = 0;
  while (rem > 0 && guard < 100) {
    guard++;
    const idx = randInt(0, k - 1);
    if (k >= 3 && spans[idx] >= 6 && guard < 40) continue;
    spans[idx]++;
    rem--;
  }

  const out: GridRect[] = [];
  let cursor = horizontal ? rect.gx : rect.gy;
  for (const sp of spans) {
    out.push(
      horizontal
        ? { gx: cursor, gy: rect.gy, gw: sp, gh: rect.gh }
        : { gx: rect.gx, gy: cursor, gw: rect.gw, gh: sp }
    );
    cursor += sp;
  }
  return out;
}

function allocateCountsAcrossStrips(strips: GridRect[], totalBudget: number, horizontalFlags: boolean[]): number[] {
  if (strips.length === 0) return [];
  const budget = Math.max(strips.length, totalBudget);
  const capacities = strips.map((s, idx) => Math.max(1, Math.floor((horizontalFlags[idx] ? s.gw : s.gh) / 2)));
  const counts = strips.map(() => 1);
  let assigned = strips.length;

  while (assigned < budget) {
    let bestIdx = -1;
    let bestRatio = -Infinity;
    for (let i = 0; i < strips.length; i++) {
      if (counts[i] >= capacities[i]) continue;
      const majorLen = horizontalFlags[i] ? strips[i].gw : strips[i].gh;
      const avgRoomLen = majorLen / counts[i];
      if (avgRoomLen > bestRatio) {
        bestRatio = avgRoomLen;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    counts[bestIdx]++;
    assigned++;
  }
  return counts;
}

interface GeneratedFloorBundle {
  floor: MapFloor;
  stairUpRoomId?: string;
  stairDownRoomId?: string;
}

interface SharedLayoutBlueprint {
  simpleTopology: SimpleTopology;
  standardTopology: StandardTopology;
  labyrinthTopology: LabyrinthTopology;
  pattern: PlanPattern;
  lArmLeft: boolean;
  lArmUp: boolean;
  coreX: number;
  hallY: number;
  coreW: number;
  northH: number;
  southH: number;
  ringX: number;
  ringY: number;
  ringW: number;
  ringH: number;
  upStairRect?: GridRect;
  downStairRect?: GridRect;
}

function getStairMaterial(archetype: LayoutArchetype, elevationOrder: number): FloorMaterial {
  if (elevationOrder < 0) return 'stairway';
  if (
    archetype === 'manor' ||
    archetype === 'tavern' ||
    archetype === 'temple' ||
    archetype === 'guildhall'
  ) {
    return 'staircase';
  }
  return 'stairway';
}

export type RoomHubCategory =
  | 'spine'
  | 'hub'
  | 'kitchen-suite'
  | 'leaf';

function isBalconyRoom(room: Pick<Room, 'name' | 'type'>): boolean {
  return (
    room.type === 'courtyard' &&
    /balcony|terrace|veranda|loggia|parapet|overlook|deck|catwalk/i.test(room.name)
  );
}

export function getRoomHubCategory(room: Room): RoomHubCategory {
  if (isBalconyRoom(room)) {
    return 'leaf';
  }
  if (room.type === 'hallway' || room.type === 'stairs' || room.type === 'courtyard') {
    return 'spine';
  }
  const name = room.name.toLowerCase();

  // Spines / Thoroughfares
  if (
    /hallway|corridor|passage|gallery|colonnade|arcade|cloister|breezeway|stair|landing/i.test(
      name
    )
  ) {
    return 'spine';
  }

  // Major circulation hubs
  if (
    /foyer|vestibule|entry|porch|narthex|gatehouse|atrium|rotunda|great hall|feasting hall|common taproom|taproom|ballroom|grand salon|sanctuary nave|panopticon/i.test(
      name
    )
  ) {
    return 'hub';
  }

  // Functional 2-door suites
  if (
    /kitchen|dining|banquet|mess hall|master bedchamber|lord.*chamber|guildmaster lounge|warden office|observatory|high sanctum/i.test(
      name
    )
  ) {
    return 'kitchen-suite';
  }

  return 'leaf';
}

export function getMaxDoorsForRoom(
  room: Room,
  complexity: LayoutComplexity = 'standard'
): number {
  if (room.type === 'secret') return complexity === 'bizarre' ? 2 : 1;
  const category = getRoomHubCategory(room);
  switch (category) {
    case 'spine':
      return 999;
    case 'hub':
      return complexity === 'simple'
        ? 2
        : complexity === 'standard'
          ? 4
          : complexity === 'labyrinthine'
            ? 6
            : 6;
    case 'kitchen-suite':
      return complexity === 'simple'
        ? 2
        : complexity === 'standard'
          ? 3
          : complexity === 'labyrinthine'
            ? 4
            : 5;
    case 'leaf':
    default:
      return complexity === 'simple'
        ? 1
        : complexity === 'standard'
          ? 2
          : complexity === 'labyrinthine'
            ? 3
            : 4;
  }
}

export function getEdgeDesirabilityWeight(
  rA: Room,
  rB: Room,
  complexity: LayoutComplexity = 'standard'
): number {
  const catA = getRoomHubCategory(rA);
  const catB = getRoomHubCategory(rB);

  // Never route through a secret room unless no other path exists
  if (rA.type === 'secret' || rB.type === 'secret') {
    return complexity === 'bizarre' ? 140 : 450;
  }

  // Balconies connect cleanly to suites or hubs before hallways/random rooms
  if (isBalconyRoom(rA) || isBalconyRoom(rB)) {
    const other = isBalconyRoom(rA) ? rB : rA;
    if (isBalconyRoom(other)) return 600;
    if (/salon|master|observatory|taproom|warden|guildmaster|sanctum|study|dining|great/i.test(other.name)) {
      return 6;
    }
    return 14;
  }

  // If one of them is a circulation spine (hallway/stairs/courtyard)
  if (catA === 'spine' || catB === 'spine') {
    const otherCat = catA === 'spine' ? catB : catA;
    if (otherCat === 'spine') return 4; // Spine to spine (e.g. Hallway to Stairs, Ring Hall to Crossway)
    if (otherCat === 'hub') return 6;   // Spine to foyer/great hall
    return 10;                         // Spine to any regular room
  }

  const nameA = rA.name.toLowerCase();
  const nameB = rB.name.toLowerCase();

  // Natural functional complementary pairings
  const isKitchenA = /kitchen/i.test(nameA);
  const isKitchenB = /kitchen/i.test(nameB);
  const isDiningA = /dining|banquet|mess hall|great hall|taproom/i.test(nameA);
  const isDiningB = /dining|banquet|mess hall|great hall|taproom/i.test(nameB);
  if ((isKitchenA && isDiningB) || (isKitchenB && isDiningA)) {
    return 7;
  }

  const isPantryA = /pantry|larder|cellar|provision/i.test(nameA);
  const isPantryB = /pantry|larder|cellar|provision/i.test(nameB);
  if ((isKitchenA && isPantryB) || (isKitchenB && isPantryA)) {
    return 8;
  }

  const isMasterA = /master|lord|warden|guildmaster|observatory/i.test(nameA);
  const isMasterB = /master|lord|warden|guildmaster|observatory/i.test(nameB);
  const isEnsuiteA = /bath|privy|washroom|study|dressing|balcony|terrace|veranda|deck/i.test(nameA);
  const isEnsuiteB = /bath|privy|washroom|study|dressing|balcony|terrace|veranda|deck/i.test(nameB);
  if ((isMasterA && isEnsuiteB) || (isMasterB && isEnsuiteA)) {
    return 9;
  }

  // Hub to Hub (e.g. Foyer to Great Hall)
  if (catA === 'hub' && catB === 'hub') {
    return 12;
  }

  const isBarracksA = /barracks|guard/i.test(nameA);
  const isBarracksB = /barracks|guard/i.test(nameB);
  const isArmoryA = /armory|weapons/i.test(nameA);
  const isArmoryB = /armory|weapons/i.test(nameB);
  if ((isBarracksA && isArmoryB) || (isBarracksB && isArmoryA)) {
    return 14;
  }

  const isLibraryA = /library|archive|scriptorium/i.test(nameA);
  const isLibraryB = /library|archive|scriptorium/i.test(nameB);
  const isStudyA = /study|office|desk/i.test(nameA);
  const isStudyB = /study|office|desk/i.test(nameB);
  if ((isLibraryA && isStudyB) || (isLibraryB && isStudyA)) {
    return 15;
  }

  // Hub to other rooms (e.g. Foyer or Great Hall to a room)
  if (catA === 'hub' || catB === 'hub') {
    return 20;
  }

  // Kitchen / Suite to other rooms
  if (catA === 'kitchen-suite' || catB === 'kitchen-suite') {
    return complexity === 'simple'
      ? 50
      : complexity === 'standard'
        ? 35
        : complexity === 'labyrinthine'
          ? 22
          : 16;
  }

  // Leaf to Leaf:
  if (complexity === 'bizarre') return 20;
  if (complexity === 'labyrinthine') return 26;
  if (complexity === 'standard') return 80;
  return 500;
}

/**
 * Prunes redundant doorways from a procedural floor layout so that individual rooms
 * do not have multiple unnecessary doors connecting into random neighbors.
 * Uses a Kruskal-style minimum spanning forest with strict room-type door limits,
 * followed by a guaranteed-reachability fallback and controlled secondary hub loops.
 */
export function pruneRedundantDoorways(
  rooms: Room[],
  rawDoorways: Doorway[],
  complexity: LayoutComplexity = 'standard'
): { doorways: Doorway[]; suppressedAutoDoorKeys: string[] } {
  if (rooms.length <= 1) {
    return { doorways: rawDoorways, suppressedAutoDoorKeys: [] };
  }

  const roomMap = new Map<string, Room>(rooms.map((r) => [r.id, r]));

  // Disjoint Set Union (DSU) to guarantee 100% full floor reachability
  const parent = new Map<string, string>();
  for (const r of rooms) parent.set(r.id, r.id);
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    let curr = id;
    while (curr !== root) {
      const nxt = parent.get(curr)!;
      parent.set(curr, root);
      curr = nxt;
    }
    return root;
  };
  const union = (idA: string, idB: string): boolean => {
    const rootA = find(idA);
    const rootB = find(idB);
    if (rootA === rootB) return false;
    parent.set(rootA, rootB);
    return true;
  };

  const doorCount = new Map<string, number>();
  for (const r of rooms) doorCount.set(r.id, 0);

  const keptDoorways: Doorway[] = [];
  const candidateDoors: { door: Doorway; rA: Room; rB: Room; weight: number }[] = [];
  const connectedPairs = new Set<string>();

  for (const d of rawDoorways) {
    if (d.roomBId === null) {
      keptDoorways.push(d);
      // Exterior entrance/exit counts as 1 door for that room
      doorCount.set(d.roomAId, (doorCount.get(d.roomAId) ?? 0) + 1);
      continue;
    }
    const rA = roomMap.get(d.roomAId);
    const rB = roomMap.get(d.roomBId);
    if (!rA || !rB) {
      keptDoorways.push(d);
      continue;
    }
    // Custom placed manual doors are always preserved
    if (d.customPlaced && !d.autoDetected) {
      keptDoorways.push(d);
      doorCount.set(rA.id, (doorCount.get(rA.id) ?? 0) + 1);
      doorCount.set(rB.id, (doorCount.get(rB.id) ?? 0) + 1);
      const pairId = rA.id < rB.id ? `${rA.id}__${rB.id}` : `${rB.id}__${rA.id}`;
      connectedPairs.add(pairId);
      union(rA.id, rB.id);
      continue;
    }

    const baseWeight = getEdgeDesirabilityWeight(rA, rB, complexity);
    const weight =
      complexity === 'bizarre'
        ? baseWeight + Math.random() * 16
        : complexity === 'labyrinthine'
          ? baseWeight + Math.random() * 8
          : baseWeight;
    candidateDoors.push({ door: d, rA, rB, weight });
  }

  // Sort candidate interior doors by weight ascending (lowest weight = chosen first)
  candidateDoors.sort((a, b) => a.weight - b.weight);

  const selectedDoorIds = new Set<string>();

  // Pass 1: Spanning Forest respecting max doors per room
  for (const item of candidateDoors) {
    const { door, rA, rB } = item;
    const maxA = getMaxDoorsForRoom(rA, complexity);
    const maxB = getMaxDoorsForRoom(rB, complexity);
    const countA = doorCount.get(rA.id) ?? 0;
    const countB = doorCount.get(rB.id) ?? 0;

    if (find(rA.id) !== find(rB.id)) {
      if (countA < maxA && countB < maxB) {
        union(rA.id, rB.id);
        doorCount.set(rA.id, countA + 1);
        doorCount.set(rB.id, countB + 1);
        selectedDoorIds.add(door.id);
        const pairId = rA.id < rB.id ? `${rA.id}__${rB.id}` : `${rB.id}__${rA.id}`;
        connectedPairs.add(pairId);
        keptDoorways.push(door);
      }
    }
  }

  // Pass 2: Guarantee 100% floor reachability (Fallback for any disjoint room components)
  for (const item of candidateDoors) {
    const { door, rA, rB } = item;
    if (selectedDoorIds.has(door.id)) continue;
    if (find(rA.id) !== find(rB.id)) {
      union(rA.id, rB.id);
      doorCount.set(rA.id, (doorCount.get(rA.id) ?? 0) + 1);
      doorCount.set(rB.id, (doorCount.get(rB.id) ?? 0) + 1);
      selectedDoorIds.add(door.id);
      const pairId = rA.id < rB.id ? `${rA.id}__${rB.id}` : `${rB.id}__${rA.id}`;
      connectedPairs.add(pairId);
      keptDoorways.push(door);
    }
  }

  // Pass 3: Secondary circulation loops scaled by complexity
  const loopWeightMax =
    complexity === 'simple'
      ? 12
      : complexity === 'standard'
        ? 65
        : complexity === 'labyrinthine'
          ? 250
          : 450;
  const maxLoopDoors =
    complexity === 'simple'
      ? 1
      : complexity === 'standard'
        ? 3
        : complexity === 'labyrinthine'
          ? Math.max(8, Math.floor(rooms.length * 0.75))
          : Math.max(12, rooms.length);

  // Build adjacency of currently connected rooms to measure path lengths & prioritize cycle-forming doors
  const currentAdj = new Map<string, Set<string>>();
  for (const r of rooms) currentAdj.set(r.id, new Set());
  for (const kd of keptDoorways) {
    if (kd.roomBId) {
      currentAdj.get(kd.roomAId)?.add(kd.roomBId);
      currentAdj.get(kd.roomBId)?.add(kd.roomAId);
    }
  }

  const getGraphHops = (startId: string, targetId: string, maxDepth = 8): number => {
    const q: [string, number][] = [[startId, 0]];
    const seen = new Set<string>([startId]);
    while (q.length > 0) {
      const [cur, d] = q.shift()!;
      if (cur === targetId) return d;
      if (d >= maxDepth) continue;
      for (const nxt of currentAdj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          q.push([nxt, d + 1]);
        }
      }
    }
    return Infinity;
  };

  // Re-sort candidate doors for Pass 3 giving priority to doors that close long cycles/flanking loops
  const loopCandidates = candidateDoors
    .filter((item) => !selectedDoorIds.has(item.door.id) && item.weight <= loopWeightMax)
    .map((item) => {
      const hops = getGraphHops(item.rA.id, item.rB.id);
      const isCycle = hops >= 2;
      const cycleBonus =
        isCycle && (complexity === 'labyrinthine' || complexity === 'bizarre')
          ? Math.min(hops * 4, 30)
          : 0;
      return { ...item, effectiveWeight: Math.max(1, item.weight - cycleBonus), isCycle };
    });

  loopCandidates.sort((a, b) => a.effectiveWeight - b.effectiveWeight);

  let loopDoorsAdded = 0;
  for (const item of loopCandidates) {
    if (loopDoorsAdded >= maxLoopDoors) break;
    const { door, rA, rB } = item;
    if (selectedDoorIds.has(door.id)) continue;

    const pairId = rA.id < rB.id ? `${rA.id}__${rB.id}` : `${rB.id}__${rA.id}`;
    const catA = getRoomHubCategory(rA);
    const catB = getRoomHubCategory(rB);

    // Never place duplicate doors between the exact same two rooms unless both are long spines
    if (
      connectedPairs.has(pairId) &&
      (catA !== 'spine' || catB !== 'spine')
    ) {
      continue;
    }

    const maxA = getMaxDoorsForRoom(rA, complexity);
    const maxB = getMaxDoorsForRoom(rB, complexity);
    const countA = doorCount.get(rA.id) ?? 0;
    const countB = doorCount.get(rB.id) ?? 0;

    if (countA < maxA && countB < maxB) {
      doorCount.set(rA.id, countA + 1);
      doorCount.set(rB.id, countB + 1);
      selectedDoorIds.add(door.id);
      connectedPairs.add(pairId);
      keptDoorways.push(door);
      currentAdj.get(rA.id)?.add(rB.id);
      currentAdj.get(rB.id)?.add(rA.id);
      loopDoorsAdded++;
    }
  }

  // Gather all unselected candidate doorway keys to suppress them from auto-recreation
  const suppressedAutoDoorKeys: string[] = [];
  for (const item of candidateDoors) {
    if (!selectedDoorIds.has(item.door.id)) {
      const pairKey = getAutoPairKey(
        item.door.roomAId,
        item.door.roomBId!,
        item.door.edgeAIndex,
        item.door.edgeBIndex ?? 0
      );
      suppressedAutoDoorKeys.push(pairKey);
    }
  }

  return { doorways: keptDoorways, suppressedAutoDoorKeys };
}

function createFlavorPicker(
  archetype: LayoutArchetype,
  elevationOrder: number,
  isBizarre = false
) {
  const pool = [...ARCHETYPE_FLAVORS[archetype]];
  const secrets = pool.filter((f) => f.type === 'secret');
  const normals = shuffleArray(pool.filter((f) => f.type !== 'secret'));
  const flavorPool = [...normals, ...secrets];
  let flavorIdx = randInt(0, Math.max(0, normals.length - 1));
  const cycleCounts = new Map<string, number>();

  return (preferSecret = false, avoidCourtyard = false): RoomFlavor => {
    let chosen: RoomFlavor | undefined;
    if (preferSecret) {
      chosen = flavorPool.find((f) => f.type === 'secret');
    }
    if (!chosen) {
      const startStep = isBizarre ? randInt(0, Math.max(0, normals.length - 1)) : 0;
      for (let k = 0; k < flavorPool.length; k++) {
        const idx = (flavorIdx + startStep + k) % flavorPool.length;
        const cand = flavorPool[idx];
        if (cand.type === 'secret' && !preferSecret) continue;
        if ((avoidCourtyard || elevationOrder < 0) && cand.type === 'courtyard') continue;
        chosen = cand;
        flavorIdx = idx + 1;
        break;
      }
    }
    if (!chosen) {
      chosen = flavorPool[flavorIdx % flavorPool.length];
      flavorIdx++;
    }
    const baseName = chosen.name;
    const seen = (cycleCounts.get(baseName) ?? 0) + 1;
    cycleCounts.set(baseName, seen);
    const name = seen > 1 ? `${baseName} ${seen}` : baseName;
    return elevationOrder < 0 && chosen.type === 'courtyard'
      ? { ...chosen, name, type: 'room', material: 'cobble', lighting: 'darkness' }
      : { ...chosen, name };
  };
}

function attachArchetypeBalconies(
  placed: PlacedChamber[],
  reservedZones: GridRect[],
  archetype: LayoutArchetype,
  elevationOrder: number,
  complexity: LayoutComplexity,
  targetRoomCount: number
): void {
  if (elevationOrder < 0) return;
  const profile = ARCHETYPE_STRUCTURE_PROFILES[archetype];
  if (profile.balconyFlavors.length === 0) return;

  const chance =
    elevationOrder > 0 ? profile.balconyChanceUpper : profile.balconyChanceGround;
  const compMult =
    complexity === 'simple'
      ? 0.45
      : complexity === 'standard'
        ? 1.0
        : complexity === 'labyrinthine'
          ? 1.15
          : 1.25;
  if (Math.random() > Math.min(0.96, chance * compMult)) return;

  const maxBalconies =
    complexity === 'simple'
      ? 1
      : complexity === 'standard'
        ? elevationOrder > 0
          ? 2
          : 1
        : elevationOrder > 0 || complexity === 'bizarre'
          ? 2
          : 1;

  const canPlaceBalconyRect = (r: GridRect): boolean =>
    !placed.some((p) => chamberOverlapsRect(p, r)) &&
    !reservedZones.some((z) => rectsOverlap(z, r));

  // Score host rooms cleanly (prefer salons, master suites, observatories, taprooms, upper halls)
  const hosts = placed
    .filter(
      (p) =>
        !p.stairRole &&
        !p.isFoyer &&
        !p.isBalcony &&
        p.flavor.type !== 'secret' &&
        p.flavor.type !== 'courtyard'
    )
    .sort((a, b) => {
      const score = (c: PlacedChamber) => {
        let s = c.isHallway ? -20 : 10;
        if (
          /salon|master|observatory|taproom|warden|guildmaster|sanctum|study|great|dining|rotunda/i.test(
            c.flavor.name
          )
        ) {
          s += 30;
        }
        return s + Math.random() * 12;
      };
      return score(b) - score(a);
    });

  let added = 0;
  for (const host of hosts) {
    if (added >= maxBalconies || placed.length >= targetRoomCount) break;
    const hr = host.rect;
    const dirs = shuffleArray([0, 1, 3, 2]);
    let placedBalcony: GridRect | null = null;

    for (const dir of dirs) {
      if (dir === 0 || dir === 2) {
        const bw = Math.min(hr.gw, randInt(2, 4));
        const bh = 2;
        if (bw < 2) continue;
        const gy = dir === 0 ? hr.gy - bh : hr.gy + hr.gh;
        const gxStart = hr.gx + Math.floor((hr.gw - bw) / 2);
        const offsets = shuffleArray([0, -1, 1]);
        for (const off of offsets) {
          const cand: GridRect = { gx: gxStart + off, gy, gw: bw, gh: bh };
          if (chamberTouchEdgeLen(host, cand) >= 2 && canPlaceBalconyRect(cand)) {
            placedBalcony = cand;
            break;
          }
        }
      } else {
        const bw = 2;
        const bh = Math.min(hr.gh, randInt(2, 4));
        if (bh < 2) continue;
        const gx = dir === 1 ? hr.gx + hr.gw : hr.gx - bw;
        const gyStart = hr.gy + Math.floor((hr.gh - bh) / 2);
        const offsets = shuffleArray([0, -1, 1]);
        for (const off of offsets) {
          const cand: GridRect = { gx, gy: gyStart + off, gw: bw, gh: bh };
          if (chamberTouchEdgeLen(host, cand) >= 2 && canPlaceBalconyRect(cand)) {
            placedBalcony = cand;
            break;
          }
        }
      }
      if (placedBalcony) break;
    }

    if (placedBalcony) {
      const bf = pickRandom(profile.balconyFlavors);
      const countLabel = added > 0 ? ` ${added + 1}` : '';
      placed.push({
        rect: placedBalcony,
        isHallway: false,
        isBalcony: true,
        flavor: {
          name: `${bf.name}${countLabel}`,
          type: 'courtyard',
          material: bf.material,
          lighting: 'bright',
          notes: bf.notes,
        },
      });
      added++;
    }
  }
}

function resizeAndArticulateChambers(
  placed: PlacedChamber[],
  targetRoomCount: number,
  reservedZones: GridRect[],
  options: ProceduralLayoutOptions
): void {
  const isRegularResizable = (p: PlacedChamber) =>
    !p.isHallway &&
    !p.stairRole &&
    !p.isFoyer &&
    !p.isBalcony &&
    !p.customPoints &&
    p.flavor.type !== 'courtyard';

  const canOccupy = (r: GridRect, ignoreA?: PlacedChamber, ignoreB?: PlacedChamber): boolean =>
    !reservedZones.some((z) => rectsOverlap(z, r)) &&
    !placed.some((p) => p !== ignoreA && p !== ignoreB && chamberOverlapsRect(p, r));

  // Pass A: Merge flush adjacent chambers when over targetRoomCount (produces larger, cleaner rooms!)
  let mergeGuard = 0;
  while (placed.length > targetRoomCount && mergeGuard < 60) {
    mergeGuard++;
    let bestPair: [number, number, GridRect] | null = null;
    let bestArea = Infinity;

    for (let i = 0; i < placed.length; i++) {
      const a = placed[i];
      if (!isRegularResizable(a)) continue;
      for (let j = i + 1; j < placed.length; j++) {
        const b = placed[j];
        if (!isRegularResizable(b)) continue;
        if (a.flavor.type === 'secret' || b.flavor.type === 'secret') continue;

        let merged: GridRect | null = null;
        if (
          a.rect.gx === b.rect.gx &&
          a.rect.gw === b.rect.gw &&
          (a.rect.gy + a.rect.gh === b.rect.gy || b.rect.gy + b.rect.gh === a.rect.gy)
        ) {
          merged = {
            gx: a.rect.gx,
            gy: Math.min(a.rect.gy, b.rect.gy),
            gw: a.rect.gw,
            gh: a.rect.gh + b.rect.gh,
          };
        } else if (
          a.rect.gy === b.rect.gy &&
          a.rect.gh === b.rect.gh &&
          (a.rect.gx + a.rect.gw === b.rect.gx || b.rect.gx + b.rect.gw === a.rect.gx)
        ) {
          merged = {
            gx: Math.min(a.rect.gx, b.rect.gx),
            gy: a.rect.gy,
            gw: a.rect.gw + b.rect.gw,
            gh: a.rect.gh,
          };
        }

        if (!merged) continue;
        const area = merged.gw * merged.gh;
        const aspect = Math.max(merged.gw, merged.gh) / Math.min(merged.gw, merged.gh);
        if (area <= 36 && aspect <= 3.2 && area < bestArea) {
          bestArea = area;
          bestPair = [i, j, merged];
        }
      }
    }

    if (!bestPair) break;
    const [idxA, idxB, mergedRect] = bestPair;
    const chA = placed[idxA];
    const chB = placed[idxB];
    const keepA = chA.isSignatureWing || (!chB.isSignatureWing && chA.rect.gw * chA.rect.gh >= chB.rect.gw * chB.rect.gh);
    const primary = keepA ? chA : chB;
    placed[idxA] = {
      ...primary,
      rect: mergedRect,
      isSignatureWing: chA.isSignatureWing || chB.isSignatureWing,
    };
    placed.splice(idxB, 1);
  }

  // Pass B: Role-driven resizing (expand anchor/grand rooms outward, step back compact utility bays)
  if (options.complexity !== 'bizarre') {
    const candidates = shuffleArray(placed.filter(isRegularResizable)).sort((a, b) => {
      const score = (c: PlacedChamber) => (c.isSignatureWing ? 2 : 0) + (c.flavor.type === 'secret' ? -1 : 0);
      return score(b) - score(a);
    });

    for (const ch of candidates) {
      const isGrand =
        !!ch.isSignatureWing ||
        /Great|Grand|Taproom|Sanctum|Foundry|Forge|Banquet|Dining|Library|Salon|Nave|Rotunda|Barracks|Dock|Common/i.test(
          ch.flavor.name
        );
      const isCompact =
        !isGrand &&
        /Study|Pantry|Closet|Cell|Alcove|Guard|Post|Booth|Vestry|Storeroom|Larder|Tool|Office/i.test(
          ch.flavor.name
        );
      const area = ch.rect.gw * ch.rect.gh;

      if (isGrand || (!isCompact && area <= 10 && Math.random() < 0.45)) {
        const expandDepth = isGrand && area <= 20 ? 2 : 1;
        const dirs = shuffleArray([0, 1, 2, 3]);
        for (const dir of dirs) {
          let expanded = false;
          for (let step = expandDepth; step >= 1; step--) {
            const band: GridRect =
              dir === 0
                ? { gx: ch.rect.gx, gy: ch.rect.gy - step, gw: ch.rect.gw, gh: step }
                : dir === 1
                  ? { gx: ch.rect.gx + ch.rect.gw, gy: ch.rect.gy, gw: step, gh: ch.rect.gh }
                  : dir === 2
                    ? { gx: ch.rect.gx, gy: ch.rect.gy + ch.rect.gh, gw: ch.rect.gw, gh: step }
                    : { gx: ch.rect.gx - step, gy: ch.rect.gy, gw: step, gh: ch.rect.gh };

            const nextRect: GridRect =
              dir === 0
                ? { gx: ch.rect.gx, gy: ch.rect.gy - step, gw: ch.rect.gw, gh: ch.rect.gh + step }
                : dir === 1
                  ? { gx: ch.rect.gx, gy: ch.rect.gy, gw: ch.rect.gw + step, gh: ch.rect.gh }
                  : dir === 2
                    ? { gx: ch.rect.gx, gy: ch.rect.gy, gw: ch.rect.gw, gh: ch.rect.gh + step }
                    : { gx: ch.rect.gx - step, gy: ch.rect.gy, gw: ch.rect.gw + step, gh: ch.rect.gh };

            const nextArea = nextRect.gw * nextRect.gh;
            const aspect = Math.max(nextRect.gw, nextRect.gh) / Math.min(nextRect.gw, nextRect.gh);
            if (nextArea <= (isGrand ? 40 : 18) && aspect <= 2.6 && canOccupy(band, ch)) {
              ch.rect = nextRect;
              expanded = true;
              break;
            }
          }
          if (expanded) break;
        }
      } else if (isCompact && (ch.rect.gw >= 4 || ch.rect.gh >= 4) && Math.random() < 0.5) {
        // Trim 1 cell on an unattached exterior edge so utility rooms sit compactly beside larger suites
        const dirs = shuffleArray([0, 1, 2, 3]);
        const origRect = ch.rect;
        for (const dir of dirs) {
          const edgeBand: GridRect =
            dir === 0
              ? { gx: origRect.gx, gy: origRect.gy - 1, gw: origRect.gw, gh: 1 }
              : dir === 1
                ? { gx: origRect.gx + origRect.gw, gy: origRect.gy, gw: 1, gh: origRect.gh }
                : dir === 2
                  ? { gx: origRect.gx, gy: origRect.gy + origRect.gh, gw: origRect.gw, gh: 1 }
                  : { gx: origRect.gx - 1, gy: origRect.gy, gw: 1, gh: origRect.gh };
          if (placed.some((o) => o !== ch && chamberOverlapsRect(o, edgeBand))) continue;

          const shrunk: GridRect =
            dir === 0
              ? { gx: origRect.gx, gy: origRect.gy + 1, gw: origRect.gw, gh: origRect.gh - 1 }
              : dir === 1
                ? { gx: origRect.gx, gy: origRect.gy, gw: origRect.gw - 1, gh: origRect.gh }
                : dir === 2
                  ? { gx: origRect.gx, gy: origRect.gy, gw: origRect.gw, gh: origRect.gh - 1 }
                  : { gx: origRect.gx + 1, gy: origRect.gy, gw: origRect.gw - 1, gh: origRect.gh };

          if (shrunk.gw < 2 || shrunk.gh < 2) continue;
          const keepsNeighbors = placed.every(
            (o) =>
              o === ch ||
              chamberTouchEdgeLen(ch, o) === 0 ||
              chamberTouchEdgeLen({ rect: shrunk }, o) >= 2
          );
          if (!keepsNeighbors) continue;
          ch.rect = shrunk;
          if (isPlacedGraphConnected(placed)) {
            break;
          }
          ch.rect = origRect;
        }
      }
    }
  }
}

function isPlacedGraphConnected(chambers: PlacedChamber[]): boolean {
  if (chambers.length <= 1) return true;
  const visited = new Set<number>([0]);
  const queue = [0];
  let qHead = 0;
  while (qHead < queue.length) {
    const cur = queue[qHead++];
    for (let i = 0; i < chambers.length; i++) {
      if (visited.has(i)) continue;
      if (chamberTouchEdgeLen(chambers[cur], chambers[i]) >= 1.5) {
        visited.add(i);
        queue.push(i);
      }
    }
  }
  return visited.size === chambers.length;
}

function balancePlacedChambers(
  placed: PlacedChamber[],
  targetRoomCount: number,
  nextFlavor: (preferSecret?: boolean, avoidCourtyard?: boolean) => RoomFlavor,
  reservedZones: GridRect[] = []
): void {
  const getRoomCount = () => placed.length;
  if (getRoomCount() === targetRoomCount) return;

  // 1. Subdivide oversized rooms before growing outward warts
  if (getRoomCount() < targetRoomCount) {
    let subGuard = 0;
    while (getRoomCount() < targetRoomCount && subGuard < 24) {
      subGuard++;
      const splittable = placed
        .filter(
          (p) =>
            !p.isHallway &&
            !p.stairRole &&
            !p.isFoyer &&
            !p.isBalcony &&
            !p.customPoints &&
            p.flavor.type !== 'courtyard' &&
            ((p.rect.gw >= 5 && p.rect.gh >= 2) || (p.rect.gh >= 5 && p.rect.gw >= 2))
        )
        .sort((a, b) => b.rect.gw * b.rect.gh - a.rect.gw * a.rect.gh);
      const target = splittable[0];
      if (!target) break;
      const splitH = target.rect.gw >= target.rect.gh;
      if (splitH && target.rect.gw >= 5) {
        const w1 = Math.max(2, Math.round(target.rect.gw * 0.58));
        const w2 = target.rect.gw - w1;
        if (w2 >= 2) {
          const r1: GridRect = { gx: target.rect.gx, gy: target.rect.gy, gw: w1, gh: target.rect.gh };
          const r2: GridRect = { gx: target.rect.gx + w1, gy: target.rect.gy, gw: w2, gh: target.rect.gh };
          target.rect = r1;
          placed.push({ rect: r2, isHallway: false, zone: target.zone, flavor: nextFlavor(false) });
          continue;
        }
      } else if (!splitH && target.rect.gh >= 5) {
        const h1 = Math.max(2, Math.round(target.rect.gh * 0.58));
        const h2 = target.rect.gh - h1;
        if (h2 >= 2) {
          const r1: GridRect = { gx: target.rect.gx, gy: target.rect.gy, gw: target.rect.gw, gh: h1 };
          const r2: GridRect = { gx: target.rect.gx, gy: target.rect.gy + h1, gw: target.rect.gw, gh: h2 };
          target.rect = r1;
          placed.push({ rect: r2, isHallway: false, zone: target.zone, flavor: nextFlavor(false) });
          continue;
        }
      }
      break;
    }
  }

  // 2. Prune down if still over targetRoomCount (never break floor graph connectivity!)
  if (getRoomCount() > targetRoomCount) {
    let guard = 0;
    while (getRoomCount() > targetRoomCount && guard < 120) {
      guard++;
      let bestIdx = -1;
      let minNeighbors = Infinity;
      for (let pass = 0; pass < 3 && bestIdx < 0; pass++) {
        const allowBalconyPrune = pass >= 1;
        const allowSigPrune = pass === 2;
        for (let i = placed.length - 1; i >= 0; i--) {
          const p = placed[i];
          if (p.isHallway || p.stairRole || p.isFoyer) continue;
          if (!allowBalconyPrune && p.isBalcony) continue;
          if (!allowSigPrune && p.isSignatureWing) continue;
          const remaining = placed.filter((_, idx) => idx !== i);
          if (!isPlacedGraphConnected(remaining)) continue;
          const nbrs = placed.filter(
            (o, idx) => idx !== i && chamberTouchEdgeLen(p, o) >= 1.5
          );
          if (nbrs.length === 1) {
            bestIdx = i;
            break;
          }
          if (nbrs.length < minNeighbors && nbrs.length > 0) {
            minNeighbors = nbrs.length;
            bestIdx = i;
          }
        }
      }
      if (bestIdx >= 0) {
        placed.splice(bestIdx, 1);
      } else {
        break;
      }
    }
    return;
  }

  // 3. Grow up to targetRoomCount with spatially balanced parent/dimension selection
  let guard = 0;
  const dimPairs: [number, number][] = [
    [4, 3],
    [3, 4],
    [4, 4],
    [3, 3],
    [3, 2],
    [2, 3],
    [4, 2],
    [2, 4],
  ];

  const canGrowInto = (r: GridRect): boolean =>
    !placed.some((p) => chamberOverlapsRect(p, r)) &&
    !reservedZones.some((z) => rectsOverlap(z, r));

  while (getRoomCount() < targetRoomCount && guard < 180) {
    guard++;
    const nonBalc = placed.filter((p) => !p.isBalcony);
    const cxAll = nonBalc.reduce((s, p) => s + p.rect.gx + p.rect.gw * 0.5, 0) / Math.max(1, nonBalc.length);
    const cyAll = nonBalc.reduce((s, p) => s + p.rect.gy + p.rect.gh * 0.5, 0) / Math.max(1, nonBalc.length);

    let bestCand: { rect: GridRect; score: number } | null = null;
    const parentPool = shuffleArray(nonBalc).sort((a, b) => {
      if (a.isHallway && !b.isHallway) return -1;
      if (!a.isHallway && b.isHallway) return 1;
      return 0;
    });

    for (const parent of parentPool.slice(0, Math.min(10, parentPool.length))) {
      const parentSubs = chamberSubRects(parent);
      const dims = shuffleArray(dimPairs).slice(0, 4);
      for (const [gw, gh] of dims) {
        for (const pRect of parentSubs) {
          for (const dir of [0, 1, 2, 3]) {
            if (dir === 0 || dir === 2) {
              const gy = dir === 0 ? pRect.gy - gh : pRect.gy + pRect.gh;
              const gxMid = pRect.gx + Math.floor((pRect.gw - gw) / 2);
              const gxChoices = [gxMid, pRect.gx, pRect.gx + pRect.gw - gw];
              for (const gx of gxChoices) {
                const cand: GridRect = { gx, gy, gw, gh };
                const touchLen = chamberTouchEdgeLen(parent, cand);
                if (touchLen < 2 || !canGrowInto(cand)) continue;
                let flushNeighbors = 0;
                for (const o of nonBalc) {
                  if (chamberTouchEdgeLen(o, cand) >= 2) flushNeighbors++;
                }
                const distFromCenter = Math.hypot(
                  cand.gx + cand.gw * 0.5 - cxAll,
                  cand.gy + cand.gh * 0.5 - cyAll
                );
                const score =
                  (parent.isHallway ? 28 : 0) +
                  flushNeighbors * 18 +
                  touchLen * 5 -
                  distFromCenter * 2 +
                  Math.random() * 8;
                if (!bestCand || score > bestCand.score) {
                  bestCand = { rect: cand, score };
                }
              }
            } else {
              const gx = dir === 1 ? pRect.gx + pRect.gw : pRect.gx - gw;
              const gyMid = pRect.gy + Math.floor((pRect.gh - gh) / 2);
              const gyChoices = [gyMid, pRect.gy, pRect.gy + pRect.gh - gh];
              for (const gy of gyChoices) {
                const cand: GridRect = { gx, gy, gw, gh };
                const touchLen = chamberTouchEdgeLen(parent, cand);
                if (touchLen < 2 || !canGrowInto(cand)) continue;
                let flushNeighbors = 0;
                for (const o of nonBalc) {
                  if (chamberTouchEdgeLen(o, cand) >= 2) flushNeighbors++;
                }
                const distFromCenter = Math.hypot(
                  cand.gx + cand.gw * 0.5 - cxAll,
                  cand.gy + cand.gh * 0.5 - cyAll
                );
                const score =
                  (parent.isHallway ? 28 : 0) +
                  flushNeighbors * 18 +
                  touchLen * 5 -
                  distFromCenter * 2 +
                  Math.random() * 8;
                if (!bestCand || score > bestCand.score) {
                  bestCand = { rect: cand, score };
                }
              }
            }
          }
        }
      }
    }

    if (bestCand) {
      placed.push({
        rect: bestCand.rect,
        isHallway: false,
        flavor: nextFlavor(false),
      });
    } else {
      break;
    }
  }
}

function subtractRectFromStripVertical(
  strip: GridRect,
  blocker: GridRect
): GridRect[] {
  if (!rectsOverlap(strip, blocker)) return [strip];
  const res: GridRect[] = [];
  if (blocker.gy > strip.gy) {
    res.push({
      gx: strip.gx,
      gy: strip.gy,
      gw: strip.gw,
      gh: blocker.gy - strip.gy,
    });
  }
  const blockerEnd = blocker.gy + blocker.gh;
  const stripEnd = strip.gy + strip.gh;
  if (blockerEnd < stripEnd) {
    res.push({
      gx: strip.gx,
      gy: blockerEnd,
      gw: strip.gw,
      gh: stripEnd - blockerEnd,
    });
  }
  return res.filter((r) => r.gw >= 2 && r.gh >= 2);
}

function getFloorHallMaterial(archetype: LayoutArchetype, elevationOrder: number): FloorMaterial {
  if (elevationOrder < 0) return 'stone';
  if (archetype === 'manor') return 'carpet';
  if (archetype === 'tavern' || archetype === 'guildhall') return 'wood';
  if (archetype === 'temple') return 'checkered';
  if (archetype === 'blacksmith') return 'cobble';
  return 'stone';
}

function makeStairChambers(
  placed: PlacedChamber[],
  fixedBlockers: GridRect[],
  options: ProceduralLayoutOptions,
  elevationOrder: number,
  upStairRect: GridRect | undefined,
  downStairRect: GridRect | undefined,
  targetRoomCount: number
): void {
  if (upStairRect && placed.length < targetRoomCount) {
    fixedBlockers.push(upStairRect);
    placed.push({
      rect: upStairRect,
      isHallway: false,
      stairRole: 'up',
      flavor: {
        name: elevationOrder === 0 ? 'Grand Staircase' : 'Cellar Stair',
        type: 'stairs',
        material: getStairMaterial(options.archetype, elevationOrder),
        lighting: elevationOrder < 0 ? 'dim' : 'bright',
        notes: 'Architectural stairwell ascending to the floor above.',
      },
    });
  }
  if (downStairRect && placed.length < targetRoomCount) {
    fixedBlockers.push(downStairRect);
    placed.push({
      rect: downStairRect,
      isHallway: false,
      stairRole: 'down',
      flavor: {
        name: elevationOrder > 0 ? 'Upper Stair Landing' : 'Descending Stairway',
        type: 'stairs',
        material: getStairMaterial(options.archetype, elevationOrder),
        lighting: 'dim',
        notes: 'Stairwell descending directly to the floor below.',
      },
    });
  }
}

function makeEntryFlavor(archetype: LayoutArchetype): RoomFlavor {
  return {
    name:
      archetype === 'tavern'
        ? 'Entry Porch'
        : archetype === 'temple'
          ? 'Sunlit Narthex'
          : archetype === 'jail'
            ? 'Gatehouse Post'
            : archetype === 'fortress'
              ? 'Barbican Entry'
              : archetype === 'blacksmith'
                ? 'Smithy Storefront'
                : 'Entry Foyer',
    type: 'room',
    material:
      archetype === 'blacksmith'
        ? 'cobble'
        : archetype === 'crypt' || archetype === 'fortress'
          ? 'stone'
          : 'marble',
    lighting: 'bright',
    notes: 'Primary exterior entrance into the complex.',
  };
}

/**
 * 1. Simple Floor Generator:
 * Compact, non-sprawling structures with randomized topology variants per archetype:
 * linear-h, linear-v, l-wing, or central-commons.
 */
function generateSimpleFloor(
  floorId: string,
  floorName: string,
  elevationOrder: number,
  options: ProceduralLayoutOptions,
  blueprint: SharedLayoutBlueprint,
  upStairRect: GridRect | undefined,
  downStairRect: GridRect | undefined,
  hasExteriorEntrance: boolean,
  targetRoomCount: number,
  seedOffset: number
): GeneratedFloorBundle {
  const idSuffix = `${Date.now()}-${seedOffset}`;
  const placed: PlacedChamber[] = [];
  const reservedZones: GridRect[] = [];
  const fixedBlockers: GridRect[] = [];
  const nextFlavor = createFlavorPicker(options.archetype, elevationOrder, false);
  const hallMat = getFloorHallMaterial(options.archetype, elevationOrder);

  makeStairChambers(
    placed,
    fixedBlockers,
    options,
    elevationOrder,
    upStairRect,
    downStairRect,
    targetRoomCount
  );

  const canPlaceSafe = (r: GridRect): boolean =>
    !placed.some((p) => chamberOverlapsRect(p, r)) &&
    !reservedZones.some((z) => rectsOverlap(z, r));

  const tryPush = (c: PlacedChamber): boolean => {
    const subs = chamberSubRects(c);
    if (!subs.every((sr) => canPlaceSafe(sr))) return false;
    placed.push(c);
    fixedBlockers.push(...subs);
    return true;
  };

  const { coreX, hallY, coreW, northH, southH, simpleTopology } = blueprint;
  const hallH = 2;
  let entryChamber: PlacedChamber | undefined;
  let reservedExtEdge = 2;

  if (simpleTopology === 'linear-v') {
    const spineW = 2;
    const spineH = Math.max(7, Math.min(11, targetRoomCount + 2));
    const spineX = coreX + Math.floor(coreW / 2) - 1;
    const spineY = hallY - Math.floor(spineH / 2) + 1;
    const baseSpine: GridRect = { gx: spineX, gy: spineY, gw: spineW, gh: spineH };
    const shapeRoll = Math.random();
    const flareCand: GridRect =
      !upStairRect && !downStairRect
        ? { gx: spineX - 1, gy: hallY - 1, gw: 4, gh: 3 }
        : { gx: spineX - 1, gy: hallY + 1, gw: 4, gh: 3 };
    const tSpurNorth: GridRect = { gx: spineX - 3, gy: spineY, gw: 8, gh: 2 };
    const tSpurSouth: GridRect = {
      gx: spineX - 3,
      gy: Math.max(hallY + 1, spineY + spineH - 2),
      gw: 8,
      gh: 2,
    };

    const hallSubs: GridRect[] = [baseSpine];
    if (shapeRoll < 0.45 && canPlaceSafe(flareCand)) {
      hallSubs.push(flareCand);
    } else if (shapeRoll < 0.82) {
      if (canPlaceSafe(tSpurNorth)) hallSubs.push(tSpurNorth);
      else if (canPlaceSafe(tSpurSouth)) hallSubs.push(tSpurSouth);
    }

    const hallFlavor: RoomFlavor = {
      name: elevationOrder < 0 ? 'Crypt Nave' : 'Central Axis Hall',
      type: 'hallway',
      material: hallMat,
      lighting: elevationOrder < 0 ? 'darkness' : 'dim',
      notes: 'Shaped vertical gallery connecting flanking chambers.',
    };
    if (!tryPush(buildHallwayChamber(hallSubs, hallFlavor))) {
      tryPush(buildHallwayChamber([baseSpine], hallFlavor));
    }

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = {
        gx: spineX - 1,
        gy: spineY + spineH,
        gw: 4,
        gh: 2,
      };
      if (canPlaceSafe(fRect)) {
        entryChamber = {
          rect: fRect,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }

    const westW = randInt(3, 5);
    const eastW = randInt(3, 5);
    let westBays = [{ gx: spineX - westW, gy: spineY, gw: westW, gh: spineH }];
    let eastBays = [{ gx: spineX + spineW, gy: spineY, gw: eastW, gh: spineH }];
    for (const blk of fixedBlockers) {
      westBays = westBays.flatMap((b) => subtractRect2D(b, blk));
      eastBays = eastBays.flatMap((b) => subtractRect2D(b, blk));
    }
    const allBays = [...westBays, ...eastBays];
    const remBudget = Math.max(allBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(allBays, remBudget, allBays.map(() => false));
    allBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, false, counts[idx], 2, true)) {
        if (canPlaceSafe(r)) placed.push({ rect: r, isHallway: false, flavor: nextFlavor(false) });
      }
    });
  } else if (simpleTopology === 'l-wing') {
    const hLen = Math.max(7, Math.min(10, coreW));
    const vLen = randInt(5, 6);
    const armLeft = blueprint.lArmLeft;
    const armUp = blueprint.lArmUp;
    const wingW = randInt(3, 4);
    const outerHDepth = armUp ? southH : northH;
    const outerHY = armUp ? hallY + 2 : hallY - outerHDepth;

    const hHall: GridRect = { gx: coreX, gy: hallY, gw: hLen, gh: 2 };
    const vHallX = armLeft ? coreX : coreX + hLen - 2;
    const vHallY = armUp ? hallY - vLen : hallY + 2;
    const vHall: GridRect = { gx: vHallX, gy: vHallY, gw: 2, gh: vLen };

    // Optional elbow flare inside the L-bend corner (never touches stairs or reserved inner pocket)
    const cornerFlare: GridRect | null =
      Math.random() < 0.55
        ? {
            gx: armLeft ? coreX - 1 : coreX + hLen - 2,
            gy: armUp ? hallY - 1 : hallY,
            gw: 3,
            gh: 3,
          }
        : null;
    const lHallSubs = cornerFlare ? [hHall, vHall, cornerFlare] : [hHall, vHall];

    tryPush(
      buildHallwayChamber(lHallSubs, {
        name: 'Elbow Gallery',
        type: 'hallway',
        material: hallMat,
        lighting: 'dim',
        notes: 'Continuous L-shaped gallery linking both wings.',
      })
    );

    // Reserve the inner L concavity so growth and balconies keep a crisp L silhouette
    const innerPocketX = armLeft ? coreX + 2 : coreX - 6;
    const innerPocketW = armLeft ? hLen + 6 : hLen + 4;
    const innerPocketY = armUp ? hallY - vLen - 6 : hallY + 2;
    const innerPocketH = vLen + 6;
    reservedZones.push({
      gx: innerPocketX,
      gy: innerPocketY,
      gw: innerPocketW,
      gh: innerPocketH,
    });

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = armUp
        ? {
            gx: coreX + Math.floor((hLen - 3) / 2),
            gy: outerHY + outerHDepth,
            gw: 3,
            gh: 2,
          }
        : {
            gx: armLeft ? coreX - 1 : coreX + hLen - 2,
            gy: hallY + 2 + vLen,
            gw: 3,
            gh: 2,
          };
      if (canPlaceSafe(fRect)) {
        entryChamber = {
          rect: fRect,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }

    const outerHStrip: GridRect = {
      gx: armLeft ? coreX - wingW : coreX,
      gy: outerHY,
      gw: hLen + wingW,
      gh: outerHDepth,
    };
    let hBays = [outerHStrip];
    for (const blk of fixedBlockers) {
      hBays = hBays.flatMap((b) => subtractRect2D(b, blk));
    }

    const outerVStrip: GridRect = {
      gx: armLeft ? coreX - wingW : coreX + hLen,
      gy: armUp ? hallY - vLen : hallY,
      gw: wingW,
      gh: vLen + 2,
    };
    let vBays = [outerVStrip];
    for (const blk of fixedBlockers) {
      vBays = vBays.flatMap((b) => subtractRect2D(b, blk));
    }

    const combinedBays = [...hBays, ...vBays];
    const horizFlags = [...hBays.map(() => true), ...vBays.map(() => false)];
    const remBudget = Math.max(combinedBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(combinedBays, remBudget, horizFlags);
    combinedBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, horizFlags[idx], counts[idx], 2, true)) {
        if (canPlaceSafe(r)) placed.push({ rect: r, isHallway: false, flavor: nextFlavor(false) });
      }
    });
  } else if (simpleTopology === 'u-wing') {
    const uW = Math.max(8, coreW);
    const armW = 3;
    const armH = randInt(4, 5);
    const pocketW = uW - armW * 2;
    const topHallRect: GridRect = { gx: coreX, gy: hallY, gw: uW, gh: hallH };
    const centerVestibule: GridRect = {
      gx: coreX + Math.floor((uW - 4) / 2),
      gy: hallY - 1,
      gw: 4,
      gh: 3,
    };
    const hallSubs =
      Math.random() < 0.65 && canPlaceSafe(centerVestibule)
        ? [topHallRect, centerVestibule]
        : [topHallRect];

    const uHallFlavor: RoomFlavor = {
      name: elevationOrder < 0 ? 'Cross Undercroft' : 'Terrace Gallery',
      type: 'hallway',
      material: hallMat,
      lighting: elevationOrder < 0 ? 'darkness' : 'bright',
      notes: 'Flared spine corridor bridging the twin projecting arms of the U-wing.',
    };
    let mainHall = buildHallwayChamber(hallSubs, uHallFlavor);
    if (!tryPush(mainHall)) {
      mainHall = buildHallwayChamber([topHallRect], uHallFlavor);
      tryPush(mainHall);
    }

    // Reserve the open U-forecourt pocket & mouth so the twin wings never merge
    if (pocketW >= 2) {
      reservedZones.push({
        gx: coreX + armW,
        gy: hallY + hallH,
        gw: pocketW,
        gh: armH + 5,
      });
    }

    if (hasExteriorEntrance) {
      entryChamber = mainHall;
      reservedExtEdge = 2;
    }

    let northBays = [{ gx: coreX, gy: hallY - northH, gw: uW, gh: northH }];
    for (const blk of fixedBlockers) {
      northBays = northBays.flatMap((b) => subtractRect2D(b, blk));
    }

    const westArm: GridRect = { gx: coreX, gy: hallY + hallH, gw: armW, gh: armH };
    const eastArm: GridRect = { gx: coreX + uW - armW, gy: hallY + hallH, gw: armW, gh: armH };
    let armBays = [westArm, eastArm];
    for (const blk of fixedBlockers) {
      armBays = armBays.flatMap((b) => subtractRect2D(b, blk));
    }

    const combinedBays = [...northBays, ...armBays];
    const horizFlags = [...northBays.map(() => true), ...armBays.map(() => false)];
    const remBudget = Math.max(combinedBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(combinedBays, remBudget, horizFlags);
    combinedBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, horizFlags[idx], counts[idx], 2, true)) {
        if (canPlaceSafe(r)) {
          placed.push({
            rect: r,
            isHallway: false,
            zone: horizFlags[idx] ? 'north' : 'wing',
            flavor: nextFlavor(false),
          });
        }
      }
    });
  } else if (simpleTopology === 'central-commons') {
    const bpHubX = coreX + Math.floor((coreW - 4) / 2);
    const hasStairs = Boolean(upStairRect || downStairRect);
    const hubW = hasStairs ? 5 : randInt(4, 6);
    const hubH = randInt(4, 5);
    const hubX = hasStairs ? bpHubX : coreX + Math.floor((coreW - hubW) / 2);
    const hubY = hallY - 1;
    const hubRect: GridRect = { gx: hubX, gy: hubY, gw: hubW, gh: hubH };
    if (canPlaceSafe(hubRect)) {
      const hubFlavor =
        options.archetype === 'tavern'
          ? {
              name: 'Common Taproom',
              type: 'room' as RoomType,
              material: 'wood' as FloorMaterial,
              lighting: 'bright' as LightingLevel,
              notes: 'Central oak taproom anchored by a roaring stone hearth.',
            }
          : options.archetype === 'temple'
            ? {
                name: 'Chapel Nave',
                type: 'room' as RoomType,
                material: 'checkered' as FloorMaterial,
                lighting: 'bright' as LightingLevel,
                notes: 'Central chapel floor surrounded by vestry alcoves.',
              }
            : options.archetype === 'blacksmith'
              ? {
                  name: 'Central Forge Floor',
                  type: 'room' as RoomType,
                  material: 'cobble' as FloorMaterial,
                  lighting: 'bright' as LightingLevel,
                  notes: 'Soot-darkened central forge anchored by twin hearth chimneys and anvil blocks.',
                }
              : {
                  name: 'Central Keep Hall',
                  type: 'room' as RoomType,
                  material: hallMat,
                  lighting: 'bright' as LightingLevel,
                  notes: 'Compact fortified common hall serving satellite rooms.',
                };
      tryPush({ rect: hubRect, isHallway: false, isSignatureWing: true, flavor: hubFlavor });
    }

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = { gx: hubX + 1, gy: hubY + hubH, gw: 3, gh: 2 };
      if (canPlaceSafe(fRect)) {
        entryChamber = {
          rect: fRect,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }

    const candidates: GridRect[] = shuffleArray([
      { gx: hubX, gy: hubY - 3, gw: hubW, gh: 3 },
      { gx: hubX - 3, gy: hubY, gw: 3, gh: Math.max(3, hubH - 1) },
      { gx: hubX + hubW, gy: hubY, gw: 3, gh: Math.max(3, hubH - 1) },
      { gx: hubX - 4, gy: hubY + 2, gw: 4, gh: 3 },
      { gx: hubX + hubW, gy: hubY + 2, gw: 4, gh: 3 },
    ]);
    for (const c of candidates) {
      if (placed.length >= targetRoomCount) break;
      if (canPlaceSafe(c)) {
        tryPush({ rect: c, isHallway: false, flavor: nextFlavor(false) });
      }
    }
  } else {
    // 'linear-h' with reshaped corridor geometry (flared-hub, cranked-Z, or T-gallery)
    const hallShapeRoll = Math.random();
    const midX = coreX + Math.floor(coreW / 2);
    const baseSpine: GridRect = { gx: coreX, gy: hallY, gw: coreW, gh: hallH };
    const hallSubs: GridRect[] =
      hallShapeRoll < 0.38
        ? // Flared central vestibule gallery
          [baseSpine, { gx: midX - 2, gy: hallY - 1, gw: 4, gh: 4 }]
        : hallShapeRoll < 0.72
          ? // T-shaped gallery branching into a cross corridor
            [baseSpine, { gx: midX - 1, gy: hallY - northH, gw: 2, gh: northH }]
          : // Cranked / jogged Z-stepped gallery
            [
              { gx: coreX, gy: hallY, gw: 3, gh: hallH },
              { gx: coreX + 2, gy: hallY + 1, gw: Math.max(4, coreW - 4), gh: hallH },
              { gx: coreX + coreW - 3, gy: hallY, gw: 3, gh: hallH },
            ];

    const hHallFlavor: RoomFlavor = {
      name:
        elevationOrder > 0
          ? 'Upper Gallery'
          : elevationOrder < 0
            ? 'Undercroft Passage'
            : 'Central Gallery',
      type: 'hallway',
      material: hallMat,
      lighting: elevationOrder < 0 ? 'darkness' : 'dim',
      notes: 'Articulated primary gallery accessing surrounding chambers.',
    };
    if (!tryPush(buildHallwayChamber(hallSubs, hHallFlavor))) {
      tryPush(buildHallwayChamber([baseSpine], hHallFlavor));
    }

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fw = 3;
      const fh = randInt(2, 3);
      const fx = coreX + Math.floor((coreW - fw) / 2);
      const foyerY = hallShapeRoll >= 0.72 || hallShapeRoll < 0.38 ? hallY + hallH + 1 : hallY + hallH;
      const candidateFoyer: GridRect = { gx: fx, gy: foyerY, gw: fw, gh: fh };
      if (canPlaceSafe(candidateFoyer)) {
        entryChamber = {
          rect: candidateFoyer,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({
          gx: candidateFoyer.gx,
          gy: candidateFoyer.gy + candidateFoyer.gh,
          gw: candidateFoyer.gw,
          gh: 2,
        });
      }
    }

    const northBand: GridRect = { gx: coreX, gy: hallY - northH, gw: coreW, gh: northH };
    const southBand: GridRect = { gx: coreX, gy: hallY + hallH, gw: coreW, gh: southH + 1 };
    let northBays = [northBand];
    let southBays = [southBand];
    for (const blk of fixedBlockers) {
      northBays = northBays.flatMap((b) => subtractRect2D(b, blk));
      southBays = southBays.flatMap((b) => subtractRect2D(b, blk));
    }

    const allBays = [...northBays, ...southBays];
    const remBudget = Math.max(allBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(allBays, remBudget, allBays.map(() => true));
    allBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, true, counts[idx], 2, true)) {
        if (canPlaceSafe(r)) placed.push({ rect: r, isHallway: false, flavor: nextFlavor(false) });
      }
    });
  }

  resizeAndArticulateChambers(placed, targetRoomCount, reservedZones, options);

  attachArchetypeBalconies(
    placed,
    reservedZones,
    options.archetype,
    elevationOrder,
    options.complexity,
    targetRoomCount
  );

  if (options.includeSecretPassages && placed.length >= 4 && Math.random() < 0.45) {
    const outerLeaves = placed.filter(
      (p) => !p.isHallway && !p.stairRole && !p.isFoyer && !p.isBalcony
    );
    if (outerLeaves.length > 0) {
      outerLeaves[outerLeaves.length - 1].flavor = nextFlavor(true);
    }
  }

  balancePlacedChambers(placed, targetRoomCount, nextFlavor, reservedZones);

  return finalizePlacedFloor(
    placed,
    floorId,
    floorName,
    elevationOrder,
    options,
    hasExteriorEntrance,
    idSuffix,
    simpleTopology === 'linear-h' || simpleTopology === 'linear-v',
    coreX,
    coreW,
    entryChamber,
    reservedExtEdge
  );
}

/**
 * 2. Standard Winged Floor Generator:
 * Distinct functional wings & archetype-informed floorplans:
 * bilateral-wings, u-courtyard, cruciform-nave, radial-spire, or staggered-compound.
 */
function generateStandardWingedFloor(
  floorId: string,
  floorName: string,
  elevationOrder: number,
  options: ProceduralLayoutOptions,
  blueprint: SharedLayoutBlueprint,
  upStairRect: GridRect | undefined,
  downStairRect: GridRect | undefined,
  hasExteriorEntrance: boolean,
  targetRoomCount: number,
  seedOffset: number
): GeneratedFloorBundle {
  const idSuffix = `${Date.now()}-${seedOffset}`;
  const placed: PlacedChamber[] = [];
  const reservedZones: GridRect[] = [];
  const fixedBlockers: GridRect[] = [];
  const nextFlavor = createFlavorPicker(options.archetype, elevationOrder, false);
  const profile = ARCHETYPE_STRUCTURE_PROFILES[options.archetype];
  const hallMat = getFloorHallMaterial(options.archetype, elevationOrder);

  makeStairChambers(
    placed,
    fixedBlockers,
    options,
    elevationOrder,
    upStairRect,
    downStairRect,
    targetRoomCount
  );

  const canPlaceSafe = (r: GridRect): boolean =>
    !placed.some((p) => chamberOverlapsRect(p, r)) &&
    !reservedZones.some((z) => rectsOverlap(z, r));

  const tryPush = (c: PlacedChamber): boolean => {
    const subs = chamberSubRects(c);
    if (!subs.every((sr) => canPlaceSafe(sr))) return false;
    placed.push(c);
    fixedBlockers.push(...subs);
    return true;
  };

  const { coreX, hallY, coreW, northH, southH, standardTopology } = blueprint;
  const hallH = 2;
  let entryChamber: PlacedChamber | undefined;
  let isSymmetric = standardTopology === 'bilateral-wings' || standardTopology === 'cruciform-nave';

  const makeSignatureCenterFlavor = (): RoomFlavor => ({
    name:
      options.archetype === 'temple'
        ? 'High Sanctum'
        : options.archetype === 'fortress'
          ? 'Great Hall of Banners'
          : options.archetype === 'manor'
            ? 'Grand Reception Salon'
            : options.archetype === 'blacksmith'
              ? 'Grand Foundry Hall'
              : options.archetype === 'jail'
                ? 'Panopticon Watchtower'
                : options.archetype === 'tavern'
                  ? 'Grand Common Taproom'
                  : 'Guild Assembly Hall',
    type: 'room',
    material:
      options.archetype === 'manor' || options.archetype === 'temple'
        ? 'marble'
        : options.archetype === 'blacksmith'
          ? 'cobble'
          : options.archetype === 'tavern'
            ? 'wood'
            : 'stone',
    lighting: elevationOrder < 0 ? 'dim' : 'bright',
    notes: 'Monumental primary heart of the complex.',
  });

  if (standardTopology === 'l-wing') {
    isSymmetric = false;
    const armLeft = blueprint.lArmLeft;
    const armUp = blueprint.lArmUp;
    const vLen = randInt(7, 9);
    const wingW = randInt(3, 4);
    const outerHDepth = armUp ? southH : northH;
    const outerHY = armUp ? hallY + 2 : hallY - outerHDepth;

    const hHallRect: GridRect = { gx: coreX, gy: hallY, gw: coreW, gh: hallH };
    const vHallX = armLeft ? coreX : coreX + coreW - 2;
    const vHallY = armUp ? hallY - vLen : hallY + 2;
    const vHallRect: GridRect = { gx: vHallX, gy: vHallY, gw: 2, gh: vLen };
    const elbowLanding: GridRect | null =
      Math.random() < 0.6
        ? {
            gx: armLeft ? coreX - 1 : coreX + coreW - 2,
            gy: armUp ? hallY - 1 : hallY,
            gw: 3,
            gh: 3,
          }
        : null;

    tryPush(
      buildHallwayChamber(elbowLanding ? [hHallRect, vHallRect, elbowLanding] : [hHallRect, vHallRect], {
        name: elevationOrder < 0 ? 'Lower Elbow Passage' : 'Grand L-Gallery',
        type: 'hallway',
        material: hallMat,
        lighting: elevationOrder < 0 ? 'darkness' : 'bright',
        notes: 'Continuous L-shaped gallery sweeping cleanly into the perpendicular wing.',
      })
    );

    // Reserve the inner L concavity + outer buffer so room growth & balconies never square off the L
    const innerPocketX = armLeft ? coreX + 2 : coreX - 6;
    const innerPocketW = armLeft ? coreW + 6 : coreW + 4;
    const innerPocketY = armUp ? hallY - vLen - 6 : hallY + 2;
    const innerPocketH = vLen + 6;
    reservedZones.push({
      gx: innerPocketX,
      gy: innerPocketY,
      gw: innerPocketW,
      gh: innerPocketH,
    });

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = armUp
        ? {
            gx: coreX + Math.floor((coreW - 3) / 2),
            gy: outerHY + outerHDepth,
            gw: 3,
            gh: 2,
          }
        : {
            gx: armLeft ? coreX - 1 : coreX + coreW - 2,
            gy: hallY + 2 + vLen,
            gw: 3,
            gh: 2,
          };
      if (canPlaceSafe(fRect)) {
        entryChamber = {
          rect: fRect,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }

    const outerHStrip: GridRect = {
      gx: armLeft ? coreX - wingW : coreX,
      gy: outerHY,
      gw: coreW + wingW,
      gh: outerHDepth,
    };
    let hBays = [outerHStrip];
    for (const blk of fixedBlockers) hBays = hBays.flatMap((b) => subtractRect2D(b, blk));

    const outerVStrip: GridRect = {
      gx: armLeft ? coreX - wingW : coreX + coreW,
      gy: armUp ? hallY - vLen : hallY,
      gw: wingW,
      gh: vLen + 2,
    };
    let vBays = [outerVStrip];
    for (const blk of fixedBlockers) vBays = vBays.flatMap((b) => subtractRect2D(b, blk));

    const allBays = [...hBays, ...vBays];
    const hFlags = [...hBays.map(() => true), ...vBays.map(() => false)];
    const remBudget = Math.max(allBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(allBays, remBudget, hFlags);

    let placedSignature = false;
    allBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, hFlags[idx], counts[idx], 2, true)) {
        const useSig = !placedSignature && r.gw * r.gh >= 9;
        if (useSig) placedSignature = true;
        tryPush({
          rect: r,
          isHallway: false,
          isSignatureWing: useSig,
          zone: hFlags[idx] ? (armUp ? 'south' : 'north') : armLeft ? 'flank-left' : 'flank-right',
          flavor: useSig ? makeSignatureCenterFlavor() : nextFlavor(false),
        });
      }
    });
  } else if (standardTopology === 'u-courtyard') {
    const courtW = randInt(4, 6);
    const courtH = randInt(4, 6);
    const courtX = coreX + Math.floor((coreW - courtW) / 2);
    const courtY = hallY + hallH;

    // Unified U-shaped Cloister / Gallery wrapping all 3 inner sides of the court!
    const northSpine: GridRect = { gx: coreX, gy: hallY, gw: coreW, gh: hallH };
    const westHall: GridRect = { gx: courtX - 2, gy: courtY, gw: 2, gh: courtH };
    const eastHall: GridRect = { gx: courtX + courtW, gy: courtY, gw: 2, gh: courtH };
    const uGallery = buildHallwayChamber([northSpine, westHall, eastHall], {
      name: options.archetype === 'temple' ? 'Cloister Arcade' : 'U-Court Gallery',
      type: 'hallway',
      material: hallMat,
      lighting: elevationOrder < 0 ? 'darkness' : 'bright',
      notes: 'Continuous U-shaped colonnade wrapping the central courtyard.',
    });
    tryPush(uGallery);

    // Central Courtyard (or empty exterior recess when subterranean / courtyard skipped)
    const courtRect: GridRect = { gx: courtX, gy: courtY, gw: courtW, gh: courtH };
    const allowOpenCourt =
      elevationOrder >= 0 &&
      profile.courtyardChance > 0 &&
      Math.random() < Math.max(0.55, profile.courtyardChance + 0.15);
    let courtChamber: PlacedChamber | undefined;
    if (allowOpenCourt && canPlaceSafe(courtRect)) {
      courtChamber = {
        rect: courtRect,
        isHallway: false,
        flavor: {
          name: profile.courtyardFlavor.name,
          type: 'courtyard',
          material: profile.courtyardFlavor.material,
          lighting: 'bright',
          notes: profile.courtyardFlavor.notes,
        },
      };
      tryPush(courtChamber);
    } else {
      reservedZones.push(courtRect);
    }

    // Reserve the South mouth opening so the U silhouette never closes into an O or solid block
    reservedZones.push({
      gx: courtX,
      gy: courtY + courtH,
      gw: courtW,
      gh: 6,
    });

    const armW = randInt(3, 4);
    let nBays = [{ gx: coreX, gy: hallY - northH, gw: coreW, gh: northH }];
    for (const blk of fixedBlockers) nBays = nBays.flatMap((b) => subtractRect2D(b, blk));
    let wBays = [{ gx: courtX - 2 - armW, gy: courtY, gw: armW, gh: courtH }];
    let eBays = [{ gx: courtX + courtW + 2, gy: courtY, gw: armW, gh: courtH }];
    for (const blk of fixedBlockers) {
      wBays = wBays.flatMap((b) => subtractRect2D(b, blk));
      eBays = eBays.flatMap((b) => subtractRect2D(b, blk));
    }

    const allBays = [...nBays, ...wBays, ...eBays];
    const hFlags = [...nBays.map(() => true), ...wBays.map(() => false), ...eBays.map(() => false)];
    const zones: PlacedChamber['zone'][] = [
      ...nBays.map(() => 'north' as const),
      ...wBays.map(() => 'flank-left' as const),
      ...eBays.map(() => 'flank-right' as const),
    ];
    const remBudget = Math.max(allBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(allBays, remBudget, hFlags);

    let placedNorthSig = false;
    allBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, hFlags[idx], counts[idx], 2, true)) {
        const useSig = zones[idx] === 'north' && !placedNorthSig && r.gw >= 3;
        if (useSig) placedNorthSig = true;
        tryPush({
          rect: r,
          isHallway: false,
          isSignatureWing: useSig,
          zone: zones[idx],
          flavor: useSig ? makeSignatureCenterFlavor() : nextFlavor(false),
        });
      }
    });

    if (hasExteriorEntrance) {
      entryChamber = courtChamber ?? uGallery;
    }
  } else if (standardTopology === 'o-ring') {
    const courtW = Math.max(4, coreW - 8);
    const courtH = randInt(4, 6);
    const westInnerW = Math.floor((coreW - courtW) / 2);
    const courtX = coreX + westInnerW;
    const courtY = hallY + hallH;
    const midX = coreX + Math.floor(coreW / 2);

    // 2 continuous C-shaped ambulatories forming a closed O-ring (frees 2 chamber slots!)
    const westCSubs: GridRect[] = [
      { gx: coreX, gy: hallY, gw: midX - coreX, gh: hallH },
      { gx: courtX - 2, gy: courtY, gw: 2, gh: courtH },
      { gx: coreX, gy: courtY + courtH, gw: midX - coreX, gh: hallH },
    ];
    const eastCSubs: GridRect[] = [
      { gx: midX, gy: hallY, gw: coreX + coreW - midX, gh: hallH },
      { gx: courtX + courtW, gy: courtY, gw: 2, gh: courtH },
      { gx: midX, gy: courtY + courtH, gw: coreX + coreW - midX, gh: hallH },
    ];
    tryPush(
      buildHallwayChamber(westCSubs, {
        name: options.archetype === 'temple' ? 'West Cloister Ring' : 'West Ring Gallery',
        type: 'hallway',
        material: hallMat,
        lighting: elevationOrder < 0 ? 'darkness' : 'bright',
        notes: 'Western C-shaped gallery forming half of the closed O-ring.',
      })
    );
    tryPush(
      buildHallwayChamber(eastCSubs, {
        name: options.archetype === 'temple' ? 'East Cloister Ring' : 'East Ring Gallery',
        type: 'hallway',
        material: hallMat,
        lighting: elevationOrder < 0 ? 'darkness' : 'bright',
        notes: 'Eastern C-shaped gallery completing the closed O-ring.',
      })
    );

    const courtRect: GridRect = { gx: courtX, gy: courtY, gw: courtW, gh: courtH };
    const allowOpenCourt =
      elevationOrder >= 0 &&
      profile.courtyardChance > 0 &&
      Math.random() < Math.max(0.45, profile.courtyardChance);
    if (allowOpenCourt && canPlaceSafe(courtRect)) {
      tryPush({
        rect: courtRect,
        isHallway: false,
        flavor: {
          name: profile.courtyardFlavor.name,
          type: 'courtyard',
          material: profile.courtyardFlavor.material,
          lighting: 'bright',
          notes: profile.courtyardFlavor.notes,
        },
      });
    } else {
      reservedZones.push(courtRect);
    }

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = {
        gx: coreX + Math.floor((coreW - 3) / 2),
        gy: courtY + courtH + hallH,
        gw: 3,
        gh: 2,
      };
      if (canPlaceSafe(fRect)) {
        entryChamber = {
          rect: fRect,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }

    let nBays = [{ gx: coreX, gy: hallY - northH, gw: coreW, gh: northH }];
    let sBays = [{ gx: coreX, gy: courtY + courtH + hallH, gw: coreW, gh: southH }];
    for (const blk of fixedBlockers) {
      nBays = nBays.flatMap((b) => subtractRect2D(b, blk));
      sBays = sBays.flatMap((b) => subtractRect2D(b, blk));
    }
    const westOuter: GridRect = {
      gx: coreX - 1,
      gy: courtY,
      gw: Math.max(2, courtX - 2 - (coreX - 1)),
      gh: courtH,
    };
    const eastOuter: GridRect = {
      gx: courtX + courtW + 2,
      gy: courtY,
      gw: Math.max(2, coreX + coreW + 1 - (courtX + courtW + 2)),
      gh: courtH,
    };

    const allBays = [...nBays, ...sBays, westOuter, eastOuter];
    const hFlags = [...nBays.map(() => true), ...sBays.map(() => true), false, false];
    const zones: PlacedChamber['zone'][] = [
      ...nBays.map(() => 'north' as const),
      ...sBays.map(() => 'south' as const),
      'flank-left',
      'flank-right',
    ];
    const remBudget = Math.max(allBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(allBays, remBudget, hFlags);

    let placedSig = false;
    allBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, hFlags[idx], counts[idx], 2, true)) {
        const useSig = zones[idx] === 'north' && !placedSig && r.gw >= 3;
        if (useSig) placedSig = true;
        tryPush({
          rect: r,
          isHallway: false,
          isSignatureWing: useSig,
          zone: zones[idx],
          flavor: useSig ? makeSignatureCenterFlavor() : nextFlavor(false),
        });
      }
    });
  } else if (standardTopology === 'cruciform-nave') {
    const naveW = randInt(3, 5);
    const naveH = randInt(6, 8);
    const naveX = coreX + Math.floor((coreW - naveW) / 2);
    const naveY = hallY - 2;
    let naveSegs = [{ gx: naveX, gy: naveY, gw: naveW, gh: naveH }];
    for (const blk of fixedBlockers) naveSegs = naveSegs.flatMap((s) => subtractRect2D(s, blk));
    const naveRect = naveSegs[0] ?? { gx: naveX, gy: naveY, gw: naveW, gh: naveH };
    tryPush({
      rect: naveRect,
      isHallway: false,
      isSignatureWing: true,
      flavor:
        options.archetype === 'temple'
          ? {
              name: 'Sanctuary Nave',
              type: 'room',
              material: 'checkered',
              lighting: 'bright',
              notes: 'Processional hall lined with tall stone pillars.',
            }
          : {
              name: 'Great Processional Hall',
              type: 'room',
              material: hallMat,
              lighting: 'bright',
              notes: 'Long central nave anchoring crossing transepts.',
            },
    });

    const apseW = naveW + 2;
    const apseRect: GridRect = { gx: naveX - 1, gy: naveRect.gy - northH, gw: apseW, gh: northH };
    tryPush({
      rect: apseRect,
      isHallway: false,
      isSignatureWing: true,
      zone: 'north',
      flavor: makeSignatureCenterFlavor(),
    });

    // Crossing West & East L-shaped / flared Transept galleries
    const trH = 3;
    const trY = naveRect.gy + 2;
    const wTrLen = randInt(4, 6);
    const eTrLen = randInt(4, 6);
    tryPush(
      buildHallwayChamber(
        [
          { gx: naveX - 2, gy: trY, gw: 2, gh: trH },
          { gx: naveX - 4, gy: trY + 1, gw: 2, gh: 2 },
        ],
        { name: 'West Transept', type: 'hallway', material: hallMat, lighting: 'dim', notes: 'Stepped western crossing arm.' },
        'wing'
      )
    );
    tryPush(
      buildHallwayChamber(
        [
          { gx: naveX + naveW, gy: trY, gw: 2, gh: trH },
          { gx: naveX + naveW + 2, gy: trY + 1, gw: 2, gh: 2 },
        ],
        { name: 'East Transept', type: 'hallway', material: hallMat, lighting: 'dim', notes: 'Stepped eastern crossing arm.' },
        'wing'
      )
    );

    const wWingStrip: GridRect = { gx: naveX - 4 - wTrLen, gy: trY - 1, gw: wTrLen, gh: 4 };
    const eWingStrip: GridRect = { gx: naveX + naveW + 4, gy: trY - 1, gw: eTrLen, gh: 4 };
    const wingBudget = Math.max(2, targetRoomCount - placed.length - (hasExteriorEntrance ? 1 : 0));
    const wingCounts = allocateCountsAcrossStrips([wWingStrip, eWingStrip], wingBudget, [true, true]);
    for (const r of splitStripWithVariety(wWingStrip, true, wingCounts[0], 2, true)) {
      tryPush({ rect: r, isHallway: false, zone: 'flank-left', flavor: nextFlavor(false) });
    }
    for (const r of splitStripWithVariety(eWingStrip, true, wingCounts[1], 2, true)) {
      tryPush({ rect: r, isHallway: false, zone: 'flank-right', flavor: nextFlavor(false) });
    }

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = { gx: naveX, gy: naveRect.gy + naveRect.gh, gw: naveW, gh: 2 };
      if (canPlaceSafe(fRect)) {
        entryChamber = {
          rect: fRect,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }
  } else if (standardTopology === 'radial-spire') {
    isSymmetric = false;
    const midX = coreX + Math.floor(coreW / 2);
    const hubW = randInt(4, 6);
    const hubH = randInt(4, 5);
    const hubX = midX - Math.floor(hubW / 2);
    const hubY = hallY - 1;
    let hubSegs = [{ gx: hubX, gy: hubY, gw: hubW, gh: hubH }];
    for (const blk of fixedBlockers) hubSegs = hubSegs.flatMap((s) => subtractRect2D(s, blk));
    const hubRect = hubSegs[0] ?? { gx: hubX, gy: hubY, gw: hubW, gh: hubH };
    tryPush({
      rect: hubRect,
      isHallway: false,
      isSignatureWing: true,
      flavor: makeSignatureCenterFlavor(),
    });

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = { gx: hubRect.gx + 1, gy: hubRect.gy + hubRect.gh, gw: Math.max(3, hubRect.gw - 2), gh: 2 };
      if (canPlaceSafe(fRect)) {
        entryChamber = {
          rect: fRect,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }

    const nSpoke: GridRect = { gx: midX - 1, gy: hubRect.gy - 2, gw: 2, gh: 2 };
    if (tryPush({ rect: nSpoke, isHallway: true, flavor: { name: 'North Spoke', type: 'hallway', material: hallMat, lighting: 'dim', notes: 'Radial nexus passage.' } })) {
      if (placed.length < targetRoomCount) {
        tryPush({ rect: { gx: nSpoke.gx - 1, gy: nSpoke.gy - 4, gw: 5, gh: 4 }, isHallway: false, isSignatureWing: true, zone: 'north', flavor: nextFlavor(false) });
      }
    }
    if (placed.length < targetRoomCount) {
      const wSpokeSubs: GridRect[] = [
        { gx: hubRect.gx - 2, gy: hubRect.gy + 1, gw: 2, gh: 2 },
        { gx: hubRect.gx - 4, gy: hubRect.gy + 2, gw: 2, gh: 2 },
      ];
      if (tryPush(buildHallwayChamber(wSpokeSubs, { name: 'West Spoke', type: 'hallway', material: hallMat, lighting: 'dim', notes: 'Stepped western radial passage.' }))) {
        if (placed.length < targetRoomCount) {
          tryPush({ rect: { gx: hubRect.gx - 6, gy: hubRect.gy - 1, gw: 4, gh: 3 }, isHallway: false, zone: 'flank-left', flavor: nextFlavor(false) });
        }
        if (placed.length < targetRoomCount) {
          tryPush({ rect: { gx: hubRect.gx - 7, gy: hubRect.gy + 2, gw: 3, gh: 4 }, isHallway: false, zone: 'wing', flavor: nextFlavor(false) });
        }
      }
    }
    if (placed.length < targetRoomCount) {
      const eSpokeSubs: GridRect[] = [
        { gx: hubRect.gx + hubRect.gw, gy: hubRect.gy + 1, gw: 2, gh: 2 },
        { gx: hubRect.gx + hubRect.gw + 2, gy: hubRect.gy, gw: 2, gh: 2 },
      ];
      if (tryPush(buildHallwayChamber(eSpokeSubs, { name: 'East Spoke', type: 'hallway', material: hallMat, lighting: 'dim', notes: 'Stepped eastern radial passage.' }))) {
        if (placed.length < targetRoomCount) {
          tryPush({ rect: { gx: hubRect.gx + hubRect.gw + 4, gy: hubRect.gy - 2, gw: 4, gh: 4 }, isHallway: false, zone: 'flank-right', flavor: nextFlavor(false) });
        }
        if (placed.length < targetRoomCount) {
          tryPush({ rect: { gx: hubRect.gx + hubRect.gw + 2, gy: hubRect.gy + 2, gw: 4, gh: 3 }, isHallway: false, zone: 'wing', flavor: nextFlavor(false) });
        }
      }
    }
  } else if (standardTopology === 'staggered-compound') {
    isSymmetric = false;
    const eastShift = randInt(0, 1);
    const hallSubs: GridRect[] = [
      { gx: coreX, gy: hallY, gw: coreW, gh: hallH },
      { gx: coreX + coreW, gy: hallY + eastShift, gw: 3, gh: 2 },
      { gx: coreX + Math.floor(coreW * 0.45), gy: hallY - 1, gw: 3, gh: 3 },
    ];
    tryPush(
      buildHallwayChamber(hallSubs, {
        name: 'Compound Gallery',
        type: 'hallway',
        material: hallMat,
        lighting: 'dim',
        notes: 'Stepped offset thoroughfare joining staggered wings.',
      })
    );

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fRect: GridRect = { gx: coreX + 1, gy: hallY + hallH, gw: 3, gh: 2 };
      if (canPlaceSafe(fRect)) {
        entryChamber = { rect: fRect, isHallway: false, isFoyer: true, flavor: makeEntryFlavor(options.archetype) };
        tryPush(entryChamber);
        reservedZones.push({ gx: fRect.gx, gy: fRect.gy + fRect.gh, gw: fRect.gw, gh: 2 });
      }
    }

    const nwW = Math.max(4, Math.floor(coreW * 0.45));
    tryPush({
      rect: { gx: coreX, gy: hallY - northH - 1, gw: nwW, gh: northH + 1 },
      isHallway: false,
      isSignatureWing: true,
      zone: 'north',
      flavor: makeSignatureCenterFlavor(),
    });
    const neRect: GridRect = { gx: coreX + nwW, gy: hallY - northH, gw: coreW - nwW, gh: northH };
    let neBays = [neRect];
    for (const blk of fixedBlockers) neBays = neBays.flatMap((b) => subtractRect2D(b, blk));
    for (const neb of neBays) {
      for (const r of splitStripWithVariety(neb, true, 2, 2, true)) {
        tryPush({ rect: r, isHallway: false, zone: 'north', flavor: nextFlavor(false) });
      }
    }

    const westShift = randInt(-3, -1);
    tryPush({ rect: { gx: coreX - 4, gy: hallY + westShift, gw: 4, gh: 4 }, isHallway: false, zone: 'flank-left', flavor: nextFlavor(false) });
    tryPush({ rect: { gx: coreX + coreW + 3, gy: hallY + eastShift - 2, gw: 4, gh: 3 }, isHallway: false, zone: 'wing', flavor: nextFlavor(false) });
    tryPush({ rect: { gx: coreX + coreW + 3, gy: hallY + eastShift + 1, gw: 3, gh: 4 }, isHallway: false, zone: 'flank-right', flavor: nextFlavor(false) });

    let sBays = [{ gx: coreX, gy: hallY + hallH, gw: coreW, gh: southH }];
    for (const blk of fixedBlockers) sBays = sBays.flatMap((b) => subtractRect2D(b, blk));
    const remBudget = Math.max(sBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(sBays, remBudget, sBays.map(() => true));
    sBays.forEach((sb, idx) => {
      for (const r of splitStripWithVariety(sb, true, counts[idx], 2, true)) {
        tryPush({ rect: r, isHallway: false, zone: 'south', flavor: nextFlavor(false) });
      }
    });
  } else {
    // 'bilateral-wings' with unified H-shaped / flared Central Gallery Polygon
    const asym = Math.random() < 0.45;
    if (asym) isSymmetric = false;

    const wOffsetY = asym ? randInt(-2, 0) : -1;
    const eOffsetY = asym ? randInt(-2, 0) : -1;
    const wingW = randInt(3, 4);

    const hHallSubs: GridRect[] = [
      { gx: coreX, gy: hallY, gw: coreW, gh: hallH },
      { gx: coreX - 2, gy: hallY + wOffsetY, gw: 2, gh: 4 },
      { gx: coreX + coreW, gy: hallY + eOffsetY, gw: 2, gh: 4 },
    ];
    if (Math.random() < 0.55) {
      hHallSubs.push({
        gx: coreX + Math.floor((coreW - 4) / 2),
        gy: hallY - 1,
        gw: 4,
        gh: 3,
      });
    }

    tryPush(
      buildHallwayChamber(hHallSubs, {
        name:
          elevationOrder > 0
            ? 'Upper Grand Gallery'
            : elevationOrder < 0
              ? 'Undercroft Gallery'
              : 'Central Great Gallery',
        type: 'hallway',
        material: hallMat,
        lighting: elevationOrder < 0 ? 'darkness' : 'bright',
        notes: 'Sweeping H-shaped gallery linking the central hall and flanking wings.',
      })
    );

    if (hasExteriorEntrance && placed.length < targetRoomCount) {
      const fw = randInt(3, 4);
      const fh = randInt(2, 3);
      const fx = coreX + Math.floor((coreW - fw) / 2);
      const candidateFoyer: GridRect = { gx: fx, gy: hallY + hallH, gw: fw, gh: fh };
      if (canPlaceSafe(candidateFoyer)) {
        entryChamber = {
          rect: candidateFoyer,
          isHallway: false,
          isFoyer: true,
          flavor: makeEntryFlavor(options.archetype),
        };
        tryPush(entryChamber);
        reservedZones.push({
          gx: candidateFoyer.gx,
          gy: candidateFoyer.gy + candidateFoyer.gh,
          gw: candidateFoyer.gw,
          gh: 2,
        });
      }
    }

    const northCenterW = Math.max(4, coreW - 6);
    const northCenterX = coreX + Math.floor((coreW - northCenterW) / 2);
    let nBays = [{ gx: northCenterX, gy: hallY - northH, gw: northCenterW, gh: northH }];
    for (const blk of fixedBlockers) nBays = nBays.flatMap((b) => subtractRect2D(b, blk));
    if (nBays.length > 0) {
      tryPush({
        rect: nBays[0],
        isHallway: false,
        isSignatureWing: true,
        zone: 'north',
        flavor: makeSignatureCenterFlavor(),
      });
    }

    const wStrip: GridRect = { gx: coreX - 2 - wingW, gy: hallY + wOffsetY - 1, gw: wingW, gh: 6 };
    const eStrip: GridRect = { gx: coreX + coreW + 2, gy: hallY + eOffsetY - 1, gw: wingW, gh: 6 };
    let southBays = [{ gx: coreX, gy: hallY + hallH, gw: coreW, gh: southH }];
    for (const blk of fixedBlockers) {
      southBays = southBays.flatMap((b) => subtractRect2D(b, blk));
    }

    const wingBays = [wStrip, eStrip, ...southBays];
    const hFlags = [false, false, ...southBays.map(() => true)];
    const zones: PlacedChamber['zone'][] = ['flank-left', 'flank-right', ...southBays.map(() => 'south' as const)];
    const remBudget = Math.max(wingBays.length, targetRoomCount - placed.length);
    const counts = allocateCountsAcrossStrips(wingBays, remBudget, hFlags);

    wingBays.forEach((bay, idx) => {
      for (const r of splitStripWithVariety(bay, hFlags[idx], counts[idx], 2, true)) {
        tryPush({ rect: r, isHallway: false, zone: zones[idx], flavor: nextFlavor(false) });
      }
    });
  }

  resizeAndArticulateChambers(placed, targetRoomCount, reservedZones, options);

  attachArchetypeBalconies(
    placed,
    reservedZones,
    options.archetype,
    elevationOrder,
    options.complexity,
    targetRoomCount
  );

  if (options.includeSecretPassages && placed.length >= 6) {
    const wingLeaves = placed.filter(
      (p) => !p.isHallway && !p.stairRole && !p.isFoyer && !p.isBalcony && !p.isSignatureWing
    );
    if (wingLeaves.length > 0) {
      wingLeaves[wingLeaves.length - 1].flavor = nextFlavor(true);
    }
  }

  balancePlacedChambers(placed, targetRoomCount, nextFlavor, reservedZones);

  return finalizePlacedFloor(
    placed,
    floorId,
    floorName,
    elevationOrder,
    options,
    hasExteriorEntrance,
    idSuffix,
    isSymmetric,
    coreX,
    coreW,
    entryChamber,
    2
  );
}


interface PxBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function pxBoxesOverlap(a: PxBox, b: PxBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function segmentsProperlyIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  const eps = 1e-3;
  return (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  );
}

function polygonsStrictlyOverlap(polyA: Point[], polyB: Point[]): boolean {
  const boxA = getPolygonBoundingBox(polyA);
  const boxB = getPolygonBoundingBox(polyB);
  if (
    boxA.maxX <= boxB.minX + 1.5 ||
    boxB.maxX <= boxA.minX + 1.5 ||
    boxA.maxY <= boxB.minY + 1.5 ||
    boxB.maxY <= boxA.minY + 1.5
  ) {
    return false;
  }

  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i];
    const a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const b1 = polyB[j];
      const b2 = polyB[(j + 1) % polyB.length];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }

  for (let i = 0; i < polyA.length; i++) {
    const pt = polyA[i];
    if (pointInPolygon(pt, polyB) && minDistToBoundary(pt, polyB) > 2.5) return true;
    const nxt = polyA[(i + 1) % polyA.length];
    const mid = { x: (pt.x + nxt.x) * 0.5, y: (pt.y + nxt.y) * 0.5 };
    if (pointInPolygon(mid, polyB) && minDistToBoundary(mid, polyB) > 2.5) return true;
  }

  for (let j = 0; j < polyB.length; j++) {
    const pt = polyB[j];
    if (pointInPolygon(pt, polyA) && minDistToBoundary(pt, polyA) > 2.5) return true;
    const nxt = polyB[(j + 1) % polyB.length];
    const mid = { x: (pt.x + nxt.x) * 0.5, y: (pt.y + nxt.y) * 0.5 };
    if (pointInPolygon(mid, polyA) && minDistToBoundary(mid, polyA) > 2.5) return true;
  }

  return false;
}

function finalizePlacedFloor(
  placed: PlacedChamber[],
  floorId: string,
  floorName: string,
  elevationOrder: number,
  options: ProceduralLayoutOptions,
  hasExteriorEntrance: boolean,
  idSuffix: string,
  isSymmetricPattern: boolean,
  coreX: number,
  coreW: number,
  preferredEntryRoom?: PlacedChamber,
  reservedExteriorEdge?: number
): GeneratedFloorBundle {
  const cellSize = 40;
  const isBizarre = options.complexity === 'bizarre';
  const isLabyrinthine = options.complexity === 'labyrinthine';
  const profile = ARCHETYPE_STRUCTURE_PROFILES[options.archetype];

  const makeRectPts = (r: GridRect): Point[] => {
    const x1 = r.gx * cellSize;
    const y1 = r.gy * cellSize;
    const x2 = (r.gx + r.gw) * cellSize;
    const y2 = (r.gy + r.gh) * cellSize;
    return [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ];
  };

  // Pass 0: Paired interior diagonal party walls between adjacent non-hallway chambers
  // Shifting one shared corner vertex simultaneously on both rooms preserves a 100% sealed wall
  // with complementary acute (<90°) and obtuse (>90°) angles.
  const preTiltedPoints = new Map<PlacedChamber, Point[]>();
  const tiltedEdgesByChamber = new Map<PlacedChamber, Set<number>>();
  const markTiltedCorner = (ch: PlacedChamber, cornerIdx: number) => {
    const set = tiltedEdgesByChamber.get(ch) ?? new Set<number>();
    set.add((cornerIdx + 3) % 4);
    set.add(cornerIdx);
    tiltedEdgesByChamber.set(ch, set);
  };

  if (options.includeDiagonals && options.complexity !== 'simple') {
    const tiltMult = isBizarre ? 1.45 : isLabyrinthine ? 1.15 : 0.9;
    const pairChance = Math.min(0.75, profile.diagonals.pairTiltChance * tiltMult);
    const eligibleForTilt = (ch: PlacedChamber) =>
      !ch.customPoints &&
      !ch.stairRole &&
      !ch.isHallway &&
      !ch.isBalcony &&
      !ch.isFoyer &&
      ch.flavor.type !== 'courtyard' &&
      !preTiltedPoints.has(ch);

    const isCornerSharedOnlyByTwo = (gx: number, gy: number, a: PlacedChamber, b: PlacedChamber) => {
      for (const other of placed) {
        if (other === a || other === b) continue;
        const r = other.rect;
        if (gx >= r.gx && gx <= r.gx + r.gw && gy >= r.gy && gy <= r.gy + r.gh) {
          return false;
        }
      }
      return true;
    };

    const isCellBandFree = (box: GridRect, a: PlacedChamber, b: PlacedChamber) => {
      for (const other of placed) {
        if (other === a || other === b) continue;
        if (rectsOverlap(other.rect, box)) return false;
      }
      return true;
    };

    const indices = shuffleArray(placed.map((_, i) => i));
    let tiltedPairs = 0;
    const maxTiltedPairs = isBizarre ? 3 : isLabyrinthine ? 2 : 1;

    for (const i of indices) {
      if (tiltedPairs >= maxTiltedPairs) break;
      const chA = placed[i];
      if (!eligibleForTilt(chA)) continue;

      for (let j = 0; j < placed.length; j++) {
        if (j === i) continue;
        const chB = placed[j];
        if (!eligibleForTilt(chB)) continue;
        if (Math.random() > pairChance) continue;

        const a = chA.rect;
        const b = chB.rect;

        // Vertical shared seam (A left of B)
        if (a.gx + a.gw === b.gx) {
          const ov0 = Math.max(a.gy, b.gy);
          const ov1 = Math.min(a.gy + a.gh, b.gy + b.gh);
          if (ov1 - ov0 >= 3) {
            const tryTop = a.gy === b.gy && isCornerSharedOnlyByTwo(b.gx, ov0, chA, chB);
            const tryBot =
              a.gy + a.gh === b.gy + b.gh && isCornerSharedOnlyByTwo(b.gx, ov1, chA, chB);
            if (tryTop || tryBot) {
              const useTop = tryTop && (!tryBot || Math.random() < 0.5);
              const shiftX = Math.random() < 0.5 ? 1 : -1;
              const targetShrink = shiftX > 0 ? b : a;
              if (targetShrink.gw >= 3) {
                const cy = useTop ? ov0 : ov1;
                const band: GridRect = {
                  gx: shiftX > 0 ? b.gx : a.gx + a.gw - 1,
                  gy: useTop ? cy : cy - 1,
                  gw: 1,
                  gh: 1,
                };
                if (isCellBandFree(band, chA, chB)) {
                  const ptsA = makeRectPts(a);
                  const ptsB = makeRectPts(b);
                  const cA = useTop ? 1 : 2;
                  const cB = useTop ? 0 : 3;
                  ptsA[cA].x += shiftX * cellSize;
                  ptsB[cB].x += shiftX * cellSize;
                  preTiltedPoints.set(chA, ptsA);
                  preTiltedPoints.set(chB, ptsB);
                  markTiltedCorner(chA, cA);
                  markTiltedCorner(chB, cB);
                  tiltedPairs++;
                  break;
                }
              }
            }
          }
        }

        // Horizontal shared seam (A above B)
        if (a.gy + a.gh === b.gy) {
          const ov0 = Math.max(a.gx, b.gx);
          const ov1 = Math.min(a.gx + a.gw, b.gx + b.gw);
          if (ov1 - ov0 >= 3) {
            const tryLeft = a.gx === b.gx && isCornerSharedOnlyByTwo(ov0, b.gy, chA, chB);
            const tryRight =
              a.gx + a.gw === b.gx + b.gw && isCornerSharedOnlyByTwo(ov1, b.gy, chA, chB);
            if (tryLeft || tryRight) {
              const useLeft = tryLeft && (!tryRight || Math.random() < 0.5);
              const shiftY = Math.random() < 0.5 ? 1 : -1;
              const targetShrink = shiftY > 0 ? b : a;
              if (targetShrink.gh >= 3) {
                const cx = useLeft ? ov0 : ov1;
                const band: GridRect = {
                  gx: useLeft ? cx : cx - 1,
                  gy: shiftY > 0 ? b.gy : a.gy + a.gh - 1,
                  gw: 1,
                  gh: 1,
                };
                if (isCellBandFree(band, chA, chB)) {
                  const ptsA = makeRectPts(a);
                  const ptsB = makeRectPts(b);
                  const cA = useLeft ? 3 : 2;
                  const cB = useLeft ? 0 : 1;
                  ptsA[cA].y += shiftY * cellSize;
                  ptsB[cB].y += shiftY * cellSize;
                  preTiltedPoints.set(chA, ptsA);
                  preTiltedPoints.set(chB, ptsB);
                  markTiltedCorner(chA, cA);
                  markTiltedCorner(chB, cB);
                  tiltedPairs++;
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  // Helper: check if one of the 4 cardinal edges of a placed box is completely exterior
  const isBoxEdgeExposed = (item: PlacedChamber, edgeIdx: number): boolean => {
    const r = item.rect;
    const testRect: GridRect =
      edgeIdx === 0
        ? { gx: r.gx, gy: r.gy - 1, gw: r.gw, gh: 1 }
        : edgeIdx === 1
          ? { gx: r.gx + r.gw, gy: r.gy, gw: 1, gh: r.gh }
          : edgeIdx === 2
            ? { gx: r.gx, gy: r.gy + r.gh, gw: r.gw, gh: 1 }
            : { gx: r.gx - 1, gy: r.gy, gw: 1, gh: r.gh };
    return !placed.some((other) => other !== item && chamberOverlapsRect(other, testRect));
  };

  // Track exterior clearance boxes claimed by outward bays/curves/prows so
  // facing rooms across a narrow empty gap never bulge into each other.
  const chamberPxBoxes = new Map<PlacedChamber, PxBox[]>(
    placed.map((p) => [
      p,
      chamberSubRects(p).map((sr) => ({
        minX: sr.gx * cellSize,
        minY: sr.gy * cellSize,
        maxX: (sr.gx + sr.gw) * cellSize,
        maxY: (sr.gy + sr.gh) * cellSize,
      })),
    ])
  );
  const claimedExteriorZones: PxBox[] = [];

  const isExteriorBandClear = (owner: PlacedChamber, box: PxBox): boolean => {
    for (const other of placed) {
      if (other === owner) continue;
      const otherBoxes = chamberPxBoxes.get(other)!;
      if (otherBoxes.some((ob) => pxBoxesOverlap(box, ob))) return false;
    }
    for (const z of claimedExteriorZones) {
      if (pxBoxesOverlap(box, z)) return false;
    }
    return true;
  };

  const getSegmentOutwardBox = (
    a: Point,
    b: Point,
    outwardDepthPx: number,
    padEndsPx = 4
  ): PxBox | null => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 10) return null;
    // Outward normal for clockwise screen-space polygon
    const nx = dy / len;
    const ny = -dx / len;
    const tx = dx / len;
    const ty = dy / len;
    const p1 = { x: a.x + tx * padEndsPx, y: a.y + ty * padEndsPx };
    const p2 = { x: b.x - tx * padEndsPx, y: b.y - ty * padEndsPx };
    const p3 = { x: p2.x + nx * outwardDepthPx, y: p2.y + ny * outwardDepthPx };
    const p4 = { x: p1.x + nx * outwardDepthPx, y: p1.y + ny * outwardDepthPx };
    return {
      minX: Math.min(p1.x, p2.x, p3.x, p4.x) + 1,
      minY: Math.min(p1.y, p2.y, p3.y, p4.y) + 1,
      maxX: Math.max(p1.x, p2.x, p3.x, p4.x) - 1,
      maxY: Math.max(p1.y, p2.y, p3.y, p4.y) - 1,
    };
  };

  let stairUpRoomId: string | undefined;
  let stairDownRoomId: string | undefined;

  const chamferScale =
    options.complexity === 'simple'
      ? 0.45
      : isBizarre
        ? 1.45
        : isLabyrinthine
          ? 1.15
          : 0.9;
  const chamferLeftSym = isSymmetricPattern && Math.random() < 0.65 * chamferScale;
  const chamferFlanks = isSymmetricPattern && Math.random() < 0.78 * chamferScale;

  const rooms: Room[] = placed.map((item, idx) => {
    const prePts = preTiltedPoints.get(item);
    const basePts = item.customPoints
      ? item.customPoints.map((p) => ({ ...p }))
      : prePts
        ? prePts.map((p) => ({ ...p }))
        : makeRectPts(item.rect);

    const exposedCardinals = [0, 1, 2, 3].filter((e) => isBoxEdgeExposed(item, e));
    const exposedSet = new Set(exposedCardinals);

    const isCourtyardOpen = item.flavor.type === 'courtyard' && !item.isBalcony;
    const canModifyShape = isBizarre
      ? !item.stairRole && !item.isBalcony
      : !item.isHallway &&
        !item.stairRole &&
        !item.isFoyer &&
        !item.isBalcony &&
        item.flavor.type !== 'secret' &&
        !isCourtyardOpen;

    let finalPts: Point[] = basePts;
    const modifiedEdges = new Set<number>();
    const preTiltedEdgeSet = tiltedEdgesByChamber.get(item);
    if (preTiltedEdgeSet) {
      for (const e of preTiltedEdgeSet) modifiedEdges.add(e);
    }
    if (item.tiltedCorners && item.tiltedCorners.size > 0) {
      for (const c of item.tiltedCorners) {
        modifiedEdges.add((c + 3) % 4);
        modifiedEdges.add(c);
      }
    }

    // Balcony open exterior edges (`hiddenEdges`)
    let hiddenEdges: boolean[] | undefined;
    if (item.isBalcony) {
      hiddenEdges = [0, 1, 2, 3].map((eIdx) => isBoxEdgeExposed(item, eIdx));
    }

    // 0b. Sculpted 45-degree beveled outer bends on multi-vertex shaped hallways
    if (
      options.includeDiagonals &&
      item.isHallway &&
      item.customPoints &&
      basePts.length >= 6 &&
      Math.random() < 0.72
    ) {
      const segExposedPx = (pA: Point, pB: Point): boolean => {
        const outBox = getSegmentOutwardBox(pA, pB, 14, 2);
        return outBox !== null && isExteriorBandClear(item, outBox);
      };
      const bevelPts: Point[] = [];
      const n = basePts.length;
      for (let i = 0; i < n; i++) {
        const prev = basePts[(i - 1 + n) % n];
        const curr = basePts[i];
        const next = basePts[(i + 1) % n];
        const cross = (curr.x - prev.x) * (next.y - curr.y) - (curr.y - prev.y) * (next.x - curr.x);
        const lenIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
        const lenOut = Math.hypot(next.x - curr.x, next.y - curr.y);
        if (
          cross > 0 &&
          lenIn >= cellSize * 2 &&
          lenOut >= cellSize * 2 &&
          segExposedPx(prev, curr) &&
          segExposedPx(curr, next) &&
          Math.random() < 0.65
        ) {
          const bev = 22;
          bevelPts.push(
            {
              x: Math.round(curr.x - ((curr.x - prev.x) / lenIn) * bev),
              y: Math.round(curr.y - ((curr.y - prev.y) / lenIn) * bev),
            },
            {
              x: Math.round(curr.x + ((next.x - curr.x) / lenOut) * bev),
              y: Math.round(curr.y + ((next.y - curr.y) / lenOut) * bev),
            }
          );
        } else {
          bevelPts.push(curr);
        }
      }
      finalPts = bevelPts;
    }

    // 1. Acute/Obtuse Diagonal Corner Wedges & Obtuse Corner Chamfers
    if (options.includeDiagonals && canModifyShape && basePts.length === 4 && !prePts) {
      const cornerExposed = (cornerIdx: number, minLenPx = cellSize * 3): boolean => {
        if (item.tiltedCorners?.has(cornerIdx)) return false;
        const prevEdge = (cornerIdx + 3) % 4;
        const nextEdge = cornerIdx;
        if (!exposedSet.has(prevEdge) || !exposedSet.has(nextEdge)) return false;
        const prevLen = Math.hypot(
          basePts[cornerIdx].x - basePts[(cornerIdx + 3) % 4].x,
          basePts[cornerIdx].y - basePts[(cornerIdx + 3) % 4].y
        );
        const nextLen = Math.hypot(
          basePts[(cornerIdx + 1) % 4].x - basePts[cornerIdx].x,
          basePts[(cornerIdx + 1) % 4].y - basePts[cornerIdx].y
        );
        return prevLen >= minLenPx && nextLen >= minLenPx;
      };

      const wedgeMult = isBizarre ? 1.5 : isLabyrinthine ? 1.15 : options.complexity === 'simple' ? 0.35 : 0.9;
      const wedgeChance = Math.min(0.65, profile.diagonals.wedgeSkewChance * wedgeMult);
      const wedgeable = [0, 1, 2, 3].filter((c) => cornerExposed(c, cellSize * 3));

      if (wedgeable.length > 0 && Math.random() < wedgeChance) {
        const pickC = pickRandom(wedgeable);
        const prev = basePts[(pickC + 3) % 4];
        const curr = basePts[pickC];
        const next = basePts[(pickC + 1) % 4];
        const pullAlongPrev = Math.random() < 0.5;
        const fromPt = pullAlongPrev ? prev : next;
        const edgeLen = Math.hypot(curr.x - fromPt.x, curr.y - fromPt.y);
        const shiftPx = edgeLen >= cellSize * 4 ? cellSize * randInt(1, 2) : cellSize;
        const ux = (fromPt.x - curr.x) / edgeLen;
        const uy = (fromPt.y - curr.y) / edgeLen;
        basePts[pickC] = {
          x: Math.round(curr.x + ux * shiftPx),
          y: Math.round(curr.y + uy * shiftPx),
        };
        modifiedEdges.add((pickC + 3) % 4);
        modifiedEdges.add(pickC);
      }

      const cornersToChamfer = new Set<number>();
      const chamferMult = isBizarre ? 1.35 : isLabyrinthine ? 1.1 : options.complexity === 'simple' ? 0.4 : 0.95;
      const localChamferProb = Math.min(0.88, profile.diagonals.obtuseChamferChance * chamferMult);

      if (item.zone === 'flank-left' && chamferFlanks) {
        if (cornerExposed(0)) cornersToChamfer.add(0);
        if (cornerExposed(3)) cornersToChamfer.add(3);
      } else if (item.zone === 'flank-right' && chamferFlanks) {
        if (cornerExposed(1)) cornersToChamfer.add(1);
        if (cornerExposed(2)) cornersToChamfer.add(2);
      } else if (isSymmetricPattern && !isBizarre) {
        if (chamferLeftSym) {
          if (item.rect.gx === coreX && cornerExposed(0)) cornersToChamfer.add(0);
          if (item.rect.gx + item.rect.gw === coreX + coreW && cornerExposed(1)) {
            cornersToChamfer.add(1);
          }
        } else if (
          (options.archetype === 'blacksmith' ||
            options.archetype === 'temple' ||
            options.archetype === 'fortress') &&
          exposedCardinals.length >= 2
        ) {
          for (let c = 0; c < 4; c++) {
            if (cornerExposed(c) && Math.random() < localChamferProb) cornersToChamfer.add(c);
          }
        }
      } else {
        const minLen = isBizarre ? cellSize * 2 : cellSize * 3;
        const availCorners = [0, 1, 2, 3].filter(
          (c) => cornerExposed(c, minLen) && !modifiedEdges.has(c) && !modifiedEdges.has((c + 3) % 4)
        );
        if (isBizarre && availCorners.length >= 1) {
          for (const c of availCorners) {
            if (Math.random() < localChamferProb) cornersToChamfer.add(c);
          }
        } else if (
          availCorners.length >= 2 &&
          (item.zone === 'wing' ||
            options.archetype === 'blacksmith' ||
            options.archetype === 'fortress' ||
            Math.random() < localChamferProb * 0.65)
        ) {
          availCorners.slice(0, 2).forEach((c) => cornersToChamfer.add(c));
        } else if (availCorners.length >= 1 && Math.random() < localChamferProb) {
          cornersToChamfer.add(pickRandom(availCorners));
        }
      }

      if (cornersToChamfer.size > 0) {
        const chamferPts: Point[] = [];
        for (let i = 0; i < 4; i++) {
          const prev = basePts[(i + 3) % 4];
          const curr = basePts[i];
          const next = basePts[(i + 1) % 4];
          if (cornersToChamfer.has(i)) {
            const lenIn = Math.hypot(curr.x - prev.x, curr.y - prev.y);
            const lenOut = Math.hypot(next.x - curr.x, next.y - curr.y);
            const maxChIn = Math.max(cellSize * 0.6, Math.min(lenIn * 0.45, cellSize * 2));
            const maxChOut = Math.max(cellSize * 0.6, Math.min(lenOut * 0.45, cellSize * 2));
            const uInX = (curr.x - prev.x) / lenIn;
            const uInY = (curr.y - prev.y) / lenIn;
            const uOutX = (next.x - curr.x) / lenOut;
            const uOutY = (next.y - curr.y) / lenOut;

            let chIn = cellSize;
            let chOut = cellSize;
            if (isBizarre || options.archetype === 'crypt') {
              chIn = Math.round(
                Math.min(maxChIn, cellSize * (0.65 + Math.random() * 1.15))
              );
              chOut = Math.round(
                Math.min(maxChOut, cellSize * (0.65 + Math.random() * 1.15))
              );
            } else {
              const maxCh =
                Math.min(lenIn, lenOut) >= cellSize * 4 ? cellSize * 1.5 : cellSize;
              const ch =
                item.zone === 'flank-left' ||
                item.zone === 'flank-right' ||
                isSymmetricPattern
                  ? cellSize
                  : Math.random() < 0.4
                    ? maxCh
                    : cellSize;
              chIn = Math.min(ch, lenIn * 0.42);
              chOut = Math.min(ch, lenOut * 0.42);
            }
            chamferPts.push(
              { x: Math.round(curr.x - uInX * chIn), y: Math.round(curr.y - uInY * chIn) },
              { x: Math.round(curr.x + uOutX * chOut), y: Math.round(curr.y + uOutY * chOut) }
            );
            modifiedEdges.add((i + 3) % 4);
            modifiedEdges.add(i);
          } else {
            chamferPts.push(curr);
          }
        }
        finalPts = chamferPts;
      }
    }

    // 2. Pointed Acute Bastion Prows (<80° tip angle) OR Canted Trapezoidal Bays
    let hasBayOrProw = false;
    if (
      options.includeDiagonals &&
      canModifyShape &&
      finalPts.length === 4 &&
      (isBizarre || modifiedEdges.size === 0)
    ) {
      const bayScale =
        options.complexity === 'simple'
          ? 0.45
          : isBizarre
            ? 1.5
            : isLabyrinthine
              ? 1.15
              : 0.9;
      const prowChance = Math.min(0.68, profile.diagonals.acuteProwChance * bayScale);
      const bayChance = Math.min(0.7, profile.diagonals.bayChance * bayScale);
      const wantProw = Math.random() < prowChance;
      const wantBay = !wantProw && Math.random() < bayChance;

      if (wantProw || wantBay) {
        const minEdgeCells = wantProw || isBizarre ? 3 : 4;
        const candidates = exposedCardinals.filter((e) => {
          if (!isBizarre && e === 2) return false;
          if (modifiedEdges.has(e)) return false;
          const a = finalPts[e];
          const b = finalPts[(e + 1) % 4];
          if (Math.hypot(b.x - a.x, b.y - a.y) < cellSize * minEdgeCells) {
            return false;
          }
          const outBox = getSegmentOutwardBox(a, b, cellSize);
          return outBox !== null && isExteriorBandClear(item, outBox);
        });

        if (candidates.length > 0) {
          const edgeIdx = pickRandom(candidates);
          const a = finalPts[edgeIdx];
          const b = finalPts[(edgeIdx + 1) % 4];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          const nx = dy / len;
          const ny = -dx / len;
          const outBox = getSegmentOutwardBox(a, b, cellSize);
          if (outBox) claimedExteriorZones.push(outBox);

          if (wantProw) {
            // Narrow-base triangular bastion prow: halfBase <= 28px vs depth ~37px => acute ~74° tip!
            const halfSpanFrac = Math.min(0.24, 28 / len);
            const tMid = isBizarre ? 0.42 + Math.random() * 0.16 : 0.5;
            const depth = Math.round(cellSize * 0.94);
            const p1 = {
              x: Math.round(a.x + dx * Math.max(0.14, tMid - halfSpanFrac)),
              y: Math.round(a.y + dy * Math.max(0.14, tMid - halfSpanFrac)),
            };
            const apex = {
              x: Math.round(a.x + dx * tMid + nx * depth),
              y: Math.round(a.y + dy * tMid + ny * depth),
            };
            const p3 = {
              x: Math.round(a.x + dx * Math.min(0.86, tMid + halfSpanFrac)),
              y: Math.round(a.y + dy * Math.min(0.86, tMid + halfSpanFrac)),
            };
            const nextPoly: Point[] = [];
            for (let k = 0; k < 4; k++) {
              nextPoly.push(finalPts[k]);
              if (k === edgeIdx) nextPoly.push(p1, apex, p3);
            }
            finalPts = nextPoly;
            hasBayOrProw = true;
          } else {
            const depth = Math.round(cellSize * (isBizarre ? 0.92 : 0.88));
            const p1 = { x: Math.round(a.x + dx * 0.18), y: Math.round(a.y + dy * 0.18) };
            const p2 = {
              x: Math.round(a.x + dx * (isBizarre ? 0.3 : 0.34) + nx * depth),
              y: Math.round(a.y + dy * (isBizarre ? 0.3 : 0.34) + ny * depth),
            };
            const p3 = {
              x: Math.round(a.x + dx * (isBizarre ? 0.72 : 0.66) + nx * depth),
              y: Math.round(a.y + dy * (isBizarre ? 0.72 : 0.66) + ny * depth),
            };
            const p4 = { x: Math.round(a.x + dx * 0.82), y: Math.round(a.y + dy * 0.82) };
            const nextPoly: Point[] = [];
            for (let k = 0; k < 4; k++) {
              nextPoly.push(finalPts[k]);
              if (k === edgeIdx) nextPoly.push(p1, p2, p3, p4);
            }
            finalPts = nextPoly;
            hasBayOrProw = true;
          }
        }
      }
    }

    const edgeCurves = new Array(finalPts.length).fill(0);

    // 3. Archetype-Driven Curved Walls (Drum Towers, Semicircular Apses, Concave Cloisters, Curved Balconies)
    if (options.includeCurves && item.isBalcony && exposedCardinals.length > 0 && hiddenEdges) {
      // Semicircular Juliet / Observatory balconies on curved archetypes
      const canCurveBalcony =
        options.archetype === 'manor' ||
        options.archetype === 'temple' ||
        options.archetype === 'guildhall';
      if (canCurveBalcony && Math.random() < Math.min(0.85, profile.curves.baseChance + 0.18)) {
        const longEdge = [...exposedCardinals]
          .sort((e1, e2) => {
            const len1 = Math.hypot(
              finalPts[(e1 + 1) % finalPts.length].x - finalPts[e1].x,
              finalPts[(e1 + 1) % finalPts.length].y - finalPts[e1].y
            );
            const len2 = Math.hypot(
              finalPts[(e2 + 1) % finalPts.length].x - finalPts[e2].x,
              finalPts[(e2 + 1) % finalPts.length].y - finalPts[e2].y
            );
            return len2 - len1;
          })
          .find((eIdx) => {
            const pA = finalPts[eIdx];
            const pB = finalPts[(eIdx + 1) % finalPts.length];
            return Math.hypot(pB.x - pA.x, pB.y - pA.y) >= cellSize * 2;
          });
        if (longEdge !== undefined) {
          const pA = finalPts[longEdge];
          const pB = finalPts[(longEdge + 1) % finalPts.length];
          const outBox = getSegmentOutwardBox(pA, pB, cellSize, 4);
          if (outBox && isExteriorBandClear(item, outBox)) {
            claimedExteriorZones.push(outBox);
            edgeCurves[longEdge] = -randInt(34, 56);
          }
        }
      }
    } else if (options.includeCurves && canModifyShape && (!hasBayOrProw || isBizarre)) {
      let shoelace = 0;
      for (let k = 0; k < finalPts.length; k++) {
        const p0 = finalPts[k];
        const p1 = finalPts[(k + 1) % finalPts.length];
        shoelace += p0.x * p1.y - p1.x * p0.y;
      }
      const outwardSign = shoelace >= 0 ? -1 : 1;

      const isTowerLike =
        /tower|turret|observatory|rotunda|spire|bastion|belfry|gazebo/i.test(
          item.flavor.name
        );
      const isSanctumLike =
        /sanctum|altar|shrine|nave|apse|salon|ballroom|crypt|ossuary|throne|conservatory|chapel/i.test(
          item.flavor.name
        );

      const curveScale =
        options.complexity === 'simple'
          ? 0.55
          : isBizarre
            ? 1.55
            : isLabyrinthine
              ? 1.2
              : 1.0;

      const wantDrumTower =
        isTowerLike && Math.random() < Math.min(0.95, profile.curves.drumTowerChance * curveScale);
      const wantApse =
        isSanctumLike && Math.random() < Math.min(0.92, profile.curves.apseChance * curveScale);
      const wantGenericCurve =
        Math.random() < Math.min(0.9, profile.curves.baseChance * curveScale);

      if (wantDrumTower || wantApse || wantGenericCurve) {
        const eligibleCurveEdges: number[] = [];
        for (let eIdx = 0; eIdx < finalPts.length; eIdx++) {
          if (!isBizarre && finalPts.length === 4 && (modifiedEdges.has(eIdx) || eIdx === 2)) {
            continue;
          }
          const pA = finalPts[eIdx];
          const pB = finalPts[(eIdx + 1) % finalPts.length];
          const edgeLen = Math.hypot(pB.x - pA.x, pB.y - pA.y);
          if (edgeLen < cellSize * 2) continue;

          const outBox = getSegmentOutwardBox(pA, pB, cellSize, 8);
          if (!outBox || !isExteriorBandClear(item, outBox)) continue;
          eligibleCurveEdges.push(eIdx);
        }

        if (eligibleCurveEdges.length > 0) {
          const maxEdgesToCurve = wantDrumTower
            ? Math.min(3, eligibleCurveEdges.length)
            : isBizarre
              ? Math.min(eligibleCurveEdges.length, Math.random() < 0.45 ? 2 : 1)
              : 1;

          const picks = shuffleArray(eligibleCurveEdges).slice(0, maxEdgesToCurve);
          for (const pick of picks) {
            const pA = finalPts[pick];
            const pB = finalPts[(pick + 1) % finalPts.length];
            const edgeLen = Math.hypot(pB.x - pA.x, pB.y - pA.y);

            const allowInward =
              !wantDrumTower &&
              !wantApse &&
              !profile.curves.preferOutward &&
              edgeLen >= cellSize * (isBizarre ? 3 : 4);
            const useInward =
              allowInward && Math.random() < profile.curves.concaveChance * (isBizarre ? 1.3 : 1);

            if (useInward) {
              edgeCurves[pick] = -outwardSign * randInt(30, isBizarre ? 56 : 44);
            } else {
              const outBox = getSegmentOutwardBox(pA, pB, cellSize, 4);
              if (outBox && isExteriorBandClear(item, outBox)) {
                claimedExteriorZones.push(outBox);
                const maxMag = wantApse || wantDrumTower ? 74 : 68;
                const minMag = wantApse || wantDrumTower ? 50 : 40;
                edgeCurves[pick] = outwardSign * randInt(minMag, maxMag);
              }
            }
          }
        }
      }
    }

    const roomId = `proc-room-${floorId}-${idx}-${idSuffix}`;
    if (item.stairRole === 'up') stairUpRoomId = roomId;
    if (item.stairRole === 'down') stairDownRoomId = roomId;

    return {
      id: roomId,
      name: item.flavor.name,
      type: item.flavor.type,
      points: finalPts,
      edgeCurves,
      ...(hiddenEdges ? { hiddenEdges } : {}),
      floorMaterial: item.flavor.material,
      lighting: item.flavor.lighting,
      elevationFt: elevationOrder * 10,
      notes: item.flavor.notes,
      showLabel: true,
    };
  });

  // Pass 4: Pixel-level Polygon Overlap Safety Shield
  // Guarantee zero polygon overlaps even after extreme curved apses, tilted seams, or bays.
  for (let pass = 0; pass < 2; pass++) {
    const sampledCheck = rooms.map((r) => sampleRoomPolygon(r, 6));
    let anyReverted = false;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        if (polygonsStrictlyOverlap(sampledCheck[i], sampledCheck[j])) {
          const itemI = placed[i];
          const itemJ = placed[j];
          const isDeformed = (r: Room, ch: PlacedChamber) =>
            r.edgeCurves.some((c) => c !== 0) ||
            (!ch.customPoints && r.points.length !== 4);
          const revertRoom = (idxToRevert: number) => {
            const ch = placed[idxToRevert];
            const cleanPts = ch.customPoints
              ? ch.customPoints.map((p) => ({ ...p }))
              : makeRectPts(ch.rect);
            rooms[idxToRevert] = {
              ...rooms[idxToRevert],
              points: cleanPts,
              edgeCurves: new Array(cleanPts.length).fill(0),
            };
            anyReverted = true;
          };
          if (isDeformed(rooms[j], itemJ)) {
            revertRoom(j);
          } else if (isDeformed(rooms[i], itemI)) {
            revertRoom(i);
          } else {
            revertRoom(j);
            revertRoom(i);
          }
        }
      }
    }
    if (!anyReverted) break;
  }

  // Exterior main door(s) on ground floor Entry Foyer
  const exteriorDoors: Doorway[] = [];
  if (hasExteriorEntrance && rooms.length > 0) {
    const preferredIdx = preferredEntryRoom ? placed.indexOf(preferredEntryRoom) : -1;
    const entryRoom =
      (preferredIdx >= 0 ? rooms[preferredIdx] : undefined) ??
      rooms.find(
        (r) =>
          r.name.includes('Foyer') ||
          r.name.includes('Porch') ||
          r.name.includes('Narthex') ||
          r.name.includes('Gatehouse') ||
          r.name.includes('Barbican')
      ) ??
      rooms[0];

    const preferredEdges =
      reservedExteriorEdge !== undefined
        ? [reservedExteriorEdge, 2, 1, 3, 0]
        : [2, 1, 3, 0];

    const tryBuildExteriorDoor = (room: Room, eIdx: number, id: string): Doorway | null => {
      if (eIdx >= room.points.length || room.hiddenEdges?.[eIdx]) return null;
      if (!isWallEdgeExterior(room, eIdx, rooms)) return null;
      for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
        const pt = getPointAlongRoomEdge(room, eIdx, t);
        const edge = findClosestRoomEdge(room, pt);
        if (findTouchingOppositeWall(room, eIdx, edge.closest, rooms, 24)) continue;
        return {
          id,
          roomAId: room.id,
          roomBId: null,
          edgeAIndex: eIdx,
          edgeBIndex: null,
          position: edge.closest,
          angle: edge.angle,
          width: 36,
          enabled: true,
          customPlaced: true,
          autoDetected: false,
        };
      }
      return null;
    };

    let placedMainDoor = false;
    for (const eIdx of preferredEdges) {
      const door = tryBuildExteriorDoor(entryRoom, eIdx, `proc-main-door-${floorId}-${idSuffix}`);
      if (door) {
        exteriorDoors.push(door);
        placedMainDoor = true;
        break;
      }
    }

    // Fallback: guarantee ground floor always has a true exterior entrance
    if (!placedMainDoor) {
      for (const r of rooms) {
        if (r.type === 'secret' || isBalconyRoom(r)) continue;
        for (let eIdx = 0; eIdx < r.points.length; eIdx++) {
          const door = tryBuildExteriorDoor(r, eIdx, `proc-main-door-${floorId}-${idSuffix}`);
          if (door) {
            exteriorDoors.push(door);
            placedMainDoor = true;
            break;
          }
        }
        if (placedMainDoor) break;
      }
    }

    // Optional back / courtyard / service entrance (excluding balconies!)
    if (options.complexity !== 'simple' && rooms.length >= 6) {
      const sideCandidate = rooms.find(
        (r) =>
          r.id !== entryRoom.id &&
          r.type !== 'secret' &&
          !isBalconyRoom(r) &&
          (r.type === 'courtyard' ||
            r.name.includes('Kitchen') ||
            r.name.includes('Mess') ||
            r.name.includes('Taproom'))
      );
      if (sideCandidate) {
        for (let e = 0; e < sideCandidate.points.length; e++) {
          if (!sideCandidate.hiddenEdges?.[e] && isWallEdgeExterior(sideCandidate, e, rooms)) {
            const mid = getPointAlongRoomEdge(sideCandidate, e, 0.5);
            const edge = findClosestRoomEdge(sideCandidate, mid);
            exteriorDoors.push({
              id: `proc-side-door-${floorId}-${idSuffix}`,
              roomAId: sideCandidate.id,
              roomBId: null,
              edgeAIndex: e,
              edgeBIndex: null,
              position: edge.closest,
              angle: edge.angle,
              width: 32,
              enabled: true,
              customPlaced: true,
              autoDetected: false,
            });
            break;
          }
        }
      }
    }
  }

  const rawDoorways = reconcileDoorways(rooms, exteriorDoors, true, 18, [], {
    requireEmptyWalls: false,
  });
  const { doorways: prunedDoorways, suppressedAutoDoorKeys } = pruneRedundantDoorways(
    rooms,
    rawDoorways,
    options.complexity
  );
  let doorways = prunedDoorways;

  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const isLockedFlavorName = (name: string) =>
    /Vault|Treasury|Armory|Reliquary|Bedchamber|Commandant|Warden|Cell Block|Innkeeper|Guildmaster/i.test(
      name
    );

  // Assign Secret Doors, Locked Doors, and Locked Secret Doors scaled by complexity & archetype
  const seenSecretRoomDoor = new Set<string>();
  const disabledDoorIds = new Set<string>();
  const stillReachableWithout = (skipDoorId: string, aId: string, bId: string): boolean => {
    const queue = [aId];
    const vis = new Set<string>([aId]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === bId) return true;
      for (const dr of doorways) {
        if (dr.id === skipDoorId || disabledDoorIds.has(dr.id) || !dr.enabled || !dr.roomBId) {
          continue;
        }
        const nxt = dr.roomAId === cur ? dr.roomBId : dr.roomBId === cur ? dr.roomAId : null;
        if (nxt && !vis.has(nxt)) {
          vis.add(nxt);
          queue.push(nxt);
        }
      }
    }
    return false;
  };

  let bonusSecretDoorCount = 0;
  const maxBonusSecretDoors =
    isBizarre ? 3 : isLabyrinthine ? 2 : options.complexity === 'standard' ? 1 : 0;

  doorways = doorways.map((d) => {
    const rA = roomById.get(d.roomAId);
    const rB = d.roomBId ? roomById.get(d.roomBId) : undefined;
    const secretOwner =
      rA?.type === 'secret' ? rA : rB?.type === 'secret' ? rB : undefined;

    if (secretOwner && options.includeSecretPassages) {
      if (!seenSecretRoomDoor.has(secretOwner.id)) {
        seenSecretRoomDoor.add(secretOwner.id);
        const lockedSecret =
          /Sanctum|Vault|Sarcophagus|Inquisitor|Phylactery/i.test(secretOwner.name) ||
          Math.random() < 0.45;
        return {
          ...d,
          enabled: true,
          kind: (lockedSecret ? 'locked-secret' : 'secret') as DoorKind,
          dcInvestigation: randInt(14, 17),
          ...(lockedSecret ? { dcLockpick: randInt(14, 18) } : {}),
        };
      }
      if (d.roomBId && stillReachableWithout(d.id, d.roomAId, d.roomBId)) {
        disabledDoorIds.add(d.id);
        return { ...d, enabled: false };
      }
      return {
        ...d,
        enabled: true,
        kind: 'secret' as DoorKind,
        dcInvestigation: randInt(14, 17),
      };
    }

    if (
      d.roomBId !== null &&
      ((rA && isLockedFlavorName(rA.name)) || (rB && isLockedFlavorName(rB.name)))
    ) {
      return {
        ...d,
        enabled: true,
        kind: 'locked' as DoorKind,
        dcLockpick: randInt(13, 18),
      };
    }

    if (
      options.includeSecretPassages &&
      bonusSecretDoorCount < maxBonusSecretDoors &&
      d.roomBId !== null &&
      rA &&
      rB &&
      rA.type === 'room' &&
      rB.type === 'room' &&
      (isBizarre ||
        /Library|Study|Confessional|Alchemical|Observatory|Archive|Office/i.test(rA.name) ||
        /Library|Study|Confessional|Alchemical|Observatory|Archive|Office/i.test(rB.name))
    ) {
      bonusSecretDoorCount++;
      const lockedSecret = Math.random() < 0.4;
      return {
        ...d,
        enabled: true,
        kind: (lockedSecret ? 'locked-secret' : 'secret') as DoorKind,
        dcInvestigation: 15,
        ...(lockedSecret ? { dcLockpick: 15 } : {}),
      };
    }

    if (
      (isLabyrinthine || isBizarre) &&
      d.roomBId !== null &&
      rA?.type === 'room' &&
      rB?.type === 'room' &&
      Math.random() < (isBizarre ? 0.28 : 0.22)
    ) {
      return {
        ...d,
        enabled: true,
        kind: 'locked' as DoorKind,
        dcLockpick: randInt(14, 17),
      };
    }

    return d;
  });

  // Generate internal room-to-room secret passages + optional escape tunnels
  const secretPassages: SecretPassage[] = [];
  if (options.includeSecretPassages && rooms.length >= 4) {
    const archetypeSecretWeight: Record<LayoutArchetype, number> = {
      crypt: 1.0,
      manor: 0.88,
      guildhall: 0.86,
      temple: 0.62,
      fortress: 0.44,
      blacksmith: 0.36,
      jail: 0.28,
      tavern: 0.22,
    };
    const archWeight = archetypeSecretWeight[options.archetype];

    let targetInternalCount = 0;
    if (options.complexity === 'simple') {
      if (Math.random() < Math.min(0.6, 0.08 + archWeight * 0.36)) {
        targetInternalCount = 1;
      }
    } else if (options.complexity === 'standard') {
      if (Math.random() < Math.min(0.95, 0.14 + archWeight * 0.78)) {
        targetInternalCount = 1;
      }
      if (rooms.length >= 7 && Math.random() < archWeight * 0.45) {
        targetInternalCount = 2;
      }
    } else if (isLabyrinthine) {
      if (Math.random() < Math.min(0.99, 0.28 + archWeight * 0.82)) {
        targetInternalCount = 1;
      }
      if (rooms.length >= 6 && Math.random() < Math.min(0.95, 0.12 + archWeight * 0.76)) {
        targetInternalCount = 2;
      }
      if (rooms.length >= 10 && Math.random() < Math.min(0.8, archWeight * 0.56)) {
        targetInternalCount = 3;
      }
    } else {
      if (Math.random() < Math.min(0.99, 0.55 + archWeight * 0.45)) {
        targetInternalCount = 1;
      }
      if (rooms.length >= 6 && Math.random() < Math.min(0.96, 0.36 + archWeight * 0.6)) {
        targetInternalCount = 2;
      }
      if (rooms.length >= 9 && Math.random() < Math.min(0.88, 0.24 + archWeight * 0.62)) {
        targetInternalCount = 3;
      }
      if (rooms.length >= 12 && Math.random() < Math.min(0.75, 0.18 + archWeight * 0.55)) {
        targetInternalCount = 4;
      }
    }

    const sampledPolys = new Map<string, Point[]>(
      rooms.map((r) => [r.id, sampleRoomPolygon(r, 6)])
    );
    const roomBoxes = new Map(
      rooms.map((r) => [r.id, getPolygonBoundingBox(sampledPolys.get(r.id)!)])
    );
    const allPts = Array.from(sampledPolys.values()).flat();
    const envBox = getPolygonBoundingBox(allPts);
    const maxRouteLen = Math.max(
      950,
      ((envBox.maxX - envBox.minX) + (envBox.maxY - envBox.minY)) * 0.95
    );

    const anchorClearsDoorsAndPassages = (
      pt: Point,
      existingSP: SecretPassage[]
    ): boolean => {
      for (const d of doorways) {
        const ux = Math.cos(d.angle);
        const uy = Math.sin(d.angle);
        const hw = d.width / 2;
        const a = { x: d.position.x - ux * hw, y: d.position.y - uy * hw };
        const b = { x: d.position.x + ux * hw, y: d.position.y + uy * hw };
        if (pointToSegmentDistance(pt, a, b).dist < 22) return false;
      }
      for (const sp of existingSP) {
        if (Math.hypot(pt.x - sp.startAnchor.x, pt.y - sp.startAnchor.y) < 30) {
          return false;
        }
        if (Math.hypot(pt.x - sp.endAnchor.x, pt.y - sp.endAnchor.y) < 30) {
          return false;
        }
      }
      return true;
    };

    const segHitsRoom = (p1: Point, p2: Point, room: Room): boolean => {
      const box = roomBoxes.get(room.id)!;
      const minX = Math.min(p1.x, p2.x) - 6;
      const maxX = Math.max(p1.x, p2.x) + 6;
      const minY = Math.min(p1.y, p2.y) - 6;
      const maxY = Math.max(p1.y, p2.y) + 6;
      if (maxX < box.minX || minX > box.maxX || maxY < box.minY || minY > box.maxY) {
        return false;
      }
      const poly = sampledPolys.get(room.id)!;
      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
        const sample = { x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t };
        if (pointInPolygon(sample, poly)) return true;
      }
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (pointToSegmentDistance(a, p1, p2).dist < 6) return true;
        if (
          pointToSegmentDistance(p1, a, b).dist < 4 &&
          pointToSegmentDistance(p2, a, b).dist < 4
        ) {
          return true;
        }
        const ccw = (u: Point, v: Point, w: Point) =>
          (w.y - u.y) * (v.x - u.x) > (v.y - u.y) * (w.x - u.x);
        if (ccw(p1, a, b) !== ccw(p2, a, b) && ccw(p1, p2, a) !== ccw(p1, p2, b)) {
          return true;
        }
      }
      return false;
    };

    const interiorPolylineClear = (pts: Point[]): boolean => {
      if (pts.length < 3) return false;
      for (let i = 1; i < pts.length - 2; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        for (const r of rooms) {
          if (segHitsRoom(p1, p2, r)) return false;
        }
      }
      for (let i = 1; i < pts.length - 1; i++) {
        for (const r of rooms) {
          if (pointInPolygon(pts[i], sampledPolys.get(r.id)!)) return false;
        }
      }
      return true;
    };

    const directDoorPairs = new Set<string>();
    for (const d of doorways) {
      if (d.roomBId) {
        const k = d.roomAId < d.roomBId ? `${d.roomAId}__${d.roomBId}` : `${d.roomBId}__${d.roomAId}`;
        directDoorPairs.add(k);
      }
    }

    const roomsWithExt = rooms
      .map((r) => ({
        room: r,
        extEdges: r.points
          .map((_, eIdx) => eIdx)
          .filter((eIdx) => !r.hiddenEdges?.[eIdx] && isWallEdgeExterior(r, eIdx, rooms)),
      }))
      .filter((entry) => entry.extEdges.length > 0 && entry.room.type !== 'courtyard');

    const pairCandidates: Array<{
      rA: Room;
      edgesA: number[];
      rB: Room;
      edgesB: number[];
      priority: number;
    }> = [];

    for (let i = 0; i < roomsWithExt.length; i++) {
      for (let j = i + 1; j < roomsWithExt.length; j++) {
        const a = roomsWithExt[i];
        const b = roomsWithExt[j];
        const pk =
          a.room.id < b.room.id
            ? `${a.room.id}__${b.room.id}`
            : `${b.room.id}__${a.room.id}`;
        const sharesDoor = directDoorPairs.has(pk);
        const bothStairsOrHall =
          (a.room.type === 'hallway' || a.room.type === 'stairs') &&
          (b.room.type === 'hallway' || b.room.type === 'stairs');
        if (bothStairsOrHall) continue;

        let priority = sharesDoor ? -50 : 20;
        if (a.room.type === 'secret' || b.room.type === 'secret') priority += 40;
        if (/Library|Study|Vault|Treasury|Reliquary|Observatory|Office|Cell/i.test(a.room.name)) {
          priority += 15;
        }
        if (/Library|Study|Vault|Treasury|Reliquary|Observatory|Office|Cell/i.test(b.room.name)) {
          priority += 15;
        }
        priority += Math.random() * 18;
        pairCandidates.push({
          rA: a.room,
          edgesA: a.extEdges,
          rB: b.room,
          edgesB: b.extEdges,
          priority,
        });
      }
    }
    pairCandidates.sort((a, b) => b.priority - a.priority);

    const internalLabelsByArchetype: Record<LayoutArchetype, string[]> = {
      manor: ['secret passage', 'concealed corridor', 'servant bypass'],
      temple: ['hidden cloister', 'inquisitor passage', 'secret corridor'],
      crypt: ['secret tunnel', 'catacomb crawlway', 'hidden tomb passage'],
      blacksmith: ['ash chute', 'hidden coal tunnel', 'secret passage'],
      guildhall: ['smuggler passage', 'secret corridor', 'hidden escape'],
      fortress: ['sally passage', 'secret tunnel', 'concealed postern'],
      jail: ['smuggler tunnel', 'hidden crawlway', 'secret passage'],
      tavern: ['smuggler passage', 'hidden cellar way', 'secret passage'],
    };

    const margin = 44;
    const outerTop = envBox.minY - margin;
    const outerBottom = envBox.maxY + margin;
    const outerLeft = envBox.minX - margin;
    const outerRight = envBox.maxX + margin;

    const usedRoomIds = new Set<string>();
    for (const pair of pairCandidates) {
      if (secretPassages.length >= targetInternalCount) break;
      if (usedRoomIds.has(pair.rA.id) && usedRoomIds.has(pair.rB.id)) continue;

      let bestCandidate: { passage: SecretPassage; len: number } | null = null;

      for (const eA of pair.edgesA) {
        for (const tA of [0.5, 0.34, 0.66]) {
          const sAnchor = getPointAlongRoomEdge(pair.rA, eA, tA);
          if (!anchorClearsDoorsAndPassages(sAnchor, secretPassages)) continue;

          for (const eB of pair.edgesB) {
            for (const tB of [0.5, 0.34, 0.66]) {
              const eAnchor = getPointAlongRoomEdge(pair.rB, eB, tB);
              if (Math.hypot(sAnchor.x - eAnchor.x, sAnchor.y - eAnchor.y) < 40) continue;
              if (!anchorClearsDoorsAndPassages(eAnchor, secretPassages)) continue;

              const baseHead = {
                fromRoomId: pair.rA.id,
                toRoomId: pair.rB.id,
                startAnchor: sAnchor,
                startProtrusion: 32,
                endAnchor: eAnchor,
                endProtrusion: 32,
                midPoints: [] as Point[],
              };
              const straightRes = resolveSecretPassagePolyline(baseHead, rooms);
              const sEl = straightRes.startElbow;
              const eEl = straightRes.endElbow!;

              const midOptions: Point[][] = [
                [],
                [{ x: sEl.x, y: eEl.y }],
                [{ x: eEl.x, y: sEl.y }],
                [{ x: sEl.x, y: outerTop }, { x: eEl.x, y: outerTop }],
                [{ x: sEl.x, y: outerBottom }, { x: eEl.x, y: outerBottom }],
                [{ x: outerLeft, y: sEl.y }, { x: outerLeft, y: eEl.y }],
                [{ x: outerRight, y: sEl.y }, { x: outerRight, y: eEl.y }],
              ];

              for (const mids of midOptions) {
                const candidateBase = { ...baseHead, midPoints: mids };
                const res = resolveSecretPassagePolyline(candidateBase, rooms);
                if (!interiorPolylineClear(res.points)) continue;

                const spObj: SecretPassage = {
                  id: `proc-sp-int-${floorId}-${secretPassages.length}-${idSuffix}`,
                  ...candidateBase,
                  startAnchor: res.startAnchor,
                  endAnchor: res.endAnchor,
                  points: res.points,
                  label: pickRandom(internalLabelsByArchetype[options.archetype]),
                  dcInvestigation: randInt(14, 17),
                  isSecret: true,
                };
                if (
                  detectDoorPassageOverlaps(doorways, [...secretPassages, spObj]).overlapCount > 0
                ) {
                  continue;
                }

                let len = 0;
                for (let k = 0; k < res.points.length - 1; k++) {
                  len += Math.hypot(
                    res.points[k + 1].x - res.points[k].x,
                    res.points[k + 1].y - res.points[k].y
                  );
                }
                if (len <= maxRouteLen && (!bestCandidate || len < bestCandidate.len)) {
                  bestCandidate = { passage: spObj, len };
                }
              }
            }
          }
        }
      }

      if (bestCandidate) {
        secretPassages.push(bestCandidate.passage);
        usedRoomIds.add(pair.rA.id);
        usedRoomIds.add(pair.rB.id);
      }
    }

    // Optional exterior escape tunnel scaled by complexity + archetype
    const escapeChance =
      options.complexity === 'simple'
        ? Math.min(0.35, 0.04 + archWeight * 0.16)
        : options.complexity === 'standard'
          ? Math.min(0.6, 0.08 + archWeight * 0.42)
          : isLabyrinthine
            ? Math.min(0.85, 0.16 + archWeight * 0.68)
            : Math.min(0.95, 0.25 + archWeight * 0.72);

    if (Math.random() < escapeChance) {
      const secretRoom =
        rooms.find((r) => r.type === 'secret') ??
        rooms.find(
          (r) =>
            r.type !== 'stairs' &&
            r.type !== 'hallway' &&
            r.type !== 'courtyard' &&
            !usedRoomIds.has(r.id)
        ) ??
        rooms.find(
          (r) => r.type !== 'stairs' && r.type !== 'hallway' && r.type !== 'courtyard'
        );

      if (secretRoom) {
        for (let e = 0; e < secretRoom.points.length; e++) {
          if (secretRoom.hiddenEdges?.[e] || !isWallEdgeExterior(secretRoom, e, rooms)) continue;
          let placedEscape = false;
          for (const tEsc of [0.5, 0.34, 0.66]) {
            const extStartPt = getPointAlongRoomEdge(secretRoom, e, tEsc);
            if (!anchorClearsDoorsAndPassages(extStartPt, secretPassages)) continue;

            const extResolved = resolveSecretPassagePolyline(
              {
                fromRoomId: secretRoom.id,
                toRoomId: null,
                startAnchor: extStartPt,
                startProtrusion: 38,
                endAnchor: extStartPt,
                endProtrusion: 0,
                midPoints: [],
              },
              rooms
            );
            const endInRoom = rooms.some((r) =>
              pointInPolygon(extResolved.endAnchor, sampledPolys.get(r.id)!)
            );
            if (endInRoom) continue;

            const escObj: SecretPassage = {
              id: `proc-sp-ext-${floorId}-${idSuffix}`,
              fromRoomId: secretRoom.id,
              toRoomId: null,
              startAnchor: extResolved.startAnchor,
              startProtrusion: 38,
              endAnchor: extResolved.endAnchor,
              endProtrusion: 0,
              midPoints: [],
              points: extResolved.points,
              label: 'secret escape',
              dcInvestigation: 16,
              isSecret: true,
            };
            if (
              detectDoorPassageOverlaps(doorways, [...secretPassages, escObj]).overlapCount > 0
            ) {
              continue;
            }
            secretPassages.push(escObj);
            placedEscape = true;
            break;
          }
          if (placedEscape) break;
        }
      }
    }
  }

  return {
    floor: {
      id: floorId,
      name: floorName,
      elevationOrder,
      rooms,
      doorways,
      suppressedAutoDoorKeys,
      secretPassages,
    },
    stairUpRoomId,
    stairDownRoomId,
  };
}

/**
 * 3. Labyrinth Floor Generator:
 * Multi-topology closed-loop architecture driven by SharedLayoutBlueprint:
 * grand-ring-cross, figure-eight-loops, cloister-bypass, or skewed-warren-ring.
 */
function generateLabyrinthFloor(
  floorId: string,
  floorName: string,
  elevationOrder: number,
  options: ProceduralLayoutOptions,
  blueprint: SharedLayoutBlueprint,
  upStairRect: GridRect | undefined,
  downStairRect: GridRect | undefined,
  hasExteriorEntrance: boolean,
  targetRoomCount: number,
  seedOffset: number
): GeneratedFloorBundle {
  const idSuffix = `${Date.now()}-${seedOffset}`;
  const placed: PlacedChamber[] = [];
  const fixedBlockers: GridRect[] = [];
  const reservedZones: GridRect[] = [];
  const nextFlavor = createFlavorPicker(options.archetype, elevationOrder, false);
  const profile = ARCHETYPE_STRUCTURE_PROFILES[options.archetype];
  const hallMat = getFloorHallMaterial(options.archetype, elevationOrder);

  makeStairChambers(
    placed,
    fixedBlockers,
    options,
    elevationOrder,
    upStairRect,
    downStairRect,
    targetRoomCount
  );

  const canPlaceSafe = (r: GridRect): boolean =>
    !placed.some((p) => chamberOverlapsRect(p, r)) &&
    !reservedZones.some((z) => rectsOverlap(z, r));

  const tryPush = (c: PlacedChamber): boolean => {
    const subs = chamberSubRects(c);
    if (!subs.every((sr) => canPlaceSafe(sr))) return false;
    placed.push(c);
    fixedBlockers.push(...subs);
    return true;
  };

  const rx = blueprint.ringX;
  const ry = blueprint.ringY;
  const ringW = blueprint.ringW;
  const ringH = blueprint.ringH;
  const topology = blueprint.labyrinthTopology;

  const makeWalkFlavor = (name: string, notes: string): RoomFlavor => ({
    name,
    type: 'hallway',
    material: hallMat,
    lighting: elevationOrder < 0 ? 'darkness' : 'dim',
    notes,
  });

  // Merge the 4 perimeter hallways into 2 continuous C-shaped polygonal ambulatories
  const midRingX = rx + Math.floor(ringW / 2);
  const westCSubs: GridRect[] = [
    { gx: rx, gy: ry, gw: midRingX - rx, gh: 2 },
    { gx: rx, gy: ry + 2, gw: 2, gh: ringH - 2 },
    { gx: rx, gy: ry + ringH, gw: midRingX - rx, gh: 2 },
  ];
  const eastCSubs: GridRect[] = [
    { gx: midRingX, gy: ry, gw: rx + ringW - midRingX, gh: 2 },
    { gx: rx + ringW - 2, gy: ry + 2, gw: 2, gh: ringH - 2 },
    { gx: midRingX, gy: ry + ringH, gw: rx + ringW - midRingX, gh: 2 },
  ];

  tryPush(
    buildHallwayChamber(
      westCSubs,
      makeWalkFlavor(
        elevationOrder < 0 ? 'West Crypt Ring' : 'West Cloister Ring',
        'Continuous western C-shaped arterial ambulatory.'
      )
    )
  );
  tryPush(
    buildHallwayChamber(
      eastCSubs,
      makeWalkFlavor(
        elevationOrder < 0 ? 'East Crypt Ring' : 'East Cloister Ring',
        'Continuous eastern C-shaped ambulatory completing the closed circuit.'
      )
    )
  );

  const innerX = rx + 2;
  const innerY = ry + 2;
  const innerW = ringW - 4;
  const innerH = ringH - 2;
  let signatureCenterRect: GridRect | null = null;

  if (topology === 'figure-eight-loops') {
    const midX = rx + Math.floor((ringW - 2) / 2);
    const centerSpine: GridRect = { gx: midX, gy: innerY, gw: 2, gh: innerH };
    const midLanding: GridRect = { gx: midX - 1, gy: innerY + Math.floor((innerH - 2) / 2), gw: 4, gh: 2 };
    tryPush(
      buildHallwayChamber(
        [centerSpine, midLanding],
        makeWalkFlavor(
          elevationOrder < 0 ? 'Central Vault Spine' : 'Cross Gallery',
          'Flared central thoroughfare bisecting the ring into twin figure-8 loops.'
        )
      )
    );

    const wPocketW = midX - innerX;
    const ePocketW = rx + ringW - 2 - (midX + 2);
    let wBays = wPocketW >= 2 ? [{ gx: innerX, gy: innerY, gw: wPocketW, gh: innerH }] : [];
    let eBays = ePocketW >= 2 ? [{ gx: midX + 2, gy: innerY, gw: ePocketW, gh: innerH }] : [];
    for (const blk of fixedBlockers) {
      wBays = wBays.flatMap((b) => subtractRect2D(b, blk));
      eBays = eBays.flatMap((b) => subtractRect2D(b, blk));
    }
    for (const b of [...wBays, ...eBays]) {
      for (const r of splitStripWithVariety(b, false, 2, 2, true)) {
        tryPush({ rect: r, isHallway: false, flavor: nextFlavor(false) });
      }
    }
  } else if (topology === 'o-ring') {
    const courtRect: GridRect = { gx: innerX, gy: innerY, gw: innerW, gh: innerH };
    const allowOpenCourt =
      elevationOrder >= 0 &&
      profile.courtyardChance > 0 &&
      Math.random() < Math.max(0.5, profile.courtyardChance);
    if (allowOpenCourt) {
      signatureCenterRect = courtRect;
      tryPush({
        rect: courtRect,
        isHallway: false,
        isSignatureWing: true,
        flavor: {
          name: profile.courtyardFlavor.name,
          type: 'courtyard',
          material: profile.courtyardFlavor.material,
          lighting: 'bright',
          notes: profile.courtyardFlavor.notes,
        },
      });
    } else {
      reservedZones.push(courtRect);
    }
  } else if (topology === 'cloister-bypass') {
    const courtRect: GridRect = { gx: innerX, gy: innerY, gw: innerW, gh: innerH };
    const allowOpenCourt = elevationOrder >= 0 && Math.random() < profile.courtyardChance + 0.15;
    signatureCenterRect = courtRect;
    tryPush({
      rect: courtRect,
      isHallway: false,
      isSignatureWing: true,
      flavor: allowOpenCourt
        ? {
            name: profile.courtyardFlavor.name,
            type: 'courtyard',
            material: profile.courtyardFlavor.material,
            lighting: 'bright',
            notes: profile.courtyardFlavor.notes,
          }
        : {
            name:
              options.archetype === 'temple'
                ? 'Cloister Sanctuary'
                : options.archetype === 'blacksmith'
                  ? 'Foundry Workcourt'
                  : 'Inner Cloister Hall',
            type: 'room',
            material: options.archetype === 'blacksmith' ? 'cobble' : 'marble',
            lighting: 'bright',
            notes: 'Monumental inner court enclosed on all sides by arcaded galleries.',
          },
    });

    const wBypass: GridRect = { gx: rx - 2, gy: ry + 2, gw: 2, gh: ringH - 2 };
    const eBypass: GridRect = { gx: rx + ringW, gy: ry + 2, gw: 2, gh: ringH - 2 };
    if (tryPush({ rect: wBypass, isHallway: true, flavor: makeWalkFlavor('West Outer Bypass', 'Parallel flanking corridor creating secondary circuits.') })) {
      for (const r of splitStripWithVariety({ gx: rx - 5, gy: ry + 2, gw: 3, gh: ringH - 2 }, false, 2, 3, true)) {
        tryPush({ rect: r, isHallway: false, zone: 'flank-left', flavor: nextFlavor(false) });
      }
    }
    if (tryPush({ rect: eBypass, isHallway: true, flavor: makeWalkFlavor('East Outer Bypass', 'Parallel flanking corridor creating secondary circuits.') })) {
      for (const r of splitStripWithVariety({ gx: rx + ringW + 2, gy: ry + 2, gw: 3, gh: ringH - 2 }, false, 2, 3, true)) {
        tryPush({ rect: r, isHallway: false, zone: 'flank-right', flavor: nextFlavor(false) });
      }
    }
  } else if (topology === 'skewed-warren-ring') {
    const hubW = Math.max(4, Math.min(6, innerW - 4));
    const hubH = Math.max(3, Math.min(4, innerH - 4));
    const hubX = innerX + Math.max(2, Math.floor((innerW - hubW) * 0.35));
    const hubY = innerY + Math.max(2, Math.floor((innerH - hubH) * 0.6));
    const centerHub: GridRect = { gx: hubX, gy: hubY, gw: hubW, gh: hubH };
    signatureCenterRect = centerHub;

    const nSpine: GridRect = { gx: hubX, gy: innerY, gw: 2, gh: hubY - innerY };
    const sSpine: GridRect = { gx: hubX + hubW - 2, gy: hubY + hubH, gw: 2, gh: ry + ringH - (hubY + hubH) };
    const wCross: GridRect = { gx: innerX, gy: Math.max(innerY, hubY - 2), gw: hubX - innerX, gh: 2 };
    const eCross: GridRect = { gx: hubX + hubW, gy: hubY + hubH, gw: rx + ringW - 2 - (hubX + hubW), gh: 2 };

    // Merge N+W and S+E warren spurs into 2 flush L-shaped cross corridors
    const nwWarrenSubs = [nSpine, ...(wCross.gw >= 1 ? [wCross] : [])];
    const seWarrenSubs = [sSpine, ...(eCross.gw >= 1 ? [eCross] : [])];
    tryPush(buildHallwayChamber(nwWarrenSubs, makeWalkFlavor('North-West Warren Cut', 'Crooked L-shaped cross-passage into the northern ring.')));
    tryPush(buildHallwayChamber(seWarrenSubs, makeWalkFlavor('South-East Warren Cut', 'Staggered L-shaped passage joining the southern ring.')));

    tryPush({
      rect: centerHub,
      isHallway: false,
      isSignatureWing: true,
      flavor: {
        name:
          options.archetype === 'jail'
            ? 'Inner Cellblock Hub'
            : options.archetype === 'crypt'
              ? 'Sunken Ossuary'
              : 'Warren Crossroads',
        type: 'room',
        material: options.archetype === 'tavern' ? 'wood' : 'stone',
        lighting: 'dim',
        notes: 'Off-axis central junction linking staggered passages.',
      },
    });
  } else {
    // 'grand-ring-cross': Parametric 4-way crossroads inside the ring
    const hubW = Math.max(4, Math.min(6, innerW - 4));
    const hubH = Math.max(3, Math.min(4, innerH - 4));
    const hubX = innerX + Math.floor((innerW - hubW) / 2);
    const hubY = innerY + Math.floor((innerH - hubH) / 2);
    const centerHub: GridRect = { gx: hubX, gy: hubY, gw: hubW, gh: hubH };
    signatureCenterRect = centerHub;

    const spineX = hubX + Math.floor((hubW - 2) / 2);
    const northSpine: GridRect = { gx: spineX, gy: innerY, gw: 2, gh: hubY - innerY };
    const southSpine: GridRect = { gx: spineX, gy: hubY + hubH, gw: 2, gh: ry + ringH - (hubY + hubH) };
    const westCrossway: GridRect = { gx: innerX, gy: hubY, gw: hubX - innerX, gh: hubH };
    const eastCrossway: GridRect = { gx: hubX + hubW, gy: hubY, gw: rx + ringW - 2 - (hubX + hubW), gh: hubH };

    if (northSpine.gh >= 1) tryPush({ rect: northSpine, isHallway: true, flavor: makeWalkFlavor('North Transept', 'Northern transept descending from the cloister walk.') });
    if (southSpine.gh >= 1) tryPush({ rect: southSpine, isHallway: true, flavor: makeWalkFlavor('South Transept', 'Southern transept continuing down to the ambulatory.') });
    if (westCrossway.gw >= 1) tryPush({ rect: westCrossway, isHallway: true, flavor: makeWalkFlavor('West Crossway', 'Transverse corridor linking the west gallery to the rotunda.') });
    if (eastCrossway.gw >= 1) tryPush({ rect: eastCrossway, isHallway: true, flavor: makeWalkFlavor('East Crossway', 'Transverse corridor linking the east gallery to the rotunda.') });

    tryPush({
      rect: centerHub,
      isHallway: false,
      isSignatureWing: true,
      flavor: {
        name:
          options.archetype === 'temple'
            ? 'Central Altar of Crossroads'
            : options.archetype === 'crypt'
              ? 'Ossuary Rotunda'
              : options.archetype === 'blacksmith'
                ? 'Grand Forge Nexus'
                : 'Grand Crossroads',
        type: 'room',
        material: options.archetype === 'blacksmith' ? 'cobble' : 'marble',
        lighting: 'bright',
        notes: 'Four-way intersection hub connecting all quarters of the labyrinth.',
      },
    });

    const nwPocket: GridRect = { gx: innerX, gy: innerY, gw: spineX - innerX, gh: hubY - innerY };
    const nePocket: GridRect = { gx: spineX + 2, gy: innerY, gw: rx + ringW - 2 - (spineX + 2), gh: hubY - innerY };
    for (const pRect of [nwPocket, nePocket]) {
      if (pRect.gw >= 2 && pRect.gh >= 2 && placed.length < targetRoomCount - 3) {
        tryPush({ rect: pRect, isHallway: false, flavor: nextFlavor(false) });
      }
    }
  }

  // Ground Floor Entry Foyer (centered on South Hallway)
  let entryChamber: PlacedChamber | undefined;
  const foyerW = 4;
  const foyerX = rx + Math.floor((ringW - foyerW) / 2);
  if (hasExteriorEntrance && placed.length < targetRoomCount) {
    const foyer: GridRect = { gx: foyerX, gy: ry + ringH + 2, gw: foyerW, gh: 3 };
    if (canPlaceSafe(foyer)) {
      entryChamber = {
        rect: foyer,
        isHallway: false,
        isFoyer: true,
        flavor: makeEntryFlavor(options.archetype),
      };
      tryPush(entryChamber);
      reservedZones.push({ gx: foyer.gx, gy: foyer.gy + foyer.gh, gw: foyer.gw, gh: 2 });
    }
  }

  // Perimeter Outer Strips proportioned cleanly to remaining targetRoomCount
  let northBays = [{ gx: rx, gy: ry - 3, gw: ringW, gh: 3 }];
  let southBays = [{ gx: rx, gy: ry + ringH + 2, gw: ringW, gh: 3 }];
  for (const blk of fixedBlockers) {
    northBays = northBays.flatMap((b) => subtractRect2D(b, blk));
    southBays = southBays.flatMap((b) => subtractRect2D(b, blk));
  }

  let wBays: GridRect[] = [];
  let eBays: GridRect[] = [];
  if (topology !== 'cloister-bypass') {
    wBays = [{ gx: rx - 3, gy: ry, gw: 3, gh: ringH + 2 }];
    eBays = [{ gx: rx + ringW, gy: ry, gw: 3, gh: ringH + 2 }];
    for (const blk of fixedBlockers) {
      wBays = wBays.flatMap((b) => subtractRect2D(b, blk));
      eBays = eBays.flatMap((b) => subtractRect2D(b, blk));
    }
  }

  const perimBays = [...northBays, ...southBays, ...wBays, ...eBays];
  const pHFlags = [
    ...northBays.map(() => true),
    ...southBays.map(() => true),
    ...wBays.map(() => false),
    ...eBays.map(() => false),
  ];
  const pZones: PlacedChamber['zone'][] = [
    ...northBays.map(() => 'north' as const),
    ...southBays.map(() => 'south' as const),
    ...wBays.map(() => 'flank-left' as const),
    ...eBays.map(() => 'flank-right' as const),
  ];
  const remBudget = Math.max(perimBays.length, targetRoomCount - placed.length);
  const counts = allocateCountsAcrossStrips(perimBays, remBudget, pHFlags);

  perimBays.forEach((bay, idx) => {
    for (const r of splitStripWithVariety(bay, pHFlags[idx], counts[idx], 2, true)) {
      if (canPlaceSafe(r)) {
        placed.push({ rect: r, isHallway: false, zone: pZones[idx], flavor: nextFlavor(false) });
      }
    }
  });

  resizeAndArticulateChambers(placed, targetRoomCount, reservedZones, options);

  attachArchetypeBalconies(
    placed,
    reservedZones,
    options.archetype,
    elevationOrder,
    options.complexity,
    targetRoomCount
  );

  // Secret Chambers (1-2 concealed behind walls in labyrinth)
  if (options.includeSecretPassages && placed.length >= 6) {
    const candidates = placed.filter(
      (p) =>
        !p.isHallway &&
        !p.stairRole &&
        !p.isFoyer &&
        !p.isBalcony &&
        !p.isSignatureWing &&
        p.rect !== signatureCenterRect
    );
    if (candidates.length > 0) {
      candidates[candidates.length - 1].flavor = nextFlavor(true);
      if (candidates.length >= 3 && Math.random() < 0.7) {
        candidates[candidates.length - 2].flavor = nextFlavor(true);
      }
    }
  }

  balancePlacedChambers(placed, targetRoomCount, nextFlavor, reservedZones);

  return finalizePlacedFloor(
    placed,
    floorId,
    floorName,
    elevationOrder,
    options,
    hasExteriorEntrance,
    idSuffix,
    false,
    rx,
    ringW,
    entryChamber,
    2
  );
}

/**
 * 4. Bizarre Floor Generator:
 * Asymmetric organic sprawl with archetype-driven eccentric dimensions,
 * randomized seed motifs, active cycle loop bridges, and balconies.
 */
function generateBizarreFloor(
  floorId: string,
  floorName: string,
  elevationOrder: number,
  options: ProceduralLayoutOptions,
  blueprint: SharedLayoutBlueprint,
  upStairRect: GridRect | undefined,
  downStairRect: GridRect | undefined,
  hasExteriorEntrance: boolean,
  targetRoomCount: number,
  seedOffset: number
): GeneratedFloorBundle {
  const idSuffix = `${Date.now()}-${seedOffset}`;
  const originGx = blueprint.coreX + 4;
  const originGy = blueprint.hallY + 2;

  const placed: PlacedChamber[] = [];
  const fixedBlockers: GridRect[] = [];
  const reservedZones: GridRect[] = [];
  const nextFlavor = createFlavorPicker(options.archetype, elevationOrder, true);
  const profile = ARCHETYPE_STRUCTURE_PROFILES[options.archetype];
  const hallMat = getFloorHallMaterial(options.archetype, elevationOrder);

  const corridorNames =
    elevationOrder < 0
      ? ['Undercroft Rift', 'Vaulted Causeway', 'Crypt Passage', 'Twisting Chasm']
      : ['Crooked Gallery', 'Sprawling Causeway', 'Serpentine Corridor', 'Skewed Passage', 'Bridge Hall'];

  const makeCorridorFlavor = (): RoomFlavor => ({
    name: pickRandom(corridorNames),
    type: 'hallway',
    material: hallMat,
    lighting: elevationOrder < 0 ? 'darkness' : 'dim',
    notes: 'Erratic causeway spanning bizarre wings.',
  });

  const canPlaceRaw = (r: GridRect): boolean =>
    !placed.some((p) => rectsOverlap(p.rect, r)) &&
    !reservedZones.some((z) => rectsOverlap(z, r));

  // 1. Aligned multi-floor stairwells
  makeStairChambers(
    placed,
    fixedBlockers,
    options,
    elevationOrder,
    upStairRect,
    downStairRect,
    targetRoomCount
  );
  const upChamber = placed.find((p) => p.stairRole === 'up');
  const downChamber = placed.find((p) => p.stairRole === 'down');

  // 2. Randomized eccentric starter hub or serpentine spine
  const motif = randInt(0, 2);
  if (placed.length === 0) {
    if (motif === 0) {
      // L-shaped serpentine spine + grand chamber
      const hSpine: GridRect = { gx: originGx, gy: originGy, gw: randInt(5, 7), gh: 2 };
      const vSpine: GridRect = { gx: originGx, gy: originGy - randInt(4, 5), gw: 2, gh: 4 };
      placed.push({ rect: hSpine, isHallway: true, flavor: makeCorridorFlavor() });
      if (canPlaceRaw(vSpine)) {
        placed.push({ rect: vSpine, isHallway: true, flavor: makeCorridorFlavor() });
      }
      const coreHub: GridRect = { gx: originGx + 2, gy: originGy - 4, gw: 4, gh: 4 };
      if (canPlaceRaw(coreHub)) {
        placed.push({
          rect: coreHub,
          isHallway: false,
          isSignatureWing: true,
          flavor: nextFlavor(false, true),
        });
      }
    } else if (motif === 1) {
      // Twin chambers joined by a bridging skyway
      const wHub: GridRect = { gx: originGx, gy: originGy, gw: randInt(4, 5), gh: randInt(4, 5) };
      const bridge: GridRect = { gx: originGx + wHub.gw, gy: originGy + 1, gw: 3, gh: 2 };
      const eHub: GridRect = { gx: bridge.gx + 3, gy: originGy - 1, gw: randInt(3, 5), gh: randInt(4, 5) };
      placed.push({ rect: wHub, isHallway: false, isSignatureWing: true, flavor: nextFlavor(false, true) });
      if (canPlaceRaw(bridge)) placed.push({ rect: bridge, isHallway: true, flavor: makeCorridorFlavor() });
      if (canPlaceRaw(eHub)) placed.push({ rect: eHub, isHallway: false, flavor: nextFlavor(false) });
    } else {
      // Single monumental rotated nucleus
      placed.push({
        rect: { gx: originGx, gy: originGy, gw: randInt(4, 6), gh: randInt(4, 6) },
        isHallway: false,
        isSignatureWing: true,
        flavor: nextFlavor(false, true),
      });
    }
  } else if (upChamber && downChamber) {
    // Bridge stairs cleanly across gap
    const a = upChamber.rect;
    const b = downChamber.rect;
    const left = a.gx + a.gw <= b.gx ? a : b.gx + b.gw <= a.gx ? b : null;
    const right = left === a ? b : left === b ? a : null;
    if (left && right) {
      const spanW = right.gx - (left.gx + left.gw);
      const minY = Math.max(left.gy, right.gy);
      const maxY = Math.min(left.gy + left.gh, right.gy + right.gh);
      if (spanW >= 1 && maxY - minY >= 2) {
        const bridgeRect: GridRect = {
          gx: left.gx + left.gw,
          gy: minY,
          gw: spanW,
          gh: Math.min(3, maxY - minY),
        };
        if (canPlaceRaw(bridgeRect)) {
          placed.push({
            rect: bridgeRect,
            isHallway: Math.random() < 0.5,
            isSignatureWing: true,
            flavor: Math.random() < 0.5 ? makeCorridorFlavor() : nextFlavor(false, true),
          });
        }
      }
    }
  }

  const generateAttachments = (
    parent: PlacedChamber,
    gw: number,
    gh: number,
    allowDirs?: number[]
  ): { rect: GridRect; dir: number; overlapLen: number }[] => {
    const p = parent.rect;
    const dirs = allowDirs ?? [0, 1, 2, 3];
    const results: { rect: GridRect; dir: number; overlapLen: number }[] = [];

    for (const dir of dirs) {
      if (dir === 0 || dir === 2) {
        const gy = dir === 0 ? p.gy - gh : p.gy + p.gh;
        for (let gx = p.gx - gw + 1; gx <= p.gx + p.gw - 1; gx++) {
          const cand: GridRect = { gx, gy, gw, gh };
          const overlapLen = rectsTouchEdgeLen(p, cand);
          if (overlapLen >= 1 && canPlaceRaw(cand)) {
            results.push({ rect: cand, dir, overlapLen });
          }
        }
      } else {
        const gx = dir === 1 ? p.gx + p.gw : p.gx - gw;
        for (let gy = p.gy - gh + 1; gy <= p.gy + p.gh - 1; gy++) {
          const cand: GridRect = { gx, gy, gw, gh };
          const overlapLen = rectsTouchEdgeLen(p, cand);
          if (overlapLen >= 1 && canPlaceRaw(cand)) {
            results.push({ rect: cand, dir, overlapLen });
          }
        }
      }
    }
    return results;
  };

  // 3. Ground Floor Entry Foyer
  let entryChamber: PlacedChamber = placed[0];
  let reservedExteriorEdge: number | undefined = 2;

  if (hasExteriorEntrance) {
    const fw = 3;
    const fh = 3;
    const foyerAnchor =
      placed.find((p) => !p.stairRole && !p.isBalcony) ?? placed[0];
    const foyerCands = generateAttachments(foyerAnchor, fw, fh, [2, 1, 3, 0]);
    if (foyerCands.length > 0) {
      const chosen = pickRandom(foyerCands.slice(0, Math.min(4, foyerCands.length)));
      entryChamber = {
        rect: chosen.rect,
        isHallway: false,
        isFoyer: true,
        flavor: makeEntryFlavor(options.archetype),
      };
      placed.push(entryChamber);
      reservedExteriorEdge = chosen.dir;
      const er = entryChamber.rect;
      const apron: GridRect =
        reservedExteriorEdge === 0
          ? { gx: er.gx, gy: er.gy - 2, gw: er.gw, gh: 2 }
          : reservedExteriorEdge === 1
            ? { gx: er.gx + er.gw, gy: er.gy, gw: 2, gh: er.gh }
            : reservedExteriorEdge === 2
              ? { gx: er.gx, gy: er.gy + er.gh, gw: er.gw, gh: 2 }
              : { gx: er.gx - 2, gy: er.gy, gw: 2, gh: er.gh };
      if (!placed.some((p) => rectsOverlap(p.rect, apron))) {
        reservedZones.push(apron);
      }
    }
  }

  // 4. Sprawling Organic Loop Growth driven by archetype bizarreDims
  const fallbackDims: Array<[number, number]> = [
    [3, 4],
    [4, 3],
    [2, 5],
    [5, 2],
    [3, 3],
    [2, 3],
    [3, 2],
  ];

  let growthGuard = 0;
  const growthTarget = Math.max(4, targetRoomCount - 1);
  while (placed.length < growthTarget && growthGuard < targetRoomCount * 20) {
    growthGuard++;
    const remaining = growthTarget - placed.length;
    const wantCorridor = remaining >= 2 && Math.random() < 0.4;

    // ACTIVE LOOP RECONNECTION BRIDGE:
    // Close cycles between chambers separated by a 1-3 cell gap
    if (placed.length >= 4 && Math.random() < 0.38) {
      let loopBridgeFound: GridRect | null = null;
      const pairIndices = shuffleArray(placed.map((_, i) => i));
      bridgeSearch: for (const i of pairIndices) {
        if (placed[i].isBalcony) continue;
        for (let j = i + 2; j < placed.length; j++) {
          if (placed[j].isBalcony) continue;
          const a = placed[i].rect;
          const b = placed[j].rect;
          const left = a.gx + a.gw < b.gx ? a : b.gx + b.gw < a.gx ? b : null;
          const right = left === a ? b : left === b ? a : null;
          if (left && right) {
            const gap = right.gx - (left.gx + left.gw);
            if (gap >= 1 && gap <= 3) {
              const minY = Math.max(left.gy, right.gy);
              const maxY = Math.min(left.gy + left.gh, right.gy + right.gh);
              if (maxY - minY >= 2) {
                const bRect: GridRect = {
                  gx: left.gx + left.gw,
                  gy: minY,
                  gw: gap,
                  gh: 2,
                };
                if (canPlaceRaw(bRect)) {
                  loopBridgeFound = bRect;
                  break bridgeSearch;
                }
              }
            }
          }
          const top = a.gy + a.gh < b.gy ? a : b.gy + b.gh < a.gy ? b : null;
          const bot = top === a ? b : top === b ? a : null;
          if (top && bot) {
            const gap = bot.gy - (top.gy + top.gh);
            if (gap >= 1 && gap <= 3) {
              const minX = Math.max(top.gx, bot.gx);
              const maxX = Math.min(top.gx + top.gw, bot.gx + bot.gw);
              if (maxX - minX >= 2) {
                const bRect: GridRect = {
                  gx: minX,
                  gy: top.gy + top.gh,
                  gw: 2,
                  gh: gap,
                };
                if (canPlaceRaw(bRect)) {
                  loopBridgeFound = bRect;
                  break bridgeSearch;
                }
              }
            }
          }
        }
      }
      if (loopBridgeFound) {
        placed.push({
          rect: loopBridgeFound,
          isHallway: true,
          flavor: makeCorridorFlavor(),
        });
        continue;
      }
    }

    const validParents = placed.filter((p) => !p.isBalcony);
    const parent = pickRandom(validParents);
    const tryDims: Array<[number, number]> = wantCorridor
      ? shuffleArray([[2, 5], [5, 2], [2, 4], [4, 2]])
      : [...shuffleArray(profile.bizarreDims), ...fallbackDims];
    let placedCand: GridRect | null = null;

    for (const [gw, gh] of tryDims) {
      const atts = generateAttachments(parent, gw, gh);
      if (atts.length === 0) continue;

      const scored = atts.map((att) => {
        let touchesOther = 0;
        for (const other of placed) {
          if (other === parent || other.isBalcony) continue;
          if (rectsTouchEdgeLen(att.rect, other.rect) >= 1) touchesOther++;
        }
        const loopBonus = touchesOther * 145;
        const score = loopBonus + att.overlapLen * 10 + Math.random() * 24;
        return { rect: att.rect, score };
      });
      scored.sort((a, b) => b.score - a.score);
      placedCand = scored[0].rect;
      break;
    }

    if (placedCand) {
      placed.push({
        rect: placedCand,
        isHallway: wantCorridor,
        flavor: wantCorridor ? makeCorridorFlavor() : nextFlavor(false),
      });
    }
  }

  attachArchetypeBalconies(
    placed,
    reservedZones,
    options.archetype,
    elevationOrder,
    options.complexity,
    targetRoomCount
  );

  // Secret Passages in Bizarre
  if (options.includeSecretPassages && placed.length >= 6) {
    const leafCandidates = placed.filter(
      (p) => !p.isHallway && !p.stairRole && !p.isFoyer && !p.isBalcony && !p.isSignatureWing
    );
    if (leafCandidates.length > 0) {
      leafCandidates[leafCandidates.length - 1].flavor = nextFlavor(true);
      if (leafCandidates.length >= 3 && Math.random() < 0.6) {
        leafCandidates[leafCandidates.length - 2].flavor = nextFlavor(true);
      }
    }
  }

  balancePlacedChambers(placed, targetRoomCount, nextFlavor, reservedZones);

  return finalizePlacedFloor(
    placed,
    floorId,
    floorName,
    elevationOrder,
    options,
    hasExteriorEntrance,
    idSuffix,
    false,
    originGx,
    10,
    entryChamber,
    reservedExteriorEdge
  );
}

export function generateProceduralLayout(
  options: ProceduralLayoutOptions
): MapDocument {
  const cellSize = 40;
  const feetPerCell = 5;
  const floorCount = options.floorCount ?? 1;
  const stamp = Date.now();

  const groundTarget = Math.max(
    4,
    options.floorRoomCounts?.ground ?? options.roomCount
  );
  const upperTarget = Math.max(
    4,
    options.floorRoomCounts?.upper ?? Math.max(5, Math.round(groundTarget * 0.85))
  );
  const cellarTarget = Math.max(
    4,
    options.floorRoomCounts?.cellar ?? Math.max(4, Math.round(groundTarget * 0.65))
  );

  // Build SharedLayoutBlueprint once per generation so multi-floor stairs stack cleanly
  // while every click selects genuine randomized topologies and dimensions per archetype.
  const profile = ARCHETYPE_STRUCTURE_PROFILES[options.archetype];
  const simpleTopology = pickWeighted(profile.simpleWeights);
  const standardTopology = pickWeighted(profile.standardWeights);
  const labyrinthTopology = pickWeighted(profile.labyrinthWeights);
  const pattern = choosePattern(options.archetype, options.complexity);

  const lArmLeft = Math.random() < 0.5;
  const lArmUp = Math.random() < 0.5;

  const coreX = randInt(8, 12);
  const hallY = randInt(8, 12);
  const coreW =
    options.complexity === 'simple'
      ? randInt(8, 11)
      : options.complexity === 'standard'
        ? randInt(12, 16)
        : randInt(13, 17);
  const northH = randInt(3, 4);
  const southH = randInt(3, 4);

  const ringX = randInt(6, 10);
  const ringY = randInt(6, 10);
  const ringW = randInt(14, 18);
  const ringH = randInt(10, 12);

  let upStairRect: GridRect;
  let downStairRect: GridRect;

  if (options.complexity === 'simple') {
    if (simpleTopology === 'linear-v') {
      const spineX = coreX + Math.floor(coreW / 2) - 1;
      upStairRect = { gx: spineX - 2, gy: hallY - 2, gw: 2, gh: 3 };
      downStairRect = { gx: spineX + 2, gy: hallY - 2, gw: 2, gh: 3 };
    } else if (simpleTopology === 'l-wing') {
      const hLen = Math.max(7, Math.min(10, coreW));
      const wingOuterY = lArmUp ? hallY + 2 : hallY - northH;
      const wingOuterH = lArmUp ? southH : northH;
      upStairRect = { gx: coreX, gy: wingOuterY, gw: 2, gh: wingOuterH };
      downStairRect = { gx: coreX + hLen - 2, gy: wingOuterY, gw: 2, gh: wingOuterH };
    } else if (simpleTopology === 'central-commons') {
      const hubX = coreX + Math.floor((coreW - 4) / 2);
      upStairRect = { gx: hubX - 2, gy: hallY - 1, gw: 2, gh: 3 };
      downStairRect = { gx: hubX + 5, gy: hallY - 1, gw: 2, gh: 3 };
    } else {
      // 'linear-h' & 'u-wing'
      upStairRect = { gx: coreX, gy: hallY - northH, gw: 2, gh: northH };
      downStairRect = { gx: coreX + coreW - 2, gy: hallY - northH, gw: 2, gh: northH };
    }
  } else if (options.complexity === 'standard') {
    if (standardTopology === 'staggered-compound') {
      upStairRect = { gx: coreX + coreW - 2, gy: hallY - northH, gw: 2, gh: northH };
      downStairRect = { gx: coreX + coreW - 2, gy: hallY + 2, gw: 2, gh: southH };
    } else if (standardTopology === 'l-wing') {
      const wingOuterY = lArmUp ? hallY + 2 : hallY - northH;
      const wingOuterH = lArmUp ? southH : northH;
      upStairRect = { gx: coreX, gy: wingOuterY, gw: 2, gh: wingOuterH };
      downStairRect = { gx: coreX + coreW - 2, gy: wingOuterY, gw: 2, gh: wingOuterH };
    } else if (standardTopology === 'cruciform-nave') {
      const naveX = coreX + Math.floor((coreW - 4) / 2);
      upStairRect = { gx: naveX - 2, gy: hallY - 2, gw: 2, gh: 2 };
      downStairRect = { gx: naveX - 2, gy: hallY + 3, gw: 2, gh: 2 };
    } else if (standardTopology === 'radial-spire') {
      const midX = coreX + Math.floor(coreW / 2);
      upStairRect = { gx: midX - 3, gy: hallY - 3, gw: 2, gh: 2 };
      downStairRect = { gx: midX + 1, gy: hallY - 3, gw: 2, gh: 2 };
    } else {
      // 'bilateral-wings', 'u-courtyard', & 'o-ring'
      upStairRect = { gx: coreX, gy: hallY - northH, gw: 2, gh: northH };
      downStairRect = { gx: coreX + coreW - 2, gy: hallY - northH, gw: 2, gh: northH };
    }
  } else if (options.complexity === 'labyrinthine') {
    upStairRect = { gx: ringX + 1, gy: ringY - 3, gw: 3, gh: 3 };
    downStairRect = { gx: ringX + ringW - 4, gy: ringY - 3, gw: 3, gh: 3 };
  } else {
    // 'bizarre'
    const originGx = coreX + 4;
    const originGy = hallY + 2;
    upStairRect = { gx: originGx - 3, gy: originGy, gw: 3, gh: 3 };
    downStairRect = { gx: originGx + 3, gy: originGy, gw: 3, gh: 3 };
  }

  const blueprint: SharedLayoutBlueprint = {
    simpleTopology,
    standardTopology,
    labyrinthTopology,
    pattern,
    lArmLeft,
    lArmUp,
    coreX,
    hallY,
    coreW,
    northH,
    southH,
    ringX,
    ringY,
    ringW,
    ringH,
    upStairRect,
    downStairRect,
  };

  const generateFloorBundle = (
    floorId: string,
    floorName: string,
    elevationOrder: number,
    upStair: GridRect | undefined,
    downStair: GridRect | undefined,
    hasEntrance: boolean,
    targetCount: number,
    seedOff: number
  ): GeneratedFloorBundle => {
    switch (options.complexity) {
      case 'simple':
        return generateSimpleFloor(
          floorId,
          floorName,
          elevationOrder,
          options,
          blueprint,
          upStair,
          downStair,
          hasEntrance,
          targetCount,
          seedOff
        );
      case 'standard':
        return generateStandardWingedFloor(
          floorId,
          floorName,
          elevationOrder,
          options,
          blueprint,
          upStair,
          downStair,
          hasEntrance,
          targetCount,
          seedOff
        );
      case 'labyrinthine':
        return generateLabyrinthFloor(
          floorId,
          floorName,
          elevationOrder,
          options,
          blueprint,
          upStair,
          downStair,
          hasEntrance,
          targetCount,
          seedOff
        );
      case 'bizarre':
      default:
        return generateBizarreFloor(
          floorId,
          floorName,
          elevationOrder,
          options,
          blueprint,
          upStair,
          downStair,
          hasEntrance,
          targetCount,
          seedOff
        );
    }
  };

  const floors: MapFloor[] = [];
  const stairLinks: StairLink[] = [];

  let cellarBundle: GeneratedFloorBundle | null = null;
  let upperBundle: GeneratedFloorBundle | null = null;

  if (floorCount === 3) {
    const cellarName =
      options.archetype === 'temple'
        ? 'Undercroft Crypt'
        : options.archetype === 'jail'
          ? 'Deep Dungeon'
          : 'Cellar / Vaults';
    cellarBundle = generateFloorBundle(
      `proc-floor-cellar-${stamp}`,
      cellarName,
      -1,
      downStairRect,
      undefined,
      false,
      cellarTarget,
      1
    );
    floors.push(cellarBundle.floor);
  }

  const groundName =
    options.archetype === 'crypt' ? 'Upper Catacombs' : 'Ground Floor';
  const groundBundle = generateFloorBundle(
    `proc-floor-ground-${stamp}`,
    groundName,
    0,
    floorCount >= 2 ? upStairRect : undefined,
    floorCount === 3 ? downStairRect : undefined,
    true,
    groundTarget,
    2
  );
  floors.push(groundBundle.floor);

  if (floorCount >= 2) {
    const upperName =
      options.archetype === 'blacksmith'
        ? 'Smithy Loft'
        : options.archetype === 'fortress'
          ? 'Keep Battlements'
          : options.archetype === 'crypt'
            ? 'Sunken Sanctum'
            : 'Upper Floor';
    upperBundle = generateFloorBundle(
      `proc-floor-upper-${stamp}`,
      upperName,
      1,
      undefined,
      upStairRect,
      false,
      upperTarget,
      3
    );
    floors.push(upperBundle.floor);
  }

  if (upperBundle && groundBundle.stairUpRoomId && upperBundle.stairDownRoomId) {
    stairLinks.push({
      id: `proc-stair-up-${stamp}`,
      label:
        options.archetype === 'blacksmith'
          ? 'Loft Stairway'
          : 'Main Staircase',
      kind: 'stairs',
      fromFloorId: groundBundle.floor.id,
      fromRoomId: groundBundle.stairUpRoomId,
      toFloorId: upperBundle.floor.id,
      toRoomId: upperBundle.stairDownRoomId,
      bidirectional: true,
      enabled: true,
    });
  }

  if (cellarBundle && groundBundle.stairDownRoomId && cellarBundle.stairUpRoomId) {
    stairLinks.push({
      id: `proc-stair-down-${stamp}`,
      label:
        options.archetype === 'guildhall' ? 'Hidden Ladder' : 'Cellar Stair',
      kind: options.archetype === 'guildhall' ? 'ladder' : 'stairs',
      fromFloorId: groundBundle.floor.id,
      fromRoomId: groundBundle.stairDownRoomId,
      toFloorId: cellarBundle.floor.id,
      toRoomId: cellarBundle.stairUpRoomId,
      bidirectional: true,
      enabled: true,
    });
  }

  const titles: Record<LayoutArchetype, string[]> = {
    manor: ['Ashwood Estate', 'Ravenscroft Manor', 'Highmere Hall'],
    fortress: ['Ironwatch Keep', 'Redstone Bastion', 'Vanguard Hold'],
    crypt: ['Barrow of Kings', 'Obsidian Catacombs', 'Sunken Ossuary'],
    tavern: ['The Rusty Anchor', 'Sleeping Gryphon Inn', 'Lantern & Flagon'],
    temple: ['Abbey of Dawn', 'Sanctuary of St. Veyl', 'Ashen Cloister'],
    blacksmith: ['Ironheart Smithy', 'The Ember & Anvil', 'Redforge Foundry'],
    guildhall: ['Shadowcoin Guildhall', 'The Velvet Ledger', 'Dockward Syndicate'],
    jail: ['Blackiron Gaol', 'Lockjaw Penitentiary', 'Cinderwall Keep Prison'],
  };

  return {
    version: 2,
    id: `proc-map-${stamp}`,
    title: pickRandom(titles[options.archetype]),
    floorLabel: groundBundle.floor.name,
    activeFloorId: groundBundle.floor.id,
    floors,
    stairLinks,
    rooms: groundBundle.floor.rooms,
    doorways: groundBundle.floor.doorways,
    suppressedAutoDoorKeys: groundBundle.floor.suppressedAutoDoorKeys ?? [],
    secretPassages: groundBundle.floor.secretPassages,
    autoConnectDoors: true,
    autoConnectTolerance: 18,
    grid: {
      cellSize,
      feetPerCell,
      snapToGrid: true,
      showGrid: true,
    },
  };
}
