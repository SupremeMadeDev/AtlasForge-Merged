import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronDown,
  CopyPlus,
  Dices,
  Download,
  FileJson,
  FolderOpen,
  Image as ImageIcon,
  LayoutTemplate,
  Moon,
  Pencil,
  Plus,
  Redo2,
  Save,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { ProceduralLayoutOptions, SavedMapEntry } from '../types/map';
import { formatSavedTimestamp, getMapChamberCount } from '../utils/savedMaps';

type LoadMenuTab = 'saved' | 'templates' | 'generate';

interface TopBarProps {
  title: string;
  floorLabel: string;
  onTitleChange: (title: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  darkTheme: boolean;
  onToggleTheme: () => void;
  onOpenGenerator: () => void;
  onQuickGenerate?: (options: ProceduralLayoutOptions) => void;
  onLoadPreset: (preset: 'manor' | 'tavern' | 'fortress' | 'empty') => void;
  savedMaps: SavedMapEntry[];
  activeSavedMapId: string | null;
  hasUnsavedChanges: boolean;
  onSaveMap: () => void;
  onSaveAsNewMap: () => void;
  onSelectSavedMap: (id: string) => void;
  onRenameSavedMap: (id: string, title: string) => void;
  onDeleteSavedMap: (id: string) => void;
  onExportPNG: () => void;
  onExportJSON: () => void;
  onImportJSON: (file: File) => void;
  /** Running inside Atlas Forge: show the location instead of the standalone brand */
  embedded?: boolean;
  contextLabel?: string;
}

export const TopBar: React.FC<TopBarProps> = React.memo(({
  title,
  floorLabel,
  onTitleChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  darkTheme,
  onToggleTheme,
  onOpenGenerator,
  onQuickGenerate,
  onLoadPreset,
  savedMaps,
  activeSavedMapId,
  hasUnsavedChanges,
  onSaveMap,
  onSaveAsNewMap,
  onSelectSavedMap,
  onRenameSavedMap,
  onDeleteSavedMap,
  onExportPNG,
  onExportJSON,
  onImportJSON,
  embedded = false,
  contextLabel,
}) => {
  const [exportOpen, setExportOpen] = useState(false);
  const [loadMenuOpen, setLoadMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<LoadMenuTab>('saved');

  const [editingSavedId, setEditingSavedId] = useState<string | null>(null);
  const [draftSavedTitle, setDraftSavedTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!exportOpen && !loadMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportOpen(false);
        setLoadMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exportOpen, loadMenuOpen]);

  const beginRename = (entry: SavedMapEntry) => {
    setEditingSavedId(entry.id);
    setDraftSavedTitle(entry.title);
  };

  const commitRename = (id: string) => {
    if (draftSavedTitle.trim()) {
      onRenameSavedMap(id, draftSavedTitle.trim());
    }
    setEditingSavedId(null);
  };

  const isSavedAndClean = Boolean(activeSavedMapId) && !hasUnsavedChanges;

  return (
    <header className="h-14 shrink-0 px-2.5 sm:px-4 lg:px-5 flex items-center justify-between gap-1.5 sm:gap-4 border-b border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#18191D] text-stone-900 dark:text-stone-100 z-30">
      {/* Zone 1: Brand + Editable Map Title */}
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 overflow-hidden">
        {embedded ? (
          <span className="hidden md:inline text-xs font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap truncate max-w-[200px] shrink-0">
            {contextLabel}
          </span>
        ) : (
          <span className="font-display text-[15px] sm:text-lg font-bold tracking-tight text-stone-900 dark:text-white whitespace-nowrap shrink-0">
            Layout Creator
          </span>
        )}

        <span
          className="hidden sm:inline text-stone-300 dark:text-stone-700 select-none shrink-0"
          aria-hidden="true"
        >
          /
        </span>

        <div className="hidden sm:flex items-center relative group min-w-0 max-w-[220px]">
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label="Map title"
            className="min-w-0 w-full bg-transparent text-sm font-semibold text-stone-800 dark:text-stone-100 border border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] hover:bg-[#FAF9F6] dark:hover:bg-[#1E2026] focus:bg-white dark:focus:bg-[#1E2026] focus:border-teal-600 dark:focus:border-teal-500 focus:outline-none rounded-lg pl-2.5 pr-7 py-1 truncate transition-colors"
          />
          <Pencil
            className="w-3 h-3 text-stone-400 dark:text-stone-500 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none absolute right-2 transition-opacity"
            aria-hidden="true"
          />
        </div>

        <span
          className="hidden xl:inline text-xs font-medium text-stone-500 dark:text-stone-400 whitespace-nowrap truncate max-w-[140px]"
          aria-label="Current active floor"
        >
          <span className="text-stone-300 dark:text-stone-700 mr-2" aria-hidden="true">
            ·
          </span>
          {floorLabel}
        </span>
      </div>

      {/* Zone 2: History Controls, Save Button, Load Map Hub, and Theme */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Undo / Redo */}
        <div
          className="flex items-center border border-[#E5E0D5] dark:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#1E2026] rounded-lg overflow-hidden shrink-0"
          role="group"
          aria-label="History controls"
        >
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            className="min-h-[34px] sm:min-h-[36px] min-w-[30px] sm:min-w-[36px] px-1.5 sm:px-2 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5 disabled:opacity-35 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 transition-colors"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-[#E5E0D5] dark:bg-[#2E313A]" />
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
            className="min-h-[34px] sm:min-h-[36px] min-w-[30px] sm:min-w-[36px] px-1.5 sm:px-2 flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-white/5 disabled:opacity-35 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 transition-colors"
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>

        {/* 1-Click Save Button (Outflow) */}
        <button
          type="button"
          onClick={onSaveMap}
          title={
            isSavedAndClean
              ? `Saved "${title}" (Ctrl+S)`
              : activeSavedMapId
                ? `Save changes to "${title}" (Ctrl+S)`
                : `Save "${title}" to Saved Maps (Ctrl+S)`
          }
          aria-label={isSavedAndClean ? 'Map saved' : 'Save map'}
          className={`relative min-h-[34px] sm:min-h-[36px] min-w-[34px] sm:min-w-0 px-2 sm:px-3 text-xs font-semibold rounded-lg border flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
            isSavedAndClean
              ? 'border-teal-600/40 bg-teal-50/70 dark:bg-teal-950/30 text-teal-800 dark:text-teal-300 hover:bg-teal-100/70 dark:hover:bg-teal-950/50'
              : 'border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#1E2026] text-stone-800 dark:text-stone-100 hover:bg-[#FAF9F6] dark:hover:bg-[#262931]'
          }`}
        >
          {isSavedAndClean ? (
            <Check className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
          ) : (
            <Save className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
          )}
          <span className="hidden sm:inline">{isSavedAndClean ? 'Saved' : 'Save'}</span>
          {!isSavedAndClean && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
              title="Unsaved changes"
              aria-label="Unsaved changes"
            />
          )}
        </button>

        {/* Load Map Hub (Inflow: Saved Maps, Templates, Generator) */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setLoadMenuOpen((v) => !v);
              setExportOpen(false);
            }}
            title="Load Map (Saved Maps, Templates, Generator)"
            aria-label="Open Load Map menu"
            aria-expanded={loadMenuOpen}
            aria-haspopup="dialog"
            className={`min-h-[34px] sm:min-h-[36px] min-w-[34px] sm:min-w-0 px-2 sm:px-3 text-xs font-semibold rounded-lg border flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
              loadMenuOpen
                ? 'border-teal-600 bg-teal-50/70 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300'
                : 'border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#1E2026] text-stone-800 dark:text-stone-100 hover:bg-[#FAF9F6] dark:hover:bg-[#262931]'
            }`}
          >
            <FolderOpen className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
            <span className="hidden sm:inline">Load Map</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 ${
                loadMenuOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {loadMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setLoadMenuOpen(false)}
              />
              <div
                role="dialog"
                aria-label="Load Map Options"
                className="kc-popover-in absolute left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0 mt-1.5 w-72 sm:w-80 rounded-xl border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#1E2026] shadow-xl p-2 z-50 text-xs"
              >
                {/* Clean Segmented Tab Switcher */}
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#FAF9F6] dark:bg-[#18191D] p-0.5 border border-[#E5E0D5] dark:border-[#2E313A] mb-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('saved')}
                    className={`min-h-[26px] px-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                      activeTab === 'saved'
                        ? 'bg-white dark:bg-[#262931] text-stone-900 dark:text-white shadow-2xs'
                        : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                    }`}
                  >
                    <span>{embedded ? 'Library' : 'Saved'}</span>
                    {savedMaps.length > 0 && (
                      <span className="font-mono-tabular text-[10px] px-1 py-0.2 rounded-full bg-teal-600/15 text-teal-700 dark:text-teal-300">
                        {savedMaps.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('templates')}
                    className={`min-h-[26px] px-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                      activeTab === 'templates'
                        ? 'bg-white dark:bg-[#262931] text-stone-900 dark:text-white shadow-2xs'
                        : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                    }`}
                  >
                    Templates
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('generate')}
                    className={`min-h-[26px] px-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                      activeTab === 'generate'
                        ? 'bg-white dark:bg-[#262931] text-stone-900 dark:text-white shadow-2xs'
                        : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200'
                    }`}
                  >
                    Generate
                  </button>
                </div>

                {/* Tab 1: Load Saved Map */}
                {activeTab === 'saved' && (
                  <div className="flex flex-col gap-1.5">
                    {savedMaps.length === 0 ? (
                      <div className="py-6 px-3 text-center text-stone-500 dark:text-stone-400">
                        <Bookmark className="w-5 h-5 mx-auto mb-1.5 text-stone-400 dark:text-stone-500" />
                        <p className="font-medium text-xs text-stone-800 dark:text-stone-200">
                          {embedded ? 'The library is empty' : 'No saved maps yet'}
                        </p>
                        <p className="text-[11px] mt-0.5">
                          Click Save on the top bar anytime to store your keeps.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            onSaveMap();
                            setLoadMenuOpen(false);
                          }}
                          className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white font-semibold text-xs transition-colors"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Current Map Now</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500 flex items-center justify-between">
                          <span>Select a map to load:</span>
                          <span className="font-mono-tabular">{savedMaps.length} saved</span>
                        </div>
                        <div className="max-h-56 overflow-y-auto kc-scroll flex flex-col gap-1 pr-0.5">
                          {savedMaps.map((entry) => {
                            const isActive = entry.id === activeSavedMapId;
                            const isEditing = editingSavedId === entry.id;
                            const chambers = getMapChamberCount(entry.doc);
                            return (
                              <div
                                key={entry.id}
                                className={`rounded-lg border p-1.5 flex flex-col gap-1 transition-colors ${
                                  isActive
                                    ? 'border-teal-600/60 bg-teal-50/50 dark:bg-teal-950/25'
                                    : 'border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#18191D]'
                                }`}
                              >
                                {isEditing ? (
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="text"
                                      value={draftSavedTitle}
                                      autoFocus
                                      onChange={(e) => setDraftSavedTitle(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitRename(entry.id);
                                        if (e.key === 'Escape') setEditingSavedId(null);
                                      }}
                                      className="w-full text-xs font-semibold bg-white dark:bg-[#262931] border border-teal-600 rounded px-1.5 py-0.5 text-stone-900 dark:text-white"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => commitRename(entry.id)}
                                      aria-label="Save name"
                                      className="p-1 text-teal-700 dark:text-teal-400 hover:bg-stone-200 dark:hover:bg-white/10 rounded"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSavedId(null)}
                                      aria-label="Cancel rename"
                                      className="p-1 text-stone-400 hover:bg-stone-200 dark:hover:bg-white/10 rounded"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onSelectSavedMap(entry.id);
                                        setLoadMenuOpen(false);
                                      }}
                                      onDoubleClick={() => beginRename(entry)}
                                      title={`Click to load "${entry.title}"`}
                                      className="min-w-0 flex-1 text-left px-1 py-0.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-600"
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-semibold text-xs text-stone-800 dark:text-stone-100 truncate">
                                          {entry.title}
                                        </span>
                                        {isActive && (
                                          <span className="text-[10px] font-bold text-teal-700 dark:text-teal-400 shrink-0">
                                            Active
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-stone-400 dark:text-stone-500 font-mono-tabular">
                                        {entry.doc.floors.length}F · {chambers} chambers ·{' '}
                                        {formatSavedTimestamp(entry.updatedAt)}
                                      </div>
                                    </button>

                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => beginRename(entry)}
                                        title="Rename"
                                        aria-label={`Rename ${entry.title}`}
                                        className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-white/10 transition-colors"
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => onDeleteSavedMap(entry.id)}
                                        title="Delete"
                                        aria-label={`Delete ${entry.title}`}
                                        className="p-1 rounded text-stone-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {activeSavedMapId && (
                          <div className="pt-1 border-t border-[#E5E0D5] dark:border-[#2E313A] mt-1">
                            <button
                              type="button"
                              onClick={() => {
                                onSaveAsNewMap();
                                setLoadMenuOpen(false);
                              }}
                              className="w-full min-h-[26px] px-2 rounded-md hover:bg-[#FAF9F6] dark:hover:bg-white/5 text-stone-700 dark:text-stone-300 font-medium flex items-center justify-center gap-1.5 text-[11px] transition-colors"
                            >
                              <CopyPlus className="w-3 h-3 text-teal-700 dark:text-teal-400" />
                              <span>{embedded ? 'Save a copy to the library' : 'Save Active Map as Copy'}</span>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Tab 2: Templates */}
                {activeTab === 'templates' && (
                  <div className="flex flex-col gap-1.5">
                    <div className="px-1 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                      Preset starter maps:
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onLoadPreset('manor');
                        setLoadMenuOpen(false);
                      }}
                      className="w-full p-2 rounded-lg border border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#18191D] text-left transition-colors flex items-center justify-between"
                    >
                      <div className="font-semibold text-xs text-stone-800 dark:text-stone-100 flex items-center gap-1.5">
                        <LayoutTemplate className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400 shrink-0" />
                        <span>Blackwood Manor</span>
                      </div>
                      <span className="font-mono-tabular text-[10px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300 shrink-0">
                        3 Floors
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onLoadPreset('tavern');
                        setLoadMenuOpen(false);
                      }}
                      className="w-full p-2 rounded-lg border border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#18191D] text-left transition-colors flex items-center justify-between"
                    >
                      <div className="font-semibold text-xs text-stone-800 dark:text-stone-100 flex items-center gap-1.5">
                        <LayoutTemplate className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span>The Copper Flagon</span>
                      </div>
                      <span className="font-mono-tabular text-[10px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300 shrink-0">
                        2 Floors
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onLoadPreset('fortress');
                        setLoadMenuOpen(false);
                      }}
                      className="w-full p-2 rounded-lg border border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#18191D] text-left transition-colors flex items-center justify-between"
                    >
                      <div className="font-semibold text-xs text-stone-800 dark:text-stone-100 flex items-center gap-1.5">
                        <LayoutTemplate className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span>Shadowwatch Keep</span>
                      </div>
                      <span className="font-mono-tabular text-[10px] px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-300 shrink-0">
                        2 Floors
                      </span>
                    </button>

                    <div className="my-0.5 border-t border-[#E5E0D5] dark:border-[#2E313A]" />

                    <button
                      type="button"
                      onClick={() => {
                        onLoadPreset('empty');
                        setLoadMenuOpen(false);
                      }}
                      className="w-full p-2 rounded-lg border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50 hover:bg-rose-50/70 dark:hover:bg-rose-950/30 text-left transition-colors flex items-center gap-2 text-rose-600 dark:text-rose-400"
                    >
                      <Trash2 className="w-4 h-4 shrink-0" />
                      <div className="font-semibold text-xs">Clear Canvas (New Map)</div>
                    </button>
                  </div>
                )}

                {/* Tab 3: Procedural Generator */}
                {activeTab === 'generate' && (
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onOpenGenerator();
                        setLoadMenuOpen(false);
                      }}
                      className="w-full p-2 rounded-lg bg-teal-50 dark:bg-teal-950/30 hover:bg-teal-100/60 dark:hover:bg-teal-950/50 border border-teal-600/30 text-teal-900 dark:text-teal-100 flex items-center justify-between text-left transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Dices className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <div>
                          <div className="font-semibold text-xs">Custom Generator...</div>
                          <div className="text-[10px] text-stone-500 dark:text-stone-400">
                            Configure floors, complexity & archetypes
                          </div>
                        </div>
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-stone-400 shrink-0" />
                    </button>

                    {onQuickGenerate && (
                      <>
                        <div className="px-1 pt-1 text-[10px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider">
                          1-Click Quick Starts
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            onQuickGenerate({
                              roomCount: 8,
                              floorCount: 1,
                              complexity: 'standard',
                              archetype: 'tavern',
                              includeCurves: true,
                              includeDiagonals: true,
                              includeSecretPassages: true,
                            });
                            setLoadMenuOpen(false);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#18191D] flex items-center justify-between text-left text-xs transition-colors"
                        >
                          <span className="font-medium text-stone-800 dark:text-stone-200">
                            1-Floor Outpost / Tavern
                          </span>
                          <span className="font-mono-tabular text-[10px] text-stone-400">1F · 8 rms</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onQuickGenerate({
                              roomCount: 14,
                              floorCount: 2,
                              complexity: 'standard',
                              archetype: 'fortress',
                              includeCurves: true,
                              includeDiagonals: true,
                              includeSecretPassages: true,
                            });
                            setLoadMenuOpen(false);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#18191D] flex items-center justify-between text-left text-xs transition-colors"
                        >
                          <span className="font-medium text-stone-800 dark:text-stone-200">
                            2-Floor Fortress Dungeon
                          </span>
                          <span className="font-mono-tabular text-[10px] text-stone-400">2F · 14 rms</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            onQuickGenerate({
                              roomCount: 20,
                              floorCount: 3,
                              complexity: 'standard',
                              archetype: 'manor',
                              includeCurves: true,
                              includeDiagonals: true,
                              includeSecretPassages: true,
                            });
                            setLoadMenuOpen(false);
                          }}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-transparent hover:border-[#E5E0D5] dark:hover:border-[#2E313A] bg-[#FAF9F6] dark:bg-[#18191D] flex items-center justify-between text-left text-xs transition-colors"
                        >
                          <span className="font-medium text-stone-800 dark:text-stone-200">
                            3-Floor Grand Estate
                          </span>
                          <span className="font-mono-tabular text-[10px] text-stone-400">3F · 20 rms</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Theme Switch */}
        <button
          type="button"
          onClick={onToggleTheme}
          title={darkTheme ? 'Switch to Drafting Paper' : 'Switch to Dungeon Slate'}
          aria-label="Toggle map theme"
          aria-pressed={darkTheme}
          className="min-h-[34px] sm:min-h-[36px] min-w-[34px] sm:min-w-[36px] px-2 flex items-center justify-center rounded-lg border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#1E2026] text-stone-700 dark:text-stone-200 hover:bg-[#FAF9F6] dark:hover:bg-[#262931] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors"
        >
          {darkTheme ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>

      {/* Zone 3: Primary Export / Import CTA */}
      <div className="flex items-center shrink-0">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setExportOpen((v) => !v);
              setLoadMenuOpen(false);
            }}
            aria-label="Export or import map"
            aria-expanded={exportOpen}
            aria-haspopup="menu"
            className="min-h-[34px] sm:min-h-[36px] px-2.5 sm:px-3.5 flex items-center gap-1.5 text-xs font-semibold rounded-lg bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500 text-white shadow-xs whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-1 transition-colors"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden min-[420px]:inline">Export</span>
            <ChevronDown
              className={`w-3.5 h-3.5 opacity-80 transition-transform duration-150 ${
                exportOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {exportOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setExportOpen(false)}
              />
              <div
                role="menu"
                className="kc-popover-in absolute right-0 mt-1.5 w-56 rounded-xl border border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#1E2026] shadow-xl py-1.5 z-50"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onExportPNG();
                    setExportOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-stone-800 dark:text-stone-100 hover:bg-[#FAF9F6] dark:hover:bg-white/5 transition-colors"
                >
                  <ImageIcon className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                  <span>Export Map as PNG</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onExportJSON();
                    setExportOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-stone-800 dark:text-stone-100 hover:bg-[#FAF9F6] dark:hover:bg-white/5 transition-colors"
                >
                  <FileJson className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Export Data as JSON</span>
                </button>
                <div className="my-1 border-t border-[#E5E0D5] dark:border-[#2E313A]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setExportOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-medium text-stone-700 dark:text-stone-200 hover:bg-[#FAF9F6] dark:hover:bg-white/5 transition-colors"
                >
                  <Upload className="w-4 h-4 text-stone-500 dark:text-stone-400 shrink-0" />
                  <span>Import JSON File</span>
                </button>
              </div>
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onImportJSON(file);
                e.target.value = '';
              }
            }}
          />
        </div>
      </div>
    </header>
  );
});

TopBar.displayName = 'TopBar';
