import React, { useEffect, useRef } from 'react';
import { CircleOff, RotateCcw, RotateCw } from 'lucide-react';
import { getCityChannelMaterial } from './cityChannelCatalog';
import {
  CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS,
  CITY_CHANNEL_MECHANISM_LIMITS,
  CITY_CHANNEL_MECHANISM_SPEED_STEPS,
  formatMechanismRotationAngle,
  isCornerGearSocket,
  normalizeGearRotationDirection
} from './cityChannelMechanismRuntime';

const GEAR_POSITION_LABELS = {
  center: '中心',
  corner_ne: '右上角',
  corner_nw: '左上角',
  corner_se: '右下角',
  corner_sw: '左下角'
};

const GEAR_ROTATION_OPTIONS = [
  {
    value: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.COUNTERCLOCKWISE,
    label: '逆时针',
    Icon: RotateCcw
  },
  {
    value: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.CLOCKWISE,
    label: '顺时针',
    Icon: RotateCw
  },
  {
    value: CITY_CHANNEL_GEAR_ROTATION_DIRECTIONS.PASSIVE,
    label: '被动轮',
    Icon: CircleOff
  }
];

const stopMechanismPanelPointerEvent = (event) => {
  event.stopPropagation();
};

const getMechanismPanelStyle = (inspectActive) => {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280;
  return {
    right: viewportWidth <= 760 ? '12px' : 'max(18px, env(safe-area-inset-right))',
    top: inspectActive ? '50%' : '74px',
    transform: inspectActive ? 'translateY(-50%)' : 'none'
  };
};

const CityChannelMechanismRangeParam = ({
  label,
  field,
  unit,
  limits,
  value,
  onChange
}) => (
  <label className="city-channel-mechanism-param">
    <span>{label}</span>
    <div className="city-channel-mechanism-param__row">
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
      />
      <input
        type="number"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
        aria-label={label}
      />
      <em>{unit}</em>
    </div>
  </label>
);

const CityChannelMechanismNumberParam = ({
  label,
  field,
  unit,
  limits,
  value,
  onChange
}) => (
  <label className="city-channel-mechanism-param">
    <span>{label}</span>
    <div className="city-channel-mechanism-param__row">
      <input
        type="number"
        min={limits.min}
        max={limits.max}
        step={limits.step}
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
        aria-label={label}
      />
      <em>{unit}</em>
    </div>
  </label>
);

const CityChannelMechanismAngleParam = ({
  params,
  onChange
}) => {
  const limits = CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle;
  const turns = Number(params.rotationTurns) || 0;
  const updateTurns = (delta) => {
    const turnLimits = CITY_CHANNEL_MECHANISM_LIMITS.rotationTurns;
    const nextTurns = Math.max(turnLimits.min, Math.min(turnLimits.max, turns + delta));
    onChange?.('rotationTurns', nextTurns);
  };
  return (
    <div className="city-channel-mechanism-param city-channel-mechanism-angle">
      <div className="city-channel-mechanism-param__label">
        <span>转动角度</span>
        <strong>{formatMechanismRotationAngle(params)}</strong>
      </div>
      <div className="city-channel-mechanism-param__row">
        <input
          type="range"
          min={limits.min}
          max={limits.max}
          step={limits.step}
          value={params.rotationAngle}
          onChange={(event) => onChange?.('rotationAngle', event.target.value)}
        />
        <input
          type="number"
          min={limits.min}
          max={limits.max}
          step={limits.step}
          value={params.rotationAngle}
          onChange={(event) => onChange?.('rotationAngle', event.target.value)}
          aria-label="转动角度"
        />
        <em>度</em>
      </div>
      <div className="city-channel-mechanism-turns" role="group" aria-label="整圈数">
        {[-10, -1, 1, 10].map((delta) => (
          <button
            key={delta}
            type="button"
            onClick={() => updateTurns(delta)}
          >
            {`${delta > 0 ? '+' : ''}${delta}圈`}
          </button>
        ))}
        <span>{`${turns}圈`}</span>
      </div>
    </div>
  );
};

