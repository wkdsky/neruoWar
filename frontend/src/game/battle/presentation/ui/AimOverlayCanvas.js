import React, { useEffect, useRef } from 'react';
import { getSkillPaintRemainingRadius } from '../../shared/skillPaintArea';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const AimOverlayCanvas = ({
  width,
  height,
  worldToScreen,
  selectedSquad,
  aimState,
  waypoints = [],
  battleUiMode = 'NONE',
  pendingPathPoints = [],
  planningHoverPoint = null,
  skillConfirmState = null,
  isTrainingMode = false
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

    const toScreen = (x, y, z = 0) => worldToScreen({ x, y, z });

    const drawCircle = (center, radius, stroke, fill = '', lineWidth = 1.4, dash = null) => {
      if (!center || !center.visible) return;
      ctx.beginPath();
      if (dash) ctx.setLineDash(dash);
      ctx.arc(center.x, center.y, Math.max(1, radius), 0, Math.PI * 2);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
    };

    const drawWorldRadiusCircle = (x, y, worldRadius, stroke, fill = '', lineWidth = 1.4, dash = null) => {
      const center = toScreen(x, y, 0);
      if (!center?.visible) return;
      const edge = toScreen(x + Math.max(1, worldRadius), y, 0);
      const radius = edge?.visible ? Math.hypot(edge.x - center.x, edge.y - center.y) : Math.max(8, worldRadius * 0.35);
      drawCircle(center, radius, stroke, fill, lineWidth, dash);
    };

    const drawWatercolorBlob = (point, worldRadius, opacity = 0.2) => {
      const center = toScreen(point?.x, point?.y, 0);
      if (!center?.visible) return;
      const safeWorldRadius = Math.max(1, Number(worldRadius) || 1);
      const edgeX = toScreen((Number(point?.x) || 0) + safeWorldRadius, Number(point?.y) || 0, 0);
      const edgeY = toScreen(Number(point?.x) || 0, (Number(point?.y) || 0) + safeWorldRadius, 0);
      const radiusX = edgeX?.visible
        ? Math.max(2, Math.hypot(edgeX.x - center.x, edgeX.y - center.y))
        : Math.max(6, safeWorldRadius * 0.32);
      const radiusY = edgeY?.visible
        ? Math.max(2, Math.hypot(edgeY.x - center.x, edgeY.y - center.y))
        : radiusX;
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.scale(radiusX, radiusY);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, `rgba(244, 114, 182, ${Math.max(0.03, opacity * 0.52)})`);
      gradient.addColorStop(0.72, `rgba(244, 114, 182, ${Math.max(0.025, opacity * 0.3)})`);
      gradient.addColorStop(0.94, `rgba(244, 114, 182, ${Math.max(0.012, opacity * 0.16)})`);
      gradient.addColorStop(1, 'rgba(244, 114, 182, 0)');
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.restore();
    };

    const drawWatercolorStroke = (stamps = [], opacity = 0.3) => {
      const projected = (Array.isArray(stamps) ? stamps : [])
        .map((stamp) => {
          const x = Number(stamp?.x) || 0;
          const y = Number(stamp?.y) || 0;
          const worldRadius = Math.max(1, Number(stamp?.radius) || 1);
          const center = toScreen(x, y, 0);
          if (!center?.visible) return null;
          const edgeX = toScreen(x + worldRadius, y, 0);
          const edgeY = toScreen(x, y + worldRadius, 0);
          const radiusX = edgeX?.visible ? Math.hypot(edgeX.x - center.x, edgeX.y - center.y) : 6;
          const radiusY = edgeY?.visible ? Math.hypot(edgeY.x - center.x, edgeY.y - center.y) : radiusX;
          return {
            stamp: { x, y, radius: worldRadius },
            center,
            radius: Math.max(2, (radiusX + radiusY) * 0.5)
          };
        })
        .filter(Boolean);
      if (projected.length <= 0) return;
      if (projected.length === 1) {
        drawWatercolorBlob(projected[0].stamp, projected[0].stamp.radius, opacity);
        return;
      }
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let segmentIndex = 1; segmentIndex < projected.length; segmentIndex += 1) {
        const previous = projected[segmentIndex - 1];
        const current = projected[segmentIndex];
        ctx.beginPath();
        ctx.moveTo(previous.center.x, previous.center.y);
        ctx.lineTo(current.center.x, current.center.y);
        ctx.strokeStyle = `rgba(244, 114, 182, ${Math.max(0.03, opacity * 0.48)})`;
        ctx.lineWidth = Math.max(4, Math.min(previous.radius, current.radius) * 2);
        ctx.stroke();
      }
      ctx.restore();
      projected.forEach((row) => {
        drawWatercolorBlob(row.stamp, row.stamp.radius, opacity * 0.82);
      });
    };

    const drawPath = (sourceCenter, points, color, nodeFill, dash = [5, 4], lineWidth = 2) => {
      if (!sourceCenter?.visible || !Array.isArray(points) || points.length <= 0) return;
      let prev = sourceCenter;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dash);
      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const next = toScreen(point.x, point.y, 0);
        if (!next?.visible) continue;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
        drawCircle(next, 4, color, nodeFill, 1.2);
        prev = next;
      }
      ctx.setLineDash([]);
    };

    if (selectedSquad) {
      const center = toScreen(selectedSquad.x, selectedSquad.y, 0);
      if (center?.visible) {
        drawCircle(center, 12, 'rgba(250, 204, 21, 0.95)', 'rgba(250, 204, 21, 0.12)');
      }

      if (selectedSquad.guard?.enabled) {
        drawWorldRadiusCircle(
          Number(selectedSquad.guard.cx) || Number(selectedSquad.x) || 0,
          Number(selectedSquad.guard.cy) || Number(selectedSquad.y) || 0,
          Math.max(8, Number(selectedSquad.guard.radius) || 32),
          'rgba(16, 185, 129, 0.95)',
          'rgba(16, 185, 129, 0.08)',
          1.8,
          [6, 4]
        );
      }

      if (selectedSquad.lastMoveMarker && Number(selectedSquad.lastMoveMarker.ttl) > 0) {
        const marker = toScreen(selectedSquad.lastMoveMarker.x, selectedSquad.lastMoveMarker.y, 0);
        if (marker?.visible) {
          drawCircle(marker, 9, 'rgba(56, 189, 248, 0.95)', '', 1.5);
          ctx.beginPath();
          ctx.moveTo(marker.x - 12, marker.y);
          ctx.lineTo(marker.x + 12, marker.y);
          ctx.moveTo(marker.x, marker.y - 12);
          ctx.lineTo(marker.x, marker.y + 12);
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
          ctx.lineWidth = 1.3;
          ctx.stroke();
        }
      }

      drawPath(center, waypoints, 'rgba(56, 189, 248, 0.82)', 'rgba(56, 189, 248, 0.24)');

      if (
        isTrainingMode
        && battleUiMode === 'SKILL_CONFIRM'
        && skillConfirmState?.squadId === selectedSquad.id
        && skillConfirmState?.paintArea
      ) {
        const originX = Number(skillConfirmState?.center?.x) || Number(selectedSquad.x) || 0;
        const originY = Number(skillConfirmState?.center?.y) || Number(selectedSquad.y) || 0;
        drawWorldRadiusCircle(
          originX,
          originY,
          Math.max(8, Number(skillConfirmState?.maxRange) || 180),
          'rgba(251, 191, 36, 0.56)',
          'rgba(251, 191, 36, 0.025)',
          1.1,
          [4, 5]
        );
        const stamps = Array.isArray(skillConfirmState.paintArea.stamps)
          ? skillConfirmState.paintArea.stamps
          : [];
        drawWatercolorStroke(stamps, 0.3);
        const remainingRadius = getSkillPaintRemainingRadius(skillConfirmState.paintArea);
        const cursorPoint = skillConfirmState.hoverPoint || { x: originX, y: originY };
        if (remainingRadius > 0.05) {
          drawWatercolorBlob(cursorPoint, remainingRadius, skillConfirmState.paintArea.isDragging ? 0.38 : 0.3);
        }
      }

      if (battleUiMode === 'PATH_PLANNING') {
        drawPath(center, pendingPathPoints, 'rgba(250, 204, 21, 0.9)', 'rgba(250, 204, 21, 0.26)', [7, 5], 2.2);
        if (planningHoverPoint) {
          const preview = toScreen(planningHoverPoint.x, planningHoverPoint.y, 0);
          if (preview?.visible) {
            const tail = pendingPathPoints.length > 0 ? pendingPathPoints[pendingPathPoints.length - 1] : selectedSquad;
            const tailScreen = toScreen(Number(tail.x) || 0, Number(tail.y) || 0, 0);
            if (tailScreen?.visible) {
              ctx.beginPath();
              ctx.setLineDash([4, 4]);
              ctx.moveTo(tailScreen.x, tailScreen.y);
              ctx.lineTo(preview.x, preview.y);
              ctx.strokeStyle = 'rgba(250, 204, 21, 0.78)';
              ctx.lineWidth = 1.6;
              ctx.stroke();
              ctx.setLineDash([]);
            }
            drawCircle(preview, 5, 'rgba(250, 204, 21, 0.95)', 'rgba(250, 204, 21, 0.3)');
          }
        }
      }

      const activeGroundSkill = selectedSquad.activeSkill?.targetSpec;
      if (!isTrainingMode && activeGroundSkill?.shape === 'ground_aoe') {
        drawWorldRadiusCircle(
          Number(activeGroundSkill.centerX) || 0,
          Number(activeGroundSkill.centerY) || 0,
          Math.max(2, Number(activeGroundSkill.radius) || 8),
          'rgba(251, 146, 60, 0.96)',
          'rgba(251, 146, 60, 0.14)',
          1.8
        );
      }

      if (!isTrainingMode && battleUiMode === 'SKILL_CONFIRM' && skillConfirmState?.squadId === selectedSquad.id) {
        const confirmCenterWorldX = Number(skillConfirmState?.center?.x) || Number(selectedSquad.x) || 0;
        const confirmCenterWorldY = Number(skillConfirmState?.center?.y) || Number(selectedSquad.y) || 0;
        const confirmCenter = toScreen(confirmCenterWorldX, confirmCenterWorldY, 0);
        const targetMode = skillConfirmState.targetMode
          || (skillConfirmState.kind === 'cavalry' ? 'direction' : (
            skillConfirmState.kind === 'archer' || skillConfirmState.kind === 'artillery' ? 'ground' : 'self'
          ));
        if (targetMode === 'direction') {
          const dirX = Number(skillConfirmState?.dir?.x) || 1;
          const dirY = Number(skillConfirmState?.dir?.y) || 0;
          const len = Math.max(10, Number(skillConfirmState?.len) || 80);
          const maxRange = Math.max(len, Number(skillConfirmState?.maxRange) || len);
          drawWorldRadiusCircle(
            confirmCenterWorldX,
            confirmCenterWorldY,
            maxRange,
            'rgba(251, 146, 60, 0.56)',
            'rgba(251, 146, 60, 0.035)',
            1.2,
            [4, 5]
          );
          drawCircle(confirmCenter, 18, 'rgba(251, 146, 60, 0.95)', 'rgba(251, 146, 60, 0.16)', 2, [4, 4]);
          const orbitRadius = Math.max(18, Math.min(42, len * 0.42));
          const base = toScreen(confirmCenterWorldX + (dirX * orbitRadius), confirmCenterWorldY + (dirY * orbitRadius), 0);
          const tip = toScreen(confirmCenterWorldX + (dirX * len), confirmCenterWorldY + (dirY * len), 0);
          if (base?.visible && tip?.visible) {
            ctx.beginPath();
            ctx.moveTo(base.x, base.y);
            ctx.lineTo(tip.x, tip.y);
            ctx.strokeStyle = 'rgba(251, 146, 60, 0.95)';
            ctx.lineWidth = 5;
            ctx.stroke();
            const hx = tip.x - confirmCenter.x;
            const hy = tip.y - confirmCenter.y;
            const hlen = Math.hypot(hx, hy) || 1;
            const nx = hx / hlen;
            const ny = hy / hlen;
            const px = -ny;
            const py = nx;
            const head = 16;
            ctx.beginPath();
            ctx.moveTo(tip.x, tip.y);
            ctx.lineTo(tip.x - (nx * head) + (px * 8), tip.y - (ny * head) + (py * 8));
            ctx.lineTo(tip.x - (nx * head) - (px * 8), tip.y - (ny * head) - (py * 8));
            ctx.closePath();
            ctx.fillStyle = 'rgba(251, 146, 60, 0.95)';
            ctx.fill();
          }
        }

        if (targetMode === 'ground' && skillConfirmState.hoverPoint) {
          const centerPoint = {
            x: confirmCenterWorldX,
            y: confirmCenterWorldY
          };
          const targetPoint = {
            x: Number(skillConfirmState.hoverPoint.x) || 0,
            y: Number(skillConfirmState.hoverPoint.y) || 0
          };
          const radius = Math.max(8, Number(skillConfirmState.aoeRadius) || 24);
          drawWorldRadiusCircle(
            confirmCenterWorldX,
            confirmCenterWorldY,
            Math.max(radius, Number(skillConfirmState?.maxRange) || 180),
            'rgba(56, 189, 248, 0.5)',
            '',
            1.1,
            [4, 5]
          );
          drawWorldRadiusCircle(
            targetPoint.x,
            targetPoint.y,
            radius,
            'rgba(248, 113, 113, 0.96)',
            'rgba(248, 113, 113, 0.14)',
            1.8,
            [6, 4]
          );
          const source = toScreen(centerPoint.x, centerPoint.y, 0);
          const target = toScreen(targetPoint.x, targetPoint.y, 0);
          if (source?.visible && target?.visible) {
            const arcCount = skillConfirmState.kind === 'artillery' ? 3 : 5;
            for (let i = 0; i < arcCount; i += 1) {
              const spread = (i - ((arcCount - 1) / 2)) * (skillConfirmState.kind === 'artillery' ? 8 : 5);
              const mx = (source.x + target.x) * 0.5 + spread;
              const my = (source.y + target.y) * 0.5 - clamp(Math.hypot(target.x - source.x, target.y - source.y) * 0.28, 20, 120);
              ctx.beginPath();
              ctx.setLineDash([6, 4]);
              ctx.moveTo(source.x, source.y);
              ctx.quadraticCurveTo(mx, my, target.x, target.y);
              ctx.strokeStyle = 'rgba(248, 113, 113, 0.78)';
              ctx.lineWidth = 1.3;
              ctx.stroke();
            }
            ctx.setLineDash([]);
          }
        }
        if (targetMode === 'enemy') {
          if (skillConfirmState?.profile?.globalTarget) {
            drawCircle(confirmCenter, 22, 'rgba(74, 222, 128, 0.86)', 'rgba(74, 222, 128, 0.08)', 1.8, [4, 4]);
          } else {
            drawWorldRadiusCircle(
              confirmCenterWorldX,
              confirmCenterWorldY,
              Math.max(40, Number(skillConfirmState?.maxRange) || 180),
              'rgba(74, 222, 128, 0.52)',
              '',
              1.1,
              [4, 5]
            );
          }
          if (skillConfirmState.hoverPoint) {
            const targetPoint = {
              x: Number(skillConfirmState.hoverPoint.x) || 0,
              y: Number(skillConfirmState.hoverPoint.y) || 0
            };
            drawWorldRadiusCircle(
              targetPoint.x,
              targetPoint.y,
              Math.max(14, Number(skillConfirmState?.aoeRadius) || 20),
              'rgba(244, 114, 182, 0.98)',
              'rgba(244, 114, 182, 0.16)',
              2,
              [6, 4]
            );
            const target = toScreen(targetPoint.x, targetPoint.y, 0);
            if (confirmCenter?.visible && target?.visible) {
              ctx.beginPath();
              ctx.setLineDash([6, 4]);
              ctx.moveTo(confirmCenter.x, confirmCenter.y);
              ctx.lineTo(target.x, target.y);
              ctx.strokeStyle = 'rgba(244, 114, 182, 0.72)';
              ctx.lineWidth = 1.6;
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
        }
        if (targetMode === 'self') {
          drawCircle(confirmCenter, 22, 'rgba(74, 222, 128, 0.95)', 'rgba(74, 222, 128, 0.14)', 2, [4, 4]);
        }
      }
    }

    if (aimState?.active && aimState?.point) {
      const center = worldToScreen({ x: aimState.point.x, y: aimState.point.y, z: 0 });
      if (center?.visible) {
        drawCircle(center, Math.max(8, Number(aimState.radiusPx) || 24), 'rgba(248, 113, 113, 0.95)', 'rgba(248, 113, 113, 0.16)');
      }
    }
  }, [
    width,
    height,
    worldToScreen,
    selectedSquad,
    aimState,
    waypoints,
    battleUiMode,
    pendingPathPoints,
    planningHoverPoint,
    skillConfirmState,
    isTrainingMode
  ]);

  return <canvas ref={canvasRef} className="pve2-overlay-canvas" />;
};

export default AimOverlayCanvas;
