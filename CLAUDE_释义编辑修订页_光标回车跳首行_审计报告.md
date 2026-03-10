# 1. 问题对应页面定位

## 1.1 目标页面判定

仓库里与“释义编辑/修订/编辑页”相关的前端页面至少有 5 个：

- `frontend/src/components/senseArticle/SenseArticlePage.js`：释义百科阅读页
- `frontend/src/components/senseArticle/SenseArticleEditor.js`：释义修订编辑页
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`：修订审阅页
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`：历史页
- `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`：管理页

其中**最符合问题描述的页面是 `SenseArticleEditor`**，理由如下：

- 只有它存在正文级可编辑输入框，且该输入框绑定正文状态 `source` / `scopedText`。
- 它同时支持“整页修订 / 本节修订 / 选段修订”，都属于“释义编辑修订页”语义。
- `SenseArticleReviewPage` 只有审核意见输入框，不是正文编辑器：

```jsx
// frontend/src/components/senseArticle/SenseArticleReviewPage.js:246-249
<div className="sense-editor-pane-title">审核意见</div>
<textarea
  value={comment}
  onChange={(event) => setComment(event.target.value)}
  className="sense-review-comment"
  placeholder="填写审核意见（可选）"
  disabled={!canAct || !!acting}
/>
```

## 1.2 路由 / 入口 / 页面组件

这个项目**没有使用 React Router 这类 URL 路由**来切释义编辑页；它用 `App.js` 内部的 `view` 状态做子页面切换。

- 入口文件：`frontend/src/App.js`
- 页面路由机制：`const [view, setView] = useState('login');`
- 释义编辑页判定条件：`view === "senseArticleEditor"`

关键代码：

```jsx
// frontend/src/App.js:6579-6597
{view === "senseArticleEditor" && senseArticleContext?.nodeId && senseArticleContext?.senseId && senseArticleContext?.revisionId && (
  <SenseArticleErrorBoundary
    resetKey={`${view}:${senseArticleContext.nodeId}:${senseArticleContext.senseId}:${senseArticleContext.revisionId || senseArticleContext.selectedRevisionId || ''}`}
    onBack={handleSenseArticleBack}
    title="释义编辑页发生异常"
  >
    <SenseArticleEditor
      nodeId={senseArticleContext.nodeId}
      senseId={senseArticleContext.senseId}
      revisionId={senseArticleContext.revisionId || senseArticleContext.selectedRevisionId}
      articleContext={senseArticleContext}
      onContextPatch={patchSenseArticleContext}
      onBack={handleSenseArticleBack}
      onOpenDashboard={handleOpenSenseArticleDashboard}
    />
  </SenseArticleErrorBoundary>
)}
```

## 1.3 页面目录结构

相关目录集中在：

- `frontend/src/App.js`
- `frontend/src/utils/senseArticleApi.js`
- `frontend/src/components/senseArticle/`
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/utils/senseArticleSyntax.js`

## 1.4 从“路由”到最终编辑器组件的调用链

按真实代码链路，正文编辑入口有两类：

### A. 从阅读页点击“更新释义”

- `frontend/src/App.js` / `openSenseArticleView()` / 打开释义百科子系统视图
- `frontend/src/components/senseArticle/SenseArticlePage.js` / `SenseArticlePage` / 阅读页，展示正文、目录、搜索、选段入口
- `frontend/src/components/senseArticle/SenseArticlePage.js` / “更新释义”按钮 / 触发 `onOpenEditor({ mode: 'full' })`
- `frontend/src/App.js` / `handleOpenSenseArticleEditor()` / 创建或复用 revision，并把 `view` 切到 `senseArticleEditor`
- `frontend/src/components/senseArticle/SenseArticleEditor.js` / `SenseArticleEditor` / 加载 revision detail，渲染正文编辑器和预览

关键代码：

```jsx
// frontend/src/components/senseArticle/SenseArticlePage.js:592-595
<button type="button" className="btn btn-primary" onClick={() => onOpenEditor && onOpenEditor({ mode: 'full' })}>
  <PenSquare size={16} /> 更新释义
