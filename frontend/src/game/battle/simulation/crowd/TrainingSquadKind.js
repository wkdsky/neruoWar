export const TRAINING_SQUAD_KIND = Object.freeze({
  NEUTRAL: 'neutral',
  MINION: 'minion',
  CARD: 'card'
});

export const resolveTrainingSquadKind = (squad = {}) => {
  if (
    squad?.isNeutralCampUnit === true
    || squad?.team === 'neutral'
    || (
      typeof squad?.neutralCampId === 'string'
      && squad.neutralCampId.trim().length > 0
    )
  ) return TRAINING_SQUAD_KIND.NEUTRAL;
  if (squad?.isMinionWaveUnit === true) return TRAINING_SQUAD_KIND.MINION;
  return TRAINING_SQUAD_KIND.CARD;
};

export const isTrainingNeutralSquad = (squad = {}) => (
  resolveTrainingSquadKind(squad) === TRAINING_SQUAD_KIND.NEUTRAL
);

export const isTrainingMinionSquad = (squad = {}) => (
  resolveTrainingSquadKind(squad) === TRAINING_SQUAD_KIND.MINION
);

export const isTrainingCardSquad = (squad = {}) => (
  resolveTrainingSquadKind(squad) === TRAINING_SQUAD_KIND.CARD
);

export const isTrainingCardComputerSquad = (squad = {}) => (
  isTrainingCardSquad(squad)
  && squad?.controlMode !== 'USER'
);

export const isTrainingCardAiSquad = (squad = {}) => (
  isTrainingCardComputerSquad(squad)
  && squad?.behavior === 'auto'
  && squad?.disabled !== true
);

export const resolveTrainingAgentKind = (agent = {}, squad = null) => (
  resolveTrainingSquadKind(squad || agent)
);
