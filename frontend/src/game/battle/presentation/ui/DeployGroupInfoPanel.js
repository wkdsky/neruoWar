import React, { useEffect, useMemo, useState } from 'react';
import useDraggablePanel from './useDraggablePanel';

const formatNumber = (value, digits = 1) => {
  const safe = Number(value);
  if (!Number.isFinite(safe)) return '0';
  return safe.toFixed(digits);
};

const DeployGroupInfoPanel = ({
  open = false,
  info = null,
  position = { x: 0, y: 0 },
  onClose = null
}) => {
  const [selectedSkillTag, setSelectedSkillTag] = useState('');

  useEffect(() => {
    if (!open || !info) {
      setSelectedSkillTag('');
      return;
    }
    const hasSelected = (Array.isArray(info.skills) ? info.skills : []).some((skill) => skill?.classTag === selectedSkillTag);
    if (hasSelected) return;
    const firstSkillTag = info.skills?.[0]?.classTag || '';
    setSelectedSkillTag(firstSkillTag);
  }, [info, open, selectedSkillTag]);

  useEffect(() => {
    if (!open) return undefined;
    const handleGlobalPointerDown = (event) => {
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('.pve2-deploy-info, .pve2-icon-btn.info')) {
        return;
      }
      onClose?.();
    };
    window.addEventListener('pointerdown', handleGlobalPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [onClose, open]);

  const selectedSkill = useMemo(() => {
    if (!info || !Array.isArray(info.skills)) return null;
    return info.skills.find((skill) => skill?.classTag === selectedSkillTag) || info.skills[0] || null;
  }, [info, selectedSkillTag]);

  const initialPanelPosition = useMemo(() => ({
    x: (Number(position?.x) || 120) + 14,
    y: (Number(position?.y) || 120) - 14
  }), [position?.x, position?.y]);

  const { panelRef, panelStyle, handleHeaderPointerDown } = useDraggablePanel({
    open,
    initialPosition: initialPanelPosition,
    defaultSize: { width: 560, height: 420 }
  });

  if (!open || !info) return null;

  return (
    <div
      ref={panelRef}
      className="pve2-deploy-info"
      style={panelStyle}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="pve2-deploy-info-head pve2-drag-handle" onPointerDown={handleHeaderPointerDown}>
        <div>
          <strong>{info.name || '未命名部队'}</strong>
          <span>{`总兵力 ${Math.max(0, Math.floor(Number(info.totalCount) || 0))}`}</span>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          data-no-drag
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onClose?.()}
        >
          关闭
        </button>
      </div>

      <div className="pve2-deploy-info-section">
        <h4>兵种占比</h4>
        <div className="pve2-deploy-info-rows">
          {(Array.isArray(info.composition) ? info.composition : []).map((row) => (
            <div key={row.unitTypeId} className="pve2-deploy-info-row">
              <span>{row.unitName || row.unitTypeId}</span>
              <em>{`${Math.max(0, Math.floor(Number(row.count) || 0))} ｜ ${formatNumber(row.percent, 1)}%`}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="pve2-deploy-info-section">
        <h4>可发动技能</h4>
        <div className="pve2-deploy-skill-list">
          {(Array.isArray(info.skills) ? info.skills : []).map((skill) => (
            <button
              key={skill.id}
              type="button"
              className={`pve2-deploy-skill-btn ${selectedSkill?.classTag === skill.classTag ? 'is-active' : ''}`}
              onClick={() => setSelectedSkillTag(skill.classTag)}
            >
              <strong>{skill.name || '技能'}</strong>
              <span>{`${Math.max(0, Math.floor(Number(skill.count) || 0))}人`}</span>
            </button>
          ))}
        </div>
        {selectedSkill ? (
          <div className="pve2-deploy-skill-detail">
            <p>{selectedSkill.description || '暂无描述'}</p>
            <div className="pve2-deploy-skill-power">{`当前威力：${formatNumber(selectedSkill?.power?.score, 1)}（${selectedSkill?.power?.unit || '估值'}）`}</div>
            <div className="pve2-deploy-skill-meta">{`公式：${selectedSkill?.power?.formula || '-'}`}</div>
            {(Array.isArray(selectedSkill?.power?.details) ? selectedSkill.power.details : []).map((detail, index) => (
              <div key={`${selectedSkill.id}-detail-${index}`} className="pve2-deploy-skill-meta">{detail}</div>
            ))}
          </div>
        ) : (
          <div className="pve2-deploy-skill-detail">
            <p>当前无可发动技能</p>
          </div>
        )}
      </div>

      <div className="pve2-deploy-info-section">
        <h4>部队属性</h4>
        <div className="pve2-deploy-info-rows">
          <div className="pve2-deploy-info-row">
            <span>整体行进(B)</span>
            <em>{formatNumber(info?.mobility?.cohesiveSpeed, 2)}</em>
          </div>
          <div className="pve2-deploy-info-row">
            <span>游离行进(C)</span>
            <em>
              {(Array.isArray(info?.mobility?.perTypeLoose) ? info.mobility.perTypeLoose : [])
                .map((row) => `${row.unitName} ${formatNumber(row.speed, 2)}`)
                .join(' / ') || formatNumber(info?.mobility?.looseSpeed, 2)}
            </em>
          </div>
          <div className="pve2-deploy-info-row">
            <span>攻击力</span>
            <em>{`总计 ${formatNumber(info?.attack?.totalAtk, 1)} ｜ 人均 ${formatNumber(info?.attack?.avgAtk, 2)}`}</em>
          </div>
          <div className="pve2-deploy-info-row">
            <span>攻击方式</span>
            <em>{Array.isArray(info?.attack?.modes) && info.attack.modes.length > 0 ? info.attack.modes.join(' / ') : '近'}</em>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeployGroupInfoPanel;
