import { BiomeType, BuildingPurpose, SettlementTier, ThreatTier } from '../types/world';

export interface BiomeMeta {
  id: BiomeType;
  label: string;
  fill: string;
  stroke: string;
  description: string;
}

export const BIOMES: Record<BiomeType, BiomeMeta> = {
  heartland: {
    id: 'heartland',
    label: 'Emerald Heartland',
    fill: '#7BB668',
    stroke: '#3E6B31',
    description: 'Fertile plains, agrarian river valleys, and trade crossroads.',
  },
  timberland: {
    id: 'timberland',
    label: 'Ancient Timberland',
    fill: '#467D58',
    stroke: '#234A30',
    description: 'Dense old-growth canopy and secluded woodland enclaves.',
  },
  highlands: {
    id: 'highlands',
    label: 'Alpine Highlands',
    fill: '#9EA2AA',
    stroke: '#525761',
    description: 'Granite ridges, highland passes, and ore-rich crags.',
  },
  steppe: {
    id: 'steppe',
    label: 'Sunlit Steppe',
    fill: '#E0BC6B',
    stroke: '#8D6F28',
    description: 'Windswept savannas, ochre mesas, and nomadic trails.',
  },
  fenland: {
    id: 'fenland',
    label: 'Verdant Fen',
    fill: '#6FA39A',
    stroke: '#356058',
    description: 'Misty bayous, tidal reeds, and stilt-built outposts.',
  },
  frostmarch: {
    id: 'frostmarch',
    label: 'Boreal Frostmarch',
    fill: '#C4DDEA',
    stroke: '#5B7E91',
    description: 'Permafrost fjords, snowbound pines, and glacial lakes.',
  },
  ashlands: {
    id: 'ashlands',
    label: 'Ashen Wastes',
    fill: '#9A7670',
    stroke: '#573934',
    description: 'Volcanic basalt plains, obsidian spires, and geothermal rifts.',
  },
  coastline: {
    id: 'coastline',
    label: 'Sapphire Littoral',
    fill: '#7BB5C2',
    stroke: '#376C78',
    description: 'Breezy headlands, chalk cliffs, and sheltered maritime coves.',
  },
};

export const BIOME_LIST: BiomeMeta[] = Object.values(BIOMES);

export interface ThreatMeta {
  id: ThreatTier;
  label: string;
  shortLabel: string;
  fill: string;
  stroke: string;
}

export const THREAT_TIERS: Record<ThreatTier, ThreatMeta> = {
  'tier-1': {
    id: 'tier-1',
    label: 'Tier I · Chartered Peace',
    shortLabel: 'Tier I (Safe)',
    fill: '#93C5A3',
    stroke: '#3B6E4C',
  },
  'tier-2': {
    id: 'tier-2',
    label: 'Tier II · Border Watch',
    shortLabel: 'Tier II (Guarded)',
    fill: '#CBD684',
    stroke: '#6E782C',
  },
  'tier-3': {
    id: 'tier-3',
    label: 'Tier III · Contested Wilds',
    shortLabel: 'Tier III (Wild)',
    fill: '#E2B46E',
    stroke: '#8F6022',
  },
  'tier-4': {
    id: 'tier-4',
    label: 'Tier IV · Perilous Frontier',
    shortLabel: 'Tier IV (Perilous)',
    fill: '#D8836B',
    stroke: '#8A3B28',
  },
  'tier-5': {
    id: 'tier-5',
    label: 'Tier V · Forbidden Reach',
    shortLabel: 'Tier V (Forbidden)',
    fill: '#B66376',
    stroke: '#6D2638',
  },
};

export const THREAT_LIST: ThreatMeta[] = Object.values(THREAT_TIERS);

export interface FactionPreset {
  name: string;
  color: string;
}

export const FACTION_PRESETS: FactionPreset[] = [
  { name: 'Crown of Valenmere', color: '#5E85B8' },
  { name: 'Silverpine League', color: '#5F9E84' },
  { name: 'Ochre Concord', color: '#D4A459' },
  { name: 'Ironpeak Hold', color: '#8A8396' },
  { name: 'Crimson Marches', color: '#C46D69' },
  { name: 'Free Maritime Guilds', color: '#6AA8B8' },
];

