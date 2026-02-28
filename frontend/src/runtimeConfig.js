const LEGACY_BACKEND_ORIGIN = 'http://localhost:5000';

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

export const mapBackendUrl = (url = '') => {
  if (typeof url !== 'string') return url;
  if (!url.startsWith(DEFAULT_BACKEND_ORIGIN)) return url;
  return `${BACKEND_ORIGIN}${url.slice(DEFAULT_BACKEND_ORIGIN.length)}`;
};
