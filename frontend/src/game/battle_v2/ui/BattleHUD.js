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
  debugStats,
  pitchLabel = '40°'
}) => (
  <div className="pve2-hud">
    <div className="pve2-hud-left">
      <span className="pve2-chip">{phase === 'deploy' ? '部署中' : (phase === 'ended' ? '战斗结束' : (paused ? '已暂停' : '战斗中'))}</span>
      <span className="pve2-time">{formatTime(status?.timerSec || 0)}</span>
      {status?.endReason ? <span className="pve2-reason">{status.endReason}</span> : null}
    </div>
    <div className="pve2-hud-right">
      {phase === 'deploy' ? (
        <button type="button" className="btn btn-warning" disabled={!canStart} onClick={onStart}>开战</button>
      ) : (
        <button type="button" className="btn btn-secondary" onClick={onTogglePause}>{paused ? '继续' : '暂停'}</button>
      )}
      <button type="button" className="btn btn-secondary" onClick={onTogglePitch}>视角 {pitchLabel}</button>
      <button type="button" className="btn btn-secondary" onClick={onToggleDebug}>{debugEnabled ? '关闭调试' : '调试'}</button>
      <button type="button" className="btn btn-danger" onClick={onExit}>退出</button>
    </div>
    {debugEnabled ? (
      <div className="pve2-debug-panel">
        <span>fps: {(Number(debugStats?.fps) || 0).toFixed(1)}</span>
        <span>sim: {(Number(debugStats?.simStepMs) || 0).toFixed(2)}ms</span>
        <span>render: {(Number(debugStats?.renderMs) || 0).toFixed(2)}ms</span>
        <span>agents: {Math.floor(Number(debugStats?.agentCount) || 0)}</span>
        <span>projectiles: {Math.floor(Number(debugStats?.projectileCount) || 0)}</span>
        <span>buildings: {Math.floor(Number(debugStats?.buildingCount) || 0)}</span>
      </div>
    ) : null}
  </div>
);

export default BattleHUD;
