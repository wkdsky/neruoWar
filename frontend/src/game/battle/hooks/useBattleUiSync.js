import { useEffect, useState } from 'react';

const EMPTY_STATUS = { phase: 'deploy', timerSec: 0, ended: false, endReason: '' };

export default function useBattleUiSync({
  runtimeRef,
  intervalMs = 120,
  enabled = false
} = {}) {
  const [battleStatus, setBattleStatus] = useState(EMPTY_STATUS);
  const [cardRows, setCardRows] = useState([]);
  const [minimapSnapshot, setMinimapSnapshot] = useState(null);

  useEffect(() => {
    if (!enabled) {
      setBattleStatus(EMPTY_STATUS);
      setCardRows([]);
      setMinimapSnapshot(null);
      return undefined;
    }
    let timerId = 0;
    const sync = () => {
      const runtime = runtimeRef?.current;
      if (!runtime) return;
      setBattleStatus(runtime.getBattleStatus?.() || EMPTY_STATUS);
      setCardRows(runtime.getCardRows?.() || []);
      setMinimapSnapshot(runtime.getMinimapSnapshot?.() || null);
    };
    sync();
    timerId = window.setInterval(sync, Math.max(30, Number(intervalMs) || 120));
    return () => {
      if (timerId) window.clearInterval(timerId);
    };
  }, [enabled, intervalMs, runtimeRef]);

  return {
    phase: battleStatus?.phase || 'deploy',
    battleStatus,
    cardRows,
    minimapSnapshot,
    setBattleStatus,
    setCardRows,
    setMinimapSnapshot
  };
}
