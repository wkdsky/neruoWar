const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildUnitCatalog,
  resolveUnitPalette,
  UNIT_KNOWLEDGE_COST_KP
} = require('../seed/unitCatalogFactory');
const { toUnitTypeDtoV2 } = require('../services/unitTypeDtoService');
const { serializeArmyUnitType } = require('../services/armyUnitTypeService');
const {
  matchesExpectedUnitClassifications,
  matchesExpectedUnitCosts,
  matchesExpectedUnitAttackRanges
} = require('../services/unitRegistryService');
const ArmyUnitType = require('../models/ArmyUnitType');

test('unit catalog contains exactly the nine planned unit types', () => {
  const catalog = buildUnitCatalog({});
  const unitTypes = catalog.unitTypes;
  const expectedIds = [
    'u_melee_mobility',
    'u_melee_defense',
    'u_melee_balance',
    'u_ranged_mobility',
    'u_ranged_defense',
    'u_ranged_balance',
    'u_support_combination',
    'u_support_comprehensive',
    'u_support_intervention'
  ];

  assert.equal(unitTypes.length, 9);
  assert.deepEqual(unitTypes.map((unit) => unit.unitTypeId), expectedIds);
  assert.deepEqual(
    unitTypes.map((unit) => `${unit.unitCategory}/${unit.unitSubtype}`),
    [
      'melee/mobility',
      'melee/defense',
      'melee/balance',
      'ranged/mobility',
      'ranged/defense',
      'ranged/balance',
      'support/combination',
      'support/comprehensive',
      'support/intervention'
    ]
  );
  assert.deepEqual(
    unitTypes.map((unit) => unit.visuals.preview.palette.primary),
    [
      '#ef9a9a',
      '#b71c1c',
      '#e53935',
      '#90caf9',
      '#0d47a1',
      '#1e88e5',
      '#a5d6a7',
      '#43a047',
      '#1b5e20'
    ]
  );
  ['melee', 'ranged', 'support'].forEach((category) => {
    const categoryUnits = unitTypes.filter((unit) => unit.unitCategory === category);
    assert.equal(new Set(categoryUnits.map((unit) => unit.visuals.preview.palette.primary)).size, 3);
    categoryUnits.forEach((unit) => {
      assert.deepEqual(unit.visuals.preview.palette, resolveUnitPalette(unit.unitCategory, unit.unitSubtype));
    });
  });
  assert.equal(unitTypes.filter((unit) => Object.hasOwn(unit, 'abilityIds')).length, 0);
  assert.equal(catalog.unitComponents.some((component) => component.kind === 'ability'), false);
  unitTypes.forEach((unit) => {
    assert.ok(unit.attackRange);
    assert.ok(unit.attackRange.max >= unit.attackRange.min);
    if (unit.roleTag === '远程') {
      assert.ok(unit.attackRange.min > 1);
    }
  });

  const componentIds = new Set(catalog.unitComponents.map((component) => component.componentId));
  unitTypes.forEach((unit) => {
    assert.equal(componentIds.has(unit.bodyId), true);
    assert.equal(componentIds.has(unit.weaponIds[0]), true);
    assert.equal(componentIds.has(unit.vehicleId), true);
    assert.equal(componentIds.has(unit.behaviorProfileId), true);
    assert.equal(componentIds.has(unit.stabilityProfileId), true);
  });
});

test('canonical unit ids preserve all nine classifications when stored fields are missing', () => {
  const expected = buildUnitCatalog({}).unitTypes;
  const rawRows = expected.map((unit) => ({
    unitTypeId: unit.unitTypeId,
    professionId: unit.professionId,
    name: unit.name,
    roleTag: unit.roleTag,
    speed: unit.speed,
    hp: unit.hp,
    atk: unit.atk,
    def: unit.def,
    attackRange: unit.attackRange,
    costKP: unit.costKP,
    enabled: true
  }));

  assert.deepEqual(
    rawRows.map((row) => {
      const dto = toUnitTypeDtoV2(row);
      return `${dto.unitCategory}/${dto.unitSubtype}`;
    }),
    expected.map((unit) => `${unit.unitCategory}/${unit.unitSubtype}`)
  );
  assert.deepEqual(
    rawRows.map((row) => {
      const serialized = serializeArmyUnitType(row);
      return `${serialized.unitCategory}/${serialized.unitSubtype}`;
    }),
    expected.map((unit) => `${unit.unitCategory}/${unit.unitSubtype}`)
  );
  assert.deepEqual(
    rawRows.map((row) => serializeArmyUnitType(row).visuals.preview.palette.primary),
    expected.map((unit) => unit.visuals.preview.palette.primary)
  );
});

