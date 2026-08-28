/**
 * Compatibility export for training-map callers.
 *
 * Card squad AI now has one public boundary at
 * `crowd/TrainingCardSquadAi.js`; the strategic implementation is colocated
 * with its formation and agent-tactics implementation in `crowd/`.
 */
export * from './crowd/TrainingCardSquadStrategicAi';
