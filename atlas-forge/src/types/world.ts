import type { MapDocument } from '../interior/types/map';

export interface Point {
  x: number;
  y: number;
}

export type BiomeType =
  | 'heartland'
  | 'highlands'
  | 'timberland'
  | 'steppe'
  | 'fenland'
  | 'frostmarch'
  | 'ashlands'
  | 'coastline';

export type ThreatTier = 'tier-1' | 'tier-2' | 'tier-3' | 'tier-4' | 'tier-5';

export type ColorCodingMode = 'biome' | 'faction' | 'threat';

export type SettlementTier = 'hamlet' | 'town' | 'city' | 'capital';

export type BuildingShape =
  | 'rectangle'
  | 'l-shape'
  | 'u-shape'
  | 'courtyard'
  | 'round-tower'
  | 'custom';

export type BuildingPurpose =
  | 'tavern'
  | 'smith'
  | 'alchemist'
  | 'guildhall'
  | 'temple'
  | 'manor'
  | 'barracks'
  | 'tower'
  | 'market'
  | 'archive'
  | 'residence'
  | 'custom';

export type ClaimStatus = 'unclaimed' | 'claimed';

/**
 * Link from a claimed building to its interior document. The counts below are a
 * cache derived from the interior itself (never typed in by hand), so the map can
 * show them without loading the interior store.
 */
export interface InteriorLink {
  linkedInteriorId: string;
  /** Above-ground floors that contain rooms */
  floors: number;
  /** Underground floors that contain rooms */
  cellars?: number;
  roomCount: number;
  roomSummary: string;
  linkedAt: string;
  /**
   * Point in the interior editor's coordinates that sits at the building's center.
   * Pinning the interior to the map this way means an edit in the editor grows the
   * building in the same direction on the map.
   */
  anchor?: Point;
}

export interface BuildingFootprint {
  id: string;
  label: string;
  shape: BuildingShape;
  /** Center point in settlement 1000x760 coordinates */
  center: Point;
  /** Width in feet (used for house interior layout handoff) */
  widthFt: number;
  /** Depth in feet (used for house interior layout handoff) */
  depthFt: number;
  /** Rotation in degrees */
  rotationDeg: number;
  /** Precomputed local/world polygon vertices in settlement coordinate space */
  polygon: Point[];
  /** Optional inner courtyard cutout for courtyard shapes */
  courtyard?: Point[];
  district: string;
  floors: number;
  claimStatus: ClaimStatus;
  purpose?: BuildingPurpose;
  customPurposeLabel?: string;
  assignedName?: string;
  /** Optional custom text label displayed directly on the settlement map for claimed buildings */
  mapLabel?: string;
  /** Controls visibility of the custom map label on the settlement canvas (defaults to true) */
  showMapLabel?: boolean;
  notes?: string;
  interiorLink?: InteriorLink;
}

export interface RoadSegment {
  id: string;
  points: Point[];
  width: number;
  kind: 'avenue' | 'street' | 'alley';
}

export interface SettlementFeature {
  id: string;
  kind: 'river' | 'coast' | 'plaza' | 'wall' | 'park';
  points: Point[];
  width?: number;
  closed?: boolean;
}

export interface Settlement {
  id: string;
  name: string;
  tier: SettlementTier;
  seed: number;
  /** Position on the continent map */
  mapAnchor: Point;
  districtCount: number;
  roads: RoadSegment[];
  features: SettlementFeature[];
  buildings: BuildingFootprint[];
  wallGatePositions: Point[];
}

export interface Region {
  id: string;
  name: string;
  biome: BiomeType;
  faction: string;
  factionColor: string;
  threat: ThreatTier;
  /** Optional user custom override hex color */
  customColor?: string;
  /** Irregular polygon vertices in continent 1200x820 coordinate space */
  polygon: Point[];
  /** Seed site used during Voronoi generation */
  seedSite: Point;
  isCoastal: boolean;
  loreNotes: string;
  settlement: Settlement;
}

export type ContinentShape =
  | 'auto'
  | 'crescent'
  | 'peninsula'
  | 'isthmus'
  | 'sprawling';

export interface ContinentConfig {
  name: string;
  seed: number;
  regionCount: number;
  coastlineJaggedness: number; // 0..1
  borderIrregularity: number; // 0..1
  shape?: ContinentShape;
}

export interface WorldState {
  continent: ContinentConfig;
  colorMode: ColorCodingMode;
  regions: Region[];
  updatedAt: string;
}

/**
 * An interior document in the library. Whether it is attached to a building is
 * derived from buildings pointing at it (`building.interiorLink.linkedInteriorId`),
 * so removing or unclaiming a building simply leaves the interior unattached.
 */
export interface InteriorEntry {
  id: string;
  title: string;
  doc: MapDocument;
  createdAt: number;
  updatedAt: number;
}
