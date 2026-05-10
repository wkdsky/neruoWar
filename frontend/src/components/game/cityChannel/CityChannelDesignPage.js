import React from 'react';
import { RotateCcw, Save, Upload, Wand2 } from 'lucide-react';
import CityChannelEditorCanvas from './CityChannelEditorCanvas';
import CityChannelInspector from './CityChannelInspector';
import CityChannelPalette from './CityChannelPalette';
import {
  CITY_CHANNEL_LAYER_LABELS
} from './cityChannelSchema';
import useCityChannelEditorState from './useCityChannelEditorState';
import './CityChannelDesignPage.css';

const CityChannelDesignPage = () => {
  const editor = useCityChannelEditorState();
  const {
    mapData,
    activeLayer,
    activeTool,
    selectedCell,
    validationResult,
    statusMessage,
    routeKeySet,
    setActiveTool,
    switchLayer,
    resetMap,
    saveToLocal,
    loadFromLocal,
    validateSafeRoute,
    handleCellAction
  } = editor;

  return (
    <section className="city-channel-design">
      <header className="city-channel-design__header">
        <div>
          <h3>城内通道设计</h3>
          <p>第一阶段草稿编辑器：铺设板材、入口出口、层级切换与白线通路验证。</p>
        </div>
        <div className="city-channel-design__actions">
          <button type="button" className="btn btn-secondary btn-small" onClick={loadFromLocal}>
            <Upload size={15} />
            加载草稿
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={saveToLocal}>
            <Save size={15} />
            保存草稿
          </button>
          <button type="button" className="btn btn-primary btn-small" onClick={validateSafeRoute}>
            <Wand2 size={15} />
            验证白线通路
          </button>
          <button type="button" className="btn btn-warning btn-small" onClick={resetMap}>
            <RotateCcw size={15} />
            重置地图
          </button>
        </div>
      </header>

      <div className="city-channel-layer-strip" aria-label="层级切换">
        {CITY_CHANNEL_LAYER_LABELS.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`city-channel-layer-btn ${activeLayer === index ? 'is-active' : ''}`}
            onClick={() => switchLayer(index)}
          >
            <span>{label}</span>
            <em>{`Layer ${index}`}</em>
          </button>
        ))}
      </div>

      <div className="city-channel-layout">
        <CityChannelPalette
          activeTool={activeTool}
          onToolChange={setActiveTool}
        />

        <main className="city-channel-stage">
          <CityChannelEditorCanvas
            mapData={mapData}
            activeLayer={activeLayer}
            selectedCell={selectedCell}
            routeKeySet={routeKeySet}
            onCellClick={handleCellAction}
          />
        </main>

        <CityChannelInspector
          mapData={mapData}
          activeLayer={activeLayer}
          activeTool={activeTool}
          selectedCell={selectedCell}
          validationResult={validationResult}
          routeKeySet={routeKeySet}
        />
      </div>

      <footer className={`city-channel-status ${validationResult.ok ? 'is-ok' : 'is-neutral'}`}>
        <span>{statusMessage}</span>
        <em>{validationResult.message}</em>
      </footer>
    </section>
  );
};

export default CityChannelDesignPage;
