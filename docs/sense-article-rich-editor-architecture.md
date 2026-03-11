# Sense Article Rich Editor Architecture

## 目标

本子系统将原先基于 `textarea + legacy DSL` 的百科编辑方式，升级为基于 TipTap/ProseMirror 的 `rich_html` 编辑系统，同时保留既有 revision、审阅、发布、历史、compare 工作流。

核心目标：

- 不推翻现有百科 revision 工作流
- 保持 `legacy_markup` 与 `rich_html` 双格式兼容
- 让编辑页、审阅页、历史页、compare 页都能消费 rich_html
- 为长期维护补齐 sanitize、自动保存、媒体追踪、迁移审计与发布前校验

## 前端结构

页面入口：

- `frontend/src/App.js`
  - `view === "senseArticleEditor"` 打开编辑页
  - `senseArticleContext` 负责 node/sense/revision 上下文

编辑页主入口：

- `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - 页面级数据加载
  - revision 保存/提交
  - 自动保存与本地恢复接线
  - 状态区、帮助入口、媒体摘要、发布前校验摘要

富文本编辑壳层：

- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
  - TipTap `useEditor`
  - sticky toolbar
  - 编辑/预览 split layout
  - 目录导航
  - scoped 高亮联动
  - paste transform 接入

工具栏与弹窗：

- `frontend/src/components/senseArticle/editor/RichToolbar.js`
- `frontend/src/components/senseArticle/editor/ToolbarGroup.js`
- `frontend/src/components/senseArticle/editor/ToolbarButton.js`
- `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js`
- `frontend/src/components/senseArticle/editor/dialogs/InsertLinkDialog.js`
- `frontend/src/components/senseArticle/editor/dialogs/InsertTableDialog.js`
- `frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js`
- `frontend/src/components/senseArticle/editor/dialogs/ImportMarkdownDialog.js`
- `frontend/src/components/senseArticle/editor/dialogs/SenseArticleEditorHelpDialog.js`

前端 hooks：

- `frontend/src/components/senseArticle/hooks/useSenseArticleAutosave.js`
  - debounce 自动保存
  - dirty 判定
  - localStorage 恢复
  - 冲突状态
- `frontend/src/components/senseArticle/hooks/useUnsavedChangesGuard.js`
  - 离开页面提醒
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
  - 预览折叠、宽度拖拽、响应式预览布局

前端富文本辅助：

- `frontend/src/components/senseArticle/editor/paste/normalizePastedContent.js`
  - HTML/Word 粘贴清洗
- `frontend/src/components/senseArticle/editor/paste/markdownToRichContent.js`
  - Markdown 转基础 rich_html
- `frontend/src/components/senseArticle/editor/legacyMarkupToRichHtml.js`
  - legacy 保守转换
- `frontend/src/components/senseArticle/editor/extractRichHtmlOutline.js`
  - 从 rich_html 提取目录与 fallback blocks

渲染器：

- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
  - 按 `contentFormat` 分发 legacy / rich 渲染
- `frontend/src/components/senseArticle/SenseArticleRichRenderer.js`
  - rich_html 渲染
  - 内部引用按钮、安全媒体渲染、fallback block 构造

## 后端结构

主服务：

- `backend/services/senseArticleService.js`
  - createDraft / updateDraft / submitRevision / review / publish
  - revision 详情组装
  - rich_html 派生字段落库
  - 媒体引用与 validation 快照接入

内容处理：

- `backend/services/senseArticleRichContentService.js`
  - `contentFormat` 判断
  - rich_html sanitize
  - rich_html 结构提取
  - `plainTextSnapshot` / `renderSnapshot` / `headingIndex` / `referenceIndex`

兼容 parser：

- `backend/services/senseArticleParser.js`
  - legacy DSL 解析
- `backend/services/senseArticleMigrationService.js`
  - legacy -> rich 转换与迁移审计

compare：

- `backend/services/senseArticleDiffService.js`
- `backend/services/senseArticleRichCompareService.js`
  - rich_html 块级 compare

校验与媒体：

- `backend/services/senseArticleValidationService.js`
  - 空正文、无效内部引用、缺媒体、alt、标题层级、空表格
- `backend/services/senseArticleMediaService.js`
  - 媒体资产写库
- `backend/services/senseArticleMediaReferenceService.js`
  - revision 媒体引用提取
  - media usage 状态刷新
  - editor media library
  - orphan scan

序列化：

- `backend/services/senseArticleSerializer.js`
  - revision summary/detail 输出
  - `revisionVersion` / `mediaReferences` / `validationSnapshot`

路由与静态资源：

- `backend/routes/senseArticles.js`
- `backend/server.js`

模型：

- `backend/models/SenseArticleRevision.js`
- `backend/models/SenseArticle.js`
- `backend/models/NodeSense.js`
- `backend/models/SenseArticleMediaAsset.js`

## contentFormat 兼容策略

revision 与发布内容都允许两种格式：

- `legacy_markup`
- `rich_html`

策略：

1. 新建草稿默认 `rich_html`
2. 老 revision 仍可按 `legacy_markup` 读取
3. legacy 打开编辑页时先走 `legacyMarkupToRichHtml`
4. 转换失败时，编辑页降级为只读 preview fallback
5. 阅读/审阅/历史/compare 根据 `contentFormat` 分流渲染
6. 发布时 `NodeSense.content` 与 `NodeSense.contentFormat` 同步兼容

## rich_html 工作流调用链

编辑保存：

1. `SenseArticleEditor.js` 组装 snapshot
2. `useSenseArticleAutosave.js` 节流调用 `senseArticleApi.updateDraft`
3. `backend/routes/senseArticles.js`
4. `backend/services/senseArticleService.updateDraftRevision`
5. `materializeRevisionPayload`
6. `buildRevisionMediaAndValidation`
7. `SenseArticleRevision` 保存派生字段

提交/审阅/发布：

1. `submitRevision`
2. 服务端先执行 `assertRevisionValidationBeforeWorkflow`
3. workflow service 决定状态迁移
4. 审阅通过后发布
5. 发布版内容回写 `NodeSense.content` / `contentFormat`

compare：

1. `useSenseArticleCompare.js`
2. `senseArticleApi.compareRevisions`
3. rich_html 走块级 compare
4. `SenseArticleComparePanel.js` 负责结构化展示

## sanitize 与 paste transform 双层治理

前端：

- `normalizePastedContent.js`
  - 清除脏 HTML / Word 样式
  - 丢弃危险标签与直接粘贴本地图片
  - Markdown 粘贴转 rich_html

后端：

- `senseArticleRichContentService.js`
  - `sanitize-html` 白名单
  - 过滤 script、事件处理器、任意 style 注入
  - 限制链接与媒体 URL

设计原则：

- 前端负责用户体验与脏内容降级
- 后端负责最终存储安全兜底

## 自动保存与冲突策略

相关文件：

- `frontend/src/components/senseArticle/hooks/useSenseArticleAutosave.js`
- `backend/services/senseArticleService.js`

策略：

- rich_html 编辑时按 1.8s 防抖自动保存
- localStorage key 按 `nodeId:senseId:revisionId` 隔离
- 自动保存附带 `expectedRevisionVersion`
- 服务端对 `__v` 不一致返回 `revision_edit_conflict`
- 前端显示冲突状态，不静默覆盖

## 媒体引用与孤儿审计

revision 字段：

- `SenseArticleRevision.mediaReferences`
- `SenseArticleRevision.validationSnapshot`

asset 字段：

- `SenseArticleMediaAsset.status`
- `referencedRevisionIds`
- `publishedRevisionIds`
- `firstReferencedAt`
- `lastReferencedAt`

状态语义：

- `uploaded`: 已上传但未被引用
- `active`: 当前仍被某 revision 引用
- `orphan_candidate`: 曾被引用但当前没有 revision 使用

审计脚本：

- `backend/scripts/auditLegacySenseArticleMigration.js`
- `backend/scripts/auditSenseArticleMediaUsage.js`

## 已知限制

当前明确保留到未来版本的问题：

- 无协同编辑
- 无复杂表格能力（合并单元格、列宽拖拽）
- 无真正 PM tree diff
- scoped 仍是整页编辑 + 范围高亮
- 不自动物理删除媒体文件
- 无长文虚拟化/分块渲染

这些限制是有意收敛，避免在现阶段扩大高风险重构范围。
