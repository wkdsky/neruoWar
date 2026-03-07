import { useEffect } from 'react';
import {
  BATTLE_PITCH_HIGH_DEG,
  BATTLE_PITCH_LOW_DEG,
  BATTLE_UI_MODE_NONE,
  DEPLOY_DEFAULT_WORLD_YAW_DEG,
  DEPLOY_DEFAULT_YAW_DEG,
  DEPLOY_PITCH_DEG,
  TEAM_ATTACKER,
  createDefaultAimState,
  createDefaultDeployDraggingGroup,
  createDefaultDeployEditorDraft,
  createDefaultDeployInfoState,
  createDefaultDeployQuantityDialog,
  createDefaultPopupPos,
  createDefaultQuickDeployRandomForm,
  createDefaultResultState,
  createDefaultTemplateFillPreview
} from '../screens/battleSceneConstants';
import { computeDeployOverviewDistance } from '../screens/battleSceneUtils';

export default function useBattleSceneLifecycle({
  open = false,
  phase = 'deploy',
  runtimeRef,
  runtimeVersion = 0,
  runtimeInitRef,
  cameraRef,
  resetClock,
  setLoopPaused,
  setPaused,
  setBattleStatus,
  setCards,
  setMinimapSnapshot,
  setSelectedSquadId,
  setAimState,
  setBattleUiMode,
  setWorldActionsVisibleForSquadId,
  setHoverSquadIdOnCard,
  setPendingPathPoints,
  setPlanningHoverPoint,
  setSkillConfirmState,
  setSkillPopupSquadId,
  setSkillPopupPos,
  setMarchModePickOpen,
  setMarchPopupPos,
  setResultState,
  setDeployEditorOpen,
  setDeployEditingGroupId,
  setDeployEditorDraft,
  setDeployQuantityDialog,
  setDeployDraggingGroup,
  setDeployInfoState,
  setDeployActionAnchorMode,
  setDeployNotice,
  setDeployEditorDragUnitId,
  setDeployEditorTeam,
  setSelectedPaletteItemId,
  setQuickDeployOpen,
  setQuickDeployTab,
  setQuickDeployApplying,
  setQuickDeployError,
  setQuickDeployRandomForm,
  setShowMidlineDebug,
  templateFillPreviewOpen = false,
  setTemplateFillPreview
} = {}) {
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!open || !runtime) {
      runtimeInitRef.current = null;
      return;
    }
    if (runtimeInitRef.current === runtime) return;
    runtimeInitRef.current = runtime;
    const cardsRows = runtime.getCardRows();
    const initialSelected = runtime.getDeployGroups()?.selectedId || cardsRows.find((row) => row.team === TEAM_ATTACKER)?.id || '';
    runtime.setFocusSquad(initialSelected);
    setCards(cardsRows || []);
    setBattleStatus(runtime.getBattleStatus() || { timerSec: 0, ended: false, endReason: '' });
    setMinimapSnapshot(runtime.getMinimapSnapshot() || null);
    setSelectedSquadId(initialSelected);
    cameraRef.current.centerX = 0;
    cameraRef.current.centerY = 0;
    cameraRef.current.yawDeg = DEPLOY_DEFAULT_YAW_DEG;
    cameraRef.current.worldYawDeg = DEPLOY_DEFAULT_WORLD_YAW_DEG;
    cameraRef.current.mirrorX = false;
    cameraRef.current.pitchLow = BATTLE_PITCH_LOW_DEG;
    cameraRef.current.pitchHigh = BATTLE_PITCH_HIGH_DEG;
    cameraRef.current.distance = computeDeployOverviewDistance(runtime.getField?.());
    cameraRef.current.currentPitch = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchFrom = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchTo = DEPLOY_PITCH_DEG;
    cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
    resetClock();
    setLoopPaused(false);
    setPaused(false);
    setAimState(createDefaultAimState());
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setWorldActionsVisibleForSquadId('');
    setHoverSquadIdOnCard('');
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setSkillConfirmState(null);
    setSkillPopupSquadId('');
    setSkillPopupPos(createDefaultPopupPos());
    setMarchModePickOpen(false);
    setMarchPopupPos(createDefaultPopupPos());
    setResultState(createDefaultResultState());
    setDeployEditorOpen(false);
    setDeployEditingGroupId('');
    setDeployEditorDraft(createDefaultDeployEditorDraft());
    setDeployQuantityDialog(createDefaultDeployQuantityDialog());
    setDeployDraggingGroup(createDefaultDeployDraggingGroup());
    setDeployInfoState(createDefaultDeployInfoState());
    setDeployActionAnchorMode('');
    setDeployNotice('');
    setDeployEditorDragUnitId('');
    setDeployEditorTeam(TEAM_ATTACKER);
    setSelectedPaletteItemId('');
    setQuickDeployOpen(false);
    setQuickDeployTab('standard');
    setQuickDeployApplying(false);
    setQuickDeployError('');
    setQuickDeployRandomForm(createDefaultQuickDeployRandomForm());
    setShowMidlineDebug(true);
  }, [
    open,
    runtimeRef,
    runtimeVersion,
    runtimeInitRef,
    cameraRef,
    resetClock,
    setLoopPaused,
    setPaused,
    setBattleStatus,
    setCards,
    setMinimapSnapshot,
    setSelectedSquadId,
    setAimState,
    setBattleUiMode,
    setWorldActionsVisibleForSquadId,
    setHoverSquadIdOnCard,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setSkillConfirmState,
    setSkillPopupSquadId,
    setSkillPopupPos,
    setMarchModePickOpen,
    setMarchPopupPos,
    setResultState,
    setDeployEditorOpen,
    setDeployEditingGroupId,
    setDeployEditorDraft,
    setDeployQuantityDialog,
    setDeployDraggingGroup,
    setDeployInfoState,
    setDeployActionAnchorMode,
    setDeployNotice,
    setDeployEditorDragUnitId,
    setDeployEditorTeam,
    setSelectedPaletteItemId,
    setQuickDeployOpen,
    setQuickDeployTab,
    setQuickDeployApplying,
    setQuickDeployError,
    setQuickDeployRandomForm,
    setShowMidlineDebug
  ]);

  useEffect(() => {
    if (!open) {
      setTemplateFillPreview(createDefaultTemplateFillPreview());
    }
  }, [open, setTemplateFillPreview]);

  useEffect(() => {
    if (phase === 'deploy') return;
    if (!templateFillPreviewOpen) return;
    setTemplateFillPreview(createDefaultTemplateFillPreview());
  }, [phase, setTemplateFillPreview, templateFillPreviewOpen]);

  useEffect(() => {
    if (phase === 'battle') return;
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setWorldActionsVisibleForSquadId('');
    setHoverSquadIdOnCard('');
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setSkillConfirmState(null);
    setMarchModePickOpen(false);
    setMarchPopupPos(createDefaultPopupPos());
    setDeployInfoState(createDefaultDeployInfoState());
    setPaused(false);
    setLoopPaused(false);
  }, [
    phase,
    setBattleUiMode,
    setWorldActionsVisibleForSquadId,
    setHoverSquadIdOnCard,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setSkillConfirmState,
    setMarchModePickOpen,
    setMarchPopupPos,
    setDeployInfoState,
    setPaused,
    setLoopPaused
  ]);
}