const CityChannelMechanismSpeedParam = ({
  value,
  onChange
}) => (
  <div className="city-channel-mechanism-param city-channel-mechanism-speed">
    <div className="city-channel-mechanism-param__label">
      <span>转动速度</span>
      <strong>{`${value}°/秒`}</strong>
    </div>
    <div className="city-channel-mechanism-speed__buttons" role="group" aria-label="转动速度">
      {CITY_CHANNEL_MECHANISM_SPEED_STEPS.map((speed) => (
        <button
          key={speed}
          type="button"
          className={speed === value ? 'is-active' : ''}
          aria-pressed={speed === value}
          onClick={() => onChange?.('rotationSpeedDegPerSec', speed)}
        >
          {speed}
        </button>
      ))}
    </div>
  </div>
);

const CityChannelGearRotationControl = ({
  value,
  onChange
}) => {
  const normalized = normalizeGearRotationDirection(value);
  return (
    <div className="city-channel-gear-direction" role="group" aria-label="齿轮转动方向">
      <span>转动方向</span>
      <div className="city-channel-gear-direction__buttons">
        {GEAR_ROTATION_OPTIONS.map(({ value: optionValue, label, Icon }) => (
          <button
            key={optionValue}
            type="button"
            className={optionValue === normalized ? 'is-active' : ''}
            aria-pressed={optionValue === normalized}
            aria-label={label}
            title={label}
            onClick={() => onChange?.(optionValue)}
          >
            <Icon size={17} strokeWidth={2.6} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
};

export const CityChannelGearAxisPrompt = ({
  prompt,
  onDismiss
}) => {
  const promptRef = useRef(null);

  useEffect(() => {
    if (!prompt) return undefined;
    const handlePointerDown = (event) => {
      if (promptRef.current?.contains(event.target)) return;
      onDismiss?.();
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onDismiss, prompt]);

  if (!prompt?.anchor) return null;

  return (
    <div
      ref={promptRef}
      className="city-channel-gear-axis-prompt"
      style={{
        left: `${Math.max(12, Math.min(prompt.anchor.left + 12, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 176))}px`,
        top: `${Math.max(76, Math.min(prompt.anchor.top - 18, (typeof window !== 'undefined' ? window.innerHeight : 720) - 84))}px`
      }}
      onPointerDown={stopMechanismPanelPointerEvent}
      onClick={stopMechanismPanelPointerEvent}
    >
      <span>选中齿轮后点击虚线选择连轴板材</span>
    </div>
  );
};

const CityChannelMechanismPanel = ({
  isOpen,
  inspectActive,
  selectedGear,
  selectedGearMount,
  selectedGearCanConfigureRotation = false,
  selectedAssembly,
  activePanelTile,
  activePanelPanelType,
  canRunActivePanel,
  gearMountsForPanel = [],
  gearMountBindingStatusById = {},
  mechanismPanelParams,
  onCloseInspect,
  onExecute,
  onUpdateGearRotationDirection,
  onUpdateMechanismParam
}) => {
  if (!isOpen) return null;

  const mechanismPanelMaterial = activePanelPanelType
    ? getCityChannelMaterial(activePanelPanelType)
    : null;
  const transmissionSkeleton = mechanismPanelMaterial?.transmissionSkeleton || null;
  const canConfigureGearMounts = gearMountsForPanel.length > 0;

  return (
    <aside
      className={`city-channel-mechanism-params ${inspectActive ? 'is-inspect-docked' : ''}`}
      style={getMechanismPanelStyle(inspectActive)}
      onPointerDown={stopMechanismPanelPointerEvent}
      onPointerMove={stopMechanismPanelPointerEvent}
      onClick={stopMechanismPanelPointerEvent}
    >
      <div className="city-channel-mechanism-params__head">
        <strong>{selectedGearMount ? '齿轮组件' : mechanismPanelMaterial?.shortName || mechanismPanelMaterial?.name || '机关参数'}</strong>
        <div className="city-channel-mechanism-params__actions">
          {canRunActivePanel ? (
            <button type="button" onClick={onExecute}>运行</button>
          ) : null}
          {inspectActive && (
            <button
              type="button"
              className="city-channel-mechanism-params__close"
              onClick={onCloseInspect}
              aria-label="关闭观察"
              title="关闭观察"
            >
              X
            </button>
          )}
        </div>
      </div>
      {selectedGearMount ? (
        <div className="city-channel-mechanism-summary">
          <span>{`宿主：${selectedGear?.hostKey || '未知'}`}</span>
          <span>{`位置：${GEAR_POSITION_LABELS[selectedGearMount.position] || selectedGearMount.position}`}</span>
          <span>安装层：板材中层</span>
        </div>
      ) : (
        <div className="city-channel-mechanism-summary">
          <span>{`所属整体：${selectedAssembly?.id || '未连接'}`}</span>
          <span>{`端点：${transmissionSkeleton?.ports?.length || 0}`}</span>
          <span>{`齿轮：${activePanelTile?.gearMounts?.length || 0}`}</span>
        </div>
      )}
      {transmissionSkeleton ? (
        <div className="city-channel-mechanism-summary is-detail">
          <span>{`传动骨骼：${transmissionSkeleton.type}`}</span>
          <span>{(transmissionSkeleton.ports || []).map((port) => port.direction).join(' / ')}</span>
        </div>
      ) : null}
      {selectedAssembly?.warnings?.length > 0 ? (
        <div className="city-channel-mechanism-summary is-warning">
          {selectedAssembly.warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      {canConfigureGearMounts ? (
        <div className="city-channel-gear-config">
          {gearMountsForPanel.map((mount, index) => {
            const status = gearMountBindingStatusById[mount.id] || null;
            const invalid = status?.bound && !status.valid;
            return (
              <section key={mount.id || `gear-${index}`} className="city-channel-gear-config__item">
                <header>
                  <strong>{GEAR_POSITION_LABELS[mount.position] || mount.position || `齿轮 ${index + 1}`}</strong>
                  <span>{invalid ? '联动失效' : mount.axisBinding ? '已绑定' : '未绑定'}</span>
                </header>
                <div className={`city-channel-mechanism-summary is-detail ${invalid ? 'is-warning' : ''}`}>
                  <span>{`连轴板材：${mount.axisBinding?.componentKey || '未绑定'}`}</span>
                  <span>{invalid ? '被绑定板材已移动或删除' : isCornerGearSocket(mount.position) ? '点击白色光带切换联动板材' : '中心齿轮不绑定板材'}</span>
                </div>
                {selectedGearMount && selectedGearCanConfigureRotation ? (
                  <CityChannelGearRotationControl
                    value={mount.rotationDirection}
                    onChange={(rotationDirection) => onUpdateGearRotationDirection?.(mount.id, rotationDirection)}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}
      {canRunActivePanel ? (
        <>
          <CityChannelMechanismAngleParam
            params={mechanismPanelParams}
            onChange={onUpdateMechanismParam}
          />
          <CityChannelMechanismSpeedParam
            value={mechanismPanelParams.rotationSpeedDegPerSec}
            onChange={onUpdateMechanismParam}
          />
          <CityChannelMechanismNumberParam
            label="延迟触发"
            field="triggerDelaySeconds"
            unit="秒"
            limits={CITY_CHANNEL_MECHANISM_LIMITS.triggerDelaySeconds}
            value={mechanismPanelParams.triggerDelaySeconds}
            onChange={onUpdateMechanismParam}
          />
          <label className="city-channel-mechanism-param is-inline">
            <input
              type="checkbox"
              checked={mechanismPanelParams.autoReturn}
              onChange={(event) => onUpdateMechanismParam?.('autoReturn', event.target.checked)}
            />
            <span>自动转回</span>
          </label>
          {mechanismPanelParams.autoReturn ? (
            <CityChannelMechanismNumberParam
              label="自动转回延迟"
              field="autoReturnDelaySeconds"
              unit="秒"
              limits={CITY_CHANNEL_MECHANISM_LIMITS.autoReturnDelaySeconds}
              value={mechanismPanelParams.autoReturnDelaySeconds}
              onChange={onUpdateMechanismParam}
            />
          ) : null}
        </>
      ) : null}
    </aside>
  );
};

export default CityChannelMechanismPanel;
