import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Layers,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { MapFloor, StairLink } from '../types/map';

interface FloorBarProps {
  floors: MapFloor[];
  activeFloorId: string;
  stairLinks: StairLink[];
  inaccessibleCountByFloor?: Map<string, number>;
  onSelectFloor: (floorId: string) => void;
  onAddFloor: (direction: 'above' | 'below') => void;
  onRenameFloor: (floorId: string, name: string) => void;
  onDeleteFloor: (floorId: string) => void;
}

export const FloorBar: React.FC<FloorBarProps> = React.memo(({
  floors,
  activeFloorId,
  stairLinks,
  inaccessibleCountByFloor,
  onSelectFloor,
  onAddFloor,
  onRenameFloor,
  onDeleteFloor,
}) => {
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addMenuOpen]);

  const sortedFloors = [...floors].sort(
    (a, b) => a.elevationOrder - b.elevationOrder
  );

  const beginRename = (fl: MapFloor) => {
    setEditingFloorId(fl.id);
    setDraftName(fl.name);
  };

  const commitRename = () => {
    if (editingFloorId && draftName.trim()) {
      onRenameFloor(editingFloorId, draftName.trim());
    }
    setEditingFloorId(null);
  };

  return (
    <div
      aria-label="Floor switcher"
      className="h-11 shrink-0 px-3 sm:px-4 lg:px-5 flex items-center justify-between gap-3 border-b border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] text-stone-800 dark:text-stone-100 z-20"
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
        <span className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-stone-500 dark:text-stone-400 pr-2 mr-1 border-r border-[#E5E0D5] dark:border-[#2E313A] shrink-0">
          <Layers className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
          <span>Floors</span>
        </span>

        {sortedFloors.map((fl) => {
          const active = fl.id === activeFloorId;
          const isEditing = editingFloorId === fl.id;
          const inaccCount = inaccessibleCountByFloor?.get(fl.id) ?? 0;

          if (isEditing) {
            return (
              <div
                key={fl.id}
                className="flex items-center gap-1 bg-white dark:bg-[#18191D] border border-teal-600 dark:border-teal-500 rounded-lg px-2 py-0.5 shrink-0 shadow-xs"
              >
                <input
                  type="text"
                  value={draftName}
                  autoFocus
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setEditingFloorId(null);
                  }}
                  aria-label="Rename floor"
                  className="w-28 text-xs font-medium bg-transparent focus:outline-none text-stone-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={commitRename}
                  aria-label="Save floor name"
                  className="p-1 text-teal-700 dark:text-teal-400 hover:bg-stone-100 dark:hover:bg-white/10 rounded transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingFloorId(null)}
                  aria-label="Cancel rename"
                  className="p-1 text-stone-400 hover:bg-stone-100 dark:hover:bg-white/10 rounded transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          }

          return (
            <div
              key={fl.id}
              className={`group flex items-center rounded-lg border text-xs transition-colors shrink-0 ${
                active
                  ? 'bg-white dark:bg-[#18191D] border-teal-600/70 dark:border-teal-500/70 text-stone-900 dark:text-white shadow-xs font-semibold'
                  : 'border-transparent text-stone-600 dark:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-white/5 font-medium'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectFloor(fl.id)}
                onDoubleClick={() => beginRename(fl)}
                aria-current={active ? 'page' : undefined}
                title={`${fl.name} (${fl.rooms.length} chambers) — double-click to rename`}
                className="min-h-[30px] px-2.5 flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 rounded-lg"
              >
                <span
                  className={`font-mono-tabular text-[11px] ${
                    active
                      ? 'text-teal-700 dark:text-teal-400 font-semibold'
                      : 'text-stone-400 dark:text-stone-500'
                  }`}
                >
                  {fl.elevationOrder < 0
                    ? `B${Math.abs(fl.elevationOrder)}`
                    : `${fl.elevationOrder + 1}F`}
                </span>
                <span>{fl.name}</span>
                {inaccCount > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-mono-tabular text-[11px] font-semibold shrink-0"
                    title={`${inaccCount} unreachable room(s) on this floor`}
                  >
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                    <span>{inaccCount}</span>
                  </span>
                )}
              </button>

              {active && (
                <div className="flex items-center pr-1.5 gap-0.5 border-l border-[#E5E0D5] dark:border-[#2E313A] pl-1 ml-0.5">
                  <button
                    type="button"
                    onClick={() => beginRename(fl)}
                    title="Rename floor"
                    aria-label="Rename active floor"
                    className="p-1 rounded text-stone-400 hover:text-stone-800 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  {floors.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteFloor(fl.id)}
                      title="Delete floor"
                      aria-label="Delete active floor"
                      className="p-1 rounded text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right side: Stair links count + Add Floor */}
      <div className="flex items-center gap-2.5 shrink-0">
        {stairLinks.length > 0 && (
          <span className="hidden md:inline text-xs text-stone-500 dark:text-stone-400 font-mono-tabular whitespace-nowrap">
            {stairLinks.length} stair link{stairLinks.length === 1 ? '' : 's'}
          </span>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setAddMenuOpen((v) => !v)}
            aria-expanded={addMenuOpen}
            aria-haspopup="menu"
            className="min-h-[30px] px-2.5 rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#18191D] hover:bg-stone-100 dark:hover:bg-[#262931] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            <span>Add Floor</span>
            <ChevronDown
              className={`w-3 h-3 text-stone-400 transition-transform duration-150 ${
                addMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {addMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAddMenuOpen(false)}
              />
              <div
                role="menu"
                className="kc-popover-in absolute right-0 mt-1.5 w-52 rounded-xl border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#1E2026] shadow-xl py-1.5 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAddFloor('above');
                    setAddMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-stone-800 dark:text-stone-100 hover:bg-[#FAF9F6] dark:hover:bg-white/5 flex items-center gap-2.5 transition-colors"
                >
                  <ArrowUp className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />
                  <span>Add Upper Floor</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAddFloor('below');
                    setAddMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-stone-800 dark:text-stone-100 hover:bg-[#FAF9F6] dark:hover:bg-white/5 flex items-center gap-2.5 transition-colors"
                >
                  <ArrowDown className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Add Basement / Cellar</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

FloorBar.displayName = 'FloorBar';
