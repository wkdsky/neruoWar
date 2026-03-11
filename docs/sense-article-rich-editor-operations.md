# Sense Article Rich Editor Operations

## 常用命令

后端 sense article 回归测试：

```bash
cd backend
npm run test:sense-articles
```

前端构建：

```bash
cd frontend
npm run build
```

legacy 迁移 dry-run 审计：

```bash
cd backend
npm run audit:legacy-sense-articles -- --scope=revisions --limit=500
```

扫描已发布内容：

```bash
cd backend
npm run audit:legacy-sense-articles -- --scope=node-sense --limit=500
```

媒体使用审计：

```bash
cd backend
npm run audit:sense-article-media -- --nodeId=<nodeId> --senseId=<senseId>
```

或：

```bash
cd backend
npm run audit:sense-article-media -- --articleId=<articleId>
```

## 哪些命令只读，哪些会写数据

只读审计：

- `npm run test:sense-articles`
- `npm run audit:legacy-sense-articles`
- `npm run audit:sense-article-media`

会写数据：

- 编辑页保存草稿 / 自动保存
- 提交审核 / 审阅 / 发布
- 媒体上传

当前没有提供“自动清理物理媒体文件”的写操作脚本。

## 故障排查路径

### 1. sanitize 问题

现象：

- 保存后 HTML 被裁剪
- 链接/媒体属性丢失

优先检查：

- `backend/services/senseArticleRichContentService.js`
- 白名单配置
- 服务端日志中的 sanitize 诊断输出

### 2. legacy 转 rich 失败

现象：

- 编辑页显示只读 fallback
- 转换警告提示无法自动迁移

优先检查：

- `frontend/src/components/senseArticle/editor/legacyMarkupToRichHtml.js`
- `backend/services/senseArticleMigrationService.js`
- `npm run audit:legacy-sense-articles`

### 3. compare 结果不符合预期

现象：

- rich_html compare 显示为空
- 块级摘要不稳定

优先检查：

- `backend/services/senseArticleRichCompareService.js`
- `backend/services/senseArticleDiffService.js`
- `frontend/src/components/senseArticle/SenseArticleComparePanel.js`

### 4. 媒体上传失败

现象：

- 上传接口报错
- 媒体 URL 存在但正文引用无效

优先检查：

- `backend/routes/senseArticles.js`
- `backend/services/senseArticleMediaService.js`
- `backend/services/senseArticleMediaReferenceService.js`
- `backend/server.js` 静态资源挂载

### 5. 自动保存冲突或未保存

现象：

- 编辑页显示“草稿发生冲突”
- 自动保存失败

优先检查：

- `frontend/src/components/senseArticle/hooks/useSenseArticleAutosave.js`
- `backend/services/senseArticleService.js` 中 `expectedRevisionVersion`
- 浏览器 localStorage 中 `sense-rich-autosave:*`

## 常见维护结论

- 如果问题只发生在粘贴进入编辑器，先查前端 paste transform。
- 如果问题只发生在保存后，先查后端 sanitize 与 materialize 流程。
- 如果问题只发生在审阅/历史/compare，优先查 serializer 与 compare 输出。
- 如果媒体在正文中显示为空但文件仍存在，先查 revision `mediaReferences` 是否已刷新。

## 限制提醒

- 当前只有“孤儿候选”审计，没有自动物理删除。
- 当前 rich compare 不是 PM tree diff。
- 当前 scoped 修订不是独立子编辑器。
