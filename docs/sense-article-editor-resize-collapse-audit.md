# 1. 结论摘要

- 百科编辑页没有使用 React Router；真正入口是 `frontend/src/App.js` 中按 `view` 状态切换的分支，`view === "senseArticleEditor"` 时挂载 `SenseArticleEditor`（`frontend/src/App.js:6579-6598`）。
- 编辑页组件本体是 `frontend/src/components/senseArticle/SenseArticleEditor.js`，它直接持有正文编辑、预览刷新、草稿保存、提交审核、局部修订、拖拽宽度、预览收起等状态。
- 当前左右布局的实际实现已经不是“纯两栏固定布局”，而是一个三列 `grid`：`编辑区 | divider | 预览区`。关键样式在 `frontend/src/components/senseArticle/SenseArticle.css:160-165`。
- 当前仓库里已经残留了一套“右侧预览拖拽 + 收起/展开”实现，不是空白待做状态。核心残留在 `frontend/src/components/senseArticle/SenseArticleEditor.js:119-123, 266-305, 673-692, 839-921` 与 `frontend/src/components/senseArticle/SenseArticle.css:803-916`。
- 这套现存实现最大的问题不是“不能工作”，而是实现层次不对：拖拽/收起状态和编辑器核心状态混在同一个超大组件里，事件监听直接绑 `window`，没有持久化，没有恢复上次展开宽度，也没有把交互和视觉抽离成稳定的布局层。
- 如果后续要做成工程上可落地、可维护的版本，最推荐路线不是继续在当前残留逻辑上打补丁，而是保留编辑/预览业务链路，重构“中间分栏控制层”：把 split/collapse 状态与 pointer 事件抽到小 hook 或局部布局状态层，只让 `SenseArticleEditor` 消费一个稳定的 pane 宽度和 collapsed 状态。
- 一定会改的文件基本是 `frontend/src/components/senseArticle/SenseArticleEditor.js` 和 `frontend/src/components/senseArticle/SenseArticle.css`；强相关但大概率只需小改的是 `frontend/src/components/senseArticle/SenseArticlePageHeader.js`、`frontend/src/components/senseArticle/senseArticleTheme.js`。
- 不建议改 `frontend/src/utils/senseArticleApi.js`、`frontend/src/utils/senseArticleSyntax.js`、`frontend/src/components/senseArticle/SenseArticleRenderer.js` 的业务接口；这些文件更多是预览数据和渲染契约，不是布局源头。
- 右侧预览收起后，现有预览解析逻辑并不会停止；`previewSource` 和 `previewRevision` 仍然照常计算，只是 UI 用 `.collapsed` 和 `aria-hidden` 做隐藏（`frontend/src/components/senseArticle/SenseArticleEditor.js:906-920`）。
- 当前最不适合继续直接扩展的点是 `handlePreviewResizeStart` + `isResizingPreview` + `window.addEventListener('pointermove')` 这一整套散落在组件内的实现；它缺少持久化、缺少 pointer capture 语义，也没有和响应式断点形成明确状态边界。
- 现有仓库中没有发现预览宽度/收起状态的 `localStorage` key；也就是说，上一次尝试至少没有把“恢复上次宽度”做完。
- `SenseArticlePage` 阅读页仍然是进入编辑页的主入口之一，包含“更新释义 / 编辑本节 / 选段修订”等动作；因此后续改造不能破坏从阅读页进入编辑页的链路（`frontend/src/components/senseArticle/SenseArticlePage.js:577-709`）。

# 2. 相关文件总表

| 文件路径 | 角色 | 与本次改造的关系 | 后续是否大概率要修改 | 备注 |
| --- | --- | --- | --- | --- |
| `frontend/src/App.js` | 入口 / 页面切换 | 直接相关 | 中 | 负责 `view === "senseArticleEditor"` 挂载、编辑页上下文传递、返回/提交后跳转。 |
| `frontend/src/components/senseArticle/SenseArticleEditor.js` | 编辑页主组件 / 布局 / 状态中心 | 直接相关 | 高 | 左右布局、拖拽、收起、编辑、预览、保存、提交全在这里。 |
| `frontend/src/components/senseArticle/SenseArticle.css` | 样式 / 布局实现 | 直接相关 | 高 | 当前 `grid`、divider、toggle tab、响应式退化都在这里。 |
| `frontend/src/components/senseArticle/SenseArticleRenderer.js` | 预览渲染 | 强相关 | 低 | 右侧预览 pane 内容由它渲染；本身不做 split，但受 pane 宽度和滚动承载影响。 |
| `frontend/src/components/senseArticle/SenseArticlePageHeader.js` | 顶部 header | 强相关 | 中 | 如果收起按钮或布局层级要更协调，header 区可能需要轻量调整。 |
| `frontend/src/components/senseArticle/SenseArticlePage.js` | 阅读页 / 进入编辑页入口 | 强相关 | 低 | “更新释义”“编辑本节”“选段修订”入口都在这里。 |
| `frontend/src/components/senseArticle/senseArticleUi.js` | UI 文案 / breadcrumb / 状态元信息 | 弱相关 | 低 | 页面文案和标题构成在这里，通常无需因 split/collapse 大改。 |
| `frontend/src/components/senseArticle/senseArticleNavigation.js` | 上下文构建 / 子视图导航 | 强相关 | 低 | 决定 editor/history/review/dashboard 间如何传 context。 |
| `frontend/src/utils/senseArticleApi.js` | API | 弱相关 | 低 | 布局改造不应改动 API。 |
| `frontend/src/components/senseArticle/senseArticleScopedRevision.js` | scoped 编辑数据映射 | 强相关 | 低 | 决定 `scopedText` 如何映射回整篇正文；会影响左侧编辑 pane 内容但不是布局来源。 |
| `frontend/src/utils/senseArticleSyntax.js` | 预览解析器 | 强相关 | 低 | `previewSource -> AST` 的解析发生在这里；布局改造应避免触碰。 |
| `frontend/src/components/senseArticle/SenseArticleStateView.js` | 空态/错误态组件 | 弱相关 | 低 | 编辑页异常态包裹使用。 |
| `frontend/src/components/senseArticle/SenseArticleErrorBoundary.js` | 边界隔离 | 弱相关 | 低 | 页面 render 崩溃时回退；与 split/collapse 本身关系不大。 |
| `frontend/src/components/senseArticle/senseArticleTheme.js` | 主题变量注入 | 强相关 | 中 | 新把手、收起按钮、pane 阴影等最好沿用这里输出的主题变量。 |
| `frontend/src/components/senseArticle/SenseArticleStatusBadge.js` | 状态徽标 | 弱相关 | 低 | 仅 header 徽标展示。 |
| `frontend/src/components/senseArticle/SenseArticleHistoryPage.js` | 历史页 | 弱相关 | 低 | 可从历史页跳回 editor，但不参与编辑页布局实现。 |
| `frontend/src/components/senseArticle/SenseArticleReviewPage.js` | 审核页 | 弱相关 | 低 | 与 editor 同属 senseArticle 子视图；布局模式可参考但不建议耦合。 |
| `frontend/src/components/senseArticle/SenseArticleDashboardPage.js` | dashboard | 弱相关 | 低 | 从 editor 可跳到 dashboard；本次功能不应侵入。 |

