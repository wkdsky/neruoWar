import React from 'react';
import DeployActionButtons from './DeployActionButtons';

const iconByClass = {
  infantry: '步',
  cavalry: '骑',
  archer: '弓',
  artillery: '炮'
};

const SquadCards = ({
  squads = [],
  phase = 'deploy',
  actionAnchorMode = '',
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
          <span>{iconByClass[row.classTag] || '兵'}</span>
        </div>
        <div className="pve2-card-row">{row.remain}/{row.startCount}</div>
        <div className="pve2-card-row">士气 {Math.round(row.morale)}</div>
        <div className="pve2-card-row">{row.action || '待命'}</div>
      </button>
      {phase === 'deploy' && actionAnchorMode === 'card' && row.team === 'attacker' && row.selected ? (
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
      <div className="pve2-card-strip left">{attacker.map(renderCard)}</div>
      <div className="pve2-card-strip right">{defender.map(renderCard)}</div>
    </>
  );
};

export default SquadCards;
