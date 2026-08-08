import React, { useMemo } from 'react';

export const BATTLE_ACTION_IDS = ['planPath', 'formationSpacing', 'freeAttack', 'skills', 'standby', 'retreat'];

const ACTION_META = {
  planPath: { label: '规划', title: '规划路径' },
  formationSpacing: { label: '间隔', title: '士兵间距' },
  freeAttack: { label: '警戒', title: '自由攻击' },
  skills: { label: '技能', title: '兵种技能' },
  standby: { label: '待命', title: '待命' },
  retreat: { label: '撤退', title: '撤退' }
};

const BattleActionButtons = ({
  visible = false,
  anchorWorldPos = null,
  camera = null,
  onAction,
  mode = 'world',
  skills = [],
  showSkills = false,
  onSkillPick = null,
  isTrainingMode = false,
  actionIds = BATTLE_ACTION_IDS,
  className = ''
}) => {
  const anchorPos = useMemo(() => {
    if (mode !== 'world') return null;
    if (!visible || !anchorWorldPos || typeof camera !== 'function') return null;
    return camera(anchorWorldPos);
  }, [visible, anchorWorldPos, camera, mode]);

  const visibleActionIds = (Array.isArray(actionIds) ? actionIds : BATTLE_ACTION_IDS)
    .filter((actionId, index, list) => (
      !!ACTION_META[actionId]
      && list.indexOf(actionId) === index
      && !(isTrainingMode && actionId === 'skills')
    ));

  if (!visible) return null;
  if (mode === 'world') {
    if (!anchorPos?.visible) return null;
    return (
      <div
        className={`pve2-battle-actions pve2-battle-actions-world ${className}`}
        style={{ left: `${anchorPos.x}px`, top: `${anchorPos.y}px` }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {showSkills && Array.isArray(skills) && skills.length > 0 ? (
          <div className="pve2-battle-skill-row">
            {skills.map((skill) => (
              <button
                key={skill.id || skill.kind}
                type="button"
                className={`pve2-battle-skill-chip ${skill.available ? '' : 'is-cd'}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSkillPick?.(skill, {
                    clientX: Number(event.clientX) || 0,
                    clientY: Number(event.clientY) || 0
                  });
                }}
              >
                <span className="pve2-battle-skill-icon">{skill.icon || skill.name?.slice(0, 1) || '技'}</span>
                <span className="pve2-battle-skill-tip">
                  <strong>{skill.name || '技能'}</strong>
                  <em>{skill.description || ''}</em>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {visibleActionIds.map((actionId) => (
          <button
            key={actionId}
            type="button"
            className={`pve2-battle-action-btn ${actionId}`}
            title={ACTION_META[actionId].title}
            aria-label={ACTION_META[actionId].title}
            onClick={(event) => {
              event.stopPropagation();
              onAction?.(actionId, {
                clientX: Number(event.clientX) || 0,
                clientY: Number(event.clientY) || 0
              });
            }}
          >
            {ACTION_META[actionId].label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`pve2-battle-actions pve2-battle-actions-card ${className}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {showSkills && Array.isArray(skills) && skills.length > 0 ? (
        <div className="pve2-battle-skill-row">
          {skills.map((skill) => (
            <button
              key={skill.id || skill.kind}
              type="button"
              className={`pve2-battle-skill-chip ${skill.available ? '' : 'is-cd'}`}
              onClick={(event) => {
                event.stopPropagation();
                onSkillPick?.(skill, {
                  clientX: Number(event.clientX) || 0,
                  clientY: Number(event.clientY) || 0
                });
              }}
            >
              <span className="pve2-battle-skill-icon">{skill.icon || skill.name?.slice(0, 1) || '技'}</span>
              <span className="pve2-battle-skill-tip">
                <strong>{skill.name || '技能'}</strong>
                <em>{skill.description || ''}</em>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {visibleActionIds.map((actionId) => (
        <button
          key={actionId}
          type="button"
          className={`pve2-battle-action-btn ${actionId}`}
          title={ACTION_META[actionId].title}
          aria-label={ACTION_META[actionId].title}
          onClick={(event) => {
            event.stopPropagation();
            onAction?.(actionId, {
              clientX: Number(event.clientX) || 0,
              clientY: Number(event.clientY) || 0
            });
          }}
        >
          {ACTION_META[actionId].label}
        </button>
      ))}
    </div>
  );
};

export default BattleActionButtons;
