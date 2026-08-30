import { useState } from 'react';
import {
  BATTLE_UI_MODE_NONE,
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultAimState,
  createDefaultDeployDraggingGroup,
  createDefaultDeployInfoState,
  createDefaultPopupPos,
  createDefaultQuickDeployRandomForm,
  createDefaultResultState,
  createDefaultTemplateFillPreview
} from '../screens/battleSceneConstants';

const useBattleSceneUiState = () => {
  const [paused, setPaused] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [aimState, setAimState] = useState(createDefaultAimState);
  const [battleUiMode, setBattleUiMode] = useState(BATTLE_UI_MODE_NONE);
  const [worldActionsVisibleForSquadId, setWorldActionsVisibleForSquadId] = useState('');
  const [hoverSquadIdOnCard, setHoverSquadIdOnCard] = useState('');
  const [pendingPathPoints, setPendingPathPoints] = useState([]);
  const [planningHoverPoint, setPlanningHoverPoint] = useState(null);
  const [skillConfirmState, setSkillConfirmState] = useState(null);
  const [skillPopupSquadId, setSkillPopupSquadId] = useState('');
  const [skillPopupPos, setSkillPopupPos] = useState(createDefaultPopupPos);
  const [selectedSquadId, setSelectedSquadId] = useState('');
  const [resultState, setResultState] = useState(createDefaultResultState);
  const [deployDraggingGroup, setDeployDraggingGroup] = useState(createDefaultDeployDraggingGroup);
  const [deployActionAnchorMode, setDeployActionAnchorMode] = useState('');
  const [deployNotice, setDeployNotice] = useState('');
  const [selectedPaletteItemId, setSelectedPaletteItemId] = useState('');
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState('');
  const [deployInfoState, setDeployInfoState] = useState(createDefaultDeployInfoState);
  const [quickDeployOpen, setQuickDeployOpen] = useState(false);
  const [quickDeployTab, setQuickDeployTab] = useState('standard');
  const [quickDeployApplying, setQuickDeployApplying] = useState(false);
  const [quickDeployError, setQuickDeployError] = useState('');
  const [quickDeployRandomForm, setQuickDeployRandomForm] = useState(createDefaultQuickDeployRandomForm);
  const [templateFillPreview, setTemplateFillPreview] = useState(createDefaultTemplateFillPreview);
  const [showMidlineDebug, setShowMidlineDebug] = useState(true);
  const [isPanning, setIsPanning] = useState(false);

  const deployDraggingGroupId = String(deployDraggingGroup?.groupId || '');
  const deployDraggingTeam = deployDraggingGroup?.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;

  return {
    paused,
    setPaused,
    debugEnabled,
    setDebugEnabled,
    aimState,
    setAimState,
    battleUiMode,
    setBattleUiMode,
    worldActionsVisibleForSquadId,
    setWorldActionsVisibleForSquadId,
    hoverSquadIdOnCard,
    setHoverSquadIdOnCard,
    pendingPathPoints,
    setPendingPathPoints,
    planningHoverPoint,
    setPlanningHoverPoint,
    skillConfirmState,
    setSkillConfirmState,
    skillPopupSquadId,
    setSkillPopupSquadId,
    skillPopupPos,
    setSkillPopupPos,
    selectedSquadId,
    setSelectedSquadId,
    resultState,
    setResultState,
    deployDraggingGroup,
    setDeployDraggingGroup,
    deployActionAnchorMode,
    setDeployActionAnchorMode,
    deployNotice,
    setDeployNotice,
    selectedPaletteItemId,
    setSelectedPaletteItemId,
    confirmDeleteGroupId,
    setConfirmDeleteGroupId,
    deployInfoState,
    setDeployInfoState,
    quickDeployOpen,
    setQuickDeployOpen,
    quickDeployTab,
    setQuickDeployTab,
    quickDeployApplying,
    setQuickDeployApplying,
    quickDeployError,
    setQuickDeployError,
    quickDeployRandomForm,
    setQuickDeployRandomForm,
    templateFillPreview,
    setTemplateFillPreview,
    showMidlineDebug,
    setShowMidlineDebug,
    isPanning,
    setIsPanning,
    deployDraggingGroupId,
    deployDraggingTeam
  };
};

export default useBattleSceneUiState;
