import React, { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { InteriorEntry, WorldState } from '../types/world';
import { createBundle, parseImport } from '../utils/bundle';

interface ExportViewProps {
  world: WorldState;
  interiors: InteriorEntry[];
  onImport: (world: WorldState, interiors: InteriorEntry[] | null) => void;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';
}

function download(filename: string, json: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const ExportView: React.FC<ExportViewProps> = ({ world, interiors, onImport }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handleExportBundle = () => {
    download(`${slug(world.continent.name)}-bundle.json`, JSON.stringify(createBundle(world, interiors), null, 2));
  };

  const handleExportWorldOnly = () => {
    download(`${slug(world.continent.name)}-world.json`, JSON.stringify(world, null, 2));
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseImport(String(reader.result));
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.error });
        return;
      }
      if (
        !window.confirm(
          result.interiors
            ? 'Replace the current world and interior library with this bundle?'
            : 'Replace the current world with this file? Buildings linked to interiors that are not in the library will be unlinked.'
        )
      ) {
        return;
      }
      onImport(result.world, result.interiors);
      setMessage({
        kind: 'ok',
        text: result.interiors
          ? `Loaded “${result.world.continent.name}” with ${result.interiors.length} ${result.interiors.length === 1 ? 'interior' : 'interiors'}.`
          : `Loaded “${result.world.continent.name}” (${result.world.regions.length} regions).`,
      });
    };
    reader.onerror = () => setMessage({ kind: 'error', text: 'Could not read that file.' });
    reader.readAsText(file);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6F8] p-4 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1
            className="text-xl sm:text-2xl font-semibold text-slate-900"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Export and import
          </h1>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            The world is saved in this browser as you work, and interiors are saved in its database. A bundle copies
            both into one file you can back up or move to another browser.
          </p>
        </div>

        <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-3" aria-labelledby="export-heading">
          <h2 id="export-heading" className="text-sm font-semibold text-slate-900">
            Export
          </h2>
          <p className="text-xs text-slate-600 tabular-nums">
            {world.regions.length} regions · {interiors.length} {interiors.length === 1 ? 'interior' : 'interiors'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportBundle}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              Export bundle
            </button>
            <button
              type="button"
              onClick={handleExportWorldOnly}
              className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-md cursor-pointer"
            >
              Export world only
            </button>
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-3" aria-labelledby="import-heading">
          <h2 id="import-heading" className="text-sm font-semibold text-slate-900">
            Import
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            Choose a bundle, or a world file exported before interiors were linked.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleImportFile}
            className="hidden"
            aria-label="Choose a bundle or world file"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[38px] text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-md cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            Choose file
          </button>
          {message && (
            <p
              role={message.kind === 'error' ? 'alert' : 'status'}
              className={`text-xs ${message.kind === 'error' ? 'text-red-700' : 'text-emerald-800'}`}
            >
              {message.text}
            </p>
          )}
        </section>
      </div>
    </div>
  );
};
