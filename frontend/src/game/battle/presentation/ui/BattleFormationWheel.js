import React from 'react';

const MAX_FORMATION_WHEEL_ITEMS = 9;

const BattleFormationWheel = ({
  open = false,
  formations = [],
  activeFormationId = '',
  position = null,
  onPick,
  onClose
}) => {
  const legalFormations = (Array.isArray(formations) ? formations : [])
    .filter((formation) => formation && formation.legal !== false)
    .slice(0, MAX_FORMATION_WHEEL_ITEMS);
  if (!open || legalFormations.length <= 0) return null;

  const size = 286;
  const center = size * 0.5;
  const outerRadius = legalFormations.length <= 6 ? 96 : 118;
  const innerRadius = legalFormations.length <= 9 ? outerRadius : 82;
  const left = Number.isFinite(Number(position?.x)) ? Number(position.x) : null;
  const top = Number.isFinite(Number(position?.y)) ? Number(position.y) : null;
  const style = left !== null && top !== null
    ? { left: `${left}px`, top: `${top}px` }
    : {};

  return (
    <div
      className="pve2-formation-wheel"
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="pve2-formation-wheel-core">
        <strong>阵型</strong>
        <button type="button" onClick={onClose} aria-label="关闭阵型轮盘">×</button>
      </div>
      <div className="pve2-formation-wheel-items" style={{ width: `${size}px`, height: `${size}px` }}>
        {legalFormations.map((formation, index) => {
          const angle = (-90 + ((360 / legalFormations.length) * index)) * (Math.PI / 180);
          const radius = legalFormations.length > 9 && index % 2 === 1 ? innerRadius : outerRadius;
          const x = center + (Math.cos(angle) * radius);
          const y = center + (Math.sin(angle) * radius);
          const formationId = String(formation?.formationId || formation?.id || `formation_${index}`);
          const active = formationId === activeFormationId;
          return (
            <button
              key={formationId}
              type="button"
              className={`pve2-formation-wheel-item ${active ? 'is-active' : ''}`}
              style={{ left: `${x}px`, top: `${y}px` }}
              title={formation?.name || `阵型${index + 1}`}
              onClick={() => onPick?.(formation)}
            >
              <span>{index + 1}</span>
              <em>{formation?.name || `阵型${index + 1}`}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default BattleFormationWheel;
