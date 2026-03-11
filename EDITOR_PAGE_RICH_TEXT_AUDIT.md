# 百科编辑页富文本改造前置审计报告

## 1. 目标页面定位
### 1.1 路由入口
- 代码明确：当前项目没有使用 React Router 之类的 URL 路由切换百科页；实际入口是 `frontend/src/App.js` 里的 `view` 状态分支。`SenseArticlePage` / `SenseArticleEditor` / `SenseArticleReviewPage` / `SenseArticleHistoryPage` / `SenseArticleDashboardPage` 都是在 `view === "senseArticle*"` 时直接挂载，见 `frontend/src/App.js:6560-6679`。
- 代码明确：百科阅读页入口是 `openSenseArticleView()`，它调用 `buildSenseArticleNavigationState()` 组装 `senseArticleContext`，再执行 `setView(options.view || 'senseArticle')`，见 `frontend/src/App.js:5579-5594`，上下文字段定义见 `frontend/src/components/senseArticle/senseArticleNavigation.js:17-36`。
- 代码明确：从节点详情进入百科页时，`openSenseArticleFromNode()` 会先用 `getNodeSenseArticleTarget()` 解析 `nodeId/senseId`，再调用 `openSenseArticleView()`，见 `frontend/src/App.js:176-195`、`frontend/src/App.js:5596-5603`。
- 代码明确：编辑页真实挂载条件是 `view === "senseArticleEditor"` 且 `senseArticleContext.nodeId/senseId/revisionId` 都存在，见 `frontend/src/App.js:6579-6598`。

### 1.2 页面组件
- 主阅读页：`frontend/src/components/senseArticle/SenseArticlePage.js`
- 主编辑页：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 审阅页：`frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- 历史页：`frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- 词条管理页：`frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
- 公共头部：`frontend/src/components/senseArticle/SenseArticlePageHeader.js`
- 预览渲染器：`frontend/src/components/senseArticle/SenseArticleRenderer.js`
- 预览包裹层：`frontend/src/components/senseArticle/SenseArticlePreviewPanel.js`
- 结论：真正的“百科编辑页 / 文章编辑页 / 词条编辑页”主路径是 `SenseArticleEditor`；阅读、审阅、历史、dashboard 都是同一套百科 revision 系统的子页面。

### 1.3 新建/编辑流程
- 代码明确：新建页和编辑页共用同一个组件 `SenseArticleEditor`；区别只在于传入的 `revisionId` 和后端创建 revision 的方式，见 `frontend/src/App.js:5648-5705`、`frontend/src/App.js:6585-6596`。
- 代码明确：从阅读页可进入编辑页的入口有 4 条。
  - 页头“更新释义”：`frontend/src/components/senseArticle/SenseArticlePage.js:592-596`
  - 目录里的“编辑本节”：`frontend/src/components/senseArticle/SenseArticlePage.js:617-621`
  - 选中文本后的“选段修订”：`frontend/src/components/senseArticle/SenseArticlePage.js:416-423`
  - “我的编辑”浮层里的“继续编辑”：`frontend/src/components/senseArticle/SenseArticlePage.js:483-497`
- 代码明确：`handleOpenSenseArticleEditor()` 会按不同模式创建或复用 revision。
  - 传 `revisionId`：直接切到既有 revision，`frontend/src/App.js:5654-5664`
  - `preferExisting`：先查可编辑 draft，再复用，`frontend/src/App.js:5666-5678`
  - `mode === 'selection'`：调用 `senseArticleApi.createFromSelection()`，`frontend/src/App.js:5680-5684`
  - `mode === 'heading'`：调用 `senseArticleApi.createFromHeading()`，`frontend/src/App.js:5685-5689`
  - 默认整页：调用 `senseArticleApi.createDraft()`，`frontend/src/App.js:5690-5693`
- 代码明确：当前上下文参数不来自 URL params/query，而是来自 `senseArticleContext`。核心字段包括 `nodeId`、`senseId`、`articleId`、`currentRevisionId`、`selectedRevisionId`、`revisionId`、`originView`、`returnTarget`、`breadcrumb` 等，见 `frontend/src/components/senseArticle/senseArticleNavigation.js:17-36`。

### 1.4 数据加载与保存入口
- 代码明确：阅读页加载调用 `senseArticleApi.getCurrent()` 和 `senseArticleApi.getReferences()`，见 `frontend/src/components/senseArticle/SenseArticlePage.js:139-198`。
- 代码明确：编辑页加载调用 `senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId)`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:150-206`。
- 代码明确：保存草稿按钮在 `SenseArticleEditor` 页头 actions 里，点击执行 `saveDraft()`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:787-805`、`frontend/src/components/senseArticle/SenseArticleEditor.js:585-623`。
- 代码明确：提交审核按钮同样在页头 actions 里，点击执行 `submit()`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:787-805`、`frontend/src/components/senseArticle/SenseArticleEditor.js:625-667`。
- 代码明确：编辑页没有独立“发布”按钮；发布动作在审阅页里通过“通过”按钮触发 `senseArticleApi.reviewRevision()`，最终由后端在全体审阅通过后发布，见 `frontend/src/components/senseArticle/SenseArticleReviewPage.js:143-154`、`frontend/src/components/senseArticle/SenseArticleReviewPage.js:250-257`、`backend/services/senseArticleService.js:1274-1367`。
- 代码明确：编辑页也没有独立“预览路由”；当前预览是同页右侧 `SenseArticlePreviewPanel`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:977-1010`、`frontend/src/components/senseArticle/SenseArticlePreviewPanel.js:4-7`。

## 2. 当前编辑器实现识别
### 2.1 编辑器技术路线判断
- 结论：当前编辑区域是“原生受控 `textarea` + 自定义轻量标记语法 + 自研 parser/render 预览”的混合实现，不是 contenteditable，也不是第三方富文本编辑器。
- 代码明确：正文输入 DOM 只有两个原生 `textarea`。
  - 整页修订：`frontend/src/components/senseArticle/SenseArticleEditor.js:948-949`
  - 局部修订：`frontend/src/components/senseArticle/SenseArticleEditor.js:945-946`
- 代码明确：工具栏按钮对文本的作用方式是读取 `textarea.selectionStart/selectionEnd`，拼接模板字符串，再 `setSource` / `setScopedText`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:510-526`。
- 代码明确：没有发现 `contentEditable`、`document.execCommand`、Quill/TipTap/Slate/Lexical/CKEditor/Draft.js/ProseMirror 等编辑器依赖。`frontend/package.json:5-11` 只有 `react`、`react-dom`、`lucide-react`、`socket.io-client`、`three` 等；全仓搜索 `contenteditable|execCommand|tiptap|slate|lexical|quill|ckeditor|draft-js|prosemirror` 未命中编辑器实现文件。
- 代码明确：前端预览依赖自研 parser `frontend/src/utils/senseArticleSyntax.js:171-299`，后端持久化时依赖另一份自研 parser `backend/services/senseArticleParser.js:272-558`。

