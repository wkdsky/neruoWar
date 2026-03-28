import React from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  CITY_BUILDING_DEFAULT_RADIUS,
  CITY_GATE_LABELS,
  CITY_GATE_TOOLTIPS
} from './shared';

const KnowledgeDomainCityView = ({
  cityDefenseLayerRef,
  cityGateLayerRef,
  isIntelHeistMode,
  intelHeistCountdownText,
  intelHeistRemainingRatio,
  requestExitIntelHeistGame,
  onExit,
  defenseLayoutState,
  handleCityBuildDragOver,
  handleCityBuildDrop,
  displayDefenseBuildings,
  defenseMetrics,
  intelHeistState,
  intelHeistActiveSearchRatio,
  handleDefenseBuildingPointerDown,
  startIntelHeistSearch,
  setDefenseLayoutState,
  showBuildingPalette,
  buildingCatalog,
  buildingTypeUsageMap,
  draggingBuildingTypeId,
  updateSelectedBuildingType,
  handleBuildingPaletteDragStart,
  handleBuildingPaletteDragEnd,
  showGateLayer,
  hasParentEntrance,
  hasChildEntrance,
  canInspectGateDefense,
  gatePositions,
  openBattlefieldPreview,
  gateTotals
}) => (
  <>
    {isIntelHeistMode ? (
      <div className="intel-heist-hud">
        <div className="intel-heist-hud-header">
          <strong>情报窃取</strong>
          <span>{`剩余 ${intelHeistCountdownText}`}</span>
        </div>
        <div className="intel-heist-timer-track">
          <span
            className="intel-heist-timer-fill"
            style={{ width: `${Math.max(0, Math.min(100, intelHeistRemainingRatio * 100))}%` }}
          />
        </div>
        <button
          type="button"
          className="intel-heist-exit-btn"
          onClick={requestExitIntelHeistGame}
        >
          退出情报窃取
        </button>
        {intelHeistState.error && <div className="intel-heist-hud-error">{intelHeistState.error}</div>}
      </div>
    ) : (
      <button
        type="button"
        className="domain-return-top-btn"
        onClick={onExit}
        title="返回知识域主视角"
        aria-label="返回知识域主视角"
      >
        <ArrowLeft size={14} />
        <span>返回知识域主视角</span>
      </button>
    )}
    <div
      ref={cityDefenseLayerRef}
      className={`city-defense-layer ${defenseLayoutState.buildMode ? 'build-mode' : ''}`}
      onDragOver={handleCityBuildDragOver}
      onDrop={handleCityBuildDrop}
    >
      {displayDefenseBuildings.map((building) => {
        const px = defenseMetrics.centerX + building.x * defenseMetrics.radiusX;
        const py = defenseMetrics.centerY + building.y * defenseMetrics.radiusY;
        const radiusPx = Math.max(16, Math.min(36, Math.round(defenseMetrics.radiusY * (building.radius || CITY_BUILDING_DEFAULT_RADIUS))));
        const depthScale = 1 - defenseMetrics.tiltBlend;
        const topHeightPx = Math.max(10, Math.round(radiusPx * (0.6 + (defenseMetrics.tiltBlend * 0.25))));
        const bodyHeightPx = Math.max(4, Math.round(radiusPx * (0.35 + (depthScale * 1.05))));
        const totalHeightPx = bodyHeightPx + topHeightPx;
        const isSelected = defenseLayoutState.selectedBuildingId === building.buildingId;
        const isDragging = defenseLayoutState.draggingBuildingId === building.buildingId;
        const canEditBuilding = defenseLayoutState.canEdit && defenseLayoutState.buildMode;
        const isIntelSearched = (intelHeistState.searchedBuildingIds || []).includes(building.buildingId);
        const isIntelActive = isIntelHeistMode && intelHeistState.activeBuildingId === building.buildingId;
        const intelSearchLocked = isIntelHeistMode && (
          !intelHeistState.active
          || intelHeistState.resultOpen
          || intelHeistState.timeoutTriggered
          || intelHeistState.submitting
          || (!!intelHeistState.activeBuildingId && intelHeistState.activeBuildingId !== building.buildingId)
        );
        const intelBuildingDisabled = isIntelHeistMode && (isIntelSearched || intelSearchLocked);
        return (
          <button
            key={building.buildingId}
            type="button"
            className={`city-defense-building ${building.isIntel ? 'intel' : ''} ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${canEditBuilding ? 'editable' : ''} ${isIntelHeistMode ? 'intel-heist-searchable' : ''} ${isIntelSearched ? 'searched' : ''} ${isIntelActive ? 'is-searching' : ''}`}
            style={{
              left: `${px - radiusPx}px`,
              top: `${py - totalHeightPx}px`,
              width: `${radiusPx * 2}px`,
              height: `${totalHeightPx}px`,
              '--cylinder-top-height': `${topHeightPx}px`,
              '--cylinder-body-height': `${bodyHeightPx}px`
            }}
            onPointerDown={(event) => {
              if (isIntelHeistMode) {
                event.stopPropagation();
                return;
              }
              handleDefenseBuildingPointerDown(event, building.buildingId);
            }}
            onClick={() => {
              if (isIntelHeistMode) {
                if (intelBuildingDisabled) return;
                startIntelHeistSearch(building.buildingId);
                return;
              }
              if (!canEditBuilding) return;
              setDefenseLayoutState((prev) => ({
                ...prev,
                selectedBuildingId: building.buildingId,
                selectedBuildingTypeId: building.buildingTypeId || prev.selectedBuildingTypeId
              }));
            }}
            disabled={intelBuildingDisabled}
          >
            <span className="city-defense-building-top" />
            <span className="city-defense-building-body" />
            {building.isIntel && <span className="city-defense-intel-badge">情报文件</span>}
            <span className="city-defense-building-label">{building.displayName || `建筑${building.ordinal}`}</span>
            {isIntelActive && (
              <span className="intel-heist-building-progress">
                <span
                  className="intel-heist-building-progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, intelHeistActiveSearchRatio * 100))}%` }}
                />
              </span>
            )}
          </button>
        );
      })}
    </div>
    {showBuildingPalette && (
      <aside className="city-build-palette">
        <div className="city-build-palette-title">建筑物（左侧拖拽）</div>
        <div className="city-build-palette-list">
          {buildingCatalog.length === 0 && (
            <div className="city-build-palette-tip">暂无可用建筑类型，请先在管理员面板配置建筑目录。</div>
          )}
          {buildingCatalog.map((item) => {
            const used = buildingTypeUsageMap.get(item.buildingTypeId) || 0;
            const limit = Math.max(0, Math.floor(Number(item.initialCount) || 0));
            const remaining = Math.max(0, limit - used);
            return (
              <button
                key={item.buildingTypeId}
                type="button"
                draggable={remaining > 0}
                disabled={remaining <= 0}
                className={`city-build-palette-card ${defenseLayoutState.selectedBuildingTypeId === item.buildingTypeId ? 'selected' : ''} ${draggingBuildingTypeId === item.buildingTypeId ? 'dragging' : ''}`}
                onClick={() => updateSelectedBuildingType(item.buildingTypeId)}
                onDragStart={(event) => handleBuildingPaletteDragStart(event, item.buildingTypeId)}
                onDragEnd={handleBuildingPaletteDragEnd}
              >
                <strong>{item.name}</strong>
                <span>{`库存 ${remaining}/${limit}`}</span>
              </button>
            );
          })}
        </div>
        <div className="city-build-palette-tip">拖拽建筑到城市地图空位放置</div>
      </aside>
    )}
    {showGateLayer && (
      <div ref={cityGateLayerRef} className="city-gate-layer">
        {hasParentEntrance && (
          <button
            type="button"
            className={`city-gate-trigger cheng ${canInspectGateDefense ? 'editable' : ''}`}
            style={{
              left: `${gatePositions.cheng.x - 84}px`,
              top: `${gatePositions.cheng.y - 34}px`
            }}
            title={`${CITY_GATE_LABELS.cheng}：${CITY_GATE_TOOLTIPS.cheng}`}
            onClick={() => openBattlefieldPreview('cheng')}
            disabled={!canInspectGateDefense}
          >
            <span className="city-gate-name">{CITY_GATE_LABELS.cheng}</span>
            {canInspectGateDefense && (
              <span className="city-gate-total">{`驻防 ${gateTotals.cheng}`}</span>
            )}
          </button>
        )}
        {hasChildEntrance && (
          <button
            type="button"
            className={`city-gate-trigger qi ${canInspectGateDefense ? 'editable' : ''}`}
            style={{
              left: `${gatePositions.qi.x - 84}px`,
              top: `${gatePositions.qi.y - 34}px`
            }}
            title={`${CITY_GATE_LABELS.qi}：${CITY_GATE_TOOLTIPS.qi}`}
            onClick={() => openBattlefieldPreview('qi')}
            disabled={!canInspectGateDefense}
          >
            <span className="city-gate-name">{CITY_GATE_LABELS.qi}</span>
            {canInspectGateDefense && (
              <span className="city-gate-total">{`驻防 ${gateTotals.qi}`}</span>
            )}
          </button>
        )}
      </div>
    )}
  </>
);

export default KnowledgeDomainCityView;
