import React, { useEffect, useRef } from 'react';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const degToRad = (deg) => (Number(deg) || 0) * (Math.PI / 180);

const Minimap = ({ snapshot, cameraCenter, cameraViewport, onMapClick }) => {
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

    // Standard minimap orientation: world left/right matches screen left/right.
    const toMap = (x, y) => ({
      x: ((Number(x) || 0) + fw / 2) * sx,
      y: ((fh / 2) - (Number(y) || 0)) * sy
    });

    const deployRange = snapshot.deployRange || {};
    const attackerMaxX = Number.isFinite(Number(deployRange.attackerMaxX)) ? Number(deployRange.attackerMaxX) : 0;
    const defenderMinX = Number.isFinite(Number(deployRange.defenderMinX)) ? Number(deployRange.defenderMinX) : 0;
    const attackerRight = clamp(((attackerMaxX + fw / 2) * sx), 0, width);
    const defenderLeft = clamp(((defenderMinX + fw / 2) * sx), attackerRight, width);

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
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    (snapshot.buildings || []).forEach((wall) => {
      if (!wall || wall.destroyed) return;
      const p = toMap(wall.x, wall.y);
      const bw = Math.max(1, (Number(wall.width) || 10) * sx);
      const bh = Math.max(1, (Number(wall.depth) || 10) * sy);
      ctx.save();
      ctx.translate(p.x, p.y);
      // Canvas y-axis points downward, so invert rotation to keep world CCW consistent.
      ctx.rotate(-degToRad(wall.rotation));
      ctx.fillStyle = 'rgba(100, 116, 139, 0.65)';
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
    });

    (snapshot.squads || []).forEach((squad) => {
      if (!squad || squad.remain <= 0) return;
      const p = toMap(squad.x, squad.y);
      ctx.beginPath();
      ctx.fillStyle = squad.team === 'attacker' ? '#38bdf8' : '#ef4444';
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
    if (typeof onMapClick !== 'function' || !snapshot?.field) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const rx = event.clientX - rect.left;
    const ry = event.clientY - rect.top;
    const fw = Math.max(1, Number(snapshot.field.width) || 1);
    const fh = Math.max(1, Number(snapshot.field.height) || 1);
    const worldX = (rx / rect.width) * fw - fw / 2;
    const worldY = (fh / 2) - ((ry / rect.height) * fh);
    onMapClick({ x: worldX, y: worldY });
  };

  return (
    <div className="pve2-minimap-wrap">
      <canvas ref={canvasRef} className="pve2-minimap" width={220} height={140} onClick={handleClick} />
    </div>
  );
};

export default Minimap;
