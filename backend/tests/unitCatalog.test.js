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
  matchesExpectedUnitCosts
} = require('../services/unitRegistryService');

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
    range: unit.range,
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
