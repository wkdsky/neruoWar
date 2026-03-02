import React from 'react';
import DeployActionButtons from './DeployActionButtons';

const iconByClass = {
  infantry: '步',
  cavalry: '骑',
  archer: '弓',
  artillery: '炮'
};

const SPEED_MODE_C = 'C_PER_TYPE';
const speedModeBadge = (row = {}) => {
  if (row?.speedModeAuthority !== 'USER') return 'A';
  return row?.speedMode === SPEED_MODE_C ? 'C' : 'B';
};
const cardSizeClassByCount = (count = 0) => {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  if (safeCount > 12) return 'is-compact';
  if (safeCount > 8) return 'is-medium';
  return 'is-large';
};

const SquadCards = ({
  squads = [],
  phase = 'deploy',
  actionAnchorMode = '',
  deployActionTeam = 'attacker',
  onFocus,
  onSelect,
  onDeployMove,
  onDeployEdit,
  onDeployDelete
}) => {
  const attacker = squads.filter((row) => row.team === 'attacker');
  const defender = squads.filter((row) => row.team === 'defender');

  const renderCard = (row) => (
    <div key={row.id} className="pve2-card-wrap">
      <button
        type="button"
        className={`pve2-card ${row.team === 'attacker' ? 'ally' : 'enemy'} ${row.selected ? 'selected' : ''} ${!row.alive ? 'dead' : ''}`}
        onClick={() => {
          if (typeof onFocus === 'function') onFocus(row.id);
          if (typeof onSelect === 'function') onSelect(row.id);
        }}
      >
        <div className="pve2-card-head">
          <strong title={row.name}>{row.name}</strong>
          <div className="pve2-card-head-meta">
            <span>{iconByClass[row.classTag] || '兵'}</span>
            {phase === 'battle' ? (
              <span className="pve2-speed-badge">
                {speedModeBadge(row)}
                {row?.speedModeAuthority === 'USER' ? <em>锁</em> : null}
              </span>
            ) : null}
          </div>
        </div>
        <div className="pve2-card-row">{row.remain}/{row.startCount}</div>
        <div className="pve2-card-row">士气 {Math.round(row.morale)}</div>
        <div className="pve2-card-row">{row.action || '待命'}</div>
      </button>
      {phase === 'deploy' && actionAnchorMode === 'card' && (!deployActionTeam || row.team === deployActionTeam) && row.selected ? (
        <div
          className="pve2-card-actions"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <DeployActionButtons
            layout="line"
            onMove={(event) => onDeployMove?.(row.id, event)}
            onEdit={(event) => onDeployEdit?.(row.id, event)}
            onDelete={(event) => onDeployDelete?.(row.id, event)}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <div
        className={`pve2-card-strip left ${cardSizeClassByCount(attacker.length)}`}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        {attacker.map(renderCard)}
      </div>
      <div
        className={`pve2-card-strip right ${cardSizeClassByCount(defender.length)}`}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        {defender.map(renderCard)}
      </div>
    </>
  );
};

export default SquadCards;
