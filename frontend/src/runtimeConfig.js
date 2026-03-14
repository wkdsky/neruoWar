const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const trimApiSuffix = (value = '') => String(value || '').replace(/\/api\/?$/i, '');

const readWindowRuntimeConfig = () => {
  if (typeof window === 'undefined') return {};
  const config = window.__NEUROWAR_RUNTIME_CONFIG__;
  return config && typeof config === 'object' ? config : {};
};

const resolveConfiguredBackendOrigin = () => {
  const runtimeConfig = readWindowRuntimeConfig();
  const runtimeBackendOrigin = typeof runtimeConfig.backendOrigin === 'string'
    ? runtimeConfig.backendOrigin.trim()
    : '';
  if (runtimeBackendOrigin) return trimTrailingSlash(runtimeBackendOrigin);

  const backendOriginRaw = typeof process.env.REACT_APP_BACKEND_ORIGIN === 'string'
    ? process.env.REACT_APP_BACKEND_ORIGIN.trim()
    : '';
  if (backendOriginRaw) return trimTrailingSlash(backendOriginRaw);

  const apiUrlRaw = typeof process.env.REACT_APP_API_URL === 'string'
    ? process.env.REACT_APP_API_URL.trim()
    : '';
  if (apiUrlRaw) return trimTrailingSlash(trimApiSuffix(apiUrlRaw));

  return '';
};

export const BACKEND_ORIGIN = resolveConfiguredBackendOrigin();
export const API_BASE = BACKEND_ORIGIN ? `${BACKEND_ORIGIN}/api` : '/api';
export const SOCKET_ENDPOINT = BACKEND_ORIGIN || (
  typeof window !== 'undefined' && window.location ? window.location.origin : ''
);

const MEDIA_ASSET_PREFIX = '/uploads/';

export const resolveBackendAssetUrl = (url = '') => {
  if (typeof url !== 'string') return url;
  const normalized = url.trim();
  if (!normalized) return normalized;
  if (normalized.startsWith(MEDIA_ASSET_PREFIX)) {
    return `${BACKEND_ORIGIN || ''}${normalized}`;
  }
  return normalized;
};

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  console.info('[runtimeConfig]', {
    frontendOrigin: window.location.origin,
    backendOrigin: BACKEND_ORIGIN || '(same-origin)',
    apiBase: API_BASE,
    webSocketEndpoint: SOCKET_ENDPOINT || '(same-origin)'
  });
}
