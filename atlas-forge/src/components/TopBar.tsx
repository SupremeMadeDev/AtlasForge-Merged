import React from 'react';

export type AppView = 'continent' | 'settlement' | 'interior' | 'ledger' | 'library' | 'export';
export type TopSection = 'map' | 'ledger' | 'library' | 'export';

export const TOP_SECTIONS: { id: TopSection; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'library', label: 'Library' },
  { id: 'export', label: 'Export' },
];

interface TopBarProps {
  activeSection: TopSection;
  onNavigate: (section: TopSection) => void;
  onHome: () => void;
  onNewContinent: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  activeSection,
  onNavigate,
  onHome,
  onNewContinent,
}) => (
  <header className="h-12 md:h-14 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between gap-4 md:gap-8 shrink-0">
    <button
      type="button"
      onClick={onHome}
      className="text-base md:text-lg font-semibold tracking-tight text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded whitespace-nowrap shrink-0 cursor-pointer"
      style={{ fontFamily: 'var(--font-display)' }}
    >
      Atlas Forge
    </button>

    <nav aria-label="Primary" className="hidden md:flex items-center gap-7">
      {TOP_SECTIONS.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={isActive ? 'page' : undefined}
            className={`py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              isActive
                ? 'border-blue-700 text-slate-900'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </nav>

    <div className="flex items-center shrink-0">
      <button
        type="button"
        onClick={onNewContinent}
        className="px-3 sm:px-4 py-2 min-h-[36px] text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        New continent
      </button>
    </div>
  </header>
);
