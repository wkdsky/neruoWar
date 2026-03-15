import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import './TransitionGhostLayer.css';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (start, end, t) => start + (end - start) * t;

const easeInOutCubic = (t) => (
  t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
);

const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

const HEX_POINTS = [
  [50, 0],
  [74.5, 12.5],
  [100, 25],
  [100, 50],
  [100, 75],
  [74.5, 87.5],
  [50, 100],
  [25.5, 87.5],
  [0, 75],
  [0, 50],
  [0, 25],
  [25.5, 12.5]
];

const CIRCLE_POINTS = [
  [50, 0],
  [75, 6.7],
  [93.3, 25],
  [100, 50],
  [93.3, 75],
  [75, 93.3],
  [50, 100],
  [25, 93.3],
  [6.7, 75],
  [0, 50],
  [6.7, 25],
  [25, 6.7]
];

const toPath = (points = []) => {
  if (points.length < 2) return '';
  return points.reduce((result, point, index) => {
    const [x, y] = point;
    if (index === 0) return `M ${x} ${y}`;
    return `${result} L ${x} ${y}`;
  }, '') + ' Z';
};

const buildMorphPath = (morph = 0) => {
  const t = clamp(morph, 0, 1);
  return toPath(HEX_POINTS.map(([hx, hy], index) => {
    const [cx, cy] = CIRCLE_POINTS[index];
    return [mix(hx, cx, t), mix(hy, cy, t)];
  }));
};

const resolvePalette = (variant = 'root') => {
  if (variant === 'featured') {
    return {
      glow: '#ffd18a',
      rim: '#fff0d1',
      shellStart: '#9d6a2f',
      shellMid: '#6a4421',
      shellEnd: '#2f1c0f',
      faceTop: 'rgba(255, 247, 232, 0.3)',
      faceBottom: 'rgba(15, 8, 3, 0.18)',
      text: '#fff7e8',
      subText: 'rgba(255, 232, 205, 0.88)'
    };
  }

  return {
    glow: '#98e6ff',
    rim: '#f3fbff',
    shellStart: '#5d84af',
    shellMid: '#334b68',
    shellEnd: '#121d2b',
    faceTop: 'rgba(225, 245, 255, 0.28)',
    faceBottom: 'rgba(5, 11, 18, 0.2)',
    text: '#eff8ff',
    subText: 'rgba(214, 231, 247, 0.86)'
  };
};

