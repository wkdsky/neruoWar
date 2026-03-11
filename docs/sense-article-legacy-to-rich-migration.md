# Sense Article Legacy To Rich Migration

## 当前格式关系

系统同时兼容：

- `legacy_markup`
- `rich_html`

兼容原则：

- 老 revision 与老发布内容不会被强制重写
- 新建草稿默认 `rich_html`
- legacy 内容可继续阅读、审阅、历史回看
- 进入编辑页时优先尝试保守转换为 rich_html

## 转换流程

前端编辑时：

1. 读取 legacy revision
2. 调用 `legacyMarkupToRichHtmlWithDiagnostics`
3. 成功则进入 rich_html 编辑
4. 失败则进入只读 fallback，并给出明确提示

后端迁移评估：

1. 读取 legacy 数据
2. 调用 `auditLegacyConversionCandidate`
3. 输出成功/失败与 warning 汇总

## 批量迁移前如何 dry-run

审计 revision：

```bash
cd backend
npm run audit:legacy-sense-articles -- --scope=revisions --limit=500
```

审计已发布 NodeSense：

```bash
cd backend
npm run audit:legacy-sense-articles -- --scope=node-sense --limit=500
```

建议在正式批量迁移前记录：

- 总量
- 成功数
- 失败数
- 失败样本
- warning 分布

## 转换失败如何处理

推荐顺序：

1. 保持 legacy 内容仍可阅读
2. 在编辑页显示只读 fallback
3. 结合审计结果整理失败原因
4. 对特殊旧语法补规则或人工修订

不要在未确认保真度前直接强制写回 rich_html。

## 回滚原则

当前未提供“一键全库回滚脚本”，但回滚原则明确：

- published revision 仍是权威来源
- history/review 中仍可渲染老版 legacy revision
- 如果某个 rich_html 发布版需要回退，可回到旧 revision
- `NodeSense.content` 与 `contentFormat` 应始终与当前发布 revision 对齐

## NodeSense.content 兼容

发布时：

- rich_html revision 可同步回 `NodeSense.content`
- 同时保留 `NodeSense.contentFormat`
- 阅读页按 `contentFormat` 选择 legacy/rich 渲染器

因此，迁移并不要求一次性把数据库中所有历史内容都改写为 rich_html。
