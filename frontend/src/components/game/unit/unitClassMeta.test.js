import { formatUnitClassLabel, resolveUnitClassMeta } from './unitClassMeta';

describe('unit class metadata', () => {
  it('formats category and subtype in the shared display order', () => {
    expect(formatUnitClassLabel({ unitTypeId: 'u_melee_defense' })).toBe('近战-防御型');
    expect(formatUnitClassLabel({ unitTypeId: 'u_ranged_balance' })).toBe('远程-平衡型');
    expect(formatUnitClassLabel({ unitTypeId: 'u_support_comprehensive' })).toBe('辅助-全面型');
  });

  it('uses the unit preview palette for both label and marker colors', () => {
    const unit = {
      unitTypeId: 'u_melee_defense',
      visuals: { preview: { palette: { primary: '#123456' } } }
    };

    expect(resolveUnitClassMeta(unit)).toMatchObject({
      label: '近战-防御型',
      color: '#123456'
    });
  });
});
