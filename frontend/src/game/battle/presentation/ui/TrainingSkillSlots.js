import React, { useMemo } from 'react';
import {
  Crosshair,
  GitBranch,
  Radio,
  Shield,
  Sparkles,
  Swords,
  Zap
} from 'lucide-react';
import {
  getAllowedSkillTreeCategories,
  getSkillTreeById,
  normalizeSkillSlots,
  resolveEffectiveSkillSlots,
  SKILL_TREE_CATEGORY_LABELS
} from '../../../../components/game/skillTree/skillTreeData';

const TREE_ICONS = Object.freeze({
  melee: Swords,
  ranged: Crosshair,
  support: Radio
});

const SKILL_ICONS = Object.freeze({
  ArrowUpRight: Zap,
  Crosshair,
  Gauge: Shield,
  Radio,
  Rocket: Zap,
  Shield,
  ShieldCheck: Shield,
  Swords,
  Target: Crosshair,
  Zap,
  Sparkles
});

const resolveSkillIcon = (skill = null, fallback = Sparkles) => {
  const Icon = SKILL_ICONS[skill?.icon] || fallback;
  return Icon;
};

const formatCooldown = (value = 0) => {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds >= 10) return `${Math.ceil(seconds)}s`;
  return `${seconds.toFixed(1)}s`;
};

