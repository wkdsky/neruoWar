import React, { useEffect, useRef } from 'react';
import { getCityChannelMaterial } from './cityChannelCatalog';
import {
  CITY_CHANNEL_MECHANISM_LIMITS,
  isCornerGearSocket
} from './cityChannelMechanismRuntime';

const GEAR_POSITION_LABELS = {
  center: '中心',
  corner_ne: '右上角',
  corner_nw: '左上角',
  corner_se: '右下角',
  corner_sw: '左下角'
};

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
  selectedAssembly,
  activePanelTile,
  activePanelPanelType,
  canRunActivePanel,
  gearMountsForPanel = [],
  gearMountBindingStatusById = {},
  mechanismPanelParams,
  onCloseInspect,
  onExecute,
  onUpdateMechanismParam
}) => {
  if (!isOpen) return null;

  const mechanismPanelMaterial = activePanelPanelType
    ? getCityChannelMaterial(activePanelPanelType)
    : null;
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
          <span>{`安装面：${selectedGearMount.surface === 'back' ? '背面' : '正面'}`}</span>
        </div>
      ) : (
        <div className="city-channel-mechanism-summary">
          <span>{`所属整体：${selectedAssembly?.id || '未连接'}`}</span>
          <span>{`端点：${activePanelTile?.transmissionSkeleton?.ports?.length || 0}`}</span>
          <span>{`齿轮：${activePanelTile?.gearMounts?.length || 0}`}</span>
        </div>
      )}
      {activePanelTile?.transmissionSkeleton ? (
        <div className="city-channel-mechanism-summary is-detail">
          <span>{`传动骨骼：${activePanelTile.transmissionSkeleton.type}`}</span>
          <span>{(activePanelTile.transmissionSkeleton.ports || []).map((port) => port.direction).join(' / ')}</span>
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
              </section>
            );
          })}
        </div>
      ) : null}
      {canRunActivePanel ? (
        <>
          <CityChannelMechanismRangeParam
            label="转动角度"
            field="rotationAngle"
            unit="度"
            limits={CITY_CHANNEL_MECHANISM_LIMITS.rotationAngle}
            value={mechanismPanelParams.rotationAngle}
            onChange={onUpdateMechanismParam}
          />
          <CityChannelMechanismRangeParam
            label="转动速度"
            field="rotationSpeedDegPerSec"
            unit="度/秒"
            limits={CITY_CHANNEL_MECHANISM_LIMITS.rotationSpeedDegPerSec}
            value={mechanismPanelParams.rotationSpeedDegPerSec}
            onChange={onUpdateMechanismParam}
          />
          <label className="city-channel-mechanism-param">
            <span>转动方向</span>
            <select
              value={mechanismPanelParams.rotationDirection}
              onChange={(event) => onUpdateMechanismParam?.('rotationDirection', event.target.value)}
            >
              <option value="right">右</option>
              <option value="left">左</option>
            </select>
          </label>
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
