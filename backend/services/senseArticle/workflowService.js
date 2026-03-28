const createSenseArticleWorkflowService = ({
  ACTIVE_SUPERSEDE_STATUSES,
  SenseArticle,
  SenseArticleRevision,
  User,
  applyPublishedSenseTitle,
  assertRevisionValidationBeforeWorkflow,
  buildReviewParticipantsFromNode,
  buildReviewPresentation,
  buildRevisionMutationResponse,
  buildSummary,
  canUserUpdateSenseMetadata,
  createExposeError,
  detectContentFormat,
  ensurePermission,
  ensureReviewParticipantsSnapshot,
  ensureReviewVotesSnapshot,
  ensureRevisionDerivedState,
  getArticleBundle,
  getIdString,
  isPendingReviewStatus,
  notifyDomainMasterDecision,
  notifyReferencedDomains,
  notifyRevisionSubmitted,
  notifySupersededRevisions,
  reasonToMessage,
  resolveProposedSenseTitle,
  resolveReviewerRoleForUser,
  resolveRevisionTitleInput,
  resolveSubmitOperation,
  revisionHasMeaningfulSubmissionChanges,
  selectSupersedeCandidates,
  serializeArticleSummary,
  serializePermissions,
  serializeRevisionDetail,
  syncLegacySenseMirror,
  refreshArticleMediaReferenceState,
  validateRevisionContent
} = {}) => {
  const attemptConditionalRevisionUpdate = async ({ revision, articleId, expectedStatuses = [], setPatch = {} }) => {
    const filter = {
      _id: revision._id,
      articleId,
      __v: revision.__v
    };
    if (expectedStatuses.length > 0) filter.status = { $in: expectedStatuses };
    return SenseArticleRevision.findOneAndUpdate(
      filter,
      {
        $set: setPatch,
        $inc: { __v: 1 }
      },
      { new: true }
    );
  };

  const supersedeSiblingRevisions = async ({ articleId, baseRevisionId, publishedRevisionId }) => {
    const query = {
      articleId,
      _id: { $ne: publishedRevisionId },
      status: { $in: ACTIVE_SUPERSEDE_STATUSES }
    };
    query.baseRevisionId = baseRevisionId || null;
    const revisions = await SenseArticleRevision.find(query).lean();
    const candidates = selectSupersedeCandidates({
      revisions,
      publishedRevisionId,
      baseRevisionId: baseRevisionId || null
    });
    if (candidates.length === 0) return [];
    await SenseArticleRevision.updateMany({ _id: { $in: candidates.map((item) => item._id) }, status: { $in: ACTIVE_SUPERSEDE_STATUSES } }, {
      $set: {
        status: 'superseded',
        reviewStage: 'completed',
        finalDecision: 'superseded',
        finalDecisionAt: new Date(),
        supersededByRevisionId: publishedRevisionId
      }
    });
    return candidates.map((item) => ({ ...item, status: 'superseded', supersededByRevisionId: publishedRevisionId }));
  };

  const buildLegacyReviewFieldPatch = ({ reviewerRole = '', action = '', userId = '', comment = '', markPublished = false }) => {
    const now = new Date();
    const trimmedComment = String(comment || '').trim();
    const patch = {};
    const applyToDomainMasterFields = reviewerRole === 'domain_master' || reviewerRole === 'system_admin';
    if (applyToDomainMasterFields) {
      patch.domainMasterDecision = action === 'approve' ? 'approved' : 'rejected';
      patch.domainMasterReviewerId = userId || null;
      patch.domainMasterReviewedAt = now;
      patch.domainMasterComment = trimmedComment;
    } else {
      patch.domainAdminDecision = action === 'approve' ? 'approved' : 'rejected';
      patch.domainAdminReviewerId = userId || null;
      patch.domainAdminReviewedAt = now;
      patch.domainAdminComment = trimmedComment;
    }
    if (markPublished) {
      patch.domainAdminDecision = 'approved';
      patch.domainMasterDecision = 'approved';
    }
    return patch;
  };

  const submitRevision = async ({ nodeId, senseId, revisionId, userId }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');
    ensurePermission(getIdString(revision.proposerId) === getIdString(userId) || bundle.permissions.isSystemAdmin, '仅发起人可提交当前修订');
    const proposer = await User.findById(revision.proposerId).select('_id username').lean();
    const normalizedRevisionTitle = resolveRevisionTitleInput({
      revisionTitle: revision.revisionTitle,
      fallbackUsername: proposer?.username || ''
    });
    const normalizedProposedSenseTitle = await resolveProposedSenseTitle({
      bundle,
      senseId,
      proposedSenseTitle: revision.proposedSenseTitle,
      allowChange: canUserUpdateSenseMetadata(bundle.permissions)
    });
    if (normalizedRevisionTitle !== revision.revisionTitle || normalizedProposedSenseTitle !== revision.proposedSenseTitle) {
      revision.revisionTitle = normalizedRevisionTitle;
      revision.proposedSenseTitle = normalizedProposedSenseTitle;
      await revision.save();
    }
    revision = await ensureRevisionDerivedState({
      revision,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      persist: true,
      force: true
    });
    if (!revisionHasMeaningfulSubmissionChanges({
      revision,
      currentSenseTitle: bundle?.nodeSense?.title || senseId
    })) {
      throw createExposeError(
        reasonToMessage('unchanged_revision'),
        409,
        'unchanged_revision',
        {
          compare: revision?.diffFromBase || null,
          sourceMode: revision?.sourceMode || 'full',
          targetHeadingId: revision?.targetHeadingId || '',
          selectedRangeAnchor: revision?.selectedRangeAnchor || null
        }
      );
    }
    assertRevisionValidationBeforeWorkflow({
      validationSnapshot: revision.validationSnapshot || validateRevisionContent({ revision, mediaReferences: revision.mediaReferences }),
      phase: 'submit'
    });
    let operation = resolveSubmitOperation(revision);
    if (operation.kind === 'invalid') throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason);
    if (operation.kind === 'noop') {
      return buildRevisionMutationResponse({
        article: bundle.article,
        revision,
        permissions: bundle.permissions,
        userId
      });
    }

    const reviewParticipants = buildReviewParticipantsFromNode(bundle.node);
    const updated = await attemptConditionalRevisionUpdate({
      revision,
      articleId: bundle.article._id,
      expectedStatuses: [revision.status],
      setPatch: {
        ...operation.patch,
        reviewParticipants,
        reviewVotes: [],
        domainAdminDecision: 'pending',
        domainAdminReviewerId: null,
        domainAdminReviewedAt: null,
        domainAdminComment: '',
        domainMasterDecision: 'pending',
        domainMasterReviewerId: null,
        domainMasterReviewedAt: null,
        domainMasterComment: '',
        finalDecision: null,
        finalDecisionAt: null,
        publishedBy: null,
        publishedAt: null,
        updatedAt: new Date()
      }
    });
    if (!updated) {
      revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
      operation = resolveSubmitOperation(revision);
      if (operation.kind === 'noop') {
        return buildRevisionMutationResponse({
          article: bundle.article,
          revision,
          permissions: bundle.permissions,
          userId
        });
      }
      throw createExposeError(reasonToMessage(operation.reason), 409, operation.reason || 'submit_conflict');
    }

    await notifyRevisionSubmitted({ node: bundle.node, article: bundle.article, revision: updated, actorId: userId });
    return buildRevisionMutationResponse({
      article: bundle.article,
      revision: updated,
      permissions: bundle.permissions,
      userId
    });
  };

  const reviewRevision = async ({ nodeId, senseId, revisionId, userId, action, comment = '', requiredRole = '' }) => {
    const bundle = await getArticleBundle({ nodeId, senseId, userId, createIfMissing: true });
    const normalizedAction = String(action || '').trim();
    if (!['approve', 'reject'].includes(normalizedAction)) {
      throw createExposeError(reasonToMessage('invalid_review_action'), 400, 'invalid_review_action');
    }

    let revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
    if (!revision) throw createExposeError('修订不存在', 404, 'revision_not_found');

    const reviewerRole = resolveReviewerRoleForUser({ bundle, revision, userId });
    const reviewParticipants = ensureReviewParticipantsSnapshot({ revision, node: bundle.node });
    const isExplicitParticipant = reviewParticipants.some((item) => item.userId === getIdString(userId));
    const hasCurrentReviewPermission = !!bundle.permissions.isSystemAdmin
      || !!bundle.permissions.canReviewDomainAdmin
      || !!bundle.permissions.canReviewDomainMaster;
    const canReview = !!reviewerRole && (bundle.permissions.isSystemAdmin || (isExplicitParticipant && hasCurrentReviewPermission));
    ensurePermission(canReview, '当前用户不能参与该修订的审阅');
    if (requiredRole === 'domain_master') {
      ensurePermission(reviewerRole === 'domain_master' || reviewerRole === 'system_admin', '当前用户不能执行域主终审');
    }
    if (requiredRole === 'domain_admin') {
      ensurePermission(reviewerRole === 'domain_admin' || reviewerRole === 'domain_master' || reviewerRole === 'system_admin', '当前用户不能执行百科审阅');
    }

    if (revision.status === 'published' && normalizedAction === 'approve') {
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(revision),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }
    if ((revision.status === 'rejected' || revision.status === 'rejected_by_domain_admin' || revision.status === 'rejected_by_domain_master') && normalizedAction === 'reject') {
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(revision),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }
    if (!isPendingReviewStatus(revision.status)) {
      throw createExposeError(reasonToMessage('status_not_reviewable_by_domain_admin'), 409, 'status_not_reviewable_by_domain_admin');
    }

    const baseVotes = ensureReviewVotesSnapshot(revision);
    const nextVotes = [
      ...baseVotes.filter((item) => item.userId !== getIdString(userId)),
      {
        userId: getIdString(userId),
        role: reviewerRole,
        decision: normalizedAction === 'approve' ? 'approved' : 'rejected',
        comment: String(comment || '').trim(),
        reviewedAt: new Date()
      }
    ];

    const projectedPresentation = await buildReviewPresentation({
      revision: { ...revision.toObject(), reviewParticipants, reviewVotes: nextVotes },
      node: bundle.node,
      currentUserId: userId
    });
    const adminStageSummary = projectedPresentation.summary?.byRole?.domain_admin || { total: 0, approvedCount: 0, pendingCount: 0, allApproved: false };
    const masterStageSummary = projectedPresentation.summary?.byRole?.domain_master || { total: 0, approvedCount: 0, pendingCount: 0, allApproved: false };

    if (normalizedAction === 'reject') {
      const updated = await attemptConditionalRevisionUpdate({
        revision,
        articleId: bundle.article._id,
        expectedStatuses: [revision.status],
        setPatch: {
          status: 'rejected',
          reviewStage: 'completed',
          reviewParticipants,
          reviewVotes: nextVotes,
          finalDecision: 'rejected',
          finalDecisionAt: new Date(),
          updatedAt: new Date(),
          ...buildLegacyReviewFieldPatch({ reviewerRole, action: 'reject', userId, comment })
        }
      });
      if (!updated) {
        revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
        if (revision && (revision.status === 'rejected' || revision.status === 'published')) {
          return {
            article: serializeArticleSummary(bundle.article),
            revision: serializeRevisionDetail(revision),
            permissions: serializePermissions(bundle.permissions, userId)
          };
        }
        throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
      }
      await notifyDomainMasterDecision({
        node: bundle.node,
        article: bundle.article,
        revision: updated,
        action: 'rejected',
        actorId: userId
      });
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(updated),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }

    if (reviewerRole === 'domain_admin' || (reviewerRole === 'system_admin' && revision.status !== 'pending_domain_master_review')) {
      if (!adminStageSummary.allApproved) {
        const updated = await attemptConditionalRevisionUpdate({
          revision,
          articleId: bundle.article._id,
          expectedStatuses: [revision.status],
          setPatch: {
            status: 'pending_domain_admin_review',
            reviewStage: 'domain_admin',
            reviewParticipants,
            reviewVotes: nextVotes,
            updatedAt: new Date(),
            ...buildLegacyReviewFieldPatch({ reviewerRole: 'domain_admin', action: 'approve', userId, comment })
          }
        });
        if (!updated) {
          revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
          if (revision && !isPendingReviewStatus(revision.status)) {
            return {
              article: serializeArticleSummary(bundle.article),
              revision: serializeRevisionDetail(revision),
              permissions: serializePermissions(bundle.permissions, userId)
            };
          }
          throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
        }
        return {
          article: serializeArticleSummary(bundle.article),
          revision: serializeRevisionDetail(updated),
          permissions: serializePermissions(bundle.permissions, userId)
        };
      }

      if (masterStageSummary.total > 0) {
        const updated = await attemptConditionalRevisionUpdate({
          revision,
          articleId: bundle.article._id,
          expectedStatuses: [revision.status],
          setPatch: {
            status: 'pending_domain_master_review',
            reviewStage: 'domain_master',
            reviewParticipants,
            reviewVotes: nextVotes,
            updatedAt: new Date(),
            ...buildLegacyReviewFieldPatch({ reviewerRole: 'domain_admin', action: 'approve', userId, comment })
          }
        });
        if (!updated) {
          revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
          if (revision && !isPendingReviewStatus(revision.status)) {
            return {
              article: serializeArticleSummary(bundle.article),
              revision: serializeRevisionDetail(revision),
              permissions: serializePermissions(bundle.permissions, userId)
            };
          }
          throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
        }
        return {
          article: serializeArticleSummary(bundle.article),
          revision: serializeRevisionDetail(updated),
          permissions: serializePermissions(bundle.permissions, userId)
        };
      }
    }

    if (!masterStageSummary.allApproved && masterStageSummary.total > 0) {
      const updated = await attemptConditionalRevisionUpdate({
        revision,
        articleId: bundle.article._id,
        expectedStatuses: [revision.status],
        setPatch: {
          status: 'pending_domain_master_review',
          reviewStage: 'domain_master',
          reviewParticipants,
          reviewVotes: nextVotes,
          updatedAt: new Date(),
          ...buildLegacyReviewFieldPatch({ reviewerRole: reviewerRole === 'system_admin' ? 'domain_master' : reviewerRole, action: 'approve', userId, comment })
        }
      });
      if (!updated) {
        revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
        if (revision && !isPendingReviewStatus(revision.status)) {
          return {
            article: serializeArticleSummary(bundle.article),
            revision: serializeRevisionDetail(revision),
            permissions: serializePermissions(bundle.permissions, userId)
          };
        }
        throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'review_conflict');
      }
      return {
        article: serializeArticleSummary(bundle.article),
        revision: serializeRevisionDetail(updated),
        permissions: serializePermissions(bundle.permissions, userId)
      };
    }

    assertRevisionValidationBeforeWorkflow({
      validationSnapshot: revision.validationSnapshot || validateRevisionContent({ revision, mediaReferences: revision.mediaReferences }),
      phase: 'publish'
    });
    await applyPublishedSenseTitle({ bundle, revision, userId });

    const articleUpdate = await SenseArticle.findOneAndUpdate({
      _id: bundle.article._id,
      currentRevisionId: revision.baseRevisionId || null
    }, {
      $set: {
        currentRevisionId: revision._id,
        contentFormat: revision.contentFormat || detectContentFormat({ editorSource: revision.editorSource }),
        summary: buildSummary(revision.plainTextSnapshot),
        publishedAt: new Date(),
        updatedBy: userId,
        updatedAt: new Date()
      }
    }, { new: true });

    if (!articleUpdate) {
      const freshArticle = await SenseArticle.findById(bundle.article._id).lean();
      if (String(freshArticle?.currentRevisionId || '') !== String(revision.baseRevisionId || '')) {
        await SenseArticleRevision.updateOne({
          _id: revision._id,
          articleId: bundle.article._id,
          status: { $in: ACTIVE_SUPERSEDE_STATUSES }
        }, {
          $set: {
            status: 'superseded',
            reviewStage: 'completed',
            finalDecision: 'superseded',
            finalDecisionAt: new Date(),
            supersededByRevisionId: freshArticle?.currentRevisionId || null
          }
        });
        revision = await SenseArticleRevision.findById(revision._id);
        throw createExposeError(reasonToMessage('publish_base_outdated'), 409, 'publish_base_outdated');
      }
    }

    const updatedRevision = await attemptConditionalRevisionUpdate({
      revision,
      articleId: bundle.article._id,
      expectedStatuses: [revision.status],
      setPatch: {
        status: 'published',
        reviewStage: 'completed',
        reviewParticipants,
        reviewVotes: nextVotes,
        finalDecision: 'published',
        finalDecisionAt: new Date(),
        publishedBy: userId,
        publishedAt: new Date(),
        updatedAt: new Date(),
        ...buildLegacyReviewFieldPatch({ reviewerRole, action: 'approve', userId, comment, markPublished: true })
      }
    });

    if (!updatedRevision) {
      await SenseArticle.updateOne({ _id: bundle.article._id, currentRevisionId: revision._id }, {
        $set: {
          currentRevisionId: revision.baseRevisionId || null,
          updatedAt: new Date()
        }
      });
      revision = await SenseArticleRevision.findOne({ _id: revisionId, articleId: bundle.article._id });
      if (revision && !isPendingReviewStatus(revision.status)) {
        return {
          article: serializeArticleSummary(bundle.article),
          revision: serializeRevisionDetail(revision),
          permissions: serializePermissions(bundle.permissions, userId)
        };
      }
      throw createExposeError('当前修订审核状态已变更，请刷新后重试', 409, 'publish_conflict');
    }

    const supersededRevisions = await supersedeSiblingRevisions({
      articleId: bundle.article._id,
      baseRevisionId: updatedRevision.baseRevisionId || null,
      publishedRevisionId: updatedRevision._id
    });

    await syncLegacySenseMirror({
      nodeId: bundle.nodeId,
      senseId: bundle.senseId,
      nodeSense: bundle.nodeSense,
      editorSource: updatedRevision.editorSource,
      plainTextSnapshot: updatedRevision.plainTextSnapshot,
      actorUserId: userId
    });
    await refreshArticleMediaReferenceState({
      articleId: bundle.article._id,
      nodeId: bundle.nodeId,
      senseId: bundle.senseId
    });
    await notifyDomainMasterDecision({ node: bundle.node, article: bundle.article, revision: updatedRevision, action: 'approved', actorId: userId });
    await notifySupersededRevisions({ node: bundle.node, article: bundle.article, publishedRevision: updatedRevision, supersededRevisions, actorId: userId });
    await notifyReferencedDomains({ node: bundle.node, article: bundle.article, revision: updatedRevision, actorId: userId });

    return {
      article: serializeArticleSummary({ ...bundle.article.toObject?.() || bundle.article, currentRevisionId: updatedRevision._id }),
      revision: serializeRevisionDetail(updatedRevision),
      permissions: serializePermissions(bundle.permissions, userId)
    };
  };

  const reviewByDomainAdmin = async ({ nodeId, senseId, revisionId, userId, action, comment = '' }) => reviewRevision({
    nodeId,
    senseId,
    revisionId,
    userId,
    action,
    comment,
    requiredRole: 'domain_admin'
  });

  const reviewByDomainMaster = async ({ nodeId, senseId, revisionId, userId, action, comment = '' }) => reviewRevision({
    nodeId,
    senseId,
    revisionId,
    userId,
    action,
    comment,
    requiredRole: 'domain_master'
  });

  return {
    reviewByDomainAdmin,
    reviewByDomainMaster,
    submitRevision
  };
};

module.exports = {
  createSenseArticleWorkflowService
};
