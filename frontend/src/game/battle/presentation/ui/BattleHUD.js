import React from 'react';

const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const BattleHUD = ({
  phase,
  status,
  paused,
  onTogglePause,
  onTogglePitch,
  onExit,
  onStart,
  canStart,
  debugEnabled,
  onToggleDebug,
  pitchLabel = '40°',
  startLabel = '开战',
  speedModeLabel = '',
  onCycleSpeedMode = null
}) => (
  <div className="pve2-hud">
    <div className="pve2-hud-left">
      <span className="pve2-chip">{phase === 'deploy' ? '部署中' : (phase === 'ended' ? '战斗结束' : (paused ? '已暂停' : '战斗中'))}</span>
      <span className="pve2-time">{formatTime(status?.timerSec || 0)}</span>
      {status?.endReason ? <span className="pve2-reason">{status.endReason}</span> : null}
    </div>
    <div className="pve2-hud-right">
      {phase === 'deploy' ? (
        <button type="button" className="btn btn-warning" disabled={!canStart} onClick={onStart}>{startLabel}</button>
      ) : (
        <>
          <button type="button" className="btn btn-secondary" onClick={onTogglePause}>{paused ? '继续' : '暂停'}</button>
          {typeof onCycleSpeedMode === 'function' ? (
            <button type="button" className="btn btn-secondary btn-small" onClick={onCycleSpeedMode}>
              {`速度 ${speedModeLabel || '-'}`}
            </button>
          ) : null}
        </>
      )}
      <button type="button" className="btn btn-secondary" onClick={onTogglePitch}>视角 {pitchLabel}</button>
      <button type="button" className="btn btn-secondary" onClick={onToggleDebug}>{debugEnabled ? '关闭调试' : '调试'}</button>
      <button type="button" className="btn btn-danger" onClick={onExit}>退出</button>
    </div>
  </div>
);

export default BattleHUD;