# 3. 挂载链路与页面切换链路

## 3.1 从 App 根入口到百科编辑页的挂载路径

当前仓库不是路由式页面，而是 `App.js` 里的单页 `view` 分发。

调用链：

`App -> view state -> senseArticleContext state -> view === "senseArticleEditor" -> <SenseArticleErrorBoundary> -> <SenseArticleEditor />`

关键代码：

```js
const [senseArticleContext, setSenseArticleContext] = useState(null);

const navigateSenseArticleSubView = useCallback((nextView, patch = {}, options = {}) => {
  setSenseArticleContext((prev) => buildSenseArticleSubViewContext(prev, view, patch, options));
  setView(nextView);
}, [view]);
```

来源：`frontend/src/App.js:628-639`

编辑页挂载点：

```jsx
{view === "senseArticleEditor" && senseArticleContext?.nodeId && senseArticleContext?.senseId && senseArticleContext?.revisionId && (
  <SenseArticleErrorBoundary ...>
    <SenseArticleEditor
      nodeId={senseArticleContext.nodeId}
      senseId={senseArticleContext.senseId}
      revisionId={senseArticleContext.revisionId || senseArticleContext.selectedRevisionId}
      articleContext={senseArticleContext}
      onContextPatch={patchSenseArticleContext}
      onBack={handleSenseArticleBack}
      onOpenDashboard={handleOpenSenseArticleDashboard}
      onSubmitted={() => {
        navigateSenseArticleSubView('senseArticle', { selectedRevisionId: '', revisionId: '', revisionStatus: '' });
        fetchNotifications(true);
      }}
    />
  </SenseArticleErrorBoundary>
)}
```

来源：`frontend/src/App.js:6579-6598`

## 3.2 `view === "senseArticleEditor"` 的切换链路

### 阅读页/节点详情进入百科页

```js
const openSenseArticleView = (target = {}, options = {}) => {
  const nextContext = buildSenseArticleNavigationState({
    target,
    options,
    currentView: view,
    currentContext: senseArticleContext,
    currentNodeId: normalizeObjectId(currentNodeDetail?._id),
    currentTitleId: normalizeObjectId(currentTitleDetail?._id)
  });
  if (!nextContext) return;
  setSenseArticleContext(nextContext);
  setView(options.view || 'senseArticle');
};
```

来源：`frontend/src/App.js:5579-5593`

### 从百科阅读页进入编辑页

`SenseArticlePage` 通过 `onOpenEditor` 把动作抛回 `App.js`。入口有三类：

- 整页修订：`onOpenEditor({ mode: 'full' })`
- 选段修订：`onOpenEditor({ mode: 'selection', anchor: selectionAnchor })`
- 小节修订：`onOpenEditor({ mode: 'heading', headingId })`

来源：

- `frontend/src/components/senseArticle/SenseArticlePage.js:419-420`
- `frontend/src/components/senseArticle/SenseArticlePage.js:593-595`
- `frontend/src/components/senseArticle/SenseArticlePage.js:620`
- `frontend/src/components/senseArticle/SenseArticlePage.js:664`

对应 `App.js` 处理器：

```js
const handleOpenSenseArticleEditor = async ({ mode = 'full', anchor = null, headingId = '', preferExisting = false, revisionId = '' } = {}) => {
  ...
  if (requestedRevisionId) {
    navigateSenseArticleSubView('senseArticleEditor', { ... });
    return;
  }
  if (preferExisting) { ... }
  if (mode === 'selection') {
    data = await senseArticleApi.createFromSelection(...);
  } else if (mode === 'heading') {
    data = await senseArticleApi.createFromHeading(...);
  } else {
    data = await senseArticleApi.createDraft(...);
  }
  navigateSenseArticleSubView('senseArticleEditor', { ... });
};
```

来源：`frontend/src/App.js:5648-5706`

## 3.3 上下文参数如何传入编辑页

`App` 层传给 `SenseArticleEditor` 的核心参数只有：

- `nodeId`
- `senseId`
- `revisionId`
- `articleContext`
- `onContextPatch`
- `onBack`
- `onOpenDashboard`
- `onSubmitted`

其中，`articleContext` 的结构由 `createSenseArticleContext` 定义：

```js
export const createSenseArticleContext = (patch = {}, base = null) => ({
  nodeId: '',
  senseId: '',
  articleId: '',
  currentRevisionId: '',
  selectedRevisionId: '',
  revisionId: '',
  originView: '',
  breadcrumb: [],
  returnTarget: null,
  originNodeId: '',
  originTitleId: '',
  originArticle: null,
  sourceHint: '',
  nodeName: '',
  senseTitle: '',
  revisionStatus: '',
  ...(base || {}),
  ...(patch || {})
});
```

来源：`frontend/src/components/senseArticle/senseArticleNavigation.js:17-36`

