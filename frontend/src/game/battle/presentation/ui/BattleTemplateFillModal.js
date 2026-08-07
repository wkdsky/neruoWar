import React from 'react';
import { createPortal } from 'react-dom';
import useDraggablePanel from './useDraggablePanel';
import './Battle.css';

const NUMBER_PAD_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['清空', '0', '删除']
];

const formatCount = (value) => new Intl.NumberFormat('zh-CN').format(
  Math.max(0, Math.floor(Number(value) || 0))
);

const formatMetric = (value, digits = 1) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : (0).toFixed(digits);
};

const resolveUnitTone = (unitTypeId = '', index = 0) => {
  const key = String(unitTypeId || '').toLowerCase();
  if (key.includes('support')) return 'support';
  if (key.includes('ranged') || key.includes('archer')) return 'ranged';
  if (key.includes('melee') || key.includes('cavalry')) return 'melee';
  return ['melee', 'ranged', 'support'][index % 3];
};

const resolveUnitToneLabel = (tone) => (
  tone === 'ranged' ? '远程' : (tone === 'support' ? '辅助' : '近战')
);

const BattleTemplateFillModal = ({
  open = false,
  preview = null,
  isTrainingMode = false,
  onClose,
  onChangeTotal,
  onChangeTeam,
  onChangeControlMode,
  onChangeName,
  onConfirm
}) => {
  const { panelRef, panelStyle, handleHeaderPointerDown } = useDraggablePanel({
    open,
    defaultSize: { width: 1040, height: 680 }
  });
  if (!open) return null;

  const totalRequested = Math.max(0, Number(preview?.totalRequested) || 0);
  const totalFilled = Math.max(0, Number(preview?.totalFilled) || 0);
  const maxTotal = Math.max(0, Number(preview?.maxTotal) || 0);
  const rows = Array.isArray(preview?.rows) ? preview.rows : [];
  const team = preview?.team === 'defender' ? 'defender' : 'attacker';
  const controlMode = preview?.controlMode === 'AI' ? 'AI' : 'USER';
  const mode = preview?.mode === 'edit' ? 'edit' : 'create';
  const isEditing = mode === 'edit';
  const templateName = preview?.template?.name || '未命名模板';
  const troopName = String(preview?.name || templateName || '').trim();
  const canConfirm = totalRequested > 0 && totalFilled === totalRequested;
  const showKnowledgeCosts = !isTrainingMode && preview?.knowledgeCostEnabled === true;
  const totalKnowledgeCost = Math.max(0, Math.floor(Number(preview?.totalCost) || 0));
  const stats = preview?.stats && typeof preview.stats === 'object' ? preview.stats : {};
  const baseStats = [
    { label: '总兵力', value: formatCount(totalRequested) },
    { label: '总生命', value: formatCount(stats.totalHp) },
    { label: '总攻击', value: formatCount(stats.totalAtk) },
    { label: '总防御', value: formatCount(stats.totalDef) },
    { label: '编队移速', value: formatMetric(stats.cohesiveSpeed) },
    { label: '有效射程', value: formatMetric(stats.range) }
  ];
  const showTeamSwitch = isTrainingMode && !isEditing;

  const handleBackdropPointerDown = (event) => {
    event.stopPropagation();
    if (event.target === event.currentTarget) onClose?.();
  };

  const stopModalInteraction = (event) => event.stopPropagation();

  const changeByNumberPad = (key) => {
    if (key === '清空') {
      onChangeTotal?.(0);
      return;
    }
    if (key === '删除') {
      const previous = String(Math.max(0, Math.floor(totalRequested))).slice(0, -1);
      onChangeTotal?.(previous || 0);
      return;
    }
    const prefix = totalRequested > 0 ? String(Math.floor(totalRequested)) : '';
    onChangeTotal?.(`${prefix}${key}`);
  };

  const modal = (
    <div
      className="pve2-template-fill-backdrop"
      onPointerDown={handleBackdropPointerDown}
      onMouseDown={stopModalInteraction}
      onClick={stopModalInteraction}
      onWheelCapture={stopModalInteraction}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        ref={panelRef}
        className={`pve2-template-fill-panel ${showTeamSwitch ? 'is-training' : 'is-combat'}`}
        style={panelStyle}
        onPointerDown={stopModalInteraction}
        onMouseDown={stopModalInteraction}
        onClick={stopModalInteraction}
        onWheelCapture={stopModalInteraction}
      >
        <div className="pve2-template-fill-head pve2-drag-handle" onPointerDown={handleHeaderPointerDown}>
          <label className="pve2-template-fill-title-block">
            <span>部队名称</span>
            <input
              type="text"
              maxLength={32}
              value={troopName}
              placeholder={templateName}
              data-no-drag
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => onChangeName?.(event.target.value)}
            />
            <em>{isEditing ? '编辑现有部队 · 数值会随总兵力同步更新' : (isTrainingMode ? '训练用部队 · 不消耗真实士兵' : '实际参战部队 · 使用真实兵力')}</em>
          </label>
          <div className="pve2-template-fill-skill-badge" title="部队创建后可在技能树中配置技能">
            <span aria-hidden="true">⚑</span>
            <div>
              <strong>技能树</strong>
              <em>创建后可配置</em>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            data-no-drag
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onClose?.()}
          >
            关闭
          </button>
        </div>
        <section className="pve2-template-fill-overview">
          <div className="pve2-template-fill-section-head">
            <div>
              <strong>部队基础参数一览</strong>
              <span>随下方总兵力动态变化</span>
            </div>
            <em>{isTrainingMode ? '训练编制' : '实际编制'}</em>
          </div>
          <dl className="pve2-template-fill-stats">
            {baseStats.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {showTeamSwitch && (
          <div className="pve2-template-fill-team-switch" role="group" aria-label="选择部队归属方与控制权">
            <span className="pve2-template-fill-team-label">归属方</span>
            <button
              type="button"
              className={`pve2-template-fill-team-option is-attacker ${team === 'attacker' ? 'is-active' : ''}`}
              onClick={() => onChangeTeam?.('attacker')}
            >
              <i aria-hidden="true" />
              我方
            </button>
            <button
              type="button"
              className={`pve2-template-fill-team-option is-defender ${team === 'defender' ? 'is-active' : ''}`}
              onClick={() => onChangeTeam?.('defender')}
            >
              <i aria-hidden="true" />
              敌方
            </button>
            <span className="pve2-template-fill-team-label">控制权</span>
            <button
              type="button"
              className={`pve2-template-fill-team-option is-user ${controlMode === 'USER' ? 'is-active' : ''}`}
              onClick={() => onChangeControlMode?.('USER')}
            >
              <i aria-hidden="true" />
              用户操作
            </button>
            <button
              type="button"
              className={`pve2-template-fill-team-option is-ai ${controlMode === 'AI' ? 'is-active' : ''}`}
              onClick={() => onChangeControlMode?.('AI')}
            >
              <i aria-hidden="true" />
              AI接管
            </button>
          </div>
        )}
        <section className="pve2-template-fill-units" aria-label="模板兵种明细">
          <div className="pve2-template-fill-section-head">
            <div>
              <strong>模板兵种</strong>
              <span>按模板占比自动分配实际数量</span>
            </div>
            <em>{`模板占比 ${rows.reduce((sum, row) => sum + Math.max(0, Number(row?.percent) || 0), 0)}%`}</em>
          </div>
          <div className="pve2-template-fill-list">
            {rows.map((row, index) => {
              const tone = resolveUnitTone(row.unitTypeId, index);
              const unitName = row.unitName || row.unitTypeId || '未知兵种';
              const unitCost = Math.max(0, Math.floor(Number(row?.unitCost) || 0));
              const unitTotalCost = Math.max(0, Math.floor(Number(row?.totalCost) || 0));
              return (
                <article key={`fill-${row.unitTypeId}`} className="pve2-template-fill-row">
                  <div className={`pve2-template-fill-unit-mark is-${tone}`} aria-hidden="true">
                    <strong>{String(unitName).trim().slice(0, 1) || '兵'}</strong>
                    <span>{resolveUnitToneLabel(tone)}</span>
                  </div>
                  <div className="pve2-template-fill-meta">
                    <div>
                      <strong>{unitName}</strong>
                      <em>{resolveUnitToneLabel(tone)}</em>
                    </div>
                    <span>{`模板占比 ${row.percent || 0}%`}</span>
                    <b>{`实际数量 ${formatCount(row.requested)}`}</b>
                  </div>
                  <div className={`pve2-template-fill-allocation ${showKnowledgeCosts ? 'is-knowledge-cost' : ''}`}>
                    {showKnowledgeCosts ? (
                      <>
                        <span>{`单价 ${formatCount(unitCost)} 知识点/人`}</span>
                        <strong>{`消耗 ${formatCount(unitTotalCost)} 知识点`}</strong>
                      </>
                    ) : (
                      <>
                        <span>{`可用 ${formatCount(row.available)}`}</span>
                        <strong>{`已匹配 ${formatCount(row.filled)}`}</strong>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <section className="pve2-template-fill-quantity">
          <div className="pve2-template-fill-section-head">
            <div>
              <strong>部队总兵力</strong>
              <span>{isTrainingMode ? '训练部队默认 0 人，上限 1 万人' : (showKnowledgeCosts ? '实际部队上限按当前知识点余额计算' : '实际部队采用当前可用真实兵力上限')}</span>
            </div>
            <div className="pve2-template-fill-total-summary">
              <output>{formatCount(totalRequested)}</output>
              {showKnowledgeCosts ? <strong>{`总消耗 ${formatCount(totalKnowledgeCost)} 知识点`}</strong> : null}
            </div>
          </div>
          <input
            type="range"
            className="pve2-template-fill-slider"
            min={0}
            max={Math.max(0, Math.floor(maxTotal))}
            step={1}
            value={Math.min(Math.max(0, Math.floor(totalRequested)), Math.max(0, Math.floor(maxTotal)))}
            disabled={maxTotal <= 0}
            onChange={(event) => onChangeTotal?.(event.target.value)}
            aria-label="部队总兵力"
          />
          <div className="pve2-template-fill-total-control">
            <label>
              <span>数量拖动条</span>
              <input
                type="number"
                min={0}
                max={maxTotal}
                value={totalRequested}
                inputMode="numeric"
                disabled={maxTotal <= 0}
                onChange={(event) => onChangeTotal?.(event.target.value)}
              />
            </label>
          </div>
        </section>
        <div className="pve2-template-fill-bottom">
          <div className="pve2-template-fill-keypad" aria-label="数量数字键盘">
            {NUMBER_PAD_ROWS.flat().map((key) => (
              <button
                key={key}
                type="button"
                className={`pve2-template-fill-key ${key === '清空' || key === '删除' ? 'is-utility' : ''}`}
                disabled={maxTotal <= 0}
                onClick={() => changeByNumberPad(key)}
              >
                {key === '删除' ? '⌫' : key}
              </button>
            ))}
          </div>
          <div className="pve2-template-fill-actions">
            <button type="button" className="btn btn-secondary" onClick={() => onClose?.()}>取消</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canConfirm}
              onClick={() => onConfirm?.()}
            >
              {isEditing ? '保存部队' : (isTrainingMode ? '创建训练部队' : '创建参战部队')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
};

export default BattleTemplateFillModal;