</button>
```

```js
// frontend/src/App.js:5648-5702
const handleOpenSenseArticleEditor = async ({ mode = 'full', anchor = null, headingId = '', preferExisting = false, revisionId = '' } = {}) => {
  ...
  if (mode === 'selection') {
    data = await senseArticleApi.createFromSelection(...);
  } else if (mode === 'heading') {
    data = await senseArticleApi.createFromHeading(...);
  } else {
    data = await senseArticleApi.createDraft(...);
  }
  navigateSenseArticleSubView('senseArticleEditor', {
    nodeId: targetNodeId,
    senseId: targetSenseId,
    selectedRevisionId: data?.revision?._id || '',
    revisionId: data?.revision?._id || ''
  });
};
```

### B. 从阅读页点击“编辑本节”或“选段修订”

- `frontend/src/components/senseArticle/SenseArticlePage.js` / 目录按钮 “编辑本节” / `onOpenEditor({ mode: 'heading', headingId })`
- `frontend/src/components/senseArticle/SenseArticlePage.js` / 选中文本工具条 “选段修订” / `onOpenEditor({ mode: 'selection', anchor })`
- 后续仍进入同一个 `SenseArticleEditor`

## 1.5 真正接收键盘输入的是哪个组件 / 元素

**真正接收正文键盘输入的是原生 `<textarea>` 元素。**

而且有两个分支，但都在同一页面组件里：

- 整页修订：`<textarea ref={sourceTextareaRef} value={source} ... className="sense-editor-textarea auto-expand" rows={1} />`
- 局部修订：`<textarea ref={scopedTextareaRef} value={scopedText} ... className="sense-editor-textarea scoped auto-expand" rows={1} />`

关键代码：

```jsx
// frontend/src/components/senseArticle/SenseArticleEditor.js:815-833
{scopedState.isScoped ? (
  <textarea
    ref={scopedTextareaRef}
    value={scopedText}
    onChange={(event) => setScopedText(event.target.value)}
    onCompositionStart={handleBodyCompositionStart}
    onCompositionEnd={handleBodyCompositionEnd}
    className="sense-editor-textarea scoped auto-expand"
    spellCheck="false"
    rows={1}
  />
) : (
  <textarea
    ref={sourceTextareaRef}
    value={source}
    onChange={(event) => setSource(event.target.value)}
    onCompositionStart={handleBodyCompositionStart}
    onCompositionEnd={handleBodyCompositionEnd}
    className="sense-editor-textarea auto-expand"
    spellCheck="false"
    rows={1}
  />
)}
```

# 2. 编辑器技术实现识别

## 2.1 这是原生 textarea 吗？

**是。**

证据：

- `SenseArticleEditor.js:830` 和 `SenseArticleEditor.js:833` 直接渲染原生 `<textarea>`
- `frontend/package.json` 没有 Monaco / CodeMirror / Slate / Draft.js / Lexical / ProseMirror / Quill / Tiptap 之类依赖

```json
// frontend/package.json
"dependencies": {
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-scripts": "5.0.1",
  "lucide-react": "^0.263.1",
  "socket.io-client": "^4.5.4",
  "three": "^0.165.0"
}
```

## 2.2 这是 contenteditable 吗？

**不是。**

全局检索 `frontend/src/components/senseArticle/`，没有 `contentEditable` 命中。

## 2.3 这是富文本编辑器库吗？

**不是。**

没有 Slate / Draft.js / ProseMirror / Tiptap / Lexical / Quill / Monaco / CodeMirror 相关依赖或组件调用。

真正的实现方式是：

- 输入层：原生 `textarea`
- 预览层：自研语法解析器 `parseSenseArticleSource()` 把字符串解析成 AST blocks
- 渲染层：`SenseArticleRenderer` 把 AST blocks 映射成 React DOM

```js
// frontend/src/utils/senseArticleSyntax.js:171-298
export const parseSenseArticleSource = (source = '') => {
  const normalized = String(source || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks = [];
  ...
  return {
    editorSource: normalized,
    ast: { type: AST_NODE_TYPES.DOCUMENT, blocks },
    headingIndex,
    referenceIndex,
    ...
  };
};
```

```jsx
// frontend/src/components/senseArticle/SenseArticleRenderer.js:232-253
return (
  <div className="sense-article-renderer">
    {blocks.map((block) => (
      <BlockView key={block.id} block={block} ... />
    ))}
  </div>
);
```

## 2.4 是否有“按行渲染”“按块渲染”“分页渲染”“虚拟滚动”“逐段映射渲染”？

结论：

- 输入层：**没有按行渲染**，只有一个 `textarea`
- 预览层：**有按块渲染**，基于 AST block 映射
- 阅读层：**有按块渲染**，同样是 `blocks.map(...)`
- **没有分页渲染**
- **没有虚拟滚动**
- **没有隐藏输入框 + 镜像显示层**
- **没有按显示行切分**

证据：

- `SenseArticleRenderer.js:232-253` 是直接 `blocks.map`
- 全局检索无 `virtual` / `virtualized` / `pagination` / `page-break` / `mirror` / `hidden input` 等相关实现

## 2.5 文本内容以什么数据结构保存？

正文编辑态实际是 **string**：

- 整页模式：`source`
- 局部模式：`scopedText`
- 预览/持久化前会再推导出 `effectiveSource`

```js
// frontend/src/components/senseArticle/SenseArticleEditor.js:199-227
const scopedState = useMemo(() => {
  const newState = buildScopedRevisionState({
    scope: scopedScope,
    currentSource: source,
    fallbackCurrentText: scopedText,
    preferFallbackCurrentText: scopedScope.isScoped
  });
  ...
}, [scopedScope, source, scopedText]);

const effectiveSource = scopedState.isScoped ? scopedState.composeSource(scopedText) : source;
```

预览态是 **AST blocks JSON 结构**：

- `parseSenseArticleSource()` 返回 `ast.blocks`
- 渲染器按 block 类型绘制标题、段落、列表、引用块等

## 2.6 回车后是浏览器默认插入换行，还是被手动接管？

**正文回车由浏览器默认处理，不是手动接管。**

证据：

- 正文两个 `textarea` 都**没有** `onKeyDown` / `onBeforeInput` / `onInput`
- 只有 `onChange` 和 composition 事件
- `SenseArticleEditor.js` 中 `key === 'Enter'` 的 `preventDefault()` 只出现在“修订标题 input”，不在正文 textarea

```jsx
// frontend/src/components/senseArticle/SenseArticleEditor.js:687-701
<input
  ref={titleInputRef}
  value={revisionTitle}
  onChange={(event) => setRevisionTitle(event.target.value)}
  onBlur={() => handleTitleEditFinish(false)}
  onKeyDown={(event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleTitleEditFinish(false);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      handleTitleEditFinish(true);
    }
  }}
