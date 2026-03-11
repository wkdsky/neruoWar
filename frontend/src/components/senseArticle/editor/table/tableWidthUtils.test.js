import {
  buildTableWidthPayload,
  clampTableWidthValue,
  formatTableWidthLabel,
  resolveTableWidthValue
} from './tableWidthUtils';

test('table width utils clamp and resolve controlled table width values', () => {
  expect(clampTableWidthValue(12)).toBe(40);
  expect(clampTableWidthValue(140)).toBe(100);
  expect(resolveTableWidthValue({ tableWidthMode: 'wide' })).toBe(88);
  expect(resolveTableWidthValue({ tableWidthMode: 'custom', tableWidthValue: 67 })).toBe(67);
  expect(formatTableWidthLabel({ tableWidthMode: 'auto' })).toBe('自适应');
  expect(formatTableWidthLabel({ tableWidthMode: 'custom', tableWidthValue: 67 })).toBe('67%');
});

test('buildTableWidthPayload normalizes width modes and values', () => {
  expect(buildTableWidthPayload({ tableWidthMode: 'auto', tableWidthValue: 52 })).toEqual({
    tableWidthMode: 'auto',
    tableWidthValue: '100'
  });
  expect(buildTableWidthPayload({ tableWidthMode: 'custom', tableWidthValue: 32 })).toEqual({
    tableWidthMode: 'custom',
    tableWidthValue: '40'
  });
});
