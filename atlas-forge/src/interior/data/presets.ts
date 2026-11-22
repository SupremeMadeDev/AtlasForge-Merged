import {
  Doorway,
  FloorMaterial,
  LightingLevel,
  MapDocument,
  Room,
  RoomType,
  SecretPassage,
} from '../types/map';
import {
  findClosestRoomEdge,
  getPointAlongRoomEdge,
  isWallEdgeExterior,
  reconcileDoorways,
  resolveSecretPassagePolyline,
} from '../utils/geometry';
import { pruneRedundantDoorways } from '../utils/proceduralLayout';

export const MATERIAL_PALETTE: Record<
  FloorMaterial,
  {
    label: string;
    lightFill: string;
    darkFill: string;
    strokeLight: string;
    strokeDark: string;
    patternLight: string;
    patternDark: string;
    secondaryLight: string;
    secondaryDark: string;
  }
> = {
  stone: {
    label: 'Flagstone',
    lightFill: '#DDD8CE',
    darkFill: '#242B38',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(68,64,60,0.28)',
    patternDark: 'rgba(148,163,184,0.24)',
    secondaryLight: '#D0C9BD',
    secondaryDark: '#1E2532',
  },
  wood: {
    label: 'Timber Plank',
    lightFill: '#DFC5A2',
    darkFill: '#3B2B1E',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(92,52,20,0.34)',
    patternDark: 'rgba(180,118,62,0.28)',
    secondaryLight: '#D4B68E',
    secondaryDark: '#302217',
  },
  marble: {
    label: 'Veined Marble',
    lightFill: '#F4F2ED',
    darkFill: '#1E293B',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(120,113,108,0.24)',
    patternDark: 'rgba(148,163,184,0.24)',
    secondaryLight: '#E7E4DC',
    secondaryDark: '#263449',
  },
  checkered: {
    label: 'Checkered Tile',
    lightFill: '#F2EFE9',
    darkFill: '#334155',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(41,37,36,0.22)',
    patternDark: 'rgba(15,23,42,0.55)',
    secondaryLight: '#44403C',
    secondaryDark: '#1E293B',
  },
  cobble: {
    label: 'Cobblestone',
    lightFill: '#CEC9BF',
    darkFill: '#252C37',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(41,37,36,0.34)',
    patternDark: 'rgba(148,163,184,0.26)',
    secondaryLight: '#B9B3A7',
    secondaryDark: '#1B212B',
  },
  carpet: {
    label: 'Royal Carpet',
    lightFill: '#9F3B42',
    darkFill: '#4C1D24',
    strokeLight: '#451A22',
    strokeDark: '#000000',
    patternLight: 'rgba(245,215,175,0.28)',
    patternDark: 'rgba(251,191,36,0.22)',
    secondaryLight: '#872E35',
    secondaryDark: '#3B151B',
  },
  staircase: {
    label: 'Grand Staircase',
    lightFill: '#C8A579',
    darkFill: '#3A2A1D',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(139,38,45,0.85)',
    patternDark: 'rgba(127,29,29,0.85)',
    secondaryLight: '#9C764C',
    secondaryDark: '#261A12',
  },
  stairway: {
    label: 'Stone Stairway',
    lightFill: '#CBC5B9',
    darkFill: '#2A313E',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(41,37,36,0.42)',
    patternDark: 'rgba(148,163,184,0.34)',
    secondaryLight: '#ABA395',
    secondaryDark: '#1A202B',
  },
  arcane: {
    label: 'Arcane Slate',
    lightFill: '#D4D8EB',
    darkFill: '#1E1E36',
    strokeLight: '#312E81',
    strokeDark: '#000000',
    patternLight: 'rgba(67,56,202,0.24)',
    patternDark: 'rgba(129,140,248,0.24)',
    secondaryLight: '#C5CAE3',
    secondaryDark: '#282848',
  },
  earth: {
    label: 'Turf & Earth',
    lightFill: '#CFDDC9',
    darkFill: '#1B2E24',
    strokeLight: '#292524',
    strokeDark: '#000000',
    patternLight: 'rgba(21,94,45,0.26)',
    patternDark: 'rgba(52,211,153,0.22)',
    secondaryLight: '#BFCFB8',
    secondaryDark: '#15241C',
  },
  water: {
    label: 'Shallow Water',
    lightFill: '#CBE3EE',
    darkFill: '#142D3E',
    strokeLight: '#0F4C5C',
    strokeDark: '#000000',
    patternLight: 'rgba(14,116,144,0.26)',
    patternDark: 'rgba(56,189,248,0.24)',
    secondaryLight: '#B6D6E5',
    secondaryDark: '#0E2230',
  },
};

