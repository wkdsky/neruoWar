const FALLBACK_BACKEND_PORT = '5001';
const CANONICAL_LOCAL_BACKEND_HOST = '127.0.0.1';

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const inferBackendPortFromFrontendPort = (frontendPort = '') => {
  const normalizedPort = String(frontendPort || '').trim();
  const numericPort = Number(normalizedPort);
  if (!Number.isFinite(numericPort) || numericPort <= 0) return FALLBACK_BACKEND_PORT;
  if (numericPort >= 3000 && numericPort < 4000) {
    return String(numericPort + 2000);
  }
  if (numericPort >= 5000 && numericPort < 6000) {
    return String(numericPort);
  }
  return FALLBACK_BACKEND_PORT;
};

const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

const trimApiSuffix = (value = '') => value.replace(/\/api\/?$/i, '');

const extractOriginParts = (origin = '') => {
  try {
    const parsed = new URL(origin);
    return {
      protocol: parsed.protocol || 'http:',
      hostname: parsed.hostname || 'localhost',
      port: parsed.port || ''
    };
  } catch (_error) {
    return null;
  }
};

const isLocalhostHost = (hostname = '') => LOCALHOST_HOSTS.has(String(hostname || '').trim().toLowerCase());

const formatOrigin = ({ protocol = 'http:', hostname = 'localhost', port = '' } = {}) => {
  const safeHostname = String(hostname || '').includes(':') ? `[${hostname}]` : hostname;
  return `${protocol}//${safeHostname}${port ? `:${port}` : ''}`;
};

const resolveConfiguredBackendOrigin = () => {
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

const resolveFallbackBackendOrigin = () => {
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const browserHostname = window.location.hostname || 'localhost';
    const hostname = isLocalhostHost(browserHostname) ? CANONICAL_LOCAL_BACKEND_HOST : browserHostname;
    const inferredPort = inferBackendPortFromFrontendPort(window.location.port || '');
    return formatOrigin({ protocol, hostname, port: inferredPort });
  }
  return formatOrigin({ protocol: 'http:', hostname: CANONICAL_LOCAL_BACKEND_HOST, port: FALLBACK_BACKEND_PORT });
};

const LEGACY_BACKEND_ORIGIN = resolveFallbackBackendOrigin();

const resolveBackendOrigin = () => {
  const normalized = resolveConfiguredBackendOrigin();
  if (normalized && typeof window !== 'undefined' && window.location) {
    const parsed = extractOriginParts(normalized);
    const browserProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const browserHostname = window.location.hostname || 'localhost';
    const browserPort = window.location.port || '';
    if (parsed && isLocalhostHost(parsed.hostname) && !isLocalhostHost(browserHostname)) {
      const resolvedPort = parsed.port || inferBackendPortFromFrontendPort(browserPort);
      return formatOrigin({ protocol: browserProtocol, hostname: browserHostname, port: resolvedPort });
    }
    if (parsed && isLocalhostHost(parsed.hostname) && isLocalhostHost(browserHostname)) {
      const resolvedPort = parsed.port || inferBackendPortFromFrontendPort(browserPort);
      return formatOrigin({ protocol: browserProtocol, hostname: CANONICAL_LOCAL_BACKEND_HOST, port: resolvedPort });
    }
  }
  return normalized || LEGACY_BACKEND_ORIGIN;
};

export const DEFAULT_BACKEND_ORIGIN = LEGACY_BACKEND_ORIGIN;
export const BACKEND_ORIGIN = resolveBackendOrigin();
export const API_BASE = `${BACKEND_ORIGIN}/api`;
const MEDIA_ASSET_PREFIX = '/uploads/';

const buildBackendOriginAliases = (origin = '') => {
  const parsed = extractOriginParts(origin);
  if (!parsed) return [];
  if (!isLocalhostHost(parsed.hostname)) return [origin];
  return Array.from(new Set(
    ['localhost', '127.0.0.1', '::1'].map((hostname) => formatOrigin({
      protocol: parsed.protocol,
      hostname,
      port: parsed.port
    }))
  ));
};

const BACKEND_ORIGIN_ALIASES = buildBackendOriginAliases(BACKEND_ORIGIN);
const DEFAULT_BACKEND_ORIGIN_ALIASES = buildBackendOriginAliases(DEFAULT_BACKEND_ORIGIN);
const ALL_BACKEND_ORIGIN_ALIASES = Array.from(new Set([
  ...BACKEND_ORIGIN_ALIASES,
  ...DEFAULT_BACKEND_ORIGIN_ALIASES
]));

export const mapBackendUrl = (url = '') => {
  if (typeof url !== 'string') return url;
  const matchedOrigin = ALL_BACKEND_ORIGIN_ALIASES.find((origin) => url.startsWith(origin));
  if (!matchedOrigin) return url;
  return `${BACKEND_ORIGIN}${url.slice(matchedOrigin.length)}`;
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