### 2.2 核心文件与调用链
- 前端调用链：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/utils/senseArticleApi.js`
  - `frontend/src/utils/senseArticleSyntax.js`
  - `frontend/src/components/senseArticle/SenseArticlePreviewPanel.js`
  - `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- 后端调用链：
  - `backend/routes/senseArticles.js`
  - `backend/services/senseArticleService.js`
  - `backend/services/senseArticleParser.js`
  - `backend/services/senseArticleSerializer.js`
  - `backend/models/SenseArticleRevision.js`
  - `backend/models/SenseArticle.js`
  - `backend/models/NodeSense.js`
- 代码明确：保存时后端会走 `materializeRevisionPayload()`，先 parse，再解析引用，再生成 `diffFromBase`，见 `backend/services/senseArticleService.js:549-590`。

### 2.3 编辑行为触发机制
- 代码明确：正文输入事件流是 `onChange -> setSource/setScopedText -> effectiveSource 变化 -> previewState 标脏 -> 1 秒后自动 refreshPreview -> parseSenseArticleSource -> 右侧预览重渲染`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:338-394`。
- 代码明确：超过 `8000` 字时自动预览刷新会暂停，需要手动点“刷新预览”，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:32-33`、`frontend/src/components/senseArticle/SenseArticleEditor.js:345-356`。
- 代码明确：插入按钮不会操作 DOM Range；它们只操作 textarea 的字符区间，并在 `requestAnimationFrame` 里恢复光标和滚动位置，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:493-526`。
- 代码明确：阅读页“选段修订”才会用 `window.getSelection()` / `Range.getBoundingClientRect()` 捕获选区锚点，但那是“发起 revision”的入口，不是正文编辑内核，见 `frontend/src/components/senseArticle/SenseArticlePage.js:67-102`。
- 代码明确：局部修订不是编辑 AST 节点，而是先用 `buildScopedRevisionScope()` / `buildScopedRevisionState()` 在字符串层面定位 section/selection，再把局部文本拼回整页源码，见 `frontend/src/components/senseArticle/senseArticleScopedRevision.js:135-299`。

### 2.4 当前实现的主要局限
- 代码明确：当前内容模型是自定义 DSL，不是 HTML/CSS 富文本模型；`SenseArticleRenderer` 只认识 `heading`、`paragraph`、`list`、`blockquote`、`code_block`、`formula_block`、`strong`、`emphasis`、`code_inline`、`symbol`、`sense_reference`，见 `frontend/src/utils/senseArticleSyntax.js:1-17`、`frontend/src/components/senseArticle/SenseArticleRenderer.js:113-179`。
- 代码明确：标题只支持解析 `#` 到 `###`；前后端 parser 都是 `^(#{1,3})`，renderer 也把 heading tag 限制在 `h1-h3`，见 `frontend/src/utils/senseArticleSyntax.js:203-214`、`backend/services/senseArticleParser.js:342-375`、`frontend/src/components/senseArticle/SenseArticleRenderer.js:116-121`。
- 代码明确：当前支持的粗体/斜体/inline code/inline formula 都只能靠手写语法，没有对应按钮，见 `frontend/src/utils/senseArticleSyntax.js:135-138`、`frontend/src/components/senseArticle/SenseArticleRenderer.js:41-45`。
- 代码明确：提交审核前不会因 parse error 被阻止；parse error 会显示在编辑页底部，但 `submit()` 仍直接 `updateDraft -> submitRevision`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:625-667`、`frontend/src/components/senseArticle/SenseArticleEditor.js:955-960`。
- 代码明确：前后端各有一份 parser，实现细节不完全相同；后续加语法时必须双改，否则预览与保存结果可能分叉。

## 3. 当前工具栏逐项盘点
### 3.1 按钮列表总览
- 编辑页实际上有 3 组“工具栏/控制条”。
  - 页头动作条：`SenseArticlePageHeader` actions，负责词条管理 / 放弃修订 / 保存草稿 / 提交审核。
  - 正文插入工具条：`.sense-editor-toolbar.productized.sticky`，负责插入模板、打开帮助/引用辅助面板。
  - 预览控制条：`.sense-editor-preview-topbar`，负责刷新预览、收起/展开预览。

### 3.2 每个按钮的真实行为
- `词条管理`
  - 图标来源：`Sparkles`，`frontend/src/components/senseArticle/SenseArticleEditor.js:2`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:789-793`
  - 行为：调用 `onOpenDashboard`，切到 `senseArticleDashboard`
  - 是否生效：生效
- `放弃修订`
  - 图标来源：`Trash2`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:794-797`
  - 行为：`senseArticleApi.deleteDraft()` 删除当前 draft，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:702-715`
  - 是否生效：生效
- `保存草稿`
  - 图标来源：`Save`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:799-800`
  - 行为：`buildDraftPayload() -> senseArticleApi.updateDraft()`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:549-623`
  - 是否生效：生效
- `提交审核`
  - 图标来源：`Send`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:802-803`
  - 行为：先 `updateDraft()`，再 `submitRevision()`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:625-667`
  - 是否生效：生效
