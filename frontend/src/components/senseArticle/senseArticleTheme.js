import {
  DEFAULT_ALLIANCE_VISUAL_STYLE,
  getActiveAllianceVisualStyle,
  normalizeAllianceVisualStyle
} from '../../utils/allianceVisualStyle';

const DEFAULT_SENSE_ARTICLE_STYLE = normalizeAllianceVisualStyle({
  ...DEFAULT_ALLIANCE_VISUAL_STYLE,
  name: '百科默认风格',
  primaryColor: '#38bdf8',
  secondaryColor: '#0f172a',
  glowColor: '#67e8f9',
  rimColor: '#dbeafe',
  textColor: '#eef8ff',
  patternType: 'noise'
}, '百科默认风格');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const normalizeHex = (value, fallback) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return HEX_COLOR_RE.test(normalized) ? normalized.toLowerCase() : fallback;
};

const hexToRgba = (hex, alpha = 1) => {
  const normalized = normalizeHex(hex, '#38bdf8').replace('#', '');
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
  const fallbackStyle = fallback?.allianceVisualStyle
    ? normalizeAllianceVisualStyle(fallback.allianceVisualStyle, fallback?.allianceName || '主视觉')
    : null;
  const allianceStyle = alliance
    ? getActiveAllianceVisualStyle(alliance)
    : (fallbackStyle || null);

  return {
    domainMasterName: node?.domainMaster?.username || fallback?.domainMasterName || '',
    allianceName: alliance?.name || fallback?.allianceName || '',
    allianceFlag: alliance?.flag || fallback?.allianceFlag || '',
    alliance: alliance || fallback?.alliance || null,
    allianceVisualStyle: allianceStyle || null
  };
};

export const buildSenseArticleThemeStyle = (source = null) => {
  const context = source?.node
    ? buildSenseArticleAllianceContext(source.node, source)
    : buildSenseArticleAllianceContext(null, source || {});
  const style = context.allianceVisualStyle
    ? normalizeAllianceVisualStyle(context.allianceVisualStyle, context.allianceName || '主视觉')
    : DEFAULT_SENSE_ARTICLE_STYLE;

  const primary = normalizeHex(style.primaryColor, DEFAULT_SENSE_ARTICLE_STYLE.primaryColor);
  const secondary = normalizeHex(style.secondaryColor, DEFAULT_SENSE_ARTICLE_STYLE.secondaryColor);
  const glow = normalizeHex(style.glowColor, DEFAULT_SENSE_ARTICLE_STYLE.glowColor);
  const rim = normalizeHex(style.rimColor, DEFAULT_SENSE_ARTICLE_STYLE.rimColor);
  const text = normalizeHex(style.textColor, DEFAULT_SENSE_ARTICLE_STYLE.textColor);

  return {
    '--sense-theme-primary': primary,
    '--sense-theme-secondary': secondary,
    '--sense-theme-glow': glow,
    '--sense-theme-rim': rim,
    '--sense-theme-text': text,
    '--sense-theme-page-bg': `linear-gradient(180deg, rgba(2, 6, 23, 0.98) 0%, ${hexToRgba(secondary, 0.92)} 36%, ${hexToRgba(primary, 0.18)} 100%)`,
    '--sense-theme-surface': `linear-gradient(180deg, ${hexToRgba(secondary, 0.48)} 0%, rgba(15, 23, 42, 0.84) 100%)`,
    '--sense-theme-surface-strong': `linear-gradient(180deg, ${hexToRgba(secondary, 0.68)} 0%, rgba(8, 15, 28, 0.96) 100%)`,
    '--sense-theme-main-bg': `linear-gradient(180deg, rgba(248, 250, 252, 0.985) 0%, ${hexToRgba(rim, 0.26)} 100%)`,
    '--sense-theme-main-border': hexToRgba(rim, 0.28),
    '--sense-theme-border': hexToRgba(rim, 0.22),
    '--sense-theme-border-strong': hexToRgba(primary, 0.38),
    '--sense-theme-border-soft': hexToRgba(rim, 0.14),
    '--sense-theme-shadow': hexToRgba(secondary, 0.28),
    '--sense-theme-shadow-strong': hexToRgba(secondary, 0.42),
    '--sense-theme-soft': hexToRgba(primary, 0.12),
    '--sense-theme-soft-strong': hexToRgba(primary, 0.2),
    '--sense-theme-soft-glow': hexToRgba(glow, 0.18),
    '--sense-theme-soft-rim': hexToRgba(rim, 0.22),
    '--sense-theme-interactive-bg': hexToRgba(secondary, 0.3),
    '--sense-theme-interactive-hover': hexToRgba(primary, 0.22),
    '--sense-theme-focus-ring': hexToRgba(primary, 0.16),
    '--sense-theme-kicker': glow,
    '--sense-theme-title': text,
    '--sense-theme-muted': hexToRgba(rim, 0.88),
    '--sense-theme-main-text': '#0f172a',
    '--sense-theme-inline-bg': hexToRgba(primary, 0.14),
    '--sense-theme-inline-text': secondary,
    '--sense-theme-invalid-bg': 'rgba(254, 202, 202, 0.45)',
    '--sense-theme-invalid-text': '#b91c1c',
    '--sense-theme-code-bg': 'rgba(2, 6, 23, 0.96)',
    '--sense-theme-selection-bg': `linear-gradient(180deg, ${hexToRgba(secondary, 0.82)} 0%, rgba(15, 23, 42, 0.96) 100%)`
  };
};
