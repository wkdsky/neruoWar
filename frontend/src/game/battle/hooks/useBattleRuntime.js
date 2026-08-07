import { useCallback, useEffect, useRef, useState } from 'react';
import BattleRuntime from '../presentation/runtime/BattleRuntime';
import normalizeUnitTypes from '../../unit/normalizeUnitTypes';

export default function useBattleRuntime({
  open = false,
  initData = null,
  mode = 'siege',
  visualConfig = null
} = {}) {
  const runtimeRef = useRef(null);
  const [phase, setPhase] = useState('deploy');
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [trainingSessionActive, setTrainingSessionActive] = useState(false);

  const disposeRuntime = useCallback(() => {
    runtimeRef.current = null;
    setPhase('deploy');
    setRuntimeVersion(0);
    setTrainingSessionActive(false);
  }, []);

  useEffect(() => {
    if (!open || !initData) {
      disposeRuntime();
      return undefined;
    }
    const normalizedInitData = {
      ...initData,
      unitTypes: normalizeUnitTypes(
        Array.isArray(initData?.unitTypes) ? initData.unitTypes : [],
        { enabledOnly: true }
      )
    };
    const runtime = new BattleRuntime(normalizedInitData, {
      repConfig: {
        maxAgentWeight: 50,
        damageExponent: 0.75,
        strictAgentMapping: true
      },
      visualConfig: visualConfig || {},
      rules: mode === 'training' ? { allowCrossMidline: true } : undefined
    });
    runtimeRef.current = runtime;
    setTrainingSessionActive(false);
    setRuntimeVersion((prev) => prev + 1);
    const cardsRows = runtime.getCardRows();
    const initialSelected = runtime.getDeployGroups()?.selectedId || cardsRows.find((row) => row.team === 'attacker')?.id || '';
    runtime.setFocusSquad(initialSelected);
    setPhase(runtime.getPhase());
    return () => {
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [disposeRuntime, initData, mode, open, visualConfig]);

  const startBattle = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return { ok: false, reason: 'runtime 未初始化' };
    const result = runtime.startBattle();
    setPhase(runtime.getPhase());
    if (result?.ok && mode === 'training') setTrainingSessionActive(true);
    return result;
  }, [mode]);

  const resetTraining = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime || mode !== 'training') return { ok: false, reason: '训练场未初始化' };
    const result = runtime.resetTraining?.() || { ok: false, reason: '当前运行时不支持重置' };
    if (result?.ok) {
      setPhase(runtime.getPhase());
      setTrainingSessionActive(false);
    }
    return result;
  }, [mode]);

  return {
    runtimeRef,
    phase,
    runtimeVersion,
    trainingSessionActive,
    setPhase,
    api: {
      startBattle,
      resetTraining
    }
  };
}
