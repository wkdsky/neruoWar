const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveSubmitOperation,
  resolveDomainAdminReviewOperation,
  resolveDomainMasterReviewOperation,
  selectSupersedeCandidates
} = require('../services/senseArticleWorkflow');

test('submit is idempotent for pending review revisions', () => {
  const first = resolveSubmitOperation({ status: 'draft' });
  const second = resolveSubmitOperation({ status: 'pending_domain_admin_review' });
  assert.equal(first.kind, 'apply');
  assert.equal(first.patch.status, 'pending_domain_admin_review');
  assert.equal(second.kind, 'noop');
  assert.equal(second.reason, 'already_pending_domain_admin_review');
});

test('domain admin review rejects illegal states and repeated actions', () => {
  const approved = resolveDomainAdminReviewOperation({ status: 'pending_domain_admin_review' }, 'approve');
  const repeated = resolveDomainAdminReviewOperation({ status: 'pending_domain_master_review', domainAdminDecision: 'approved' }, 'approve');
  const invalid = resolveDomainAdminReviewOperation({ status: 'superseded' }, 'approve');
  assert.equal(approved.kind, 'apply');
  assert.equal(approved.patch.status, 'pending_domain_master_review');
  assert.equal(repeated.kind, 'noop');
  assert.equal(invalid.kind, 'invalid');
  assert.equal(invalid.reason, 'superseded_cannot_be_reviewed');
});

test('domain master cannot review before domain admin approval', () => {
  const result = resolveDomainMasterReviewOperation({ status: 'pending_domain_admin_review', domainAdminDecision: 'pending' }, 'approve');
  assert.equal(result.kind, 'invalid');
  assert.equal(result.reason, 'domain_admin_approval_required');
});

test('domain master approve is idempotent once published', () => {
  const published = resolveDomainMasterReviewOperation({ status: 'pending_domain_master_review', domainAdminDecision: 'approved' }, 'approve');
  const repeated = resolveDomainMasterReviewOperation({ status: 'published', domainAdminDecision: 'approved' }, 'approve');
  assert.equal(published.kind, 'apply');
  assert.equal(published.patch.status, 'published');
  assert.equal(repeated.kind, 'noop');
  assert.equal(repeated.reason, 'already_published');
});

test('supersede selection only targets active same-base sibling revisions', () => {
  const candidates = selectSupersedeCandidates({
    publishedRevisionId: 'rev_published',
    baseRevisionId: 'base_1',
    revisions: [
      { _id: 'rev_published', baseRevisionId: 'base_1', status: 'published' },
      { _id: 'rev_pending_a', baseRevisionId: 'base_1', status: 'pending_domain_admin_review' },
      { _id: 'rev_pending_b', baseRevisionId: 'base_1', status: 'pending_domain_master_review' },
      { _id: 'rev_rejected', baseRevisionId: 'base_1', status: 'rejected_by_domain_admin' },
      { _id: 'rev_other_base', baseRevisionId: 'base_2', status: 'pending_domain_admin_review' }
    ]
  });

  assert.deepEqual(candidates.map((item) => item._id), ['rev_pending_a', 'rev_pending_b']);
});
