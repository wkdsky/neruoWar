const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');

test('User armyTemplates schema retains multiple formations and placements', () => {
  const user = new User({
    username: 'formation-schema-user',
    email: 'formation-schema-user@example.com',
    password: 'unused',
    armyTemplates: [{
      templateId: 'tpl_schema_check',
      name: '阵型持久化测试',
      units: [
        { unitTypeId: 'infantry', count: 2 },
        { unitTypeId: 'archer', count: 1 }
      ],
      formations: [
        {
          formationId: 'fmt_a',
          name: '阵型A',
          placements: [
            { unitTypeId: 'infantry', x: 0, y: 0 },
            { unitTypeId: 'infantry', x: 1, y: 0 },
            { unitTypeId: 'archer', x: 0, y: 1 }
          ]
        },
        {
          formationId: 'fmt_b',
          name: '阵型B',
          placements: [
            { unitTypeId: 'archer', x: 2, y: 2 },
            { unitTypeId: 'infantry', x: 3, y: 2 }
          ]
        }
      ]
    }]
  });

  const template = user.toObject().armyTemplates[0];
  assert.equal(template.formations.length, 2);
  assert.equal(template.formations[0].placements.length, 3);
  assert.deepEqual(template.formations.map((formation) => formation.formationId), ['fmt_a', 'fmt_b']);
});

test('User army state keeps combat armies separate from training armies', () => {
  const user = new User({
    username: 'army-state-schema-user',
    email: 'army-state-schema-user@example.com',
    password: 'unused',
    armyRoster: [{ unitTypeId: 'infantry', count: 300 }],
    combatArmies: [{
      armyId: 'combat_alpha',
      templateId: 'tpl_alpha',
      templateName: '步兵模板',
      name: '第一参战军',
      units: [{ unitTypeId: 'infantry', count: 120 }],
      templateFormations: [{
        formationId: 'fmt_combat',
        name: '横阵',
        placements: [{ unitTypeId: 'infantry', x: 0, y: 0 }]
      }],
      activeFormationId: 'fmt_combat'
    }],
    trainingArmies: [{
      armyId: 'training_red',
      team: 'defender',
      name: '训练红方',
      units: [{ unitTypeId: 'infantry', count: 10000 }],
      x: 120,
      y: -20,
      placed: true
    }]
  });

  const state = user.toObject();
  assert.equal(state.armyRoster[0].count, 300);
  assert.equal(state.combatArmies[0].units[0].count, 120);
  assert.equal(state.combatArmies[0].templateFormations[0].formationId, 'fmt_combat');
  assert.equal(state.trainingArmies[0].team, 'defender');
  assert.equal(state.trainingArmies[0].units[0].count, 10000);
});