- `插入标题`
  - 图标来源：无
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:865-883`
  - 行为：切换 `openInsertMenu === 'heading'`
  - 是否生效：生效
- `一级标题`
  - 图标来源：无
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:871-880`
  - 行为：插入 `\n# 一级标题\n`
  - 是否生效：生效
- `二级标题`
  - 位置：同上
  - 行为：插入 `\n## 二级标题\n`
  - 是否生效：生效
- `三级标题`
  - 位置：同上
  - 行为：插入 `\n### 三级标题\n`
  - 是否生效：生效
- `四级标题`
  - 位置：同上
  - 行为：插入 `\n#### 四级标题\n`
  - 是否生效：逻辑上只会插入文本，但当前前后端 parser 都不识别 `####` 为 heading，renderer 也只渲染到 `h3`；属于“UI 有，语义支持不完整”
- `插入列表`
  - 图标来源：`List`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:885-903`
  - 行为：切换 `openInsertMenu === 'bulletList'`
  - 是否生效：生效
- `圆点列表`
  - 行为：插入 `\n- 条目一\n- 条目二\n`
  - 是否生效：生效
- `星标列表`
  - 行为：插入 `\n* 条目一\n* 条目二\n`
  - 是否生效：生效
- `待办清单`
  - 行为：插入 `\n- [ ] 待办一\n- [ ] 待办二\n`
  - 是否生效：只是在正文中插入文本；当前 parser 没有 task-list AST，renderer 也只渲染普通 `<ul><li>`，所以“视觉/交互级任务列表”未实现
- `插入有序列表`
  - 图标来源：`ListOrdered`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:905-923`
  - 行为：切换 `openInsertMenu === 'orderedList'`
  - 是否生效：生效
- `数字列表`
  - 行为：插入 `\n1. 第一点\n2. 第二点\n`
  - 是否生效：生效
- `双位编号`
  - 行为：插入 `\n01. 第一点\n02. 第二点\n`
  - 是否生效：生效
- `步骤列表`
  - 行为：插入 `\n1. 步骤一\n2. 步骤二\n`
  - 是否生效：生效
- `插入引用块`
  - 图标来源：`Quote`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:925`
  - 行为：插入 `\n> 引用块内容\n`
  - 是否生效：生效
- `插入引用`
  - 图标来源：`Link2`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:926`
  - 行为：切换 `showReferencePicker`，打开上方辅助面板；真正插入时会生成 `[[sense:nodeId:senseId|显示文本]]`，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:541-547`
  - 是否生效：生效，但它不是通用超链接，只支持内部词条引用
- `插入公式`
  - 图标来源：`Sigma`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:927`
  - 行为：插入 block formula 模板 `$$ ... $$`
  - 是否生效：生效
- `插入符号`
  - 图标来源：无
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:928`
  - 行为：插入示例符号 `:alpha:`
  - 是否生效：生效，但只是插入一个示例 shortcode，没有符号面板
- `插入语法帮助`
  - 图标来源：`BookOpen`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:929`
  - 行为：切换 `showHelp`，展示帮助面板
  - 是否生效：生效，但它不“插入”正文，只是展示帮助；按钮文案带有误导性
- `查看修订痕迹 / 刷新修订痕迹`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:936-944`
  - 行为：仅在 scoped revision 下，调用 `buildTrackedChangeTokens()` 做局部 diff
  - 是否生效：生效
- `刷新预览`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:983-991`
  - 行为：调用 `handleManualPreviewRefresh()`
  - 是否生效：生效
- `展开/收起`
  - 位置：`frontend/src/components/senseArticle/SenseArticleEditor.js:992-1004`
  - 行为：调用 `togglePreviewCollapsed()`
  - 是否生效：生效

### 3.3 已实现能力
- 结构型模板插入：标题、无序/有序列表、引用块、公式、内部词条引用、符号 shortcode。
- 手写语法支持：粗体 `**`、斜体 `*`、inline code `` ` ``、inline formula `$...$`、code block ```、symbol shortcode、内部词条引用 token，见 `frontend/src/utils/senseArticleSyntax.js:87-155`。
- 局部修订：支持“整页 / 本节 / 选段”三种 revision source mode，见 `backend/constants/senseArticle.js:31-32`、`frontend/src/components/senseArticle/senseArticleScopedRevision.js:135-239`。
- 右侧全文预览、预览自动刷新、预览折叠、拖拽调整宽度。
- 解析错误展示、结构化版本对比、历史版本、多人审阅流。

### 3.4 缺失能力
- 未找到：文字大小、字体、粗体/斜体/下划线/删除线按钮
- 未找到：颜色、背景色、行高、段前段后、缩进、对齐、清除格式
- 未找到：表格插入与表格样式
- 未找到：分割线按钮
- 未找到：外部链接、锚点、脚注
- 未找到：图片、音频、视频、文件上传
- 未找到：撤销/重做
- 未找到：自动保存
- 未找到：真正的所见即所得编辑

### 3.5 UI 已有但逻辑不完整的部分
- `四级标题`：按钮存在，但 parser/render 只支持到 `h3`。
- `待办清单`：按钮会插入 `- [ ]` 文本，但没有 task-list schema、checkbox 状态和交互。
- `插入语法帮助`：按钮名像“插入”，实际只是展开帮助卡片。
- `updateMetadata` API 方法仍保留在 `frontend/src/utils/senseArticleApi.js:206-210`，但后端 `updateSenseMetadata()` 已直接返回 409，且当前编辑页完全不调用它，见 `backend/services/senseArticleService.js:793-795`。

## 4. 内容数据流与存储格式
### 4.1 前端状态结构
- 代码明确：编辑页正文相关 state 主要在 `SenseArticleEditor` 内部。
  - `source`：整页源码字符串，`frontend/src/components/senseArticle/SenseArticleEditor.js:100`
  - `scopedText`：局部修订可编辑文本，`frontend/src/components/senseArticle/SenseArticleEditor.js:101`
  - `revisionTitle`、`note`、`senseTitle`：`frontend/src/components/senseArticle/SenseArticleEditor.js:102-105`
  - `previewSource`、`previewState`：`frontend/src/components/senseArticle/SenseArticleEditor.js:117-118`
  - `lastSavedState`：保存态快照，`frontend/src/components/senseArticle/SenseArticleEditor.js:126`
  - `trackedDiffState`：局部修订痕迹显示态，`frontend/src/components/senseArticle/SenseArticleEditor.js:119-125`
