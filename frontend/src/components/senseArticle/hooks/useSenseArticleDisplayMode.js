import { useEffect, useState } from 'react';

const DISPLAY_MODE_STORAGE_KEY = 'senseArticleDisplayMode';

const resolveInitialDisplayMode = () => {
  if (typeof window === 'undefined') return 'day';
  return window.localStorage.getItem(DISPLAY_MODE_STORAGE_KEY) === 'night' ? 'night' : 'day';
};

const useSenseArticleDisplayMode = () => {
  const [displayMode, setDisplayMode] = useState(resolveInitialDisplayMode);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode);
  }, [displayMode]);

  return {
    displayMode,
    setDisplayMode,
    toggleDisplayMode: () => setDisplayMode((prev) => (prev === 'night' ? 'day' : 'night'))
  };
};

export default useSenseArticleDisplayMode;
