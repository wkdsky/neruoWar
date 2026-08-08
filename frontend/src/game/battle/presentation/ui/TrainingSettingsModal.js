import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Grid,
  Minus,
  Monitor,
  Plus,
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

const normalizeFontSize = (value = '') => (
  TRAINING_FONT_SIZE_OPTIONS.some((option) => option.value === value) ? value : 'medium'
);

const TrainingSettingsModal = ({
  open = false,
  state = null,
  settings = null,
  onClose,
  onAdjustPoints,
  onChangeInterval,
  onApply
}) => {
  const [activeTab, setActiveTab] = useState('battle');
  const [customDelta, setCustomDelta] = useState('1');
  const [pointDelta, setPointDelta] = useState(0);
  const [draftInterval, setDraftInterval] = useState(60);
  const [draftFontSize, setDraftFontSize] = useState('medium');
  const [draftShowGrid, setDraftShowGrid] = useState(true);
  const wasOpenRef = useRef(false);

  const points = Math.max(0, Number(state?.points) || 0);
  const intervals = Array.isArray(state?.pointIntervals) && state.pointIntervals.length > 0
    ? state.pointIntervals
    : [10, 30, 60, 120, 300];
  const currentInterval = Math.max(1, Number(state?.pointIntervalSec) || intervals[0] || 60);
  const shownPoints = Math.max(0, Math.min(9999, points + pointDelta));

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setActiveTab('battle');
      setCustomDelta('1');
      setPointDelta(0);
      setDraftInterval(currentInterval);
      setDraftFontSize(normalizeFontSize(settings?.fontSize));
      setDraftShowGrid(settings?.showGrid !== false);
    }
    wasOpenRef.current = open;
  }, [currentInterval, open, settings?.fontSize, settings?.showGrid]);

  if (!open) return null;

  const adjustDraftPoints = (direction) => {
    const step = Math.max(1, Number(customDelta) || 1);
    setPointDelta((previous) => Math.max(
      -points,
      Math.min(9999 - points, previous + (direction * step))
    ));
  };

  const handleApply = () => {
    if (pointDelta !== 0) onAdjustPoints?.(pointDelta);
    if (draftInterval !== currentInterval) onChangeInterval?.(draftInterval);
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
              <section className="pve2-training-settings-section pve2-training-settings-points">
                <div>
                  <span className="pve2-training-settings-label">技能点</span>
                  <strong>{shownPoints}</strong>
                </div>
                <div className="pve2-training-settings-stepper">
                  <button type="button" onClick={() => adjustDraftPoints(-1)} title="减少技能点" aria-label="减少技能点"><Minus size={15} /></button>
                  <input
                    value={customDelta}
                    inputMode="numeric"
                    aria-label="技能点调整数值"
                    onChange={(event) => setCustomDelta(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                  />
                  <button type="button" onClick={() => adjustDraftPoints(1)} title="增加技能点" aria-label="增加技能点"><Plus size={15} /></button>
                </div>
              </section>

              <section className="pve2-training-settings-section pve2-training-settings-rate">
                <div className="pve2-training-settings-rate-head">
                  <span className="pve2-training-settings-label">技能点获取速度</span>
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
                <span className="pve2-training-settings-next">下一点：{Math.ceil(Math.max(0, Number(state?.nextPointInSec) || 0))} 秒</span>
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