- 代码明确：真正提交的正文是 `effectiveSource`，即整页时直接等于 `source`，局部修订时由 `composeSource(scopedText)` 拼回整页源码，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:247-261`。
- 代码明确：全局导航上下文是 `senseArticleContext`，字段定义见 `frontend/src/components/senseArticle/senseArticleNavigation.js:17-36`。

### 4.2 提交接口
- 阅读页数据：
  - `GET /api/sense-articles/:nodeId/:senseId/current`，`frontend/src/utils/senseArticleApi.js:192`
  - `GET /api/sense-articles/:nodeId/:senseId/references`，`frontend/src/utils/senseArticleApi.js:238`
- revision 编辑流：
  - `GET /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`，`frontend/src/utils/senseArticleApi.js:201-205`
  - `POST /api/sense-articles/:nodeId/:senseId/revisions/draft`，`frontend/src/utils/senseArticleApi.js:212`
  - `POST /api/sense-articles/:nodeId/:senseId/revisions/from-selection`，`frontend/src/utils/senseArticleApi.js:213`
  - `POST /api/sense-articles/:nodeId/:senseId/revisions/from-heading`，`frontend/src/utils/senseArticleApi.js:214`
  - `PUT /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`，`frontend/src/utils/senseArticleApi.js:215-219`
  - `DELETE /api/sense-articles/:nodeId/:senseId/revisions/:revisionId`，`frontend/src/utils/senseArticleApi.js:220-224`
  - `POST /api/sense-articles/:nodeId/:senseId/revisions/:revisionId/submit`，`frontend/src/utils/senseArticleApi.js:225-229`
- 当前编辑页保存 payload 关键字段：
  - `editorSource`
  - `revisionTitle`
  - `proposedSenseTitle`
  - `proposerNote`
  - `scopedChange`（局部修订时）
  - 见 `frontend/src/components/senseArticle/SenseArticleEditor.js:549-583`

### 4.3 后端处理链
- 路由挂载：`backend/server.js:87-94`
- 路由定义：`backend/routes/senseArticles.js:69-397`
- 核心处理链：
  - `createDraftRevision()`：`backend/services/senseArticleService.js:797-880`
  - `updateDraftRevision()`：`backend/services/senseArticleService.js:882-954`
  - `submitRevision()`：`backend/services/senseArticleService.js:1012-1089`
  - `reviewRevision()`：`backend/services/senseArticleService.js:1140-1369`
  - `materializeRevisionPayload()`：`backend/services/senseArticleService.js:549-590`
- 代码明确：保存正文时后端会把 `editorSource` 解析成 `ast`、`headingIndex`、`referenceIndex`、`formulaRefs`、`symbolRefs`、`plainTextSnapshot`、`renderSnapshot`、`diffFromBase`，再写入 revision，见 `backend/services/senseArticleService.js:892-911`。
- 代码明确：发布时后端会更新 `SenseArticle.currentRevisionId`，并把发布版正文同步回 legacy `NodeSense.content`，见 `backend/services/senseArticleService.js:1276-1287`、`backend/services/senseArticleService.js:1352-1359`。

### 4.4 数据库存储
- `SenseArticleRevision`：真正的 revision 正文表，见 `backend/models/SenseArticleRevision.js:107-306`
  - 关键字段：`sourceMode`、`selectedRangeAnchor`、`targetHeadingId`、`editorSource`、`ast`、`headingIndex`、`referenceIndex`、`formulaRefs`、`symbolRefs`、`parseErrors`、`plainTextSnapshot`、`renderSnapshot`、`diffFromBase`、`scopedChange`、`revisionTitle`、`proposedSenseTitle`、`status`
- `SenseArticle`：词条级汇总，见 `backend/models/SenseArticle.js:8-72`
  - 关键字段：`currentRevisionId`、`latestDraftRevisionId`、`summary`、`publishedAt`
- `NodeSense`：legacy 镜像，见 `backend/models/NodeSense.js:3-64`
  - 关键字段：`title`、`content`、`legacySummary`
- 代码明确：`editorSource` 和 `NodeSense.content` 都是 `String + trim: true`，见 `backend/models/SenseArticleRevision.js:152-156`、`backend/models/NodeSense.js:19-23`。这意味着当前体系本质上仍围绕“源码字符串”运转。

### 4.5 内容安全与清洗
- 代码明确：未找到 `DOMPurify`、`sanitize`、`xss`、`dangerouslySetInnerHTML`、HTML whitelist 等显式清洗链路；全仓搜索这些关键字未命中 senseArticle 相关代码。
- 代码明确：当前前端渲染主要依赖 React JSX 文本节点，不直接拼 raw HTML，见 `frontend/src/components/senseArticle/SenseArticleRenderer.js:40-67`、`frontend/src/components/senseArticle/SenseArticleRenderer.js:133-177`。这是当前体系降低 XSS 面的主要原因。
- 代码明确：内部引用目标会在后端做解析和有效性标记，见 `backend/services/senseArticleService.js:408-465`。
- 代码明确：服务器请求体限制是 `10mb`，见 `backend/server.js:84-85`；前端对 413 做了专门错误文案，见 `frontend/src/utils/senseArticleApi.js:65-71`。
- 代码明确：存在版本历史、草稿、多人审阅、比较能力。
  - 草稿：`SenseArticle.latestDraftRevisionId`、`SenseArticleRevision.status = draft`
  - 历史：`SenseArticleHistoryPage`
  - 结构化对比：`SenseArticleComparePanel` + `useSenseArticleCompare`
- 未找到：自动保存
- 未找到：撤销/重做

## 5. 多媒体能力排查
### 5.1 图片
- 代码明确：当前正文 parser/render 未定义图片节点，`AST_NODE_TYPES` 里没有 `image`，见 `frontend/src/utils/senseArticleSyntax.js:1-17`、`backend/constants/senseArticle.js:7-23`。
- 未找到：正文插图插入按钮、图片块语法、图片节点 renderer、图片上传接口。
- 说明：阅读页和审阅页里的 `<img>` 仅用于头像展示，不属于正文媒体能力，见 `frontend/src/components/senseArticle/SenseArticlePage.js:564-572`、`frontend/src/components/senseArticle/SenseArticleReviewPage.js:205-209`。

### 5.2 音频
- 未找到：正文音频节点、音频上传、音频播放器、音频字段。

### 5.3 视频
- 未找到：正文视频节点、视频上传、视频播放器、视频字段。

### 5.4 上传与资源管理
- 基于全仓搜索结论：未找到与百科正文相关的 `type="file"`、`FormData`、`multipart/form-data`、`upload` 路由、资源库 model、拖拽上传、粘贴上传实现。
- 代码明确：当前“插入引用”能力其实是内部词条引用搜索，不是资源上传。前端调 `searchReferenceTargets()`，后端在 `NodeSense` / `SenseArticleRevision` / `SenseArticle` 上做模糊检索，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:413-547`、`backend/services/senseArticleService.js:1476-1523`。
- 代码明确：当前最接近“资源管理”的只有引用目标解析和预览，不是媒体资产系统，见 `backend/services/senseArticleService.js:408-465`。

