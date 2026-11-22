import React from 'react';
import {
  DoorOpen,
  EyeOff,
  GitFork,
  Hand,
  MousePointer2,
  Pentagon,
  Route,
  Scissors,
  Square,
} from 'lucide-react';
import { ToolMode } from '../types/map';

interface ToolbarProps {
  activeTool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
}

const TOOL_GROUPS: Array<
  Array<{
    id: ToolMode;
    label: string;
    hint: string;
    icon: React.FC<{ className?: string }>;
  }>
> = [
  [
    {
      id: 'select',
      label: 'Select',
      hint: 'Select, move rooms, drag vertices & bend walls',
      icon: MousePointer2,
    },
  ],
  [
    {
      id: 'rect-room',
      label: 'Room',
      hint: 'Drag to create a rectangular room',
      icon: Square,
    },
    {
      id: 'hallway',
      label: 'Hallway',
      hint: 'Drag to create a hallway corridor',
      icon: GitFork,
    },
    {
      id: 'polygon',
      label: 'Polygon',
      hint: 'Click/tap vertices to draw custom shape',
      icon: Pentagon,
    },
    {
      id: 'slice',
      label: 'Cutout',
      hint: 'Draw an Open Cutout or Closed Cutout polygon',
      icon: Scissors,
    },
  ],
  [
    {
      id: 'doorway',
      label: 'Door',
      hint: 'Click any wall to place or cycle doorway',
      icon: DoorOpen,
    },
    {
      id: 'secret-passage',
      label: 'Secret',
      hint: 'Draw a secret passage between rooms or to exterior wall',
      icon: EyeOff,
    },
    {
      id: 'pathing',
      label: 'Pathing',
      hint: 'Tap rooms to compute shortest room-to-room sequence',
      icon: Route,
    },
  ],
  [
    {
      id: 'pan',
      label: 'Pan',
      hint: 'Single-finger pan (2-finger pan/zoom always active)',
      icon: Hand,
    },
  ],
];

const ALL_TOOLS = TOOL_GROUPS.flat();

export const Toolbar: React.FC<ToolbarProps> = React.memo(({ activeTool, onSelectTool }) => {
  return (
    <>
      {/* Desktop Left Vertical Tool Rail */}
      <aside
        aria-label="Drawing tools"
        className="hidden lg:flex flex-col w-[76px] shrink-0 py-3 px-2 gap-1.5 border-r border-[#E5E0D5] dark:border-[#2E313A] bg-white dark:bg-[#18191D] z-20 overflow-y-auto kc-scroll"
      >
        {TOOL_GROUPS.map((group, groupIdx) => (
          <React.Fragment key={groupIdx}>
            {groupIdx > 0 && (
              <div
                className="my-1 mx-2 border-t border-[#E5E0D5] dark:border-[#2E313A]"
                aria-hidden="true"
              />
            )}
            <div className="flex flex-col gap-1">
              {group.map((tool) => {
                const Icon = tool.icon;
                const active = activeTool === tool.id;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => onSelectTool(tool.id)}
                    title={tool.hint}
                    aria-pressed={active}
                    className={`w-full min-h-[50px] px-1 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                      active
                        ? 'bg-teal-700 dark:bg-teal-600 text-white shadow-xs'
                        : 'text-stone-600 dark:text-stone-300 hover:bg-[#FAF9F6] dark:hover:bg-[#1E2026] hover:text-stone-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-[17px] h-[17px] shrink-0" />
                    <span className="text-[11px] font-medium leading-none whitespace-nowrap">
                      {tool.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </aside>

      {/* Mobile Bottom Ergonomic Thumb Strip */}
      <nav
        aria-label="Mobile drawing tools"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-14 px-2 bg-white/95 dark:bg-[#18191D]/95 backdrop-blur-md border-t border-[#E5E0D5] dark:border-[#2E313A] flex items-center gap-1 overflow-x-auto no-scrollbar"
      >
        {ALL_TOOLS.map((tool) => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onSelectTool(tool.id)}
              aria-pressed={active}
              className={`min-h-[44px] min-w-[54px] flex-1 px-2 rounded-xl flex flex-col items-center justify-center gap-0.5 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 transition-colors ${
                active
                  ? 'bg-teal-700 dark:bg-teal-600 text-white'
                  : 'text-stone-600 dark:text-stone-300 active:bg-stone-100 dark:active:bg-white/10'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-[10px] font-medium leading-none whitespace-nowrap">
                {tool.label}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
});
