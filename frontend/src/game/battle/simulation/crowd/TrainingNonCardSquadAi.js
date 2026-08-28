/**
 * Training battlefield AI public boundary for non-card squads.
 *
 * Lane minions and neutral camps have different rules, but both are
 * world-driven NPC forces.  Runtime code talks only to this module; the two
 * focused implementations remain private seams so their substantially
 * different movement and leash rules do not become one tangled state machine.
 */
import {
  MINION_WAVE_AI_STATE,
  clearMinionWaveAiState,
  projectPointToMinionPath,
  restoreMinionSquadHoldAnchor,
  resolveMinionPathPointAtProgress,
  resolveMinionSquadAgentCombatDirective,
  resolveMinionWaveAgentAttackRange,
  updateMinionWaveAiFrame
} from './TrainingMinionSquadAi';
import {
  NEUTRAL_CAMP_AI_STATE,
  clearNeutralCampAiState,
  ensureNeutralCampAiState,
  resolveNeutralCampCombatDirective,
  resolveNeutralCampTarget,
  updateNeutralCampAiFrame,
  updateNeutralCampMovementPlan
} from './TrainingNeutralSquadAi';
import {
  isTrainingMinionSquad,
  isTrainingNeutralSquad
} from './TrainingSquadKind';

export {
  MINION_WAVE_AI_STATE,
  NEUTRAL_CAMP_AI_STATE,
  clearMinionWaveAiState,
  clearNeutralCampAiState,
  ensureNeutralCampAiState,
  projectPointToMinionPath,
  restoreMinionSquadHoldAnchor,
  resolveMinionPathPointAtProgress,
  resolveMinionSquadAgentCombatDirective,
  resolveMinionWaveAgentAttackRange,
  resolveNeutralCampCombatDirective,
  resolveNeutralCampTarget
};

/**
 * Neutral camps choose targets and movement before generic crowd steering.
 */
export const prepareTrainingNonCardSquadAiFrame = ({
  sim = {},
  crowd = {},
  nowSec = 0
} = {}) => {
  updateNeutralCampAiFrame({ sim, crowd, nowSec });
  updateNeutralCampMovementPlan({ sim, nowSec });
};

/**
 * Lane waves need the current spatial/engagement snapshot, so their planning
 * intentionally runs after it has been built.
 */
export const updateTrainingMinionSquadAiFrame = ({
  sim = {},
  crowd = {},
  nowSec = 0,
  isPointWithinLane = null,
  assignWaypoints = null
} = {}) => updateMinionWaveAiFrame({
  sim,
  crowd,
  nowSec,
  isPointWithinLane,
  assignWaypoints
});

/**
 * Removes only the foreign NPC runtime from a squad.  This is used when a
 * squad changes kind or is recreated, preventing minion/camp state leakage.
 */
export const clearForeignTrainingNonCardSquadAiState = (
  squad = null,
  agents = []
) => {
  if (!squad) return;
  if (!isTrainingNeutralSquad(squad)) clearNeutralCampAiState(squad, agents);
  if (!isTrainingMinionSquad(squad)) clearMinionWaveAiState(squad, agents);
};

/** Clears both NPC runtime layers before a squad object is replaced. */
export const resetTrainingNonCardSquadAiRuntime = (squad = null, agents = []) => {
  clearMinionWaveAiState(squad, agents);
  clearNeutralCampAiState(squad, agents);
};
