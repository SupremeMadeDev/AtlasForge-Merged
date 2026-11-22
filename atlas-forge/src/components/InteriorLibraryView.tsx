import React, { useMemo, useState } from 'react';
import { Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import type { InteriorEntry } from '../types/world';
import { summarizeInterior } from '../utils/interiorLink';

export interface LibraryAttachment {
  regionId: string;
  buildingId: string;
  buildingName: string;
  settlementName: string;
}

export interface AttachableBuilding {
  regionId: string;
  buildingId: string;
  label: string;
}

interface InteriorLibraryViewProps {
  entries: InteriorEntry[];
  attachments: Map<string, LibraryAttachment>;
  attachable: AttachableBuilding[];
  persistent: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAttach: (id: string, regionId: string, buildingId: string) => void;
  onDetach: (id: string) => void;
  onGoToBuilding: (regionId: string, buildingId: string) => void;
}

function formatUpdated(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

export const InteriorLibraryView: React.FC<InteriorLibraryViewProps> = ({
  entries,
  attachments,
  attachable,
  persistent,
  onOpen,
  onNew,
  onDuplicate,
  onDelete,
  onAttach,
  onDetach,
  onGoToBuilding,
}) => {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...entries]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((e) => {
        if (!q) return true;
        const at = attachments.get(e.id);
        return (
          e.title.toLowerCase().includes(q) ||
          (at?.settlementName.toLowerCase().includes(q) ?? false)
        );
      })
      .map((entry) => ({ entry, summary: summarizeInterior(entry.doc), attachment: attachments.get(entry.id) ?? null }));
  }, [entries, attachments, query]);

  const attachedCount = entries.filter((e) => attachments.has(e.id)).length;

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6F8] p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="text-xl sm:text-2xl font-semibold text-slate-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Interior library
            </h1>
            <p className="text-xs text-slate-600 mt-1 tabular-nums">
              {entries.length} {entries.length === 1 ? 'interior' : 'interiors'} · {attachedCount} attached to a
              building
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="library-search" className="sr-only">
              Search interiors
            </label>
            <input
              id="library-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search interiors"
              className="w-44 sm:w-56 px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:border-blue-600"
            />
            <button
              type="button"
              onClick={onNew}
              className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 min-h-[36px] text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              New interior
            </button>
          </div>
        </div>

        {!persistent && (
          <div role="alert" className="p-3 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-md">
            This browser can’t store interiors between visits, so they will be lost when you close the tab. Export a
            bundle from the Export section to keep them.
          </div>
        )}

        {entries.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-8 text-center space-y-2">
            <h2 className="text-sm font-semibold text-slate-900">No interiors yet</h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
              Claim a building on a settlement map and choose “Start from outline” or “Generate layout”, or start a
              free-standing interior here.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-600">No interiors match “{query}”.</p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map(({ entry, summary, attachment }) => (
              <li
                key={entry.id}
                className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <h2 className="text-sm font-semibold text-slate-900 truncate">{entry.title}</h2>
                    <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">
                      {formatUpdated(entry.updatedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 tabular-nums">
                    {summary.roomCount} {summary.roomCount === 1 ? 'room' : 'rooms'} · {summary.floors}{' '}
                    {summary.floors === 1 ? 'floor' : 'floors'}
                    {summary.cellars > 0 ? ` · ${summary.cellars} ${summary.cellars === 1 ? 'cellar' : 'cellars'}` : ''}
                    <span className="text-slate-400"> — </span>
                    <span className="text-slate-500">{summary.roomSummary}</span>
                  </p>
                  <p className="text-xs">
                    {attachment ? (
                      <button
                        type="button"
                        onClick={() => onGoToBuilding(attachment.regionId, attachment.buildingId)}
                        className="text-blue-700 hover:text-blue-900 hover:underline cursor-pointer"
                      >
                        {attachment.buildingName} · {attachment.settlementName}
                      </button>
                    ) : (
                      <span className="text-slate-500">Not attached to a building</span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {!attachment && attachable.length > 0 && (
                    <>
                      <label htmlFor={`attach-${entry.id}`} className="sr-only">
                        Attach {entry.title} to a building
                      </label>
                      <select
                        id={`attach-${entry.id}`}
                        value=""
                        onChange={(e) => {
                          const target = attachable.find((a) => `${a.regionId}:${a.buildingId}` === e.target.value);
                          if (!target) return;
                          if (
                            window.confirm(
                              `Attach “${entry.title}” to ${target.label}? The building’s outline will change to match this interior.`
                            )
                          ) {
                            onAttach(entry.id, target.regionId, target.buildingId);
                          }
                        }}
                        className="max-w-[11rem] px-2 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-700 cursor-pointer"
                      >
                        <option value="">Attach to…</option>
                        {attachable.map((a) => (
                          <option key={`${a.regionId}:${a.buildingId}`} value={`${a.regionId}:${a.buildingId}`}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {attachment && (
                    <button
                      type="button"
                      onClick={() => onDetach(entry.id)}
                      className="min-h-[34px] px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                    >
                      Detach
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDuplicate(entry.id)}
                    aria-label={`Duplicate ${entry.title}`}
                    title="Duplicate"
                    className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(entry.id)}
                    aria-label={`Delete ${entry.title}`}
                    title="Delete"
                    className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center text-slate-600 hover:text-red-700 hover:bg-red-50 rounded-md cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(entry.id)}
                    className="inline-flex items-center gap-1.5 min-h-[34px] px-3 py-1.5 text-xs font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    Open
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
