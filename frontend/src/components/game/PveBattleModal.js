import React from 'react';
import BattleSceneModal from './BattleSceneModal';

const PveBattleModal = (props) => (
  <BattleSceneModal
    mode="siege"
    startLabel="开战"
    requireResultReport
    {...props}
  />
);

export default PveBattleModal;
