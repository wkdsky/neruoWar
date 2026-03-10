const isProduction = process.env.NODE_ENV === 'production';

const isSenseArticleDiagEnabled = () => {
  if (process.env.SENSE_ARTICLE_DIAG === 'true') return true;
  if (process.env.SENSE_ARTICLE_DIAG === 'false') return false;
  return !isProduction;
};

const nowMs = () => Date.now();

const durationMs = (startedAt) => Number((Date.now() - startedAt).toFixed(2));

const safeJsonByteLength = (value) => {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return 0;
    return Buffer.byteLength(text, 'utf8');
  } catch (_error) {
    return 0;
  }
};

const diagLog = (event, fields = {}, level = 'debug') => {
  if (!isSenseArticleDiagEnabled()) return;
  const logger = typeof console[level] === 'function' ? console[level] : console.debug;
  logger('[sense-article-diag]', {
    ts: new Date().toISOString(),
    event,
    ...fields
  });
};

const diagWarn = (event, fields = {}) => {
  diagLog(event, fields, 'warn');
};

module.exports = {
  diagLog,
  diagWarn,
  durationMs,
  isSenseArticleDiagEnabled,
  nowMs,
  safeJsonByteLength
};
