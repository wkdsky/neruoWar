import React from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  Hand,
  LogOut,
  MousePointer2,
  Move,
  PanelTop,
  Redo2,
  RotateCw,
  Save,
  Settings,
  Trash2,
  Undo2,
  Wand2
} from 'lucide-react';
import { CITY_CHANNEL_TOOLS } from './cityChannelSchema';

const TOOL_ITEMS = [
  { key: CITY_CHANNEL_TOOLS.BROWSE, label: '浏览', Icon: Hand },
  { key: CITY_CHANNEL_TOOLS.SELECT, label: '选择', Icon: MousePointer2 }
];

const WALL_VIEW_MODES = ['semi', 'perspective', 'solid'];

const WALL_VIEW_MODE_CONFIG = {
  semi: {
    label: '半透视',
    toast: '墙板显示：半透视'
  },
  perspective: {
    label: '透视',
    toast: '墙板显示：透视'
  },
  solid: {
    label: '不透视',
    toast: '墙板显示：不透视'
  }
};

const toolLabelByKey = {
  [CITY_CHANNEL_TOOLS.BROWSE]: '浏览',
  [CITY_CHANNEL_TOOLS.SELECT]: '选择',
  [CITY_CHANNEL_TOOLS.ERASE]: '擦除',
  [CITY_CHANNEL_TOOLS.PLACE_TILE]: '放置',
  [CITY_CHANNEL_TOOLS.PLACE_COMPONENT]: '安装组件'
};

const getToolLabel = (activeTool) => toolLabelByKey[activeTool] || activeTool;

export const CityChannelToastStack = ({ toasts = [] }) => (
  <div className="city-channel-toast-container" aria-live="polite">
    {toasts.map((toast) => (
      <div key={toast.id} className={`city-channel-toast is-${toast.type}`}>{toast.message}</div>
    ))}
  </div>
);

export const CityChannelEditorTopbar = ({
  canUndo,
  canRedo,
  onExit,
  onSave,
  onUndo,
  onRedo
}) => (
  <div className="city-channel-immersive__topbar">
    <button type="button" className="city-channel-glass-btn" onClick={onExit}>
      <LogOut size={16} /> 退出
    </button>
    <button type="button" className="city-channel-glass-btn is-primary" onClick={onSave}>
      <Save size={16} /> 保存
    </button>
    <button type="button" className="city-channel-glass-btn" onClick={onUndo} disabled={!canUndo}>
      <Undo2 size={16} /> 撤销
    </button>
    <button type="button" className="city-channel-glass-btn" onClick={onRedo} disabled={!canRedo}>
      <Redo2 size={16} /> 重做
    </button>
  </div>
);