/>
```

# 3. 与光标/selection 相关的代码全量排查

本次排查范围：

- `frontend/src/components/senseArticle/`
- `frontend/src/App.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/utils/senseArticleSyntax.js`
- `frontend/src/utils/senseArticleApi.js`

结论先行：

- **高风险点几乎都集中在 `SenseArticleEditor.js`**
- `window.getSelection()` / `Range` 只出现在阅读页，用于“选段修订”入口，不在正文输入链路里
- `setSelectionRange()` 只在编辑器里出现两处：一个是正文自动增高逻辑，一个是模板插入逻辑；其中前者与 Enter bug 关系最强

## 3.1 高风险

### A. `SenseArticleEditor.js` 自动增高 effect

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`255-293`
- 相关 API：`selectionStart`、`selectionEnd`、`setSelectionRange`、`document.activeElement`、`requestAnimationFrame`、`window.scrollBy`
- 风险等级：**高风险**

关键代码：

```js
// frontend/src/components/senseArticle/SenseArticleEditor.js:255-293
useEffect(() => {
  const element = isScopedRef.current ? scopedTextareaRef.current : sourceTextareaRef.current;
  if (!element) return;

  const currentScrollHeight = element.scrollHeight;
  if (currentScrollHeight === lastHeightRef.current) return;

  if (currentScrollHeight > element.clientHeight) {
    const selectionStart = element.selectionStart;
    const selectionEnd = element.selectionEnd;
    const isActive = document.activeElement === element;
    const rectBefore = element.getBoundingClientRect();
    const topBefore = rectBefore.top;
    const heightDiff = currentScrollHeight - element.clientHeight;

    element.style.height = `${currentScrollHeight}px`;
    lastHeightRef.current = currentScrollHeight;

    requestAnimationFrame(() => {
      if (isActive && element === document.activeElement) {
        element.setSelectionRange(selectionStart, selectionEnd);
      }
      if (topBefore < window.innerHeight) {
        window.scrollBy(0, heightDiff);
      }
    });
  }
}, [scopedText, source]);
```

为什么它最可疑：

- 它会在**每次正文内容变化后**运行。
- 只有当 `scrollHeight > clientHeight` 时才进入，说明它与“内容高度刚开始增加”的区间强相关。
- 它主动改 DOM 高度、主动恢复选区、主动滚动窗口，是本仓库里**唯一直接操作正文光标/选区的代码**。
- 它没有保存/恢复 `scrollTop`，只恢复了字符 offset。
- 它既作用于整页 `sourceTextareaRef`，也作用于局部 `scopedTextareaRef`，所以 full / scoped 都会命中同一逻辑。

与 bug 的关系：

- 用户说“第 5–15 行之间回车更容易出现”，而这里的触发条件正是 textarea 内容开始超出当前高度时。
- 这更像**视觉行触发阈值**，不是逻辑 `\n` 行号触发。

### B. 正文 textarea 是受控组件

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`830-833`
- 相关 API：`value`、`onChange`
- 风险等级：**高风险**

关键代码：

```jsx
// scoped
<textarea
  ref={scopedTextareaRef}
  value={scopedText}
  onChange={(event) => setScopedText(event.target.value)}
  ...
  rows={1}
/>

// full
<textarea
  ref={sourceTextareaRef}
  value={source}
  onChange={(event) => setSource(event.target.value)}
  ...
  rows={1}
