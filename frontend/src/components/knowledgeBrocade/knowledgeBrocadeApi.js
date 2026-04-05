import { API_BASE } from '../../runtimeConfig';
import { AUTH_EXPIRED_EVENT, clearStoredAuthState } from '../../app/appShared';

const AUTH_ERROR_MESSAGES = new Set([
  '未提供认证令牌',
  '无效的令牌',
  '无效的用户身份'
]);

const readAuthHeaders = () => {
  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('未登录或登录已失效');
  }
  return {
    Authorization: `Bearer ${token}`
  };
};

const request = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}/knowledge-brocades${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...readAuthHeaders(),
      ...(options.headers || {})
    },
    ...options
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_error) {
    data = null;
  }

  if (!response.ok) {
    const errorMessage = data?.error || data?.message || '';
    if (
      response.status === 401
      || response.status === 403
      || AUTH_ERROR_MESSAGES.has(String(errorMessage || '').trim())
    ) {
      clearStoredAuthState();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      }
      throw new Error('登录状态已过期，请重新登录');
    }

    throw new Error(data?.error || data?.message || `请求失败（HTTP ${response.status}）`);
  }

  return data;
};

export const listKnowledgeBrocades = () => request('');

export const createKnowledgeBrocade = (payload = {}) => request('', {
  method: 'POST',
  body: JSON.stringify(payload)
});

export const updateKnowledgeBrocade = (brocadeId, payload = {}) => request(`/${encodeURIComponent(brocadeId)}`, {
  method: 'PATCH',
  body: JSON.stringify(payload)
});

export const deleteKnowledgeBrocade = (brocadeId) => request(`/${encodeURIComponent(brocadeId)}`, {
  method: 'DELETE'
});

export const getKnowledgeBrocadeGraph = (brocadeId) => request(`/${encodeURIComponent(brocadeId)}/graph`);

export const createKnowledgeBrocadeNode = (brocadeId, payload = {}) => request(`/${encodeURIComponent(brocadeId)}/nodes`, {
  method: 'POST',
  body: JSON.stringify(payload)
});

export const updateKnowledgeBrocadeNode = (brocadeId, nodeId, payload = {}) => request(`/${encodeURIComponent(brocadeId)}/nodes/${encodeURIComponent(nodeId)}`, {
  method: 'PATCH',
  body: JSON.stringify(payload)
});

export const getKnowledgeBrocadeNode = (brocadeId, nodeId) => request(`/${encodeURIComponent(brocadeId)}/nodes/${encodeURIComponent(nodeId)}`);

export const updateKnowledgeBrocadeNodeContent = (brocadeId, nodeId, payload = {}) => request(`/${encodeURIComponent(brocadeId)}/nodes/${encodeURIComponent(nodeId)}/content`, {
  method: 'PUT',
  body: JSON.stringify(payload)
});

export const deleteKnowledgeBrocadeNode = (brocadeId, nodeId) => request(`/${encodeURIComponent(brocadeId)}/nodes/${encodeURIComponent(nodeId)}`, {
  method: 'DELETE'
});

export const restoreKnowledgeBrocadeNodes = (brocadeId, payload = {}) => request(`/${encodeURIComponent(brocadeId)}/nodes/restore`, {
  method: 'POST',
  body: JSON.stringify(payload)
});
