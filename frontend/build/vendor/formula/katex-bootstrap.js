(function loadSenseKatex() {
  if (window.katex && typeof window.katex.renderToString === 'function') {
    window.dispatchEvent(new CustomEvent('sense-katex-ready'));
    return;
  }
  if (document.querySelector('script[data-sense-katex-local="true"]')) return;
  var script = document.createElement('script');
  script.src = '/vendor/formula/katex.min.js';
  script.async = true;
  script.dataset.senseKatexLocal = 'true';
  script.onload = function () {
    window.dispatchEvent(new CustomEvent('sense-katex-ready'));
  };
  script.onerror = function () {
    window.dispatchEvent(new CustomEvent('sense-katex-error'));
  };
  document.head.appendChild(script);
}());
