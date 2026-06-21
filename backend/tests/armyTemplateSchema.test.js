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
