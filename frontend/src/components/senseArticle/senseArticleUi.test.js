import {
  findEditableSenseArticleRevision,
  getReferenceTargetStatusLabel,
  getSenseArticleEmptyCtaLabel,
  getSenseArticleEntryActionLabel,
  getRevisionStatusLabel,
  getSenseArticleBackLabel,
  resolveSenseArticleStateFromError
} from './senseArticleUi';

test('revision and reference labels stay unified', () => {
  expect(getRevisionStatusLabel('pending_domain_admin_review')).toBe('待审核');
  expect(getRevisionStatusLabel('published')).toBe('已发布');
  expect(getReferenceTargetStatusLabel('published', true)).toBe('已发布');
  expect(getReferenceTargetStatusLabel('', false)).toBe('引用目标不存在');
});

test('state resolver classifies permission and empty errors', () => {
  expect(resolveSenseArticleStateFromError({ status: 403, message: '无权限' }).kind).toBe('forbidden');
  expect(resolveSenseArticleStateFromError({ status: 404, message: '尚无已发布版本' }).kind).toBe('empty');
  expect(getSenseArticleBackLabel({ returnTarget: { view: 'senseArticleHistory' } })).toBe('返回历史页');
});

test('entry labels and editable draft detection stay aligned', () => {
  expect(getSenseArticleEntryActionLabel({ hasPublishedRevision: true })).toBe('释义百科页');
  expect(getSenseArticleEntryActionLabel({ hasPublishedRevision: false })).toBe('创建百科页');
  expect(getSenseArticleEmptyCtaLabel({ hasEditableDraft: true })).toBe('继续编辑草稿');
  expect(findEditableSenseArticleRevision({
    revisions: [
      { _id: 'rev-1', proposerId: 'user-2', status: 'draft' },
      { _id: 'rev-2', proposerId: 'user-1', status: 'changes_requested_by_domain_admin' }
    ],
    currentUserId: 'user-1',
    isSystemAdmin: false
  })?._id).toBe('rev-2');
});
