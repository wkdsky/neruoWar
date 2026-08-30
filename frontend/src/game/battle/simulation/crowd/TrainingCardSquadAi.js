/**
 * Training-card squad AI public boundary.
 *
 * Card squads have two deliberately separate rates of work:
 * - strategic decisions (map plan / target / state) live in
 *   TrainingCardSquadStrategicAi;
 * - formation, combat allocation and per-agent tactical intent live in
 *   TrainingCardSquadTactics.
 *
 * Runtime callers import this file instead of reaching into either
 * implementation.  That keeps all card-squad behaviour behind one domain
 * boundary while leaving shared navigation, collision and combat execution in
 * their generic modules.
 */
import {
  TRAINING_MAP_AI_PLAN_KIND,
  TRAINING_MAP_AI_STATE,
  clearTrainingMapAiState,
  isTrainingMapAiTargetDeferred,
  recordTrainingMapAiEvent,
  resolveTrainingMapAiTargetScoring,
  scoreTrainingMapAiTarget,
  selectTrainingMapAiObjective,
  selectTrainingMapAiPlan,
  selectTrainingMapAiTarget,
  syncTrainingMapAiState,
  transitionTrainingMapAiState
} from './TrainingCardSquadStrategicAi';
import { clearTrainingCardAiState } from './TrainingCardSquadAiState';
import {
  SQUAD_COMBAT_INTENT,
  SQUAD_COMBAT_RUNTIME_STATE,
  SQUAD_FORMATION_RUNTIME_STATE,
  clearSquadControllerRuntime,
  completeSquadControllerFrame,
  ensureSquadControllerRuntime,
  getSquadControllerCombatAssignment,
  getSquadControllerSupportAssignment,
  prepareSquadControllerFrame,
  resetSquadControllerRuntime,
  resolveSquadControllerAgentSpeedMultiplier,
  resolveSquadControllerBoundarySteering,
  resolveSquadControllerCombatLeash,
  resolveSquadControllerFormationSlot,
  resolveSquadControllerPassageFlowIntent,
  syncSquadControllerCombat
} from './TrainingCardSquadTactics';
import { isTrainingCardSquad } from './TrainingSquadKind';

export {
  TRAINING_MAP_AI_PLAN_KIND,
  TRAINING_MAP_AI_STATE,
  SQUAD_COMBAT_INTENT,
  SQUAD_COMBAT_RUNTIME_STATE,
  SQUAD_FORMATION_RUNTIME_STATE,
  clearTrainingCardAiState,
  clearTrainingMapAiState,
  clearSquadControllerRuntime,
  ensureSquadControllerRuntime,
  getSquadControllerCombatAssignment,
  getSquadControllerSupportAssignment,
  isTrainingMapAiTargetDeferred,
  recordTrainingMapAiEvent,
  resetSquadControllerRuntime,
  resolveSquadControllerAgentSpeedMultiplier,
  resolveSquadControllerBoundarySteering,
  resolveSquadControllerCombatLeash,
  resolveSquadControllerFormationSlot,
  resolveSquadControllerPassageFlowIntent,
  resolveTrainingMapAiTargetScoring,
  scoreTrainingMapAiTarget,
  selectTrainingMapAiObjective,
  selectTrainingMapAiPlan,
  selectTrainingMapAiTarget,
  syncTrainingMapAiState,
  transitionTrainingMapAiState
};

/**
 * Runs the card-specific high-frequency squad phase.  Call this after the
 * strategic plan has updated, before generic steering starts consuming slot
 * and combat assignments.
 */
export const prepareTrainingCardSquadAiFrame = ({
  squad = null,
  agents = [],
  crowd = {},
  spatial = null,
  squadMap = new Map(),
  agentMap = new Map(),
  sim = {},
  walls = [],
  forward = null,
  nowSec = 0,
  moving = false
} = {}) => {
  if (!isTrainingCardSquad(squad)) return null;
  const combat = syncSquadControllerCombat({
    squad,
    agents,
    crowd,
    spatial,
    squadMap,
    agentMap,
    nowSec
  });
  const formation = prepareSquadControllerFrame({
    squad,
    agents,
    sim,
    walls,
    forward,
    nowSec,
    moving
  });
  return { combat, formation };
};

/**
 * Finalizes anchor/debug/cohesion snapshots after generic agent motion has
 * updated the squad aggregate.
 */
export const completeTrainingCardSquadAiFrame = ({
  squad = null,
  agents = [],
  nowSec = 0,
  forward = null
} = {}) => {
  if (!isTrainingCardSquad(squad)) return null;
  return completeSquadControllerFrame({ squad, agents, nowSec, forward });
};

/**
 * The generic crowd loop consumes this compact intent instead of reaching into
 * formation/combat runtime fields itself.  It is intentionally O(1): target
 * reservation, engagement slots and support reservation were already computed
 * once at squad level during prepareTrainingCardSquadAiFrame.
 */
export const resolveTrainingCardAgentTacticalIntent = ({
  agent = null,
  squad = null,
  crowd = {},
  agentMap = new Map(),
  squadMap = new Map(),
  nowSec = 0,
  fallbackSlot = null
} = {}) => {
  if (!agent || !isTrainingCardSquad(squad)) return null;
  const isSupport = agent?.unitCategory === 'support';
  return {
    formationSlot: fallbackSlot && typeof fallbackSlot === 'object'
      ? resolveSquadControllerFormationSlot({ squad, agent, fallbackSlot })
      : null,
    passageFlow: resolveSquadControllerPassageFlowIntent({ squad, agent }),
    catchUpMultiplier: resolveSquadControllerAgentSpeedMultiplier(agent, squad),
    combatLeash: resolveSquadControllerCombatLeash({ agent, squad }),
    combatTarget: isSupport
      ? null
      : getSquadControllerCombatAssignment({ agent, squad, agentMap, squadMap, nowSec }),
    supportTarget: isSupport
      ? getSquadControllerSupportAssignment({ agent, crowd, nowSec })
      : null
  };
};

export const resolveTrainingCardAnchorSteering = ({
  squad = null,
  desiredDirection = null
} = {}) => (
  isTrainingCardSquad(squad)
    ? resolveSquadControllerBoundarySteering({ squad, desiredDirection })
    : desiredDirection
);

/**
 * Clears every card-only runtime layer together.  Lifecycle callers should
 * use this rather than remembering strategic and formation cleanup separately.
 */
export const resetTrainingCardSquadAiRuntime = (
  squad = null,
  agents = [],
  { preserveSlots = true } = {}
) => {
  clearTrainingCardAiState(squad, agents);
  resetSquadControllerRuntime(squad, agents, { preserveSlots });
};
