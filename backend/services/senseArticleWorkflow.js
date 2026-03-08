const {
  ACTIVE_SUPERSEDE_STATUSES,
  DRAFT_EDITABLE_STATUSES
} = require('../constants/senseArticle');

const invalid = (reason) => ({ kind: 'invalid', reason });
const noop = (reason) => ({ kind: 'noop', reason });
const apply = (patch, reason = '') => ({ kind: 'apply', patch, reason });

const isSupersedeEligibleStatus = (status = '') => ACTIVE_SUPERSEDE_STATUSES.includes(status);

const selectSupersedeCandidates = ({ revisions = [], publishedRevisionId = '', baseRevisionId = '' }) => (
  (Array.isArray(revisions) ? revisions : []).filter((revision) => {
    if (!revision) return false;
    if (String(revision._id) === String(publishedRevisionId)) return false;
    if (String(revision.baseRevisionId || '') !== String(baseRevisionId || '')) return false;
    return isSupersedeEligibleStatus(revision.status);
  })
);

const resolveSubmitOperation = (revision = {}) => {
  const status = revision?.status || '';
  if (status === 'pending_domain_admin_review') return noop('already_pending_domain_admin_review');
  if (DRAFT_EDITABLE_STATUSES.includes(status)) {
    return apply({
      status: 'pending_domain_admin_review',
      reviewStage: 'domain_admin'
    }, 'submitted_for_domain_admin_review');
  }
  if (status === 'pending_domain_master_review') return invalid('already_approved_by_domain_admin');
  if (status === 'published') return invalid('already_published');
  if (status === 'superseded') return invalid('revision_superseded');
  if (status === 'withdrawn') return invalid('revision_withdrawn');
  if (status === 'rejected_by_domain_admin' || status === 'rejected_by_domain_master') return invalid('revision_rejected');
  return invalid('status_not_submittable');
};

const resolveDomainAdminReviewOperation = (revision = {}, action = '') => {
  const status = revision?.status || '';
  if (status === 'pending_domain_admin_review') {
    if (action === 'approve') {
      return apply({
        domainAdminDecision: 'approved',
        status: 'pending_domain_master_review',
        reviewStage: 'domain_master'
      }, 'domain_admin_approved');
    }
    if (action === 'reject') {
      return apply({
        domainAdminDecision: 'rejected',
        status: 'rejected_by_domain_admin',
        reviewStage: 'completed',
        finalDecision: 'rejected'
      }, 'domain_admin_rejected');
    }
    if (action === 'request_changes') {
      return apply({
        domainAdminDecision: 'changes_requested',
        status: 'changes_requested_by_domain_admin',
        reviewStage: 'domain_admin',
        finalDecision: 'changes_requested'
      }, 'domain_admin_requested_changes');
    }
    return invalid('invalid_review_action');
  }

  if (status === 'pending_domain_master_review' && revision?.domainAdminDecision === 'approved' && action === 'approve') {
    return noop('already_domain_admin_approved');
  }
  if (status === 'rejected_by_domain_admin' && action === 'reject') return noop('already_domain_admin_rejected');
  if (status === 'changes_requested_by_domain_admin' && action === 'request_changes') return noop('already_domain_admin_requested_changes');
  if (status === 'published') return invalid('published_cannot_be_reviewed');
  if (status === 'superseded') return invalid('superseded_cannot_be_reviewed');
  if (status === 'withdrawn') return invalid('withdrawn_cannot_be_reviewed');
  if (status === 'pending_domain_master_review') return invalid('already_exited_domain_admin_stage');
  return invalid('status_not_reviewable_by_domain_admin');
};

const resolveDomainMasterReviewOperation = (revision = {}, action = '') => {
  const status = revision?.status || '';
  if (revision?.domainAdminDecision !== 'approved' && status !== 'published') {
    return invalid('domain_admin_approval_required');
  }

  if (status === 'pending_domain_master_review') {
    if (action === 'approve') {
      return apply({
        domainMasterDecision: 'approved',
        status: 'published',
        reviewStage: 'completed',
        finalDecision: 'published'
      }, 'domain_master_published');
    }
    if (action === 'reject') {
      return apply({
        domainMasterDecision: 'rejected',
        status: 'rejected_by_domain_master',
        reviewStage: 'completed',
        finalDecision: 'rejected'
      }, 'domain_master_rejected');
    }
    if (action === 'request_changes') {
      return apply({
        domainMasterDecision: 'changes_requested',
        status: 'changes_requested_by_domain_master',
        reviewStage: 'domain_master',
        finalDecision: 'changes_requested'
      }, 'domain_master_requested_changes');
    }
    return invalid('invalid_review_action');
  }

  if (status === 'published' && action === 'approve') return noop('already_published');
  if (status === 'rejected_by_domain_master' && action === 'reject') return noop('already_domain_master_rejected');
  if (status === 'changes_requested_by_domain_master' && action === 'request_changes') return noop('already_domain_master_requested_changes');
  if (status === 'superseded') return invalid('superseded_cannot_be_reviewed');
  if (status === 'withdrawn') return invalid('withdrawn_cannot_be_reviewed');
  if (status === 'pending_domain_admin_review') return invalid('domain_admin_approval_required');
  return invalid('status_not_reviewable_by_domain_master');
};

module.exports = {
  isSupersedeEligibleStatus,
  resolveDomainAdminReviewOperation,
  resolveDomainMasterReviewOperation,
  resolveSubmitOperation,
  selectSupersedeCandidates
};
