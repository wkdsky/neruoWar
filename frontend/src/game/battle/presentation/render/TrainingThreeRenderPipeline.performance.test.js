import {
  resolveTrainingRenderFrameInterval,
  resolveTrainingSkillVisualFocus
} from './TrainingThreeRenderPipeline';

describe('TrainingThreeRenderPipeline performance policy', () => {
  test('never lowers the battlefield render cadence for dense formations', () => {
    expect(resolveTrainingRenderFrameInterval(159)).toBe(0);
    expect(resolveTrainingRenderFrameInterval(160)).toBe(0);
  });

  test('does not allocate unit focus flags without an active skill target', () => {
    expect(resolveTrainingSkillVisualFocus({
      crowd: {
        allAgents: [{ id: 'agent-1', squadId: 'squad-1', weight: 1 }]
      }
    }, null)).toEqual({
      shadowFlags: null,
      focusFlags: null,
      active: false
    });
  });
});
