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

    const toMap = (x, y) => ({
      x: ((Number(x) || 0) + fw / 2) * sx,
      y: ((Number(y) || 0) + fh / 2) * sy
    });

    ctx.fillStyle = 'rgba(11, 40, 70, 0.78)';
    ctx.fillRect(0, 0, Math.floor(width * 0.5), height);
    ctx.fillStyle = 'rgba(85, 24, 24, 0.78)';
    ctx.fillRect(Math.floor(width * 0.5), 0, Math.ceil(width * 0.5), height);
    ctx.fillStyle = 'rgba(248, 231, 182, 0.5)';
    ctx.fillRect(Math.floor(width * 0.5) - 1, 0, 2, height);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    (snapshot.buildings || []).forEach((wall) => {
      if (!wall || wall.destroyed) return;
      const p = toMap(wall.x, wall.y);
      const bw = Math.max(1, (Number(wall.width) || 10) * sx);
      const bh = Math.max(1, (Number(wall.depth) || 10) * sy);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(degToRad(wall.rotation));
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
    const worldY = (ry / rect.height) * fh - fh / 2;
    onMapClick({ x: worldX, y: worldY });
  };

  return (
    <div className="pve2-minimap-wrap">
      <canvas ref={canvasRef} className="pve2-minimap" width={220} height={140} onClick={handleClick} />
      <span className="pve2-minimap-label">小地图</span>
    </div>
  );
};

export default Minimap;
