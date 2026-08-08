import React from 'react';

const SPACING_OPTIONS = [
  { value: 'loose', label: '松散' },
  { value: 'standard', label: '标准' },
  { value: 'compact', label: '紧凑' }
];

const BattleFormationSpacingFloat = ({
  open = false,
  popupPos = null,
  value = 'standard',
  onPickSpacing
}) => {
  if (!open) return null;
  const left = Number(popupPos?.x) || 120;
  const top = Number(popupPos?.y) || 120;

  return (
    <div
      className="pve2-formation-spacing-float"
      style={{ left: `${left}px`, top: `${top}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {SPACING_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`btn btn-small ${option.value === value ? 'btn-primary' : 'btn-secondary'}`}
          aria-pressed={option.value === value}
          onClick={() => onPickSpacing?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

export default BattleFormationSpacingFloat;
