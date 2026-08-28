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
  onToggleMidlineDebug = null,
  onStartPerformanceCapture = null,
  onStopPerformanceCapture = null,
  onExportPerformanceReport = null
}) => {
  const [performanceScenario, setPerformanceScenario] = React.useState('');
  const performanceCapture = stats?.performanceCapture || {};
  const performanceMetrics = performanceCapture.metrics || {};
  const simulationMetrics = performanceMetrics.simulationMs || {};
  const renderMetrics = performanceMetrics.renderMs || {};
  const fpsMetrics = performanceMetrics.fps || {};
  const captureStatus = performanceCapture.active
    ? '记录中'
    : (performanceCapture.startedAtMs ? '已停止' : '未开始');
  const lines = [
    `阶段：${phaseLabel(phase)}`,
    `性能：FPS ${formatFixed(stats?.fps, 1)} ｜ 模拟 ${formatFixed(stats?.simStepMs, 2)}ms ｜ 渲染 ${formatFixed(stats?.renderMs, 2)}ms`,
    `性能采样：${captureStatus} ｜ 场景 ${performanceCapture.scenario || '-'} ｜ 时长 ${formatFixed((Number(performanceCapture.durationMs) || 0) / 1000, 1)}s ｜ 样本 sim ${formatInt(performanceCapture.sampleCounts?.simulationMs)} / render ${formatInt(performanceCapture.sampleCounts?.renderMs)} / fps ${formatInt(performanceCapture.sampleCounts?.fps)}`,
    `性能分位：模拟 p50/p95 ${formatFixed(simulationMetrics.p50, 2)}/${formatFixed(simulationMetrics.p95, 2)}ms ｜ 渲染 p50/p95 ${formatFixed(renderMetrics.p50, 2)}/${formatFixed(renderMetrics.p95, 2)}ms ｜ FPS p50/p95 ${formatFixed(fpsMetrics.p50, 1)}/${formatFixed(fpsMetrics.p95, 1)}`,
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
      if (score?.terms) {
        lines.push(`地图目标评分：${score.targetId || '-'} ｜ total ${formatFixed(score.score, 2)} ｜ 距离 ${formatFixed(score.terms.distance, 2)} ｜ 路线 ${formatFixed(score.terms.lane, 2)} ｜ 威胁 ${formatFixed(score.terms.threat, 2)} ｜ 保护 ${formatFixed(score.terms.protectedArea, 2)}`);
      } else {
        lines.push(`目标评分：${score.targetId || '-'} ｜ total ${formatFixed(score.score, 2)} ｜ atk ${formatFixed(score.atkTerm, 2)} ｜ frag ${formatFixed(score.fragTerm, 2)} ｜ lowHp ${formatFixed(score.lowHpBonus, 2)}`);
      }
    }
    if (selectedSquad?.trainingAi) {
      const ai = selectedSquad.trainingAi;
      const lastEvent = Array.isArray(ai.events) ? ai.events[ai.events.length - 1] : null;
      lines.push(`地图AI：${ai.state || '-'} ｜ 目标 ${ai.targetId || '-'} ｜ 重试 ${formatInt(ai.retries)} ｜ 上次切换 ${lastEvent?.reason || '-'}`);
    }
    if (selectedSquad?.formationRuntime) {
      const formation = selectedSquad.formationRuntime;
      lines.push(`编队控制：${formation.state || '-'} ｜ 请求/实际 ${formation.requestedFormation || '-'}/${formation.activeFormation || '-'} ｜ 就绪 ${formatFixed((Number(formation.readyRatio) || 0) * 100, 0)}% ｜ cohesion ${formatFixed(formation.speedScale, 2)}`);
      lines.push(`地形适配：压缩 ${formatFixed((Number(formation.compression) || 1) * 100, 0)}% ｜ 通道 ${formation.passage ? '是' : '否'} ｜ 宽度 ${formation.corridorWidth === null ? '-' : formatFixed(formation.corridorWidth, 1)}`);
    }
    if (selectedSquad?.combatRuntime) {
      const combat = selectedSquad.combatRuntime;
      lines.push(`战斗控制：${combat.state || '-'} ｜ 意图 ${combat.intent || '-'} ｜ 目标 ${combat.targetId || '-'} ｜ 分配 ${formatInt(combat.assignedCount)} ｜ 支援预约 ${formatInt(combat.supportReservations)}`);
    }
  }

  return (
    <div className="pve2-debug-merged-panel">
      <div className="pve2-debug-actions">
        {typeof onStartPerformanceCapture === 'function' ? (
          <input
            type="text"
            className="pve2-debug-performance-scenario"
            value={performanceScenario}
            onChange={(event) => setPerformanceScenario(event.target.value)}
            placeholder="场景，如 100-unit-pathing"
            aria-label="性能采样场景"
          />
        ) : null}
        {typeof onStartPerformanceCapture === 'function' ? (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => onStartPerformanceCapture(performanceScenario)}
          >
            {performanceCapture.active ? '重新开始采样' : '开始性能采样'}
          </button>
        ) : null}
        {typeof onStopPerformanceCapture === 'function' ? (
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={onStopPerformanceCapture}
            disabled={!performanceCapture.active}
          >
            停止采样
          </button>
        ) : null}
        {typeof onExportPerformanceReport === 'function' ? (
          <button type="button" className="btn btn-secondary btn-small" onClick={onExportPerformanceReport}>
            导出性能 JSON
          </button>
        ) : null}
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
