import { useCallback } from 'react';
import {
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultConfirmDeletePos,
  createDefaultDeployDraggingGroup
} from '../screens/battleSceneConstants';
import { clamp } from '../screens/battleSceneUtils';

export default function useBattleDeployGroupActions({
  runtimeRef,
  glCanvasRef,
  pointerWorldRef,
  isTrainingMode = false,
  confirmDeleteGroupId = '',
  setSelectedSquadId,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setCards,
  setMinimapSnapshot,
  setDeployNotice,
  setConfirmDeleteGroupId,
  setConfirmDeletePos
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

  const handleDeployDelete = useCallback((groupId, event = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) return;
    if (!isTrainingMode && group.team === TEAM_DEFENDER) return;
    const canvas = glCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    let x = Number(rect?.width) * 0.5 || 220;
    let y = Number(rect?.height) * 0.5 || 140;
    if (event?.currentTarget?.getBoundingClientRect && rect) {
      const targetRect = event.currentTarget.getBoundingClientRect();
      x = (targetRect.left + targetRect.width / 2) - rect.left;
      y = (targetRect.top + targetRect.height / 2) - rect.top;
    } else if (Number.isFinite(Number(event?.clientX)) && Number.isFinite(Number(event?.clientY)) && rect) {
      x = Number(event.clientX) - rect.left;
      y = Number(event.clientY) - rect.top;
    }
    setConfirmDeletePos({
      x: clamp(x, 24, Math.max(24, (Number(rect?.width) || x) - 24)),
      y: clamp(y, 24, Math.max(24, (Number(rect?.height) || y) - 24))
    });
    setConfirmDeleteGroupId(String(groupId || ''));
  }, [glCanvasRef, isTrainingMode, runtimeRef, setConfirmDeleteGroupId, setConfirmDeletePos]);

  const handleConfirmDeployDelete = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'deploy') return;
    const groupId = String(confirmDeleteGroupId || '');
    if (!groupId) return;
    const group = runtime.getDeployGroupById(groupId);
    if (!group) {
      setConfirmDeleteGroupId('');
      setConfirmDeletePos(createDefaultConfirmDeletePos());
      return;
    }
    if (!isTrainingMode && group.team === TEAM_DEFENDER) {
      setConfirmDeleteGroupId('');
      setConfirmDeletePos(createDefaultConfirmDeletePos());
      return;
    }
    const safeTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    const result = runtime.removeDeployGroup(safeTeam, groupId);
    if (!result?.ok) {
      setDeployNotice(result?.reason || '删除部队失败');
      setConfirmDeleteGroupId('');
      setConfirmDeletePos(createDefaultConfirmDeletePos());
      return;
    }
    const nextSelected = runtime.getDeployGroups()?.selectedId || '';
    setSelectedSquadId(nextSelected);
    setDeployDraggingGroup((prev) => (prev.groupId === groupId ? createDefaultDeployDraggingGroup() : prev));
    setDeployActionAnchorMode('');
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    setConfirmDeleteGroupId('');
    setConfirmDeletePos(createDefaultConfirmDeletePos());
    setDeployNotice('部队已删除');
  }, [
    confirmDeleteGroupId,
    isTrainingMode,
    runtimeRef,
    setCards,
    setConfirmDeleteGroupId,
    setConfirmDeletePos,
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
    handleConfirmDeployDelete
  };
}
