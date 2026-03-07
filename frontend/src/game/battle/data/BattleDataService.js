import { API_BASE } from '../../../runtimeConfig';

const buildBattleEndpoint = (path = '') => `${API_BASE}${path}`;

const ENDPOINTS = {
  armyTemplates: () => buildBattleEndpoint('/army/templates'),
  pveBattleInit: ({ nodeId, gateKey }) => buildBattleEndpoint(`/nodes/${encodeURIComponent(nodeId)}/siege/pve/battle-init?gateKey=${encodeURIComponent(gateKey)}`),
  pveBattleResult: ({ nodeId }) => buildBattleEndpoint(`/nodes/${encodeURIComponent(nodeId)}/siege/pve/battle-result`),
  battlefieldLayoutGet: ({ nodeId, gateKey, layoutId = '' }) => {
    const search = new URLSearchParams();
    search.set('gateKey', gateKey || 'cheng');
    if (layoutId) search.set('layoutId', layoutId);
    return buildBattleEndpoint(`/nodes/${encodeURIComponent(nodeId)}/battlefield-layout?${search.toString()}`);
  },
  battlefieldLayoutPut: ({ nodeId }) => buildBattleEndpoint(`/nodes/${encodeURIComponent(nodeId)}/battlefield-layout`)
};

const resolveToken = () => {
  try {
    return localStorage.getItem('token') || '';
  } catch {
    return '';
  }
};

const parseJsonResponse = async (response, endpoint) => {
  const rawText = await response.text();
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(`[BattleDataService] ${endpoint} parse failed (${response.status}): ${error.message}`);
  }
};

const buildReadableError = (endpoint, response, data, fallback = '请求失败') => {
  const base = data?.error || data?.message || fallback;
  return `[BattleDataService] ${endpoint} failed (${response.status}): ${base}`;
};

const requestJson = async (endpoint, { method = 'GET', body, signal, auth = true } = {}) => {
  const token = auth ? resolveToken() : '';
  const headers = {
    Accept: 'application/json'
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(endpoint, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal
  });
  const data = await parseJsonResponse(response, endpoint);
  if (!response.ok) {
    throw new Error(buildReadableError(endpoint, response, data, 'HTTP 请求失败'));
  }
  if (data && typeof data === 'object' && data.success === false) {
    throw new Error(buildReadableError(endpoint, response, data, '业务返回失败'));
  }
  return data?.data !== undefined ? data.data : data;
};

const BattleDataService = {
  ENDPOINTS,
  getArmyTemplates: ({ signal } = {}) => (
    requestJson(ENDPOINTS.armyTemplates(), { method: 'GET', signal, auth: true })
  ),
  getPveBattleInit: ({ nodeId, gateKey, signal } = {}) => (
    requestJson(ENDPOINTS.pveBattleInit({ nodeId, gateKey }), { method: 'GET', signal, auth: true })
  ),
  postPveBattleResult: ({ nodeId, payload, signal } = {}) => (
    requestJson(ENDPOINTS.pveBattleResult({ nodeId }), { method: 'POST', body: payload, signal, auth: true })
  ),
  getBattlefieldLayout: ({ nodeId, gateKey, layoutId = '', signal } = {}) => (
    requestJson(ENDPOINTS.battlefieldLayoutGet({ nodeId, gateKey, layoutId }), { method: 'GET', signal, auth: true })
  ),
  putBattlefieldLayout: ({ nodeId, gateKey, payload, signal } = {}) => {
    const body = payload && typeof payload === 'object'
      ? {
          ...payload,
          gateKey: payload.gateKey || gateKey
        }
      : { gateKey };
    return requestJson(ENDPOINTS.battlefieldLayoutPut({ nodeId }), { method: 'PUT', body, signal, auth: true });
  }
};

export default BattleDataService;
export { ENDPOINTS as BATTLE_DATA_ENDPOINTS };
