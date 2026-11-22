import { useEffect, useRef } from 'react';
import type React from 'react';
import { Point } from '../types/world';

interface UseCanvasWheelOptions {
  svgRef: React.RefObject<SVGSVGElement | null>;
  width: number;
  height: number;
  zoom: number;
  pan: Point;
  minZoom: number;
  maxZoom: number;
  onZoomChange: (nextZoom: number) => void;
  onPanChange: (nextPan: Point) => void;
}

/**
 * Enables native 2-finger trackpad panning (wheel without Ctrl/Meta) and
 * cursor-anchored pinch-to-zoom (Ctrl/Meta + wheel) on an SVG viewBox canvas,
 * using a non-passive listener so browser page-zoom and back/forward overscroll
 * swipes are cleanly suppressed.
 */
export function useCanvasWheel({
  svgRef,
  width,
  height,
  zoom,
  pan,
  minZoom,
  maxZoom,
  onZoomChange,
  onPanChange,
}: UseCanvasWheelOptions): void {
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const onZoomRef = useRef(onZoomChange);
  const onPanRef = useRef(onPanChange);

  zoomRef.current = zoom;
  panRef.current = pan;
  onZoomRef.current = onZoomChange;
  onPanRef.current = onPanChange;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const clampPan = (x: number, y: number): Point => ({
      x: Math.max(-width * 0.85, Math.min(width * 0.85, x)),
      y: Math.max(-height * 0.85, Math.min(height * 0.85, y)),
    });

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const curZoom = zoomRef.current;
      const curPan = panRef.current;
      const baseScale = Math.min(rect.width / width, rect.height / height) || 1;
      const scale = baseScale * curZoom;

      const unitMult = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 260 : 1;
      const rawDx = e.deltaX * unitMult;
      const rawDy = e.deltaY * unitMult;

      if (e.ctrlKey || e.metaKey) {
        // Pinch-to-zoom (synthesized as ctrl+wheel by browsers) or Ctrl/Cmd+Scroll
        const clampedDy = Math.max(-80, Math.min(80, rawDy));
        const factor = Math.pow(1.0045, -clampedDy);
        const nextZoom = Number(
          Math.max(minZoom, Math.min(maxZoom, curZoom * factor)).toFixed(3)
        );
        if (nextZoom === curZoom) return;

        const ox = e.clientX - (rect.left + rect.width / 2);
        const oy = e.clientY - (rect.top + rect.height / 2);
        const nextPan = clampPan(
          curPan.x + (ox / baseScale) * (1 / nextZoom - 1 / curZoom),
          curPan.y + (oy / baseScale) * (1 / nextZoom - 1 / curZoom)
        );

        zoomRef.current = nextZoom;
        panRef.current = nextPan;
        onZoomRef.current(nextZoom);
        onPanRef.current(nextPan);
        return;
      }

      // 2-finger trackpad pan (horizontal + vertical)
      const dx = rawDx === 0 && e.shiftKey ? rawDy : rawDx;
      const dy = rawDx === 0 && e.shiftKey ? 0 : rawDy;
      if (dx === 0 && dy === 0) return;

      const nextPan = clampPan(curPan.x - dx / scale, curPan.y - dy / scale);
      panRef.current = nextPan;
      onPanRef.current(nextPan);
    };

    svg.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      svg.removeEventListener('wheel', handleNativeWheel);
    };
  }, [svgRef, width, height, minZoom, maxZoom]);
}