编辑页内部拿到详情数据后，会反向 patch 上下文：

```js
onContextPatch && onContextPatch({
  nodeId,
  senseId,
  articleId: detail.article?._id || articleContext?.articleId || '',
  currentRevisionId: detail.article?.currentRevisionId || articleContext?.currentRevisionId || '',
  selectedRevisionId: revision._id || revisionId,
  revisionId: revision._id || revisionId,
  revisionStatus: revision.status || '',
  nodeName: detail.node?.name || articleContext?.nodeName || '',
  senseTitle: detail.nodeSense?.title || articleContext?.senseTitle || senseId,
  ...buildSenseArticleAllianceContext(detail.node, articleContext),
  breadcrumb: buildSenseArticleBreadcrumb({ ... })
});
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:184-205`

## 3.4 返回、提交后跳转、dashboard、历史页、审核页关系

状态链可以写成：

`SenseArticlePage -> onOpenEditor -> App.handleOpenSenseArticleEditor -> navigateSenseArticleSubView('senseArticleEditor') -> SenseArticleEditor`

`SenseArticleEditor.submit -> onSubmitted -> App.navigateSenseArticleSubView('senseArticle')`

`SenseArticleEditor.header/dashboard button -> onOpenDashboard -> App.navigateSenseArticleSubView('senseArticleDashboard')`

`HistoryPage.onEditRevision -> App.navigateSenseArticleSubView('senseArticleEditor')`

`ReviewPage.onReviewed -> published ? history : review`

关键代码：

- 提交后回阅读页：`frontend/src/App.js:6593-6596`
- 打开 dashboard：`frontend/src/App.js:5713-5729`
- 打开 review：`frontend/src/App.js:5731-5757`
- 打开 history：`frontend/src/App.js:5708-5711`
- history 返回 editor：`frontend/src/App.js:6635-6638`
- dashboard 返回 editor/review/history/article：`frontend/src/App.js:6648-6678`

## 3.5 哪些 state 在 App 层，哪些在编辑页内部

### App 层

- `view`
- `senseArticleContext`
- 各子视图跳转处理器
- 页面级异常边界和挂载判定

### `SenseArticleEditor` 内部

- 编辑内容：`source`, `scopedText`
- 预览内容：`previewSource`, `previewState`
- 布局残留状态：`previewWidthPct`, `previewCollapsed`, `isResizingPreview`
- 表单状态：`revisionTitle`, `note`, `senseTitle`
- 行为状态：`loading`, `saving`, `submitting`, `abandoning`
- 辅助 UI：`showHelp`, `showReferencePicker`, `referenceQuery`, `referenceResults`

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:84-123`

# 4. 百科编辑页 DOM / JSX 结构解剖

`SenseArticleEditor` 的主 JSX 结构如下。

```text
div.sense-article-page.editor-mode
├─ <SenseArticlePageHeader />
├─ div.sense-editor-toolbar.productized
├─ div.sense-editor-helper-grid               (条件渲染)
└─ div.sense-editor-layout.resizable
   ├─ section.sense-editor-pane.editor-primary
   ├─ div.sense-editor-divider
   │  ├─ button.sense-preview-toggle-tab
   │  └─ button.sense-editor-resize-handle
   └─ section.sense-editor-pane.preview
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:750-923`

## 4.1 顶部 header 区

- 节点：`<SenseArticlePageHeader />`
- 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:752-784`
- 作用：返回、词条管理、放弃修订、保存草稿、提交审核。
- 是否建议改动：谨慎小改。这里不是 split 容器，不应承载拖拽逻辑；如果需要新增更协调的状态提示，可轻量增补。

## 4.2 toolbar 区

- 节点：`div.sense-editor-toolbar.productized`
- 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:786-795`
- 作用：插入标题、列表、引用、公式、符号、语法帮助。
- 是否建议改动：尽量不动行为逻辑。视觉可跟随主题微调，但不应和拖拽/收起耦合。

## 4.3 helper grid 区

- 节点：`div.sense-editor-helper-grid`
- 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:797-837`
- 作用：引用插入器、语法帮助、scoped 上下文说明。
- 是否建议改动：不建议把 split/collapse 放到这里；这是编辑区上方的辅助区，不是主分栏容器。

## 4.4 主编辑布局区

最关键节点：

```jsx
<div
  ref={editorLayoutRef}
  className={`sense-editor-layout resizable ${previewCollapsed ? 'preview-collapsed' : ''}`}
  style={{ '--sense-editor-preview-width': previewCollapsed ? '0px' : `${previewWidthPct}%` }}
>
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:839-843`

结论：

- `div.sense-editor-layout.resizable` 是当前最适合作为 split 容器的节点。
- 它已经带有 `ref`、宽度变量和 collapsed class，后续实现无需另找外层。
- 但这里现在同时承载布局状态和业务状态绑定，结构上应简化。

## 4.5 左侧编辑 pane

节点：

- `section.sense-editor-pane.editor-primary`
- 来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:844-883`

内部关键元素：

- pane title：`div.sense-editor-pane-title`
- 释义名称输入：`input.sense-editor-title-input`
- 正文输入：`textarea.sense-editor-textarea` 或 `textarea.sense-editor-textarea.scoped`
- 提交说明：`label.sense-proposer-note > textarea`
- parse errors：`div.sense-parse-errors`

是否建议改动：

- 正文 textarea 和提交说明不能移动层级太深，否则容易影响 auto-resize 和焦点行为。
- `section.sense-editor-pane.editor-primary` 适合保留为左 pane 外层。

## 4.6 中间 divider 区

节点：

```jsx
<div className={`sense-editor-divider ${isResizingPreview ? 'dragging' : ''}`}>
  <button className="sense-preview-toggle-tab" ... />
  <button className="sense-editor-resize-handle" onPointerDown={handlePreviewResizeStart} ... />