/>
```

为什么相关：

- 浏览器先默认插入换行，然后 React 通过 `onChange -> setState -> rerender` 再把 `value` 重新受控回去。
- React 对受控 textarea 通常会保留光标，但一旦同时叠加“改高度 + restore selection + scrollBy”，风险会显著升高。

## 3.2 中风险

### C. scoped 模式每次输入都会重新推导全文

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`207-227`
- 文件：`frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- 位置：`135-220`
- 风险等级：**中风险**

关键代码：

```js
// frontend/src/components/senseArticle/SenseArticleEditor.js:207-227
const scopedScope = useMemo(() => buildScopedRevisionScope({
  sourceMode: revision.sourceMode || 'full',
  baseSource: baseRevision?.editorSource || source,
  targetHeadingId: revision.targetHeadingId || '',
  selectedRangeAnchor: revision.selectedRangeAnchor || null,
  fallbackOriginalText: revision?.scopedChange?.originalText || ''
}), [..., source]);

const effectiveSource = scopedState.isScoped ? scopedState.composeSource(scopedText) : source;
```

```js
// frontend/src/components/senseArticle/senseArticleScopedRevision.js:178-220
if (mode === 'section') {
  return {
    ...,
    composeSource: (nextText = '') => `${normalizedBase.slice(0, section.bodyStart)}${normalizeSource(nextText)}${normalizedBase.slice(section.bodyEnd)}`
  };
}
...
return {
  ...,
  composeSource: (nextText = '') => `${normalizedBase.slice(0, absoluteStart)}${normalizeSource(nextText)}${normalizedBase.slice(absoluteEnd)}`
};
```

说明：

- 如果用户复现的是“编辑本节 / 选段修订”，这层是 scoped 模式特有的额外复杂度。
- 它本身不直接改 selection，但它会让每次输入都伴随全文字符串重建。
- 若 bug 只出现在 scoped 编辑、不出现在 full 编辑，则这层优先级会上升。

注：代码里 `selection` 分支的 `composeSource` 实际为 `prefix + nextText + suffix`，不是分页/块重建；因此它目前仍低于 auto-resize 的直接风险。

### D. 预览链路会在输入后追加状态更新

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`312-332`, `334-368`
- 风险等级：**中风险**

说明：

- 每次输入后，`previewState` 会先被置为 `stale`。
- 停止输入 1 秒后，`previewSource` 更新并重新 `parseSenseArticleSource()`。
- 这不会直接 remount textarea，但它会放大每次按键后的组件重渲染量。

与 bug 的关系：

- 单独看，它不足以解释“跳到首行”。
- 和 `textarea` 自动增高 effect 叠加时，可能让光标问题更稳定复现。

## 3.3 低风险

### E. 模板插入时的手动选区恢复

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`467-483`
- 风险等级：**低风险**

它会在点击“标题/列表/引用块”等工具栏按钮时手动设置 selection：

```js
const start = textarea.selectionStart || 0;
const end = textarea.selectionEnd || 0;
...
requestAnimationFrame(() => {
  textarea.focus();
  const cursor = start + template.length;
  textarea.setSelectionRange(cursor, cursor);
});
```

这与“按 Enter”不是同一路径。

### F. IME composition 事件

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`614-644`
- 风险等级：**低风险到中风险**

它只记录 composition 开始/结束，没有在 composition 期间暂停 auto-resize 或暂停 selection 恢复。

如果问题只在中文输入法候选确认时触发，这个风险会提高；当前证据不足。

### G. 阅读页 `window.getSelection()` / `Range`

- 文件：`frontend/src/components/senseArticle/SenseArticlePage.js`
- 位置：`67-95`, `286-299`
- 风险等级：**低风险**

关键代码：

```js
// frontend/src/components/senseArticle/SenseArticlePage.js:67-95
const buildSelectionAnchor = () => {
  const selection = window.getSelection();
  ...
  const range = selection.getRangeAt(0);
  ...
};
```

这段只在阅读页用于“选段修订”发起，不参与编辑页正文输入。

## 3.4 本次检索到“没有命中/与正文 Enter 无直接关系”的关键词

在 `frontend/src/components/senseArticle/` 里，对正文编辑链路未发现以下实现：

- `onKeyPress`
- `onKeyUp`
- `onInput`
- `onBeforeInput`
- `autoFocus`
- `contentEditable`
- `dangerouslySetInnerHTML`
- `innerHTML`
- `execCommand`
- `setRangeText`

这意味着当前 bug **不是 contenteditable 或富文本 Range 恢复错误**，而是更像 textarea 受控/自动增高链路的问题。

# 4. 文本状态更新与重渲染链路

## 4.1 编辑器内容是受控组件还是非受控组件？

**受控组件。**

- full 模式：`value={source}` + `setSource(event.target.value)`
- scoped 模式：`value={scopedText}` + `setScopedText(event.target.value)`

## 4.2 输入回车时，状态更新链路是什么？

### 整页编辑（`sourceMode === 'full'`）

