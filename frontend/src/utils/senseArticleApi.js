import { API_BASE } from '../runtimeConfig';
import {
  diagLog,
  diagWarn,
  durationMs,
  newRequestId,
  safeJsonByteLength
} from './senseArticleDiagnostics';

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

const authOnlyHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    Authorization: `Bearer ${token}`
  };
};

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

export const getApiErrorMessage = (parsed, fallback = '请求失败') => {
  // 特殊处理 413 Payload Too Large
  if (parsed?.data?.code === 'PAYLOAD_TOO_LARGE') {
    return '本次释义正文过长，保存请求超过服务器允许大小，请联系管理员调整服务端限制';
  }
  return parsed?.data?.error || parsed?.data?.message || parsed?.raw || fallback;
};

const buildApiError = (response, parsed, fallback = '请求失败') => {
  const error = new Error(getApiErrorMessage(parsed, fallback));
  error.status = Number(response?.status || 0);
  error.payload = parsed?.data || null;
  error.raw = parsed?.raw || '';
  return error;
};

const resolveResponseBytes = (response, parsed) => {
  const contentLength = Number(response?.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength >= 0) return contentLength;
  if (parsed?.raw) return safeJsonByteLength(parsed.raw);
  if (parsed?.data !== undefined) return safeJsonByteLength(parsed.data);
  return 0;
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
  const requestId = requestOptions.requestId || newRequestId('api');
  const requestBytes = safeJsonByteLength(options.body || '');
  const meta = {
    requestId,
    flowId: requestOptions.flowId,
    view: requestOptions.view,
    apiName: requestOptions.apiName,
    nodeId: requestOptions.nodeId,
    senseId: requestOptions.senseId,
    revisionId: requestOptions.revisionId
  };

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...(requestOptions.fetchOptions || {}),
      ...options,
      signal,
      headers: {
        ...(options.headers || {}),
        ...((requestOptions.fetchOptions && requestOptions.fetchOptions.headers) || {}),
        ...(requestOptions.flowId ? { 'x-sense-flow-id': requestOptions.flowId } : {}),
        ...(requestId ? { 'x-sense-request-id': requestId } : {}),
        ...authHeaders()
      }
    });
    const parsed = await parseMaybeJsonResponse(response);
    const responseBytes = resolveResponseBytes(response, parsed);
    const tookMs = durationMs(startedAt);
    const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
    if (response.ok && parsed?.data === null && parsed?.raw && contentType.includes('application/json')) {
      diagWarn('sense.api.parse_error', {
        ...meta,
        path,
        method,
        durationMs: tookMs,
        status: response.status,
        requestBytes,
        responseBytes,
        errorName: 'ResponseParseError',
        errorMessage: 'JSON 解析失败'
      });
    }
    if (!response.ok) {
      const apiError = buildApiError(response, parsed, '请求失败');
      apiError.responseBytes = responseBytes;
      throw apiError;
    }
    diagLog('sense.api.request', {
      ...meta,
      path,
      method,
      durationMs: tookMs,
      status: response.status,
      requestBytes,
      responseBytes,
      isTimeout: false,
      isAborted: false
    });

    return parsed.data;
  } catch (error) {
    let finalError = error;
    let isTimeout = error?.name === 'TimeoutError';
    let isAborted = false;
    if (error?.name === 'AbortError') {
      const timeoutReason = timeoutController.signal.reason;
      if (timeoutReason instanceof Error) {
        finalError = timeoutReason;
        isTimeout = timeoutReason.name === 'TimeoutError';
      } else {
        isAborted = true;
      }
    }
    diagWarn('sense.api.request', {
      ...meta,
      path,
      method,
      durationMs: durationMs(startedAt),
      status: Number(finalError?.status || 0),
      requestBytes,
      responseBytes: Number(finalError?.responseBytes || 0),
      isTimeout,
      isAborted,
      errorName: finalError?.name || 'Error',
      errorMessage: finalError?.message || '请求失败',
      ...(finalError?.status === 413 ? { payloadTooLarge: true } : {})
    });
    throw finalError;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const requestMultipart = async (path, formData, requestOptions = {}) => {
  const timeoutMs = Number(requestOptions.timeoutMs || DEFAULT_TIMEOUT_MS);
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => {
    timeoutController.abort(createTimeoutError(timeoutMs));
  }, timeoutMs);

  const signal = combineSignals(requestOptions.signal, timeoutController.signal);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...(requestOptions.fetchOptions || {}),
      method: 'POST',
      body: formData,
      signal,
      headers: {
        ...((requestOptions.fetchOptions && requestOptions.fetchOptions.headers) || {}),
        ...authOnlyHeaders(),
        ...(requestOptions.flowId ? { 'x-sense-flow-id': requestOptions.flowId } : {}),
        ...(requestOptions.requestId ? { 'x-sense-request-id': requestOptions.requestId } : {})
      }
    });
    const parsed = await parseMaybeJsonResponse(response);
    if (!response.ok) throw buildApiError(response, parsed, '请求失败');
    return parsed.data;
  } finally {
    window.clearTimeout(timeoutId);
  }
};

