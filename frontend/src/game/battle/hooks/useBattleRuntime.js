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

  const disposeRuntime = useCallback(() => {
    runtimeRef.current = null;
    setPhase('deploy');
    setRuntimeVersion(0);
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
    return result;
  }, []);

  return {
    runtimeRef,
    phase,
    runtimeVersion,
    setPhase,
    api: {
      startBattle
    }
  };
}
