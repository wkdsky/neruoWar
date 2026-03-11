export const TABLE_WIDTH_PRESETS = Object.freeze({
  auto: null,
  narrow: 60,
  medium: 72,
  wide: 88,
  full: 100
});

export const TABLE_WIDTH_MODES = Object.freeze(['auto', 'narrow', 'medium', 'wide', 'full', 'custom']);
export const DEFAULT_TABLE_WIDTH_MODE = 'auto';
export const DEFAULT_TABLE_WIDTH_VALUE = 100;
export const MIN_TABLE_WIDTH_VALUE = 40;
export const MAX_TABLE_WIDTH_VALUE = 100;

export const clampTableWidthValue = (value, fallback = DEFAULT_TABLE_WIDTH_VALUE) => {
  const numericValue = Number.parseFloat(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(MAX_TABLE_WIDTH_VALUE, Math.max(MIN_TABLE_WIDTH_VALUE, Math.round(numericValue)));
};

export const normalizeTableWidthMode = (value = '') => (
  TABLE_WIDTH_MODES.includes(String(value || '').trim()) ? String(value || '').trim() : DEFAULT_TABLE_WIDTH_MODE
);

export const resolveTableWidthValue = ({ tableWidthMode = DEFAULT_TABLE_WIDTH_MODE, tableWidthValue = DEFAULT_TABLE_WIDTH_VALUE } = {}) => {
  const normalizedMode = normalizeTableWidthMode(tableWidthMode);
  if (normalizedMode === 'auto') return null;
  if (Object.prototype.hasOwnProperty.call(TABLE_WIDTH_PRESETS, normalizedMode) && TABLE_WIDTH_PRESETS[normalizedMode] !== null) {
    return TABLE_WIDTH_PRESETS[normalizedMode];
  }
  return clampTableWidthValue(tableWidthValue);
};

export const formatTableWidthLabel = ({ tableWidthMode = DEFAULT_TABLE_WIDTH_MODE, tableWidthValue = DEFAULT_TABLE_WIDTH_VALUE } = {}) => {
  const normalizedMode = normalizeTableWidthMode(tableWidthMode);
  if (normalizedMode === 'auto') return '自适应';
  const resolvedValue = resolveTableWidthValue({ tableWidthMode: normalizedMode, tableWidthValue });
  return resolvedValue ? `${resolvedValue}%` : '自适应';
};

export const buildTableWidthPayload = ({ tableWidthMode = DEFAULT_TABLE_WIDTH_MODE, tableWidthValue = DEFAULT_TABLE_WIDTH_VALUE } = {}) => {
  const normalizedMode = normalizeTableWidthMode(tableWidthMode);
  if (normalizedMode === 'auto') {
    return {
      tableWidthMode: 'auto',
      tableWidthValue: String(DEFAULT_TABLE_WIDTH_VALUE)
    };
  }
  const resolvedValue = resolveTableWidthValue({ tableWidthMode: normalizedMode, tableWidthValue });
  return {
    tableWidthMode: normalizedMode,
    tableWidthValue: String(clampTableWidthValue(resolvedValue))
  };
};
