import { useCallback } from 'react';
import {
  BATTLE_FOLLOW_MIRROR_X,
  BATTLE_FOLLOW_WORLD_YAW_DEG,
  BATTLE_FOLLOW_YAW_DEG,
  BATTLE_PITCH_HIGH_DEG,
  BATTLE_PITCH_LOW_DEG,
  BATTLE_UI_MODE_MARCH_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  TEAM_ATTACKER,
  TEAM_DEFENDER,
  createDefaultAimState,
  createDefaultDeployDraggingGroup,
  createDefaultPopupPos
} from '../screens/battleSceneConstants';
import { normalizeUnitsMapCounts } from '../screens/battleSceneUtils';

export default function useBattleSceneSelection({
  runtimeRef,
  cameraRef,
  startBattle,
  isTrainingMode = false,
  setPhase,
  setBattleStatus,
  setCards,
  setSelectedSquadId,
  setResultState,
  setAimState,
  setBattleUiMode,
  setWorldActionsVisibleForSquadId,
  setHoverSquadIdOnCard,
  setPendingPathPoints,
  setPlanningHoverPoint,
  setSkillConfirmState,
  setMarchModePickOpen,
  setMarchPopupPos,
  setDeployDraggingGroup,
  setDeployActionAnchorMode,
  setDeployEditorOpen,
  setSelectedPaletteItemId,
  setQuickDeployOpen,
  setQuickDeployApplying,
  setQuickDeployError,
  setMinimapSnapshot
} = {}) {
  const handleStartBattle = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const result = startBattle();
    if (!result?.ok) {
      setResultState((prev) => ({ ...prev, open: true, error: result?.reason || '无法开战', summary: null }));
      return;
    }
    const attacker = runtime.getCardRows().find((row) => row.team === TEAM_ATTACKER && row.alive);
    if (attacker) {
      runtime.setFocusSquad(attacker.id);
      runtime.setSelectedBattleSquad(attacker.id);
      setSelectedSquadId(attacker.id);
      const anchor = runtime.getFocusAnchor();
      cameraRef.current.centerX = Number(anchor?.x) || 0;
      cameraRef.current.centerY = Number(anchor?.y) || 0;
      cameraRef.current.yawDeg = BATTLE_FOLLOW_YAW_DEG;
      cameraRef.current.worldYawDeg = BATTLE_FOLLOW_WORLD_YAW_DEG;
      cameraRef.current.mirrorX = BATTLE_FOLLOW_MIRROR_X;
      cameraRef.current.pitchLow = BATTLE_PITCH_LOW_DEG;
      cameraRef.current.pitchHigh = BATTLE_PITCH_HIGH_DEG;
      cameraRef.current.currentPitch = cameraRef.current.pitchLow;
      cameraRef.current.pitchFrom = cameraRef.current.pitchLow;
      cameraRef.current.pitchTo = cameraRef.current.pitchLow;
      cameraRef.current.pitchTweenSec = cameraRef.current.pitchTweenDurationSec;
    }
    setPhase(runtime.getPhase());
    setBattleStatus(runtime.getBattleStatus());
    setCards(runtime.getCardRows());
    setAimState(createDefaultAimState());
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setWorldActionsVisibleForSquadId(attacker?.id || '');
    setHoverSquadIdOnCard('');
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setSkillConfirmState(null);
    setMarchModePickOpen(false);
    setMarchPopupPos(createDefaultPopupPos());
    setDeployDraggingGroup(createDefaultDeployDraggingGroup());
    setDeployActionAnchorMode('');
    setDeployEditorOpen(false);
    setSelectedPaletteItemId('');
    setQuickDeployOpen(false);
    setQuickDeployApplying(false);
    setQuickDeployError('');
  }, [
    cameraRef,
    runtimeRef,
    setAimState,
    setBattleStatus,
    setBattleUiMode,
    setCards,
    setDeployActionAnchorMode,
    setDeployDraggingGroup,
    setDeployEditorOpen,
    setHoverSquadIdOnCard,
    setMarchModePickOpen,
    setMarchPopupPos,
    setPendingPathPoints,
    setPhase,
    setPlanningHoverPoint,
    setQuickDeployApplying,
    setQuickDeployError,
    setQuickDeployOpen,
    setResultState,
    setSelectedPaletteItemId,
    setSelectedSquadId,
    setSkillConfirmState,
    setWorldActionsVisibleForSquadId,
    startBattle
  ]);

  const handleCardFocus = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy' && !isTrainingMode) {
      const row = runtime.getCardRows().find((item) => item.id === squadId);
      if (row?.team === TEAM_DEFENDER) return;
    }
    runtime.setFocusSquad(squadId);
    if (runtime.getPhase() === 'deploy') {
      setDeployActionAnchorMode('card');
    } else {
      setWorldActionsVisibleForSquadId(String(squadId || ''));
    }
  }, [isTrainingMode, runtimeRef, setDeployActionAnchorMode, setWorldActionsVisibleForSquadId]);

  const handleCardSelect = useCallback((squadId) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    if (runtime.getPhase() === 'deploy') {
      if (!isTrainingMode) {
        const row = runtime.getCardRows().find((item) => item.id === squadId);
        if (row?.team === TEAM_DEFENDER) return;
      }
      runtime.setSelectedDeployGroup(squadId);
      runtime.setFocusSquad(squadId);
      setSelectedSquadId(squadId);
      setCards(runtime.getCardRows());
      setDeployActionAnchorMode('card');
      return;
    }
    if (runtime.setSelectedBattleSquad(squadId)) {
      setSelectedSquadId(squadId);
      runtime.setFocusSquad(squadId);
      const anchor = runtime.getFocusAnchor();
      cameraRef.current.beginFocusTransition(anchor);
      setWorldActionsVisibleForSquadId(squadId);
      setBattleUiMode((prev) => (
        prev === BATTLE_UI_MODE_PATH || prev === BATTLE_UI_MODE_SKILL_CONFIRM || prev === BATTLE_UI_MODE_MARCH_PICK
          ? prev
          : BATTLE_UI_MODE_NONE
      ));
      setCards(runtime.getCardRows());
    }
  }, [
    cameraRef,
    isTrainingMode,
    runtimeRef,
    setBattleUiMode,
    setCards,
    setDeployActionAnchorMode,
    setSelectedSquadId,
    setWorldActionsVisibleForSquadId
  ]);

  const resolveDeployPlacementTeam = useCallback((worldPoint, fallbackTeam = TEAM_ATTACKER) => {
    const runtime = runtimeRef.current;
    const safeFallback = fallbackTeam === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (!runtime) return safeFallback;
    if (runtime.canDeployAt(worldPoint, TEAM_ATTACKER, 10)) return TEAM_ATTACKER;
    if (runtime.canDeployAt(worldPoint, TEAM_DEFENDER, 10)) return TEAM_DEFENDER;
    const x = Number(worldPoint?.x);
    if (Number.isFinite(x)) return x >= 0 ? TEAM_DEFENDER : TEAM_ATTACKER;
    return safeFallback;
  }, [runtimeRef]);

  const switchDeployGroupTeamForTraining = useCallback((groupId, nextTeam) => {
    const runtime = runtimeRef.current;
    const targetId = typeof groupId === 'string' ? groupId.trim() : '';
    const safeNextTeam = nextTeam === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (!runtime || !targetId) {
      return { ok: false, reason: '未找到待放置部队', groupId: targetId, team: safeNextTeam, switched: false };
    }
    const group = runtime.getDeployGroupById(targetId);
    if (!group) {
      return { ok: false, reason: '未找到待放置部队', groupId: targetId, team: safeNextTeam, switched: false };
    }
    const prevTeam = group.team === TEAM_DEFENDER ? TEAM_DEFENDER : TEAM_ATTACKER;
    if (prevTeam === safeNextTeam) {
      return { ok: true, groupId: targetId, team: prevTeam, switched: false };
    }
    if (!isTrainingMode) {
      return { ok: false, reason: '当前模式不支持切换阵营', groupId: targetId, team: prevTeam, switched: false };
    }
    const unitsMap = normalizeUnitsMapCounts(group.units || {});
    if (Object.keys(unitsMap).length <= 0) {
      return { ok: false, reason: '部队兵力配置无效', groupId: targetId, team: prevTeam, switched: false };
    }
    const snapshot = {
      name: typeof group.name === 'string' ? group.name : '',
      units: unitsMap,
      x: Number(group.x) || 0,
      y: Number(group.y) || 0
    };
    const removeResult = runtime.removeDeployGroup(prevTeam, targetId);
    if (!removeResult?.ok) {
      return { ok: false, reason: removeResult?.reason || '切换阵营失败', groupId: targetId, team: prevTeam, switched: false };
    }
    const createResult = runtime.createDeployGroup(safeNextTeam, {
      ...snapshot,
      placed: false
    });
    if (!createResult?.ok) {
      const rollbackResult = runtime.createDeployGroup(prevTeam, {
        ...snapshot,
        placed: false
      });
      if (rollbackResult?.ok) {
        const rollbackGroupId = String(rollbackResult.groupId || '');
        runtime.setSelectedDeployGroup(rollbackGroupId);
        runtime.setFocusSquad(rollbackGroupId);
        runtime.setDeployGroupPlaced(prevTeam, rollbackGroupId, false);
        setSelectedSquadId(rollbackGroupId);
        setDeployDraggingGroup({ groupId: rollbackGroupId, team: prevTeam });
        setCards(runtime.getCardRows());
        setMinimapSnapshot(runtime.getMinimapSnapshot());
      }
      return { ok: false, reason: createResult?.reason || '切换阵营失败', groupId: targetId, team: prevTeam, switched: false };
    }
    const nextGroupId = String(createResult.groupId || '');
    runtime.setSelectedDeployGroup(nextGroupId);
    runtime.setFocusSquad(nextGroupId);
    runtime.setDeployGroupPlaced(safeNextTeam, nextGroupId, false);
    setSelectedSquadId(nextGroupId);
    setDeployDraggingGroup({ groupId: nextGroupId, team: safeNextTeam });
    setCards(runtime.getCardRows());
    setMinimapSnapshot(runtime.getMinimapSnapshot());
    return { ok: true, groupId: nextGroupId, team: safeNextTeam, switched: true };
  }, [
    isTrainingMode,
    runtimeRef,
    setCards,
    setDeployDraggingGroup,
    setMinimapSnapshot,
    setSelectedSquadId
  ]);

  const isPointInsideBattleField = useCallback((point) => {
    const runtime = runtimeRef.current;
    if (!runtime) return false;
    const field = runtime.getField?.();
    const halfW = Math.max(10, Number(field?.width) || 1350) * 0.5;
    const halfH = Math.max(10, Number(field?.height) || 744) * 0.5;
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    return x >= -halfW && x <= halfW && y >= -halfH && y <= halfH;
  }, [runtimeRef]);

  const isPathPointBlocked = useCallback((point) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return true;
    if (!isPointInsideBattleField(point)) return true;
    const hit = runtime.pickBuilding(point, 8);
    return !!hit;
  }, [isPointInsideBattleField, runtimeRef]);

  return {
    handleStartBattle,
    handleCardFocus,
    handleCardSelect,
    resolveDeployPlacementTeam,
    switchDeployGroupTeamForTraining,
    isPathPointBlocked
  };
}
