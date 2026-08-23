import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Grid,
  Monitor,
  Settings2,
  Swords,
  X
} from 'lucide-react';
import { TRAINING_FONT_SIZE_OPTIONS } from '../../screens/battleSceneConstants';

const formatInterval = (seconds = 60) => {
  const value = Math.max(1, Number(seconds) || 60);
  if (value < 60) return `${value} 秒 / 点`;
  if (value % 60 === 0 && value < 300) return `${value / 60} 分钟 / 点`;
  return `${Math.round(value / 60)} 分钟 / 点`;
};

const formatRespawnDelay = (seconds = 20) => `${Math.max(0, Number(seconds) || 0)} 秒`;

const normalizeFontSize = (value = '') => (
  TRAINING_FONT_SIZE_OPTIONS.some((option) => option.value === value) ? value : 'medium'
);

const TrainingSettingsModal = ({
  open = false,
  state = null,
  settings = null,
  onClose,
  onChangeAutoSkillPointGain,
  onChangeInterval,
  onChangeRespawnDelay,
  onChangeMapPreset,
  onApply
}) => {
  const [activeTab, setActiveTab] = useState('battle');
  const [draftAutoSkillPointGain, setDraftAutoSkillPointGain] = useState(false);
  const [draftInterval, setDraftInterval] = useState(60);
  const [draftFontSize, setDraftFontSize] = useState('medium');
  const [draftShowGrid, setDraftShowGrid] = useState(true);
  const [draftMapPresetId, setDraftMapPresetId] = useState('');
  const [draftRespawnDelay, setDraftRespawnDelay] = useState(20);
  const wasOpenRef = useRef(false);

  const intervals = Array.isArray(state?.pointIntervals) && state.pointIntervals.length > 0
    ? state.pointIntervals
    : [10, 30, 60, 120, 300];
  const currentInterval = Math.max(1, Number(state?.pointIntervalSec) || intervals[0] || 60);
  const currentAutoSkillPointGain = state?.autoSkillPointGainEnabled === true;
  const mapState = state?.map && typeof state.map === 'object' ? state.map : null;
  const mapPresets = Array.isArray(mapState?.presets) ? mapState.presets : [];
  const currentMapPresetId = String(mapState?.activePresetId || '');
  const respawnDelayOptions = Array.isArray(state?.respawnDelayOptions) && state.respawnDelayOptions.length > 0
    ? state.respawnDelayOptions
    : [10, 20, 30, 45, 60];
  const currentRespawnDelay = Math.max(0, Number(state?.respawnDelaySec) || 20);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setActiveTab('battle');
      setDraftAutoSkillPointGain(currentAutoSkillPointGain);
      setDraftInterval(currentInterval);
      setDraftFontSize(normalizeFontSize(settings?.fontSize));
      setDraftShowGrid(settings?.showGrid !== false);
      setDraftMapPresetId(currentMapPresetId);
      setDraftRespawnDelay(currentRespawnDelay);
    }
    wasOpenRef.current = open;
  }, [currentAutoSkillPointGain, currentInterval, currentMapPresetId, currentRespawnDelay, open, settings?.fontSize, settings?.showGrid]);

  if (!open) return null;

  const handleApply = () => {
    if (draftAutoSkillPointGain !== currentAutoSkillPointGain) {
      onChangeAutoSkillPointGain?.(draftAutoSkillPointGain);
    }
    if (draftAutoSkillPointGain && draftInterval !== currentInterval) onChangeInterval?.(draftInterval);
    if (draftRespawnDelay !== currentRespawnDelay) onChangeRespawnDelay?.(draftRespawnDelay);
    if (draftMapPresetId && draftMapPresetId !== currentMapPresetId) onChangeMapPreset?.(draftMapPresetId);
    onApply?.({
      fontSize: normalizeFontSize(draftFontSize),
      showGrid: draftShowGrid !== false
    });
    onClose?.();
  };

  return (
    <div className="pve2-training-settings-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section className="pve2-training-settings-modal" role="dialog" aria-modal="true" aria-label="训练场设置" onMouseDown={(event) => event.stopPropagation()}>
        <header className="pve2-training-settings-head">
          <div>
            <span>训练场设置</span>
            <h3><Settings2 size={18} aria-hidden="true" /> 设置</h3>
          </div>
          <button type="button" className="pve2-training-settings-close" onClick={onClose} title="关闭设置" aria-label="关闭设置">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="pve2-training-settings-tabs" role="tablist" aria-label="训练场设置选项">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'battle'}
            className={activeTab === 'battle' ? 'is-active' : ''}
            onClick={() => setActiveTab('battle')}
          >
            <Swords size={15} aria-hidden="true" />
            战斗设置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'ui'}
            className={activeTab === 'ui' ? 'is-active' : ''}
            onClick={() => setActiveTab('ui')}
          >
            <Monitor size={15} aria-hidden="true" />
            UI 设置
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'battlefield'}
            className={activeTab === 'battlefield' ? 'is-active' : ''}
            onClick={() => setActiveTab('battlefield')}
          >
            <Grid size={15} aria-hidden="true" />
            战场设置
          </button>
        </div>

        <div className="pve2-training-settings-body">
          {activeTab === 'battle' ? (
            <>
              <section className="pve2-training-settings-section pve2-training-settings-rate">
                <div className="pve2-training-settings-rate-head">
                  <div>
                    <span className="pve2-training-settings-label">自动获得技能点</span>
                    <small>开启后，每支可操作部队独立获得技能点</small>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draftAutoSkillPointGain}
                    aria-label="自动获得技能点"
                    className={`pve2-training-settings-ios-switch ${draftAutoSkillPointGain ? 'is-on' : ''}`}
                    onClick={() => setDraftAutoSkillPointGain((enabled) => !enabled)}
                  >
                    <i aria-hidden="true" />
                  </button>
                </div>
                {draftAutoSkillPointGain ? (
                  <>
                    <div className="pve2-training-settings-rate-head is-interval">
                      <span className="pve2-training-settings-label">获取速度</span>
                      <strong>{formatInterval(draftInterval)}</strong>
                    </div>
                    <div className="pve2-training-settings-rate-options" role="radiogroup" aria-label="技能点获取速度">
                      {intervals.map((interval) => (
                        <button
                          key={interval}
                          type="button"
                          role="radio"
                          aria-checked={draftInterval === Number(interval)}
                          className={draftInterval === Number(interval) ? 'is-active' : ''}
                          onClick={() => setDraftInterval(Number(interval))}
                        >
                          {formatInterval(interval)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
              <section className="pve2-training-settings-section pve2-training-settings-respawn">
                <div className="pve2-training-settings-rate-head is-interval">
                  <div>
                    <span className="pve2-training-settings-label">部队重生等待</span>
                    <small>整支部队覆灭后，在所属高地重生点恢复满编</small>
                  </div>
                  <strong>{formatRespawnDelay(draftRespawnDelay)}</strong>
                </div>
                <div className="pve2-training-settings-rate-options" role="radiogroup" aria-label="部队重生等待时间">
                  {respawnDelayOptions.map((delay) => (
                    <button
                      key={delay}
                      type="button"
                      role="radio"
                      aria-checked={draftRespawnDelay === Number(delay)}
                      className={draftRespawnDelay === Number(delay) ? 'is-active' : ''}
                      onClick={() => setDraftRespawnDelay(Number(delay))}
                    >
                      {formatRespawnDelay(delay)}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {activeTab === 'ui' ? (
            <section className="pve2-training-settings-section pve2-training-settings-ui">
              <span className="pve2-training-settings-label">字体大小</span>
              <div className="pve2-training-settings-font-options" role="radiogroup" aria-label="字体大小">
                {TRAINING_FONT_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={draftFontSize === option.value}
                    className={draftFontSize === option.value ? 'is-active' : ''}
                    onClick={() => setDraftFontSize(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {activeTab === 'battlefield' ? (
            <section className="pve2-training-settings-section pve2-training-settings-battlefield">
              {mapPresets.length > 0 ? (
                <>
                  <span className="pve2-training-settings-label">地图预设</span>
                  <div className="pve2-training-settings-rate-options" role="radiogroup" aria-label="地图预设">
                    {mapPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={draftMapPresetId === preset.id}
                        className={draftMapPresetId === preset.id ? 'is-active' : ''}
                        disabled={state?.sessionActive === true}
                        onClick={() => setDraftMapPresetId(preset.id)}
                      >
                        {preset.label || preset.id}
                      </button>
                    ))}
                  </div>
                  {state?.sessionActive === true ? <small>重置训练后可切换地图预设</small> : null}
                </>
              ) : null}
              <label className="pve2-training-settings-toggle">
                <span>显示网格线</span>
                <input
                  type="checkbox"
                  checked={draftShowGrid}
                  aria-label="显示网格线"
                  onChange={(event) => setDraftShowGrid(event.target.checked)}
                />
              </label>
            </section>
          ) : null}
        </div>

        <footer className="pve2-training-settings-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-warning" onClick={handleApply}><Check size={16} aria-hidden="true" /> 应用</button>
        </footer>
      </section>
    </div>
  );
};

export default TrainingSettingsModal;