export interface RoomTemplatePreset {
  id: string;
  label: string;
  roomType: RoomType;
  floorMaterial: FloorMaterial;
  lighting: LightingLevel;
  description: string;
}

export const ROOM_DESCRIPTION_TEMPLATES: RoomTemplatePreset[] = [
  {
    id: 'barracks',
    label: 'Barracks',
    roomType: 'room',
    floorMaterial: 'stone',
    lighting: 'dim',
    description:
      'Rows of iron-framed bunks and battered footlockers line the damp walls. Weapon racks hold halberds and dented shields; a half-played game of dragonchess sits on a central barrel, smelling of lamp oil and wool.',
  },
  {
    id: 'treasury',
    label: 'Treasury',
    roomType: 'room',
    floorMaterial: 'marble',
    lighting: 'darkness',
    description:
      'Reinforced iron-banded chests rest atop velvet dais pads beneath a faded mural. A DC 15 Investigation check reveals a pressure plate beneath the center rug rigged to a poison-needle ward.',
  },
  {
    id: 'torture-chamber',
    label: 'Torture Chamber',
    roomType: 'room',
    floorMaterial: 'cobble',
    lighting: 'dim',
    description:
      'Cold iron shackles hang from heavy wall rings above stained flagstones and a sluggish floor drain. A glowing brazier illuminates a rack of tongs, rusted manacles, and a ledger of confessions on a scarred lectern.',
  },
  {
    id: 'library',
    label: 'Arcane Library',
    roomType: 'room',
    floorMaterial: 'wood',
    lighting: 'dim',
    description:
      'Floor-to-ceiling mahogany shelves groan under leather-bound grimoires and scroll tubes. Dust motes drift through pale light; pulling the silver-spined tome unlatches a concealed mechanism.',
  },
  {
    id: 'kitchen',
    label: 'Kitchen & Hearth',
    roomType: 'room',
    floorMaterial: 'checkered',
    lighting: 'bright',
    description:
      'A cavernous stone hearth crackles with glowing embers beneath suspended copper cauldrons. Butcher blocks, hanging herbs, and barrels of salted provisions clutter the prep tables.',
  },
  {
    id: 'crypt',
    label: 'Family Crypt',
    roomType: 'secret',
    floorMaterial: 'stone',
    lighting: 'darkness',
    description:
      'Carved limestone alcoves hold sealed sarcophagi draped in cobwebs. Faint cold drafts whisper from behind the northern effigy, and ancient funerary incense lingers in the stale air.',
  },
];

function buildPresetSecretPassage(
  id: string,
  fromRoomId: string,
  toRoomId: string | null,
  startAnchor: { x: number; y: number },
  endAnchor: { x: number; y: number },
  midPoints: Array<{ x: number; y: number }>,
  rooms: Room[],
  dcInvestigation = 15,
  startProtrusion = 28,
  endProtrusion = 28
): SecretPassage {
  const base = {
    fromRoomId,
    toRoomId,
    startAnchor,
    startProtrusion,
    endAnchor,
    endProtrusion: toRoomId ? endProtrusion : 0,
    midPoints,
  };
  const resolved = resolveSecretPassagePolyline(base, rooms);
  return {
    id,
    ...base,
    startAnchor: resolved.startAnchor,
    endAnchor: resolved.endAnchor,
    points: resolved.points,
    label: 'secret passage',
    dcInvestigation,
    isSecret: true,
  };
}

function makeExteriorDoor(
  id: string,
  room: Room,
  edgeIndex: number,
  allRooms: Room[]
): Doorway | null {
  if (!isWallEdgeExterior(room, edgeIndex, allRooms)) return null;
  const mid = getPointAlongRoomEdge(room, edgeIndex, 0.5);
  const edge = findClosestRoomEdge(room, mid);
  return {
    id,
    roomAId: room.id,
    roomBId: null,
    edgeAIndex: edgeIndex,
    edgeBIndex: null,
    position: edge.closest,
    angle: edge.angle,
    width: 34,
    enabled: true,
    customPlaced: true,
    autoDetected: false,
  };
}

