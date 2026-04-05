const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const trimApiSuffix = (value = '') => String(value || '').replace(/\/api\/?$/i, '');

const parseEnvFile = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) return acc;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key) {
        acc[key] = value;
      }
      return acc;
    }, {});
  } catch (_error) {
    return {};
  }
};

const resolveBackendProxyTarget = () => {
  const explicitOrigin = trimTrailingSlash(
    process.env.BACKEND_PROXY_TARGET
      || process.env.REACT_APP_BACKEND_ORIGIN
      || process.env.BACKEND_PUBLIC_ORIGIN
      || trimApiSuffix(process.env.REACT_APP_API_URL || '')
  );
  if (explicitOrigin) {
    return explicitOrigin;
  }

  const backendEnv = parseEnvFile(path.resolve(__dirname, '../../backend/.env'));
  const backendProductionEnv = parseEnvFile(path.resolve(__dirname, '../../backend/.env.production'));
  const mergedEnv = {
    ...backendProductionEnv,
    ...backendEnv
  };

  if (mergedEnv.PUBLIC_ORIGIN) {
    return trimTrailingSlash(mergedEnv.PUBLIC_ORIGIN);
  }

  const configuredPort = String(
    process.env.BACKEND_PORT
      || process.env.BACKEND_DEFAULT_PORT
      || mergedEnv.PORT
      || ''
  ).trim();
  if (!configuredPort) {
    return '';
  }

  const configuredHost = String(mergedEnv.BIND_HOST || '').trim();
  const safeHost = !configuredHost || configuredHost === '0.0.0.0' || configuredHost === '::'
    ? '127.0.0.1'
    : configuredHost;
  return `http://${safeHost}:${configuredPort}`;
};

module.exports = function setupProxy(app) {
  const target = resolveBackendProxyTarget();
  if (!target) {
    console.warn('[setupProxy] skipped: backend proxy target is empty');
    return;
  }

  const options = {
    target,
    changeOrigin: true,
    ws: true,
    logLevel: 'warn'
  };

  app.use('/api', createProxyMiddleware(options));
  app.use('/socket.io', createProxyMiddleware(options));
  app.use('/uploads', createProxyMiddleware(options));

  console.log(`[setupProxy] proxying dev requests to ${target}`);
};
