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

export const DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE = {
  name: '百科主视觉',
  pageBackgroundStart: '#0f172a',
  pageBackgroundEnd: '#38bdf8',
  panelBackground: '#1e293b',
  panelBorder: '#dbeafe',
  contentBackground: '#f8fafc',
  accentColor: '#38bdf8',
  titleColor: '#eef8ff',
  bodyTextColor: '#0f172a',
  mutedTextColor: '#cbd5e1',
  codeBackground: '#020617'
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

export const createDefaultAllianceSenseArticleStyle = (rawVisualStyle = {}, fallbackName = '百科主视觉') => {
  const visualStyle = normalizeAllianceVisualStyle(rawVisualStyle, fallbackName);
  return {
    name: fallbackName,
    pageBackgroundStart: normalizeHexColor(visualStyle.secondaryColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.pageBackgroundStart),
    pageBackgroundEnd: normalizeHexColor(visualStyle.primaryColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.pageBackgroundEnd),
    panelBackground: normalizeHexColor(visualStyle.secondaryColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.panelBackground),
    panelBorder: normalizeHexColor(visualStyle.rimColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.panelBorder),
    contentBackground: DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.contentBackground,
    accentColor: normalizeHexColor(visualStyle.glowColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.accentColor),
    titleColor: normalizeHexColor(visualStyle.textColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.titleColor),
    bodyTextColor: DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.bodyTextColor,
    mutedTextColor: normalizeHexColor(visualStyle.rimColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.mutedTextColor),
    codeBackground: DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.codeBackground
  };
};

export const normalizeAllianceSenseArticleStyle = (rawStyle = {}, fallbackName = '百科主视觉', rawVisualStyle = null) => {
  const style = rawStyle && typeof rawStyle === 'object' ? rawStyle : {};
  const name = typeof style.name === 'string' ? style.name.trim() : '';
  const fallback = createDefaultAllianceSenseArticleStyle(rawVisualStyle || {}, fallbackName);

  return {
    name: name || fallbackName,
    pageBackgroundStart: normalizeHexColor(style.pageBackgroundStart, fallback.pageBackgroundStart),
    pageBackgroundEnd: normalizeHexColor(style.pageBackgroundEnd, fallback.pageBackgroundEnd),
    panelBackground: normalizeHexColor(style.panelBackground, fallback.panelBackground),
    panelBorder: normalizeHexColor(style.panelBorder, fallback.panelBorder),
    contentBackground: normalizeHexColor(style.contentBackground, fallback.contentBackground),
    accentColor: normalizeHexColor(style.accentColor, fallback.accentColor),
    titleColor: normalizeHexColor(style.titleColor, fallback.titleColor),
    bodyTextColor: normalizeHexColor(style.bodyTextColor, fallback.bodyTextColor),
    mutedTextColor: normalizeHexColor(style.mutedTextColor, fallback.mutedTextColor),
    codeBackground: normalizeHexColor(style.codeBackground, fallback.codeBackground)
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

export const getActiveAllianceSenseArticleStyle = (alliance) => {
  const fallbackVisualStyle = getActiveAllianceVisualStyle(alliance);
  if (!alliance || typeof alliance !== 'object') {
    return normalizeAllianceSenseArticleStyle(DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.name, fallbackVisualStyle);
  }

  const styleList = Array.isArray(alliance.senseArticleStyles) ? alliance.senseArticleStyles : [];
  const activeId = (alliance.activeSenseArticleStyleId || '').toString();
  const activeStyle = styleList.find((item) => (item?._id || '').toString() === activeId) || styleList[0];
  if (activeStyle) {
    return normalizeAllianceSenseArticleStyle(activeStyle, activeStyle.name || '百科主视觉', fallbackVisualStyle);
  }

  return normalizeAllianceSenseArticleStyle(
    createDefaultAllianceSenseArticleStyle(fallbackVisualStyle, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.name),
    DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.name,
    fallbackVisualStyle
  );
};
