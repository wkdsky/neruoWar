const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const TRAINING_UNIT_MIN_VISUAL_SIZE = 2.6;
export const TRAINING_UNIT_MAX_VISUAL_SIZE = 10.5;
export const TRAINING_NEUTRAL_UNIT_MAX_VISUAL_SIZE = 15;
export const TRAINING_NEUTRAL_UNIT_VISUAL_SCALE = 1.8;
export const TRAINING_SELECTED_UNIT_RING_SCALE = 1.55;
export const TRAINING_SELECTED_UNIT_MIN_PICK_RADIUS = 5.2;
export const TRAINING_SELECTED_UNIT_MAX_PICK_RADIUS = (
  Math.max(
    TRAINING_SELECTED_UNIT_MIN_PICK_RADIUS,
    TRAINING_NEUTRAL_UNIT_MAX_VISUAL_SIZE * TRAINING_SELECTED_UNIT_RING_SCALE
  )
);

export const resolveTrainingUnitVisualSize = (value = 4) => clamp(
  Number.isFinite(Number(value)) ? Number(value) : 4,
  TRAINING_UNIT_MIN_VISUAL_SIZE,
  TRAINING_NEUTRAL_UNIT_MAX_VISUAL_SIZE
);

export const resolveTrainingUnitVisualSizeFromWeight = (weight = 1) => (
  clamp(
    Math.sqrt(Math.max(1, Number(weight) || 1)) * 0.82,
    TRAINING_UNIT_MIN_VISUAL_SIZE,
    TRAINING_UNIT_MAX_VISUAL_SIZE
  )
);

export const resolveTrainingAgentVisualSize = (agent = {}) => {
  const neutral = agent?.isNeutralCampUnit === true;
  const scaledSize = Math.sqrt(Math.max(1, Number(agent?.weight) || 1))
    * 0.82
    * (neutral ? TRAINING_NEUTRAL_UNIT_VISUAL_SCALE : 1);
  return clamp(
    scaledSize,
    TRAINING_UNIT_MIN_VISUAL_SIZE,
    neutral ? TRAINING_NEUTRAL_UNIT_MAX_VISUAL_SIZE : TRAINING_UNIT_MAX_VISUAL_SIZE
  );
};

export const resolveTrainingSelectedUnitRingRadius = (visualSize = 4) => (
  Math.max(
    TRAINING_SELECTED_UNIT_MIN_PICK_RADIUS,
    resolveTrainingUnitVisualSize(visualSize) * TRAINING_SELECTED_UNIT_RING_SCALE
  )
);

export const resolveTrainingSelectionRadiusFromWeight = (weight = 1) => (
  resolveTrainingSelectedUnitRingRadius(resolveTrainingUnitVisualSizeFromWeight(weight))
);

export const resolveTrainingAgentSelectionRadius = (agent = {}) => (
  resolveTrainingSelectedUnitRingRadius(resolveTrainingAgentVisualSize(agent))
);
