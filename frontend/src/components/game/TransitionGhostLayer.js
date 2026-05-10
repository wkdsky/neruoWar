import React, { useEffect, useMemo, useRef, useState } from 'react';
import './TransitionGhostLayer.css';

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const mix = (start, end, t) => start + (end - start) * t;

const easeInOutCubic = (t) => (
  t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2
);

const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

const resolvePalette = (variant = 'root') => {
  if (variant === 'featured') {
    return {
      glow: 'rgba(255, 209, 138, 0.9)',
      glowShadow: 'rgba(255, 191, 102, 0.3)',
      rim: 'rgba(255, 240, 209, 0.74)',
      ring: 'rgba(255, 217, 160, 0.34)',
      core: 'rgba(255, 249, 236, 0.82)',
      halo: 'rgba(255, 188, 94, 0.28)',
      backdropCore: 'rgba(255, 196, 122, 0.11)',
      backdropEdge: 'rgba(10, 7, 3, 0.28)',
      trailCore: 'rgba(255, 241, 214, 0.94)',
      trailEdge: 'rgba(255, 193, 96, 0)'
    };
  }

  return {
    glow: 'rgba(152, 230, 255, 0.88)',
    glowShadow: 'rgba(116, 205, 255, 0.28)',
    rim: 'rgba(243, 251, 255, 0.72)',
    ring: 'rgba(170, 226, 255, 0.32)',
    core: 'rgba(239, 248, 255, 0.82)',
    halo: 'rgba(124, 196, 255, 0.26)',
    backdropCore: 'rgba(118, 196, 255, 0.1)',
    backdropEdge: 'rgba(4, 10, 18, 0.26)',
    trailCore: 'rgba(226, 247, 255, 0.92)',
    trailEdge: 'rgba(102, 186, 245, 0)'
  };
};

