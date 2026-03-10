import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_PREVIEW_WIDTH_PCT = 36;
const MIN_PREVIEW_WIDTH_PCT = 30;
const MAX_PREVIEW_WIDTH_PCT = 70;
const DESKTOP_PREVIEW_MEDIA_QUERY = '(min-width: 1081px)';
const PREVIEW_PANE_STORAGE_KEY = 'sense-article-editor.preview-pane.v2';
const LEGACY_PREVIEW_PANE_STORAGE_KEY = 'sense-article-editor.preview-pane.v1';
const PREVIEW_RESIZE_BODY_CLASS = 'sense-editor-preview-resizing';

const clampPreviewWidthPct = (value) => {
  const numericValue = Number.parseFloat(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_PREVIEW_WIDTH_PCT;
  return Math.min(MAX_PREVIEW_WIDTH_PCT, Math.max(MIN_PREVIEW_WIDTH_PCT, numericValue));
};

const readPreviewPanePayload = (storageKey) => {
  if (typeof window === 'undefined') return null;
  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) return null;
  return JSON.parse(rawValue);
};

const readStoredPreviewPaneState = () => {
  const fallbackState = {
    previewPaneWidthPct: DEFAULT_PREVIEW_WIDTH_PCT,
    isPreviewCollapsed: false,
    lastExpandedPreviewWidthPct: DEFAULT_PREVIEW_WIDTH_PCT
  };

  if (typeof window === 'undefined') return fallbackState;

  try {
    const parsedValue = readPreviewPanePayload(PREVIEW_PANE_STORAGE_KEY) || readPreviewPanePayload(LEGACY_PREVIEW_PANE_STORAGE_KEY);
    if (!parsedValue) return fallbackState;

    const previewPaneWidthPct = clampPreviewWidthPct(
      parsedValue?.previewPaneWidthPct
        ?? parsedValue?.widthPct
        ?? DEFAULT_PREVIEW_WIDTH_PCT
    );
    const lastExpandedPreviewWidthPct = clampPreviewWidthPct(
      parsedValue?.lastExpandedPreviewWidthPct
        ?? parsedValue?.expandedWidthPct
        ?? previewPaneWidthPct
    );

    return {
      previewPaneWidthPct,
      isPreviewCollapsed: Boolean(parsedValue?.isPreviewCollapsed ?? parsedValue?.collapsed),
      lastExpandedPreviewWidthPct
    };
  } catch (_error) {
    return fallbackState;
  }
};

const getDesktopResizableState = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DESKTOP_PREVIEW_MEDIA_QUERY).matches;
};

const resolveExpandedWidth = (lastExpandedPreviewWidthPct, previewPaneWidthPct) => clampPreviewWidthPct(
  lastExpandedPreviewWidthPct || previewPaneWidthPct || DEFAULT_PREVIEW_WIDTH_PCT
);

const buildLayoutClassName = ({ isPreviewCollapsed, isResizingPreview, isDesktopResizable }) => {
  const classNames = ['sense-editor-layout', 'resizable'];
  classNames.push(isDesktopResizable ? 'preview-desktop' : 'preview-stacked');
  if (isPreviewCollapsed) classNames.push('preview-collapsed');
  if (isResizingPreview) classNames.push('preview-resizing');
  return classNames.join(' ');
};

