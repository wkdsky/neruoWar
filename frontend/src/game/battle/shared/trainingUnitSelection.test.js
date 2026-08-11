import {
  TRAINING_SELECTED_UNIT_MIN_PICK_RADIUS,
  TRAINING_SELECTED_UNIT_RING_SCALE,
  resolveTrainingAgentSelectionRadius,
  resolveTrainingSelectedUnitRingRadius,
  resolveTrainingUnitVisualSizeFromWeight
} from './trainingUnitSelection';

test('keeps the training click radius aligned with the visible yellow ring', () => {
  const agent = { weight: 1, radius: 2.25 };
  const visualSize = resolveTrainingUnitVisualSizeFromWeight(agent.weight);

  expect(resolveTrainingSelectedUnitRingRadius(visualSize)).toBeCloseTo(
    Math.max(
      TRAINING_SELECTED_UNIT_MIN_PICK_RADIUS,
      visualSize * TRAINING_SELECTED_UNIT_RING_SCALE
    ),
    6
  );
  expect(resolveTrainingAgentSelectionRadius(agent)).toBeCloseTo(
    resolveTrainingSelectedUnitRingRadius(visualSize),
    6
  );
});

test('keeps a forgiving minimum click radius for diminished training units', () => {
  expect(resolveTrainingAgentSelectionRadius({ weight: 0.05 })).toBe(
    TRAINING_SELECTED_UNIT_MIN_PICK_RADIUS
  );
  expect(resolveTrainingAgentSelectionRadius({ weight: 1 })).toBe(
    TRAINING_SELECTED_UNIT_MIN_PICK_RADIUS
  );
});
