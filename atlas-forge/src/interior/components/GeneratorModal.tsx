import React, { useEffect, useState } from 'react';
import { Check, Dices, Layers, X } from 'lucide-react';
import {
  LayoutArchetype,
  LayoutComplexity,
  ProceduralLayoutOptions,
} from '../types/map';

interface GeneratorModalProps {
  open: boolean;
  onClose: () => void;
  onGenerate: (options: ProceduralLayoutOptions) => void;
}

const ARCHETYPES: Array<{ id: LayoutArchetype; label: string; desc: string }> = [
  { id: 'manor', label: 'Manor House', desc: 'Salons, study, conservatory' },
  { id: 'fortress', label: 'Keep / Fortress', desc: 'Barracks, armory, war room' },
  { id: 'crypt', label: 'Dungeon Crypt', desc: 'Ossuary, tombs, cistern' },
  { id: 'tavern', label: 'Tavern & Inn', desc: 'Taproom, booths, cellar vault' },
  { id: 'temple', label: 'Temple / Abbey', desc: 'Nave, reliquary, scriptorium' },
  { id: 'blacksmith', label: 'Blacksmith', desc: 'Forge hall, quenching trough, armory' },
  { id: 'guildhall', label: 'Guildhall', desc: 'Counting house, vault, dock' },
  { id: 'jail', label: 'Prison / Gaol', desc: 'Cell blocks, warden, yard' },
];

const COMPLEXITIES: Array<{ id: LayoutComplexity; label: string; desc: string }> = [
  { id: 'simple', label: 'Simple', desc: 'Compact minimal layout & direct access' },
  { id: 'standard', label: 'Standard', desc: 'Articulated multi-wing manor / keep' },
  { id: 'labyrinthine', label: 'Labyrinthine', desc: 'Ring corridors, crossways & loops' },
  { id: 'bizarre', label: 'Bizarre', desc: 'Erratic sprawling wings & webbed loops' },
];

const FLOOR_COUNTS: Array<{ count: 1 | 2 | 3; label: string; desc: string }> = [
  { count: 1, label: '1 Floor', desc: 'Single level' },
  { count: 2, label: '2 Floors', desc: 'Ground + Upper' },
  { count: 3, label: '3 Floors', desc: 'Cellar + Ground + Upper' },
];