export const useSenseEditorPreviewPane = ({ layoutRef }) => {
  const initialStateRef = useRef(readStoredPreviewPaneState());
  const [previewPaneWidthPct, setPreviewPaneWidthPct] = useState(initialStateRef.current.previewPaneWidthPct);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(initialStateRef.current.isPreviewCollapsed);
  const [isPreviewBodyMounted, setIsPreviewBodyMounted] = useState(!initialStateRef.current.isPreviewCollapsed);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [lastExpandedPreviewWidthPct, setLastExpandedPreviewWidthPct] = useState(initialStateRef.current.lastExpandedPreviewWidthPct);
  const [isDesktopResizable, setIsDesktopResizable] = useState(getDesktopResizableState);
  const [previewVisibilityPhase, setPreviewVisibilityPhase] = useState(initialStateRef.current.isPreviewCollapsed ? 'collapsed' : 'expanded');
  const dragStateRef = useRef(null);
  const pendingWidthPctRef = useRef(null);
  const resizeAnimationFrameRef = useRef(0);
  const collapseFrameRef = useRef(0);
  const expandFrameRef = useRef(0);

  const syncBodyResizeState = useCallback((active) => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle(PREVIEW_RESIZE_BODY_CLASS, active);
  }, []);

  const cancelScheduledPhaseWork = useCallback(() => {
    if (collapseFrameRef.current) {
      window.cancelAnimationFrame(collapseFrameRef.current);
      collapseFrameRef.current = 0;
    }
    if (expandFrameRef.current) {
      window.cancelAnimationFrame(expandFrameRef.current);
      expandFrameRef.current = 0;
    }
  }, []);

  const commitPreviewWidth = useCallback((nextWidthPct) => {
    const clampedWidthPct = clampPreviewWidthPct(nextWidthPct);
    setPreviewPaneWidthPct((previousWidthPct) => (
      previousWidthPct === clampedWidthPct ? previousWidthPct : clampedWidthPct
    ));
    setLastExpandedPreviewWidthPct((previousWidthPct) => (
      previousWidthPct === clampedWidthPct ? previousWidthPct : clampedWidthPct
    ));
  }, []);

  const flushPendingResizeWidth = useCallback(() => {
    if (resizeAnimationFrameRef.current) {
      window.cancelAnimationFrame(resizeAnimationFrameRef.current);
      resizeAnimationFrameRef.current = 0;
    }
    if (typeof pendingWidthPctRef.current === 'number') {
      commitPreviewWidth(pendingWidthPctRef.current);
      pendingWidthPctRef.current = null;
    }
  }, [commitPreviewWidth]);

  const stopPreviewResize = useCallback(() => {
    flushPendingResizeWidth();
    dragStateRef.current = null;
    setIsResizingPreview(false);
    syncBodyResizeState(false);
  }, [flushPendingResizeWidth, syncBodyResizeState]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mediaQueryList = window.matchMedia(DESKTOP_PREVIEW_MEDIA_QUERY);
    const handleChange = (event) => {
      setIsDesktopResizable(event.matches);
    };

    setIsDesktopResizable(mediaQueryList.matches);
    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange);
      return () => mediaQueryList.removeEventListener('change', handleChange);
    }

    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (!isResizingPreview || isDesktopResizable) return undefined;
    stopPreviewResize();
    return undefined;
  }, [isDesktopResizable, isResizingPreview, stopPreviewResize]);

  useEffect(() => {
    const clampedWidthPct = clampPreviewWidthPct(previewPaneWidthPct);
    if (clampedWidthPct !== previewPaneWidthPct) {
      setPreviewPaneWidthPct(clampedWidthPct);
    }
    const clampedLastExpandedWidthPct = clampPreviewWidthPct(lastExpandedPreviewWidthPct);
    if (clampedLastExpandedWidthPct !== lastExpandedPreviewWidthPct) {
      setLastExpandedPreviewWidthPct(clampedLastExpandedWidthPct);
    }
  }, [lastExpandedPreviewWidthPct, previewPaneWidthPct]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => {
      const clampedWidthPct = clampPreviewWidthPct(previewPaneWidthPct);
      const clampedLastExpandedWidthPct = clampPreviewWidthPct(lastExpandedPreviewWidthPct);
      if (clampedWidthPct !== previewPaneWidthPct) {
        setPreviewPaneWidthPct(clampedWidthPct);
      }
      if (clampedLastExpandedWidthPct !== lastExpandedPreviewWidthPct) {
        setLastExpandedPreviewWidthPct(clampedLastExpandedWidthPct);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [lastExpandedPreviewWidthPct, previewPaneWidthPct]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const storedValue = JSON.stringify({
      previewPaneWidthPct: clampPreviewWidthPct(previewPaneWidthPct),
      isPreviewCollapsed: Boolean(isPreviewCollapsed),
      lastExpandedPreviewWidthPct: clampPreviewWidthPct(lastExpandedPreviewWidthPct)
    });
    window.localStorage.setItem(PREVIEW_PANE_STORAGE_KEY, storedValue);
    return undefined;
  }, [isPreviewCollapsed, lastExpandedPreviewWidthPct, previewPaneWidthPct]);

  useEffect(() => () => {
    cancelScheduledPhaseWork();
    stopPreviewResize();
  }, [cancelScheduledPhaseWork, stopPreviewResize]);

  const collapsePreviewPane = useCallback(() => {
    cancelScheduledPhaseWork();
    stopPreviewResize();

    const rememberedWidthPct = clampPreviewWidthPct(previewPaneWidthPct || lastExpandedPreviewWidthPct);
    if (rememberedWidthPct !== lastExpandedPreviewWidthPct) {
      setLastExpandedPreviewWidthPct(rememberedWidthPct);
    }

    setPreviewVisibilityPhase('collapsing');
    setIsPreviewBodyMounted(false);
    collapseFrameRef.current = window.requestAnimationFrame(() => {
      collapseFrameRef.current = 0;
      setIsPreviewCollapsed(true);
      setPreviewVisibilityPhase('collapsed');
    });
  }, [cancelScheduledPhaseWork, lastExpandedPreviewWidthPct, previewPaneWidthPct, stopPreviewResize]);

  const expandPreviewPane = useCallback(() => {
    cancelScheduledPhaseWork();
    stopPreviewResize();

    const restoredWidthPct = resolveExpandedWidth(lastExpandedPreviewWidthPct, previewPaneWidthPct);
    if (restoredWidthPct !== previewPaneWidthPct) {
      commitPreviewWidth(restoredWidthPct);
    }
    setIsPreviewCollapsed(false);
    setPreviewVisibilityPhase('expanding');
    expandFrameRef.current = window.requestAnimationFrame(() => {
      expandFrameRef.current = 0;
      startTransition(() => {
        setIsPreviewBodyMounted(true);
        setPreviewVisibilityPhase('expanded');
      });
    });
  }, [cancelScheduledPhaseWork, commitPreviewWidth, lastExpandedPreviewWidthPct, previewPaneWidthPct, stopPreviewResize]);

  const togglePreviewCollapsed = useCallback(() => {
    const isCollapsedLike = isPreviewCollapsed || previewVisibilityPhase === 'collapsing';
    if (isCollapsedLike) {
      expandPreviewPane();
      return;
    }
    collapsePreviewPane();
  }, [collapsePreviewPane, expandPreviewPane, isPreviewCollapsed, previewVisibilityPhase]);

  const handleResizePointerDown = useCallback((event) => {
    if (!isDesktopResizable || isPreviewCollapsed || previewVisibilityPhase !== 'expanded' || event.button !== 0) return;
    const layoutElement = layoutRef?.current;
    if (!layoutElement) return;

    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId
    };
    pendingWidthPctRef.current = null;
    setIsResizingPreview(true);
    syncBodyResizeState(true);

    if (typeof event.currentTarget?.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Ignore capture failures and keep the resize state machine stable.
      }
    }
  }, [isDesktopResizable, isPreviewCollapsed, layoutRef, previewVisibilityPhase, syncBodyResizeState]);

  const handleResizePointerMove = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const layoutElement = layoutRef?.current;
    if (!layoutElement) return;

    const layoutRect = layoutElement.getBoundingClientRect();
    if (layoutRect.width <= 0) return;

    event.preventDefault();
    pendingWidthPctRef.current = clampPreviewWidthPct(((layoutRect.right - event.clientX) / layoutRect.width) * 100);

    if (resizeAnimationFrameRef.current) return;
    resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
      resizeAnimationFrameRef.current = 0;
      if (typeof pendingWidthPctRef.current === 'number') {
        commitPreviewWidth(pendingWidthPctRef.current);
        pendingWidthPctRef.current = null;
      }
    });
  }, [commitPreviewWidth, layoutRef]);

  const handleResizePointerEnd = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (typeof event.currentTarget?.hasPointerCapture === 'function' && event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (_error) {
        // Ignore release failures and let lostpointercapture finish cleanup.
      }
    }

    stopPreviewResize();
  }, [stopPreviewResize]);

  const handleResizeLostPointerCapture = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    stopPreviewResize();
  }, [stopPreviewResize]);

  const layoutClassName = useMemo(() => buildLayoutClassName({
    isPreviewCollapsed,
    isResizingPreview,
    isDesktopResizable
  }), [isDesktopResizable, isPreviewCollapsed, isResizingPreview]);

  const layoutStyle = useMemo(() => ({
    '--sense-editor-preview-width': `${clampPreviewWidthPct(previewPaneWidthPct)}%`
  }), [previewPaneWidthPct]);

  const resizeHandleProps = useMemo(() => ({
    onPointerDown: handleResizePointerDown,
    onPointerMove: handleResizePointerMove,
    onPointerUp: handleResizePointerEnd,
    onPointerCancel: handleResizePointerEnd,
    onLostPointerCapture: handleResizeLostPointerCapture
  }), [
    handleResizeLostPointerCapture,
    handleResizePointerDown,
    handleResizePointerEnd,
    handleResizePointerMove
  ]);

  return {
    previewPaneWidthPct,
    isPreviewCollapsed,
    isPreviewBodyMounted,
    isResizingPreview,
    lastExpandedPreviewWidthPct,
    isDesktopResizable,
    previewVisibilityPhase,
    layoutClassName,
    layoutStyle,
    dividerClassName: `sense-editor-divider${isResizingPreview ? ' dragging' : ''}`,
    previewPaneClassName: `sense-editor-pane preview preview-phase-${previewVisibilityPhase}${isPreviewCollapsed ? ' collapsed' : ''}`,
    togglePreviewCollapsed,
    resizeHandleProps
  };
};

export const senseEditorPreviewPaneConfig = {
  DEFAULT_PREVIEW_WIDTH_PCT,
  MIN_PREVIEW_WIDTH_PCT,
  MAX_PREVIEW_WIDTH_PCT,
  PREVIEW_PANE_STORAGE_KEY,
  LEGACY_PREVIEW_PANE_STORAGE_KEY
};

export default useSenseEditorPreviewPane;
