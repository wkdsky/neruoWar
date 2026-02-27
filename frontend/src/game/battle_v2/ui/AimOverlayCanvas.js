import React, { useEffect, useRef } from 'react';

const AimOverlayCanvas = ({
  width,
  height,
  worldToScreen,
  selectedSquad,
  aimState,
  waypoints = []
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !worldToScreen) return;
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawCircle = (center, radius, stroke, fill = '') => {
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(1, radius), 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    };

    if (selectedSquad) {
      const center = worldToScreen({ x: selectedSquad.x, y: selectedSquad.y, z: 0 });
      if (center?.visible) {
        drawCircle(center, 12, 'rgba(250, 204, 21, 0.95)', 'rgba(250, 204, 21, 0.12)');
      }

      if (Array.isArray(waypoints) && waypoints.length > 0) {
        let prev = center;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        waypoints.forEach((point) => {
          const next = worldToScreen({ x: point.x, y: point.y, z: 0 });
          if (!next?.visible) return;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
          drawCircle(next, 4, 'rgba(56, 189, 248, 0.9)', 'rgba(56, 189, 248, 0.25)');
          prev = next;
        });
        ctx.setLineDash([]);
      }
    }

    if (aimState?.active && aimState?.point) {
      const center = worldToScreen({ x: aimState.point.x, y: aimState.point.y, z: 0 });
      if (center?.visible) {
        drawCircle(center, Math.max(8, Number(aimState.radiusPx) || 24), 'rgba(248, 113, 113, 0.95)', 'rgba(248, 113, 113, 0.16)');
      }
    }
  }, [width, height, worldToScreen, selectedSquad, aimState, waypoints]);

  return <canvas ref={canvasRef} className="pve2-overlay-canvas" />;
};

export default AimOverlayCanvas;
