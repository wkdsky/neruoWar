import React, { useState } from 'react';
import { Minus, Plus, Settings2, X } from 'lucide-react';

const formatInterval = (seconds = 60) => {
  const value = Math.max(1, Number(seconds) || 60);
  if (value < 60) return `${value} 秒 / 点`;
  if (value % 60 === 0 && value < 300) return `${value / 60} 分钟 / 点`;
  return `${Math.round(value / 60)} 分钟 / 点`;
};

const TrainingSettingsModal = ({
  open = false,
  state = null,
  onClose,
  onAdjustPoints,
  onChangeInterval
}) => {
  const [customDelta, setCustomDelta] = useState('1');
  if (!open) return null;
  const points = Math.max(0, Number(state?.points) || 0);
  const intervals = Array.isArray(state?.pointIntervals) && state.pointIntervals.length > 0
    ? state.pointIntervals
    : [10, 30, 60, 120, 300];
  return (
    <div className="pve2-training-settings-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section className="pve2-training-settings-modal" role="dialog" aria-modal="true" aria-label="训练场设置" onMouseDown={(event) => event.stopPropagation()}>
        <header className="pve2-training-settings-head">
          <div>
            <span>训练场设置</span>
            <h3><Settings2 size={18} aria-hidden="true" /> 技能点与节奏</h3>
          </div>
          <button type="button" className="pve2-training-settings-close" onClick={onClose} title="关闭设置" aria-label="关闭设置">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="pve2-training-settings-points">
          <div>
            <span className="pve2-training-settings-label">当前技能点</span>
            <strong>{points}</strong>
          </div>
          <div className="pve2-training-settings-stepper">
            <button type="button" onClick={() => onAdjustPoints?.(-Math.max(1, Number(customDelta) || 1))} title="减少技能点" aria-label="减少技能点"><Minus size={15} /></button>
            <input
              value={customDelta}
              inputMode="numeric"
              aria-label="技能点调整数值"
              onChange={(event) => setCustomDelta(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            />
            <button type="button" onClick={() => onAdjustPoints?.(Math.max(1, Number(customDelta) || 1))} title="增加技能点" aria-label="增加技能点"><Plus size={15} /></button>
          </div>
        </div>

        <div className="pve2-training-settings-rate">
          <div className="pve2-training-settings-rate-head">
            <span className="pve2-training-settings-label">技能点获取速度</span>
            <strong>{formatInterval(state?.pointIntervalSec)}</strong>
          </div>
          <div className="pve2-training-settings-rate-options" role="radiogroup" aria-label="技能点获取速度">
            {intervals.map((interval) => (
              <button
                key={interval}
                type="button"
                role="radio"
                aria-checked={Number(state?.pointIntervalSec) === Number(interval)}
                className={Number(state?.pointIntervalSec) === Number(interval) ? 'is-active' : ''}
                onClick={() => onChangeInterval?.(interval)}
              >
                {formatInterval(interval)}
              </button>
            ))}
          </div>
          <span className="pve2-training-settings-next">下一点：{Math.ceil(Math.max(0, Number(state?.nextPointInSec) || 0))} 秒</span>
        </div>
      </section>
    </div>
  );
};

export default TrainingSettingsModal;
