import React, { useState } from 'react';
import { ArrowUpDown, Ban, Bot, Pencil, Plus, Trash2, User, UserPlus } from 'lucide-react';
import DeployActionButtons from './DeployActionButtons';
import BattleActionButtons from './BattleActionButtons';
import TrainingSkillSlots from './TrainingSkillSlots';
import BattleFormationSlots from './BattleFormationSlots';
import { normalizeTemplateUnits } from '../../screens/battleSceneUtils';

const iconByClass = {
  infantry: '步',
  cavalry: '骑',
  archer: '弓',
  artillery: '炮'
};

const labelByClass = {
  infantry: '步兵',
  cavalry: '骑兵',
  archer: '弓兵',
  artillery: '炮兵'
};

const SPEED_MODE_C = 'C_PER_TYPE';
const speedModeBadge = (row = {}) => {
  if (row?.speedModeAuthority !== 'USER') return 'A';
  return row?.speedMode === SPEED_MODE_C ? 'C' : 'B';
};
const cardSizeClassByCount = (count = 0) => {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  if (safeCount > 12) return 'is-compact';
  if (safeCount > 8) return 'is-medium';
  return 'is-large';
};

const FORMATION_SPACING_OPTIONS = [
  { value: 'loose', label: '松散' },
  { value: 'standard', label: '标准' },
  { value: 'compact', label: '紧凑' }
];