export const GeneratorModal: React.FC<GeneratorModalProps> = React.memo(({
  open,
  onClose,
  onGenerate,
}) => {
  const [groundCount, setGroundCount] = useState(9);
  const [upperCount, setUpperCount] = useState(8);
  const [cellarCount, setCellarCount] = useState(6);
  const [complexity, setComplexity] = useState<LayoutComplexity>('standard');
  const [archetype, setArchetype] = useState<LayoutArchetype>('manor');
  const [floorCount, setFloorCount] = useState<1 | 2 | 3>(2);
  const [includeCurves, setIncludeCurves] = useState(true);
  const [includeDiagonals, setIncludeDiagonals] = useState(true);
  const [includeSecretPassages, setIncludeSecretPassages] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleSelectComplexity = (nextComp: LayoutComplexity) => {
    setComplexity(nextComp);
    if (nextComp === 'simple') {
      setGroundCount(6);
      setUpperCount(5);
      setCellarCount(4);
    } else if (nextComp === 'standard') {
      setGroundCount(9);
      setUpperCount(8);
      setCellarCount(6);
    } else {
      setGroundCount(12);
      setUpperCount(10);
      setCellarCount(8);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gen-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="kc-popover-in w-full max-w-xl rounded-2xl border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#18191D] text-stone-900 dark:text-stone-100 shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E0D5] dark:border-[#2E313A]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800/60 flex items-center justify-center shrink-0">
              <Dices className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 id="gen-modal-title" className="font-display text-base font-semibold leading-tight text-stone-900 dark:text-white">
                Generate Random Layout
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Configure floors, spatial complexity, and architectural archetype
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close generator"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-stone-500 dark:text-stone-400 hover:bg-[#FAF9F6] dark:hover:bg-[#1E2026] hover:text-stone-900 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="px-6 py-5 space-y-6 max-h-[74vh] overflow-y-auto kc-scroll">
          {/* Floor Count & Per-Floor Chamber Counts */}
          <section className="space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-800 dark:text-stone-200">
              <Layers className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
              <span>Floors &amp; Interlinking Stairways</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {FLOOR_COUNTS.map((item) => {
                const active = floorCount === item.count;
                return (
                  <button
                    key={item.count}
                    type="button"
                    onClick={() => setFloorCount(item.count)}
                    aria-pressed={active}
                    className={`p-3 rounded-xl border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                      active
                        ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/40 text-stone-900 dark:text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026]/70 hover:bg-stone-100/80 dark:hover:bg-[#262931]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold whitespace-nowrap">{item.label}</span>
                      {active && (
                        <Check className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-snug">
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="p-3.5 rounded-xl border border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026]/60 space-y-3">
              <div className="text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                {floorCount === 1 ? 'Chamber Count' : 'Per-Floor Chamber Counts'}
              </div>
              {floorCount >= 2 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="gen-upper-count" className="text-stone-700 dark:text-stone-200 font-medium">
                      Upper Floor
                    </label>
                    <span className="font-mono-tabular font-semibold text-teal-700 dark:text-teal-400">
                      {upperCount} chambers
                    </span>
                  </div>
                  <input
                    id="gen-upper-count"
                    type="range"
                    min={4}
                    max={18}
                    value={upperCount}
                    onChange={(e) => setUpperCount(Number(e.target.value))}
                    className="w-full kc-range"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="gen-ground-count" className="text-stone-700 dark:text-stone-200 font-medium">
                    Ground Floor
                  </label>
                  <span className="font-mono-tabular font-semibold text-teal-700 dark:text-teal-400">
                    {groundCount} chambers
                  </span>
                </div>
                <input
                  id="gen-ground-count"
                  type="range"
                  min={4}
                  max={18}
                  value={groundCount}
                  onChange={(e) => setGroundCount(Number(e.target.value))}
                  className="w-full kc-range"
                />
              </div>
              {floorCount === 3 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <label htmlFor="gen-cellar-count" className="text-stone-700 dark:text-stone-200 font-medium">
                      Cellar / Vaults
                    </label>
                    <span className="font-mono-tabular font-semibold text-teal-700 dark:text-teal-400">
                      {cellarCount} chambers
                    </span>
                  </div>
                  <input
                    id="gen-cellar-count"
                    type="range"
                    min={4}
                    max={18}
                    value={cellarCount}
                    onChange={(e) => setCellarCount(Number(e.target.value))}
                    className="w-full kc-range"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Architectural Complexity */}
          <section className="space-y-2.5">
            <span className="block text-xs font-semibold text-stone-800 dark:text-stone-200">
              Architectural Complexity
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              {COMPLEXITIES.map((item) => {
                const active = complexity === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectComplexity(item.id)}
                    aria-pressed={active}
                    className={`p-3 rounded-xl border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                      active
                        ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/40 text-stone-900 dark:text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026]/70 hover:bg-stone-100/80 dark:hover:bg-[#262931]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold whitespace-nowrap">{item.label}</span>
                      {active && (
                        <Check className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 leading-snug">
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Location Archetype */}
          <section className="space-y-2.5">
            <span className="block text-xs font-semibold text-stone-800 dark:text-stone-200">
              Location Archetype
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              {ARCHETYPES.map((item) => {
                const active = archetype === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setArchetype(item.id)}
                    aria-pressed={active}
                    className={`p-3 rounded-xl border text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                      active
                        ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/40 text-stone-900 dark:text-white'
                        : 'border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026]/70 hover:bg-stone-100/80 dark:hover:bg-[#262931]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold whitespace-nowrap">{item.label}</span>
                      {active && (
                        <Check className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                      )}
                    </div>
                    <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">
                      {item.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Structural Options */}
          <section className="space-y-2.5 pt-3 border-t border-[#E5E0D5] dark:border-[#2E313A]">
            <label className="flex items-center justify-between gap-4 cursor-pointer py-1.5 select-none">
              <span className="text-xs font-medium text-stone-700 dark:text-stone-200">
                Include curved outer walls &amp; bays
              </span>
              <span className="relative inline-flex items-center shrink-0">
                <input
                  type="checkbox"
                  checked={includeCurves}
                  onChange={(e) => setIncludeCurves(e.target.checked)}
                  className="sr-only peer"
                />
                <span className="w-9 h-5 rounded-full bg-stone-300 dark:bg-stone-700 peer-checked:bg-teal-700 dark:peer-checked:bg-teal-600 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-600 transition-colors" />
                <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4" />
              </span>
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer py-1.5 select-none">
              <span className="text-xs font-medium text-stone-700 dark:text-stone-200">
                Include diagonal walls, chamfers &amp; canted bays
              </span>
              <span className="relative inline-flex items-center shrink-0">
                <input
                  type="checkbox"
                  checked={includeDiagonals}
                  onChange={(e) => setIncludeDiagonals(e.target.checked)}
                  className="sr-only peer"
                />
                <span className="w-9 h-5 rounded-full bg-stone-300 dark:bg-stone-700 peer-checked:bg-teal-700 dark:peer-checked:bg-teal-600 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-600 transition-colors" />
                <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4" />
              </span>
            </label>

            <label className="flex items-center justify-between gap-4 cursor-pointer py-1.5 select-none">
              <span className="text-xs font-medium text-stone-700 dark:text-stone-200">
                Add secret passages &amp; escape tunnels
              </span>
              <span className="relative inline-flex items-center shrink-0">
                <input
                  type="checkbox"
                  checked={includeSecretPassages}
                  onChange={(e) => setIncludeSecretPassages(e.target.checked)}
                  className="sr-only peer"
                />
                <span className="w-9 h-5 rounded-full bg-stone-300 dark:bg-stone-700 peer-checked:bg-amber-600 dark:peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-500 transition-colors" />
                <span className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4" />
              </span>
            </label>
          </section>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026]/80 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-4 text-xs font-semibold rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#18191D] text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-[#262931] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onGenerate({
                roomCount: groundCount,
                complexity,
                archetype,
                floorCount,
                floorRoomCounts: {
                  ground: groundCount,
                  upper: floorCount >= 2 ? upperCount : undefined,
                  cellar: floorCount === 3 ? cellarCount : undefined,
                },
                includeCurves,
                includeDiagonals,
                includeSecretPassages,
              });
              onClose();
            }}
            className="min-h-[40px] px-4 flex items-center gap-1.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 transition-colors"
          >
            <Dices className="w-3.5 h-3.5" />
            <span>Generate Layout</span>
          </button>
        </div>
      </div>
    </div>
  );
});