export const CityChannelSelectionActions = ({
  selectedCount,
  selectionScope,
  selectedPlacementCount,
  selectedRackCount,
  carryActive,
  canInspectSelectedTile,
  isInspectActive,
  onPointerDown,
  onStartCarry,
  onCopySelection,
  onRotateSelection,
  onRotateCarrySurface,
  onCycleCarrySnapAxisRotation,
  onInspectSelected,
  onDeleteSelection,
  onSetSelectedGearAxis
}) => {
  if (selectedCount <= 0) return null;

  return (
    <div className="city-channel-selection-actions" onPointerDown={onPointerDown}>
      <span className="city-channel-selection-actions__count">{selectedCount}</span>
      {selectionScope !== 'component' ? (
        <>
          <button type="button" className="city-channel-selection-action" onClick={onStartCarry} title="移动 (M)">
            <Move size={14} />
            <span>移动</span>
            <em className="city-channel-shortcut-hint">M</em>
          </button>
          <button type="button" className="city-channel-selection-action" onClick={onCopySelection} title="复制 (Ctrl+C)">
            <Copy size={14} />
            <span>复制</span>
            <em className="city-channel-shortcut-hint">Ctrl+C</em>
          </button>
          <button type="button" className="city-channel-selection-action" onClick={() => onRotateSelection?.('forward')} title="传动骨骼朝向 (Shift+滚轮)">
            <RotateCw size={14} />
            <span>传动朝向</span>
            <em className="city-channel-shortcut-hint">Shift+滚轮</em>
          </button>
          {carryActive && selectedPlacementCount === 1 && (
            <>
              <button type="button" className="city-channel-selection-action" onClick={onRotateCarrySurface} title="移动预览表面朝向 (R / Shift+滚轮)">
                <RotateCw size={14} />
                <span>表面朝向</span>
                <em className="city-channel-shortcut-hint">R</em>
              </button>
              <button type="button" className="city-channel-selection-action" onClick={onCycleCarrySnapAxisRotation} title="移动预览姿态翻转 (Space)">
                <PanelTop size={14} />
                <span>翻转姿态</span>
                <em className="city-channel-shortcut-hint">Space</em>
              </button>
            </>
          )}
          {canInspectSelectedTile && (
            <button
              type="button"
              className={`city-channel-selection-action ${isInspectActive ? 'is-active' : ''}`}
              onClick={onInspectSelected}
              title={isInspectActive ? '放回' : '观察'}
            >
              <Eye size={14} />
              <span>{isInspectActive ? '放回' : '观察'}</span>
            </button>
          )}
          <button type="button" className="city-channel-selection-action is-danger" onClick={onDeleteSelection} title="删除 (Del)">
            <Trash2 size={14} />
            <span>删除</span>
            <em className="city-channel-shortcut-hint">Del</em>
          </button>
        </>
      ) : (
        <>
          <button type="button" className="city-channel-selection-action" onClick={onStartCarry} title="移动 (M)">
            <Move size={14} />
            <span>移动</span>
            <em className="city-channel-shortcut-hint">M</em>
          </button>
          {carryActive && selectedRackCount === 1 && (
            <>
              <button type="button" className="city-channel-selection-action" onClick={onRotateCarrySurface} title="齿条移动预览朝向 (R / Shift+滚轮)">
                <RotateCw size={14} />
                <span>朝向</span>
                <em className="city-channel-shortcut-hint">R</em>
              </button>
              <button type="button" className="city-channel-selection-action" onClick={onCycleCarrySnapAxisRotation} title="齿条移动预览平面切换 (Space)">
                <PanelTop size={14} />
                <span>平面</span>
                <em className="city-channel-shortcut-hint">Space</em>
              </button>
            </>
          )}
          <button
            type="button"
            className="city-channel-selection-action"
            onClick={() => onSetSelectedGearAxis?.()}
            title="取消连轴绑定"
          >
            <span>取消连轴</span>
          </button>
          <button type="button" className="city-channel-selection-action is-danger" onClick={onDeleteSelection} title="删除 (Del)">
            <Trash2 size={14} />
            <span>删除</span>
            <em className="city-channel-shortcut-hint">Del</em>
          </button>
        </>
      )}
    </div>
  );
};

