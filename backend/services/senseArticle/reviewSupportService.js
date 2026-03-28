const createSenseArticleReviewSupportService = ({
  User,
  ensurePermission,
  getIdString,
  getSenseArticleReviewerEntries
} = {}) => {
  const reasonToMessage = (reason = '') => ({
    already_pending_domain_admin_review: '当前修订已提交，无需重复提交',
    already_approved_by_domain_admin: '当前修订已进入域主终审阶段',
    already_published: '当前修订已发布，无需重复操作',
    revision_superseded: '当前修订已被 superseded，不能继续提交',
    revision_withdrawn: '当前修订已撤回，不能继续提交',
    revision_rejected: '当前修订已被驳回，不能继续提交',
    unchanged_revision: '当前修订与基线版本相比没有任何实际变化，不能提交审核',
    status_not_submittable: '当前修订状态不可提交',
    published_cannot_be_reviewed: '已发布修订不能再次审核',
    superseded_cannot_be_reviewed: '已 superseded 修订不能再次审核',
    withdrawn_cannot_be_reviewed: '已撤回修订不能再次审核',
    already_exited_domain_admin_stage: '当前修订已离开域相审核阶段',
    status_not_reviewable_by_domain_admin: '当前修订不在域相可审核状态',
    domain_admin_approval_required: '必须先完成域相通过，域主才能终审',
    status_not_reviewable_by_domain_master: '当前修订不在域主可审核状态',
    invalid_review_action: '无效审核动作',
    publish_base_outdated: '该修订基线已过期，已有其他版本发布，当前修订不能再发布'
  }[reason] || '当前操作不被允许');

  const isPendingReviewStatus = (status = '') => ['pending_review', 'pending_domain_admin_review', 'pending_domain_master_review'].includes(String(status || '').trim());

  const buildReviewParticipantsFromNode = (node = null) => getSenseArticleReviewerEntries(node).map((item) => ({
    userId: item.userId,
    role: item.role
  }));

  const buildLegacyReviewVotes = (revision = {}) => {
    const votes = [];
    const domainAdminReviewerId = getIdString(revision?.domainAdminReviewerId);
    const domainAdminDecision = String(revision?.domainAdminDecision || '').trim();
    if (domainAdminReviewerId && domainAdminDecision && domainAdminDecision !== 'pending') {
      votes.push({
        userId: domainAdminReviewerId,
        role: 'domain_admin',
        decision: domainAdminDecision === 'approved' ? 'approved' : 'rejected',
        comment: revision?.domainAdminComment || '',
        reviewedAt: revision?.domainAdminReviewedAt || null
      });
    }
    const domainMasterReviewerId = getIdString(revision?.domainMasterReviewerId);
    const domainMasterDecision = String(revision?.domainMasterDecision || '').trim();
    if (domainMasterReviewerId && domainMasterDecision && domainMasterDecision !== 'pending') {
      votes.push({
        userId: domainMasterReviewerId,
        role: 'domain_master',
        decision: domainMasterDecision === 'approved' ? 'approved' : 'rejected',
        comment: revision?.domainMasterComment || '',
        reviewedAt: revision?.domainMasterReviewedAt || null
      });
    }
    return votes;
  };

  const ensureReviewParticipantsSnapshot = ({ revision = {}, node = null }) => {
    const existingParticipants = Array.isArray(revision?.reviewParticipants) ? revision.reviewParticipants : [];
    if (existingParticipants.length > 0) {
      return existingParticipants.map((item) => ({
        userId: getIdString(item?.userId),
        role: String(item?.role || 'domain_admin').trim() || 'domain_admin'
      })).filter((item) => !!item.userId);
    }
    const participants = buildReviewParticipantsFromNode(node);
    const seen = new Set(participants.map((item) => item.userId));
    buildLegacyReviewVotes(revision).forEach((vote) => {
      if (!vote.userId || seen.has(vote.userId)) return;
      participants.push({ userId: vote.userId, role: vote.role || 'domain_admin' });
      seen.add(vote.userId);
    });
    return participants;
  };

  const ensureReviewVotesSnapshot = (revision = {}) => {
    const sourceVotes = Array.isArray(revision?.reviewVotes) && revision.reviewVotes.length > 0
      ? revision.reviewVotes
      : buildLegacyReviewVotes(revision);
    const seen = new Set();
    return sourceVotes.map((item) => ({
      userId: getIdString(item?.userId),
      role: String(item?.role || 'domain_admin').trim() || 'domain_admin',
      decision: String(item?.decision || 'pending').trim() || 'pending',
      comment: typeof item?.comment === 'string' ? item.comment.trim() : '',
      reviewedAt: item?.reviewedAt || null
    })).filter((item) => {
      if (!item.userId || seen.has(item.userId)) return false;
      seen.add(item.userId);
      return true;
    });
  };

  const resolveReviewerRoleForUser = ({ bundle, revision, userId }) => {
    const normalizedUserId = getIdString(userId);
    if (!normalizedUserId) return '';
    if (bundle?.permissions?.isSystemAdmin) return 'system_admin';
    const participant = ensureReviewParticipantsSnapshot({ revision, node: bundle?.node }).find((item) => item.userId === normalizedUserId);
    if (participant?.role) return participant.role;
    if (bundle?.permissions?.isDomainMaster) return 'domain_master';
    if (bundle?.permissions?.isDomainAdmin) return 'domain_admin';
    return '';
  };

  const buildReviewPresentation = async ({ revision = {}, node = null, currentUserId = '' }) => {
    const reviewParticipants = ensureReviewParticipantsSnapshot({ revision, node });
    const reviewVotes = ensureReviewVotesSnapshot(revision);
    const relatedUserIds = Array.from(new Set(reviewParticipants.map((item) => item.userId).concat(reviewVotes.map((item) => item.userId)).filter(Boolean)));
    const users = relatedUserIds.length > 0
      ? await User.find({ _id: { $in: relatedUserIds } }).select('_id username avatar profession').lean()
      : [];
    const userMap = new Map(users.map((item) => [getIdString(item._id), item]));
    const voteMap = new Map(reviewVotes.map((item) => [item.userId, item]));
    const participants = reviewParticipants.map((item) => {
      const user = userMap.get(item.userId) || {};
      const vote = voteMap.get(item.userId) || null;
      return {
        userId: item.userId,
        role: item.role || 'domain_admin',
        username: user.username || '',
        avatar: user.avatar || '',
        profession: user.profession || '',
        decision: vote?.decision || 'pending',
        comment: vote?.comment || '',
        reviewedAt: vote?.reviewedAt || null,
        isCurrentUser: item.userId === getIdString(currentUserId)
      };
    });
    const summary = participants.reduce((acc, item) => {
      if (item.decision === 'approved') acc.approvedCount += 1;
      else if (item.decision === 'rejected') acc.rejectedCount += 1;
      else acc.pendingCount += 1;
      return acc;
    }, { total: participants.length, approvedCount: 0, rejectedCount: 0, pendingCount: 0 });
    summary.allApproved = summary.total > 0 && summary.approvedCount === summary.total;
    const byRole = ['domain_admin', 'domain_master', 'system_admin'].reduce((acc, role) => {
      const scopedParticipants = participants.filter((item) => item.role === role);
      const roleSummary = scopedParticipants.reduce((roleAcc, item) => {
        if (item.decision === 'approved') roleAcc.approvedCount += 1;
        else if (item.decision === 'rejected') roleAcc.rejectedCount += 1;
        else roleAcc.pendingCount += 1;
        return roleAcc;
      }, { total: scopedParticipants.length, approvedCount: 0, rejectedCount: 0, pendingCount: 0 });
      roleSummary.allApproved = roleSummary.total > 0 && roleSummary.approvedCount === roleSummary.total;
      acc[role] = roleSummary;
      return acc;
    }, {});
    summary.byRole = byRole;
    return { participants, summary };
  };

  const assertRevisionReadable = ({ revision, permissions, userId }) => {
    const proposerId = getIdString(revision?.proposerId);
    const currentUserId = getIdString(userId);
    const reviewParticipantIds = ensureReviewParticipantsSnapshot({ revision }).map((item) => item.userId);
    if (revision?.status === 'published') return;
    if (permissions.canReviewDomainAdmin || permissions.canReviewDomainMaster) return;
    if (reviewParticipantIds.includes(currentUserId)) return;
    ensurePermission(proposerId === currentUserId, '仅发起人或审核者可查看未发布修订');
  };

  return {
    assertRevisionReadable,
    buildReviewParticipantsFromNode,
    buildReviewPresentation,
    ensureReviewParticipantsSnapshot,
    ensureReviewVotesSnapshot,
    isPendingReviewStatus,
    reasonToMessage,
    resolveReviewerRoleForUser
  };
};

module.exports = {
  createSenseArticleReviewSupportService
};
