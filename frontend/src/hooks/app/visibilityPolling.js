export const isDocumentVisible = () => (
  typeof document === 'undefined' || document.visibilityState === 'visible'
);

export const subscribeToVisibleInterval = (callback, intervalMs) => {
  if (typeof document === 'undefined') return () => {};

  let timerId = 0;
  const stop = () => {
    if (timerId) {
      window.clearInterval(timerId);
      timerId = 0;
    }
  };
  const start = () => {
    stop();
    if (!isDocumentVisible()) return;
    timerId = window.setInterval(() => {
      if (isDocumentVisible()) callback();
    }, Math.max(250, Number(intervalMs) || 1000));
  };
  const handleVisibilityChange = () => {
    if (isDocumentVisible()) {
      callback();
      start();
    } else {
      stop();
    }
  };

  start();
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    stop();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};

export const areJsonValuesEqual = (left, right) => {
  if (left === right) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_error) {
    return false;
  }
};
