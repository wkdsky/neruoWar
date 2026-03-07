import React from 'react';

const BattleMarchModeFloat = ({
  open = false,
  popupPos = null,
  onPickMode
}) => {
  if (!open) return null;
  const left = Number(popupPos?.x) || 120;
  const top = Number(popupPos?.y) || 120;

  return (
    <div
      className="pve2-march-float"
      style={{ left: `${left}px`, top: `${top}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" className="btn btn-primary btn-small" onClick={() => onPickMode?.('cohesive')}>整体行进</button>
      <button type="button" className="btn btn-secondary btn-small" onClick={() => onPickMode?.('loose')}>游离行进</button>
    </div>
  );
};

export default BattleMarchModeFloat;