### 5.5 当前短板
- 未找到现成上传基础设施。
- 未找到正文媒体 schema。
- 未找到裁剪、尺寸、对齐、标题、alt、懒加载、封面图等媒体属性。
- 当前内容模型无法表达“正文中的图片/音频/视频块”，除非重写 parser/render/schema。

## 6. 页面布局与工具栏固定可行性
### 6.1 页面滚动模型
- 代码明确：编辑页最外层是 `.game-container > .game-content > .sense-article-page`，见 `frontend/src/App.js:6176-6186`、`frontend/src/components/senseArticle/SenseArticleEditor.js:773-775`。
- 代码明确：`.game-container`、`.game-content`、`.sense-article-page`、`.sense-editor-layout` 都没有把主编辑区变成独立滚动容器；主滚动仍是 window，见 `frontend/src/App.css:91-103`、`frontend/src/components/senseArticle/SenseArticle.css:1-45`、`frontend/src/components/senseArticle/SenseArticle.css:154-177`。
- 代码明确：编辑正文 `textarea` 自身是 auto-expand 的，`overflow: hidden; resize: none;`，不是内部滚动，见 `frontend/src/components/senseArticle/SenseArticle.css:269-283`。

### 6.2 顶部布局占用
- 代码明确：全局头部 `.header` 存在于所有页面内容之前，见 `frontend/src/App.js:6184-6387`。
- 代码明确：默认 `.header` 只是 `position: relative`，不是固定头；只有 `knowledge-domain-active` 模式下才 sticky 到 `top: 0`，见 `frontend/src/App.css:106-120`、`frontend/src/App.css:147-151`。
- 代码明确：百科页自己的 `SenseArticlePageHeader` 只是普通流内块级顶部条，不 sticky/fixed，见 `frontend/src/components/senseArticle/SenseArticlePageHeader.js:23-43`。
- 推断：对当前百科编辑主路径来说，最大的顶部避让对象不是全局 fixed header，而是未来如果把百科页 header 也做 sticky 后产生的叠加高度；当前代码里这个问题尚未出现。

### 6.3 工具栏当前层级
- 代码明确：编辑页 JSX 结构是：
  - `div.sense-article-page.editor-mode`
  - `SenseArticlePageHeader`
  - `div.sense-editor-helper-grid`（条件渲染）
  - `div.sense-editor-layout.resizable`
  - `section.sense-editor-pane.editor-primary`
  - `div.sense-editor-toolbar.productized.sticky`
  - `textarea.sense-editor-textarea*`
  - `section.sense-editor-pane.preview`
  - `div.sense-editor-preview-topbar`
  - 见 `frontend/src/components/senseArticle/SenseArticleEditor.js:773-1014`
- 代码明确：当前主插入工具栏在左侧编辑 pane 里，不在整页顶层；它位于 pane title / 释义标题输入之后、正文 textarea 之前，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:856-930`。

### 6.4 sticky/fixed 的障碍点
- 代码明确：当前主插入工具栏已是 `position: sticky; top: 12px; z-index: 6; overflow: visible;`，见 `frontend/src/components/senseArticle/SenseArticle.css:808-821`。
- 代码明确：预览顶栏也是 sticky，但用的是另一套 offset 变量 `--sense-editor-sticky-top`，见 `frontend/src/components/senseArticle/SenseArticle.css:39`、`frontend/src/components/senseArticle/SenseArticle.css:1017-1021`。当前两个 sticky top 并不统一。
- 代码明确：当前工具栏父链上没有明显的 `overflow: hidden/auto/scroll`、`transform`、`contain` 会直接破坏 sticky；这也是当前 sticky 能工作的原因。
- 代码明确：`helper grid` 在工具栏上方且是普通流内元素，见 `frontend/src/components/senseArticle/SenseArticleEditor.js:809-849`。这意味着当前工具栏不是“页面最上方第一行”，而是“滚过 helper grid 后才吸顶”。
- 代码明确：当前页面跳 heading / search match 使用 `scrollIntoView({ block: 'start' | 'center' })`，但全仓未找到 `scroll-margin-top` / `scroll-padding-top`，见 `frontend/src/components/senseArticle/SenseArticlePage.js:320-365`。如果未来工具栏变高或变 fixed，目录跳转/搜索跳转很容易被遮住。
- 代码明确：当前 z-index 大致如下。
  - 全局 header：`z-index: 2`，`frontend/src/App.css:106-110`
  - 编辑主工具栏：`z-index: 6`，`frontend/src/components/senseArticle/SenseArticle.css:814-817`
  - 阅读页选区气泡：`z-index: 10`，`frontend/src/components/senseArticle/SenseArticle.css:408-419`
  - 引用预览卡：`z-index: 11`，`frontend/src/components/senseArticle/SenseArticle.css:731-738`
  - 插入菜单 dropdown：`z-index: 12`，`frontend/src/components/senseArticle/SenseArticle.css:828-842`
  - “我的编辑”浮层：`z-index: 40`，`frontend/src/components/senseArticle/SenseArticle.css:758-776`
  - 通用 modal：`z-index: 1000`，`frontend/src/App.css:635-658`
- 代码明确：编辑器 dropdown / popover 不是 portal。
  - 插入菜单是普通流内 absolute：`frontend/src/components/senseArticle/SenseArticle.css:823-842`
  - 引用帮助/语法帮助是普通流内 helper grid：`frontend/src/components/senseArticle/SenseArticleEditor.js:809-849`
  - 阅读页选区工具条和引用预览卡也是普通流内 absolute，不是 portal：`frontend/src/components/senseArticle/SenseArticlePage.js:409-446`

### 6.5 可行方案对比
#### 方案候选 1：沿用当前左 pane 内 sticky，只升级 `.sense-editor-toolbar.productized`
- 涉及文件：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/SenseArticle.css`
- 优点：
  - 改动面最小
  - 继续保持“工具栏在正常文档流里”，天然不会盖住正文 textarea
  - 当前 sticky 已可工作，不需要改全局滚动模型
