const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getNameDisplayWidth,
  limitNameByDisplayWidth,
  MAX_NAME_DISPLAY_WIDTH
} = require('../utils/nameLimits');

test('name limits allow twenty Han characters', () => {
  const value = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉';
  assert.equal(getNameDisplayWidth(value), MAX_NAME_DISPLAY_WIDTH);
  assert.equal(limitNameByDisplayWidth(`${value}戌`), value);
});

test('name limits allow forty single-width characters', () => {
  const value = 'abcdefghijklmnopqrstuvwxyz1234567890abcd';
  assert.equal(value.length, MAX_NAME_DISPLAY_WIDTH);
  assert.equal(limitNameByDisplayWidth(`${value}e`), value);
});

test('name limits do not split surrogate-pair characters', () => {
  const value = '😀'.repeat(40);
  assert.equal(limitNameByDisplayWidth(`${value}x`), value);
});