export interface PurposeMeta {
  id: BuildingPurpose;
  label: string;
  fill: string;
  stroke: string;
}

export const BUILDING_PURPOSES: Record<BuildingPurpose, PurposeMeta> = {
  tavern: { id: 'tavern', label: 'Tavern & Inn', fill: '#D99B52', stroke: '#7C4B16' },
  smith: { id: 'smith', label: 'Blacksmith & Forge', fill: '#94746B', stroke: '#4A312A' },
  alchemist: { id: 'alchemist', label: 'Alchemist & Apothecary', fill: '#6AA898', stroke: '#2C5E52' },
  guildhall: { id: 'guildhall', label: 'Guildhall & Exchange', fill: '#5B86B8', stroke: '#22456D' },
  temple: { id: 'temple', label: 'Temple & Shrine', fill: '#B6A8D4', stroke: '#524570' },
  manor: { id: 'manor', label: 'Noble Manor', fill: '#C97B84', stroke: '#6E2E36' },
  barracks: { id: 'barracks', label: 'Guardhouse & Barracks', fill: '#7B8A9C', stroke: '#334155' },
  tower: { id: 'tower', label: 'Arcane Tower', fill: '#6D7BC4', stroke: '#2E3873' },
  market: { id: 'market', label: 'Merchant Warehouse', fill: '#C8B06B', stroke: '#6E5A23' },
  archive: { id: 'archive', label: 'Library & Archive', fill: '#7FA7C4', stroke: '#2F5570' },
  residence: { id: 'residence', label: 'Chartered Residence', fill: '#88AD81', stroke: '#3B5C35' },
  custom: { id: 'custom', label: 'Custom Structure', fill: '#8592A6', stroke: '#334155' },
};

export const BUILDING_PURPOSE_LIST: PurposeMeta[] = Object.values(BUILDING_PURPOSES);

export const SETTLEMENT_TIER_META: Record<
  SettlementTier,
  { label: string; targetBuildings: number; hasWall: boolean }
> = {
  hamlet: { label: 'Hamlet', targetBuildings: 16, hasWall: false },
  town: { label: 'Market Town', targetBuildings: 28, hasWall: false },
  city: { label: 'Walled City', targetBuildings: 42, hasWall: true },
  capital: { label: 'Grand Capital', targetBuildings: 56, hasWall: true },
};

export const CONTINENT_NAME_SYLLABLES = [
  'Aethel',
  'Valen',
  'Kar',
  'Solv',
  'Oster',
  'Myr',
  'Drak',
  'Bryn',
  'Thal',
  'Cael',
  'Eld',
  'Vyr',
];

export const CONTINENT_NAME_SUFFIXES = ['gard', 'mere', 'ia', 'mark', 'hold', 'reach', 'land', 'crest'];

export const REGION_PREFIXES = [
  'North',
  'High',
  'Amber',
  'Silver',
  'Ashen',
  'mist',
  'Storm',
  'Green',
  'Iron',
  'Gilded',
  'Frost',
  'Sun',
  'Deep',
  'Old',
  'West',
  'Dawn',
];

export const REGION_ROOTS = [
  'Vale',
  'Reach',
  'Weald',
  'Downs',
  'Moor',
  'Fells',
  'March',
  'Coast',
  'Shire',
  'Crag',
  'Basin',
  'Hollow',
  'Strand',
  'Steppe',
  'Fen',
  'Crown',
];

export const SETTLEMENT_PREFIXES = [
  'Oakhaven',
  'Ravenford',
  'Glimmerwatch',
  'Stonebridge',
  'Port Solis',
  'Briarwood',
  'Dunmore',
  'Alderwick',
  'Goldcrest',
  'Thornwall',
  'Kestrel Bay',
  'Ironhearth',
  'Mirestead',
  'Cinderhall',
  'Frostgate',
  'Vellhaven',
  'Tidewater',
  'Highspire',
];
