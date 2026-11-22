import React, { useMemo, useState } from 'react';
import { FolderOpen, Search } from 'lucide-react';
import { BIOMES, BIOME_LIST, SETTLEMENT_TIER_META, THREAT_TIERS } from '../data/presets';
import { BiomeType, ColorCodingMode, ContinentConfig, Region } from '../types/world';
import { getRegionColorSpec } from '../utils/continentGenerator';
import { polygonArea } from '../utils/polygonOps';

interface RegionLedgerViewProps {
  continent: ContinentConfig;
  regions: Region[];
  colorMode: ColorCodingMode;
  onOpenSettlement: (regionId: string) => void;
}

export const RegionLedgerView: React.FC<RegionLedgerViewProps> = ({
  continent,
  regions,
  colorMode,
  onOpenSettlement,
}) => {
  const [search, setSearch] = useState('');
  const [biomeFilter, setBiomeFilter] = useState<BiomeType | 'all'>('all');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return regions.filter((r) => {
      if (biomeFilter !== 'all' && r.biome !== biomeFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.faction.toLowerCase().includes(q) ||
        r.settlement.name.toLowerCase().includes(q)
      );
    });
  }, [regions, search, biomeFilter]);

  const totals = useMemo(() => {
    let totalBuildings = 0;
    let totalClaimed = 0;
    let totalLinked = 0;
    for (const r of regions) {
      totalBuildings += r.settlement.buildings.length;
      for (const b of r.settlement.buildings) {
        if (b.claimStatus === 'claimed') totalClaimed++;
        if (b.interiorLink) totalLinked++;
      }
    }
    return { totalBuildings, totalClaimed, totalUnclaimed: totalBuildings - totalClaimed, totalLinked };
  }, [regions]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F6F8] p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1
              className="text-xl sm:text-2xl font-semibold text-slate-900"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {continent.name} Region Ledger
            </h1>
            <p className="text-xs text-slate-600 mt-1 tabular-nums">
              {regions.length} regions · {totals.totalBuildings} building silhouettes ·{' '}
              {totals.totalClaimed} claimed · {totals.totalLinked} interior-linked
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search region, faction, city..."
                aria-label="Search region ledger"
                className="w-full pl-8 pr-3 py-2 sm:py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
              />
            </div>

            <select
              value={biomeFilter}
              onChange={(e) => setBiomeFilter(e.target.value as BiomeType | 'all')}
              aria-label="Filter by biome"
              className="px-3 py-2 sm:py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-blue-600"
            >
              <option value="all">All Biomes</option>
              {BIOME_LIST.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-md overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-4">Region</th>
                <th className="py-2.5 px-3">Biome</th>
                <th className="py-2.5 px-3">Faction / Realm</th>
                <th className="py-2.5 px-3">Threat</th>
                <th className="py-2.5 px-3 text-right">Area (sq mi)</th>
                <th className="py-2.5 px-3">Main Settlement</th>
                <th className="py-2.5 px-3 text-right">Claimed / Total</th>
                <th className="py-2.5 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.map((region) => {
                const colorSpec = getRegionColorSpec(region, colorMode);
                const areaSqMi = Math.round(polygonArea(region.polygon) * 0.42);
                const claimed = region.settlement.buildings.filter(
                  (b) => b.claimStatus === 'claimed'
                ).length;
                const total = region.settlement.buildings.length;

                return (
                  <tr key={region.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-xs border border-slate-700/25 shrink-0"
                          style={{ backgroundColor: colorSpec.fill }}
                          aria-hidden="true"
                        />
                        <span>{region.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{BIOMES[region.biome].label}</td>
                    <td className="py-2.5 px-3 text-slate-700">{region.faction}</td>
                    <td className="py-2.5 px-3 text-slate-700">
                      {THREAT_TIERS[region.threat].shortLabel}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {areaSqMi.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-slate-900">
                      {region.settlement.name}{' '}
                      <span className="text-slate-500">
                        · {SETTLEMENT_TIER_META[region.settlement.tier].label}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                      {claimed} / {total}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => onOpenSettlement(region.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded cursor-pointer whitespace-nowrap"
                      >
                        <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-xs text-slate-500">
                    No regions match the selected filters.
                  </td>
                </tr>
              )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