const TransitionGhostLayer = ({
  transition,
  onStatusChange,
  onSettleProgress,
  onSettleComplete
}) => {
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

    const sourceRect = transition.sourceRect || {};
    const sourceCenter = transition.sourceCenter || {
      x: (sourceRect.left || 0) + (sourceRect.width || 0) * 0.5,
      y: (sourceRect.top || 0) + (sourceRect.height || 0) * 0.5
    };
    const targetCenter = transition.targetCenter || sourceCenter;
    const sourceWidth = Math.max(96, Number(sourceRect.width) || Number(transition.sourceSize?.width) || 140);
    const sourceHeight = Math.max(108, Number(sourceRect.height) || Number(transition.sourceSize?.height) || 162);
    const sourceSize = Math.max(sourceWidth, sourceHeight);
    const targetSize = Math.max(112, Number(transition.targetSize) || 156);
    const progress = status === 'navigating' ? 0 : travelProgress;
    const moveProgress = status === 'navigating' ? 0 : easeOutQuint(progress);
    const focusX = mix(sourceCenter.x, targetCenter.x, moveProgress);
    const focusY = mix(sourceCenter.y, targetCenter.y, moveProgress);
    const focusSize = mix(sourceSize * 1.02, targetSize * 1.08, moveProgress);
    const focusScale = status === 'navigating' ? 1 : mix(1.04, 0.9, progress);
    const sourceEchoSize = mix(sourceSize * 1.1, sourceSize * 1.46, progress);
    const sourceEchoOpacity = status === 'navigating' ? 0.4 : mix(0.34, 0, progress);
    const targetLockSize = mix(sourceSize * 0.74, targetSize * 1.24, progress);
    const targetLockOpacity = status === 'navigating'
      ? 0
      : clamp((progress - 0.12) / 0.24, 0, 1) * 0.82;
    const backdropOpacity = status === 'navigating' ? 0.04 : mix(0.06, 0, progress);
    const focusOpacity = status === 'navigating' ? 0.88 : mix(0.84, 0.28, progress);
    const focusGlowOpacity = status === 'navigating' ? 0.34 : mix(0.32, 0.12, progress);
    const trailLength = Math.max(
      0,
      Math.hypot(focusX - sourceCenter.x, focusY - sourceCenter.y) - focusSize * 0.28
    );
    const trailAngle = Math.atan2(focusY - sourceCenter.y, focusX - sourceCenter.x) * 180 / Math.PI;
    const trailOpacity = status === 'navigating' ? 0 : mix(0.68, 0.06, progress);

    return {
      sourceCenter,
      targetCenter,
      focusX,
      focusY,
      focusSize,
      focusScale,
      sourceEchoSize,
      sourceEchoOpacity,
      targetLockSize,
      targetLockOpacity,
      backdropOpacity,
      focusOpacity,
      focusGlowOpacity,
      trailLength,
      trailAngle,
      trailOpacity
    };
  }, [shouldRender, status, transition, travelProgress]);

  const palette = useMemo(
    () => resolvePalette(transition?.sourceVariant),
    [transition?.sourceVariant]
  );

  const backdropStyle = useMemo(() => {
    if (!frame) return null;
    const focusRadius = Math.round(frame.focusSize * 0.68);
    const outerRadius = Math.round(frame.focusSize * 3.4);
    return {
      opacity: frame.backdropOpacity,
      background: `radial-gradient(circle at ${Math.round(frame.focusX)}px ${Math.round(frame.focusY)}px, ${palette.backdropCore} 0px, ${palette.backdropEdge} ${focusRadius}px, rgba(3, 7, 13, 0.82) ${outerRadius}px, rgba(2, 4, 8, 0.9) 100%)`
    };
  }, [frame, palette.backdropCore, palette.backdropEdge]);

  if (!shouldRender || !frame) return null;

  return (
    <div className="transition-ghost-layer" aria-hidden="true">
      <div className="transition-ghost-backdrop" style={backdropStyle} />
      <div
        className={`transition-ghost-anchor transition-ghost-anchor--${status}`}
        style={{
          left: `${frame.sourceCenter.x}px`,
          top: `${frame.sourceCenter.y}px`,
          width: `${frame.sourceEchoSize}px`,
          height: `${frame.sourceEchoSize}px`,
          opacity: frame.sourceEchoOpacity,
          borderColor: palette.ring,
          boxShadow: `0 0 0 1px ${palette.ring} inset, 0 0 42px ${palette.glowShadow}`,
          background: `radial-gradient(circle, ${palette.halo} 0%, rgba(255,255,255,0) 72%)`
        }}
      />
      {frame.trailLength > 0 ? (
        <div
          className={`transition-ghost-trail transition-ghost-trail--${status}`}
          style={{
            left: `${frame.sourceCenter.x}px`,
            top: `${frame.sourceCenter.y}px`,
            width: `${frame.trailLength}px`,
            opacity: frame.trailOpacity,
            transform: `translateY(-50%) rotate(${frame.trailAngle}deg)`,
            background: `linear-gradient(90deg, ${palette.trailCore} 0%, ${palette.glow} 36%, ${palette.trailEdge} 100%)`
          }}
        />
      ) : null}
      <div
        className={`transition-ghost-focus transition-ghost-focus--${status}`}
        style={{
          left: `${frame.focusX}px`,
          top: `${frame.focusY}px`,
          width: `${frame.focusSize}px`,
          height: `${frame.focusSize}px`,
          opacity: frame.focusOpacity,
          transform: `translate(-50%, -50%) scale(${frame.focusScale})`,
          borderColor: palette.rim,
          boxShadow: `0 0 0 1px ${palette.ring} inset, 0 18px 48px rgba(3, 8, 16, 0.26), 0 0 56px ${palette.glowShadow}`,
          background: `radial-gradient(circle at 50% 42%, ${palette.core} 0%, ${palette.halo} 42%, rgba(255,255,255,0) 74%)`,
          '--ghost-focus-glow-opacity': frame.focusGlowOpacity
        }}
      />
      {status !== 'navigating' ? (
        <div
          className="transition-ghost-target-lock"
          style={{
            left: `${frame.targetCenter.x}px`,
            top: `${frame.targetCenter.y}px`,
            width: `${frame.targetLockSize}px`,
            height: `${frame.targetLockSize}px`,
            opacity: frame.targetLockOpacity,
            borderColor: palette.ring,
            boxShadow: `0 0 0 1px ${palette.ring} inset, 0 0 26px ${palette.glowShadow}`,
            background: `radial-gradient(circle, ${palette.halo} 0%, rgba(255,255,255,0) 78%)`
          }}
        />
      ) : null}
    </div>
  );
};

export default TransitionGhostLayer;
