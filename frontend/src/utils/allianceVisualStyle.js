export const ALLIANCE_PATTERN_OPTIONS = [
  { value: 'none', label: '无底纹' },
  { value: 'dots', label: '点阵' },
  { value: 'grid', label: '网格' },
  { value: 'diagonal', label: '斜纹' },
  { value: 'rings', label: '环纹' },
  { value: 'noise', label: '噪点' }
];

export const DEFAULT_ALLIANCE_VISUAL_STYLE = {
  name: '主视觉',
  primaryColor: '#7c3aed',
  secondaryColor: '#312e81',
  glowColor: '#c084fc',
  rimColor: '#f5d0fe',
  textColor: '#ffffff',
  patternType: 'diagonal'
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const VALID_PATTERN_TYPES = new Set(ALLIANCE_PATTERN_OPTIONS.map((item) => item.value));

const normalizeHexColor = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
};

export const normalizeAllianceVisualStyle = (rawStyle = {}, fallbackName = '主视觉') => {
  const style = rawStyle && typeof rawStyle === 'object' ? rawStyle : {};
  const name = typeof style.name === 'string' ? style.name.trim() : '';
  const patternType = typeof style.patternType === 'string'
    ? style.patternType.trim().toLowerCase()
    : '';

  return {
    name: name || fallbackName,
    primaryColor: normalizeHexColor(style.primaryColor, DEFAULT_ALLIANCE_VISUAL_STYLE.primaryColor),
    secondaryColor: normalizeHexColor(style.secondaryColor, DEFAULT_ALLIANCE_VISUAL_STYLE.secondaryColor),
    glowColor: normalizeHexColor(style.glowColor, DEFAULT_ALLIANCE_VISUAL_STYLE.glowColor),
    rimColor: normalizeHexColor(style.rimColor, DEFAULT_ALLIANCE_VISUAL_STYLE.rimColor),
    textColor: normalizeHexColor(style.textColor, DEFAULT_ALLIANCE_VISUAL_STYLE.textColor),
    patternType: VALID_PATTERN_TYPES.has(patternType)
      ? patternType
      : DEFAULT_ALLIANCE_VISUAL_STYLE.patternType
  };
};

export const getActiveAllianceVisualStyle = (alliance) => {
  if (!alliance || typeof alliance !== 'object') {
    return normalizeAllianceVisualStyle(DEFAULT_ALLIANCE_VISUAL_STYLE);
  }

  const styleList = Array.isArray(alliance.visualStyles) ? alliance.visualStyles : [];
  const activeId = (alliance.activeVisualStyleId || '').toString();
  const activeStyle = styleList.find((item) => (item?._id || '').toString() === activeId) || styleList[0];
  if (activeStyle) {
    return normalizeAllianceVisualStyle(activeStyle, activeStyle.name || '主视觉');
  }

  return normalizeAllianceVisualStyle({
    ...DEFAULT_ALLIANCE_VISUAL_STYLE,
    primaryColor: alliance.flag || DEFAULT_ALLIANCE_VISUAL_STYLE.primaryColor
  });
};
