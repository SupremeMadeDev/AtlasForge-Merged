export interface Point {
  x: number;
  y: number;
}

export type RoomType = 'room' | 'hallway' | 'stairs' | 'courtyard' | 'secret';

export type FloorMaterial =
  | 'stone'
  | 'wood'
  | 'marble'
  | 'checkered'
  | 'cobble'
  | 'carpet'
  | 'staircase'
  | 'stairway'
  | 'arcane'
  | 'earth'
  | 'water';

export type LightingLevel = 'bright' | 'dim' | 'darkness';

export interface CustomFloorTexture {
  id: string;
  name: string;
  dataUrl: string;
  tileSize: number;
}

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** Ordered polygon vertices in world pixels (40px = 5ft square) */
  points: Point[];
  /**
   * Perpendicular curve bend offset (in world pixels) for each edge i -> (i+1)%n.
   * Positive bends outward/left relative to edge normal, negative bends inward/right.
   */
  edgeCurves: number[];
  /** Optional per-edge flag to remove/hide an outer wall (true = open/no wall drawn) */
  hiddenEdges?: boolean[];
  /** When true, the room has no perimeter walls of its own (keeps adjacent rooms' walls intact) */
  unwalled?: boolean;
  /** Accumulated clockwise rotation in degrees so the rotation handle follows the room */
  rotationDeg?: number;
  /** When true (default), staircase/stairway textures rotate with room.rotationDeg */
  rotateStairTexture?: boolean;
  floorMaterial: FloorMaterial;
  lighting: LightingLevel;
  elevationFt: number;
  /** Custom thematic description: purpose, atmosphere, notable features */
  notes: string;
  showLabel: boolean;
  /** Optional custom tint hex, otherwise derived from floorMaterial */
  customColor?: string;
  /** Optional custom imported floor texture ID from MapDocument.customTextures */
  customTextureId?: string;
  /** Optional tags for filtering and categorizing rooms (e.g. trap, treasure, hostile, secret) */
  tags?: string[];
}

export type DoorKind = 'normal' | 'secret' | 'locked' | 'locked-secret';

export type SliceMode = 'wall' | 'floor';

export interface SliceRegion {
  id: string;
  mode: SliceMode;
  /** Ordered polygon vertices in world pixels */
  points: Point[];
  /** Perpendicular curve bend offset (in world pixels) for each edge i -> (i+1)%n */
  edgeCurves: number[];
}

export interface Doorway {
  id: string;
  roomAId: string;
  /** Null when the doorway leads directly outside (exterior main/side door) */
  roomBId: string | null;
  edgeAIndex: number;
  edgeBIndex: number | null;
  /** World coordinate center of doorway */
  position: Point;
  /** Wall tangent angle in radians */
  angle: number;
  /** Width in world pixels (default ~32px = 4ft) */
  width: number;
  /** Whether the doorway is open/passable (true) or disabled/blocked (false) */
  enabled: boolean;
  /** Door variant: normal, secret, locked, or locked-secret (defaults to 'normal') */
  kind?: DoorKind;
  /** Thieves' Tools DC for locked or locked-secret doors */
  dcLockpick?: number;
  /** Investigation/Perception DC for secret or locked-secret doors */
  dcInvestigation?: number;
  /** True if user dragged/slid the doorway along the wall */
  customPlaced?: boolean;
  /** True if automatically detected from touching/proximate walls */
  autoDetected: boolean;
  /** Parametric relative position [0, 1] along edgeAIndex of roomA */
  wallT?: number;
}

export interface SecretPassage {
  id: string;
  fromRoomId: string;
  /** Null when terminating at an exterior wall / outside exit */
  toRoomId: string | null;
  /** Anchor point on fromRoomId's wall */
  startAnchor: Point;
  /** Perpendicular protrusion distance (px) out of fromRoomId's wall */
  startProtrusion: number;
  /** Anchor point on toRoomId's wall or exterior destination */
  endAnchor: Point;
  /** Perpendicular protrusion distance (px) out of toRoomId's wall (0 when exterior) */
  endProtrusion: number;
  /** Adjustable interior bend/shift points between the two perpendicular elbows */
  midPoints: Point[];
  /** Full resolved polyline points [startAnchor, startElbow, ...midPoints, endElbow?, endAnchor] */
  points: Point[];
  label: string;
  dcInvestigation: number;
  isSecret: true;
}

export type StairKind = 'stairs' | 'spiral' | 'ladder';

export interface StairLink {
  id: string;
  label: string;
  kind: StairKind;
  fromFloorId: string;
  fromRoomId: string;
  toFloorId: string;
  toRoomId: string;
  bidirectional: boolean;
  enabled: boolean;
}