const TrainingFormationSpacingControl = ({ value = 'standard', disabled = false, onPick }) => (
  <div className="pve2-training-spacing-control" aria-label="士兵间隔">
    <span>士兵间隔</span>
    <div>
      {FORMATION_SPACING_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          disabled={disabled}
          aria-pressed={option.value === value}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onPick?.(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

const SquadCards = ({
  squads = [],
  phase = 'deploy',
  actionAnchorMode = '',
  deployActionTeam = 'attacker',
  onFocus,
  onSelect,
  onBattleAction = null,
  onDeployInfo,
  onDeployMove,
  onDeployEdit,
  onDeployFormation,
  onDeployDelete,
  onControlModeToggle,
  onBattleControlModeToggle,
  onReorder,
  onPlacementAction,
  onOpenSkillTree,
  onCastSkillSlot,
  onFormationSpacingPick,
  onFormationPick,
  onFormationReorder,
  trainingSkillTreeOpen = false,
  trainingSkillTreeSlotIndex = -1,
  trainingState = null,
  trainingSkillTreeProgress = {},
  armyTemplates = [],
  armyTemplatesLoading = false,
  armyTemplatesError = '',
  onTemplateFill,
  onTemplateCreate,
  onTemplateEdit,
  onTemplateDelete,
  isTrainingMode = false,
  disabled = false
}) => {
  const [draggingGroupId, setDraggingGroupId] = useState('');
  const attacker = squads.filter((row) => row.team === 'attacker');
  const defender = squads.filter((row) => row.team === 'defender');
  const selectedRow = squads.find((row) => row.selected) || null;
  const canConfigureSkills = phase === 'deploy' && isTrainingMode && !disabled;
  const canShowDeployActions = (
    phase === 'deploy'
    && selectedRow
    && (!deployActionTeam || selectedRow.team === deployActionTeam)
    && !disabled
    && (isTrainingMode || actionAnchorMode === 'card')
  );
  const canShowBattleActions = (
    phase === 'battle'
    && selectedRow?.controlMode !== 'AI'
    && selectedRow?.alive
    && !disabled
  );
  const canShowFormationPicker = (
    isTrainingMode
    && selectedRow
    && (phase === 'deploy' || (phase === 'battle' && selectedRow.alive && selectedRow.controlMode !== 'AI'))
  );

  const renderTemplateCard = (template, index) => {
    const templateId = typeof template?.templateId === 'string' ? template.templateId : `idx_${index}`;
    const templateUnits = normalizeTemplateUnits(template?.units || []);
    const templateSummary = templateUnits
      .map((entry) => `${entry.unitName || entry.unitTypeId} ${entry.count}%`)
      .join(' / ');
    return (
      <div
        key={`deploy-template-${templateId}`}
        className="pve2-template-card-wrap"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pve2-template-row">
          <div className="pve2-template-row-main">
            <span className="pve2-template-meta">
              <strong>{template?.name || '未命名模板'}</strong>
              {!isTrainingMode ? <span>模板占比 100%</span> : null}
              <em>{templateSummary || '无兵种配置'}</em>
            </span>
          </div>
          {onTemplateFill || (isTrainingMode && (onTemplateEdit || onTemplateDelete)) ? (
            <div className="pve2-template-row-actions">
              {onTemplateFill ? (
                <button
                  type="button"
                  className="pve2-template-action create"
                  disabled={disabled}
                  title="从模板创建部队"
                  aria-label="从模板创建部队"
                  onClick={() => onTemplateFill(template, 'attacker')}
                >
                  <UserPlus size={14} aria-hidden="true" />
                </button>
              ) : null}
              {isTrainingMode && onTemplateEdit ? (
                <button
                  type="button"
                  className="pve2-template-action edit"
                  disabled={disabled}
                  title="编辑模板"
                  aria-label="编辑模板"
                  onClick={() => onTemplateEdit(template)}
                >
                  {isTrainingMode ? <Pencil size={14} aria-hidden="true" /> : '编辑模板'}
                </button>
              ) : null}
              {isTrainingMode && onTemplateDelete ? (
                <button
                  type="button"
                  className="pve2-template-action delete"
                  disabled={disabled}
                  title="删除模板"
                  aria-label="删除模板"
                  onClick={() => onTemplateDelete(template)}
                >
                  {isTrainingMode ? <Trash2 size={14} aria-hidden="true" /> : '删除模板'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const renderTrainingControls = (row) => {
    if (!isTrainingMode || (phase !== 'deploy' && phase !== 'battle')) return null;
    const isBattle = phase === 'battle';
    const isUserControlled = row.controlMode !== 'AI';
    const isPlaced = row.placed !== false;
    const controlDisabled = disabled || (isBattle && !row.alive);
    return (
      <div
        className={`pve2-training-card-controls ${row.team === 'attacker' ? 'is-right' : 'is-left'} ${isBattle ? 'is-battle' : ''}`}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className={`pve2-training-card-control pve2-training-control-mode ${isUserControlled ? 'is-user' : 'is-ai'}`}
          title={isUserControlled ? '切换为 AI 接管' : '切换为用户操作'}
          aria-label={isUserControlled ? '切换为 AI 接管' : '切换为用户操作'}
          aria-pressed={isUserControlled}
          disabled={controlDisabled}
          onClick={(event) => {
            event.stopPropagation();
            const nextMode = row.controlMode === 'AI' ? 'USER' : 'AI';
            if (isBattle) {
              onBattleControlModeToggle?.(row.id, nextMode);
              return;
            }
            onControlModeToggle?.(row.id, nextMode);
          }}
        >
          {isUserControlled ? <User size={12} /> : <Bot size={12} />}
        </button>
        {!isBattle ? (
          <>
            <button
              type="button"
              className="pve2-training-card-control pve2-training-control-reorder"
              title="拖动调整部队顺序"
              aria-label="拖动调整部队顺序"
              draggable={!disabled}
              disabled={disabled}
              onDragStart={(event) => {
                event.stopPropagation();
                setDraggingGroupId(row.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', row.id);
              }}
              onDragEnd={(event) => {
                event.stopPropagation();
                setDraggingGroupId('');
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <ArrowUpDown size={12} />
            </button>
            <button
              type="button"
              className={`pve2-training-card-control pve2-training-control-placement ${isPlaced ? 'is-cancel' : 'is-delete'}`}
              title={isPlaced ? '取消放置' : '删除训练部队'}
              aria-label={isPlaced ? '取消放置' : '删除训练部队'}
              disabled={disabled}
              onClick={(event) => {
                event.stopPropagation();
                onPlacementAction?.(row.id, event);
              }}
            >
              {isPlaced ? <Ban size={12} /> : <Trash2 size={12} />}
            </button>
          </>
        ) : null}
      </div>
    );
  };

  const renderCard = (row) => (
    <div
      key={row.id}
      className={`pve2-card-wrap ${row.team === 'attacker' ? 'is-attacker' : 'is-defender'} ${draggingGroupId === row.id ? 'is-dragging' : ''}`}
      onDragOver={(event) => {
        if (!isTrainingMode || !draggingGroupId || draggingGroupId === row.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(event) => {
        if (!isTrainingMode) return;
        event.preventDefault();
        event.stopPropagation();
        const sourceId = event.dataTransfer.getData('text/plain') || draggingGroupId;
        if (sourceId && sourceId !== row.id) onReorder?.(sourceId, row.id);
        setDraggingGroupId('');
      }}
    >
      <button
        type="button"
        className={`pve2-card ${row.team === 'attacker' ? 'ally' : 'enemy'} ${row.selected ? 'selected' : ''} ${row.focus ? 'focused' : ''} ${!row.alive ? 'dead' : ''}`}
        disabled={disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (disabled) return;
          if (typeof onFocus === 'function') onFocus(row.id);
          if (typeof onSelect === 'function') onSelect(row.id);
        }}
      >
        <div className="pve2-card-head">
          <strong title={row.name}>{row.name}</strong>
          <div className="pve2-card-head-meta">
            <span>{iconByClass[row.classTag] || '兵'}</span>
            {phase === 'battle' ? (
              <span className="pve2-speed-badge">
                {speedModeBadge(row)}
                {row?.speedModeAuthority === 'USER' ? <em>锁</em> : null}
              </span>
            ) : null}
          </div>
        </div>
        {isTrainingMode ? (
          <div className="pve2-card-row pve2-card-row-compact">
            <span>{row.remain}/{row.startCount}</span>
            <span>{row.action || '待命'}</span>
          </div>
        ) : (
          <>
            <div className="pve2-card-row">{row.remain}/{row.startCount}</div>
            <div className="pve2-card-row">{row.action || '待命'}</div>
          </>
        )}
      </button>
      {renderTrainingControls(row)}
    </div>
  );

  const renderTrainingSelectedPanel = () => {
    if (!selectedRow || !isTrainingMode) return null;
    const isBattle = phase === 'battle';
    const renderPanelEvents = {
      onPointerDown: (event) => event.stopPropagation(),
      onMouseDown: (event) => event.stopPropagation(),
      onClick: (event) => event.stopPropagation()
    };
    return (
      <section
        className={`pve2-training-squad-panel is-${selectedRow.team} ${isBattle ? 'is-runtime' : ''}`}
        aria-label="当前选中部队信息与技能"
        {...renderPanelEvents}
      >
        <div className="pve2-training-squad-skill-row">
          <TrainingSkillSlots
            unitCategories={selectedRow.unitCategories}
            skillSlots={selectedRow.skillSlots}
            skills={isBattle ? selectedRow.skills : []}
            phase={phase}
            isTrainingMode={isTrainingMode}
            trainingState={trainingState}
            skillTreeProgress={trainingSkillTreeProgress}
            treeOpenSlotIndex={trainingSkillTreeOpen ? trainingSkillTreeSlotIndex : -1}
            onOpenTree={(slotIndex, treeCategory, event) => onOpenSkillTree?.(selectedRow.id, slotIndex, treeCategory, event)}
            onCastSlot={(slotIndex, event) => onCastSkillSlot?.(selectedRow.id, slotIndex, event)}
            disabled={phase === 'deploy' ? !canConfigureSkills : false}
          />
        </div>
        {(phase === 'deploy' || canShowBattleActions || canShowFormationPicker) ? (
          <div className="pve2-training-squad-command-row">
          {canShowFormationPicker ? (
            <BattleFormationSlots
              formations={selectedRow.templateFormations}
              activeFormationId={selectedRow.activeFormationId || selectedRow.formationId}
              editable={isTrainingMode && phase === 'deploy'}
              disabled={disabled}
              showHoverGrid={isTrainingMode}
              onPick={(formation) => onFormationPick?.(selectedRow.id, formation)}
              onReorder={phase === 'deploy'
                ? (formations) => onFormationReorder?.(selectedRow.id, formations)
                : undefined}
            />
          ) : null}
          {canShowDeployActions ? (
            <DeployActionButtons
              layout="line"
              onInfo={(event) => onDeployInfo?.(selectedRow.id, event)}
              onMove={(event) => onDeployMove?.(selectedRow.id, event)}
              onEdit={(event) => onDeployEdit?.(selectedRow.id, event)}
              onFormation={isTrainingMode ? undefined : (event) => onDeployFormation?.(selectedRow.id, event)}
              onDelete={(event) => onDeployDelete?.(selectedRow.id, event)}
              showDelete={false}
            />
          ) : null}
          {canShowBattleActions ? (
            <>
              <BattleActionButtons
                visible
                mode="card"
                isTrainingMode={isTrainingMode}
                actionIds={['planPath', 'freeAttack', 'standby', 'retreat']}
                className="pve2-training-command-actions"
                onAction={(actionId, payload) => onBattleAction?.(selectedRow.id, actionId, payload)}
              />
              <TrainingFormationSpacingControl
                value={selectedRow.formationSpacing || 'standard'}
                disabled={disabled}
                onPick={(spacing) => onFormationSpacingPick?.(selectedRow.id, spacing)}
              />
            </>
          ) : null}
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <>
      {phase === 'deploy' ? (
        <section
          className={`pve2-template-strip ${disabled ? 'is-disabled' : ''}`}
          aria-label="部队模板"
          onWheelCapture={(event) => event.stopPropagation()}
        >
          <div className="pve2-template-strip-heading">
            <div className="pve2-template-strip-title">
              <strong>部队模板</strong>
            </div>
            {isTrainingMode && onTemplateCreate ? (
              <button
                type="button"
                className="pve2-template-create-button"
                disabled={disabled}
                title="创建部队模板"
                aria-label="创建部队模板"
                onClick={onTemplateCreate}
              >
                <Plus size={15} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="pve2-template-list">
            {armyTemplatesLoading ? (
              <span className="pve2-hint pve2-template-strip-hint">部队模板加载中...</span>
            ) : null}
            {!armyTemplatesLoading && armyTemplatesError ? (
              <span className="pve2-hint pve2-template-strip-hint pve2-template-error">{armyTemplatesError}</span>
            ) : null}
            {!armyTemplatesLoading && !armyTemplatesError && armyTemplates.length === 0 ? (
              <span className="pve2-hint pve2-template-strip-hint">暂无部队模板</span>
            ) : null}
            {!armyTemplatesLoading && !armyTemplatesError
              ? armyTemplates.map(renderTemplateCard)
              : null}
          </div>
        </section>
      ) : null}
      <div
        className={`pve2-card-strip left ${cardSizeClassByCount(attacker.length)} ${disabled ? 'is-disabled' : ''}`}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        {attacker.map(renderCard)}
      </div>
      <div
        className={`pve2-card-strip right ${cardSizeClassByCount(defender.length)} ${disabled ? 'is-disabled' : ''}`}
        onWheelCapture={(event) => event.stopPropagation()}
      >
        {defender.map(renderCard)}
      </div>
      {renderTrainingSelectedPanel()}
      {!isTrainingMode && selectedRow ? (
        <section
          className={`pve2-selected-squad-panel is-${selectedRow.team}`}
          aria-label="当前选中部队信息"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <header className="pve2-selected-squad-head">
            <div>
              <span>当前选中部队</span>
              <strong title={selectedRow.name}>{selectedRow.name}</strong>
            </div>
            <span className={`pve2-selected-squad-team is-${selectedRow.team}`}>
              {selectedRow.team === 'attacker' ? '我方' : '敌方'}
            </span>
          </header>
          <div className="pve2-selected-squad-body">
            <div className="pve2-selected-squad-summary">
              <dl className="pve2-selected-squad-stats">
                <div>
                  <dt>兵种</dt>
                  <dd>{labelByClass[selectedRow.classTag] || '部队'}</dd>
                </div>
                <div>
                  <dt>兵力</dt>
                  <dd>{selectedRow.remain}/{selectedRow.startCount}</dd>
                </div>
                <div>
                  <dt>状态</dt>
                  <dd>{selectedRow.action || '待命'}</dd>
                </div>
                {phase === 'battle' ? (
                  <>
                    <div>
                      <dt>生命</dt>
                      <dd>{`${Math.round(selectedRow.health || 0)}/${Math.round(selectedRow.maxHealth || 0)}`}</dd>
                    </div>
                    <div>
                      <dt>稳定</dt>
                      <dd>{`${Math.round(selectedRow.stability?.poise || 0)}/${Math.round(selectedRow.stability?.poiseMax || 0)}`}</dd>
                    </div>
                    <div>
                      <dt>坐标</dt>
                      <dd>{`${Math.round(selectedRow.x || 0)}, ${Math.round(selectedRow.y || 0)}`}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
              {canShowDeployActions ? (
                <div className="pve2-selected-squad-actions">
                  <span>部队操作</span>
                  <DeployActionButtons
                    layout="line"
                    onInfo={(event) => onDeployInfo?.(selectedRow.id, event)}
                    onMove={(event) => onDeployMove?.(selectedRow.id, event)}
                    onEdit={(event) => onDeployEdit?.(selectedRow.id, event)}
                    onFormation={isTrainingMode ? undefined : (event) => onDeployFormation?.(selectedRow.id, event)}
                    onDelete={(event) => onDeployDelete?.(selectedRow.id, event)}
                    showDelete
                    deleteTitle="删除"
                    deleteAriaLabel="删除"
                  />
                </div>
              ) : null}
              {canShowBattleActions ? (
                <div className="pve2-selected-squad-actions">
                  <span>战斗指令</span>
                  <BattleActionButtons
                    visible
                    mode="card"
                    isTrainingMode={isTrainingMode}
                    onAction={(actionId, payload) => onBattleAction?.(selectedRow.id, actionId, payload)}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
};

export default SquadCards;
