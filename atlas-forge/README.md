# Atlas Forge

Continent map, settlement maps and building interiors in one app. Atlas Forge is the shell;
KeepCraft (the interior layout editor) lives under `src/interior/` and is mounted as the
innermost level.

```
npm install
npm run dev      # http://localhost:3000
npm test         # geometry + generator tests
npm run lint     # tsc --noEmit
```

## How the levels fit together

**Continent → Settlement → Building interior**, with a breadcrumb that is always the way back.
Top-level sections are Map, Ledger, Library and Export.

A claimed building owns one interior document. Ownership is split so neither side fights the other:

| Data | Owner |
|---|---|
| Outline, shape, width/depth, above-ground floors, cellars, courtyard hole, room count | Interior |
| Position, rotation, district, claim, purpose, notes, map label | Atlas |
| Name | One field on the building (`assignedName`); the interior's title reads it |

Every committed edit in the editor (and every undo/redo) re-derives the building from the
interior (`src/utils/interiorLink.ts`):

1. Take every above-ground room, curved edges sampled to polylines. Courtyard rooms are left out,
   so they become holes or notches.
2. Union them (`polygon-clipping`). If rooms were drawn with small gaps and the union splits,
   fuse near-touching walls and retry; if parts are genuinely detached, use their convex hull.
3. Convert 8 px/ft (editor) to 0.68 px/ft (map), simplify, and place it using the link's
   **anchor**: the editor point pinned to the building's center. A wing added to the east
   grows east on the map and the west edge stays put.
4. Classify the shape (rectangle, L, U, courtyard, round tower, else custom) and write polygon,
   shape, size, floors and summary onto the building in the same state update as the save.

If an edit leaves the building's center outside its own outline, the center is re-pivoted to a
point inside it without moving the outline.

For linked buildings the shape picker, size fields and vertex editing are locked; rotation and
position stay editable. Buildings that overlap a neighbour get a red dashed outline and a
"Move clear of neighbours" action. Nothing moves automatically.

## Creating an interior

- **Start from outline**: rooms exactly cover the current footprint (courtyard keeps get a ring
  of wings around a courtyard room), one front door on the south side. Nothing on the map changes
  until you edit.
- **Generate layout**: runs KeepCraft's generator unchanged, with options derived from the
  building (purpose → archetype, floors, room count from area). The building resizes to fit.

## Storage

- World: `localStorage` (`atlas-forge-world-v4`).
- Interiors: IndexedDB (`atlas-forge` / `interiors`), because floor textures can be large.
  Maps saved by the standalone KeepCraft app (`keepcraft_saved_maps_v1`) are imported once.
- Export → bundle: world + interiors in one file. Plain world files from before this version
  still import; links to interiors that are not in the library are dropped on import.

Interiors that lose their building (unclaim, regenerate, delete region) are not deleted; they
move to the Library, which lists every interior and what it is attached to. Destructive actions
ask first and say how many interiors will be detached.

## Layout

```
src/
  components/        Atlas views (Continent, Settlement, Ledger, Library, Export, TopBar, Breadcrumb)
  interior/          KeepCraft, unchanged apart from InteriorEditor's props
    InteriorEditor.tsx   was KeepCraft's App.tsx: now controlled by the shell
    components/ data/ types/ utils/
  utils/
    interiorLink.ts      seed / derive / apply / overlap / nudge / reconcile
    interiorStore.ts     IndexedDB + legacy migration
    bundle.ts            export/import format
```

## Not done yet

- Five purposes (alchemist, tower, market, archive, residence) map to the nearest existing
  generator archetype; they have no room sets of their own.
- The editor does not show the original building outline as a ghost underlay.
- Entrances are not drawn on the settlement map.
- The Ledger has no interior columns.
- Overlap warnings cover buildings only, not roads.
- The editor keeps its own light/dark toggle; Atlas chrome has no dark mode.
- The generator tops out at 2 above-ground floors plus a cellar, so a generated 3–4 floor
  building comes back with fewer floors (add floors in the editor).
