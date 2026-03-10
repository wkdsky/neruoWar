const isBrowser = typeof window !== 'undefined';
const isDevEnvironment = process.env.NODE_ENV !== 'production';

let sequence = 0;

const nextSequence = () => {
  sequence = (sequence + 1) % 1000000;
  return sequence.toString(36);
};

export const isSenseArticleDiagEnabled = () => {
  if (!isBrowser) return isDevEnvironment;
  if (window.__SENSE_ARTICLE_DIAG__ === true) return true;
  if (window.__SENSE_ARTICLE_DIAG__ === false) return false;
  return isDevEnvironment;
};

export const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const durationMs = (startedAt) => Number((nowMs() - startedAt).toFixed(2));

export const newFlowId = (prefix = 'flow') => `${prefix}_${Date.now().toString(36)}_${nextSequence()}`;

export const newRequestId = (prefix = 'req') => `${prefix}_${Date.now().toString(36)}_${nextSequence()}`;

const safeSerialize = (value) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return '';
  }
};

export const safeJsonByteLength = (value) => {
  const text = safeSerialize(value);
  if (!text) return 0;
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
};

export const diagLog = (event, fields = {}, level = 'debug') => {
  if (!isSenseArticleDiagEnabled()) return;
  const logger = typeof console[level] === 'function' ? console[level] : console.debug;
  logger('[sense-article-diag]', {
    ts: new Date().toISOString(),
    event,
    ...fields
  });
};

export const diagWarn = (event, fields = {}) => {
  diagLog(event, fields, 'warn');
};