`keydown Enter -> 浏览器默认在 textarea 中插入 "\n" -> React onChange -> setSource(newValue) -> SenseArticleEditor 整体 rerender -> useEffect([source, scopedText]) 检查 scrollHeight/clientHeight -> 可能改 textarea.height + requestAnimationFrame(setSelectionRange + scrollBy) -> previewState 置 stale -> 1 秒后 previewSource 更新并重新 parse`

### 局部编辑（`sourceMode === 'section' / 'selection'`）

`keydown Enter -> 浏览器默认在 scoped textarea 中插入 "\n" -> onChange -> setScopedText(newValue) -> SenseArticleEditor rerender -> buildScopedRevisionState / effectiveSource 重新推导全文 -> useEffect([source, scopedText]) 触发同一套 auto-resize -> previewState 置 stale -> 1 秒后重新 parse 全文预览`

## 4.3 是否存在每次输入都 setState 后重新生成整段 DOM？

结论：

- **会整体 rerender `SenseArticleEditor` 组件**
- 但**没有证据表明 textarea 本身每次输入都 remount**
- 预览 DOM 会在 `previewSource` 更新后重新解析/渲染

## 4.4 是否存在动态 key 导致 remount？

对 textarea 本身：

- **没有**

对页面级 ErrorBoundary：

- 有 `resetKey`
- 但它只依赖 `view/nodeId/senseId/revisionId`
- **不依赖输入中的 `source/scopedText`**

所以正常输入时**没有证据**表明会因 key 变化 remount 编辑器。

## 4.5 是否存在父组件刷新导致编辑器子树卸载重建？

正常输入链路里：

- `App.js` 的 `view === "senseArticleEditor"` 条件不会因输入变化改变
- `patchSenseArticleContext()` 只在 detail / save / submit 等链路里有意义
- **没有证据显示每个字符输入都会让父层卸载重建**

相关代码：

```js
// frontend/src/App.js:630-639
const patchSenseArticleContext = useCallback((patch = {}) => {
  setSenseArticleContext((prev) => {
    const next = buildSenseArticleContext(patch, prev);
    return areSenseArticleContextsEqual(prev, next) ? prev : next;
  });
}, [buildSenseArticleContext]);

const navigateSenseArticleSubView = useCallback((nextView, patch = {}, options = {}) => {
  setSenseArticleContext((prev) => buildSenseArticleSubViewContext(prev, view, patch, options));
  setView(nextView);
}, [view]);
```

## 4.6 是否存在根据文本内容重新 split/join、重新分页、重新计算行号、重新生成 block？

存在，但主要发生在以下两层：

- **预览层**：`parseSenseArticleSource()` 会对 `previewSource` 按 `\n` 解析成 AST blocks
- **scoped 层**：`buildScopedRevisionScope()` / `composeSource()` 会基于字符串切片重建全文

这两层都不是分页或虚拟列表，只是字符串解析/拼接。

## 4.7 是否存在异步格式化/清洗文本后再回填 value？

**没有发现 Enter 后立即异步清洗正文并回填 textarea value 的逻辑。**

有的只有：

- 预览延迟刷新
- 手动保存/提交时把 payload 发给后端
- 初始加载/保存后重新设置 `source`

所以这不是“格式化器回写 value 导致 caret reset”那一路问题。

## 4.8 是否存在 useEffect 监听 value 后重新设定焦点/选区？

**存在，而且这是最关键证据。**

- `SenseArticleEditor.js:255-293`：监听 `[scopedText, source]` 后，执行 `setSelectionRange()`
- `SenseArticleEditor.js:296-300`：标题编辑时 `focus()/select()`，但不是正文路径

## 4.9 是否存在“保存后恢复光标”逻辑但恢复位置错误？

没有看到“保存后恢复光标”的专门逻辑。

真正存在的“恢复光标”逻辑只有两种：

- 自动增高 effect
- 插入模板按钮

其中与 Enter 直接相关的只有自动增高 effect。

# 5. 与分页 / 显示行 / 视觉换行相关的排查

## 5.1 是否存在页面分页、纸张模拟、印刷预览、固定宽度排版？

结论：

- **没有分页**
- **没有纸张模拟**
- **没有手工换页符**
- **没有多栏正文**
- **有固定布局宽度约束**：编辑页是两栏 grid，正文 textarea 宽度由左侧 pane 决定，因此浏览器会发生软换行

证据：