export const senseArticleApi = {
  getOverview: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}`, {}, { ...requestOptions, apiName: requestOptions.apiName || 'getOverview', nodeId, senseId }),
  getCurrent: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/current`, {}, { ...requestOptions, apiName: requestOptions.apiName || 'getCurrent', nodeId, senseId }),
  getRevisions: (nodeId, senseId, params = {}, requestOptions = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', params.page);
    if (params.pageSize) query.set('pageSize', params.pageSize);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson(`/sense-articles/${nodeId}/${senseId}/revisions${suffix}`, {}, { ...requestOptions, apiName: requestOptions.apiName || 'getRevisions', nodeId, senseId });
  },
  getRevisionDetail: (nodeId, senseId, revisionId, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}`,
    {},
    { ...requestOptions, apiName: requestOptions.apiName || 'getRevisionDetail', nodeId, senseId, revisionId, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.revisionDetail }
  ),
  updateMetadata: (nodeId, senseId, payload, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/metadata`,
    { method: 'PUT', body: JSON.stringify(payload || {}) },
    { ...requestOptions, apiName: requestOptions.apiName || 'updateMetadata', nodeId, senseId, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.updateMetadata }
  ),
  compareRevisions: (nodeId, senseId, fromRevisionId, toRevisionId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/compare?from=${encodeURIComponent(fromRevisionId || '')}&to=${encodeURIComponent(toRevisionId || '')}`, {}, { ...requestOptions, apiName: requestOptions.apiName || 'compareRevisions', nodeId, senseId }),
  createDraft: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/draft`, { method: 'POST', body: JSON.stringify(payload || {}) }, { ...requestOptions, apiName: requestOptions.apiName || 'createDraft', nodeId, senseId }),
  createFromSelection: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/from-selection`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  createFromHeading: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/from-heading`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  updateDraft: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}`,
    { method: 'PUT', body: JSON.stringify(payload || {}) },
    { ...requestOptions, apiName: requestOptions.apiName || 'updateDraft', nodeId, senseId, revisionId, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.updateDraft }
  ),
  deleteDraft: (nodeId, senseId, revisionId, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}`,
    { method: 'DELETE' },
    { ...requestOptions, apiName: requestOptions.apiName || 'deleteDraft', nodeId, senseId, revisionId }
  ),
  submitRevision: (nodeId, senseId, revisionId, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/submit`,
    { method: 'POST' },
    { ...requestOptions, apiName: requestOptions.apiName || 'submitRevision', nodeId, senseId, revisionId, timeoutMs: requestOptions.timeoutMs || REQUEST_TIMEOUTS.submitRevision }
  ),
  reviewRevision: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  reviewDomainAdmin: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review/domain-admin`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  reviewDomainMaster: (nodeId, senseId, revisionId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review/domain-master`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  getMyAnnotations: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/me`, {}, requestOptions),
  createAnnotation: (nodeId, senseId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations`, { method: 'POST', body: JSON.stringify(payload || {}) }, requestOptions),
  updateAnnotation: (nodeId, senseId, annotationId, payload, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/${annotationId}`, { method: 'PUT', body: JSON.stringify(payload || {}) }, requestOptions),
  deleteAnnotation: (nodeId, senseId, annotationId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/${annotationId}`, { method: 'DELETE' }, requestOptions),
  searchWithinArticle: (nodeId, senseId, query, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/search?q=${encodeURIComponent(query || '')}`, {}, requestOptions),
  getReferences: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/references`, {}, { ...requestOptions, apiName: requestOptions.apiName || 'getReferences', nodeId, senseId }),
  getBacklinks: (nodeId, senseId, requestOptions = {}) => requestJson(`/sense-articles/${nodeId}/${senseId}/backlinks`, {}, requestOptions),
  getDashboard: (nodeId = '', requestOptions = {}) => requestJson(`/sense-articles/dashboard${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`, {}, requestOptions),
  searchReferenceTargets: (query, requestOptions = {}) => requestJson(`/sense-articles/reference-targets/search?q=${encodeURIComponent(query || '')}`, {}, requestOptions),
  uploadMedia: (nodeId, senseId, payload = {}, requestOptions = {}) => {
    const formData = new FormData();
    if (payload.file) formData.append('file', payload.file);
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (key === 'file' || value === undefined || value === null || value === '') return;
      formData.append(key, value);
    });
    return requestMultipart(`/sense-articles/${nodeId}/${senseId}/media`, formData, requestOptions);
  },
  listMediaAssets: (nodeId, senseId, params = {}, requestOptions = {}) => {
    const query = new URLSearchParams();
    if (params.revisionId) query.set('revisionId', params.revisionId);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson(`/sense-articles/${nodeId}/${senseId}/media${suffix}`, {}, { ...requestOptions, apiName: requestOptions.apiName || 'listMediaAssets', nodeId, senseId, revisionId: params.revisionId || '' });
  },
  touchMediaSession: (nodeId, senseId, payload = {}, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/media/session/touch`,
    { method: 'POST', body: JSON.stringify(payload || {}) },
    { ...requestOptions, apiName: requestOptions.apiName || 'touchMediaSession', nodeId, senseId, revisionId: payload?.revisionId || '' }
  ),
  releaseMediaSession: (nodeId, senseId, payload = {}, requestOptions = {}) => requestJson(
    `/sense-articles/${nodeId}/${senseId}/media/session/release`,
    { method: 'POST', body: JSON.stringify(payload || {}) },
    { ...requestOptions, apiName: requestOptions.apiName || 'releaseMediaSession', nodeId, senseId, revisionId: payload?.revisionId || '' }
  )
};
