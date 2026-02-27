import React from 'react';

const iconByClass = {
  infantry: '步',
  cavalry: '骑',
  archer: '弓',
  artillery: '炮'
};

const SquadCards = ({ squads = [], onFocus, onSelect }) => {
  const attacker = squads.filter((row) => row.team === 'attacker');
  const defender = squads.filter((row) => row.team === 'defender');

  const renderCard = (row) => (
    <button
      key={row.id}
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
  );

  return (
    <>
      <div className="pve2-card-strip left">{attacker.map(renderCard)}</div>
      <div className="pve2-card-strip right">{defender.map(renderCard)}</div>
    </>
  );
};

export default SquadCards;