export const CityChannelHotbar = ({
  activeTool,
  panelPose,
  fixedHorizontal = false,
  wallViewMode,
  openPanel,
  onClearSelection,
  onRequestTool,
  onSetPanelPose,
  onSetWallViewMode,
  onRunValidation,
  onSetOpenPanel,
  onToast
}) => {
  const wallViewModeConfig = WALL_VIEW_MODE_CONFIG[wallViewMode] || WALL_VIEW_MODE_CONFIG.semi;

  return (
    <div className="city-channel-hotbar" aria-label="物品栏">
      {TOOL_ITEMS.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          className={`city-channel-hotbar__item ${activeTool === key ? 'is-active' : ''}`}
          onClick={() => {
            onClearSelection?.();
            onRequestTool?.(key);
          }}
          title={label}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
      <span className="city-channel-hotbar__divider" aria-hidden="true" />
      <button
        type="button"
        className={`city-channel-hotbar__item ${!fixedHorizontal && panelPose === 'wall' ? 'is-active' : ''}`}
        onClick={() => {
          if (fixedHorizontal) {
            onSetPanelPose?.('floor');
            onToast?.('入口/出口仅支持平放', 'info');
            return;
          }
          onSetPanelPose?.((current) => (current === 'wall' ? 'floor' : 'wall'));
          onToast?.(panelPose === 'wall' ? '板材平放：作为地板放置' : '板材竖放：作为墙板放置', 'info');
        }}
        title={fixedHorizontal ? '入口/出口仅支持平放' : (panelPose === 'wall' ? '当前：竖放为墙板' : '当前：平放为地板')}
      >
        <PanelTop size={18} />
        <span>{fixedHorizontal ? '平放' : (panelPose === 'wall' ? '竖放' : '平放')}</span>
      </button>
      <button
        type="button"
        className={[
          'city-channel-hotbar__item',
          wallViewMode === 'perspective' ? 'is-active' : '',
          `is-wall-view-${wallViewMode}`
        ].filter(Boolean).join(' ')}
        onClick={() => {
          onSetWallViewMode?.((current) => {
            const currentIndex = WALL_VIEW_MODES.indexOf(current);
            const next = WALL_VIEW_MODES[(Math.max(0, currentIndex) + 1) % WALL_VIEW_MODES.length];
            onToast?.(WALL_VIEW_MODE_CONFIG[next].toast, 'info');
            return next;
          });
        }}
        title={`墙板显示：${wallViewModeConfig.label}`}
      >
        {wallViewMode === 'perspective' ? <EyeOff size={18} /> : <Eye size={18} />}
        <span>{wallViewModeConfig.label}</span>
      </button>
      <button type="button" className="city-channel-hotbar__item" onClick={onRunValidation} title="验证白通路">
        <Wand2 size={18} />
        <span>验证</span>
      </button>
      <button
        type="button"
        className={`city-channel-hotbar__item ${openPanel === 'settings' ? 'is-active' : ''}`}
        onClick={() => onSetOpenPanel?.((current) => (current === 'settings' ? null : 'settings'))}
        title="设置"
      >
        <Settings size={18} />
        <span>设置</span>
      </button>
    </div>
  );
};

export const CityChannelMechanismMotionControls = ({
  active = false,
  onCancel,
  onPointerDown
}) => {
  if (!active) return null;
  return (
    <div className="city-channel-mechanism-motion-controls" onPointerDown={onPointerDown}>
      <button type="button" className="city-channel-mechanism-motion-cancel" onClick={onCancel} title="撤销机关运动">
        <Undo2 size={16} />
        <span>撤销运动</span>
      </button>
    </div>
  );
};

export const CityChannelInteractionHints = ({
  activeTool,
  selectedCount
}) => (
  <section className="city-channel-interaction-hints" aria-live="polite">
    <strong>{
      activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE
        ? '放置模式'
        : activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT
          ? '组件安装'
          : getToolLabel(activeTool)
    }</strong>
    {activeTool === CITY_CHANNEL_TOOLS.PLACE_TILE ? (
      <>
        <span>左键放置，右键或 Esc 取消</span>
        <span>滚轮缩放；Shift+滚轮 / R 旋转预览</span>
        <span>Space 吸附时切换安装位</span>
      </>
    ) : activeTool === CITY_CHANNEL_TOOLS.PLACE_COMPONENT ? (
      <>
        <span>左键安装，右键或 Esc 取消</span>
        <span>齿轮会吸附到板材中心或四角</span>
      </>
    ) : activeTool === CITY_CHANNEL_TOOLS.SELECT ? (
      <>
        <span>拖拽框选，Shift 点击或框选可追加选择</span>
        <span>滚轮缩放；Shift+滚轮 / R 旋转传动骨骼，M 移动，Del 删除</span>
      </>
    ) : (
      <>
        <span>拖拽平移，双击后拖拽或 Q/E 旋转视角</span>
        <span>滚轮缩放；M 移动，移动预览中 R 转表面、Space 翻转、Del 删除</span>
      </>
    )}
    {selectedCount > 0 ? <em>{selectedCount} 个选中</em> : null}
  </section>
);

export const CityChannelSettingsPopover = ({
  openPanel,
  showHelperGrid,
  showCoordinates,
  onShowHelperGridChange,
  onShowCoordinatesChange
}) => {
  if (!openPanel) return null;

  return (
    <aside className="city-channel-popover">
      <strong>设置</strong>
      {openPanel === 'settings' && (
        <div className="city-channel-settings-list">
          <label>
            <input type="checkbox" checked={showHelperGrid} onChange={(event) => onShowHelperGridChange?.(event.target.checked)} />
            显示辅助网格
          </label>
          <label>
            <input type="checkbox" checked={showCoordinates} onChange={(event) => onShowCoordinatesChange?.(event.target.checked)} />
            显示坐标
          </label>
        </div>
      )}
    </aside>
  );
};

export const CityChannelStatusBar = ({
  activeTool,
  activeLayerLabel,
  statusMessage,
  hoverStatusLabel,
  cameraSummary,
  objectCount,
  validationOk
}) => (
  <footer className={`city-channel-immersive-status ${validationOk ? 'is-ok' : ''}`}>
    <span>{getToolLabel(activeTool)}</span>
    <span>{activeLayerLabel}</span>
    <span title={statusMessage}>{hoverStatusLabel}</span>
    <span>{`${Math.round((cameraSummary.zoom || 1) * 100)}%`}</span>
    <span>{`${Math.round(cameraSummary.yaw || 0)}°`}</span>
    <span>{`${objectCount}物件`}</span>
    <span>{validationOk ? '白通路✓' : '未验证'}</span>
  </footer>
);
