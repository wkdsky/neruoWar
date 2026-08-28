/** Card-squad-only runtime cleanup used by TrainingCardSquadAi. */
export const clearTrainingCardAiState = (squad = null, agents = []) => {
  if (!squad || typeof squad !== 'object') return;
  delete squad.trainingAi;
  delete squad._trainingAiPlan;
  delete squad._trainingAiTargetCache;
  delete squad._trainingAiObjectiveCache;
  delete squad._trainingAiSelection;
  delete squad._trainingAiDecisionDeferred;
  delete squad._trainingTargetNavigation;
  delete squad._trainingNearestEnemyCache;
  delete squad._appliedTrainingAiPlanId;
  delete squad.trainingAiLaneId;
  delete squad.debugAiPlan;
  delete squad.autoNavigation;
  (Array.isArray(agents) ? agents : []).forEach((agent) => {
    if (agent) delete agent._trainingAi;
  });
};