test('catalog readiness rejects nine ids with missing or mismatched classifications', () => {
  const expected = buildUnitCatalog({}).unitTypes;
  const validRows = expected.map((unit) => ({
    unitTypeId: unit.unitTypeId,
    unitCategory: unit.unitCategory,
    unitSubtype: unit.unitSubtype,
    enabled: true
  }));

  assert.equal(matchesExpectedUnitClassifications(validRows, expected), true);

  const missingSubtypeRows = validRows.map((row, index) => (
    index === 0 ? { ...row, unitSubtype: undefined } : row
  ));
  assert.equal(matchesExpectedUnitClassifications(missingSubtypeRows, expected), false);

  const mismatchedRows = validRows.map((row, index) => (
    index === 1 ? { ...row, unitSubtype: 'balance' } : row
  ));
  assert.equal(matchesExpectedUnitClassifications(mismatchedRows, expected), false);
});

test('catalog readiness rejects correct classifications with an old palette', () => {
  const expected = buildUnitCatalog({}).unitTypes;
  const rows = expected.map((unit) => ({
    unitTypeId: unit.unitTypeId,
    unitCategory: unit.unitCategory,
    unitSubtype: unit.unitSubtype,
    enabled: true,
    visuals: { preview: { palette: { primary: '#5aa3ff', secondary: '#cfd8e3', accent: '#ffd166' } } }
  }));

  assert.equal(require('../services/unitRegistryService').matchesExpectedUnitPalettes(rows, expected), false);
});

test('unit catalog keeps per-soldier knowledge costs affordable and explicit', () => {
  const unitTypes = buildUnitCatalog({}).unitTypes;
  const costsById = Object.fromEntries(unitTypes.map((unit) => [unit.unitTypeId, unit.costKP]));

  assert.deepEqual(costsById, {
    u_melee_mobility: UNIT_KNOWLEDGE_COST_KP.melee_mobility,
    u_melee_defense: UNIT_KNOWLEDGE_COST_KP.melee_defense,
    u_melee_balance: UNIT_KNOWLEDGE_COST_KP.melee_balance,
    u_ranged_mobility: UNIT_KNOWLEDGE_COST_KP.ranged_mobility,
    u_ranged_defense: UNIT_KNOWLEDGE_COST_KP.ranged_defense,
    u_ranged_balance: UNIT_KNOWLEDGE_COST_KP.ranged_balance,
    u_support_combination: UNIT_KNOWLEDGE_COST_KP.support_combination,
    u_support_comprehensive: UNIT_KNOWLEDGE_COST_KP.support_comprehensive,
    u_support_intervention: UNIT_KNOWLEDGE_COST_KP.support_intervention
  });
  unitTypes.forEach((unit) => {
    assert.ok(unit.costKP >= 3 && unit.costKP <= 5);
  });
});

test('catalog readiness rejects stale unit costs', () => {
  const expected = buildUnitCatalog({}).unitTypes;
  const rows = expected.map((unit, index) => ({
    unitTypeId: unit.unitTypeId,
    costKP: index === 0 ? unit.costKP + 1 : unit.costKP
  }));

  assert.equal(matchesExpectedUnitCosts(rows, expected), false);
  assert.equal(matchesExpectedUnitCosts(expected, expected), true);
});

test('catalog readiness rejects stale unit attack ranges', () => {
  const expected = buildUnitCatalog({}).unitTypes;
  const staleRows = expected.map((unit, index) => ({
    unitTypeId: unit.unitTypeId,
    roleTag: unit.roleTag,
    attackRange: index === 3
      ? { min: 1, max: unit.attackRange.max }
      : unit.attackRange
  }));

  assert.equal(matchesExpectedUnitAttackRanges(staleRows, expected), false);
  assert.equal(matchesExpectedUnitAttackRanges(expected, expected), true);
});

test('unit model keeps remote attack ranges outside the inner circle', async () => {
  const unit = new ArmyUnitType({
    unitTypeId: 'test_remote_attack_range',
    name: '测试远程兵种',
    roleTag: '远程',
    unitCategory: 'ranged',
    unitSubtype: 'balance',
    speed: 3,
    hp: 100,
    atk: 10,
    def: 5,
    attackRange: { min: 3, max: 6 },
    costKP: 1
  });

  await unit.validate();
  assert.deepEqual(unit.attackRange.toObject(), { min: 3, max: 6 });
  assert.equal(unit.range, 6);

  unit.attackRange = { min: 1, max: 6 };
  await assert.rejects(unit.validate(), /远程兵种攻击范围下限必须大于 1/);
});
