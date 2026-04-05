const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const trimApiSuffix = (value = '') => String(value || '').replace(/\/api\/?$/i, '');

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const isLocalhostHost = (hostname = '') => LOCALHOST_HOSTS.has(String(hostname || '').trim().toLowerCase());

const isPrivateIpv4Host = (hostname = '') => {
  const safeHostname = String(hostname || '').trim();
  const matched = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(safeHostname);
  if (!matched) return false;
  const octets = matched.slice(1).map((item) => Number.parseInt(item, 10));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second] = octets;
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return false;
};

const isPrivateNetworkHost = (hostname = '') => isLocalhostHost(hostname) || isPrivateIpv4Host(hostname);

const normalizeHostForUrl = (hostname = '') => (
  String(hostname || '').includes(':') ? `[${hostname}]` : String(hostname || '')
);

const readWindowRuntimeConfig = () => {
  if (typeof window === 'undefined') return {};
  const config = window.__NEUROWAR_RUNTIME_CONFIG__;
  return config && typeof config === 'object' ? config : {};
};

const shouldPreferCurrentOriginProxy = (origin = '') => {
  if (process.env.NODE_ENV !== 'production' || typeof window === 'undefined' || !window.location) {
    return false;
  }
  const pageOrigin = trimTrailingSlash(window.location.origin);
  const targetOrigin = trimTrailingSlash(origin);
  if (!pageOrigin || !targetOrigin) return false;
  return pageOrigin !== targetOrigin;
};

const adaptBackendOriginForCurrentWindow = (origin = '') => {
  const trimmedOrigin = trimTrailingSlash(origin);
  if (!trimmedOrigin || typeof window === 'undefined' || !window.location) return trimmedOrigin;

  try {
    const parsed = new URL(trimmedOrigin);
    const pageHostname = String(window.location.hostname || '').trim();
    if (!pageHostname) return trimmedOrigin;
    const backendUsesPrivateHost = isPrivateNetworkHost(parsed.hostname);
    const pageUsesPrivateHost = isPrivateNetworkHost(pageHostname);
    if (!backendUsesPrivateHost) {
      return trimmedOrigin;
    }
    if (!pageUsesPrivateHost) {
      return '';
    }

    const nextOrigin = `${parsed.protocol}//${normalizeHostForUrl(pageHostname)}${parsed.port ? `:${parsed.port}` : ''}`;
    return trimTrailingSlash(nextOrigin);
  } catch (_error) {
    return trimmedOrigin;
  }
};

const resolveConfiguredBackendOrigin = () => {
  const runtimeConfig = readWindowRuntimeConfig();
  const runtimeBackendOrigin = typeof runtimeConfig.backendOrigin === 'string'
    ? runtimeConfig.backendOrigin.trim()
    : '';
  if (runtimeBackendOrigin) {
    const adaptedRuntimeOrigin = adaptBackendOriginForCurrentWindow(runtimeBackendOrigin);
    return shouldPreferCurrentOriginProxy(adaptedRuntimeOrigin || runtimeBackendOrigin) ? '' : adaptedRuntimeOrigin;
  }

  const backendOriginRaw = typeof process.env.REACT_APP_BACKEND_ORIGIN === 'string'
    ? process.env.REACT_APP_BACKEND_ORIGIN.trim()
    : '';
  if (backendOriginRaw) {
    const adaptedBackendOrigin = adaptBackendOriginForCurrentWindow(backendOriginRaw);
    return shouldPreferCurrentOriginProxy(adaptedBackendOrigin || backendOriginRaw) ? '' : adaptedBackendOrigin;
  }

  const apiUrlRaw = typeof process.env.REACT_APP_API_URL === 'string'
    ? process.env.REACT_APP_API_URL.trim()
    : '';
  if (apiUrlRaw) {
    const adaptedApiOrigin = adaptBackendOriginForCurrentWindow(trimApiSuffix(apiUrlRaw));
    return shouldPreferCurrentOriginProxy(adaptedApiOrigin || trimApiSuffix(apiUrlRaw)) ? '' : adaptedApiOrigin;
  }

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