- 风险：
  - 左 pane 宽度受 split layout 限制，工具栏按钮一多会严重换行
  - helper grid 仍在工具栏上面，工具栏的视觉优先级不够高
  - 预览 pane 有另一套 sticky topbar，双顶部条会越来越分裂

#### 方案候选 2：把编辑工具栏提升为 `SenseArticlePageHeader` 下方、`sense-editor-layout` 上方的整行 sticky
- 涉及文件：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/SenseArticle.css`
  - `frontend/src/components/senseArticle/SenseArticlePageHeader.js`（如需联动 header 间距/视觉）
- 优点：
  - 宽度最大，最适合承载“更完整的在线长文工具栏”
  - 仍然可以保持 `position: sticky` + 正常文档流，不必 fixed
  - 更容易让 dropdown / drawer / helper panel 围绕统一工具栏组织
  - 最容易满足“吸顶但不遮正文”
- 风险：
  - 需要重排当前 helper grid 和 preview topbar 的位置关系
  - 需要统一 sticky offset、z-index 和移动端折叠策略
  - 需要补 `scroll-margin-top` / `scroll-padding-top`，避免未来 heading jump 被遮挡

#### 方案候选 3：做全局 fixed 工具栏，挂到 `game-content` 或更高层
- 涉及文件：
  - `frontend/src/App.js`
  - `frontend/src/App.css`
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/SenseArticle.css`
- 优点：
  - 固定效果最强，滚动时始终存在
  - 视觉上容易做成完整 Office-like 顶部带
- 风险：
  - 需要动态测量高度并给正文区域补 `padding-top` / 占位
  - 未来若全局 header 也变 sticky/fixed，会有 offset 叠加和 z-index 竞争
  - 现有 `scrollIntoView()`、active heading、textarea focus/scroll 恢复逻辑都要重新适配
  - 工程入侵面最大

### 6.6 推荐方案
- 推荐：方案候选 2。
- 原因：
  - 当前项目主滚动是 window，且编辑页没有强制局部滚动容器，做“流内 sticky 整行工具栏”最自然。
  - 当前最大短板不是 sticky 本身做不到，而是工具栏位置太靠左 pane、宽度太窄、上面还有 helper grid。
  - 把工具栏提升到 `SenseArticlePageHeader` 下方、`sense-editor-layout` 上方，可以继续利用 sticky 的“占位不遮挡”特性，不需要 fixed 覆盖补偿。
- 同时必须补的约束：
  - 统一工具栏与预览 topbar 的 `top` 变量
  - 给 heading / block 跳转补 `scroll-margin-top`
  - 把 helper panel 改成跟随工具栏的 overlay / drawer / panel，而不是继续放在工具栏前面

## 7. 依赖、组件与可复用资产
### 7.1 现有依赖分析
- UI 组件库：未找到 `antd` / `mui` / `radix` / `headlessui` / `chakra`；`frontend/package.json:5-11` 只有 `lucide-react` 可视作图标库。
- 编辑器库：未找到。
- 上传组件：未找到。
- Popover / dropdown / tooltip 组件库：未找到；当前都靠手写 absolute/fixed DOM。
- 拖拽库：未找到；预览宽度拖拽是 `pointer` 事件手写，见 `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js:247-349`。
- 表格相关库：未找到。
- 媒体预览库：未找到。
- 状态管理：未找到 Redux/Zustand/MobX；状态主要在 `App.js` 和组件内部 `useState/useEffect`。
- 表单库：未找到 React Hook Form / Formik。
- 样式方案：普通 CSS 文件，主要是 `frontend/src/components/senseArticle/SenseArticle.css`、`frontend/src/App.css`、`frontend/src/index.css`。

### 7.2 可复用组件
- `frontend/src/components/senseArticle/SenseArticlePageHeader.js`
  - 适合复用：百科子页面头部样式、返回逻辑、badge/meta/actions 槽位都已统一
  - 不适合直接复用：它不是 toolbar 容器，需要另建更复杂的 rich toolbar 行
- `frontend/src/components/senseArticle/SenseArticleStatusBadge.js`
  - 适合复用：revision/reference 状态 badge 已统一
  - 不适合直接复用：不承担按钮/命令状态
- `frontend/src/components/senseArticle/SenseArticleStateView.js`
  - 适合复用：空态/错误态/加载态统一
  - 不适合直接复用：与编辑器功能本身无关
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
  - 适合复用：双栏预览宽度拖拽、收起/展开、localStorage 持久化都已封装
  - 不适合直接复用：只管 split layout，不管 rich toolbar
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
  - 适合复用：如果继续沿用当前 DSL，可直接复用预览/阅读渲染层
  - 不适合直接复用：不支持表格、媒体、颜色、对齐、段落样式等目标能力