const TrainingSkillSlots = ({
  unitCategories = [],
  skillSlots = [],
  skills = [],
  phase = 'deploy',
  isTrainingMode = true,
  trainingState = null,
  onChange,
  onOpenTree,
  onCastSlot,
  disabled = false
}) => {
  const isBattle = phase === 'battle' && isTrainingMode;
  const allowedCategories = useMemo(
    () => getAllowedSkillTreeCategories(unitCategories),
    [unitCategories]
  );
  const effectiveSlots = useMemo(
    () => resolveEffectiveSkillSlots(skillSlots),
    [skillSlots]
  );
  const normalizedSlots = useMemo(
    () => normalizeSkillSlots(skillSlots),
    [skillSlots]
  );
  const skillBySlot = useMemo(
    () => new Map((Array.isArray(skills) ? skills : []).map((skill) => [Number(skill?.slotIndex), skill])),
    [skills]
  );

  const updateSlot = (slotIndex, changes) => {
    const nextSlots = normalizedSlots.map((slot) => (
      slot.slotIndex === slotIndex ? { ...slot, ...changes } : slot
    ));
    onChange?.(nextSlots);
  };

  return (
    <section className={`pve2-training-skill-slots ${isBattle ? 'is-runtime' : 'is-deploy'}`} aria-label="部队技能槽">
      <div className="pve2-training-skill-slots-head">
        <div className="pve2-training-skill-slots-title">
          <strong>{isBattle ? '技能栏' : '训练前技能配置'}</strong>
          <span>{isBattle ? '点击图标施放 · 1 / 2 / 3 快捷键' : '技能树绑定在开始训练前确定'}</span>
        </div>
        {isBattle ? (
          <span className="pve2-training-skill-points-summary">
            {`技能点 ${Math.max(0, Number(trainingState?.points) || 0)} · ${Math.max(1, Number(trainingState?.pointIntervalSec) || 60)}s/点`}
          </span>
        ) : null}
        {!isBattle ? (
          <span className="pve2-training-skill-slots-allowed">
            {allowedCategories.length > 0
              ? allowedCategories.map((category) => SKILL_TREE_CATEGORY_LABELS[category]).join(' · ')
              : '暂无可用技能树'}
          </span>
        ) : null}
      </div>
      <div className="pve2-training-skill-slot-grid">
        {effectiveSlots.map((slot) => {
          const tree = getSkillTreeById(slot.treeCategory);
          const selectedSkill = tree?.skills?.find((skill) => skill.id === slot.skillId) || null;
          const runtimeSkill = skillBySlot.get(slot.slotIndex) || null;
          const displaySkill = runtimeSkill?.skillId ? runtimeSkill : selectedSkill;
          const TreeIcon = TREE_ICONS[slot.treeCategory] || Sparkles;
          const SkillIcon = resolveSkillIcon(displaySkill, TreeIcon);
          const cooldownRemain = Math.max(0, Number(runtimeSkill?.cooldownRemain ?? slot.cooldownRemain) || 0);
          const cooldownTotal = Math.max(0.1, Number(runtimeSkill?.cooldownTotal) || 1);
          const cooldownRatio = Math.max(0, Math.min(1, cooldownRemain / cooldownTotal));
          const slotDisabled = disabled || (isBattle && (!runtimeSkill?.skillId || !runtimeSkill?.available));
          return (
            <article
              key={`training-skill-slot-${slot.slotIndex}`}
              className={`pve2-training-skill-slot ${slot.conflict ? 'is-conflict' : ''} ${!slot.skillId ? 'is-empty' : ''} ${cooldownRemain > 0.01 ? 'is-cooldown' : ''}`}
              style={{ '--skill-slot-color': tree?.color || '#64748b' }}
            >
              <div className="pve2-training-skill-slot-head">
                <span className="pve2-training-skill-slot-hotkey">{slot.slotIndex + 1}</span>
                <span className="pve2-training-skill-slot-index">槽位 {slot.slotIndex + 1}</span>
                <button
                  type="button"
                  className="pve2-training-skill-tree-button"
                  title={tree ? `${tree.name} · 打开技能树` : '选择技能树'}
                  aria-label={tree ? `${tree.name} · 打开技能树` : '选择技能树'}
                  disabled={disabled || (!tree && (allowedCategories.length <= 0 || isBattle))}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenTree?.(slot.slotIndex, slot.treeCategory, event);
                  }}
                >
                  <GitBranch size={14} aria-hidden="true" />
                </button>
              </div>
              {isBattle ? (
                <button
                  type="button"
                  className={`pve2-runtime-skill-button ${!displaySkill ? 'is-empty' : ''} ${cooldownRemain > 0.01 ? 'is-cooldown' : ''}`}
                  disabled={slotDisabled}
                  title={displaySkill ? `${displaySkill.name} · 点击施放` : '空技能位'}
                  aria-label={displaySkill ? `${displaySkill.name} · 点击施放` : '空技能位'}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!slotDisabled) onCastSlot?.(slot.slotIndex, event);
                  }}
                >
                  {displaySkill ? <SkillIcon size={25} strokeWidth={1.8} aria-hidden="true" /> : <Sparkles size={24} aria-hidden="true" />}
                  {cooldownRemain > 0.01 ? (
                    <>
                      <span className="pve2-runtime-skill-cooldown-mask" style={{ transform: `scaleY(${cooldownRatio})` }} />
                      <strong className="pve2-runtime-skill-cooldown-text">{formatCooldown(cooldownRemain)}</strong>
                    </>
                  ) : null}
                </button>
              ) : (
                <>
                  <div className="pve2-training-skill-selected">
                    <span className="pve2-training-skill-icon">
                      {displaySkill ? <SkillIcon size={17} aria-hidden="true" /> : <TreeIcon size={17} aria-hidden="true" />}
                    </span>
                    <div>
                      <strong>{slot.conflict ? '技能冲突占位' : (selectedSkill?.name || '空技能位')}</strong>
                      <span>{tree?.categoryLabel || '未绑定技能树'}</span>
                    </div>
                  </div>
                  <label className="pve2-training-skill-select-label">
                    <span>绑定技能树</span>
                    <select
                      value={slot.treeCategory}
                      disabled={disabled}
                      onChange={(event) => {
                        const nextCategory = event.target.value;
                        const nextTree = getSkillTreeById(nextCategory);
                        updateSlot(slot.slotIndex, {
                          treeCategory: nextCategory,
                          skillId: nextTree?.skills?.find((skill) => skill.kind !== 'passive')?.id || ''
                        });
                      }}
                    >
                      <option value="">空槽位</option>
                      {allowedCategories.map((category) => (
                        <option key={category} value={category}>{SKILL_TREE_CATEGORY_LABELS[category]}</option>
                      ))}
                    </select>
                  </label>
                  {tree ? (
                    <label className="pve2-training-skill-select-label">
                      <span>当前技能</span>
                      <select
                        value={slot.skillId}
                        disabled={disabled}
                        onChange={(event) => updateSlot(slot.slotIndex, { skillId: event.target.value })}
                      >
                        <option value="">空技能位</option>
                        {tree.skills.filter((skill) => skill.kind !== 'passive').map((skill) => (
                          <option key={skill.id} value={skill.id}>{skill.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </>
              )}
              <div className="pve2-training-skill-slot-meta">
                <span>{tree?.categoryLabel || '未绑定'}</span>
                {isBattle && runtimeSkill?.skillId ? <span>{cooldownRemain > 0.01 ? `冷却 ${formatCooldown(cooldownRemain)}` : '就绪'}</span> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default TrainingSkillSlots;
