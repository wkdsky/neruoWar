import React, { useEffect, useRef } from 'react';
import { degToRad, normalizeDeg } from '../../shared/angle';
import { minimapToWorld, worldToMinimap } from '../../shared/coords';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const Minimap = ({
  snapshot,
  cameraCenter,
  cameraViewport,
  onMapClick,
  interactive = true
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const field = snapshot.field || { width: 1, height: 1 };
    const fw = Math.max(1, Number(field.width) || 1);
    const fh = Math.max(1, Number(field.height) || 1);
    const sx = width / fw;
    const sy = height / fh;

    const toMap = (x, y) => {
      const point = worldToMinimap(x, y, fw, fh);
      return {
        x: point.mx * sx,
        y: point.my * sy
      };
    };

    const deployRange = snapshot.deployRange || {};
    const attackerMaxX = Number.isFinite(Number(deployRange.attackerMaxX)) ? Number(deployRange.attackerMaxX) : 0;
    const defenderMinX = Number.isFinite(Number(deployRange.defenderMinX)) ? Number(deployRange.defenderMinX) : 0;
    const attackerRight = clamp(worldToMinimap(attackerMaxX, 0, fw, fh).mx * sx, 0, width);
    const defenderLeft = clamp(worldToMinimap(defenderMinX, 0, fw, fh).mx * sx, attackerRight, width);
    const trainingMap = snapshot?.trainingMap && typeof snapshot.trainingMap === 'object'
      ? snapshot.trainingMap
      : null;
    const hasThreeLaneMap = trainingMap?.enabled === true || trainingMap?.mapId === 'training-three-lane';

    if (hasThreeLaneMap) {
      const terrainColors = {
        grass: 'rgba(44, 83, 56, 0.94)',
        'highland-attacker': 'rgba(125, 47, 55, 0.92)',
        'highland-defender': 'rgba(24, 101, 110, 0.92)',
        sand: 'rgba(233, 213, 73, 0.92)',
        river: 'rgba(192, 151, 84, 0.9)',
        road: 'rgba(111, 94, 62, 0.96)'
      };
      (Array.isArray(trainingMap?.terrainRegions) ? trainingMap.terrainRegions : []).forEach((region) => {
        const center = toMap(region?.x, region?.y);
        const regionWidth = Math.max(1, Number(region?.width) || 1) * sx;
        const regionHeight = Math.max(1, Number(region?.height) || 1) * sy;
        ctx.fillStyle = terrainColors[region?.type] || terrainColors.grass;
        if (region?.shape === 'polygon') {
          const points = Array.isArray(region?.points) ? region.points : [];
          if (points.length < 3) return;
          ctx.beginPath();
          points.forEach((point, index) => {
            const mappedPoint = toMap(point?.x, point?.y);
            if (index === 0) ctx.moveTo(mappedPoint.x, mappedPoint.y);
            else ctx.lineTo(mappedPoint.x, mappedPoint.y);
          });
          ctx.closePath();
          ctx.fill();
          return;
        }
        if (region?.shape === 'semicircle') {
          const radius = Math.max(1, Number(region?.radius) || Math.min(Number(region?.width) || 1, Number(region?.height) || 1) * 0.5);
          const startAngle = region?.arcDirection === 'down' ? 0 : Math.PI;
          ctx.beginPath();
          ctx.ellipse(center.x, center.y, radius * sx, radius * sy, 0, startAngle, startAngle + Math.PI);
          ctx.lineTo(center.x, center.y);
          ctx.closePath();
          ctx.fill();
          return;
        }
        ctx.fillRect(center.x - (regionWidth * 0.5), center.y - (regionHeight * 0.5), regionWidth, regionHeight);
      });
      ctx.strokeStyle = 'rgba(248, 231, 182, 0.5)';
      ctx.lineWidth = 1;
      (Array.isArray(trainingMap?.lanes) ? trainingMap.lanes : []).forEach((lane) => {
        const centerY = toMap(0, lane?.centerY).y;
        const laneHeight = Math.max(1, Number(lane?.width) || 150) * sy;
        ctx.strokeRect(0, centerY - (laneHeight * 0.5), width, laneHeight);
        ctx.fillStyle = 'rgba(255, 241, 196, 0.9)';
        ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        ctx.fillText(String(lane?.label || lane?.id || ''), 3, centerY - 2);
      });
      ctx.fillStyle = 'rgba(255, 220, 220, 0.94)';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillText('我方', 6, 13);
      ctx.fillStyle = 'rgba(195, 249, 250, 0.94)';
      ctx.fillText('敌方', Math.max(6, width - 28), 13);
    } else {
      ctx.fillStyle = 'rgba(11, 40, 70, 0.78)';
      ctx.fillRect(0, 0, attackerRight, height);
      ctx.fillStyle = 'rgba(74, 62, 33, 0.7)';
      ctx.fillRect(attackerRight, 0, Math.max(0, defenderLeft - attackerRight), height);
      ctx.fillStyle = 'rgba(85, 24, 24, 0.78)';
      ctx.fillRect(defenderLeft, 0, Math.max(0, width - defenderLeft), height);
      ctx.fillStyle = 'rgba(248, 231, 182, 0.55)';
      ctx.fillRect(attackerRight - 1, 0, 2, height);
      ctx.fillRect(defenderLeft - 1, 0, 2, height);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.84)';
      ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillText('我方', 6, 13);
      ctx.fillText('敌方', Math.max(6, width - 28), 13);
      if ((defenderLeft - attackerRight) >= 22) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.88)';
        ctx.fillText('交战区', (attackerRight + defenderLeft) * 0.5 - 14, 13);
      }
    }
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    (snapshot.buildings || []).forEach((wall) => {
      if (!wall || wall.destroyed) return;
      const sourceParts = Array.isArray(wall.colliderParts) && wall.colliderParts.length > 0
        ? wall.colliderParts
        : [{
          cx: wall.x,
          cy: wall.y,
          w: wall.width,
          d: wall.depth,
          yawDeg: wall.rotation
        }];
      sourceParts.forEach((part) => {
        const p = toMap(part?.cx, part?.cy);
        const bw = Math.max(1, (Number(part?.w) || 10) * sx);
        const bh = Math.max(1, (Number(part?.d) || 10) * sy);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(-degToRad(normalizeDeg(part?.yawDeg)));
        const category = String(wall?.category || '');
        const team = String(wall?.team || '');
        ctx.fillStyle = category === 'bush'
          ? 'rgba(69, 148, 81, 0.68)'
          : category === 'neutralCamp'
            ? 'rgba(208, 153, 76, 0.9)'
            : category === 'tower' || category === 'base'
              ? (team === 'defender' ? 'rgba(67, 204, 212, 0.94)' : 'rgba(229, 83, 91, 0.94)')
              : 'rgba(100, 116, 139, 0.65)';
        ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
        ctx.restore();
      });
    });

    if (hasThreeLaneMap) {
      const objectiveById = new Map(
        (Array.isArray(snapshot?.objectives) ? snapshot.objectives : [])
          .map((objective) => [String(objective?.id || ''), objective])
      );
      (snapshot.buildings || []).forEach((building) => {
        const objective = objectiveById.get(String(building?.objectiveId || ''));
        if (!objective?.lockedSquadId || objective?.type !== 'tower') return;
        const point = toMap(building?.x, building?.y);
        const radius = Math.max(3, Math.max(Number(building?.width) || 1, Number(building?.depth) || 1) * Math.max(sx, sy) * 0.7);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 214, 80, 0.96)';
        ctx.lineWidth = 1.5;
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    (snapshot.squads || []).forEach((squad) => {
      if (!squad || squad.remain <= 0) return;
      const p = toMap(squad.x, squad.y);
      ctx.beginPath();
      ctx.fillStyle = squad.team === 'neutral'
        ? '#f4c542'
        : (squad.team === 'attacker'
          ? (hasThreeLaneMap ? '#ef6268' : '#38bdf8')
          : (hasThreeLaneMap ? '#55d4db' : '#ef4444'));
      ctx.arc(p.x, p.y, squad.selected ? 3.8 : 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (squad.selected) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.95)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });

    if (cameraCenter && cameraViewport) {
      const center = toMap(cameraCenter.x, cameraCenter.y);
      const viewW = clamp((Number(cameraViewport.widthWorld) || 120) * sx, 12, width * 1.2);
      const viewH = clamp((Number(cameraViewport.heightWorld) || 80) * sy, 10, height * 1.2);
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.78)';
      ctx.lineWidth = 1;
      ctx.strokeRect(center.x - viewW / 2, center.y - viewH / 2, viewW, viewH);
    }
  }, [snapshot, cameraCenter, cameraViewport]);

  const handleClick = (event) => {
    if (!interactive) return;
    if (typeof onMapClick !== 'function' || !snapshot?.field) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rx = event.clientX - rect.left;
    const ry = event.clientY - rect.top;
    const fw = Math.max(1, Number(snapshot.field.width) || 1);
    const fh = Math.max(1, Number(snapshot.field.height) || 1);
    const { x, y } = minimapToWorld((rx / rect.width) * fw, (ry / rect.height) * fh, fw, fh);
    onMapClick({ x, y });
  };

  return (
    <div className="pve2-minimap-wrap">
      <canvas
        ref={canvasRef}
        className={`pve2-minimap ${interactive ? '' : 'is-disabled'}`}
        width={220}
        height={140}
        onClick={handleClick}
      />
    </div>
  );
};

export default Minimap;
