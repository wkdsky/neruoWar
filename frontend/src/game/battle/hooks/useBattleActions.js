import { useCallback } from 'react';
import {
  BATTLE_UI_MODE_GUARD,
  BATTLE_UI_MODE_MARCH_PICK,
  BATTLE_UI_MODE_NONE,
  BATTLE_UI_MODE_PATH,
  BATTLE_UI_MODE_SKILL_CONFIRM,
  BATTLE_UI_MODE_SKILL_PICK,
  SPEED_MODE_AUTO,
  SPEED_MODE_B,
  SPEED_MODE_CYCLE,
  TEAM_ATTACKER
} from '../screens/battleSceneConstants';
import { clamp, skillAoeRadiusByClass } from '../screens/battleSceneUtils';

export default function useBattleActions({
  runtimeRef,
  cameraRef,
  glCanvasRef,
  worldToDomRef,
  selectedSquadId = '',
  battleUiMode = BATTLE_UI_MODE_NONE,
  pendingPathPoints = [],
  setCards,
  setSelectedSquadId,
  setWorldActionsVisibleForSquadId,
  setSkillConfirmState,
  setBattleUiMode,
  setClockPaused,
  setPendingPathPoints,
  setPlanningHoverPoint,
  setMarchModePickOpen,
  setMarchPopupPos,
  setSkillPopupPos,
  setSkillPopupSquadId
} = {}) {
  const resolvePopupPos = useCallback((payload, fallbackWorld = null) => {
    const canvas = glCanvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) {
      return { x: 120, y: 120 };
    }
    let x = Number(payload?.clientX) - rect.left;
    let y = Number(payload?.clientY) - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (fallbackWorld && worldToDomRef.current) {
        const dom = worldToDomRef.current({ x: fallbackWorld.x, y: fallbackWorld.y, z: 0 });
        if (dom?.visible) {
          x = Number(dom.x);
          y = Number(dom.y);
        }
      }
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      x = rect.width * 0.5;
      y = rect.height * 0.5;
    }
    return {
      x: clamp(x, 16, Math.max(16, rect.width - 16)),
      y: clamp(y, 16, Math.max(16, rect.height - 16))
    };
  }, [glCanvasRef, worldToDomRef]);

  const syncBattleCards = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setCards(runtime.getCardRows());
  }, [runtimeRef, setCards]);

  const selectBattleSquad = useCallback((squadId, showActions = true) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return false;
    if (!runtime.setSelectedBattleSquad(squadId)) return false;
    runtime.setFocusSquad(squadId);
    const anchor = runtime.getFocusAnchor();
    cameraRef.current.beginFocusTransition(anchor);
    setSelectedSquadId(squadId);
    if (showActions) {
      setWorldActionsVisibleForSquadId(squadId);
    }
    syncBattleCards();
    return true;
  }, [cameraRef, runtimeRef, setSelectedSquadId, setWorldActionsVisibleForSquadId, syncBattleCards]);

  const closeSkillConfirm = useCallback((resumeBattle = true) => {
    setSkillConfirmState(null);
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    if (resumeBattle) setClockPaused(false);
  }, [setBattleUiMode, setClockPaused, setSkillConfirmState]);

  const closeSkillPick = useCallback(() => {
    if (battleUiMode === BATTLE_UI_MODE_SKILL_PICK) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
    }
    setSkillPopupSquadId('');
  }, [battleUiMode, setBattleUiMode, setSkillPopupSquadId]);

  const commitPathPlanning = useCallback((commit = true) => {
    const runtime = runtimeRef.current;
    if (runtime && commit && selectedSquadId) {
      runtime.commandSetWaypoints(selectedSquadId, pendingPathPoints, { inputType: 'path_planning' });
      syncBattleCards();
    }
    setPendingPathPoints([]);
    setPlanningHoverPoint(null);
    setBattleUiMode(BATTLE_UI_MODE_NONE);
    setClockPaused(false);
  }, [
    pendingPathPoints,
    runtimeRef,
    selectedSquadId,
    setBattleUiMode,
    setClockPaused,
    setPendingPathPoints,
    setPlanningHoverPoint,
    syncBattleCards
  ]);

  const closeMarchModePick = useCallback(() => {
    setMarchModePickOpen(false);
    if (battleUiMode === BATTLE_UI_MODE_MARCH_PICK) {
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setClockPaused(false);
    }
  }, [battleUiMode, setBattleUiMode, setClockPaused, setMarchModePickOpen]);

  const executeBattleAction = useCallback((squadId, actionId, payload = null) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    if (!selectBattleSquad(squadId, true)) return;
    const squad = runtime.getSquadById(squadId);
    if (!squad) return;
    const popupPos = resolvePopupPos(payload, { x: Number(squad.x) || 0, y: Number(squad.y) || 0 });

    if (actionId !== 'marchMode') {
      closeMarchModePick();
    }
    if (actionId !== 'skills') {
      closeSkillPick();
    }

    if (actionId === 'planPath') {
      setPendingPathPoints([]);
      setPlanningHoverPoint(null);
      setBattleUiMode(BATTLE_UI_MODE_PATH);
      setClockPaused(true);
      return;
    }
    if (actionId === 'marchMode') {
      setBattleUiMode(BATTLE_UI_MODE_MARCH_PICK);
      setMarchModePickOpen(true);
      setMarchPopupPos(popupPos);
      setClockPaused(true);
      return;
    }
    if (actionId === 'freeAttack') {
      runtime.commandGuard(squadId, {
        centerX: Number(squad.x) || 0,
        centerY: Number(squad.y) || 0,
        radius: Math.max(42, Number(squad.radius) || 24)
      });
      setBattleUiMode(BATTLE_UI_MODE_GUARD);
      setTimeout(() => setBattleUiMode(BATTLE_UI_MODE_NONE), 0);
      syncBattleCards();
      return;
    }
    if (actionId === 'skills') {
      setSkillPopupPos(popupPos);
      setSkillPopupSquadId(squadId);
      setBattleUiMode(BATTLE_UI_MODE_SKILL_PICK);
      setSkillConfirmState(null);
      return;
    }
    if (actionId === 'standby') {
      runtime.commandBehavior(squadId, 'standby');
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      syncBattleCards();
      return;
    }
    if (actionId === 'retreat') {
      runtime.commandBehavior(squadId, 'retreat');
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      syncBattleCards();
    }
  }, [
    closeMarchModePick,
    closeSkillPick,
    resolvePopupPos,
    runtimeRef,
    selectBattleSquad,
    setBattleUiMode,
    setClockPaused,
    setMarchModePickOpen,
    setMarchPopupPos,
    setPendingPathPoints,
    setPlanningHoverPoint,
    setSkillConfirmState,
    setSkillPopupPos,
    setSkillPopupSquadId,
    syncBattleCards
  ]);

  const handleSetSpeedMode = useCallback((mode) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const selected = runtime.getSquadById(selectedSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;
    runtime.commandSpeedMode([selected.id], mode, 'USER');
    setCards(runtime.getCardRows());
  }, [runtimeRef, selectedSquadId, setCards]);

  const handleCycleSpeedMode = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const row = runtime.getCardRows().find((item) => item.id === selectedSquadId);
    const current = row
      ? (row.speedModeAuthority === 'USER' ? (row.speedMode || SPEED_MODE_B) : SPEED_MODE_AUTO)
      : SPEED_MODE_B;
    const idx = Math.max(0, SPEED_MODE_CYCLE.indexOf(current));
    const next = SPEED_MODE_CYCLE[(idx + 1) % SPEED_MODE_CYCLE.length];
    handleSetSpeedMode(next);
  }, [handleSetSpeedMode, runtimeRef, selectedSquadId]);

  const handleBattleActionClick = useCallback((squadId, actionId, payload = null) => {
    executeBattleAction(squadId, actionId, payload);
  }, [executeBattleAction]);

  const handleSkillPick = useCallback((skill, meta = {}) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle') return;
    const candidateSquadId = typeof meta?.squadId === 'string' && meta.squadId
      ? meta.squadId
      : selectedSquadId;
    const selected = runtime.getSquadById(candidateSquadId);
    if (!selected || selected.team !== TEAM_ATTACKER || selected.remain <= 0) return;
    if (selected.id !== selectedSquadId) {
      selectBattleSquad(selected.id, true);
    }
    if (!skill?.available) return;
    closeSkillPick();
    const kind = (skill.kind === 'infantry' || skill.kind === 'cavalry' || skill.kind === 'archer' || skill.kind === 'artillery')
      ? skill.kind
      : (selected.classTag || 'infantry');
    const center = skill?.anchor && Number.isFinite(Number(skill.anchor.x)) && Number.isFinite(Number(skill.anchor.y))
      ? { x: Number(skill.anchor.x), y: Number(skill.anchor.y) }
      : (
        selected?.classCenters?.[kind]
          ? {
              x: Number(selected.classCenters[kind].x) || Number(selected.x) || 0,
              y: Number(selected.classCenters[kind].y) || Number(selected.y) || 0
            }
          : { x: Number(selected.x) || 0, y: Number(selected.y) || 0 }
      );
    if (kind === 'infantry') {
      runtime.commandSkill(selected.id, {
        kind: 'infantry',
        x: center.x,
        y: center.y
      });
      setSkillConfirmState(null);
      setBattleUiMode(BATTLE_UI_MODE_NONE);
      setClockPaused(false);
      syncBattleCards();
      return;
    }
    if (kind === 'cavalry') {
      const dirX = Number(selected.dirX) || 1;
      const dirY = Number(selected.dirY) || 0;
      const len = 82;
      setSkillConfirmState({
        squadId: selected.id,
        kind: 'cavalry',
        center,
        dir: { x: dirX, y: dirY },
        len,
        aoeRadius: 0,
        hoverPoint: { x: center.x + (dirX * len), y: center.y + (dirY * len) }
      });
      setBattleUiMode(BATTLE_UI_MODE_SKILL_CONFIRM);
      setClockPaused(true);
      return;
    }
    const aoeRadius = skillAoeRadiusByClass(kind);
    setSkillConfirmState({
      squadId: selected.id,
      kind: kind === 'artillery' ? 'artillery' : 'archer',
      center,
      dir: { x: 1, y: 0 },
      len: 0,
      aoeRadius,
      hoverPoint: { x: center.x, y: center.y }
    });
    setBattleUiMode(BATTLE_UI_MODE_SKILL_CONFIRM);
    setClockPaused(true);
  }, [
    closeSkillPick,
    runtimeRef,
    selectBattleSquad,
    selectedSquadId,
    setBattleUiMode,
    setClockPaused,
    setSkillConfirmState,
    syncBattleCards
  ]);

  const handleFinishPathPlanning = useCallback(() => {
    commitPathPlanning(true);
  }, [commitPathPlanning]);

  const handlePickMarchMode = useCallback((mode) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getPhase() !== 'battle' || !selectedSquadId) return;
    runtime.commandMarchMode(selectedSquadId, mode);
    syncBattleCards();
    closeMarchModePick();
  }, [closeMarchModePick, runtimeRef, selectedSquadId, syncBattleCards]);

  return {
    syncBattleCards,
    selectBattleSquad,
    closeSkillConfirm,
    closeSkillPick,
    commitPathPlanning,
    closeMarchModePick,
    executeBattleAction,
    handleSetSpeedMode,
    handleCycleSpeedMode,
    handleBattleActionClick,
    handleSkillPick,
    handleFinishPathPlanning,
    handlePickMarchMode
  };
}
