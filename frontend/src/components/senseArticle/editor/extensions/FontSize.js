import { Extension } from '@tiptap/core';

const FONT_SIZE_PRESETS = [
  { value: '12px', label: '小五 12' },
  { value: '14px', label: '五号 14' },
  { value: '15px', label: '小四 15' },
  { value: '16px', label: '四号 16' },
  { value: '18px', label: '小三 18' },
  { value: '21px', label: '三号 21' },
  { value: '24px', label: '小二 24' },
  { value: '29px', label: '二号 29' },
  { value: '36px', label: '小一 36' },
  { value: '42px', label: '一号 42' },
  { value: '54px', label: '小初 54' },
  { value: '64px', label: '初号 64' }
];
const FONT_SIZES = FONT_SIZE_PRESETS.map((item) => item.value);

const normalizeFontSize = (value) => {
  const rawValue = String(value || '').trim().toLowerCase();
  if (!rawValue) return null;

  const presetMatch = FONT_SIZE_PRESETS.find((item) => item.value === rawValue || item.label.toLowerCase() === rawValue);
  if (presetMatch) return presetMatch.value;

  const numericMatch = rawValue.match(/^(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const numericValue = Number.parseFloat(numericMatch[1]);
    if (!Number.isFinite(numericValue)) return null;
    return `${numericValue}px`;
  }

  const pxMatch = rawValue.match(/^(\d+(?:\.\d+)?)px$/);
  if (!pxMatch) return null;
  const numericValue = Number.parseFloat(pxMatch[1]);
  if (!Number.isFinite(numericValue)) return null;
  return `${numericValue}px`;
};

const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle']
    };
  },

  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element) => {
            const styleValue = element.style.fontSize || element.getAttribute('data-font-size') || '';
            return normalizeFontSize(styleValue);
          },
          renderHTML: (attributes) => {
            const normalizedValue = normalizeFontSize(attributes.fontSize);
            if (!normalizedValue) return {};
            return {
              style: `font-size: ${normalizedValue}`,
              'data-font-size': normalizedValue
            };
          }
        }
      }
    }];
  },

  addCommands() {
    return {
      setFontSize: (fontSize) => ({ chain }) => {
        const normalizedValue = normalizeFontSize(fontSize);
        if (!normalizedValue) return false;
        return chain().setMark('textStyle', { fontSize: normalizedValue }).run();
      },
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()
    };
  }
});

export { FONT_SIZES, FONT_SIZE_PRESETS, normalizeFontSize };
export default FontSize;