const TransitionGhostLayer = ({
  transition,
  onStatusChange,
  onSettleProgress,
  onSettleComplete
}) => {
  const gradientId = useId().replace(/:/g, '');
  const requestRef = useRef(0);
  const lastRunIdRef = useRef(0);
  const [travelProgress, setTravelProgress] = useState(0);

  useEffect(() => () => {
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
    }
  }, []);

  useEffect(() => {
    const status = transition?.status || 'idle';
    const runId = Number(transition?.runId) || 0;

    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = 0;
    }

    if (!transition || status === 'idle' || status === 'done') {
      setTravelProgress(0);
      lastRunIdRef.current = 0;
      return undefined;
    }

    if (runId !== lastRunIdRef.current) {
      setTravelProgress(0);
      lastRunIdRef.current = runId;
    }

    if (status !== 'target-ready' && status !== 'settling') {
      return undefined;
    }

    const startTime = performance.now();
    const duration = 860;
    if (typeof onStatusChange === 'function') {
      onStatusChange(runId, 'settling');
    }

    const animate = (now) => {
      const raw = clamp((now - startTime) / duration, 0, 1);
      const eased = easeInOutCubic(raw);
      setTravelProgress(eased);
      if (typeof onSettleProgress === 'function') {
        onSettleProgress(runId, eased);
      }
      if (raw < 1) {
        requestRef.current = requestAnimationFrame(animate);
      } else if (typeof onSettleComplete === 'function') {
        onSettleComplete(runId);
      }
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = 0;
      }
    };
  }, [onSettleComplete, onSettleProgress, onStatusChange, transition]);

  const status = transition?.status || 'idle';
  const shouldRender = transition
    && transition.sourceRect
    && (status === 'navigating' || status === 'target-ready' || status === 'settling');

  const frame = useMemo(() => {
    if (!shouldRender) return null;
    const progress = status === 'navigating' ? 0 : travelProgress;
    const sourceRect = transition.sourceRect || {};
    const sourceCenter = transition.sourceCenter || {
      x: (sourceRect.left || 0) + (sourceRect.width || 0) * 0.5,
      y: (sourceRect.top || 0) + (sourceRect.height || 0) * 0.5
    };
    const targetCenter = transition.targetCenter || sourceCenter;
    const sourceWidth = Math.max(96, Number(sourceRect.width) || Number(transition.sourceSize?.width) || 140);
    const sourceHeight = Math.max(108, Number(sourceRect.height) || Number(transition.sourceSize?.height) || 162);
    const targetSize = Math.max(104, Number(transition.targetSize) || 156);
    const easedMove = status === 'navigating' ? 0 : easeOutQuint(progress);
    const currentCenterX = mix(sourceCenter.x, targetCenter.x, easedMove);
    const currentCenterY = mix(sourceCenter.y, targetCenter.y, easedMove);
    const currentWidth = mix(sourceWidth, targetSize, easedMove);
    const currentHeight = mix(sourceHeight, targetSize, easedMove);
    const morph = mix(0, 1, clamp(progress * 1.06, 0, 1));
    const titleOpacity = 1 - clamp((progress - 0.42) / 0.4, 0, 1);
    const senseOpacity = 1 - clamp((progress - 0.26) / 0.26, 0, 1);
    const summaryOpacity = 1 - clamp((progress - 0.14) / 0.18, 0, 1);
    const chromeOpacity = 1 - clamp((progress - 0.68) / 0.2, 0, 1);
    const bloomScale = mix(1.04, 1.3, clamp(progress, 0, 1));
    const glowOpacity = mix(0.42, 0.18, clamp(progress, 0, 1));

    return {
      left: currentCenterX - currentWidth * 0.5,
      top: currentCenterY - currentHeight * 0.5,
      width: currentWidth,
      height: currentHeight,
      morph,
      progress,
      titleOpacity,
      senseOpacity,
      summaryOpacity,
      chromeOpacity,
      bloomScale,
      glowOpacity
    };
  }, [shouldRender, status, transition, travelProgress]);

  const palette = useMemo(() => resolvePalette(transition?.sourceVariant), [transition?.sourceVariant]);
  const pathD = useMemo(() => buildMorphPath(frame?.morph || 0), [frame?.morph]);

  if (!shouldRender || !frame) return null;

  return (
    <div className="transition-ghost-layer" aria-hidden="true">
      <div
        className={`transition-ghost transition-ghost--${transition?.sourceVariant || 'root'} transition-ghost--${status}`}
        style={{
          left: `${frame.left}px`,
          top: `${frame.top}px`,
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          '--ghost-title-opacity': frame.titleOpacity,
          '--ghost-sense-opacity': frame.senseOpacity,
          '--ghost-summary-opacity': frame.summaryOpacity,
          '--ghost-chrome-opacity': frame.chromeOpacity,
          '--ghost-glow-opacity': frame.glowOpacity
        }}
      >
        <svg className="transition-ghost__svg" viewBox="0 0 100 100" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`${gradientId}-shell`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={palette.shellStart} />
              <stop offset="38%" stopColor={palette.shellMid} />
              <stop offset="100%" stopColor={palette.shellEnd} />
            </linearGradient>
            <linearGradient id={`${gradientId}-face`} x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" stopColor={palette.faceTop} />
              <stop offset="100%" stopColor={palette.faceBottom} />
            </linearGradient>
            <radialGradient id={`${gradientId}-core`} cx="50%" cy="30%" r="68%">
              <stop offset="0%" stopColor={palette.glow} stopOpacity="0.52" />
              <stop offset="48%" stopColor={palette.glow} stopOpacity="0.1" />
              <stop offset="100%" stopColor={palette.glow} stopOpacity="0" />
            </radialGradient>
            <filter id={`${gradientId}-blur`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3.6" />
            </filter>
          </defs>

          <g transform={`scale(${frame.bloomScale}) translate(${((1 - frame.bloomScale) * 50) / frame.bloomScale} ${((1 - frame.bloomScale) * 50) / frame.bloomScale})`}>
            <path
              d={pathD}
              className="transition-ghost__glow"
              fill={`url(#${gradientId}-core)`}
              filter={`url(#${gradientId}-blur)`}
            />
          </g>
          <path d={pathD} className="transition-ghost__shell" fill={`url(#${gradientId}-shell)`} />
          <path d={pathD} className="transition-ghost__face" fill={`url(#${gradientId}-face)`} />
          <path d={pathD} className="transition-ghost__rim" fill="none" stroke={palette.rim} strokeWidth="1.35" strokeOpacity="0.82" />
          <path d={pathD} className="transition-ghost__edge-highlight" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="0.74" strokeLinecap="round" />
        </svg>

        <div className="transition-ghost__content">
          <div className="transition-ghost__eyebrow">
            {transition?.sourceVariant === 'featured' ? 'Curated Domain' : 'Knowledge Root'}
          </div>
          <div
            className="transition-ghost__title"
            style={{ color: palette.text }}
          >
            {transition?.sourceTitle || '未命名知识域'}
          </div>
          {transition?.sourceSenseTitle ? (
            <div
              className="transition-ghost__sense"
              style={{ color: palette.subText }}
            >
              {transition.sourceSenseTitle}
            </div>
          ) : null}
          {transition?.sourceSummary ? (
            <div
              className="transition-ghost__summary"
              style={{ color: palette.subText }}
            >
              {transition.sourceSummary}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default TransitionGhostLayer;
