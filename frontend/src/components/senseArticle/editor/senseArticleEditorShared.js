import { legacyMarkupToRichHtmlWithDiagnostics } from './legacyMarkupToRichHtml';

export const EMPTY_REVISION = Object.freeze({});
export const EDITABLE_DRAFT_STATUSES = new Set(['draft', 'changes_requested_by_domain_admin', 'changes_requested_by_domain_master']);

export const buildValidationFailureMessage = (validation = null, fallback = '提交失败', errorCode = '') => {
  if (String(errorCode || '').trim() === 'unchanged_revision') return fallback;
  const blocking = Array.isArray(validation?.blocking) ? validation.blocking : [];
  const messages = blocking
    .map((item) => String(item?.message || '').trim())
    .filter(Boolean);
  if (messages.length === 0) return fallback;
  const summary = messages.slice(0, 3).join('；');
  return messages.length > 3 ? `${summary}；另有 ${messages.length - 3} 项问题` : summary;
};

export const resolveRevisionRichHtml = (revisionLike = null) => {
  const editorSource = typeof revisionLike?.editorSource === 'string' ? revisionLike.editorSource : '';
  if (!editorSource.trim()) {
    return {
      html: '<p></p>',
      converted: false,
      parseErrors: 0
    };
  }
  if (String(revisionLike?.contentFormat || '').trim() === 'rich_html') {
    return {
      html: editorSource,
      converted: false,
      parseErrors: Array.isArray(revisionLike?.parseErrors) ? revisionLike.parseErrors.length : 0
    };
  }
  const converted = legacyMarkupToRichHtmlWithDiagnostics(editorSource || '');
  return {
    html: converted.html || '<p></p>',
    converted: true,
    parseErrors: Array.isArray(converted.parseErrors) ? converted.parseErrors.length : 0
  };
};

export const extractMediaSourceUrlsFromHtml = (html = '') => {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const urls = Array.from(doc.body.querySelectorAll('img, audio, video'))
    .map((element) => String(element.getAttribute('src') || '').trim())
    .filter(Boolean);
  return urls.filter((item, index, array) => array.indexOf(item) === index);
};
