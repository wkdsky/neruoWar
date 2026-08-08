import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  GitBranch,
  Lock,
  X
} from 'lucide-react';
import {
  getAllowedSkillTreeCategories,
  getSkillTreeById,
  getSkillTreeFirstActiveSkill,
  getSkillTreeRoot,
  getSkillUnlockCost,
  SKILL_TREE_CATALOG,
  SKILL_TREE_CATEGORY_LABELS
} from '../../../../components/game/skillTree/skillTreeData';
import TrainingSkillIcon from './TrainingSkillIcon';

const TrainingSkillTreeModal = ({
  open = false,
  group = null,
  slotIndex = 0,
  treeCategory = '',
  phase = 'deploy',
  progress = { unlocked: [] },
  trainingState = null,
  onClose,
  onTreeChange,
  onSkillClick,
  onUnbind
}) => {
  const allowedCategories = useMemo(
    () => getAllowedSkillTreeCategories(group?.unitCategories || []),
    [group?.unitCategories]
  );
  const [selectedSkillId, setSelectedSkillId] = useState('');
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const activeTree = getSkillTreeById(treeCategory) || getSkillTreeById(allowedCategories[0]) || SKILL_TREE_CATALOG[0];
  const selectedSkill = activeTree.skills.find((skill) => skill.id === selectedSkillId)
    || getSkillTreeRoot(activeTree.id)
    || activeTree.skills[0];
  const unlocked = useMemo(
    () => new Set(Array.isArray(progress?.unlocked) ? progress.unlocked : []),
    [progress]
  );
  const isDeploy = phase === 'deploy';
  const visibleUnlocked = useMemo(() => {
    const next = isDeploy ? new Set() : new Set(unlocked);
    if (isDeploy) {
      const root = getSkillTreeRoot(activeTree.id);
      const firstActive = getSkillTreeFirstActiveSkill(activeTree.id);
      if (root) next.add(root.id);
      if (firstActive) next.add(firstActive.id);
    }
    return next;
  }, [activeTree.id, isDeploy, unlocked]);

  useEffect(() => {
    let closeTimer;
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      closeTimer = window.setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 160);
    }
    return () => window.clearTimeout(closeTimer);
  }, [mounted, open]);

  if (!mounted) return null;

  return (
    <div className={`pve2-training-tree-backdrop ${closing ? 'is-closing' : ''}`} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section
        className={`pve2-training-tree-modal ${closing ? 'is-closing' : ''}`}
        style={{ '--skill-tree-color': activeTree.color, '--skill-tree-soft-color': activeTree.softColor }}
        role="dialog"
        aria-modal="true"
        aria-label={`${activeTree.name}技能树`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pve2-training-tree-header">
          <div>
            <span className="pve2-training-tree-kicker">槽位 {Number(slotIndex) + 1} · {group?.name || '部队'}</span>
            <h3>{activeTree.name}</h3>
            <p>{activeTree.description}</p>
          </div>
          <div className="pve2-training-tree-head-actions">
            <button type="button" className="pve2-training-tree-toggle-close" onClick={onClose} title="收起技能树" aria-label="收起技能树">
              <GitBranch size={16} aria-hidden="true" />
            </button>
            <button type="button" className="pve2-training-tree-close" onClick={onClose} title="关闭技能树" aria-label="关闭技能树">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="pve2-training-tree-tabs" role="tablist" aria-label="技能树类型">
          {SKILL_TREE_CATALOG.map((tree) => {
            const isAllowed = allowedCategories.includes(tree.id);
            const isActive = activeTree.id === tree.id;
            return (
              <button
                key={tree.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`pve2-training-tree-tab ${isActive ? 'is-active' : ''} ${!isAllowed ? 'is-disabled' : ''}`}
                disabled={!isAllowed || (!isDeploy && tree.id !== treeCategory)}
                onClick={() => {
                  setSelectedSkillId('');
                  onTreeChange?.(tree.id);
                }}
              >
                <strong>{SKILL_TREE_CATEGORY_LABELS[tree.id]}</strong>
                <span>{tree.codename}</span>
              </button>
            );
          })}
        </div>

        <div className="pve2-training-tree-body">
          <div className="pve2-training-tree-map" style={{ '--skill-tree-color': activeTree.color }}>
            {[0, 1, 2, 3].map((tier) => (
              <div key={`tree-tier-${tier}`} className={`pve2-training-tree-tier tier-${tier}`}>
                <span className="pve2-training-tree-tier-label">T{tier + 1}</span>
                <div className="pve2-training-tree-tier-skills">
                  {activeTree.skills.filter((skill) => skill.tier === tier).map((skill) => {
                    const lit = visibleUnlocked.has(skill.id);
                    const selected = selectedSkill?.id === skill.id;
                    const canUnlock = !isDeploy
                      && !lit
                      && (skill.prerequisites || []).every((id) => unlocked.has(id))
                      && (Number(trainingState?.points) || 0) >= getSkillUnlockCost(skill);
                    const nodeDisabled = !lit && (isDeploy || !canUnlock);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        className={`pve2-training-tree-node ${lit ? 'is-lit' : 'is-locked'} ${selected ? 'is-selected' : ''} ${canUnlock ? 'is-available' : ''}`}
                        title={lit
                          ? `${skill.name} · 点击装备`
                          : (isDeploy
                            ? `${skill.name} · 训练开始后使用技能点点亮`
                            : (canUnlock ? `${skill.name} · 点击点亮` : `${skill.name} · 需要前置技能或技能点`))}
                        disabled={nodeDisabled}
                        onClick={() => {
                          setSelectedSkillId(skill.id);
                          onSkillClick?.(skill, { lit, canUnlock, slotIndex, treeCategory: activeTree.id });
                        }}
                      >
                        <span className="pve2-training-tree-node-icon">
                          <TrainingSkillIcon skill={skill} size={22} />
                          {!lit ? <Lock className="pve2-training-tree-node-lock" size={10} aria-hidden="true" /> : null}
                        </span>
                        <span className="pve2-training-tree-node-copy">
                          <strong>{skill.name}</strong>
                          <small>{lit ? skill.power : `点亮 ${getSkillUnlockCost(skill)} 点`}</small>
                        </span>
                        {lit ? <Check className="pve2-training-tree-node-check" size={14} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <aside className="pve2-training-tree-detail">
            <div className="pve2-training-tree-detail-head">
              <span className="pve2-training-tree-detail-icon"><TrainingSkillIcon skill={selectedSkill} size={28} /></span>
              <div>
                <span>{selectedSkill?.subtitle || '技能节点'}</span>
                <h4>{selectedSkill?.name || '选择技能'}</h4>
              </div>
            </div>
            <div className="pve2-training-tree-detail-state">
              {isDeploy
                ? (visibleUnlocked.has(selectedSkill?.id) ? '默认已学习' : '未学习 · 训练中使用技能点点亮')
                : (unlocked.has(selectedSkill?.id) ? '已点亮 · 点击节点即可装备' : '未点亮')}
            </div>
            <div className="pve2-training-tree-detail-stats">
              <span>{selectedSkill?.powerLabel || '效果'} <strong>{selectedSkill?.power || '—'}</strong></span>
              <span>冷却 <strong>{selectedSkill?.cooldown || '—'}</strong></span>
              <span>范围 <strong>{selectedSkill?.range || '—'}</strong></span>
            </div>
            <p>{selectedSkill?.description || '选择一个技能节点查看详情。'}</p>
            <div className="pve2-training-tree-detail-effect">{selectedSkill?.effect || ''}</div>
            <div className="pve2-training-tree-detail-actions">
              {!isDeploy && !unlocked.has(selectedSkill?.id) ? (
                <span>{`技能点 ${Math.max(0, Number(trainingState?.points) || 0)} · 点亮需要 ${getSkillUnlockCost(selectedSkill)} 点`}</span>
              ) : (
                <span>{isDeploy ? '准备阶段仅保留起始技能' : '点亮只解锁技能，点击节点才会替换槽位'}</span>
              )}
              {isDeploy && !treeCategory ? null : (
                <button
                  type="button"
                  className="pve2-training-tree-unbind"
                  disabled={!isDeploy || !treeCategory}
                  onClick={() => onUnbind?.(slotIndex)}
                >
                  解除绑定
                </button>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
};

export default TrainingSkillTreeModal;
