import {
  buildSenseArticleNavigationState,
  buildSenseArticleSubViewContext,
  resolveSenseArticleBackTarget,
  resolveSenseArticleNotificationNavigation
} from './senseArticleNavigation';

test('buildSenseArticleNavigationState captures article context and origin', () => {
  const state = buildSenseArticleNavigationState({
    target: { nodeId: 'node-1', senseId: 'sense-1' },
    currentView: 'nodeDetail',
    currentContext: null,
    currentNodeId: 'node-1',
    currentTitleId: 'title-1',
    options: { view: 'senseArticle' }
  });
  expect(state.nodeId).toBe('node-1');
  expect(state.senseId).toBe('sense-1');
  expect(state.originView).toBe('nodeDetail');
});

test('sub view context keeps return target and notification routing stays structured', () => {
  const subView = buildSenseArticleSubViewContext({ nodeId: 'node-1', senseId: 'sense-1' }, 'senseArticle', { revisionId: 'rev-1' });
  expect(subView.returnTarget.view).toBe('senseArticle');
  expect(resolveSenseArticleBackTarget({ context: subView }).kind).toBe('article');

  const notificationNav = resolveSenseArticleNotificationNavigation({
    type: 'sense_article_changes_requested',
    payload: { nodeId: 'node-2', senseId: 'sense-2', revisionId: 'rev-9' }
  });
  expect(notificationNav.options.view).toBe('senseArticleEditor');
  expect(notificationNav.options.revisionId).toBe('rev-9');
});
