const HAN_CHARACTER_RE = /\p{Script=Han}/u;

export const MAX_NAME_DISPLAY_WIDTH = 40;

export const getNameDisplayWidth = (value = '') => Array.from(String(value || '')).reduce(
  (width, character) => width + (HAN_CHARACTER_RE.test(character) ? 2 : 1),
  0
);

export const limitNameByDisplayWidth = (value = '', maxWidth = MAX_NAME_DISPLAY_WIDTH) => {
  const limit = Math.max(1, Math.floor(Number(maxWidth) || MAX_NAME_DISPLAY_WIDTH));
  let width = 0;
  let output = '';
  for (const character of Array.from(String(value || ''))) {
    const nextWidth = width + (HAN_CHARACTER_RE.test(character) ? 2 : 1);
    if (nextWidth > limit) break;
    output += character;
    width = nextWidth;
  }
  return output;
};

export const normalizeLimitedName = (value, fallback = '') => {
  const normalized = limitNameByDisplayWidth(String(value || '').trim());
  return normalized || fallback;
};

