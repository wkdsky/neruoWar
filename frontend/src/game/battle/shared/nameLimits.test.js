import {
  getNameDisplayWidth,
  limitNameByDisplayWidth,
  MAX_NAME_DISPLAY_WIDTH
} from './nameLimits';

describe('battle name limits', () => {
  test('allows twenty Han characters and clips the twenty-first', () => {
    const value = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
    expect(getNameDisplayWidth(value)).toBe(MAX_NAME_DISPLAY_WIDTH);
    expect(limitNameByDisplayWidth(`${value}戌`)).toBe(value);
  });

  test('allows forty single-width characters and clips the next one', () => {
    const value = 'abcdefghijklmnopqrstuvwxyz1234567890abcd';
    expect(value).toHaveLength(MAX_NAME_DISPLAY_WIDTH);
    expect(limitNameByDisplayWidth(`${value}e`)).toBe(value);
  });

  test('counts mixed Han and non-Han text by display width without splitting code points', () => {
    const value = `甲乙${'a'.repeat(36)}`;
    expect(getNameDisplayWidth(value)).toBe(MAX_NAME_DISPLAY_WIDTH);
    expect(limitNameByDisplayWidth(`${value}z`)).toBe(value);
    expect(limitNameByDisplayWidth('甲😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀')).toBe('甲😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀');
  });
});