```css
/* frontend/src/components/senseArticle/SenseArticle.css:147-157 */
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

## 5.2 是否存在“按显示行切分”的自定义逻辑？

**没有。**

代码里所有“行”的概念都基于真实 `\n`：

- `senseArticleScopedRevision.js:15-37`：`buildHeadingRows()` 用 `split('\n')`
- `senseArticleSyntax.js:171-298`：`parseSenseArticleSource()` 用 `split('\n')`

所以：

- 逻辑行 = 真实换行符分隔
- 视觉行 = textarea 在固定宽度下的浏览器软换行

本 bug 描述里的“第 5–15 行”，从代码角度看**更像视觉行**。

## 5.3 为什么说“第 5–15 行”更像视觉行，而不是逻辑行？

原因有 4 个：

- 正文输入只有一个 `textarea`，没有按行节点渲染。
- 连续文本在没有 `\n` 时，逻辑上仍是 1 行，但浏览器会在 textarea 中显示为多条视觉行。
- `textarea` 使用 `rows={1}`，但 CSS 给了 `min-height: 140px`；scoped 版本是 `min-height: 260px`。
- 自动增高 effect 只在 `scrollHeight > clientHeight` 时触发，这个阈值更接近“视觉行数量超过最小高度”。

关键样式：

```css
/* frontend/src/components/senseArticle/SenseArticle.css:250-264 */
.sense-editor-textarea,
.sense-editor-title-input,
.sense-proposer-note textarea,
.sense-review-comment,
.sense-selection-toolbar textarea {
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

```css
/* frontend/src/components/senseArticle/SenseArticle.css:979-980 */
.sense-editor-textarea.scoped {
  min-height: 260px;
}
```

推论：

- full 模式约在 5 到 7 个视觉行附近开始触发 auto-grow
- scoped 模式约在 11 到 14 个视觉行附近开始触发 auto-grow

这与用户描述的“第 5–15 行”区间**非常吻合**。

## 5.4 是否存在自动换行后又把内容重新映射成多行节点？

输入层没有。

预览层有 block 解析，但它基于真实 `\n`，不是基于视觉换行。

因此“前文连续文本”这句描述非常关键：

- 如果前文只是连续文本，没有真实换行，那 parser 仍把它当成一个段落字符串
- 但 textarea 里它已经显示成多条视觉行
- 用户在中间视觉行回车时，最容易命中的不是 block/分页逻辑，而是**textarea auto-grow 逻辑**

## 5.5 是否存在滚动同步、镜像层、覆盖层、隐藏输入框 + 显示层分离？

**没有。**

没有发现：

- mirror textarea
- overlay editor
- hidden input
- scroll sync 双层结构

编辑区是真实可见 textarea，不是“看起来像 textarea 的镜像层”。

# 6. DOM 结构与最小复现相关代码

## 6.1 容器层级结构

整页编辑时：

`div.sense-article-page.editor-mode`
-> `SenseArticlePageHeader`
-> `div.sense-editor-toolbar`
-> `div.sense-editor-layout`
-> `section.sense-editor-pane`
-> `textarea.sense-editor-textarea.auto-expand`

局部编辑时：

`div.sense-article-page.editor-mode`
-> `SenseArticlePageHeader`
-> `div.sense-editor-toolbar`
-> `div.sense-editor-layout`
-> `section.sense-editor-pane`
-> `textarea.sense-editor-textarea.scoped.auto-expand`

关键 JSX：

```jsx
// frontend/src/components/senseArticle/SenseArticleEditor.js:717-847
return (
  <div className="sense-article-page editor-mode" style={pageThemeStyle}>
    <SenseArticlePageHeader ... />
    <div className="sense-editor-toolbar productized">...</div>
    <div className="sense-editor-layout">
      <section className="sense-editor-pane">
        ...
        {scopedState.isScoped ? (
          <textarea className="sense-editor-textarea scoped auto-expand" ... rows={1} />
        ) : (
          <textarea className="sense-editor-textarea auto-expand" ... rows={1} />
        )}
      </section>
      <section className="sense-editor-pane preview">
        <SenseArticleRenderer revision={previewRevision} />
      </section>
    </div>
  </div>
);
```

## 6.2 关键 className / style

高相关 class：

- `sense-article-page`
- `sense-editor-layout`
- `sense-editor-pane`
- `sense-editor-textarea`
- `sense-editor-textarea.auto-expand`
- `sense-editor-textarea.scoped`

高相关 style：

- `display: grid`
- `overflow: hidden`
- `resize: none`
- `min-height: 140px`
- `min-height: 260px`

## 6.3 与 white-space / overflow / position / display / flex / transform 等相关的 CSS

高相关：

```css
/* frontend/src/components/senseArticle/SenseArticle.css:147-157 */
.sense-editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
}

/* frontend/src/components/senseArticle/SenseArticle.css:250-264 */
.sense-editor-textarea {
  min-height: 140px;
  padding: 12px;
}

.sense-editor-textarea.auto-expand {
  overflow: hidden;
  resize: none;
}

/* frontend/src/components/senseArticle/SenseArticle.css:979-980 */
.sense-editor-textarea.scoped {
  min-height: 260px;
}
```

低相关：

- `transform: translateY(-100%)` 只用于阅读页的 `.sense-selection-toolbar`
- `position: absolute` 的 `.sense-reference-preview-card` 也只在阅读页
- 编辑页主输入容器上没有 `transform` / `scale` / `zoom`

## 6.4 是否有 absolute/fixed 覆盖层截获事件？

编辑页正文输入链路里，**没有发现覆盖在 textarea 上方的 absolute/fixed 层**。

阅读页有：

- `.sense-selection-toolbar`
- `.sense-reference-preview-card`

但它们不在 `SenseArticleEditor` 渲染树里。

## 6.5 是否有 transform 导致 selection/caret 异常的风险？

对编辑页正文输入本身：

- **没有明显 transform 风险**

检索到的 transform 主要是：

- 阅读页选区工具条的 `translateY(-100%)`
- 一些动画/spinner

没有命中编辑器 textarea 祖先链。

## 6.6 `white-space` 是否可能导致逻辑换行和显示换行不一致？

对正文 textarea：

- 没有自定义 `white-space`
- 因为它是原生 textarea，显示换行由浏览器原生软换行决定

对预览和痕迹框：

- `white-space: pre-wrap` 只用于非输入区，如 `.sense-tracked-change-box`

所以真正导致“逻辑行”和“显示行”不一致的不是 CSS 自定义，而是**原生 textarea 的软换行**。

# 7. 最可疑根因排序

## 1. `SenseArticleEditor` 的自动增高 effect 在 Enter 后直接操作高度、selection、window scroll

- 涉及文件与函数：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `useEffect([scopedText, source])`
- 触发机制：
  - Enter 默认插入换行
  - `onChange` 更新 `source/scopedText`
  - rerender 后 effect 发现 `scrollHeight > clientHeight`
  - 执行 `style.height = ...`、`setSelectionRange(...)`、`window.scrollBy(...)`
- 为什么会表现为“回车后跳到第一行最左侧”：
  - 这是唯一直接改正文选区的代码。
  - 一旦这里保存/恢复的选区、焦点状态或滚动补偿与浏览器内部状态不同步，最典型的用户体感就是 caret/视口瞬间回到顶部开头。
- 为什么会与“前文连续文本”“显示第5–15行中间位置”有关：
  - 连续文本会产生大量**视觉软换行**而非真实 `\n`。
  - 回车发生在中间视觉行时，更容易让 `scrollHeight` 刚好跨过 auto-grow 阈值。
  - `min-height: 140px / 260px` 对应的大致视觉行数，正好落在 5–15 行区间。
- 置信度：**高**

## 2. 编辑器被实现成 `rows={1}` 的受控 auto-grow textarea，bug 与“视觉行阈值”强耦合

- 涉及文件与函数：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/SenseArticle.css`
- 触发机制：
  - `rows={1}` + `min-height` + `overflow: hidden` + `resize: none`
  - 浏览器在固定宽度下做软换行
  - 一旦内容超过当前可见高度，就进入 JS 自动增高链路
- 为什么会表现为“回车后跳到第一行最左侧”：
  - 这套结构把输入问题从“逻辑行”变成了“视觉行 + 高度调整”问题。
  - 用户体感中的“第 5–15 行”并不是源码第 5–15 行，而是 textarea 视觉行。
- 为什么会与“前文连续文本”“显示第5–15行中间位置”有关：
  - 关系很强；连续文本最容易形成大量软换行，正好触发这套机制。
- 置信度：**高**

## 3. 正文输入每次都会触发受控 rerender，且预览链路会追加第二轮状态更新

- 涉及文件与函数：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `setSource` / `setScopedText`
  - `useEffect` 预览 stale 逻辑
- 触发机制：
  - Enter 后先 rerender editor
  - 随后 `previewState` 改为 stale
  - 之后可能又有预览解析更新
- 为什么会表现为“回车后跳到第一行最左侧”：
  - 单独看不足以解释“跳首行”
  - 但它会扩大 textarea DOM 状态与 effect 恢复选区之间的竞态窗口
- 为什么会与“前文连续文本”“显示第5–15行中间位置”有关：
  - 连续文本更容易让 rerender 后的布局计算和 wrap 重算变重
- 置信度：**中**

## 4. 如果复现在 scoped 编辑，`buildScopedRevisionState -> composeSource` 是 scoped-only 的额外复杂层

- 涉及文件与函数：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- 触发机制：
  - 局部编辑时，每次输入都会重算 scope / currentText / effectiveSource
- 为什么会表现为“回车后跳到第一行最左侧”：
  - 它不直接改 selection，但会让局部 textarea 与全文预览之间的派生链更复杂
  - 若问题只出现在“编辑本节/选段修订”，这一层就必须上升优先级
- 为什么会与“前文连续文本”“显示第5–15行中间位置”有关：
  - 与“连续文本”关联弱于 auto-grow；与“scoped 模式”关联更强
- 置信度：**中-低**

## 5. composition 期间没有暂停 auto-resize / 选区恢复

- 涉及文件与函数：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `handleBodyCompositionStart` / `handleBodyCompositionEnd`
- 触发机制：
  - 中文输入法下，Enter 既可能是插入换行，也可能先结束/确认 composition
  - 当前代码只记录 composition，不阻断 auto-grow effect
- 为什么会表现为“回车后跳到第一行最左侧”：
  - 如果问题只在中文输入法下高频，composition 与 selection restore 的时序可能放大异常
- 为什么会与“前文连续文本”“显示第5–15行中间位置”有关：
  - 关联一般；主要和输入法状态有关
- 置信度：**低**

# 8. 后续修复所需的补充信息清单

以下信息会显著提高后续精修成功率，但本报告先不设计修复方案：

- 需要确认复现入口：
  - 是“更新释义”的整页编辑，还是“编辑本节 / 选段修订”的 scoped 编辑
- 需要确认浏览器：
  - Chrome / Edge / Firefox / Safari 的具体版本
- 需要确认是否与输入法有关：
  - 中文 IME 开启时才出现，还是英文键盘也出现
- 需要一段最小复现文本样例：
  - 最好包含“前文连续文本、无真实换行”的原始输入样本
- 需要录屏：
  - 用来区分“逻辑光标真的回到 offset 0”还是“页面/textarea 视口跳到了顶部”
- 需要运行时观测：
  - Enter 前后的 `selectionStart`
  - Enter 前后的 `selectionEnd`
  - Enter 前后的 `document.activeElement`
  - Enter 前后的 `textarea.scrollTop`
  - Enter 前后的 `textarea.clientHeight` / `scrollHeight`
  - `requestAnimationFrame` 中恢复的选区值
- 需要确认异常触发条件：
  - 是否只在首次超过某个视觉行阈值时发生
  - 还是超过阈值后每次 Enter 都发生
- 需要确认是“光标跳首行”还是“页面视口跳到编辑框首行”：
  - 这两者最终修复点可能不同
- 需要控制台信息：
  - 是否有 React warning、selection 相关报错、输入法 composition 异常

# 9. 附录：检索清单

## 9.1 检索关键词

本次实际检索过的关键词包括：

- `释义`
- `修订`
- `编辑`
- `senseArticleEditor`
- `SenseArticleEditor`
- `onOpenEditor`
- `createDraft`
- `createFromSelection`
- `createFromHeading`
- `selectedRangeAnchor`
- `sourceMode`
- `revisionId`
- `onKeyDown`
- `onKeyPress`
- `onKeyUp`
- `onInput`
- `onBeforeInput`
- `onChange`
- `selectionStart`
- `selectionEnd`
- `setSelectionRange`
- `setRangeText`
- `document.getSelection`
- `window.getSelection`
- `Range`
- `caret`
- `cursor`
- `focus`
- `blur`
- `contentEditable`
- `dangerouslySetInnerHTML`
- `innerHTML`
- `execCommand`
- `preventDefault`
- `Enter`
- `NumpadEnter`
- `compositionstart`
- `compositionend`
- `onCompositionStart`
- `onCompositionEnd`
- `autoFocus`
- `white-space`
- `overflow`
- `position`
- `display`
- `flex`
- `transform`
- `zoom`
- `scale`
- `writing-mode`
- `unicode-bidi`
- `direction`
- `virtual`
- `pagination`
- `page-break`
- `overlay`
- `mirror`
- `hidden input`

## 9.2 重点查看过的文件

- `frontend/src/App.js`
- `frontend/src/utils/senseArticleApi.js`
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/components/senseArticle/SenseArticleErrorBoundary.js`
- `frontend/src/components/senseArticle/senseArticleNavigation.js`
- `frontend/src/utils/senseArticleSyntax.js`
- `frontend/package.json`
- `frontend/src/index.css`

## 9.3 判定为无关或弱相关、但已看过的文件

- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
  - 历史列表，不承载正文编辑
- `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
  - 管理页，不承载正文编辑
- `frontend/src/components/senseArticle/SenseArticleErrorBoundary.js`
  - 只在报错时按 `resetKey` 复位，不参与正常输入
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
  - 预览/阅读渲染层，不是输入层
- `frontend/src/components/senseArticle/SenseArticlePage.js`
  - `window.getSelection()` 仅用于阅读页选段修订入口，不处理正文输入 caret

## 9.4 本轮审计收敛后的最可疑文件

按当前证据，后续修复优先级应聚焦：

1. `frontend/src/components/senseArticle/SenseArticleEditor.js`
2. `frontend/src/components/senseArticle/SenseArticle.css`
3. `frontend/src/components/senseArticle/senseArticleScopedRevision.js`（仅当 scoped 编辑同样复现时）