- `frontend/src/components/senseArticle/SenseArticleComparePanel.js` + `frontend/src/components/senseArticle/useSenseArticleCompare.js`
  - 适合复用：revision 对比 UI 和数据拉取现成
  - 不适合直接复用：底层 diff 仍依赖当前 AST/section 结构
- `frontend/src/components/senseArticle/senseArticleTheme.js`
  - 适合复用：编辑/阅读/审阅统一主题变量
  - 不适合直接复用：只处理视觉，不处理编辑能力
- `frontend/src/App.css` 中 `.modal-backdrop` / `.modal-content` 与现有 modal 组件（如 `frontend/src/components/modals/AssociationModal.js`）
  - 适合复用：媒体插入设置面板、更多设置抽屉/模态框可沿用现有 modal 样式体系
  - 不适合直接复用：没有 portal、focus trap、层级管理等高级弹层能力

### 7.3 不建议复用的部分
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - 原因：职责过重，已同时承担加载、保存、提交、局部修订、预览、布局、插入菜单、引用搜索、帮助面板、tracked diff
- `frontend/src/utils/senseArticleSyntax.js` 与 `backend/services/senseArticleParser.js`
  - 原因：当前 DSL 能力太窄，且双端重复实现，后续扩展成本高
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
  - 原因：渲染能力跟当前 DSL 紧耦合，不适合直接承接“完整长文富文本”
- `frontend/src/utils/senseArticleApi.js` 的 `updateMetadata()`
  - 原因：前端方法仍在，但后端已禁用
- 非运行时代码：
  - `frontend/build/**` 是编译产物，不应作为改造入口
  - `docs/sense-article-editor-*.md` 和仓库根目录历史审计 markdown 是说明文档，不是运行时代码；其中提到的 `.sense-editor-divider-toggle` 等类名已不在当前源码中，全仓 `rg` 只在 docs 里命中

### 7.4 增量改造 vs 整体替换判断
- 如果目标只是“保留当前 DSL，补齐更好用的插入按钮和布局”，当前更适合增量改造。理由是 revision workflow、路由、保存接口、审阅流、历史页、dashboard、对比能力都已经成熟。
- 但如果按本次目标清单完整落地：文字样式、颜色、背景色、对齐、段落控制、表格、图片/音频/视频、锚点/脚注、较完整工具栏，这已经超出当前 DSL 和 renderer 能力边界。
- 结论：就“你的目标清单”而言，更接近一次“整体替换编辑器内核 + 同步重构 parser/render/content model”的项目；可保留的是 revision 工作流壳层，而不是当前 textarea + DSL 内核。
- 整体替换时可优先保留：
  - `frontend/src/App.js` 的页面导航与 `senseArticleContext`
  - `frontend/src/components/senseArticle/SenseArticlePageHeader.js`
  - `frontend/src/components/senseArticle/SenseArticleStatusBadge.js`
  - `frontend/src/components/senseArticle/SenseArticleStateView.js`
  - `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
  - `backend/routes/senseArticles.js` 的 revision API 外壳
  - `backend/models/SenseArticle.js` / `backend/models/SenseArticleRevision.js` 的 revision 生命周期字段
- 整体替换时必须重点重构：
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/SenseArticleRenderer.js`
  - `frontend/src/utils/senseArticleSyntax.js`
  - `backend/services/senseArticleParser.js`
  - `backend/services/senseArticleService.js` 中 `materializeRevisionPayload()`、search/diff/reference 相关链路

## 8. 后续真正改造时的工程约束
### 8.1 数据兼容性约束
- 不能破坏现有 revision 工作流：`draft -> submit -> review -> published/superseded`
- 不能随意绕开现有保存接口：后端已经明确要求正文改走 `/api/sense-articles/:nodeId/:senseId/revisions`，旧直写路径被拒绝，见 `backend/routes/senses.js:132-145`、`backend/routes/nodes.js:4760-4766`
- 不能忽略 legacy 镜像：发布时会同步 `NodeSense.content`，见 `backend/services/senseArticleService.js:1352-1359`
- 不能破坏阅读页/历史页/审阅页对 `editorSource`、`ast`、`headingIndex`、`referenceIndex`、`plainTextSnapshot` 的依赖

### 8.2 布局与交互约束
- 不能让 sticky toolbar 遮住 textarea；当前最好继续使用“流内 sticky”而不是先上 fixed
- 不能忘记 `scrollIntoView` 的遮挡补偿；当前没有 `scroll-margin-top`
- 不能忽视移动端；当前 `<=1080px` 已切单列，预览 topbar sticky 被关闭，见 `frontend/src/components/senseArticle/SenseArticle.css:1145-1215`
- 不能破坏当前预览拖拽/收起逻辑及其 localStorage 状态，见 `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js:7-8`、`frontend/src/components/senseArticle/useSenseEditorPreviewPane.js:185-194`

### 8.3 安全与性能约束
- 不能引入 raw HTML 渲染而不补 sanitize；当前系统几乎没有显式清洗链路
- 不能忽视长文性能；当前 8000 字后已经暂停自动预览刷新，说明现实现已感受到长文压力
- 不能只改前端 parser；前后端双 parser 必须同步
- 不能忽视 10mb body limit；如果未来媒体走内嵌 base64，很快会撞到服务端限制

### 8.4 可维护性约束
- 不能继续把所有状态都堆进 `SenseArticleEditor`；否则会进一步恶化巨型组件问题
- 不能把新工具栏逻辑直接硬塞进当前模板插入代码；当前 `insertTemplate()` 只适合字符串模板，不适合富文本命令系统
- 不能把媒体插入、颜色面板、表格设置都做成“字符串模板 + textarea 光标拼接”；这条路线和目标能力不匹配

