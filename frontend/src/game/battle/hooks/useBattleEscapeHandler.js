import { useCallback } from 'react';
import {
  BATTLE_UI_MODE_GUARD,
  BATTLE_UI_MODE_SPACING_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  BATTLE_UI_MODE_SKILL_PICK,
  createDefaultAimState,
  createDefaultDeployDraggingGroup,
  createDefaultDeployInfoState
} from '../screens/battleSceneConstants';

export default function useBattleEscapeHandler({
  confirmDeleteGroupId = '',
  deployInfoOpen = false,
  quickDeployOpen = false,
  templateFillPreviewOpen = false,
  deployDraggingGroupId = '',
  deployDraggingTeam = '',
  deployRectDragRef,
  deployDirectionArcDragRef,
  battleUiMode = BATTLE_UI_MODE_NONE,
  worldActionsVisibleForSquadId = '',
  aimStateActive = false,
  setConfirmDeleteGroupId,
  setDeployInfoState,
  handleCloseQuickDeploy,
  handleCloseTemplateFillPreview,
  setDeployDraggingGroup,
  setDeployNotice,
  onRecallDeployDraggingGroup,
  closeSkillConfirm,
  commitPathPlanning,
  setBattleUiMode,
  setSkillPopupSquadId,
  setSpacingPickOpen,
  setClockPaused,
  setWorldActionsVisibleForSquadId,
  setAimState,
  closeModal
} = {}) {
  const handleEscape = useCallback(() => {
    if (confirmDeleteGroupId) {
      setConfirmDeleteGroupId('');
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
    if (templateFillPreviewOpen) {
      handleCloseTemplateFillPreview();
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
    if (deployDirectionArcDragRef?.current) {
      const directionDrag = deployDirectionArcDragRef.current;
      deployDirectionArcDragRef.current = null;
      if (directionDrag.resumeClockOnRelease) setClockPaused(false);
      setDeployNotice('已取消前进方向调整');
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
    if (battleUiMode === BATTLE_UI_MODE_SPACING_PICK || battleUiMode === BATTLE_UI_MODE_SKILL_PICK || battleUiMode === BATTLE_UI_MODE_GUARD) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setSkillPopupSquadId('');
      setSpacingPickOpen(false);
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
    closeModal,
    closeSkillConfirm,
    commitPathPlanning,
    confirmDeleteGroupId,
    deployDraggingGroupId,
    deployDraggingTeam,
    deployDirectionArcDragRef,
    deployInfoOpen,
    deployRectDragRef,
    handleCloseQuickDeploy,
    handleCloseTemplateFillPreview,
    quickDeployOpen,
    setAimState,
    setBattleUiMode,
    setClockPaused,
    setConfirmDeleteGroupId,
    setDeployNotice,
    setDeployDraggingGroup,
    setDeployInfoState,
    setSpacingPickOpen,
    setSkillPopupSquadId,
    setWorldActionsVisibleForSquadId,
    onRecallDeployDraggingGroup,
    templateFillPreviewOpen,
    worldActionsVisibleForSquadId
  ]);

  return { handleEscape };
}
