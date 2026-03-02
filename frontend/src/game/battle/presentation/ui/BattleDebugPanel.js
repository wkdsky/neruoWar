import React from 'react';

const formatFixed = (value, digits = 2) => (Number(value) || 0).toFixed(digits);
const formatInt = (value) => Math.max(0, Math.floor(Number(value) || 0));
const formatBool = (value) => (value ? '是' : '否');

const phaseLabel = (phase) => {
  if (phase === 'deploy') return '部署阶段';
  if (phase === 'battle') return '战斗阶段';
  if (phase === 'ended') return '战斗结束';
  return phase || '-';
};

const speedPolicyLabel = (value = '') => {
  if (value === 'RETREAT') return '撤退(C)';
  if (value === 'REFORM') return '重整';
  return '行军(B)';
};

const orderTypeLabel = (value = '') => {
  if (value === 'ATTACK_MOVE') return '攻击前进';
  if (value === 'CHARGE') return '冲锋';
  if (value === 'MOVE') return '移动';
  return '待命';
};

const BattleDebugPanel = ({
  phase = '',
  stats = {},
  camera = {},
  selectedSquad = null,
  showMidlineDebug = true,
  onToggleMidlineDebug = null
}) => {
  const lines = [
    `阶段：${phaseLabel(phase)}`,
    `性能：FPS ${formatFixed(stats?.fps, 1)} ｜ 模拟 ${formatFixed(stats?.simStepMs, 2)}ms ｜ 渲染 ${formatFixed(stats?.renderMs, 2)}ms`,
    `渲染对象：小人模型 ${formatInt(stats?.unitModelCount ?? stats?.agentCount)} ｜ 投射物 ${formatInt(stats?.projectileCount)} ｜ 建筑 ${formatInt(stats?.buildingCount)}`,
    `相机锚点：原始(${formatFixed(stats?.cameraAnchorRawX, 2)}, ${formatFixed(stats?.cameraAnchorRawY, 2)}) ｜ 平滑(${formatFixed(stats?.cameraAnchorSmoothX, 2)}, ${formatFixed(stats?.cameraAnchorSmoothY, 2)}) ｜ 差值 ${formatFixed(stats?.cameraAnchorDelta, 3)}`,
    `中线规则：允许跨中线 ${formatBool(stats?.allowCrossMidline)} ｜ 上帧Clamp ${formatBool(stats?.clampChanged)} ｜ 选中编队 ${stats?.clampSquadId || '-'}`,
    `中线数据：preX ${formatFixed(stats?.clampPreX, 2)} -> postX ${formatFixed(stats?.clampPostX, 2)} ｜ radius ${formatFixed(stats?.clampRadius, 2)} ｜ 范围[${formatFixed(stats?.clampAllowedMinX, 2)}, ${formatFixed(stats?.clampAllowedMaxX, 2)}]`,
    `相机实现：${camera?.cameraImplTag || '-'} ｜ 镜像X ${formatBool(camera?.mirrorX)} ｜ 手性 ${formatFixed(camera?.handedness, 4)}`,
    `跟随目标：(${formatFixed(camera?.followTargetX, 2)}, ${formatFixed(camera?.followTargetY, 2)}) ｜ 编队ID ${camera?.followTargetSquadId || '-'}`,
    `鼠标坐标：(${formatFixed(camera?.pointerX, 2)}, ${formatFixed(camera?.pointerY, 2)}) ｜ 坐标有效 ${formatBool(camera?.pointerValid)} ｜ 正在平移 ${formatBool(camera?.isPanning)}`
  ];

  if (selectedSquad) {
    lines.push(
      `选中编队：${selectedSquad.name || selectedSquad.id || '-'} ｜ 命令 ${orderTypeLabel(selectedSquad.orderType)} ｜ 速度策略 ${speedPolicyLabel(selectedSquad.speedPolicy)}`
    );
    lines.push(
      `速度模式：${selectedSquad.speedMode || 'B_HARMONIC'} ｜ 模式权限 ${selectedSquad.speedModeAuthority || 'AI'}`
    );
    if (selectedSquad?.debugTargetScore) {
      const score = selectedSquad.debugTargetScore;
      lines.push(`目标评分：${score.targetId || '-'} ｜ total ${formatFixed(score.score, 2)} ｜ atk ${formatFixed(score.atkTerm, 2)} ｜ frag ${formatFixed(score.fragTerm, 2)} ｜ lowHp ${formatFixed(score.lowHpBonus, 2)}`);
    }
  }

  return (
    <div className="pve2-debug-merged-panel">
      <div className="pve2-debug-actions">
        {typeof onToggleMidlineDebug === 'function' ? (
          <button type="button" className="btn btn-secondary btn-small" onClick={onToggleMidlineDebug}>
            {showMidlineDebug ? '隐藏中线调试' : '显示中线调试'}
          </button>
        ) : null}
      </div>
      {lines.join('\n')}
    </div>
  );
};

export default BattleDebugPanel;
