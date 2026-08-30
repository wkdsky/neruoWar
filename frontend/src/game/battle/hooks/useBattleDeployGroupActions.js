import { useCallback } from 'react';
import {
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultDeployDraggingGroup
} from '../screens/battleSceneConstants';

export default function useBattleDeployGroupActions({
  runtimeRef,
  pointerWorldRef,
  isTrainingMode = false,
  confirmDeleteGroupId = '',
  setSelectedSquadId,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setCards,
  setMinimapSnapshot,
  setDeployNotice,
  setConfirmDeleteGroupId
} = {}) {
  const syncDeployUiFromRuntime = useCallback((runtime, preferredSelectedId = '') => {
    if (!runtime) return;
    const nextSelectedId = String(preferredSelectedId || runtime.getDeployGroups()?.selectedId || '');
    if (nextSelectedId) {
      runtime.setSelectedDeployGroup(nextSelectedId);
      runtime.setFocusSquad(nextSelectedId);
    }
    setSelectedSquadId(nextSelectedId);
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
  }, [setCards, setMinimapSnapshot, setSelectedSquadId]);

  const handleDeployMove = useCallback((groupId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    if (!isTrainingMode && group.team === TEAM_DEFENDER) return;
    const safeTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    pointerWorldRef.current = {
      x: Number(group.x) || 0,
      y: Number(group.y) || 0
    };
    runtime.setSelectedDeployGroup(groupId);
    runtime.setFocusSquad(groupId);
    runtime.setDeployGroupPlaced(safeTeam, groupId, false);
    setSelectedSquadId(groupId);
    setDeployDraggingGroup({ groupId, team: safeTeam });
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setDeployNotice(
      isTrainingMode
        ? '已拾取部队，移动鼠标并点击地图重新放置；左侧归我方，右侧归敌方'
        : `已拾取部队，移动鼠标并点击地图可重新放置到${safeTeam === TEAM_DEFENDER ? '右侧红色' : '左侧蓝色'}部署区`
    );
  }, [
    isTrainingMode,
    pointerWorldRef,
    runtimeRef,
    setCards,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployNotice,
    setMinimapSnapshot,
    setSelectedSquadId
  ]);

  const handleDeployDelete = useCallback((groupId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    if (!isTrainingMode && group.team === TEAM_DEFENDER) return;
    setConfirmDeleteGroupId(String(groupId || ''));
  }, [isTrainingMode, runtimeRef, setConfirmDeleteGroupId]);

  const handleDeployPlacementAction = useCallback((groupId, event = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    if (!isTrainingMode) {
      handleDeployDelete(groupId, event);
      return;
    }
    const safeTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (group.placed !== false) {
      const hasCancelApi = typeof runtime.cancelDeployGroupPlacement === 'function';
      const cancelResult = hasCancelApi
        ? runtime.cancelDeployGroupPlacement(safeTeam, group.id)
        : { ok: runtime.setDeployGroupPlaced(safeTeam, group.id, false) };
      if (cancelResult === false || cancelResult?.ok === false) {
        setDeployNotice(cancelResult?.reason || '取消放置失败');
        return;
      }
      if (!hasCancelApi) group.placementActive = false;
      setDeployDraggingGroup((prev) => (prev.groupId === group.id ? createDefaultDeployDraggingGroup() : prev));
      setDeployActionAnchorMode('');
      setSelectedSquadId(runtime.getDeployGroups()?.selectedId || '');
      setCards(runtime.getCardRows());
      setMinimapSnapshot(runtime.getMinimapSnapshot());
      setDeployNotice('已取消放置，再次点击可删除该训练部队');
      return;
    }
    handleDeployDelete(groupId, event);
  }, [handleDeployDelete, isTrainingMode, runtimeRef, setCards, setDeployActionAnchorMode, setDeployDraggingGroup, setDeployNotice, setMinimapSnapshot, setSelectedSquadId]);

  const handleDeployControlModeToggle = useCallback((groupId, nextMode) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy' || !isTrainingMode) return;
    const result = runtime.setDeployGroupControlMode(groupId, nextMode, 'any');
    if (!result?.ok) {
      setDeployNotice(result?.reason || '切换控制权失败');
      return;
    }
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setDeployNotice(result.controlMode === 'AI' ? '已切换为 AI 接管' : '已切换为用户操作');
  }, [isTrainingMode, runtimeRef, setCards, setDeployNotice, setMinimapSnapshot]);

  const handleDeployReorder = useCallback((groupId, targetGroupId) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy' || !isTrainingMode) return;
    const source = runtime.getDeployGroupById(groupId);
    const target = runtime.getDeployGroupById(targetGroupId);
    if (!source || !target || source.team !== target.team) return;
    const groups = source.team === TEAM_DEFENDER
      ? runtime.getDeployGroups()?.defender
      : runtime.getDeployGroups()?.attacker;
    const targetIndex = Array.isArray(groups) ? groups.findIndex((row) => row?.id === target.id) : -1;
    if (targetIndex < 0) return;
    const result = runtime.reorderDeployGroup(source.team, source.id, targetIndex);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '调整部队顺序失败');
      return;
    }
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
  }, [isTrainingMode, runtimeRef, setCards, setDeployNotice, setMinimapSnapshot]);

  const handleConfirmDeployDelete = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const groupId = String(confirmDeleteGroupId || '');
    if (!groupId) return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) {
      setConfirmDeleteGroupId('');
      return;
    }
    if (!isTrainingMode && group.team === TEAM_DEFENDER) {
      setConfirmDeleteGroupId('');
      return;
    }
    const safeTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = runtime.removeDeployGroup(safeTeam, groupId);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '删除部队失败');
      setConfirmDeleteGroupId('');
      return;
    }
    const nextSelected = runtime.getDeployGroups()?.selectedId || '';
    setSelectedSquadId(nextSelected);
    setDeployDraggingGroup((prev) => (prev.groupId === groupId ? createDefaultDeployDraggingGroup() : prev));
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setConfirmDeleteGroupId('');
    setDeployNotice('部队已删除');
  }, [
    confirmDeleteGroupId,
    isTrainingMode,
    runtimeRef,
    setCards,
    setConfirmDeleteGroupId,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployNotice,
    setMinimapSnapshot,
    setSelectedSquadId
  ]);

  return {
    syncDeployUiFromRuntime,
    handleDeployMove,
    handleDeployDelete,
    handleDeployPlacementAction,
    handleDeployControlModeToggle,
    handleDeployReorder,
    handleConfirmDeployDelete
  };
}