export function createBlackwoodManorPreset(): MapDocument {
  // Ground Floor
  const groundRooms: Room[] = [
    {
      id: 'room-foyer',
      name: 'Entry Foyer',
      type: 'room',
      points: [
        { x: 360, y: 440 },
        { x: 520, y: 440 },
        { x: 520, y: 560 },
        { x: 360, y: 560 },
      ],
      edgeCurves: [0, 0, -75, 0],
      floorMaterial: 'marble',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Double oak doors. Hanging brass lantern casts bright light (20ft); marble tile reflects footsteps.',
      showLabel: true,
    },
    {
      id: 'room-grand-hall',
      name: 'Grand Hall',
      type: 'room',
      points: [
        { x: 320, y: 240 },
        { x: 560, y: 240 },
        { x: 560, y: 440 },
        { x: 320, y: 440 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'carpet',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Twin wrought-iron chandeliers above a banquet table. DC 12 Perception spots a loose floorboard.',
      showLabel: true,
    },
    {
      id: 'room-sunroom',
      name: 'West Solarium',
      type: 'room',
      points: [
        { x: 160, y: 280 },
        { x: 320, y: 280 },
        { x: 320, y: 440 },
        { x: 160, y: 440 },
      ],
      edgeCurves: [0, 0, 0, -90],
      floorMaterial: 'checkered',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'Overgrown conservatory with curved leaded-glass bay window overlooking the cliff.',
      showLabel: true,
    },
    {
      id: 'room-north-hall',
      name: 'North Corridor',
      type: 'hallway',
      points: [
        { x: 240, y: 160 },
        { x: 640, y: 160 },
        { x: 640, y: 240 },
        { x: 320, y: 240 },
        { x: 320, y: 280 },
        { x: 240, y: 280 },
      ],
      edgeCurves: [0, 0, 0, 0, 0, 0],
      floorMaterial: 'stone',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'L-shaped service gallery lined with ancestral oil portraits whose eyes seem to follow passersby.',
      showLabel: true,
    },
    {
      id: 'room-grand-stairs',
      name: 'Grand Staircase',
      type: 'stairs',
      points: [
        { x: 160, y: 160 },
        { x: 240, y: 160 },
        { x: 240, y: 280 },
        { x: 160, y: 280 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'staircase',
      lighting: 'bright',
      elevationFt: 10,
      notes: 'Sweeping oak staircase ascending to the Upper Gallery (+15 ft).',
      showLabel: true,
    },
    {
      id: 'room-dining',
      name: 'Dining Parlor',
      type: 'room',
      points: [
        { x: 560, y: 240 },
        { x: 760, y: 240 },
        { x: 760, y: 400 },
        { x: 560, y: 400 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'wood',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'Silver candelabra still warm. Fireplace ash hides a tarnished brass key.',
      showLabel: true,
    },
    {
      id: 'room-kitchen',
      name: 'Kitchen & Hearth',
      type: 'room',
      points: [
        { x: 560, y: 400 },
        { x: 760, y: 400 },
        { x: 760, y: 560 },
        { x: 560, y: 560 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'cobble',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Roaring hearth. Trapdoor hatch under flour sack descends to the Wine Cellar.',
      showLabel: true,
    },
    {
      id: 'room-study',
      name: 'Hidden Sanctum',
      type: 'secret',
      points: [
        { x: 480, y: 40 },
        { x: 680, y: 40 },
        { x: 680, y: 160 },
        { x: 480, y: 160 },
      ],
      edgeCurves: [-55, 0, 0, 0],
      floorMaterial: 'arcane',
      lighting: 'darkness',
      elevationFt: 0,
      notes: 'Secret pivoting bookcase (DC 15 Investigation). Contains chalk ritual circle & spellbook.',
      showLabel: true,
    },
    {
      id: 'room-courtyard',
      name: 'Moonlit Courtyard',
      type: 'courtyard',
      points: [
        { x: 240, y: 40 },
        { x: 480, y: 40 },
        { x: 480, y: 160 },
        { x: 240, y: 160 },
      ],
      edgeCurves: [45, 0, 0, -35],
      floorMaterial: 'earth',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'Mossy stone fountain in the center; low stone balustrade overlooking the north gardens.',
      showLabel: true,
    },
  ];

  const mainDoor = makeExteriorDoor('door-main-entrance', groundRooms[0], 2, groundRooms);
  const rawGroundDoors = reconcileDoorways(
    groundRooms,
    mainDoor ? [mainDoor] : [],
    true,
    18
  );
  const {
    doorways: prunedGroundDoors,
    suppressedAutoDoorKeys: groundSuppressedAutoDoorKeys,
  } = pruneRedundantDoorways(groundRooms, rawGroundDoors);
  const groundDoors = prunedGroundDoors.map((d) => {
    if (d.roomAId === 'room-study' || d.roomBId === 'room-study') {
      return { ...d, enabled: false };
    }
    return d;
  });

  const groundSecrets: SecretPassage[] = [
    buildPresetSecretPassage(
      'sp-solarium-escape',
      'room-sunroom',
      null,
      { x: 160, y: 360 },
      { x: 78, y: 360 },
      [],
      groundRooms,
      14,
      36
    ),
    buildPresetSecretPassage(
      'sp-dining-sanctum',
      'room-dining',
      'room-study',
      { x: 760, y: 300 },
      { x: 680, y: 100 },
      [{ x: 810, y: 200 }],
      groundRooms,
      16,
      28,
      28
    ),
  ];

  // Upper Floor
  const upperRooms: Room[] = [
    {
      id: 'uf-stairs',
      name: 'Upper Landing',
      type: 'stairs',
      points: [
        { x: 160, y: 160 },
        { x: 240, y: 160 },
        { x: 240, y: 280 },
        { x: 160, y: 280 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'staircase',
      lighting: 'bright',
      elevationFt: 15,
      notes: 'Balustrade overlooks the Grand Staircase down to the Ground Floor.',
      showLabel: true,
    },
    {
      id: 'uf-gallery',
      name: 'Upper Gallery',
      type: 'hallway',
      points: [
        { x: 240, y: 160 },
        { x: 640, y: 160 },
        { x: 640, y: 240 },
        { x: 240, y: 240 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'carpet',
      lighting: 'dim',
      elevationFt: 15,
      notes: 'Velvet runner cushions footsteps along the second-story portrait hall.',
      showLabel: true,
    },
    {
      id: 'uf-master',
      name: 'Master Bedchamber',
      type: 'room',
      points: [
        { x: 240, y: 240 },
        { x: 480, y: 240 },
        { x: 480, y: 400 },
        { x: 240, y: 400 },
      ],
      edgeCurves: [0, 0, -50, 0],
      floorMaterial: 'marble',
      lighting: 'dim',
      elevationFt: 15,
      notes: 'Four-poster canopy bed, silver vanity mirror, and locked jewelry coffer (DC 15).',
      showLabel: true,
    },
    {
      id: 'uf-library',
      name: 'Occult Library',
      type: 'room',
      points: [
        { x: 480, y: 240 },
        { x: 680, y: 240 },
        { x: 680, y: 400 },
        { x: 480, y: 400 },
      ],
      edgeCurves: [0, -45, 0, 0],
      floorMaterial: 'wood',
      lighting: 'dim',
      elevationFt: 15,
      notes: 'Tall walnut bookcases packed with planar atlases and family journals.',
      showLabel: true,
    },
    {
      id: 'uf-tower-observatory',
      name: 'Moon Observatory',
      type: 'room',
      points: [
        { x: 480, y: 40 },
        { x: 680, y: 40 },
        { x: 680, y: 160 },
        { x: 480, y: 160 },
      ],
      edgeCurves: [-65, 0, 0, 0],
      floorMaterial: 'arcane',
      lighting: 'bright',
      elevationFt: 15,
      notes: 'Brass telescope aimed through a domed skylight; star charts pinpointed to Blackwood Peak.',
      showLabel: true,
    },
  ];
  const upperDoors = reconcileDoorways(upperRooms, [], true, 18);

  // Cellar Floor
  const cellarRooms: Room[] = [
    {
      id: 'cf-cellar-hatch',
      name: 'Cellar Landing',
      type: 'stairs',
      points: [
        { x: 560, y: 400 },
        { x: 760, y: 400 },
        { x: 760, y: 560 },
        { x: 560, y: 560 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'cobble',
      lighting: 'dim',
      elevationFt: -10,
      notes: 'Damp wooden ladder ascending to the Kitchen & Hearth trapdoor.',
      showLabel: true,
    },
    {
      id: 'cf-wine-vault',
      name: 'Wine Cellar',
      type: 'room',
      points: [
        { x: 360, y: 400 },
        { x: 560, y: 400 },
        { x: 560, y: 560 },
        { x: 360, y: 560 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'stone',
      lighting: 'darkness',
      elevationFt: -10,
      notes: 'Dusty oak casks stamped 1412 DR. A loose brick hides a small velvet pouch.',
      showLabel: true,
    },
    {
      id: 'cf-cistern',
      name: 'Underground Cistern',
      type: 'room',
      points: [
        { x: 360, y: 240 },
        { x: 600, y: 240 },
        { x: 600, y: 400 },
        { x: 360, y: 400 },
      ],
      edgeCurves: [0, 0, 0, -40],
      floorMaterial: 'water',
      lighting: 'darkness',
      elevationFt: -10,
      notes: 'Cold black spring water fed by an underground aquifer; rusted grate leads toward the cliff.',
      showLabel: true,
    },
  ];
  const cellarDoors = reconcileDoorways(cellarRooms, [], true, 18);

  const floors: MapDocument['floors'] = [
    {
      id: 'floor-cellar',
      name: 'Cellar',
      elevationOrder: -1,
      rooms: cellarRooms,
      doorways: cellarDoors,
      suppressedAutoDoorKeys: [],
      secretPassages: [],
    },
    {
      id: 'floor-ground',
      name: 'Ground Floor',
      elevationOrder: 0,
      rooms: groundRooms,
      doorways: groundDoors,
      suppressedAutoDoorKeys: groundSuppressedAutoDoorKeys,
      secretPassages: groundSecrets,
    },
    {
      id: 'floor-upper',
      name: 'Upper Gallery',
      elevationOrder: 1,
      rooms: upperRooms,
      doorways: upperDoors,
      suppressedAutoDoorKeys: [],
      secretPassages: [],
    },
  ];

  const stairLinks: MapDocument['stairLinks'] = [
    {
      id: 'stair-manor-grand',
      label: 'Grand Staircase',
      kind: 'stairs',
      fromFloorId: 'floor-ground',
      fromRoomId: 'room-grand-stairs',
      toFloorId: 'floor-upper',
      toRoomId: 'uf-stairs',
      bidirectional: true,
      enabled: true,
    },
    {
      id: 'stair-manor-cellar',
      label: 'Cellar Ladder',
      kind: 'ladder',
      fromFloorId: 'floor-ground',
      fromRoomId: 'room-kitchen',
      toFloorId: 'floor-cellar',
      toRoomId: 'cf-cellar-hatch',
      bidirectional: true,
      enabled: true,
    },
  ];

  return {
    version: 2,
    id: 'blackwood-manor',
    title: 'Blackwood Manor',
    floorLabel: 'Ground Floor',
    activeFloorId: 'floor-ground',
    floors,
    stairLinks,
    rooms: groundRooms,
    doorways: groundDoors,
    suppressedAutoDoorKeys: groundSuppressedAutoDoorKeys,
    secretPassages: groundSecrets,
    autoConnectDoors: true,
    autoConnectTolerance: 18,
    grid: {
      cellSize: 40,
      feetPerCell: 5,
      snapToGrid: true,
      showGrid: true,
    },
  };
}

export function createTavernPreset(): MapDocument {
  const groundRooms: Room[] = [
    {
      id: 'tv-porch',
      name: 'Covered Porch',
      type: 'courtyard',
      points: [
        { x: 240, y: 400 },
        { x: 440, y: 400 },
        { x: 440, y: 480 },
        { x: 240, y: 480 },
      ],
      edgeCurves: [0, 0, -30, 0],
      floorMaterial: 'wood',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Swinging copper lantern above timber steps; hitching rail along the road.',
      showLabel: true,
    },
    {
      id: 'tv-taproom',
      name: 'Main Taproom',
      type: 'room',
      points: [
        { x: 200, y: 200 },
        { x: 520, y: 200 },
        { x: 520, y: 400 },
        { x: 200, y: 400 },
      ],
      edgeCurves: [0, 0, 0, -45],
      floorMaterial: 'wood',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Long oak bar, roaring west stone hearth, and round tables crowded with travelers.',
      showLabel: true,
    },
    {
      id: 'tv-stage',
      name: "Bard's Alcove",
      type: 'room',
      points: [
        { x: 520, y: 200 },
        { x: 680, y: 200 },
        { x: 680, y: 320 },
        { x: 520, y: 320 },
      ],
      edgeCurves: [0, -45, 0, 0],
      floorMaterial: 'carpet',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Raised velvet stage in a bowed alcove; lute stand and tip coffer.',
      showLabel: true,
    },
    {
      id: 'tv-kitchen',
      name: 'Hearth Kitchen',
      type: 'room',
      points: [
        { x: 520, y: 320 },
        { x: 680, y: 320 },
        { x: 680, y: 440 },
        { x: 520, y: 440 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'checkered',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Simmering mutton stew, copper kettles, and racks of dried herbs.',
      showLabel: true,
    },
    {
      id: 'tv-hall',
      name: 'Back Corridor',
      type: 'hallway',
      points: [
        { x: 240, y: 120 },
        { x: 520, y: 120 },
        { x: 520, y: 200 },
        { x: 240, y: 200 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'stone',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'Service passage linking the taproom to the office and cellar stair.',
      showLabel: true,
    },
    {
      id: 'tv-office',
      name: "Innkeeper's Office",
      type: 'room',
      points: [
        { x: 120, y: 120 },
        { x: 240, y: 120 },
        { x: 240, y: 200 },
        { x: 120, y: 200 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'wood',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'Ledgers, brass coin scale, and a locked strongbox beneath the desk.',
      showLabel: true,
    },
    {
      id: 'tv-stairs',
      name: 'Cellar Stairs',
      type: 'stairs',
      points: [
        { x: 520, y: 120 },
        { x: 640, y: 120 },
        { x: 640, y: 200 },
        { x: 520, y: 200 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'stairway',
      lighting: 'dim',
      elevationFt: -5,
      notes: 'Creaking stone steps descending into the ale cellar.',
      showLabel: true,
    },
  ];

  const porchDoor = makeExteriorDoor('tv-door-main', groundRooms[0], 2, groundRooms);
  const rawGroundDoors = reconcileDoorways(
    groundRooms,
    porchDoor ? [porchDoor] : [],
    true,
    18
  );
  const {
    doorways: groundDoors,
    suppressedAutoDoorKeys: groundSuppressed,
  } = pruneRedundantDoorways(groundRooms, rawGroundDoors);

  const cellarRooms: Room[] = [
    {
      id: 'tvc-landing',
      name: 'Cellar Landing',
      type: 'stairs',
      points: [
        { x: 520, y: 120 },
        { x: 640, y: 120 },
        { x: 640, y: 200 },
        { x: 520, y: 200 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'stairway',
      lighting: 'dim',
      elevationFt: -10,
      notes: 'Cool limestone landing at the foot of the taproom steps.',
      showLabel: true,
    },
    {
      id: 'tvc-ale',
      name: 'Ale & Cask Vault',
      type: 'room',
      points: [
        { x: 280, y: 120 },
        { x: 520, y: 120 },
        { x: 520, y: 280 },
        { x: 280, y: 280 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'cobble',
      lighting: 'dim',
      elevationFt: -10,
      notes: 'Stacked oak barrels of dwarven stout; a false cask pivots on oiled hinges.',
      showLabel: true,
    },
    {
      id: 'tvc-smugglers',
      name: "Smugglers' Den",
      type: 'secret',
      points: [
        { x: 120, y: 160 },
        { x: 240, y: 160 },
        { x: 240, y: 320 },
        { x: 120, y: 320 },
      ],
      edgeCurves: [-35, 0, 0, 0],
      floorMaterial: 'earth',
      lighting: 'darkness',
      elevationFt: -10,
      notes: 'Damp earthen hideout stacked with untaxed crates and a tunnel to the river bank.',
      showLabel: true,
    },
  ];

  const cellarDoors = reconcileDoorways(cellarRooms, [], true, 18);
  const cellarSecrets: SecretPassage[] = [
    buildPresetSecretPassage(
      'tv-sp-ale-smugglers',
      'tvc-ale',
      'tvc-smugglers',
      { x: 280, y: 220 },
      { x: 240, y: 220 },
      [],
      cellarRooms,
      14,
      14,
      14
    ),
    buildPresetSecretPassage(
      'tv-sp-river-exit',
      'tvc-smugglers',
      null,
      { x: 120, y: 240 },
      { x: 40, y: 240 },
      [],
      cellarRooms,
      15,
      34
    ),
  ];

  const floors: MapDocument['floors'] = [
    {
      id: 'tv-floor-cellar',
      name: 'Cellar',
      elevationOrder: -1,
      rooms: cellarRooms,
      doorways: cellarDoors,
      suppressedAutoDoorKeys: [],
      secretPassages: cellarSecrets,
    },
    {
      id: 'tv-floor-ground',
      name: 'Ground Floor',
      elevationOrder: 0,
      rooms: groundRooms,
      doorways: groundDoors,
      suppressedAutoDoorKeys: groundSuppressed,
      secretPassages: [],
    },
  ];

  const stairLinks: MapDocument['stairLinks'] = [
    {
      id: 'tv-stair-cellar',
      label: 'Cellar Stairs',
      kind: 'stairs',
      fromFloorId: 'tv-floor-ground',
      fromRoomId: 'tv-stairs',
      toFloorId: 'tv-floor-cellar',
      toRoomId: 'tvc-landing',
      bidirectional: true,
      enabled: true,
    },
  ];

  return {
    version: 2,
    id: 'copper-flagon',
    title: 'The Copper Flagon',
    floorLabel: 'Ground Floor',
    activeFloorId: 'tv-floor-ground',
    floors,
    stairLinks,
    rooms: groundRooms,
    doorways: groundDoors,
    suppressedAutoDoorKeys: groundSuppressed,
    secretPassages: [],
    autoConnectDoors: true,
    autoConnectTolerance: 18,
    grid: {
      cellSize: 40,
      feetPerCell: 5,
      snapToGrid: true,
      showGrid: true,
    },
  };
}

export function createFortressPreset(): MapDocument {
  const groundRooms: Room[] = [
    {
      id: 'sw-gatehouse',
      name: 'Gatehouse Entry',
      type: 'room',
      points: [
        { x: 320, y: 440 },
        { x: 480, y: 440 },
        { x: 480, y: 560 },
        { x: 320, y: 560 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'cobble',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Iron portcullis, murder holes overhead, and winch chains along the side wall.',
      showLabel: true,
    },
    {
      id: 'sw-bailey',
      name: 'Inner Bailey',
      type: 'courtyard',
      points: [
        { x: 240, y: 240 },
        { x: 560, y: 240 },
        { x: 560, y: 440 },
        { x: 240, y: 440 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'earth',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Open flagstone and packed-earth training yard with a stone well.',
      showLabel: true,
    },
    {
      id: 'sw-barracks',
      name: 'Guard Barracks',
      type: 'room',
      points: [
        { x: 80, y: 240 },
        { x: 240, y: 240 },
        { x: 240, y: 440 },
        { x: 80, y: 440 },
      ],
      edgeCurves: [0, 0, 0, -55],
      floorMaterial: 'stone',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'Rounded west bastion housing bunks, footlockers, and duty rosters.',
      showLabel: true,
    },
    {
      id: 'sw-armory',
      name: 'Keep Armory',
      type: 'room',
      points: [
        { x: 560, y: 240 },
        { x: 720, y: 240 },
        { x: 720, y: 440 },
        { x: 560, y: 440 },
      ],
      edgeCurves: [0, -55, 0, 0],
      floorMaterial: 'stone',
      lighting: 'dim',
      elevationFt: 0,
      notes: 'Shield racks, heavy crossbows, and oiled crates of spare quarrels.',
      showLabel: true,
    },
    {
      id: 'sw-great-hall',
      name: "Warden's Hall",
      type: 'room',
      points: [
        { x: 240, y: 80 },
        { x: 560, y: 80 },
        { x: 560, y: 240 },
        { x: 240, y: 240 },
      ],
      edgeCurves: [-50, 0, 0, 0],
      floorMaterial: 'carpet',
      lighting: 'bright',
      elevationFt: 0,
      notes: 'Banners of the watch hang above a dais and long slate council table.',
      showLabel: true,
    },
    {
      id: 'sw-tower-stairs',
      name: 'Bastion Spiral',
      type: 'stairs',
      points: [
        { x: 560, y: 80 },
        { x: 680, y: 80 },
        { x: 680, y: 240 },
        { x: 560, y: 240 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'staircase',
      lighting: 'dim',
      elevationFt: 10,
      notes: 'Winding stone steps climbing to the Upper Bastion and battlements.',
      showLabel: true,
    },
    {
      id: 'sw-vault',
      name: 'Locked Strongbox',
      type: 'secret',
      points: [
        { x: 120, y: 80 },
        { x: 240, y: 80 },
        { x: 240, y: 200 },
        { x: 120, y: 200 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'arcane',
      lighting: 'darkness',
      elevationFt: 0,
      notes: 'Reinforced iron vault (DC 16 Thieves’ Tools) storing garrison payroll and sealed dispatches.',
      showLabel: true,
    },
  ];

  const gateDoor = makeExteriorDoor('sw-door-gate', groundRooms[0], 2, groundRooms);
  const rawGroundDoors = reconcileDoorways(
    groundRooms,
    gateDoor ? [gateDoor] : [],
    true,
    18
  );
  const {
    doorways: prunedGroundDoors,
    suppressedAutoDoorKeys: groundSuppressed,
  } = pruneRedundantDoorways(groundRooms, rawGroundDoors);
  const groundDoors = prunedGroundDoors.map((d) => {
    if (d.roomAId === 'sw-vault' || d.roomBId === 'sw-vault') {
      return { ...d, kind: 'locked' as const, dcLockpick: 16 };
    }
    return d;
  });

  const upperRooms: Room[] = [
    {
      id: 'swu-tower',
      name: 'Upper Bastion',
      type: 'stairs',
      points: [
        { x: 560, y: 80 },
        { x: 680, y: 80 },
        { x: 680, y: 240 },
        { x: 560, y: 240 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'staircase',
      lighting: 'bright',
      elevationFt: 20,
      notes: 'Top landing of the bastion stair with arrow slits overlooking the east ridge.',
      showLabel: true,
    },
    {
      id: 'swu-war-room',
      name: 'War Room',
      type: 'room',
      points: [
        { x: 280, y: 80 },
        { x: 560, y: 80 },
        { x: 560, y: 240 },
        { x: 280, y: 240 },
      ],
      edgeCurves: [-45, 0, 0, 0],
      floorMaterial: 'wood',
      lighting: 'bright',
      elevationFt: 20,
      notes: 'Carved relief map table studded with wooden troop markers.',
      showLabel: true,
    },
    {
      id: 'swu-parapet',
      name: 'North Battlements',
      type: 'courtyard',
      points: [
        { x: 160, y: 240 },
        { x: 560, y: 240 },
        { x: 560, y: 320 },
        { x: 160, y: 320 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'stone',
      lighting: 'bright',
      elevationFt: 20,
      notes: 'Crenellated stone walkway overlooking the inner bailey below.',
      showLabel: true,
    },
    {
      id: 'swu-beacon',
      name: 'Signal Beacon',
      type: 'room',
      points: [
        { x: 160, y: 80 },
        { x: 280, y: 80 },
        { x: 280, y: 240 },
        { x: 160, y: 240 },
      ],
      edgeCurves: [0, 0, 0, 0],
      floorMaterial: 'arcane',
      lighting: 'bright',
      elevationFt: 20,
      notes: 'Runed iron brazier ready to flare amber across the frontier.',
      showLabel: true,
    },
  ];

  const upperDoors = reconcileDoorways(upperRooms, [], true, 18);

  const floors: MapDocument['floors'] = [
    {
      id: 'sw-floor-ground',
      name: 'Ground Keep',
      elevationOrder: 0,
      rooms: groundRooms,
      doorways: groundDoors,
      suppressedAutoDoorKeys: groundSuppressed,
      secretPassages: [],
    },
    {
      id: 'sw-floor-upper',
      name: 'Battlements',
      elevationOrder: 1,
      rooms: upperRooms,
      doorways: upperDoors,
      suppressedAutoDoorKeys: [],
      secretPassages: [],
    },
  ];

  const stairLinks: MapDocument['stairLinks'] = [
    {
      id: 'sw-stair-bastion',
      label: 'Bastion Spiral',
      kind: 'spiral',
      fromFloorId: 'sw-floor-ground',
      fromRoomId: 'sw-tower-stairs',
      toFloorId: 'sw-floor-upper',
      toRoomId: 'swu-tower',
      bidirectional: true,
      enabled: true,
    },
  ];

  return {
    version: 2,
    id: 'shadowwatch-keep',
    title: 'Shadowwatch Keep',
    floorLabel: 'Ground Keep',
    activeFloorId: 'sw-floor-ground',
    floors,
    stairLinks,
    rooms: groundRooms,
    doorways: groundDoors,
    suppressedAutoDoorKeys: groundSuppressed,
    secretPassages: [],
    autoConnectDoors: true,
    autoConnectTolerance: 18,
    grid: {
      cellSize: 40,
      feetPerCell: 5,
      snapToGrid: true,
      showGrid: true,
    },
  };
}

export function createEmptyMapPreset(): MapDocument {
  const floorId = `floor-${Date.now()}`;
  return {
    version: 2,
    id: `map-${Date.now()}`,
    title: 'Untitled Keep',
    floorLabel: 'Ground Floor',
    activeFloorId: floorId,
    floors: [
      {
        id: floorId,
        name: 'Ground Floor',
        elevationOrder: 0,
        rooms: [],
        doorways: [],
        suppressedAutoDoorKeys: [],
        secretPassages: [],
      },
    ],
    stairLinks: [],
    rooms: [],
    doorways: [],
    suppressedAutoDoorKeys: [],
    secretPassages: [],
    autoConnectDoors: true,
    autoConnectTolerance: 18,
    grid: {
      cellSize: 40,
      feetPerCell: 5,
      snapToGrid: true,
      showGrid: true,
    },
  };
}