## 9. 给下一阶段代码改造 Prompt 提供的信息清单
- `frontend/src/App.js:5579-5705,6579-6598` 百科编辑页不是 URL route，而是 `view === "senseArticleEditor"` 的状态页。
- `frontend/src/components/senseArticle/senseArticleNavigation.js:17-36` 编辑页上下文来自 `senseArticleContext`，不是 URL params/query。
- `frontend/src/components/senseArticle/SenseArticlePage.js:592-596,617-621,416-423,491-493` 阅读页存在 4 个进入编辑页的入口：整页、章节、选段、继续编辑。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:946-949` 正文输入是原生 `textarea`，不是 contenteditable。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:510-526` 当前工具栏通过 `selectionStart/selectionEnd` 拼接字符串模板。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:338-394` 右侧预览是本地 parser 实时解析，不是后端预览接口。
- `frontend/src/utils/senseArticleSyntax.js:171-299` 前端预览 parser 是自研 DSL parser。
- `backend/services/senseArticleParser.js:272-558` 后端保存时还有另一份自研 parser，双端必须同步修改。
- `frontend/src/components/senseArticle/SenseArticleRenderer.js:113-179` 当前 renderer 只支持 heading/paragraph/list/blockquote/code/formula/reference 等有限节点。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:54-59` 工具栏提供了 `四级标题` 模板。
- `frontend/src/utils/senseArticleSyntax.js:203-214` 当前前端 parser 只识别 `#` 到 `###`。
- `backend/services/senseArticleParser.js:342-375` 当前后端 parser 也只识别 `#` 到 `###`。
- `frontend/src/components/senseArticle/SenseArticleRenderer.js:116-121` renderer 也只会渲染到 `h3`。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:61-71` `待办清单` 只是插入 `- [ ]` 文本，没有 task-list schema。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:925-929` 当前插入工具栏只有标题/列表/引用块/引用/公式/符号/帮助，没有颜色/表格/媒体按钮。
- `frontend/src/utils/senseArticleApi.js:212-229` 编辑保存核心接口是 `createDraft / updateDraft / submitRevision`。
- `backend/routes/senseArticles.js:143-215` revision 草稿创建、更新、提交的真实后端路由在这里。
- `backend/services/senseArticleService.js:549-590,882-954,1012-1089` 保存链路会 parse、resolve refs、build diff，再写 revision。
- `backend/models/SenseArticleRevision.js:138-217` 数据库存的是 `editorSource` 字符串和派生 `ast/headingIndex/referenceIndex/plainTextSnapshot`。
- `backend/services/senseArticleService.js:1352-1359` 发布时会把发布版正文同步回 `NodeSense.content` 旧字段。
- `backend/routes/senses.js:132-145` 旧的 sense 正文直写入口已经被后端拒绝，不能再沿用。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:808-821` 当前主插入工具栏已经是 sticky，但在左 pane 内，宽度受限。
- `frontend/src/components/senseArticle/SenseArticle.css:808-821` 主工具栏 sticky 的 `top` 是硬编码 `12px`。
- `frontend/src/components/senseArticle/SenseArticle.css:1017-1021` 预览 topbar sticky 的 `top` 用的是 `--sense-editor-sticky-top`，当前两套 offset 不统一。
- `frontend/src/components/senseArticle/SenseArticleEditor.js:809-849` 引用帮助/语法帮助是普通流内 helper grid，不是 portal。
- `frontend/src/components/senseArticle/SenseArticle.css:823-842` 插入菜单 dropdown 是普通 absolute 渲染，不是 portal。
- `frontend/src/components/senseArticle/SenseArticlePage.js:320-365` 目录跳转和搜索跳转直接 `scrollIntoView`，当前没有 `scroll-margin-top`。
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js:247-349` 预览拖拽分栏是手写 pointer 事件，不依赖拖拽库。
- `frontend/package.json:5-11` 前端没有现成 UI 库、编辑器库、上传库、拖拽库、表格库可直接拿来用。
- `backend/server.js:84-85` 服务端 JSON body limit 是 `10mb`，媒体不能走 base64 混在正文里。
- `docs/sense-article-editor-*.md` 和 `frontend/build/**` 不是运行时代码；不要把它们当改造入口。

## 10. 附录：关键文件路径索引
### 前端页面
- `frontend/src/App.js`
- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`

### 前端组件
- `frontend/src/components/senseArticle/SenseArticlePageHeader.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/SenseArticlePreviewPanel.js`
- `frontend/src/components/senseArticle/SenseArticleComparePanel.js`
- `frontend/src/components/senseArticle/SenseArticleStatusBadge.js`
- `frontend/src/components/senseArticle/SenseArticleStateView.js`

### hooks
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
- `frontend/src/components/senseArticle/useSenseArticleCompare.js`

### store
- 未找到独立 store 文件
- 当前相当于页面级 store 的位置：
  - `frontend/src/App.js`（`senseArticleContext`、`view`）
  - `frontend/src/components/senseArticle/senseArticleNavigation.js`（context 结构与导航规则）

### api
- `frontend/src/utils/senseArticleApi.js`
- `frontend/src/utils/senseArticleDiagnostics.js`

### 后端路由
- `backend/server.js`
- `backend/routes/senseArticles.js`
- `backend/routes/senses.js`
- `backend/routes/nodes.js`

### controller
- 未找到单独 controller 目录
- 当前 `backend/routes/senseArticles.js` 直接承担 controller 层职责

### service
- `backend/services/senseArticleService.js`
- `backend/services/senseArticleParser.js`
- `backend/services/senseArticleSerializer.js`
- `backend/services/senseArticleDiffService.js`
- `backend/services/senseArticleWorkflow.js`
- `backend/services/senseArticlePermissionService.js`
- `backend/services/senseArticleAnchorService.js`

### model
- `backend/models/SenseArticleRevision.js`
- `backend/models/SenseArticle.js`
- `backend/models/NodeSense.js`
- `backend/models/SenseAnnotation.js`

### 样式文件
- `frontend/src/components/senseArticle/SenseArticle.css`
- `frontend/src/App.css`
- `frontend/src/index.css`

### 上传相关文件
- 未找到百科正文专用上传组件
- 未找到百科正文专用上传 API
- 未找到正文媒体资源 model
- 仅与正文“引用目标搜索”相关的近似文件：
  - `frontend/src/utils/senseArticleApi.js`
  - `backend/routes/senseArticles.js`
  - `backend/services/senseArticleService.js`
