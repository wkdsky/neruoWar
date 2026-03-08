const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveUserRoleInfo } = require('../services/senseArticlePermissionService');

test('permission derives domain admin and master review rights correctly', () => {
  const node = {
    domainMaster: 'user_master',
    domainAdmins: ['user_admin']
  };
  const user = { _id: 'user_admin', role: 'user' };
  const adminRole = deriveUserRoleInfo({ user, userId: user._id, node });
  const masterRole = deriveUserRoleInfo({ user: { _id: 'user_master', role: 'user' }, userId: 'user_master', node });
  const normalRole = deriveUserRoleInfo({ user: { _id: 'user_normal', role: 'user' }, userId: 'user_normal', node });

  assert.equal(adminRole.canReviewDomainAdmin, true);
  assert.equal(adminRole.canReviewDomainMaster, false);
  assert.equal(masterRole.canReviewDomainMaster, true);
  assert.equal(normalRole.canReviewDomainAdmin, false);
});
