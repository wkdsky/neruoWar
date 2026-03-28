import defaultMale1 from '../../../assets/avatars/default_male_1.svg';
import defaultMale2 from '../../../assets/avatars/default_male_2.svg';
import defaultMale3 from '../../../assets/avatars/default_male_3.svg';
import defaultFemale1 from '../../../assets/avatars/default_female_1.svg';
import defaultFemale2 from '../../../assets/avatars/default_female_2.svg';
import defaultFemale3 from '../../../assets/avatars/default_female_3.svg';
import { getSourceModeLabel } from '../senseArticleUi';

export const ANNOTATION_COLORS = ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe'];

const FLOATING_PANEL_WIDTH = 280;
const FLOATING_PANEL_GAP = 16;
const SELECTION_TOOLBAR_ESTIMATED_HEIGHT = 208;
const REFERENCE_PREVIEW_ESTIMATED_HEIGHT = 172;
const MY_EDITS_PANEL_WIDTH = 428;
const MY_EDITS_PANEL_ESTIMATED_HEIGHT = 540;

export const getMyEditBadgeLabel = (revision = {}, activeFullDraftId = '') => {
  const revisionId = String(revision?._id || '').trim();
  if (revisionId && revisionId === String(activeFullDraftId || '').trim()) return '更新释义';
  return getSourceModeLabel(revision?.sourceMode || 'full');
};

export const getMyEditResumeLabel = (revision = {}) => {
  const sourceMode = String(revision?.sourceMode || 'full').trim();
  if (sourceMode === 'section') return '继续小节修订';
  if (sourceMode === 'selection') return '继续选段修订';
  return '继续编辑';
};

const articleAvatarMap = {
  default_male_1: defaultMale1,
  default_male_2: defaultMale2,
  default_male_3: defaultMale3,
  default_female_1: defaultFemale1,
  default_female_2: defaultFemale2,
  default_female_3: defaultFemale3,
  male1: defaultMale1,
  male2: defaultMale2,
  male3: defaultMale3,
  female1: defaultFemale1,
  female2: defaultFemale2,
  female3: defaultFemale3
};

export const resolveArticleAvatarSrc = (avatarKey = '') => {
  const key = typeof avatarKey === 'string' ? avatarKey.trim() : '';
  if (!key) return articleAvatarMap.default_male_1;
  if (articleAvatarMap[key]) return articleAvatarMap[key];
  if (/^https?:\/\//i.test(key) || key.startsWith('/') || key.startsWith('data:image/')) return key;
  return articleAvatarMap.default_male_1;
};

const readShellCssPixelValue = (name, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const scope = document.querySelector('.sense-article-page')
    || document.querySelector('.game-container')
    || document.documentElement;
  const rawValue = window.getComputedStyle(scope).getPropertyValue(name);
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getFloatingViewportInsets = () => ({
  top: readShellCssPixelValue('--knowledge-header-offset', 92) + FLOATING_PANEL_GAP,
  right: readShellCssPixelValue('--app-shell-right-safe-area', 108) + FLOATING_PANEL_GAP,
  bottom: FLOATING_PANEL_GAP,
  left: FLOATING_PANEL_GAP
});

const clampFloatingLeft = (left, width = FLOATING_PANEL_WIDTH) => {
  if (typeof window === 'undefined') return left;
  const insets = getFloatingViewportInsets();
  const minLeft = window.scrollX + insets.left;
  const maxLeft = Math.max(minLeft, window.scrollX + window.innerWidth - insets.right - width);
  return Math.min(Math.max(left, minLeft), maxLeft);
};

const clampFloatingTop = (top, estimatedHeight) => {
  if (typeof window === 'undefined') return top;
  const insets = getFloatingViewportInsets();
  const minTop = window.scrollY + insets.top;
  const maxTop = Math.max(minTop, window.scrollY + window.innerHeight - insets.bottom - estimatedHeight);
  return Math.min(Math.max(top, minTop), maxTop);
};

export const buildMyEditsPanelStyle = (anchorElement) => {
  if (typeof window === 'undefined' || !anchorElement) return null;
  const rect = anchorElement.getBoundingClientRect();
  const viewportPadding = Math.max(16, readShellCssPixelValue('--app-shell-inline-gap', 24));
  const collapsedDockAllowance = 76;
  const maxWidth = Math.max(300, window.innerWidth - (viewportPadding * 2) - collapsedDockAllowance);
  const width = Math.min(MY_EDITS_PANEL_WIDTH, maxWidth);
  const preferredLeft = window.scrollX + rect.right - width;
  const left = Math.min(
    Math.max(window.scrollX + viewportPadding, preferredLeft),
    Math.max(window.scrollX + viewportPadding, window.scrollX + window.innerWidth - collapsedDockAllowance - width)
  );
  const top = clampFloatingTop(window.scrollY + rect.bottom + 8, MY_EDITS_PANEL_ESTIMATED_HEIGHT);
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  };
};

const simpleHash = (value = '') => {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36).slice(0, 16);
};

export const buildSelectionAnchor = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  const root = range.commonAncestorContainer?.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer?.parentElement;
  const blockElement = root?.closest?.('[data-article-block]') || null;
  const headingElement = root?.closest?.('[data-article-heading-block="true"], [data-article-heading]') || null;
  const blockText = String(blockElement?.textContent || '').replace(/\s+/g, ' ').trim();
  const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
  const textIndex = blockText ? blockText.indexOf(normalizedText) : -1;
  const prefixText = textIndex >= 0 ? blockText.slice(Math.max(0, textIndex - 36), textIndex) : '';
  const suffixText = textIndex >= 0 ? blockText.slice(textIndex + normalizedText.length, textIndex + normalizedText.length + 36) : '';
  return {
    selectionText: normalizedText,
    textQuote: normalizedText,
    prefixText,
    suffixText,
    beforeText: prefixText,
    afterText: suffixText,
    blockId: blockElement?.getAttribute('data-article-block') || '',
    blockHash: blockElement?.getAttribute('data-article-block-hash') || '',
    headingId: blockElement?.getAttribute('data-article-heading') || headingElement?.getAttribute('data-article-heading') || headingElement?.id || '',
    selectedTextHash: simpleHash(normalizedText),
    textPositionStart: textIndex >= 0 ? textIndex : null,
    textPositionEnd: textIndex >= 0 ? textIndex + normalizedText.length : null,
    rect: {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height
    }
  };
};

export const buildSelectionToolbarStyle = (selectionAnchor) => {
  if (!selectionAnchor?.selectionText) return null;
  const left = clampFloatingLeft(selectionAnchor.rect.left, FLOATING_PANEL_WIDTH);
  const top = clampFloatingTop(
    selectionAnchor.rect.top - 12,
    SELECTION_TOOLBAR_ESTIMATED_HEIGHT
  ) + SELECTION_TOOLBAR_ESTIMATED_HEIGHT;
  return {
    left: `${left}px`,
    top: `${top}px`
  };
};

export const buildReferencePreviewStyle = (referencePreview) => {
  if (!referencePreview?.rect) return null;
  return {
    left: `${clampFloatingLeft(referencePreview.rect.left, FLOATING_PANEL_WIDTH)}px`,
    top: `${clampFloatingTop(referencePreview.rect.top, REFERENCE_PREVIEW_ESTIMATED_HEIGHT)}px`
  };
};
