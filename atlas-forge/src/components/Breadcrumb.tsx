import React from 'react';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  /** Secondary text shown muted after the label, such as the region a settlement belongs to */
  detail?: string;
  onClick?: () => void;
}

interface BreadcrumbProps {
  crumbs: Crumb[];
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ crumbs }) => (
  <nav
    aria-label="Location"
    className="h-9 shrink-0 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center gap-1 text-xs overflow-x-auto whitespace-nowrap no-scrollbar"
  >
    {crumbs.map((crumb, i) => {
      const isLast = i === crumbs.length - 1;
      return (
        <React.Fragment key={`${i}-${crumb.label}`}>
          {i > 0 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />}
          {isLast || !crumb.onClick ? (
            <span
              aria-current={isLast ? 'page' : undefined}
              className={`px-1.5 py-1 ${isLast ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
            >
              {crumb.label}
              {crumb.detail && <span className="font-normal text-slate-500"> · {crumb.detail}</span>}
            </span>
          ) : (
            <button
              type="button"
              onClick={crumb.onClick}
              className="px-1.5 py-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {crumb.label}
            </button>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);
