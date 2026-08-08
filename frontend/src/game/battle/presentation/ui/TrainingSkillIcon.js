import React from 'react';
import { resolveSkillTreeIcon } from '../../../../components/game/skillTree/skillTreeIcons';

export const resolveTrainingSkillIcon = resolveSkillTreeIcon;

const TrainingSkillIcon = ({ skill = null, size = 20, strokeWidth = 1.8, className = '' }) => {
  const Icon = resolveSkillTreeIcon(skill);
  const skillId = String(skill?.id || skill?.skillId || '').trim();
  return (
    <Icon
      className={className}
      data-skill-icon={skillId || undefined}
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
    />
  );
};

export default TrainingSkillIcon;
