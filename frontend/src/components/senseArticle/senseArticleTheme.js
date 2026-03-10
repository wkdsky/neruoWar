import {
  DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE,
  getActiveAllianceSenseArticleStyle,
  normalizeAllianceSenseArticleStyle
} from '../../utils/allianceVisualStyle';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const normalizeHex = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
};

const hexToRgba = (hex, alpha = 1) => {
  const normalized = normalizeHex(hex, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.accentColor).replace('#', '');
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const resolveAllianceFromNode = (node = null) => {
  if (!node || typeof node !== 'object') return null;
  return node?.domainMaster?.alliance || null;
};

export const buildSenseArticleAllianceContext = (node = null, fallback = null) => {
  const alliance = resolveAllianceFromNode(node) || fallback?.alliance || null;
  const allianceSenseArticleStyle = alliance
    ? getActiveAllianceSenseArticleStyle(alliance)
    : (fallback?.allianceSenseArticleStyle
      ? normalizeAllianceSenseArticleStyle(fallback.allianceSenseArticleStyle, fallback?.allianceName || '百科主视觉')
      : null);

  return {
    domainMasterName: node?.domainMaster?.username || fallback?.domainMasterName || '',
    allianceName: alliance?.name || fallback?.allianceName || '',
    allianceFlag: alliance?.flag || fallback?.allianceFlag || '',
    alliance: alliance || fallback?.alliance || null,
    allianceSenseArticleStyle: allianceSenseArticleStyle || null
  };
};

export const buildSenseArticleThemeStyle = (source = null) => {
  const context = source?.node
    ? buildSenseArticleAllianceContext(source.node, source)
    : buildSenseArticleAllianceContext(null, source || {});
  const style = context.allianceSenseArticleStyle
    ? normalizeAllianceSenseArticleStyle(context.allianceSenseArticleStyle, context.allianceName || '百科主视觉')
    : normalizeAllianceSenseArticleStyle(DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.name);

  const pageStart = normalizeHex(style.pageBackgroundStart, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.pageBackgroundStart);
  const pageEnd = normalizeHex(style.pageBackgroundEnd, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.pageBackgroundEnd);
  const panelBackground = normalizeHex(style.panelBackground, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.panelBackground);
  const panelBorder = normalizeHex(style.panelBorder, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.panelBorder);
  const contentBackground = normalizeHex(style.contentBackground, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.contentBackground);
  const accent = normalizeHex(style.accentColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.accentColor);
  const title = normalizeHex(style.titleColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.titleColor);
  const bodyText = normalizeHex(style.bodyTextColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.bodyTextColor);
  const muted = normalizeHex(style.mutedTextColor, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.mutedTextColor);
  const codeBackground = normalizeHex(style.codeBackground, DEFAULT_ALLIANCE_SENSE_ARTICLE_STYLE.codeBackground);

  return {
    '--sense-theme-primary': accent,
    '--sense-theme-secondary': pageEnd,
    '--sense-theme-glow': accent,
    '--sense-theme-rim': panelBorder,
    '--sense-theme-text': title,
    '--sense-theme-page-bg': `linear-gradient(180deg, ${hexToRgba(pageStart, 0.98)} 0%, ${hexToRgba(panelBackground, 0.94)} 34%, ${hexToRgba(pageEnd, 0.4)} 100%)`,
    '--sense-theme-surface': `linear-gradient(180deg, ${hexToRgba(panelBackground, 0.72)} 0%, ${hexToRgba(pageStart, 0.9)} 100%)`,
    '--sense-theme-surface-strong': `linear-gradient(180deg, ${hexToRgba(panelBackground, 0.9)} 0%, ${hexToRgba(pageStart, 0.97)} 100%)`,
    '--sense-theme-main-bg': `linear-gradient(180deg, ${hexToRgba(contentBackground, 0.985)} 0%, ${hexToRgba(contentBackground, 0.94)} 100%)`,
    '--sense-theme-main-border': hexToRgba(panelBorder, 0.32),
    '--sense-theme-border': hexToRgba(panelBorder, 0.24),
    '--sense-theme-border-strong': hexToRgba(accent, 0.42),
    '--sense-theme-border-soft': hexToRgba(panelBorder, 0.18),
    '--sense-theme-shadow': hexToRgba(pageStart, 0.28),
    '--sense-theme-shadow-strong': hexToRgba(pageStart, 0.42),
    '--sense-theme-soft': hexToRgba(accent, 0.12),
    '--sense-theme-soft-strong': hexToRgba(accent, 0.22),
    '--sense-theme-soft-glow': hexToRgba(accent, 0.2),
    '--sense-theme-soft-rim': hexToRgba(panelBorder, 0.2),
    '--sense-theme-interactive-bg': hexToRgba(panelBackground, 0.3),
    '--sense-theme-interactive-hover': hexToRgba(accent, 0.22),
    '--sense-theme-focus-ring': hexToRgba(accent, 0.16),
    '--sense-theme-kicker': accent,
    '--sense-theme-title': title,
    '--sense-theme-muted': hexToRgba(muted, 0.92),
    '--sense-theme-main-text': bodyText,
    '--sense-theme-inline-bg': hexToRgba(accent, 0.12),
    '--sense-theme-inline-text': bodyText,
    '--sense-theme-invalid-bg': 'rgba(254, 202, 202, 0.45)',
    '--sense-theme-invalid-text': '#b91c1c',
    '--sense-theme-code-bg': codeBackground,
    '--sense-theme-selection-bg': `linear-gradient(180deg, ${hexToRgba(panelBackground, 0.86)} 0%, ${hexToRgba(pageStart, 0.98)} 100%)`
  };
};
