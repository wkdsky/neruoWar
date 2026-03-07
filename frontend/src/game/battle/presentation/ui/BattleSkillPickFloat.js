import React from 'react';

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const BattleSkillPickFloat = ({
  open = false,
  popupPos = null,
  squadId = '',
  skillPopupMeta = null,
  onPickSkill
}) => {
  const skills = skillPopupMeta?.skills || [];
  if (!open || !squadId || skills.length <= 0) return null;

  const left = Number(popupPos?.x) || 120;
  const top = Number(popupPos?.y) || 120;

  return (
    <div
      className="pve2-skill-float"
      style={{ left: `${left}px`, top: `${top}px` }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {skills.map((skill) => {
        const total = Math.max(0.1, Number(skill?.cooldownTotal) || 1);
        const remain = Math.max(0, Number(skill?.cooldownRemain) || 0);
        const ratio = clamp01(remain / total);
        const ringStyle = {
          backgroundImage: `conic-gradient(rgba(148,163,184,0.82) ${Math.round(ratio * 360)}deg, rgba(59,130,246,0.94) 0deg)`
        };
        return (
          <button
            key={skill.id || skill.kind}
            type="button"
            className={`pve2-skill-float-btn ${skill.available ? '' : 'is-cd'}`}
            style={ringStyle}
            onClick={(event) => {
              event.stopPropagation();
              onPickSkill?.(skill, {
                squadId,
                clientX: Number(event.clientX) || 0,
                clientY: Number(event.clientY) || 0
              });
            }}
          >
            <span className="pve2-skill-float-icon">{skill.icon || skill.name?.slice(0, 1) || '技'}</span>
            <span className="pve2-skill-float-tip">
              <strong>{skill.name || '技能'}</strong>
              <em>{skill.description || ''}</em>
              <i>{`兵力 ${Math.max(0, Number(skill.count) || 0)} | ${remain > 0.01 ? `冷却 ${remain.toFixed(1)}s` : '可释放'}`}</i>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default BattleSkillPickFloat;
