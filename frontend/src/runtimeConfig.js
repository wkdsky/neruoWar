const FALLBACK_BACKEND_PORT = '5001';

const resolveFallbackBackendOrigin = () => {
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:${FALLBACK_BACKEND_PORT}`;
  }
  return `http://localhost:${FALLBACK_BACKEND_PORT}`;
};

const LEGACY_BACKEND_ORIGIN = resolveFallbackBackendOrigin();

const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

const resolveBackendOrigin = () => {
  const raw = typeof process.env.REACT_APP_BACKEND_ORIGIN === 'string'
    ? process.env.REACT_APP_BACKEND_ORIGIN.trim()
    : '';
  const normalized = trimTrailingSlash(raw);
  return normalized || LEGACY_BACKEND_ORIGIN;
};

export const DEFAULT_BACKEND_ORIGIN = LEGACY_BACKEND_ORIGIN;
export const BACKEND_ORIGIN = resolveBackendOrigin();
export const API_BASE = `${BACKEND_ORIGIN}/api`;
const MEDIA_ASSET_PREFIX = '/uploads/';

export const mapBackendUrl = (url = '') => {
  if (typeof url !== 'string') return url;
  if (!url.startsWith(DEFAULT_BACKEND_ORIGIN)) return url;
  return `${BACKEND_ORIGIN}${url.slice(DEFAULT_BACKEND_ORIGIN.length)}`;
};

export const resolveBackendAssetUrl = (url = '') => {
  if (typeof url !== 'string') return url;
  const normalized = url.trim();
  if (!normalized) return normalized;
  if (normalized.startsWith(MEDIA_ASSET_PREFIX)) {
    return `${BACKEND_ORIGIN}${normalized}`;
  }
  return mapBackendUrl(normalized);
};
