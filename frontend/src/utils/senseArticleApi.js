import { API_BASE } from '../runtimeConfig';

const DEFAULT_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUTS = {
  revisionDetail: 15000,
  updateMetadata: 12000,
  updateDraft: 20000,
  submitRevision: 20000
};

const authHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

const isDevEnvironment = process.env.NODE_ENV !== 'production';

const createTimeoutError = (timeoutMs) => {
  const error = new Error(`请求超时（>${Math.round(timeoutMs / 1000)} 秒），请稍后重试`);
  error.name = 'TimeoutError';
  error.status = 408;
  return error;
};

const combineSignals = (externalSignal, internalSignal) => {
  if (!externalSignal) return internalSignal;
  if (externalSignal.aborted) {
    internalSignal.throwIfAborted?.();
    return externalSignal;
  }

  const controller = new AbortController();
  const abort = (event) => controller.abort(event?.target?.reason || externalSignal.reason || internalSignal.reason);
  externalSignal.addEventListener('abort', abort, { once: true });
  internalSignal.addEventListener('abort', () => controller.abort(internalSignal.reason), { once: true });
  return controller.signal;
};

const parseMaybeJsonResponse = async (response) => {
  const cloned = response.clone();
  try {
    const data = await response.json();
    return { data, raw: '' };
  } catch (_error) {
    const raw = await cloned.text();
    if (!raw) return { data: null, raw: '' };
    try {
      return { data: JSON.parse(raw), raw };
    } catch (_parseError) {
      return { data: null, raw };
    }
  }
};

export const parseApiResponse = async (response) => parseMaybeJsonResponse(response);

export const getApiErrorMessage = (parsed, fallback = '请求失败') => (
  parsed?.data?.error || parsed?.data?.message || parsed?.raw || fallback
);

const buildApiError = (response, parsed, fallback = '请求失败') => {
  const error = new Error(getApiErrorMessage(parsed, fallback));
  error.status = Number(response?.status || 0);
  error.payload = parsed?.data || null;
  error.raw = parsed?.raw || '';
  return error;
};

const requestJson = async (path, options = {}, requestOptions = {}) => {
  const timeoutMs = Number(requestOptions.timeoutMs || DEFAULT_TIMEOUT_MS);
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => {
    timeoutController.abort(createTimeoutError(timeoutMs));
  }, timeoutMs);

  const signal = combineSignals(requestOptions.signal, timeoutController.signal);
  const method = String(options.method || 'GET').toUpperCase();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal,
      headers: {
        ...(options.headers || {}),
        ...authHeaders()
      }
    });
    const parsed = await parseMaybeJsonResponse(response);
    if (!response.ok) {
      throw buildApiError(response, parsed, '请求失败');
    }

    if (isDevEnvironment && method === 'PUT' && /\/sense-articles\/.+\/revisions\//.test(path)) {
      const duration = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      console.debug('[sense-article] updateDraft request', {
        path,
        durationMs: Number(duration.toFixed(2))
      });
    }

    return parsed.data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutReason = timeoutController.signal.reason;
      if (timeoutReason instanceof Error) {
        throw timeoutReason;
      }
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const senseArticleApi = {
  getOverview: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}`, {}, requestOptions),
  getCurrent: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/current`, {}, requestOptions),
  getRevisions: (nodeId, senseId, params = {}, requestOptions = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', params.page);
    if (params.pageSize) query.set('pageSize', params.pageSize);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson(`/sense-articles/${nodeId}/${senseId}/revisions${suffix}`, {}, requestOptions);
  },
  getRevisionDetail: (nodeId, senseId, revisionId, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}`,
    {},
    { ...requestOptions, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.revisionDetail }
  ),
  updateMetadata: (nodeId, senseId, payload, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/metadata`,
    { method: 'PUT', body: JSON.stringify(payload || {}) },
    { ...requestOptions, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.updateMetadata }
  ),
  compareRevisions: (nodeId, senseId, fromRevisionId, toRevisionId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/compare?from=${encodeURIComponent(fromRevisionId || '')}&to=${encodeURIComponent(toRevisionId || '')}`, {}, requestOptions),
  createDraft: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/draft`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  createFromSelection: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/from-selection`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  createFromHeading: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/from-heading`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  updateDraft: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}`,
    { method: 'PUT', body: JSON.stringify(payload || {}) },
    { ...requestOptions, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.updateDraft }
  ),
  submitRevision: (nodeId, senseId, revisionId, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/submit`,
    { method: 'POST' },
    { ...requestOptions, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.submitRevision }
  ),
  reviewRevision: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  reviewDomainAdmin: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review/domain-admin`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  reviewDomainMaster: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review/domain-master`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  getMyAnnotations: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/me`, {}, requestOptions),
  createAnnotation: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  updateAnnotation: (nodeId, senseId, annotationId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/${annotationId}`, { method: 'PUT', body: JSON.stringify(payload || {}) }, requestOptions),
  deleteAnnotation: (nodeId, senseId, annotationId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/${annotationId}`, { method: 'DELETE' }, requestOptions),
  searchWithinArticle: (nodeId, senseId, query, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/search?q=${encodeURIComponent(query || '')}`, {}, requestOptions),
  getReferences: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/references`, {}, requestOptions),
  getBacklinks: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/backlinks`, {}, requestOptions),
  getDashboard: (nodeId = '', requestOptions = {}) => requestJson(`/sense-articles/dashboard${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`, {}, requestOptions),
  searchReferenceTargets: (query, requestOptions = {}) => requestJson(`/sense-articles/reference-targets/search?q=${encodeURIComponent(query || '')}`, {}, requestOptions)
};