</div>
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:884-905`

作用：

- 现在同时承载收起按钮和拖拽把手。

问题：

- divider 太窄且视觉上很重，按钮文案竖排（`writing-mode: vertical-rl`），不利于做“更好看”的产品化分栏。
- 把“收起 tab”和“resize handle”塞进同一列可以工作，但会导致视觉语言混乱。

## 4.7 右侧 preview pane

节点：

```jsx
<section className={`sense-editor-pane preview ${previewCollapsed ? 'collapsed' : ''}`} aria-hidden={previewCollapsed}>
  <div className="sense-editor-pane-title">
    全文预览
    <button ... onClick={() => refreshPreview()}>刷新预览</button>
  </div>
  {previewState.stale ? <div className="sense-review-note">...</div> : null}
  <SenseArticleRenderer revision={previewRevision} />
</section>
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:906-920`

结论：

- `section.sense-editor-pane.preview` 是最适合作为右侧 pane 外层容器的节点。
- 它已经天然包住标题、状态提示和预览渲染器，后续 collapse target 直接使用它最稳。
- 不建议把 `SenseArticleRenderer` 再包更多滚动层，除非明确需要 pane 内独立滚动。

## 4.8 哪些节点动了会影响现有功能

- `textarea.sense-editor-textarea*`：会直接影响自动增高、输入法、保存草稿数据源。
- `section.sense-editor-pane.editor-primary`：会影响 parse error、scoped diff、metadata 输入。
- `section.sense-editor-pane.preview`：会影响预览状态提示和 `SenseArticleRenderer` 承载。
- `div.sense-editor-layout.resizable`：会影响拖拽测量与响应式退化。

# 5. 当前样式系统审计

## 5.1 当前布局的真实 CSS 实现方式

基础三类布局共享规则：

```css
.sense-article-layout,
.sense-editor-layout,
.sense-review-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 300px;
  gap: 18px;
}

