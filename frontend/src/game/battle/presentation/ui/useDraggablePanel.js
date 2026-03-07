import { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isInteractiveTarget = (target) => {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('button, input, textarea, select, a, [data-no-drag]');
};

const resolveViewport = () => ({
  width: Math.max(320, Number(window?.innerWidth) || 0),
  height: Math.max(240, Number(window?.innerHeight) || 0)
});

const clampToViewport = (x, y, panelWidth, panelHeight, margin = 8) => {
  const viewport = resolveViewport();
  const safeMargin = Math.max(0, Number(margin) || 0);
  const width = Math.max(120, Number(panelWidth) || 120);
  const height = Math.max(80, Number(panelHeight) || 80);
  const maxX = Math.max(safeMargin, viewport.width - width - safeMargin);
  const maxY = Math.max(safeMargin, viewport.height - height - safeMargin);
  return {
    x: clamp(Number(x) || 0, safeMargin, maxX),
    y: clamp(Number(y) || 0, safeMargin, maxY)
  };
};

export default function useDraggablePanel({
  open = false,
  initialPosition = null,
  margin = 8,
  defaultSize = { width: 420, height: 320 }
} = {}) {
  const panelRef = useRef(null);
  const movedRef = useRef(false);
  const [position, setPosition] = useState(null);

  const clampPosition = useCallback((x, y) => {
    const panelRect = panelRef.current?.getBoundingClientRect();
    const fallbackW = Math.max(120, Number(defaultSize?.width) || 420);
    const fallbackH = Math.max(80, Number(defaultSize?.height) || 320);
    return clampToViewport(
      x,
      y,
      panelRect?.width || fallbackW,
      panelRect?.height || fallbackH,
      margin
    );
  }, [defaultSize, margin]);

  const placeAt = useCallback((x, y) => {
    const next = clampPosition(x, y);
    setPosition(next);
    return next;
  }, [clampPosition]);

  useEffect(() => {
    if (!open) {
      movedRef.current = false;
      setPosition(null);
      return;
    }
    const anchorX = Number(initialPosition?.x);
    const anchorY = Number(initialPosition?.y);
    const rafId = requestAnimationFrame(() => {
      if (movedRef.current) return;
      if (Number.isFinite(anchorX) && Number.isFinite(anchorY)) {
        placeAt(anchorX, anchorY);
        return;
      }
      const panelRect = panelRef.current?.getBoundingClientRect();
      const fallbackW = Math.max(120, Number(defaultSize?.width) || 420);
      const fallbackH = Math.max(80, Number(defaultSize?.height) || 320);
      const width = panelRect?.width || fallbackW;
      const height = panelRect?.height || fallbackH;
      const viewport = resolveViewport();
      placeAt(
        (viewport.width - width) * 0.5,
        Math.max(margin, (viewport.height - height) * 0.5)
      );
    });
    return () => cancelAnimationFrame(rafId);
  }, [defaultSize, initialPosition?.x, initialPosition?.y, margin, open, placeAt]);

  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      setPosition((prev) => {
        if (!prev) return prev;
        return clampPosition(prev.x, prev.y);
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPosition, open]);

  const handleHeaderPointerDown = useCallback((event) => {
    if (!open) return;
    if ((event.button ?? 0) !== 0) return;
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();

    movedRef.current = true;
    const panelRect = panelRef.current?.getBoundingClientRect();
    const originX = Number(position?.x);
    const originY = Number(position?.y);
    const startPos = {
      x: Number.isFinite(originX) ? originX : (panelRect?.left || margin),
      y: Number.isFinite(originY) ? originY : (panelRect?.top || margin)
    };
    const startClientX = Number(event.clientX) || 0;
    const startClientY = Number(event.clientY) || 0;

    const move = (moveEvent) => {
      moveEvent.preventDefault();
      const dx = (Number(moveEvent.clientX) || 0) - startClientX;
      const dy = (Number(moveEvent.clientY) || 0) - startClientY;
      setPosition(clampPosition(startPos.x + dx, startPos.y + dy));
    };

    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, [clampPosition, margin, open, position?.x, position?.y]);

  return {
    panelRef,
    panelStyle: position
      ? { left: `${Math.round(position.x)}px`, top: `${Math.round(position.y)}px` }
      : { visibility: 'hidden' },
    handleHeaderPointerDown
  };
}
