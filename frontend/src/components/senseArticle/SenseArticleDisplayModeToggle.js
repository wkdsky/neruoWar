import React from 'react';
import { MoonStar, SunMedium } from 'lucide-react';

const SenseArticleDisplayModeToggle = ({ displayMode = 'day', onToggle }) => (
  <button
    type="button"
    className="sense-display-mode-toggle"
    onClick={onToggle}
    aria-label={displayMode === 'night' ? '切换到日间阅读' : '切换到夜间阅读'}
    title={displayMode === 'night' ? '切换到日间阅读' : '切换到夜间阅读'}
  >
    {displayMode === 'night' ? <SunMedium size={18} /> : <MoonStar size={18} />}
  </button>
);

export default SenseArticleDisplayModeToggle;