.sense-editor-layout,
.sense-review-layout {
  grid-template-columns: minmax(0, 1fr) 360px;
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:147-158`

编辑页残留改造后的实际布局：

```css
.sense-editor-layout.resizable {
  --sense-editor-preview-width: 30%;
  --sense-editor-splitter-width: 34px;
  grid-template-columns: minmax(0, 1fr) var(--sense-editor-splitter-width) minmax(0, var(--sense-editor-preview-width));
  align-items: stretch;
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:160-165`

结论：

- 当前不是 `flex`，而是 `grid`。
- 拖拽本质上是在改第三列 `--sense-editor-preview-width`。
- divider 本身是第二列固定宽度 34px。

## 5.2 关键样式节点

### `.sense-editor-layout`

- 当前承担 split 容器职责。
- 已经是最合理的布局宿主。
- 但 `.resizable` 是直接覆盖在通用 `.sense-editor-layout` 上，说明布局职责与业务页职责耦合较深。

### `.sense-editor-pane`

统一面板基础外观来自：

```css
.sense-editor-pane {
  background: var(--sense-theme-surface);
  border: 1px solid var(--sense-theme-border);
  border-radius: 16px;
  box-shadow: 0 18px 48px var(--sense-theme-shadow);
  padding: 16px;
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:40-50, 183-188`

建议：这一层视觉语言值得保留，不需要推倒重来。

### `.sense-editor-pane.preview`

```css
.sense-editor-pane.preview {
  overflow: hidden;
}

.sense-editor-pane.preview.collapsed {
  padding: 0;
  border-color: transparent;
  box-shadow: none;
  opacity: 0;
  pointer-events: none;
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:859-869`

问题：

- 这是纯视觉隐藏，不是逻辑卸载。
- desktop 下 collapsed 仍保留节点和预览计算。

### `.sense-editor-toolbar.productized`

```css
.sense-editor-toolbar.productized {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 16px;
  margin-bottom: 16px;
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:788-794`

这部分和 split 无直接冲突，应保留。

### `.sense-editor-helper-grid`

```css
.sense-editor-helper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:796-800`

这部分位于 split 之上，不建议卷入拖拽计算。

### `.sense-editor-textarea`

```css
.sense-editor-textarea {
  min-height: 140px;
  background: rgba(2, 6, 23, 0.42);
  border: 1px solid var(--sense-theme-border-soft);
  border-radius: 12px;
  padding: 12px;
}

.sense-editor-textarea.auto-expand {
  overflow: hidden;
  resize: none;
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:257-271`

说明：

- textarea 自身禁止浏览器原生手动 resize。
- 左侧编辑区高度变化完全依赖 JS auto-resize。

## 5.3 1080px 以下发生了什么

```css
@media (max-width: 1080px) {
  .sense-article-layout,
  .sense-editor-layout,
  .sense-review-layout,
  .sense-review-stage-card,
  .sense-article-topbar {
    grid-template-columns: 1fr;
    display: grid;
  }

  .sense-editor-layout.resizable {
    grid-template-columns: 1fr;
  }
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:515-530`

同时：

```css
@media (max-width: 1080px) {
  .sense-editor-divider {
    flex-direction: row;
    min-height: auto;
  }

  .sense-preview-toggle-tab {
    min-height: 52px;
    writing-mode: horizontal-tb;
  }

  .sense-editor-resize-handle {
    display: none;
  }

  .sense-editor-layout.resizable.preview-collapsed .sense-editor-pane.preview {
    display: none;
  }
}
```

来源：`frontend/src/components/senseArticle/SenseArticle.css:884-916`

结论：

- 窄屏时拖拽已被 CSS 禁用，只保留收起按钮。
- 当前退化策略是“单列 + 可隐藏 preview pane”，方向是对的。
- 但状态本身没有显式区分“桌面可拖拽”和“窄屏不可拖拽”，只靠 CSS 隐藏 handle。

## 5.4 为什么当前实现不适合直接粗暴加拖拽

- 现有 split 逻辑已经进入业务组件；继续堆会让 `SenseArticleEditor` 更难维护。
- divider 设计成独立窄列，视觉非常强，容易和 pane 标题、按钮层级冲突。
- `previewCollapsed` 直接把预览列宽设成 `0px`，再通过 pane class 做透明隐藏，这种实现不利于做“记住上次展开宽度”。
- `writing-mode: vertical-rl` 的竖排 tab 很显眼，但不够自然；视觉升级空间很大。
- 没有持久化，刷新页面无法恢复用户手动调整的宽度。

## 5.5 哪些样式建议新增 / 替换 / 保留

建议保留：

- `.sense-editor-pane` 的主题面板风格
- `.sense-editor-toolbar.productized`
- `.sense-editor-helper-grid`
- 主题变量体系 `--sense-theme-*`

建议替换：

- `.sense-editor-divider`
- `.sense-preview-toggle-tab`
- `.sense-editor-layout.resizable` 的具体 split 表达方式

建议新增：

- 拖拽态的全局 body class 或页面 class
- 更细粒度的 split CSS 变量，例如 handle 宽度、pane 最小宽度、展开动画时长
- preview pane 收起/展开的过渡样式

# 6. 现有编辑与预览逻辑审计

## 6.1 `source / previewSource / previewState` 的关系

核心链路：

```js
const effectiveSource = scopedState.isScoped ? scopedState.composeSource(scopedText) : source;

const refreshPreview = useCallback((nextSource, reason = 'manual') => {
  const sourceToUse = nextSource !== undefined ? nextSource : effectiveSourceRef.current;
  previewReasonRef.current = reason;
  setPreviewSource(sourceToUse || '');
  setPreviewState({ stale: false, paused: false, reason });
}, []);
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:235, 316-321`

自动刷新：

```js
useEffect(() => {
  const nextPreviewSource = effectiveSource || '';
  if (nextPreviewSource === previewSource) { ... }

  const shouldPause = nextPreviewSource.length > PREVIEW_AUTO_REFRESH_MAX_SOURCE_LENGTH;
  setPreviewState({ stale: true, paused: shouldPause, reason: ... });
  if (shouldPause) return;

  const timer = setTimeout(() => {
    refreshPreview(nextPreviewSource, 'auto');
  }, PREVIEW_AUTO_REFRESH_MS);
  return () => clearTimeout(timer);
}, [effectiveSource, previewSource, refreshPreview]);
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:323-343`

结论：

- `source/scopedText` 是输入态。
- `effectiveSource` 是当前应被预览的正文。
- `previewSource` 是延迟刷新的“已提交给预览解析器”的文本快照。
- `previewState` 只控制 UI 提示，不控制 pane 可见性。

## 6.2 手动刷新预览

手动刷新来自右侧 pane 标题按钮：

```jsx
<button type="button" className="btn btn-small btn-secondary" onClick={() => refreshPreview()}>
  刷新预览
</button>
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:907-911`

## 6.3 预览解析链路

```js
const previewRevision = useMemo(() => {
  const parsed = parseSenseArticleSource(previewSource || '');
  return {
    _id: revisionId,
    ast: parsed.ast,
    referenceIndex: parsed.referenceIndex,
    headingIndex: parsed.headingIndex,
    plainTextSnapshot: parsed.plainTextSnapshot,
    parseErrors: parsed.parseErrors
  };
}, [nodeId, previewSource, revision.sourceMode, revisionId, senseId]);
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:345-379`

预览渲染器只吃 AST blocks：

```js
const blocks = useMemo(() => (Array.isArray(revision?.ast?.blocks) ? revision.ast.blocks : EMPTY_ARRAY), [revision]);
...
return <div className="sense-article-renderer">{blocks.map(...BlockView...)}</div>;
```

来源：`frontend/src/components/senseArticle/SenseArticleRenderer.js:207-253`

说明：

- 布局改造不应改 `parseSenseArticleSource` 和 `SenseArticleRenderer` 的契约。
- 右侧 pane 宽度变化只会影响渲染宽度，不改变 AST。

## 6.4 textarea 自动增高逻辑

```js
const syncTextareaHeight = useCallback((element) => {
  if (!element) return;
  const computedStyle = window.getComputedStyle(element);
  const minHeight = Number.parseFloat(computedStyle.minHeight) || 0;
  element.style.height = 'auto';
  element.style.height = `${Math.max(element.scrollHeight, minHeight)}px`;
}, [...]);

useLayoutEffect(() => {
  if (isCompositionRef.current) return;
  const element = scopedState.isScoped ? scopedTextareaRef.current : sourceTextareaRef.current;
  syncTextareaHeight(element);
}, [scopedState.isScoped, scopedText, source, syncTextareaHeight]);
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:239-264`

补充：

- composition 期间跳过，composition end 再强制同步一次（`frontend/src/components/senseArticle/SenseArticleEditor.js:625-656`）。

这说明当前 textarea auto-expand 已经相对独立，后续 split resize 不应重碰这一段。

## 6.5 scoped 编辑模式是否会影响布局改造

会影响左 pane 内容结构，但不会改变 split 容器结构。

scoped 时：

- 左侧会额外展示范围说明、修订痕迹区域、`textarea.scoped`
- `effectiveSource` 由 `scopedText -> composeSource(scopedText)` 得到

来源：

- `frontend/src/components/senseArticle/SenseArticleEditor.js:215-235`
- `frontend/src/components/senseArticle/senseArticleScopedRevision.js:271-299`

结论：

- split/collapse 方案必须对 full 和 scoped 共用。
- 不应把布局状态放到只适合 full 模式的代码路径里。

## 6.6 parse errors 的展示位置会不会影响面板高度/滚动

会。

parse errors 渲染在左侧编辑 pane 最底部：

```jsx
{(previewRevision.parseErrors || []).length > 0 ? (
  <div className="sense-parse-errors">...</div>
) : null}
```

来源：`frontend/src/components/senseArticle/SenseArticleEditor.js:876-882`

因为 parse errors 在左 pane 内部，拖拽宽度本身不会改变它的逻辑，但：

- 右侧收起后，左侧更宽，输入节奏和预览换行会变化；
- 左侧 textarea 自动增高和 parse errors 堆叠可能让整个主布局高度快速变化。

## 6.7 如果右侧预览被收起，现有逻辑是否还能正常存在

能。

原因：

- 右侧 pane 当前只是视觉隐藏，不是逻辑卸载。
- `previewSource` 自动刷新 effect 不依赖 `previewCollapsed`。
- `previewRevision` 的 `useMemo` 也不依赖 `previewCollapsed`。

也就是说，当前仓库里“收起预览”更接近 `UI hide`，不是 `feature off`。

## 6.8 如果拖拽调整宽度，哪部分逻辑最容易因为重渲染/测量变化出问题

最容易出问题的是布局层本身，而不是预览解析层：

- `pointermove -> setPreviewWidthPct` 会触发整个 `SenseArticleEditor` 重渲染（`frontend/src/components/senseArticle/SenseArticleEditor.js:281-289`）。
- 虽然 `previewRevision` 由 `previewSource` 驱动，不会在每次拖拽时重新 parse，但整个 JSX 和样式仍会更新。
- `editorLayoutRef.current.getBoundingClientRect()` 作为拖拽测量基准，如果布局宽度在拖拽过程中因窗口变化或外层容器变化而波动，当前实现没有二次校正。

## 6.9 textarea auto-expand 与 split resize 是否可能互相干扰

会有轻度耦合，但不是同一类问题。

- textarea 自动增高改变的是高度。
- split resize 改变的是主布局横向列宽。
- 当前实现里它们都发生在同一组件的重渲染中，因此拖拽时如果左 pane 内容很长，整体页面高度和浏览器滚动条可能同步变化。

这也是后续实现里建议把拖拽频率控制和布局状态分离出来的原因。

# 7. 搜索“失败尝试残留”

## 7.1 结论

已发现现存残留实现，而且已经直接进入当前编辑页代码，不是仓库外历史痕迹。

最明确的残留点集中在：

- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticle.css`

未发现现存的 preview width / collapse `localStorage` 持久化实现。

## 7.2 残留实现 1：编辑器内混入 preview split 状态

代码位置：

- `frontend/src/components/senseArticle/SenseArticleEditor.js:119-123`

代码：

```js
const editorLayoutRef = useRef(null);
const dragPointerIdRef = useRef(null);
const [previewWidthPct, setPreviewWidthPct] = useState(DEFAULT_PREVIEW_WIDTH_PCT);
const [previewCollapsed, setPreviewCollapsed] = useState(false);
const [isResizingPreview, setIsResizingPreview] = useState(false);
```

它想做什么：

- 在编辑页组件内部直接维护分栏宽度、收起状态和拖拽态。

为什么可能失败：

- 和编辑器核心表单状态完全混在一起。
- 后续只要再增加持久化、动画、响应式边界，组件复杂度会迅速失控。

处理建议：

- 不建议继续堆逻辑。
- 更适合重构到局部 hook 或明确的 layout 子层。

## 7.3 残留实现 2：window 级 pointermove 拖拽

代码位置：

- `frontend/src/components/senseArticle/SenseArticleEditor.js:266-305`
- `frontend/src/components/senseArticle/SenseArticleEditor.js:683-692`

代码：

```js
useEffect(() => {
  if (!isResizingPreview) return undefined;

  const handlePointerMove = (event) => {
    const layout = editorLayoutRef.current;
    if (!layout) return;
    const rect = layout.getBoundingClientRect();
    if (rect.width <= 0) return;
    const nextWidthPct = ((rect.right - event.clientX) / rect.width) * 100;
    const clampedWidthPct = Math.min(MAX_PREVIEW_WIDTH_PCT, Math.max(MIN_PREVIEW_WIDTH_PCT, nextWidthPct));
    setPreviewWidthPct(clampedWidthPct);
    if (previewCollapsed) setPreviewCollapsed(false);
  };

  const stopResize = () => {
    setIsResizingPreview(false);
    dragPointerIdRef.current = null;
  };

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', stopResize);
  window.addEventListener('pointercancel', stopResize);
  ...
}, [isResizingPreview, previewCollapsed]);
```

它想做什么：

- 按住把手后全局监听 pointer，实时更新右 pane 百分比宽度。

为什么可能失败：

- `dragPointerIdRef` 被写入，但并没有在 `pointermove` 时校验“是否同一根 pointer”。
- 没有使用 `setPointerCapture` / `lostpointercapture`。
- 没有 `requestAnimationFrame` 节流。
- 拖拽逻辑和组件重渲染强耦合。

处理建议：

- 这部分应重构，不建议原样复用。

## 7.4 残留实现 3：收起后展开直接重置成默认 30%

代码位置：

- `frontend/src/components/senseArticle/SenseArticleEditor.js:673-681`

代码：

```js
const handlePreviewToggle = useCallback(() => {
  setPreviewCollapsed((prev) => {
    const nextCollapsed = !prev;
    if (!nextCollapsed) {
      setPreviewWidthPct(DEFAULT_PREVIEW_WIDTH_PCT);
    }
    return nextCollapsed;
  });
}, []);
```

它想做什么：

- 点击 tab 在 collapsed / expanded 间切换。

为什么可能失败：

- 展开不会恢复用户刚刚拖到的宽度，只会回到默认 30%。
- 这和用户预期“收起只是临时隐藏”不一致。

处理建议：

- 需要引入 `lastExpandedPreviewWidth` 或直接保留上次非 collapsed 宽度。

## 7.5 残留实现 4：CSS 竖排 toggle tab + 0 宽收起

代码位置：

- `frontend/src/components/senseArticle/SenseArticle.css:816-869`

代码：

```css
.sense-preview-toggle-tab {
  flex: 1;
  min-height: 220px;
  display: flex;
  ...
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

.sense-editor-pane.preview.collapsed {
  padding: 0;
  border-color: transparent;
  box-shadow: none;
  opacity: 0;
  pointer-events: none;
}
```

它想做什么：

- 用一个“竖向拉舌”收起和展开预览。

为什么可能失败：

- 视觉过重，且可读性一般。
- 收起只是透明和去交互，并不是一个清晰、稳定的 pane 状态机。
- 0 宽 + opacity 0 的组合对后续动画和宽度恢复都不友好。

处理建议：

- 需要重新设计 handle 与 collapse affordance 的关系。

## 7.6 残留实现 5：没有任何 pane 状态持久化

搜索结果：

- `frontend/src/components/senseArticle` 内未发现 preview width/collapse 相关 `localStorage` key。
- `localStorage` 只用于 token、用户名、用户 ID、全局页面状态等，与编辑页 split 无关。

意味着：

- 上一次尝试没有把“刷新后恢复宽度/收起状态”做完。
- 后续实现如果要工程可用，应显式加入持久化。

# 8. 工程实现约束分析

- 不应引入新的重型 split-pane 依赖。当前仓库没有现成的 pane-resize 库，自己用 pointer events 实现更合适。
- 必须保留 `max-width: 1080px` 以下的单列退化；当前 CSS 已经明确在窄屏隐藏 resize handle。
- 拖拽期间必须避免文本被大面积选中。现有实现通过 `document.body.style.userSelect = 'none'` 已经体现了这个需求（`frontend/src/components/senseArticle/SenseArticleEditor.js:266-276`）。
- 拖拽时不应触发预览重新 parse；当前 `previewRevision` 只依赖 `previewSource`，这是好事，后续方案要保持。
- 收起后展开应恢复上次宽度，而不是回到默认 30%。
- 最小/最大宽度建议保留为百分比约束，但应转成更明确的 pane 宽度模型；当前常量是 `18% ~ 45%`（`frontend/src/components/senseArticle/SenseArticleEditor.js:34-36`）。
- 本地持久化建议使用 `localStorage`，但 key 应独立于业务 API。推荐形如 `sense-article-editor.preview-pane.v1`，值为 `{ widthPct, collapsed }`。
- 事件模型应优先使用 pointer events，而不是 mouse events；当前残留已经用了 pointer，方向正确。
- 拖拽期间建议给 `body` 或页面根节点临时加类名，而不是每次直接写 style 字符串；这样更容易和 CSS hover/active 状态统一。
- 如保留 window 级监听，至少应使用 `requestAnimationFrame` 合并频繁的 `pointermove` 更新；否则高频 setState 会让大组件重渲染过密。
- 需要在 `window resize` 或 split 容器宽度显著变化时做一次边界校正，否则百分比状态在极端宽度下可能使 pane 过窄。
- 响应式断点下应禁用拖拽，仅保留“显示/隐藏预览”；当前做法是 CSS 隐藏 handle，建议后续在 JS 状态层也显式禁止开始 resize。
- collapse 按钮最合理的位置不是 header，而是 split 边界靠预览侧的控制带；这样符合“收起的是右侧 pane”这个空间语义。

# 9. 推荐实现方案（只写方案，不写代码）

## 9.1 布局策略

- 继续使用 `grid`，不要改成 `flex`。当前编辑页已经是网格布局，`grid-template-columns` 很适合表达 `editor | divider | preview`。
- split 容器继续使用 `div.sense-editor-layout`，不要新增更外层包裹。
- 左右 pane 宽度模型建议改为：
  - 第一列：`minmax(0, 1fr)`
  - 第二列：固定 handle 宽度
  - 第三列：`minmax(previewMinPx, previewWidth)` 或百分比变量
- 拖拽把手继续位于中间 divider，但把“收起/展开控制”和“拖拽把手”分层处理：
  - divider 是独立窄列
  - 收起按钮做成贴近 preview pane 的胶囊 tab
  - resize handle 做成更轻、更明确的中线把手
- 右侧 preview pane 收起时，不建议简单把 pane 宽度变成 `0px + opacity: 0`；更稳妥的是：
  - layout 进入 collapsed class
  - preview 列宽直接切到 `0` 或极窄 tab 占位
  - preview pane 自身改为 `visibility/overflow/pointer-events` 协同处理
- 展开后恢复上次宽度，不要重置默认值。
- 小屏维持单列退化：编辑区在上，divider 控制条在中，预览在下；收起时仅隐藏预览块。

## 9.2 状态模型

建议新增或整理为以下状态：

- `previewPaneWidthPct`
- `isPreviewCollapsed`
- `isResizingPreview`
- `lastExpandedPreviewWidthPct`
- `isDesktopResizable` 或由 media query 结果派生
- `layoutReadyFromStorage`

建议：

- 这些状态仍可先放在 `SenseArticleEditor` 内，但最好抽成一个局部 hook，例如 `useSenseEditorPreviewPaneState`。
- `previewPaneWidthPct` 和 `isPreviewCollapsed` 可以从 `localStorage` 初始化。
- `lastExpandedPreviewWidthPct` 不一定需要单独持久化，只要在 collapse 前保存最近一次非 0 宽度即可。

## 9.3 事件模型

- `pointerdown`
  - 判定是否桌面断点
  - 记录起始 clientX、起始宽度
  - 进入 `isResizingPreview = true`
  - 设置 pointer capture 或 window 监听
  - 给 body 加 `col-resize` / `user-select: none` 类
- `pointermove`
  - 根据 split 容器 rect 计算右 pane 目标宽度
  - 做边界 clamp
  - 使用 `requestAnimationFrame` 合并更新
- `pointerup` / `pointercancel` / `lostpointercapture`
  - 停止 resize
  - 清理监听
  - 移除 body 类
  - 把结果写入 `localStorage`
- collapse click
  - 若当前展开，则保存最近宽度并收起
  - 若当前收起，则恢复到 `lastExpandedPreviewWidthPct`，没有则回默认 30%
- 卸载清理
  - 移除监听
  - 释放 pointer capture
  - 恢复 body 类

## 9.4 样式策略

- 视觉不要再走“高耸竖排大拉舌”路线。保留“侧边拉舌”的语义，但做成更窄、更精致的胶囊式 tab。
- 拖拽把手建议做成：
  - 中线 + 两三个短刻度
  - hover 时高亮边框或 glow
  - active 时颜色更强、阴影更紧
- 预览 pane 收起时可以加轻量过渡，但不要做重动画；重点是稳定，不是炫技。
- 标题栏按钮建议保留在 pane 内标题行，不要挪到全局 header。
- 阴影、边框、间距建议沿用现有 `--sense-theme-*` 变量，新增少量变量即可：
  - `--sense-editor-handle-width`
  - `--sense-editor-preview-min-width`
  - `--sense-editor-pane-transition`
- 面板风格、圆角、光泽感应沿用当前主题系统，不需要重做一套设计语言。

## 9.5 与现有逻辑兼容性

这个方案不会破坏现有逻辑，原因如下：

- 预览自动刷新：仍由 `previewSource / previewState` 驱动，不依赖 pane 可见性。
- 解析错误展示：仍位于左 pane 底部，不改变数据链。
- scoped 编辑：只改变左 pane 内容，不影响 split 容器本身。
- 保存草稿/提交审核：仍使用 `buildDraftPayload -> senseArticleApi.updateDraft/submitRevision`，与布局无关。
- 页面头部和工具栏：继续在 split 容器之上，不需要改业务事件。
- 响应式布局：保留 1080px 以下单列退化，只增强状态语义。

# 10. 具体改动清单（文件级）

| 文件路径 | 改动级别 | 预计改什么 | 为什么要改 | 风险等级 |
| --- | --- | --- | --- | --- |
| `frontend/src/components/senseArticle/SenseArticleEditor.js` | 大 | 重构 preview pane 状态、拖拽事件、收起/展开状态持久化；拆清布局层和业务层 | 当前所有相关状态和逻辑都在这里 | 高 |
| `frontend/src/components/senseArticle/SenseArticle.css` | 大 | 重做 divider / handle / preview collapse 样式；保留主题体系和响应式退化 | 当前视觉和交互承载都在 CSS 中 | 高 |
| `frontend/src/components/senseArticle/SenseArticlePageHeader.js` | 小 | 如需微调 header 对齐、按钮层级或 title 区间距 | 保证编辑页头部和新布局视觉一致 | 低 |
| `frontend/src/components/senseArticle/senseArticleTheme.js` | 小 | 如需新增少量 pane/handle 相关主题变量 | 避免新样式写死颜色和阴影 | 低 |
| `frontend/src/App.js` | 小 | 理论上可不改；若要恢复上次 pane 状态时做更高层记忆，可轻微补充 | 挂载链路本身稳定，不应大动 | 低 |
| `frontend/src/components/senseArticle/SenseArticleRenderer.js` | 小或不改 | 一般不改；仅当预览 pane 需要独立滚动容器时才可能加类名或包裹层 | 预览内容承载在这里 | 低 |
| `frontend/src/components/senseArticle/SenseArticlePage.js` | 小或不改 | 一般不改；最多同步按钮文案或入口视觉 | 进入编辑页入口在这里 | 低 |
| `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js` | 中（建议新增） | 抽离 split/collapse/persistence/pointer 逻辑 | 降低 `SenseArticleEditor` 体积和耦合 | 中 |

说明：

- 如果团队不想新增 hook 文件，也可以先在 `SenseArticleEditor.js` 内部抽局部函数；但从可维护性看，新增 hook 更合理。

# 11. 风险点与回归测试清单

- 桌面宽屏下拖拽 divider，右侧预览宽度应连续变化，左侧编辑区不闪烁、不丢焦点。
- 拖拽到最小边界时，预览区不应被压到不可读；拖到最大边界时，编辑区也不能被挤坏。
- 点击收起按钮后，右侧预览应稳定隐藏；再次展开应恢复上次宽度，而不是默认值。
- 刷新页面后，宽度和收起状态应按设计恢复；若不恢复，也必须是明确产品选择，不应随机。
- 编辑长文本、连续输入、粘贴大段内容时，textarea 自动增高和 split 布局不能互相抖动。
- parse error 出现/消失时，左 pane 高度变化不应让 divider 和 preview pane 错位。
- scoped 模式下，额外的“修订痕迹”和“局部正文”区块出现后，split/collapse 行为仍一致。
- 保存草稿、提交审核、放弃修订后，布局状态不应导致跳转异常。
- 从阅读页进入编辑页、从历史页继续编辑、从 dashboard 打开编辑页，都要验证布局状态初始化正确。
- 窄屏小于 1080px 时，应退化为单列；拖拽把手不可用，收起/展开仍能工作。
- 鼠标和触控板都要测试；如果未来需要触屏支持，pointer 事件要验证触摸输入不会误选文字。
- 拖拽中快速切页或组件卸载时，window 事件监听必须清理干净，body cursor/user-select 必须恢复。
- 右侧预览本身如果已有滚动，拖拽和收起后滚动状态不要异常跳变。
- `SenseArticleRenderer` 中长段落、列表、代码块、引用块在窄 preview 宽度下的排版要可接受。

# 12. 你建议的“最小可实施版本（MVP）”

## 第一阶段最小实现

- 重构现有 split/collapse 状态模型。
- 保留 `grid` 三列结构，但把拖拽和收起逻辑整理干净。
- 增加本地持久化。
- 改善 divider / handle / tab 的视觉，但先追求稳，不追求复杂动效。
- 保持 desktop 可拖拽、mobile 单列、preview 可收起/展开。

## 第二阶段再补

- 更细的视觉打磨：hover/active 状态、过渡曲线、阴影层次、tab 文案与 icon 微调。
- 更好的 pane 内部滚动策略。
- 更细致的 `ResizeObserver` 或容器宽度校正。

## 可延后的“好看但不必要”项

- 复杂动画
- 预览 pane 高级空态或装饰性纹理
- 更激进的 header 重排
- 把 split 状态提升到更高层做跨页面共享

## 先稳住功能，再补视觉细节

最小正确路线应该是：

`先把状态模型和事件模型做稳 -> 再保证响应式退化和持久化 -> 最后做高级视觉`

不建议反过来先堆样式，再去修拖拽状态。

---

## 附：运行观察

- 本次未实际启动浏览器做交互观察，只进行了静态代码审计。
- 这不影响本结论，因为当前需要回答的是“现有实现在哪里、耦合点在哪里、后续该怎样改最合理”，这些问题已经可以从代码结构直接判断。
