import React, { useEffect, useMemo, useState } from 'react';
import {
  Crosshair,
  GitBranch,
  Radio,
  Sparkles,
  Swords
} from 'lucide-react';
import {
  getAllowedSkillTreeCategories,
  getSkillTreeById,
  normalizeSkillSlots,
  resolveEffectiveSkillSlots
} from '../../../../components/game/skillTree/skillTreeData';
import TrainingSkillIcon from './TrainingSkillIcon';

const TREE_ICONS = Object.freeze({
  melee: Swords,
  ranged: Crosshair,
  support: Radio
});

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
  onOpenTree,
  onCastSlot,
  treeOpenSlotIndex = -1,
  disabled = false
}) => {
  const isBattle = phase === 'battle' && isTrainingMode;
  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
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
  const activeSlot = effectiveSlots.find((slot) => slot.slotIndex === activeSlotIndex)
    || effectiveSlots[0]
    || normalizedSlots[0]
    || { slotIndex: 0, treeCategory: '' };

  useEffect(() => {
    if (effectiveSlots.some((slot) => slot.slotIndex === activeSlotIndex)) return;
    setActiveSlotIndex(effectiveSlots[0]?.slotIndex || 0);
  }, [activeSlotIndex, effectiveSlots]);

  const handleSlotClick = (slot, slotDisabled, event) => {
    event.stopPropagation();
    setActiveSlotIndex(slot.slotIndex);
    if (isBattle) {
      if (!slotDisabled) onCastSlot?.(slot.slotIndex, event);
      return;
    }
  };

  return (
    <section className={`pve2-training-skill-slots ${isBattle ? 'is-runtime' : 'is-deploy'}`} aria-label="部队技能栏">
      <div className="pve2-training-skill-slot-grid">
        {effectiveSlots.map((slot) => {
          const tree = getSkillTreeById(slot.treeCategory);
          const selectedSkill = tree?.skills?.find((skill) => skill.id === slot.skillId) || null;
          const runtimeSkill = skillBySlot.get(slot.slotIndex) || null;
          const displaySkill = runtimeSkill?.skillId ? runtimeSkill : selectedSkill;
          const TreeIcon = TREE_ICONS[slot.treeCategory] || Sparkles;
          const cooldownRemain = Math.max(0, Number(runtimeSkill?.cooldownRemain ?? slot.cooldownRemain) || 0);
          const cooldownTotal = Math.max(0.1, Number(runtimeSkill?.cooldownTotal) || 1);
          const cooldownRatio = Math.max(0, Math.min(1, cooldownRemain / cooldownTotal));
          const skillLocked = isBattle && !!runtimeSkill?.skillId && runtimeSkill.unlocked === false;
          const slotDisabled = disabled || skillLocked || (isBattle && (!runtimeSkill?.skillId || !runtimeSkill?.available));
          const title = displaySkill
            ? `${displaySkill.name} · ${skillLocked ? '未点亮' : (isBattle ? '点击施放' : '选择槽位')}`
            : (isBattle ? '空技能位' : '空技能位 · 选择后可在技能树配置');
          const treeDisabled = disabled || (!tree && (isBattle || allowedCategories.length <= 0));
          const treeOpen = treeOpenSlotIndex === slot.slotIndex;
          return (
            <div className="pve2-training-skill-pair" key={`training-skill-pair-${slot.slotIndex}`}>
              <button
                type="button"
                className={`pve2-training-skill-slot ${slot.slotIndex === activeSlot.slotIndex ? 'is-active' : ''} ${slot.conflict ? 'is-conflict' : ''} ${!slot.skillId ? 'is-empty' : ''} ${skillLocked ? 'is-locked' : ''} ${cooldownRemain > 0.01 ? 'is-cooldown' : ''}`}
                style={{ '--skill-slot-color': tree?.color || '#64748b' }}
                disabled={slotDisabled}
                title={title}
                aria-label={title}
                aria-pressed={!isBattle && slot.slotIndex === activeSlot.slotIndex}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => handleSlotClick(slot, slotDisabled, event)}
              >
                {displaySkill
                  ? <TrainingSkillIcon skill={displaySkill} size={18} strokeWidth={1.9} />
                  : <TreeIcon size={18} strokeWidth={1.9} aria-hidden="true" />}
                <span className="pve2-training-skill-slot-hotkey">{slot.slotIndex + 1}</span>
                {cooldownRemain > 0.01 ? (
                  <>
                    <span className="pve2-runtime-skill-cooldown-mask" style={{ transform: `scaleY(${cooldownRatio})` }} />
                    <strong className="pve2-runtime-skill-cooldown-text">{formatCooldown(cooldownRemain)}</strong>
                  </>
                ) : null}
              </button>
              <button
                type="button"
                className={`pve2-training-skill-tree-toggle ${treeOpen ? 'is-open' : ''}`}
                style={{ '--skill-slot-color': tree?.color || '#a78bfa' }}
                title={tree ? `${tree.name} · 打开技能树` : '选择技能树'}
                aria-label={slot.slotIndex === 0
                  ? (treeOpen ? '收起技能树' : '展开技能树')
                  : (tree ? `${tree.name} · 槽位 ${slot.slotIndex + 1}` : `选择技能树 · 槽位 ${slot.slotIndex + 1}`)}
                aria-expanded={treeOpen}
                disabled={treeDisabled}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenTree?.(slot.slotIndex, slot.treeCategory, event);
                }}
              >
                <GitBranch size={15} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default TrainingSkillSlots;