export interface MapFloor {
  id: string;
  name: string;
  /** Vertical order: e.g., -1 (Cellar), 0 (Ground), 1 (Upper), 2 (Attic) */
  elevationOrder: number;
  rooms: Room[];
  doorways: Doorway[];
  suppressedAutoDoorKeys?: string[];
  secretPassages: SecretPassage[];
  slices?: SliceRegion[];
}

export interface GridSettings {
  /** Pixels per 5ft DnD square (40px default) */
  cellSize: number;
  /** Feet per square (5ft default) */
  feetPerCell: number;
  snapToGrid: boolean;
  showGrid: boolean;
}

export interface MapDocument {
  version: number;
  id: string;
  title: string;
  /** Active floor label (mirrored from active floor) */
  floorLabel: string;
  /** Active floor ID */
  activeFloorId: string;
  /** All floors in this map document */
  floors: MapFloor[];
  /** Interlinking stairways/ladders connecting rooms across different floors */
  stairLinks: StairLink[];
  /** Active floor's rooms (kept in sync with active floor) */
  rooms: Room[];
  /** Active floor's doorways (kept in sync with active floor) */
  doorways: Doorway[];
  /** Active floor's suppressed auto-door keys (kept in sync with active floor) */
  suppressedAutoDoorKeys?: string[];
  /** Active floor's secret passages (kept in sync with active floor) */
  secretPassages: SecretPassage[];
  slices?: SliceRegion[];
  /** Document library of user-imported custom floor textures */
  customTextures?: CustomFloorTexture[];
  autoConnectDoors: boolean;
  autoConnectTolerance: number;
  grid: GridSettings;
}

export type ToolMode =
  | 'select'
  | 'rect-room'
  | 'hallway'
  | 'polygon'
  | 'slice'
  | 'doorway'
  | 'secret-passage'
  | 'pathing'
  | 'pan';

export interface PathStop {
  floorId: string;
  roomId: string;
}

export interface PathStep {
  floorId: string;
  floorName: string;
  roomId: string;
  roomName: string;
  roomType: RoomType;
  viaDoorId?: string;
  viaDoorKind?: DoorKind;
  viaSliceId?: string;
  viaSecretPassageId?: string;
  viaSecretPassageLabel?: string;
  viaStairLinkId?: string;
  viaStairLabel?: string;
  /** Midpoint along passage/doorway/stair for placing step indicator */
  portalPosition?: Point;
  /** Waypoints belonging to this room/step on its floor */
  floorWaypoints?: Point[];
  distanceFromPrevFt: number;
  cumulativeDistanceFt: number;
}

export interface PathResult {
  reachable: boolean;
  waypoints: Point[];
  steps: PathStep[];
  totalDistanceFt: number;
  totalSquares: number;
  roundsAt30Ft: number;
  reason?: string;
}

export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export type LayoutComplexity = 'simple' | 'standard' | 'labyrinthine' | 'bizarre';
export type LayoutArchetype =
  | 'manor'
  | 'fortress'
  | 'crypt'
  | 'tavern'
  | 'temple'
  | 'blacksmith'
  | 'guildhall'
  | 'jail';

export interface ProceduralLayoutOptions {
  roomCount: number;
  floorRoomCounts?: {
    cellar?: number;
    ground?: number;
    upper?: number;
  };
  complexity: LayoutComplexity;
  archetype: LayoutArchetype;
  floorCount: 1 | 2 | 3;
  includeCurves: boolean;
  includeDiagonals: boolean;
  includeSecretPassages: boolean;
}

export interface WallHighlight {
  roomId: string;
  edgeIndex: number;
  a: Point;
  b: Point;
}

export interface AccessibilityDiagnostics {
  accessibleRoomIds: Set<string>;
  inaccessibleRoomIds: Set<string>;
  highlightedDisabledDoorIds: Set<string>;
  highlightedWalls: WallHighlight[];
  tooltipMessage: string | null;
  /** Map of floorId -> count of inaccessible rooms on that floor */
  inaccessibleCountByFloor?: Map<string, number>;
  /** Slice IDs on the active floor that block off one or more rooms */
  blockingSliceIds?: Set<string>;
  /** Room IDs on the active floor blocked off specifically by slices */
  sliceBlockedRoomIds?: Set<string>;
  /** Descriptive warning message when slices block off rooms */
  sliceBlockingMessage?: string | null;
}

export interface SavedMapEntry {
  id: string;
  title: string;
  doc: MapDocument;
  savedAt: number;
  updatedAt: number;
}

