import { API_BASE } from '../runtimeConfig';

export const parseApiResponse = async (response) => {
  const text = await response.text();
  if (!text) return { data: null, raw: null };
  try {
    return { data: JSON.parse(text), raw: text };
  } catch (error) {
    return { data: null, raw: text };
  }
};

export const getApiErrorMessage = (parsed, fallback = '请求失败') => {
  return parsed?.data?.error || parsed?.raw || fallback;
};

const authHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

const buildApiError = (response, parsed, fallback = '请求失败') => {
  const error = new Error(getApiErrorMessage(parsed, fallback));
  error.status = Number(response?.status || 0);
  error.payload = parsed?.data || null;
  error.raw = parsed?.raw || '';
  return error;
};

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...authHeaders()
    }
  });
  const parsed = await parseApiResponse(response);
  if (!response.ok) {
    throw buildApiError(response, parsed, '请求失败');
  }
  return parsed.data;
};

export const senseArticleApi = {
  getOverview: (nodeId, senseId) => requestJson(`/sense-articles/${nodeId}/${senseId}`),
  getCurrent: (nodeId, senseId) => requestJson(`/sense-articles/${nodeId}/${senseId}/current`),
  getRevisions: (nodeId, senseId, params = {}) => {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.page) query.set('page', params.page);
    if (params.pageSize) query.set('pageSize', params.pageSize);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson(`/sense-articles/${nodeId}/${senseId}/revisions${suffix}`);
  },
  getRevisionDetail: (nodeId, senseId, revisionId) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}`),
  compareRevisions: (nodeId, senseId, fromRevisionId, toRevisionId) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/compare?from=${encodeURIComponent(fromRevisionId || '')}&to=${encodeURIComponent(toRevisionId || '')}`),
  createDraft: (nodeId, senseId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/draft`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  createFromSelection: (nodeId, senseId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/from-selection`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  createFromHeading: (nodeId, senseId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/from-heading`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  updateDraft: (nodeId, senseId, revisionId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}`, { method: 'PUT', body: JSON.stringify(payload || {}) }),
  submitRevision: (nodeId, senseId, revisionId) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/submit`, { method: 'POST' }),
  reviewDomainAdmin: (nodeId, senseId, revisionId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review/domain-admin`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  reviewDomainMaster: (nodeId, senseId, revisionId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/revisions/${revisionId}/review/domain-master`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  getMyAnnotations: (nodeId, senseId) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/me`),
  createAnnotation: (nodeId, senseId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations`, { method: 'POST', body: JSON.stringify(payload || {}) }),
  updateAnnotation: (nodeId, senseId, annotationId, payload) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/${annotationId}`, { method: 'PUT', body: JSON.stringify(payload || {}) }),
  deleteAnnotation: (nodeId, senseId, annotationId) => requestJson(`/sense-articles/${nodeId}/${senseId}/annotations/${annotationId}`, { method: 'DELETE' }),
  searchWithinArticle: (nodeId, senseId, query) => requestJson(`/sense-articles/${nodeId}/${senseId}/search?q=${encodeURIComponent(query || '')}`),
  getReferences: (nodeId, senseId) => requestJson(`/sense-articles/${nodeId}/${senseId}/references`),
  getBacklinks: (nodeId, senseId) => requestJson(`/sense-articles/${nodeId}/${senseId}/backlinks`),
  getDashboard: (nodeId = '') => requestJson(`/sense-articles/dashboard${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`),
  searchReferenceTargets: (query) => requestJson(`/sense-articles/reference-targets/search?q=${encodeURIComponent(query || '')}`)
};
