import { MATERIAL_PALETTE } from '../data/presets';
import {
  CustomFloorTexture,
  FloorMaterial,
  MapDocument,
  MapFloor,
  PathResult,
  Room,
  SliceRegion,
} from '../types/map';
import {
  buildRoomSvgPath,
  buildRoomWallPath,
  computeFloorSliceWalls,
  diagnoseMultiFloorAccessibility,
  getEffectiveRoomAreaSqFt,
  getEffectiveRoomLabelAnchor,
  getOrientedStairBox,
  getPolygonBoundingBox,
  isDoorwaySliced,
  resolveSecretPassagePolyline,
  sampleRoomPolygon,
} from './geometry';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildFloorPatternDefs(darkTheme: boolean, idPrefix = 'tex'): string {
  const materials = Object.keys(MATERIAL_PALETTE) as FloorMaterial[];
  const hiLite = darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)';
  const shdw = darkTheme ? 'rgba(0,0,0,0.48)' : 'rgba(28,25,23,0.18)';
  const deepShdw = darkTheme ? 'rgba(0,0,0,0.65)' : 'rgba(28,25,23,0.28)';

  return materials
    .map((matKey) => {
      const mat = MATERIAL_PALETTE[matKey];
      const base = darkTheme ? mat.darkFill : mat.lightFill;
      const alt = darkTheme ? mat.secondaryDark : mat.secondaryLight;
      const line = darkTheme ? mat.patternDark : mat.patternLight;
      const pid = `${idPrefix}-${matKey}`;

      if (matKey === 'stone') {
        return `<pattern id="${pid}" width="64" height="64" patternUnits="userSpaceOnUse">
          <rect width="64" height="64" fill="${base}" />
          <rect x="1" y="1" width="30" height="20" fill="${alt}" fill-opacity="0.45" />
          <rect x="33" y="23" width="30" height="19" fill="${alt}" fill-opacity="0.38" />
          <rect x="16" y="44" width="28" height="19" fill="${alt}" fill-opacity="0.5" />
          <path d="M 1 20 V 1 H 31 M 33 20 V 1 H 63 M 1 42 V 23 H 15 M 17 42 V 23 H 47 M 49 42 V 23 H 63 M 1 62 V 44 H 39 M 41 62 V 44 H 63" stroke="${hiLite}" stroke-width="1.1" fill="none" />
          <path d="M 0 21.5 H 64 M 0 43 H 64 M 0 63.5 H 64 M 32 0 V 21.5 M 16 21.5 V 43 M 48 21.5 V 43 M 40 43 V 64" stroke="${shdw}" stroke-width="1.4" fill="none" />
          <path d="M 8 8 L 14 12 L 17 10 M 44 28 L 51 33 L 55 31 M 22 50 L 27 56" stroke="${line}" stroke-width="0.75" stroke-opacity="0.6" fill="none" />
          <circle cx="24" cy="14" r="0.9" fill="${line}" />
          <circle cx="56" cy="11" r="0.8" fill="${line}" />
          <circle cx="10" cy="34" r="1.1" fill="${line}" />
          <circle cx="53" cy="53" r="0.9" fill="${line}" />
        </pattern>`;
      }
      if (matKey === 'wood') {
        return `<pattern id="${pid}" width="80" height="40" patternUnits="userSpaceOnUse">
          <rect width="80" height="40" fill="${base}" />
          <rect x="0" y="0" width="80" height="10" fill="${alt}" fill-opacity="0.42" />
          <rect x="0" y="20" width="80" height="10" fill="${alt}" fill-opacity="0.28" />
          <path d="M 0 1 H 80 M 0 11 H 80 M 0 21 H 80 M 0 31 H 80" stroke="${hiLite}" stroke-width="0.85" fill="none" />
          <path d="M 0 10 H 80 M 0 20 H 80 M 0 30 H 80 M 0 39.5 H 80 M 22 0 V 10 M 58 10 V 20 M 14 20 V 30 M 46 30 V 40" stroke="${shdw}" stroke-width="1.15" fill="none" />
          <path d="M 3 4 Q 12 6 19 4 M 26 5 Q 48 2 76 6 M 4 15 Q 24 13 54 16 M 62 14 Q 72 16 78 14 M 18 25 Q 38 28 74 24 M 6 35 Q 24 33 42 36 M 50 35 Q 64 37 78 34" stroke="${line}" stroke-width="0.65" stroke-opacity="0.65" fill="none" />
          <ellipse cx="42" cy="5" rx="3.5" ry="1.6" fill="none" stroke="${line}" stroke-width="0.65" stroke-opacity="0.7" />
          <ellipse cx="30" cy="25" rx="2.8" ry="1.4" fill="none" stroke="${line}" stroke-width="0.65" stroke-opacity="0.65" />
          <circle cx="20" cy="3" r="0.8" fill="${deepShdw}" />
          <circle cx="20" cy="7" r="0.8" fill="${deepShdw}" />
          <circle cx="56" cy="13" r="0.8" fill="${deepShdw}" />
          <circle cx="56" cy="17" r="0.8" fill="${deepShdw}" />
          <circle cx="12" cy="23" r="0.8" fill="${deepShdw}" />
          <circle cx="44" cy="33" r="0.8" fill="${deepShdw}" />
        </pattern>`;
      }
      if (matKey === 'marble') {
        return `<pattern id="${pid}" width="72" height="72" patternUnits="userSpaceOnUse">
          <rect width="72" height="72" fill="${base}" />
          <rect x="0" y="0" width="36" height="36" fill="${alt}" fill-opacity="0.32" />
          <rect x="36" y="36" width="36" height="36" fill="${alt}" fill-opacity="0.32" />
          <path d="M 4 32 L 32 4 M 40 68 L 68 40" stroke="${hiLite}" stroke-width="3" stroke-opacity="0.45" />
          <path d="M 2 14 Q 14 10 22 20 T 34 32 M 38 6 Q 48 16 58 14 T 70 28 M 6 48 Q 18 44 26 56 T 34 68 M 40 46 Q 52 54 66 44" stroke="${line}" stroke-width="1.1" stroke-opacity="0.65" fill="none" />
          <path d="M 10 2 Q 16 14 12 28 M 50 38 Q 56 50 48 66" stroke="${line}" stroke-width="0.55" stroke-opacity="0.45" fill="none" />
          <path d="M 36 0 V 72 M 0 36 H 72 M 72 0 V 72 M 0 72 H 72" stroke="${shdw}" stroke-width="0.95" fill="none" />
        </pattern>`;
      }
      if (matKey === 'checkered') {
        return `<pattern id="${pid}" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" fill="${base}" />
          <rect x="0" y="0" width="20" height="20" fill="${alt}" />
          <rect x="20" y="20" width="20" height="20" fill="${alt}" />
          <rect x="2" y="2" width="16" height="16" fill="none" stroke="${hiLite}" stroke-width="0.75" stroke-opacity="0.5" />
          <rect x="22" y="2" width="16" height="16" fill="none" stroke="${hiLite}" stroke-width="0.75" stroke-opacity="0.65" />
          <rect x="2" y="22" width="16" height="16" fill="none" stroke="${hiLite}" stroke-width="0.75" stroke-opacity="0.65" />
          <rect x="22" y="22" width="16" height="16" fill="none" stroke="${hiLite}" stroke-width="0.75" stroke-opacity="0.5" />
          <path d="M 20 0 V 40 M 0 20 H 40 M 40 0 V 40 M 0 40 H 40" stroke="${shdw}" stroke-width="1.1" fill="none" />
        </pattern>`;
      }
      if (matKey === 'cobble') {
        return `<pattern id="${pid}" width="44" height="44" patternUnits="userSpaceOnUse">
          <rect width="44" height="44" fill="${deepShdw}" />
          <rect width="44" height="44" fill="${alt}" fill-opacity="0.65" />
          <rect x="2" y="2" width="17" height="15" rx="6" fill="${base}" stroke="${shdw}" stroke-width="1.3" />
          <path d="M 5 5 Q 10 3 16 5" stroke="${hiLite}" stroke-width="1.1" fill="none" stroke-linecap="round" />
          <rect x="22" y="3" width="19" height="13" rx="6" fill="${base}" stroke="${shdw}" stroke-width="1.3" />
          <path d="M 25 6 Q 31 4 37 6" stroke="${hiLite}" stroke-width="1.1" fill="none" stroke-linecap="round" />
          <rect x="3" y="20" width="14" height="18" rx="5.5" fill="${base}" stroke="${shdw}" stroke-width="1.3" />
          <path d="M 6 23 Q 10 21 14 23" stroke="${hiLite}" stroke-width="1.1" fill="none" stroke-linecap="round" />
          <rect x="20" y="19" width="21" height="14" rx="6" fill="${base}" stroke="${shdw}" stroke-width="1.3" />
          <path d="M 24 22 Q 31 20 37 22" stroke="${hiLite}" stroke-width="1.1" fill="none" stroke-linecap="round" />
          <rect x="19" y="35" width="13" height="7" rx="3.5" fill="${base}" stroke="${shdw}" stroke-width="1.1" />
          <rect x="34" y="35" width="8" height="7" rx="3" fill="${base}" stroke="${shdw}" stroke-width="1.1" />
        </pattern>`;
      }
      if (matKey === 'carpet') {
        return `<pattern id="${pid}" width="36" height="36" patternUnits="userSpaceOnUse">
          <rect width="36" height="36" fill="${base}" />
          <path d="M 0 6 H 36 M 0 18 H 36 M 0 30 H 36 M 6 0 V 36 M 18 0 V 36 M 30 0 V 36" stroke="${alt}" stroke-width="0.75" stroke-opacity="0.55" />
          <path d="M 0 0 L 36 36 M 36 0 L 0 36" stroke="${alt}" stroke-width="1" stroke-opacity="0.45" />
          <path d="M 18 4 L 32 18 L 18 32 L 4 18 Z" stroke="${line}" stroke-width="1.2" fill="none" />
          <path d="M 18 9 L 27 18 L 18 27 L 9 18 Z" stroke="${line}" stroke-width="0.75" stroke-opacity="0.75" fill="none" />
          <circle cx="18" cy="18" r="2.5" fill="${line}" />
        </pattern>`;
      }
      if (matKey === 'staircase') {
        const runnerFill = darkTheme ? '#6F1D24' : '#8B262D';
        const runnerEdge = darkTheme ? '#D97706' : '#EAB308';
        const steps = [0, 12, 24, 36]
          .map(
            (y) =>
              `<rect x="5" y="${y}" width="54" height="3.5" fill="${deepShdw}" />` +
              `<line x1="5" y1="${y + 4}" x2="59" y2="${y + 4}" stroke="${hiLite}" stroke-width="1" />` +
              `<line x1="5" y1="${y + 11.5}" x2="59" y2="${y + 11.5}" stroke="${shdw}" stroke-width="0.8" />`
          )
          .join('');
        const rods = [0, 12, 24, 36]
          .map(
            (y) =>
              `<rect x="16" y="${y}" width="32" height="3.2" fill="rgba(0,0,0,0.34)" />` +
              `<line x1="15" y1="${y + 3.2}" x2="49" y2="${y + 3.2}" stroke="${runnerEdge}" stroke-width="1.1" stroke-opacity="0.85" />`
          )
          .join('');
        return `<pattern id="${pid}" width="64" height="48" patternUnits="userSpaceOnUse">
          <rect width="64" height="48" fill="${base}" />
          <rect x="0" y="0" width="5" height="48" fill="${alt}" />
          <rect x="59" y="0" width="5" height="48" fill="${alt}" />
          ${steps}
          <rect x="16" y="0" width="32" height="48" fill="${runnerFill}" fill-opacity="0.92" />
          <line x1="17.5" y1="0" x2="17.5" y2="48" stroke="${runnerEdge}" stroke-width="1.2" stroke-opacity="0.8" />
          <line x1="46.5" y1="0" x2="46.5" y2="48" stroke="${runnerEdge}" stroke-width="1.2" stroke-opacity="0.8" />
          ${rods}
          <line x1="5" y1="0" x2="5" y2="48" stroke="${shdw}" stroke-width="1.4" />
          <line x1="59" y1="0" x2="59" y2="48" stroke="${shdw}" stroke-width="1.4" />
        </pattern>`;
      }
      if (matKey === 'stairway') {
        const steps = [0, 12, 24, 36]
          .map((y, idx) => {
            const jx = idx % 2 === 0 ? 22 : 36;
            const cx1 = idx % 2 === 0 ? 8 : 14;
            const cx2 = idx % 2 === 0 ? 14 : 20;
            return (
              `<rect x="0" y="${y}" width="56" height="12" fill="${idx % 2 === 0 ? base : alt}" fill-opacity="${idx % 2 === 0 ? 1 : 0.48}" />` +
              `<rect x="0" y="${y}" width="56" height="3.2" fill="${deepShdw}" />` +
              `<line x1="0" y1="${y + 3.6}" x2="56" y2="${y + 3.6}" stroke="${hiLite}" stroke-width="1" />` +
              `<line x1="${jx}" y1="${y}" x2="${jx}" y2="${y + 12}" stroke="${shdw}" stroke-width="1.1" />` +
              `<path d="M ${cx1} ${y + 7} L ${cx2} ${y + 9}" stroke="${line}" stroke-width="0.65" stroke-opacity="0.55" fill="none" />`
            );
          })
          .join('');
        return `<pattern id="${pid}" width="56" height="48" patternUnits="userSpaceOnUse">
          <rect width="56" height="48" fill="${base}" />
          ${steps}
          <rect x="0" y="0" width="3" height="48" fill="${shdw}" fill-opacity="0.35" />
          <rect x="53" y="0" width="3" height="48" fill="${shdw}" fill-opacity="0.35" />
        </pattern>`;
      }
      if (matKey === 'arcane') {
        return `<pattern id="${pid}" width="48" height="48" patternUnits="userSpaceOnUse">
          <rect width="48" height="48" fill="${base}" />
          <rect x="1" y="1" width="46" height="46" fill="none" stroke="${shdw}" stroke-width="1" />
          <circle cx="24" cy="24" r="17" stroke="${line}" stroke-width="1" fill="none" />
          <circle cx="24" cy="24" r="12" stroke="${line}" stroke-width="0.6" stroke-dasharray="3 3" fill="none" />
          <circle cx="24" cy="24" r="6" fill="${alt}" stroke="${line}" stroke-width="0.9" />
          <path d="M 24 3 V 45 M 3 24 H 45 M 10 10 L 38 38 M 38 10 L 10 38" stroke="${line}" stroke-width="0.6" stroke-opacity="0.65" fill="none" />
          <circle cx="24" cy="24" r="1.8" fill="${line}" />
        </pattern>`;
      }
      if (matKey === 'water') {
        return `<pattern id="${pid}" width="48" height="26" patternUnits="userSpaceOnUse">
          <rect width="48" height="26" fill="${base}" />
          <rect x="0" y="12" width="48" height="14" fill="${alt}" fill-opacity="0.45" />
          <path d="M 0 7 Q 12 2 24 7 T 48 7 M 0 19 Q 12 14 24 19 T 48 19" stroke="${line}" stroke-width="1.3" fill="none" />
          <path d="M 6 5 Q 12 3 18 5 M 28 17 Q 34 15 40 17" stroke="${hiLite}" stroke-width="0.9" fill="none" stroke-linecap="round" />
        </pattern>`;
      }
      // earth
      return `<pattern id="${pid}" width="44" height="44" patternUnits="userSpaceOnUse">
        <rect width="44" height="44" fill="${base}" />
        <ellipse cx="12" cy="14" rx="8" ry="6" fill="${alt}" fill-opacity="0.55" />
        <ellipse cx="33" cy="31" rx="9" ry="7" fill="${alt}" fill-opacity="0.48" />
        <path d="M 8 13 L 6 8 M 10 13 L 10 7 M 12 13 L 14 8 M 30 28 L 28 23 M 32 28 L 33 22 M 34 28 L 37 24" stroke="${line}" stroke-width="1.05" stroke-linecap="round" />
        <circle cx="26" cy="9" r="1.3" fill="${shdw}" />
        <circle cx="15" cy="34" r="1.5" fill="${alt}" stroke="${shdw}" stroke-width="0.5" />
        <circle cx="38" cy="12" r="1" fill="${line}" />
      </pattern>`;
    })
    .join('\n');
}

