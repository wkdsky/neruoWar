import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './NumberPadDialog.css';

const NUMBER_PAD_ROWS = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['C', '0', 'DEL']
];

const clampInteger = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  const rounded = Math.floor(parsed);
  return Math.max(min, Math.min(max, rounded));
};

const NumberPadDialog = ({
  open = false,
  title = '输入数量',
  description = '',
  min = 1,
  max = 1,
  initialValue = 1,
  confirmLabel = '确认',
  cancelLabel = '取消',
  onConfirm,
  onCancel
}) => {
  const safeMin = useMemo(() => Math.max(0, Math.floor(Number(min) || 0)), [min]);
  const safeMax = useMemo(
    () => Math.max(safeMin, Math.floor(Number(max) || safeMin)),
    [max, safeMin]
  );
  const safeInitial = useMemo(
    () => clampInteger(initialValue, safeMin, safeMax),
    [initialValue, safeMax, safeMin]
  );
  const [valueText, setValueText] = useState(String(safeInitial));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setValueText(String(safeInitial));
    setError('');
  }, [open, safeInitial]);

  if (!open) return null;

  const normalizeRawValue = (raw) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) {
      setValueText('');
      return;
    }
    const clamped = clampInteger(digits, safeMin, safeMax);
    setValueText(String(clamped));
  };

  const numericValue = Number(valueText);
  const hasNumericValue = Number.isFinite(numericValue) && Number.isInteger(numericValue);
  const displayValue = hasNumericValue
    ? clampInteger(numericValue, safeMin, safeMax)
    : safeMin;

  const handleConfirm = () => {
    if (!hasNumericValue || numericValue < safeMin || numericValue > safeMax) {
      setError(`请输入 ${safeMin} - ${safeMax} 的整数`);
      return;
    }
    setError('');
    if (typeof onConfirm === 'function') {
      onConfirm(clampInteger(numericValue, safeMin, safeMax));
    }
  };

  const handleKeypadPress = (key) => {
    setError('');
    if (key === 'C') {
      setValueText('');
      return;
    }
    if (key === 'DEL') {
      setValueText((prev) => prev.slice(0, -1));
      return;
    }
    normalizeRawValue(`${valueText}${key}`);
  };

  return createPortal(
    <div
      className="number-pad-dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && typeof onCancel === 'function') {
          onCancel();
        }
      }}
    >
      <div className="number-pad-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="number-pad-dialog-header">
          <strong>{title}</strong>
        </div>
        {!!description && <div className="number-pad-dialog-desc">{description}</div>}
        <div className="number-pad-value-row">
          <input
            type="text"
            inputMode="numeric"
            className="number-pad-value-input"
            value={valueText}
            onChange={(event) => {
              setError('');
              normalizeRawValue(event.target.value);
            }}
            placeholder={`${safeMin}-${safeMax}`}
          />
          <span className="number-pad-value-limit">{`范围 ${safeMin} - ${safeMax}`}</span>
        </div>
        <input
          type="range"
          className="number-pad-slider"
          min={safeMin}
          max={safeMax}
          step={1}
          value={displayValue}
          onChange={(event) => {
            setError('');
            normalizeRawValue(event.target.value);
          }}
        />
        <div className="number-pad-grid">
          {NUMBER_PAD_ROWS.flat().map((key) => (
            <button
              key={key}
              type="button"
              className={`number-pad-key ${key === 'C' || key === 'DEL' ? 'utility' : ''}`}
              onClick={() => handleKeypadPress(key)}
            >
              {key === 'DEL' ? '⌫' : key}
            </button>
          ))}
        </div>
        {error && <div className="number-pad-error">{error}</div>}
        <div className="number-pad-actions">
          <button type="button" className="btn btn-small btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn btn-small btn-primary" onClick={handleConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default NumberPadDialog;
