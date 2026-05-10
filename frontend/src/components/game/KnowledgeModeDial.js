import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './KnowledgeModeDial.css';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const RAD_TO_DEG = 180 / Math.PI;

const normalizeAngleDelta = (value) => {
  let nextValue = Number(value) || 0;
  while (nextValue > 180) nextValue -= 360;
  while (nextValue < -180) nextValue += 360;
  return nextValue;
};

const createIdleDragState = () => ({
  pointerId: null,
  startAngle: 0,
  moved: false,
  startPoint: { x: 0, y: 0 },
  vector: { x: 0, y: -1 },
  tangent: { x: 1, y: 0 },
  radius: 1,
  travel: 1
});

const KnowledgeModeDial = ({
  mode = 'main',
  isBusy = false,
  isHidden = false,
  variant = 'desktop',
  className = '',
  onRequestMode
}) => {
  const rootRef = useRef(null);
  const dragStateRef = useRef(createIdleDragState());
  const dragDeltaRef = useRef(0);
  const ignoreClickRef = useRef(false);
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const isMobileVariant = variant === 'mobile';
  const isStarMapMode = mode === 'starMap';
  const targetMode = isStarMapMode ? 'main' : 'starMap';
  const expectedDirection = isStarMapMode ? -1 : 1;
  const commitThresholdDeg = isMobileVariant ? 46 : 78;
  const resetDragDeg = isMobileVariant ? 102 : 146;
  const dragActivationThreshold = isMobileVariant ? 2.5 : 4;
  const angleContribution = isMobileVariant ? 0.34 : 0.46;
  const tangentContribution = isMobileVariant ? 0.84 : 0.66;
  const radialResistance = isMobileVariant ? 0.05 : 0.04;
  const baseAngle = isStarMapMode ? 58 : -122;
  const mainLabel = '主视角';
  const starMapLabel = '星盘';

  const readDialMetrics = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      rect,
      centerX: rect.left + rect.width * 0.5,
      centerY: rect.top + rect.height * 0.5,
      radius: Math.max(rect.width, rect.height) * 0.5
    };
  }, []);

  const readPointerAngle = useCallback((event) => {
    const metrics = readDialMetrics();
    if (!metrics) return 0;
    return Math.atan2(event.clientY - metrics.centerY, event.clientX - metrics.centerX) * RAD_TO_DEG;
  }, [readDialMetrics]);

  const resolveAnchorGeometry = useCallback((event) => {
    const metrics = readDialMetrics();
    if (!metrics) return null;

    const deltaX = event.clientX - metrics.centerX;
    const deltaY = event.clientY - metrics.centerY;
    const distance = Math.hypot(deltaX, deltaY);
    const fallbackRadians = baseAngle / RAD_TO_DEG;
    const vectorX = distance > metrics.radius * 0.18 ? deltaX / distance : Math.cos(fallbackRadians);
    const vectorY = distance > metrics.radius * 0.18 ? deltaY / distance : Math.sin(fallbackRadians);

    return {
      startAngle: Math.atan2(vectorY, vectorX) * RAD_TO_DEG,
      vector: { x: vectorX, y: vectorY },
      tangent: { x: -vectorY, y: vectorX },
      radius: Math.max(distance, metrics.radius * (isMobileVariant ? 0.58 : 0.52)),
      travel: isMobileVariant
        ? Math.max(metrics.rect.width * 0.34, 1)
        : Math.max(distance, metrics.radius * 0.52)
    };
  }, [baseAngle, isMobileVariant, readDialMetrics]);

  const resetDrag = useCallback(() => {
    dragStateRef.current = createIdleDragState();
    dragDeltaRef.current = 0;
    setDragDelta(0);
    setIsDragging(false);
  }, []);

  useEffect(() => {
    resetDrag();
  }, [isHidden, mode, resetDrag]);

  const commitTargetMode = useCallback(() => {
    if (isBusy || isHidden || typeof onRequestMode !== 'function') return;
    onRequestMode(targetMode);
  }, [isBusy, isHidden, onRequestMode, targetMode]);

  const finishDrag = useCallback((pointerId, cancelled = false) => {
    const current = dragStateRef.current;
    if (current.pointerId !== pointerId) return;

    if (rootRef.current?.hasPointerCapture?.(pointerId)) {
      rootRef.current.releasePointerCapture(pointerId);
    }

    const directedDelta = expectedDirection * dragDeltaRef.current;
    const shouldCommit = !cancelled && directedDelta >= commitThresholdDeg;
    const shouldIgnoreClick = current.moved || shouldCommit;

    resetDrag();

    if (shouldIgnoreClick) {
      ignoreClickRef.current = true;
      window.setTimeout(() => {
        ignoreClickRef.current = false;
      }, 40);
    }

    if (shouldCommit) {
      commitTargetMode();
    }
  }, [commitTargetMode, commitThresholdDeg, expectedDirection, resetDrag]);

  const handlePointerDown = useCallback((event) => {
    if (isBusy || isHidden || typeof onRequestMode !== 'function') return;
    const anchorGeometry = resolveAnchorGeometry(event);
    if (!anchorGeometry) return;

    event.preventDefault();
    rootRef.current?.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startAngle: anchorGeometry.startAngle,
      moved: false,
      startPoint: { x: event.clientX, y: event.clientY },
      vector: anchorGeometry.vector,
      tangent: anchorGeometry.tangent,
      radius: anchorGeometry.radius,
      travel: anchorGeometry.travel
    };
    dragDeltaRef.current = 0;
    setDragDelta(0);
    setIsDragging(true);
  }, [isBusy, isHidden, onRequestMode, resolveAnchorGeometry]);

  const handlePointerMove = useCallback((event) => {
    const current = dragStateRef.current;
    if (current.pointerId !== event.pointerId) return;

    const moveX = event.clientX - current.startPoint.x;
    const moveY = event.clientY - current.startPoint.y;
    let nextDelta = 0;

    if (isMobileVariant) {
      const horizontalProgress = moveX / Math.max(current.travel, 1);
      const verticalPenalty = Math.min(Math.abs(moveY) / Math.max(current.travel, 1), 0.9);
      nextDelta = clamp(
        horizontalProgress * commitThresholdDeg * 1.14 * (1 - verticalPenalty * 0.24),
        -resetDragDeg,
        resetDragDeg
      );
    } else {
      const nextAngle = readPointerAngle(event);
      const tangentDistance = moveX * current.tangent.x + moveY * current.tangent.y;
      const radialDistance = moveX * current.vector.x + moveY * current.vector.y;
      const angleDelta = normalizeAngleDelta(nextAngle - current.startAngle);
      const tangentDelta = (tangentDistance / Math.max(current.radius, 1)) * RAD_TO_DEG;
      const radialPenalty = (radialDistance / Math.max(current.radius, 1)) * RAD_TO_DEG * radialResistance;
      nextDelta = clamp(
        angleDelta * angleContribution + tangentDelta * tangentContribution - radialPenalty,
        -resetDragDeg,
        resetDragDeg
      );
    }

    if (Math.abs(nextDelta) > dragActivationThreshold || Math.hypot(moveX, moveY) > dragActivationThreshold * 3) {
      dragStateRef.current = {
        ...current,
        moved: true
      };
    }

    dragDeltaRef.current = nextDelta;
    setDragDelta(nextDelta);
  }, [angleContribution, commitThresholdDeg, dragActivationThreshold, isMobileVariant, radialResistance, readPointerAngle, resetDragDeg, tangentContribution]);

  const handlePointerUp = useCallback((event) => {
    finishDrag(event.pointerId, false);
  }, [finishDrag]);

  const handlePointerCancel = useCallback((event) => {
    finishDrag(event.pointerId, true);
  }, [finishDrag]);

  const handleClick = useCallback(() => {
    if (ignoreClickRef.current) {
      ignoreClickRef.current = false;
      return;
    }
    commitTargetMode();
  }, [commitTargetMode]);

  const accent = isStarMapMode
    ? {
      solid: 'rgba(255, 213, 128, 0.96)',
      soft: 'rgba(255, 185, 86, 0.36)',
      glow: 'rgba(255, 215, 150, 0.82)',
      rim: 'rgba(255, 239, 204, 0.8)',
      track: 'rgba(116, 84, 38, 0.52)',
      surface: 'rgba(42, 25, 10, 0.78)'
    }
    : {
      solid: 'rgba(148, 228, 255, 0.96)',
      soft: 'rgba(94, 191, 255, 0.34)',
      glow: 'rgba(206, 244, 255, 0.8)',
      rim: 'rgba(228, 246, 255, 0.78)',
      track: 'rgba(42, 78, 110, 0.5)',
      surface: 'rgba(8, 23, 39, 0.78)'
    };

  const directedProgress = clamp((expectedDirection * dragDelta) / commitThresholdDeg, 0, 1);
  const absoluteProgress = clamp(Math.abs(dragDelta) / commitThresholdDeg, 0, 1);
  const dragRotation = clamp(dragDelta * (isMobileVariant ? 0.66 : 0.74), -102, 102);
  const handleAngle = baseAngle + dragDelta * (isMobileVariant ? 0.94 : 0.88);
  const mobileThumbProgress = isStarMapMode ? (1 - directedProgress) : directedProgress;
  const ringStart = isStarMapMode ? 235 : 55;
  const ringSweep = (isMobileVariant ? 74 : 86) + Math.round(directedProgress * (isMobileVariant ? 164 : 148));
  const ringBackground = `conic-gradient(from ${ringStart}deg, ${accent.solid} 0deg, ${accent.glow} ${ringSweep}deg, rgba(255, 255, 255, 0.12) ${ringSweep}deg, rgba(255, 255, 255, 0.05) 360deg)`;
  const currentLabel = isStarMapMode ? starMapLabel : mainLabel;
  const targetLabel = isStarMapMode ? mainLabel : starMapLabel;
  const detailLabel = isBusy
    ? '切换中'
    : (isDragging ? `松手切到 ${targetLabel}` : `${isMobileVariant ? '点按或轻扫' : '拖拽'}切到 ${targetLabel}`);

  const rootClassName = [
    'knowledge-mode-dial',
    `knowledge-mode-dial--${variant}`,
    isStarMapMode ? 'is-star-map' : 'is-main-view',
    isDragging ? 'is-dragging' : '',
    isBusy ? 'is-busy' : '',
    className
  ].filter(Boolean).join(' ');

  const surfaceStyle = useMemo(() => ({
    '--dial-accent': accent.solid,
    '--dial-accent-soft': accent.soft,
    '--dial-accent-glow': accent.glow,
    '--dial-rim': accent.rim,
    '--dial-track': accent.track,
    '--dial-surface': accent.surface,
    '--dial-handle-angle': `${handleAngle}deg`,
    '--dial-drag-rotation': `${dragRotation}deg`,
    '--dial-drag-progress': absoluteProgress.toFixed(3),
    '--dial-mobile-thumb-progress': mobileThumbProgress.toFixed(3)
  }), [absoluteProgress, accent.glow, accent.rim, accent.soft, accent.solid, accent.surface, accent.track, dragRotation, handleAngle, mobileThumbProgress]);

  if (isMobileVariant) {
    return (
      <button
        ref={rootRef}
        type="button"
        className={rootClassName}
        style={surfaceStyle}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        aria-label={`切换知识视图，当前${currentLabel}，点击切到${targetLabel}`}
        title={`当前${currentLabel}，点击切到${targetLabel}`}
        disabled={isBusy || isHidden}
        tabIndex={isHidden ? -1 : 0}
        aria-hidden={isHidden ? 'true' : undefined}
      >
        <span className="knowledge-mode-dial__mobile-shell">
          <span className="knowledge-mode-dial__mobile-track" aria-hidden="true">
            <span className="knowledge-mode-dial__mobile-option is-main">{mainLabel}</span>
            <span className="knowledge-mode-dial__mobile-option is-star">{starMapLabel}</span>
            <span className="knowledge-mode-dial__mobile-thumb">
              <span className="knowledge-mode-dial__mobile-thumb-dot" />
              <span className="knowledge-mode-dial__mobile-thumb-label">{currentLabel}</span>
            </span>
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      ref={rootRef}
      type="button"
      className={rootClassName}
      style={surfaceStyle}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      aria-label={`切换到${targetLabel}`}
      title={`切换到${targetLabel}`}
      disabled={isBusy || isHidden}
      tabIndex={isHidden ? -1 : 0}
      aria-hidden={isHidden ? 'true' : undefined}
    >
      <span className="knowledge-mode-dial__surface">
        <span className="knowledge-mode-dial__track" />
        <span
          className="knowledge-mode-dial__ring"
          style={{ background: ringBackground }}
        />
        <span className="knowledge-mode-dial__orbit">
          <span className="knowledge-mode-dial__handle" />
        </span>
        <span className="knowledge-mode-dial__core">
          <span className="knowledge-mode-dial__icon-shell" aria-hidden="true">
            <svg className="knowledge-mode-dial__icon" viewBox="0 0 64 64" fill="none">
              <circle cx="22" cy="22" r="4" fill="currentColor" />
              <circle cx="42" cy="19" r="4" fill="currentColor" opacity="0.88" />
              <circle cx="31" cy="41" r="4" fill="currentColor" opacity="0.82" />
              <path
                d="M25.5 22.8L37.8 19.9"
                stroke="currentColor"
                strokeWidth="3.4"
                strokeLinecap="round"
                opacity="0.92"
              />
              <path
                d="M24.1 25L29.1 37.1"
                stroke="currentColor"
                strokeWidth="3.4"
                strokeLinecap="round"
                opacity="0.92"
              />
              <path
                d="M34.7 40.1C39.6 40.3 44 37.4 45.9 32.8"
                stroke="currentColor"
                strokeWidth="3.4"
                strokeLinecap="round"
              />
              <path
                d="M44.2 35.3L46.7 31.4L42.3 30.2"
                stroke="currentColor"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="knowledge-mode-dial__eyebrow">{isMobileVariant ? '视图切换' : '地图切换'}</span>
          <span className="knowledge-mode-dial__title">{currentLabel}</span>
          <span className="knowledge-mode-dial__detail">{detailLabel}</span>
          <span className="knowledge-mode-dial__target-pill" aria-hidden="true">
            {isBusy ? '处理中' : `→ ${targetLabel}`}
          </span>
        </span>
      </span>
    </button>
  );
};

export default KnowledgeModeDial;