export function exportMapAsJSON(doc: MapDocument): void {
  const totalRooms = doc.floors.reduce((acc, fl) => acc + fl.rooms.length, 0);
  const totalDoorways = doc.floors.reduce((acc, fl) => acc + fl.doorways.length, 0);
  const totalSecrets = doc.floors.reduce((acc, fl) => acc + fl.secretPassages.length, 0);

  const mapDoorForExport = (d: MapDocument['doorways'][number]) => {
    const kind = d.kind ?? 'normal';
    return {
      ...d,
      kind,
      wallT: d.wallT,
      enabled: d.enabled !== false,
      isExterior: d.roomBId === null,
      isSecret: kind === 'secret' || kind === 'locked-secret',
      isLocked: kind === 'locked' || kind === 'locked-secret',
    };
  };

  const enrichedExport = {
    ...doc,
    floors: doc.floors.map((fl) => ({
      ...fl,
      doorways: fl.doorways.map(mapDoorForExport),
      secretPassages: fl.secretPassages.map((sp) => ({
        ...sp,
        isSecret: true,
        connectsToExterior: sp.toRoomId === null,
      })),
      slices: fl.slices ?? [],
    })),
    doorways: doc.doorways.map(mapDoorForExport),
    secretPassages: doc.secretPassages.map((sp) => ({
      ...sp,
      isSecret: true,
      connectsToExterior: sp.toRoomId === null,
    })),
    slices: doc.slices ?? [],
    exportMetadata: {
      exportedAt: new Date().toISOString(),
      floorCount: doc.floors.length,
      stairLinkCount: doc.stairLinks.length,
      roomCount: totalRooms,
      doorwayCount: totalDoorways,
      secretPassageCount: totalSecrets,
      activeFloorRoomCount: doc.rooms.length,
    },
  };

  const payload = JSON.stringify(enrichedExport, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug =
    doc.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'layout-map';
  a.href = url;
  a.download = `${slug}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseFloorPayload(raw: any, fallbackId: string, fallbackName: string, fallbackOrder: number) {
  const rooms: Room[] = Array.isArray(raw.rooms)
    ? raw.rooms.map((r: any, idx: number) => ({
        id: String(r.id ?? `room-${idx}`),
        name: String(r.name ?? `Room ${idx + 1}`),
        type: r.type ?? 'room',
        points: Array.isArray(r.points) ? r.points : [],
        edgeCurves: Array.isArray(r.edgeCurves)
          ? r.edgeCurves
          : new Array(r.points?.length ?? 0).fill(0),
        hiddenEdges: Array.isArray(r.hiddenEdges)
          ? r.hiddenEdges.map((v: unknown) => Boolean(v))
          : undefined,
        unwalled: r.unwalled ? true : undefined,
        rotationDeg:
          typeof r.rotationDeg === 'number' && !isNaN(r.rotationDeg)
            ? r.rotationDeg
            : undefined,
        rotateStairTexture:
          typeof r.rotateStairTexture === 'boolean' ? r.rotateStairTexture : undefined,
        floorMaterial: r.floorMaterial === 'tile' ? 'marble' : (r.floorMaterial ?? 'stone'),
        lighting: r.lighting ?? 'bright',
        elevationFt: typeof r.elevationFt === 'number' ? r.elevationFt : 0,
        notes: typeof r.notes === 'string' ? r.notes : '',
        showLabel: r.showLabel !== false,
        customColor: typeof r.customColor === 'string' ? r.customColor : undefined,
        customTextureId:
          typeof r.customTextureId === 'string' ? r.customTextureId : undefined,
        tags: Array.isArray(r.tags) ? r.tags.map((t: any) => String(t).trim()).filter(Boolean) : undefined,
      }))
    : [];

  const secretPassages = Array.isArray(raw.secretPassages)
    ? raw.secretPassages.map((sp: any, idx: number) => {
        const pts = Array.isArray(sp.points) ? sp.points : [];
        const startAnchor = sp.startAnchor ?? pts[0] ?? { x: 0, y: 0 };
        const endAnchor = sp.endAnchor ?? pts[pts.length - 1] ?? { x: 0, y: 0 };
        const startProtrusion = typeof sp.startProtrusion === 'number' ? sp.startProtrusion : 28;
        const endProtrusion =
          typeof sp.endProtrusion === 'number' ? sp.endProtrusion : sp.toRoomId ? 28 : 0;
        const midPoints = Array.isArray(sp.midPoints) ? sp.midPoints : [];
        const base = {
          fromRoomId: String(sp.fromRoomId ?? ''),
          toRoomId: sp.toRoomId ? String(sp.toRoomId) : null,
          startAnchor,
          startProtrusion,
          endAnchor,
          endProtrusion,
          midPoints,
        };
        const resolved = resolveSecretPassagePolyline(base, rooms);
        return {
          id: String(sp.id ?? `sp-${idx}`),
          ...base,
          points: pts.length >= 2 && !sp.startAnchor ? pts : resolved.points,
          label: String(sp.label ?? 'secret passage'),
          dcInvestigation: typeof sp.dcInvestigation === 'number' ? sp.dcInvestigation : 15,
          isSecret: true as const,
        };
      })
    : [];

  const slices: SliceRegion[] = Array.isArray(raw.slices)
    ? raw.slices
        .filter((s: any) => Array.isArray(s?.points) && s.points.length >= 3)
        .map((s: any, idx: number) => ({
          id: String(s.id ?? `slice-${idx}`),
          mode: s.mode === 'floor' ? ('floor' as const) : ('wall' as const),
          points: s.points.map((p: any) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0) })),
          edgeCurves: Array.isArray(s.edgeCurves)
            ? s.edgeCurves.map((c: any) => Number(c ?? 0))
            : new Array(s.points.length).fill(0),
        }))
    : [];

  const doorways: any[] = [];
  if (Array.isArray(raw.doorways)) {
    raw.doorways.forEach((d: any, idx: number) => {
      if (d.kind === 'cased-opening') {
        // Auto-convert legacy cased-opening doorways into Wall Slices
        const pos = d.position ?? { x: 0, y: 0 };
        const angle = Number(d.angle ?? 0);
        const w = Math.max(20, Number(d.width ?? 48));
        const hw = w / 2;
        const hh = 12;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rot = (lx: number, ly: number) => ({
          x: Math.round(pos.x + lx * cos - ly * sin),
          y: Math.round(pos.y + lx * sin + ly * cos),
        });
        slices.push({
          id: `slice-migrated-${idx}-${String(d.id ?? '')}`,
          mode: 'wall',
          points: [rot(-hw, -hh), rot(hw, -hh), rot(hw, hh), rot(-hw, hh)],
          edgeCurves: [0, 0, 0, 0],
        });
        return;
      }

      const kind =
        d.kind === 'secret' || d.kind === 'locked' || d.kind === 'locked-secret'
          ? d.kind
          : 'normal';
      doorways.push({
        id: String(d.id),
        roomAId: String(d.roomAId),
        roomBId: d.roomBId ? String(d.roomBId) : null,
        edgeAIndex: Number(d.edgeAIndex ?? 0),
        edgeBIndex:
          d.edgeBIndex !== null && d.edgeBIndex !== undefined ? Number(d.edgeBIndex) : null,
        position: d.position ?? { x: 0, y: 0 },
        angle: Number(d.angle ?? 0),
        width: Number(d.width ?? 32),
        enabled: d.enabled !== false,
        kind,
        dcLockpick: typeof d.dcLockpick === 'number' ? d.dcLockpick : undefined,
        dcInvestigation: typeof d.dcInvestigation === 'number' ? d.dcInvestigation : undefined,
        customPlaced: Boolean(d.customPlaced),
        autoDetected: Boolean(d.autoDetected),
        wallT: typeof d.wallT === 'number' && !isNaN(d.wallT) ? d.wallT : undefined,
      });
    });
  }

  return {
    id: String(raw.id ?? fallbackId),
    name: String(raw.name ?? fallbackName),
    elevationOrder: typeof raw.elevationOrder === 'number' ? raw.elevationOrder : fallbackOrder,
    rooms,
    doorways,
    suppressedAutoDoorKeys: Array.isArray(raw.suppressedAutoDoorKeys)
      ? raw.suppressedAutoDoorKeys
      : [],
    secretPassages,
    slices,
  };
}

export async function importMapFromJSON(file: File): Promise<MapDocument> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || (!Array.isArray(parsed.rooms) && !Array.isArray(parsed.floors))) {
    throw new Error('Invalid Layout Creator JSON file: missing rooms or floors array.');
  }

  const floors: MapFloor[] =
    Array.isArray(parsed.floors) && parsed.floors.length > 0
      ? parsed.floors.map((fl: any, idx: number) =>
          parseFloorPayload(fl, `floor-${idx + 1}`, `Floor ${idx + 1}`, idx)
        )
      : [
          parseFloorPayload(
            parsed,
            'floor-1',
            typeof parsed.floorLabel === 'string' ? parsed.floorLabel : 'Level 1',
            0
          ),
        ];

  const activeFloor =
    floors.find((f) => f.id === parsed.activeFloorId) ?? floors[0];

  const stairLinks = Array.isArray(parsed.stairLinks)
    ? parsed.stairLinks.map((st: any, idx: number) => ({
        id: String(st.id ?? `stair-${idx}`),
        label: String(st.label ?? 'Stairway'),
        kind: st.kind === 'spiral' || st.kind === 'ladder' ? st.kind : 'stairs',
        fromFloorId: String(st.fromFloorId ?? activeFloor.id),
        fromRoomId: String(st.fromRoomId ?? ''),
        toFloorId: String(st.toFloorId ?? activeFloor.id),
        toRoomId: String(st.toRoomId ?? ''),
        bidirectional: st.bidirectional !== false,
        enabled: st.enabled !== false,
      }))
    : [];

  const customTextures: CustomFloorTexture[] | undefined = Array.isArray(parsed.customTextures)
    ? parsed.customTextures
        .filter(
          (t: any) =>
            t &&
            typeof t.id === 'string' &&
            typeof t.dataUrl === 'string' &&
            t.dataUrl.startsWith('data:image/')
        )
        .map((t: any) => ({
          id: String(t.id),
          name: typeof t.name === 'string' && t.name.trim() ? t.name.trim() : 'Custom Texture',
          dataUrl: String(t.dataUrl),
          tileSize:
            typeof t.tileSize === 'number' && t.tileSize >= 20 && t.tileSize <= 400
              ? t.tileSize
              : 80,
        }))
    : undefined;

  return {
    version: typeof parsed.version === 'number' ? parsed.version : 2,
    id: typeof parsed.id === 'string' ? parsed.id : `imported-${Date.now()}`,
    title: typeof parsed.title === 'string' ? parsed.title : 'Imported Layout',
    floorLabel: activeFloor.name,
    activeFloorId: activeFloor.id,
    floors,
    stairLinks,
    rooms: activeFloor.rooms,
    doorways: activeFloor.doorways,
    suppressedAutoDoorKeys: activeFloor.suppressedAutoDoorKeys ?? [],
    secretPassages: activeFloor.secretPassages,
    slices: activeFloor.slices ?? [],
    customTextures: customTextures && customTextures.length > 0 ? customTextures : undefined,
    autoConnectDoors: parsed.autoConnectDoors !== false,
    autoConnectTolerance:
      typeof parsed.autoConnectTolerance === 'number' ? parsed.autoConnectTolerance : 18,
    grid: {
      cellSize: parsed.grid?.cellSize ?? 40,
      feetPerCell: parsed.grid?.feetPerCell ?? 5,
      snapToGrid: parsed.grid?.snapToGrid !== false,
      showGrid: parsed.grid?.showGrid !== false,
    },
  };
}

export interface PngExportOptions {
  darkTheme: boolean;
  includeGrid: boolean;
  includeLabels: boolean;
  includePath: boolean;
  pathResult?: PathResult | null;
  includeSecretInReachability?: boolean;
  includeLockedInReachability?: boolean;
}

export async function exportMapAsPNG(
  doc: MapDocument,
  options: PngExportOptions
): Promise<void> {
  const allPts = [
    ...doc.rooms.flatMap((r) => sampleRoomPolygon(r, 8)),
    ...doc.secretPassages.flatMap((sp) => sp.points),
  ];
  const rawBox =
    allPts.length > 0
      ? getPolygonBoundingBox(allPts)
      : { minX: 0, minY: 0, maxX: 800, maxY: 600, width: 800, height: 600 };

  const pad = 80;
  const minX = Math.floor((rawBox.minX - pad) / doc.grid.cellSize) * doc.grid.cellSize;
  const minY = Math.floor((rawBox.minY - pad) / doc.grid.cellSize) * doc.grid.cellSize;
  const maxX = Math.ceil((rawBox.maxX + pad) / doc.grid.cellSize) * doc.grid.cellSize;
  const maxY = Math.ceil((rawBox.maxY + pad) / doc.grid.cellSize) * doc.grid.cellSize;
  const width = Math.max(400, maxX - minX);
  const height = Math.max(300, maxY - minY);

  const bg = options.darkTheme ? '#2A2A2E' : '#F6F4EF';
  const gridColor = options.darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(120,113,108,0.16)';
  const majorGridColor = options.darkTheme
    ? 'rgba(255,255,255,0.17)'
    : 'rgba(120,113,108,0.3)';
  const inkColor = options.darkTheme ? '#F1F5F9' : '#1C1917';
  const mutedInk = options.darkTheme ? '#94A3B8' : '#57534E';
  const secretStroke = options.darkTheme ? '#FBBF24' : '#B45309';

  const diag = diagnoseMultiFloorAccessibility(
    doc.floors,
    doc.activeFloorId,
    doc.stairLinks,
    options.includeSecretInReachability ?? true,
    doc.autoConnectTolerance,
    options.includeLockedInReachability ?? true
  );

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}">`
  );
  const activeSlices = doc.slices ?? [];
  const visibleDoors = doc.doorways.filter((door) => !isDoorwaySliced(door, activeSlices));
  const floorSliceMaskPaths = activeSlices
    .filter((sl) => sl.mode === 'floor' && sl.points.length >= 3)
    .map((sl) => `<path d="${buildRoomSvgPath(sl)}" fill="#000000" />`)
    .join('');
  const wallSliceMaskPaths = activeSlices
    .filter((sl) => sl.mode === 'wall' && sl.points.length >= 3)
    .map((sl) => `<path d="${buildRoomSvgPath(sl)}" fill="#000000" />`)
    .join('');

  const doorMaskRects = visibleDoors
    .map((door) => {
      const kind = door.kind ?? 'normal';
      if (kind === 'secret' || kind === 'locked-secret') return '';
      const deg = (door.angle * 180) / Math.PI;
      const hw = door.width / 2;
      return `<g transform="translate(${door.position.x} ${door.position.y}) rotate(${deg})"><rect x="${
        -hw + 1.5
      }" y="-18" width="${Math.max(4, door.width - 3)}" height="36" fill="#000000" /></g>`;
    })
    .join('');

  const customTexturePatternDefs = (doc.customTextures ?? [])
    .map((tex) => {
      const size = Math.max(20, Math.min(400, tex.tileSize || 80));
      return `<pattern id="pngtex-custom-${escapeXml(tex.id)}" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><image href="${escapeXml(tex.dataUrl)}" x="0" y="0" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" /></pattern>`;
    })
    .join('');

  parts.push(
    `<defs>${buildFloorPatternDefs(options.darkTheme, 'pngtex')}${customTexturePatternDefs}` +
      `<mask id="png-floor-slice-cutout-mask" maskUnits="userSpaceOnUse" x="-50000" y="-50000" width="100000" height="100000">` +
      `<rect x="-50000" y="-50000" width="100000" height="100000" fill="#FFFFFF" />` +
      `${floorSliceMaskPaths}` +
      `</mask>` +
      `<mask id="png-wall-slice-only-mask" maskUnits="userSpaceOnUse" x="-50000" y="-50000" width="100000" height="100000">` +
      `<rect x="-50000" y="-50000" width="100000" height="100000" fill="#FFFFFF" />` +
      `${wallSliceMaskPaths}` +
      `</mask>` +
      `<mask id="png-door-wall-cutout-mask" maskUnits="userSpaceOnUse" x="-50000" y="-50000" width="100000" height="100000">` +
      `<rect x="-50000" y="-50000" width="100000" height="100000" fill="#FFFFFF" />` +
      `${doorMaskRects}${wallSliceMaskPaths}${floorSliceMaskPaths}` +
      `</mask></defs>`
  );
  parts.push(`<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${bg}" />`);

  if (options.includeGrid) {
    const cs = doc.grid.cellSize;
    for (let x = minX; x <= maxX; x += cs) {
      const isMajor = Math.round(x / cs) % 5 === 0;
      parts.push(
        `<line x1="${x}" y1="${minY}" x2="${x}" y2="${maxY}" stroke="${
          isMajor ? majorGridColor : gridColor
        }" stroke-width="${isMajor ? 1.2 : 0.75}" />`
      );
    }
    for (let y = minY; y <= maxY; y += cs) {
      const isMajor = Math.round(y / cs) % 5 === 0;
      parts.push(
        `<line x1="${minX}" y1="${y}" x2="${maxX}" y2="${y}" stroke="${
          isMajor ? majorGridColor : gridColor
        }" stroke-width="${isMajor ? 1.2 : 0.75}" />`
      );
    }
  }

  for (const room of doc.rooms) {
    const mat = MATERIAL_PALETTE[room.floorMaterial] ?? MATERIAL_PALETTE.stone;
    const isStairTex = room.floorMaterial === 'staircase' || room.floorMaterial === 'stairway';
    const baseFillColor = options.darkTheme ? mat.darkFill : mat.lightFill;
    const altFillColor = options.darkTheme ? mat.secondaryDark : mat.secondaryLight;
    const customTex = room.customTextureId
      ? (doc.customTextures ?? []).find((t) => t.id === room.customTextureId)
      : undefined;
    const fill = customTex
      ? `url(#pngtex-custom-${escapeXml(customTex.id)})`
      : room.customColor || (isStairTex ? baseFillColor : `url(#pngtex-${room.floorMaterial})`);
    const stroke = options.darkTheme ? mat.strokeDark : mat.strokeLight;
    const d = buildRoomSvgPath(room);
    const wallD = buildRoomWallPath(room);
    const dash = room.type === 'secret' ? ' stroke-dasharray="7 5"' : '';
    const strokeW = room.type === 'courtyard' ? 2 : 3.5;
    const clipId = `png-room-clip-${escapeXml(room.id)}`;
    const stairOriented =
      !customTex && !room.customColor && (isStairTex || room.type === 'stairs')
        ? getOrientedStairBox(room)
        : null;
    const stairBox = stairOriented?.box ?? null;
    const stairRotAttr =
      stairOriented && stairOriented.rotationDeg !== 0
        ? ` transform="rotate(${stairOriented.rotationDeg} ${stairOriented.center.x} ${stairOriented.center.y})"`
        : '';

    parts.push(`<clipPath id="${clipId}"><path d="${d}" /></clipPath>`);
    parts.push(`<g mask="url(#png-floor-slice-cutout-mask)">`);
    parts.push(`<path d="${d}" fill="${fill}" stroke="none" />`);

    let centeredStairSvg = '';
    if (!customTex && !room.customColor && room.floorMaterial === 'staircase' && stairBox) {
      const bx = stairBox.minX;
      const by = stairBox.minY;
      const bw = stairBox.width;
      const bh = stairBox.height;
      const cx = (stairBox.minX + stairBox.maxX) / 2;
      const curbW = Math.min(6, Math.max(3.5, bw * 0.06));
      const treadX = bx + curbW;
      const treadW = Math.max(0, bw - curbW * 2);
      const runnerW = Math.max(14, Math.min(48, bw * 0.52));
      const runnerX = cx - runnerW / 2;
      const runnerFill = options.darkTheme ? '#6F1D24' : '#8B262D';
      const runnerEdge = options.darkTheme ? '#D97706' : '#EAB308';
      const hiLite = options.darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)';
      const shdw = options.darkTheme ? 'rgba(0,0,0,0.48)' : 'rgba(28,25,23,0.18)';
      const deepShdw = options.darkTheme ? 'rgba(0,0,0,0.65)' : 'rgba(28,25,23,0.28)';
      const pitch = 12;
      const remY = bh % pitch;
      const startY = by + remY / 2 - (remY > 0 ? pitch : 0);
      const steps: string[] = [];
      const rods: string[] = [];
      for (let y = startY; y < stairBox.maxY; y += pitch) {
        steps.push(
          `<rect x="${treadX}" y="${y}" width="${treadW}" height="3.5" fill="${deepShdw}" />` +
            `<line x1="${treadX}" y1="${y + 4}" x2="${stairBox.maxX - curbW}" y2="${y + 4}" stroke="${hiLite}" stroke-width="1" />` +
            `<line x1="${treadX}" y1="${y + 11.5}" x2="${stairBox.maxX - curbW}" y2="${y + 11.5}" stroke="${shdw}" stroke-width="0.8" />`
        );
        rods.push(
          `<rect x="${runnerX}" y="${y}" width="${runnerW}" height="3.2" fill="rgba(0,0,0,0.34)" />` +
            `<line x1="${runnerX - 1}" y1="${y + 3.2}" x2="${runnerX + runnerW + 1}" y2="${y + 3.2}" stroke="${runnerEdge}" stroke-width="1.1" stroke-opacity="0.85" />`
        );
      }
      centeredStairSvg =
        `<rect x="${bx}" y="${by}" width="${curbW}" height="${bh}" fill="${altFillColor}" />` +
        `<rect x="${stairBox.maxX - curbW}" y="${by}" width="${curbW}" height="${bh}" fill="${altFillColor}" />` +
        steps.join('') +
        `<rect x="${runnerX}" y="${by}" width="${runnerW}" height="${bh}" fill="${runnerFill}" fill-opacity="0.92" />` +
        `<line x1="${runnerX + 1.5}" y1="${by}" x2="${runnerX + 1.5}" y2="${stairBox.maxY}" stroke="${runnerEdge}" stroke-width="1.2" stroke-opacity="0.85" />` +
        `<line x1="${runnerX + runnerW - 1.5}" y1="${by}" x2="${runnerX + runnerW - 1.5}" y2="${stairBox.maxY}" stroke="${runnerEdge}" stroke-width="1.2" stroke-opacity="0.85" />` +
        rods.join('') +
        `<line x1="${treadX}" y1="${by}" x2="${treadX}" y2="${stairBox.maxY}" stroke="${shdw}" stroke-width="1.4" />` +
        `<line x1="${stairBox.maxX - curbW}" y1="${by}" x2="${stairBox.maxX - curbW}" y2="${stairBox.maxY}" stroke="${shdw}" stroke-width="1.4" />`;
    } else if (!customTex && !room.customColor && room.floorMaterial === 'stairway' && stairBox) {
      const bx = stairBox.minX;
      const by = stairBox.minY;
      const bw = stairBox.width;
      const bh = stairBox.height;
      const cx = (stairBox.minX + stairBox.maxX) / 2;
      const lineCol = options.darkTheme ? mat.patternDark : mat.patternLight;
      const hiLite = options.darkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)';
      const shdw = options.darkTheme ? 'rgba(0,0,0,0.48)' : 'rgba(28,25,23,0.18)';
      const deepShdw = options.darkTheme ? 'rgba(0,0,0,0.65)' : 'rgba(28,25,23,0.28)';
      const pitch = 12;
      const remY = bh % pitch;
      const startY = by + remY / 2 - (remY > 0 ? pitch : 0);
      const steps: string[] = [];
      let idx = 0;
      for (let y = startY; y < stairBox.maxY; y += pitch, idx++) {
        const jointOffset = bw * 0.16;
        const jx = idx % 2 === 0 ? cx - jointOffset : cx + jointOffset;
        steps.push(
          (idx % 2 === 1
            ? `<rect x="${bx}" y="${y}" width="${bw}" height="${pitch}" fill="${altFillColor}" fill-opacity="0.48" />`
            : '') +
            `<rect x="${bx}" y="${y}" width="${bw}" height="3.2" fill="${deepShdw}" />` +
            `<line x1="${bx}" y1="${y + 3.6}" x2="${stairBox.maxX}" y2="${y + 3.6}" stroke="${hiLite}" stroke-width="1" />` +
            (bw >= 30
              ? `<line x1="${jx}" y1="${y}" x2="${jx}" y2="${y + pitch}" stroke="${shdw}" stroke-width="1.1" />`
              : '') +
            `<path d="M ${cx - (idx % 2 === 0 ? 10 : -4)} ${y + 7} L ${cx - (idx % 2 === 0 ? 4 : -10)} ${y + 9}" stroke="${lineCol}" stroke-width="0.65" stroke-opacity="0.55" fill="none" />`
        );
      }
      centeredStairSvg =
        steps.join('') +
        `<rect x="${bx}" y="${by}" width="3.5" height="${bh}" fill="${shdw}" fill-opacity="0.35" />` +
        `<rect x="${stairBox.maxX - 3.5}" y="${by}" width="3.5" height="${bh}" fill="${shdw}" fill-opacity="0.35" />`;
    }

    const wallShadowsSvg = wallD
      ? `<g transform="translate(2.5 3)">` +
        `<path d="${wallD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.055 : 0.03}" stroke-width="20" stroke-linejoin="round" />` +
        `<path d="${wallD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.075 : 0.045}" stroke-width="13" stroke-linejoin="round" />` +
        `<path d="${wallD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.1 : 0.06}" stroke-width="7" stroke-linejoin="round" />` +
        `</g>` +
        `<path d="${wallD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.08 : 0.04}" stroke-width="10" stroke-linejoin="round" />` +
        `<path d="${wallD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.14 : 0.07}" stroke-width="4.5" stroke-linejoin="round" />`
      : '';

    let stepOverlaySvg = '';
    if (room.type === 'stairs' && !isStairTex && stairBox) {
      const stepLines: string[] = [];
      for (let y = stairBox.minY + 12; y < stairBox.maxY - 8; y += 11) {
        stepLines.push(
          `<line x1="${stairBox.minX}" y1="${y}" x2="${stairBox.maxX}" y2="${y}" stroke="${inkColor}" stroke-opacity="0.22" stroke-width="1.2" />`
        );
      }
      stepOverlaySvg = stepLines.join('');
    }

    const wrappedStairSvg = centeredStairSvg
      ? stairRotAttr
        ? `<g${stairRotAttr}>${centeredStairSvg}</g>`
        : centeredStairSvg
      : '';
    const wrappedStepOverlaySvg = stepOverlaySvg
      ? stairRotAttr
        ? `<g${stairRotAttr}>${stepOverlaySvg}</g>`
        : stepOverlaySvg
      : '';

    parts.push(`<g clip-path="url(#${clipId})">${wrappedStairSvg}${wallShadowsSvg}${wrappedStepOverlaySvg}</g>`);

    if (diag.inaccessibleRoomIds.has(room.id)) {
      parts.push(
        `<path d="${d}" fill="${
          options.darkTheme ? 'rgba(0, 0, 0, 0.56)' : 'rgba(28, 25, 23, 0.34)'
        }" stroke="none" />`
      );
    }
    parts.push(`</g>`);

    if (wallD) {
      parts.push(
        `<path d="${wallD}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"${dash} mask="url(#png-door-wall-cutout-mask)" />`
      );
    }
  }

  // Encapsulating walls generated around Floor Slice deadspace cutouts
  const floorSliceWalls = computeFloorSliceWalls(doc.rooms, activeSlices);
  if (floorSliceWalls.length > 0) {
    const roomByIdMap = new Map(doc.rooms.map((r) => [r.id, r]));
    parts.push(`<g mask="url(#png-floor-slice-cutout-mask)">`);
    for (const fw of floorSliceWalls) {
      parts.push(
        `<g transform="translate(2.5 3)">` +
          `<path d="${fw.pathD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.055 : 0.03}" stroke-width="20" stroke-linejoin="round" />` +
          `<path d="${fw.pathD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.075 : 0.045}" stroke-width="13" stroke-linejoin="round" />` +
          `</g>` +
          `<path d="${fw.pathD}" fill="none" stroke="#000000" stroke-opacity="${options.darkTheme ? 0.09 : 0.05}" stroke-width="9" stroke-linejoin="round" />`
      );
    }
    parts.push(`</g>`);
    for (const fw of floorSliceWalls) {
      const rm = roomByIdMap.get(fw.roomId);
      const mat = rm ? (MATERIAL_PALETTE[rm.floorMaterial] ?? MATERIAL_PALETTE.stone) : MATERIAL_PALETTE.stone;
      const stroke = options.darkTheme ? mat.strokeDark : mat.strokeLight;
      parts.push(
        `<path d="${fw.pathD}" fill="none" stroke="${stroke}" stroke-width="${
          fw.isCourtyard ? 2 : 3.5
        }" stroke-linejoin="round" stroke-linecap="round" mask="url(#png-wall-slice-only-mask)" />`
      );
    }
  }

  // Doorways (Clean architectural visuals for Normal, Secret, Locked, Disabled)
  for (const door of visibleDoors) {
    const deg = (door.angle * 180) / Math.PI;
    const hw = door.width / 2;
    const kind = door.kind ?? 'normal';
    const isSecret = kind === 'secret' || kind === 'locked-secret';
    const isLocked = kind === 'locked' || kind === 'locked-secret';
    const isDisabled = !door.enabled;
    const isExterior = door.roomBId === null;

    parts.push(`<g transform="translate(${door.position.x} ${door.position.y}) rotate(${deg})">`);
    parts.push(`<g opacity="${isDisabled ? 0.55 : 1}">`);

    if (isSecret) {
      parts.push(
        `<rect x="${-hw + 1}" y="-3.5" width="${door.width - 2}" height="7" rx="1.5" fill="${
          options.darkTheme ? '#451A03' : '#FDE68A'
        }" stroke="${isLocked ? '#DC2626' : secretStroke}" stroke-width="1.4" stroke-dasharray="3.5 2" />` +
          `<line x1="${-hw + 6}" y1="-3" x2="${-hw + 3}" y2="3" stroke="${secretStroke}" stroke-width="0.85" stroke-opacity="0.7" />` +
          `<line x1="${hw - 5}" y1="-3" x2="${hw - 8}" y2="3" stroke="${secretStroke}" stroke-width="0.85" stroke-opacity="0.7" />`
      );
      if (isLocked) {
        parts.push(`<circle cx="0" cy="0" r="1.8" fill="#DC2626" stroke="#FEF3C7" stroke-width="0.6" />`);
      }
    } else {
      const leafFill = isDisabled
        ? '#78716C'
        : isLocked
          ? '#334155'
          : isExterior
            ? '#B45309'
            : '#92400E';
      parts.push(
        `<rect x="${-hw + 1}" y="-3.5" width="${door.width - 2}" height="7" rx="1" fill="${leafFill}" stroke="${
          isLocked ? '#DC2626' : inkColor
        }" stroke-width="${isLocked ? 1.4 : 1.1}" />`
      );
      if (isLocked) {
        parts.push(
          `<line x1="${-hw + 6}" y1="-3.5" x2="${-hw + 6}" y2="3.5" stroke="#94A3B8" stroke-width="1.3" />` +
            `<line x1="${hw - 6}" y1="-3.5" x2="${hw - 6}" y2="3.5" stroke="#94A3B8" stroke-width="1.3" />` +
            `<rect x="-2.2" y="-1.4" width="4.4" height="3.2" rx="0.7" fill="#FBBF24" />`
        );
      } else {
        parts.push(
          `<rect x="${-hw + 1.5}" y="-3.6" width="2" height="7.2" fill="#334155" />` +
            `<circle cx="${hw - 4.5}" cy="0" r="1.3" fill="#FBBF24" stroke="#451A03" stroke-width="0.5" />`
        );
      }
    }

    if (isDisabled) {
      parts.push(
        `<line x1="${-hw + 4}" y1="-4.5" x2="${hw - 4}" y2="4.5" stroke="#DC2626" stroke-width="1.6" stroke-linecap="round" />`
      );
    }
    parts.push(`</g>`);
    parts.push(`</g>`);
  }

  // Interlinking Stairway Badges on Active Floor
  const activeFloorObj = doc.floors.find((f) => f.id === doc.activeFloorId);
  const activeElev = activeFloorObj?.elevationOrder ?? 0;
  for (const st of doc.stairLinks) {
    const isFrom = st.fromFloorId === doc.activeFloorId;
    const isTo = st.toFloorId === doc.activeFloorId && st.bidirectional !== false;
    if (!isFrom && !isTo) continue;
    const roomId = isFrom ? st.fromRoomId : st.toRoomId;
    const targetFloorId = isFrom ? st.toFloorId : st.fromFloorId;
    const room = doc.rooms.find((r) => r.id === roomId);
    const targetFloor = doc.floors.find((f) => f.id === targetFloorId);
    if (!room || !targetFloor) continue;
    const anchor = getEffectiveRoomLabelAnchor(room, activeSlices);
    const arrow = targetFloor.elevationOrder > activeElev ? '↑' : '↓';
    parts.push(
      `<g transform="translate(${anchor.x} ${anchor.y + 26})">` +
        `<rect x="-46" y="-9" width="92" height="18" rx="6" fill="${
          options.darkTheme ? '#1E293B' : '#FFFFFF'
        }" stroke="${st.enabled ? '#0D9488' : '#DC2626'}" stroke-width="1.5" />` +
        `<text y="3.5" text-anchor="middle" font-family="sans-serif" font-size="9.5" font-weight="700" fill="${
          st.enabled ? (options.darkTheme ? '#5EEAD4' : '#0F766E') : '#DC2626'
        }">${arrow} ${escapeXml(targetFloor.name)}</text>` +
        `</g>`
    );
  }

  // Secret passages
  for (const sp of doc.secretPassages) {
    if (sp.points.length < 2) continue;
    const ptsAttr = sp.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    parts.push(
      `<polyline points="${ptsAttr}" fill="none" stroke="${secretStroke}" stroke-width="6" stroke-opacity="0.18" stroke-linecap="round" stroke-linejoin="round" />`
    );
    parts.push(
      `<polyline points="${ptsAttr}" fill="none" stroke="${secretStroke}" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round" stroke-linejoin="round" />`
    );
    const p0 = sp.points[0];
    const p1 = sp.points[sp.points.length - 1];
    parts.push(`<circle cx="${p0.x}" cy="${p0.y}" r="8" fill="${bg}" stroke="${secretStroke}" stroke-width="2" />`);
    parts.push(`<text x="${p0.x}" y="${p0.y + 3.5}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="700" fill="${secretStroke}">S</text>`);
    parts.push(`<circle cx="${p1.x}" cy="${p1.y}" r="8" fill="${bg}" stroke="${secretStroke}" stroke-width="2" stroke-dasharray="${sp.toRoomId ? 'none' : '2 2'}" />`);
    parts.push(`<text x="${p1.x}" y="${p1.y + 3.5}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="700" fill="${secretStroke}">${sp.toRoomId ? 'S' : 'E'}</text>`);
  }

  if (options.includePath && options.pathResult?.reachable) {
    const activeSteps = options.pathResult.steps.filter(
      (s) => s.floorId === doc.activeFloorId
    );
    const activePts = activeSteps.flatMap((s) => s.floorWaypoints ?? []);
    if (activePts.length >= 2) {
      const ptsAttr = activePts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      parts.push(
        `<polyline points="${ptsAttr}" fill="none" stroke="#0D9488" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 6" />`
      );
    }

    options.pathResult.steps.forEach((step, idx) => {
      if (step.floorId !== doc.activeFloorId) return;
      const r = doc.rooms.find((rm) => rm.id === step.roomId);
      if (!r) return;
      const anchor = getEffectiveRoomLabelAnchor(r, activeSlices);
      parts.push(`<circle cx="${anchor.x}" cy="${anchor.y - 24}" r="10" fill="${idx === 0 ? '#0D9488' : '#1C1917'}" stroke="#FFF" stroke-width="2" />`);
      parts.push(`<text x="${anchor.x}" y="${anchor.y - 20.5}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="700" fill="#FFF">${idx + 1}</text>`);
      if (step.viaSecretPassageId && step.portalPosition) {
        parts.push(`<circle cx="${step.portalPosition.x}" cy="${step.portalPosition.y}" r="9" fill="#B45309" stroke="#FFF" stroke-width="1.5" />`);
        parts.push(`<text x="${step.portalPosition.x}" y="${step.portalPosition.y + 3.2}" text-anchor="middle" font-family="sans-serif" font-size="9" font-weight="700" fill="#FFF">${idx}→${idx + 1}</text>`);
      }
    });
  }

  if (options.includeLabels) {
    for (const room of doc.rooms) {
      if (!room.showLabel) continue;
      const anchor = getEffectiveRoomLabelAnchor(room, activeSlices);
      const area = getEffectiveRoomAreaSqFt(
        room,
        activeSlices,
        doc.grid.cellSize,
        doc.grid.feetPerCell
      );
      parts.push(
        `<text x="${anchor.x}" y="${anchor.y - 3}" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="13" font-weight="700" fill="${inkColor}">${escapeXml(
          room.name
        )}</text>`
      );
      parts.push(
        `<text x="${anchor.x}" y="${anchor.y + 13}" text-anchor="middle" font-family="monospace" font-size="10" fill="${mutedInk}">${area} sq ft</text>`
      );
    }
  }

  parts.push(
    `<text x="${minX + 20}" y="${maxY - 22}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="15" font-weight="700" fill="${inkColor}">${escapeXml(
      doc.title
    )} — ${escapeXml(doc.floorLabel)} (${doc.grid.feetPerCell} ft/sq)</text>`
  );

  parts.push(`</svg>`);

  const svgStr = parts.join('\n');
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (err) => reject(err);
      img.src = svgUrl;
    });

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize 2D canvas for PNG export.');

    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);

    const pngUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    const slug =
      doc.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'layout-map';
    a.href = pngUrl;
    a.download = `${slug}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
