import { useCallback } from 'react';
import {
  BATTLE_UI_MODE_GUARD,
  BATTLE_UI_MODE_MARCH_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  BATTLE_UI_MODE_SKILL_PICK,
  createDefaultAimState,
  createDefaultConfirmDeletePos,
  createDefaultDeployDraggingGroup,
  createDefaultDeployInfoState,
  createDefaultDeployQuantityDialog
} from '../screens/battleSceneConstants';

export default function useBattleEscapeHandler({
  confirmDeleteGroupId = '',
  deployQuantityDialogOpen = false,
  deployInfoOpen = false,
  quickDeployOpen = false,
  deployEditorOpen = false,
  deployDraggingGroupId = '',
  deployDraggingTeam = '',
  deployRectDragRef,
  battleUiMode = BATTLE_UI_MODE_NONE,
  worldActionsVisibleForSquadId = '',
  aimStateActive = false,
  setConfirmDeleteGroupId,
  setConfirmDeletePos,
  setDeployQuantityDialog,
  setDeployInfoState,
  handleCloseQuickDeploy,
  closeDeployEditor,
  setDeployDraggingGroup,
  setDeployNotice,
  onRecallDeployDraggingGroup,
  closeSkillConfirm,
  commitPathPlanning,
  setBattleUiMode,
  setSkillPopupSquadId,
  setMarchModePickOpen,
  setClockPaused,
  setWorldActionsVisibleForSquadId,
  setAimState,
  closeModal
} = {}) {
  const handleEscape = useCallback(() => {
    if (confirmDeleteGroupId) {
      setConfirmDeleteGroupId('');
      setConfirmDeletePos(createDefaultConfirmDeletePos());
      return;
    }
    if (deployQuantityDialogOpen) {
      setDeployQuantityDialog(createDefaultDeployQuantityDialog());
      return;
    }
    if (deployInfoOpen) {
      setDeployInfoState(createDefaultDeployInfoState());
      return;
    }
    if (quickDeployOpen) {
      handleCloseQuickDeploy();
      return;
    }
    if (deployEditorOpen) {
      closeDeployEditor();
      return;
    }
    if (deployDraggingGroupId) {
      const recalled = onRecallDeployDraggingGroup?.(deployDraggingGroupId, deployDraggingTeam);
      if (!recalled?.ok) {
        setDeployDraggingGroup(createDefaultDeployDraggingGroup());
        setDeployNotice('已取消部队拖拽放置');
      }
      return;
    }
    if (deployRectDragRef.current) {
      deployRectDragRef.current = null;
      setDeployNotice('已取消阵型调整');
      return;
    }
    if (battleUiMode === BATTLE_UI_MODE_SKILL_CONFIRM) {
      closeSkillConfirm(true);
      return;
    }
    if (battleUiMode === BATTLE_UI_MODE_PATH) {
      commitPathPlanning(false);
      return;
    }
    if (battleUiMode === BATTLE_UI_MODE_MARCH_PICK || battleUiMode === BATTLE_UI_MODE_SKILL_PICK || battleUiMode === BATTLE_UI_MODE_GUARD) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setSkillPopupSquadId('');
      setMarchModePickOpen(false);
      setClockPaused(false);
      return;
    }
    if (worldActionsVisibleForSquadId) {
      setWorldActionsVisibleForSquadId('');
      return;
    }
    if (aimStateActive) {
      setAimState(createDefaultAimState());
      return;
    }
    closeModal();
  }, [
    aimStateActive,
    battleUiMode,
    closeDeployEditor,
    closeModal,
    closeSkillConfirm,
    commitPathPlanning,
    confirmDeleteGroupId,
    deployDraggingGroupId,
    deployDraggingTeam,
    deployEditorOpen,
    deployInfoOpen,
    deployQuantityDialogOpen,
    deployRectDragRef,
    handleCloseQuickDeploy,
    quickDeployOpen,
    setAimState,
    setBattleUiMode,
    setClockPaused,
    setConfirmDeleteGroupId,
    setConfirmDeletePos,
    setDeployNotice,
    setDeployDraggingGroup,
    setDeployInfoState,
    setDeployQuantityDialog,
    setMarchModePickOpen,
    setSkillPopupSquadId,
    setWorldActionsVisibleForSquadId,
    onRecallDeployDraggingGroup,
    worldActionsVisibleForSquadId
  ]);

  return { handleEscape };
}
