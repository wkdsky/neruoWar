import React from 'react';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const BattleSkillBar = ({
  visible = false,
  skills = [],
  battleUiMode = 'NONE',
  popupPos = null,
  onPickSkill = null,
  onCancelConfirm = null
}) => {
  if (!visible) return null;

  return (
    <div
      className="pve2-skill-bar"
      style={popupPos ? { left: `${popupPos.x}px`, top: `${popupPos.y}px` } : undefined}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {(Array.isArray(skills) ? skills : []).map((skill) => {
        const total = Math.max(0.1, Number(skill?.cooldownTotal) || 1);
        const remain = Math.max(0, Number(skill?.cooldownRemain) || 0);
        const ratio = clamp(remain / total, 0, 1);
        const available = !!skill?.available;
        const bg = `conic-gradient(rgba(148,163,184,0.82) ${Math.round(ratio * 360)}deg, rgba(34,197,94,0.92) 0deg)`;
        return (
          <button
            key={skill?.id || skill?.kind}
            type="button"
            className={`pve2-skill-btn ${available ? '' : 'is-cd'} ${battleUiMode === 'SKILL_CONFIRM' ? 'is-confirm' : ''}`}
            style={{ backgroundImage: bg }}
            disabled={!available}
            onClick={() => onPickSkill?.(skill)}
          >
            <strong>{skill?.name || '技能'}</strong>
            <span>{remain > 0.01 ? `${remain.toFixed(1)}s` : '就绪'}</span>
          </button>
        );
      })}
      {battleUiMode === 'SKILL_CONFIRM' ? (
        <button type="button" className="btn btn-secondary btn-small" onClick={() => onCancelConfirm?.()}>
          取消技能(RMB)
        </button>
      ) : null}
    </div>
  );
};

export default BattleSkillBar;
