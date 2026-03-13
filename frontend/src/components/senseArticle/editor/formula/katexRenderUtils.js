const KATEX_STYLE_ID = 'sense-katex-style';
const KATEX_SCRIPT_ID = 'sense-katex-script';
const KATEX_STYLE_URL = '/vendor/formula/katex.min.css';
const KATEX_BOOTSTRAP_URL = '/vendor/formula/katex-bootstrap.js';

let katexLoadPromise = null;
const renderCache = new Map();

export const normalizeFormulaSource = (value = '') => String(value || '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .trim();

const ensureKatexStyle = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KATEX_STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = KATEX_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = KATEX_STYLE_URL;
  document.head.appendChild(link);
};

const ensureKatexScript = () => {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('document unavailable'));
  }
  if (window.katex?.renderToString) return Promise.resolve(window.katex);
  const existing = document.getElementById(KATEX_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      const handleReady = () => resolve(window.katex);
      const handleError = () => reject(new Error('KaTeX script failed to load.'));
      window.addEventListener('sense-katex-ready', handleReady, { once: true });
      window.addEventListener('sense-katex-error', handleError, { once: true });
      if (window.katex?.renderToString) resolve(window.katex);
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = KATEX_SCRIPT_ID;
    script.src = KATEX_BOOTSTRAP_URL;
    script.async = true;
    const handleReady = () => resolve(window.katex);
    const handleError = () => reject(new Error('KaTeX script failed to load.'));
    window.addEventListener('sense-katex-ready', handleReady, { once: true });
    window.addEventListener('sense-katex-error', handleError, { once: true });
    script.onload = () => {
      if (window.katex?.renderToString) resolve(window.katex);
    };
    script.onerror = () => reject(new Error('KaTeX bootstrap failed to load.'));
    document.head.appendChild(script);
  });
};

export const ensureKatexReady = () => {
  if (typeof window === 'undefined') return Promise.reject(new Error('window unavailable'));
  if (window.katex?.renderToString) return Promise.resolve(window.katex);
  if (katexLoadPromise) return katexLoadPromise;
  ensureKatexStyle();
  katexLoadPromise = ensureKatexScript()
    .catch((error) => {
      katexLoadPromise = null;
      throw error;
    });
  return katexLoadPromise;
};

export const renderLatexWithKatex = (latex = '', {
  displayMode = false
} = {}) => {
  const normalizedSource = normalizeFormulaSource(latex);
  if (!normalizedSource) {
    return {
      html: '',
      error: null
    };
  }
  const cacheKey = `${displayMode ? 'block' : 'inline'}:${normalizedSource}`;
  if (renderCache.has(cacheKey)) return renderCache.get(cacheKey);
  if (!window.katex?.renderToString) {
    return {
      html: '',
      error: '公式引擎尚未加载完成。'
    };
  }
  try {
    const html = window.katex.renderToString(normalizedSource, {
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      displayMode
    });
    const result = {
      html,
      error: null
    };
    renderCache.set(cacheKey, result);
    return result;
  } catch (error) {
    return {
      html: '',
      error: String(error?.message || '公式语法有误，请检查输入。')
    };
  }
};
