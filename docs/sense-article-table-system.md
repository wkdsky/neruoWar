# 百科表格系统说明

## 1. 总览

当前百科富文本表格系统基于 TipTap / ProseMirror Table 扩展族实现，保留 `rich_html` 存储路线，不引入任意 style 注入。

核心入口：

- 编辑器挂载：[frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js)
- 表格上下文工具带：[frontend/src/components/senseArticle/editor/TableContextBand.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/TableContextBand.js)
- 表格 extension：[frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js)
- 表格 schema 工具：[frontend/src/components/senseArticle/editor/table/tableSchema.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/table/tableSchema.js)

## 2. 表格 schema / attrs

### 2.1 table 级 attrs

- `tableStyle`
  - `default | compact | zebra | three-line`
- `tableWidthMode`
  - `auto | narrow | medium | wide | full | custom`
- `tableWidthValue`
  - 受控百分比字符串，允许范围 `40-100`
- `tableBorderPreset`
  - `all | none | outer | inner-horizontal | inner-vertical | three-line`
- `columnWidths`
  - 受控逗号串，最终落在 `data-column-widths`

### 2.2 cell / header 级 attrs

- `textAlign`
- `verticalAlign`
- `backgroundColor`
- `textColor`
- `borderEdges`
  - `all | none | top,right,bottom,left` 的受控组合
- `borderWidth`
  - `1 | 2 | 3`
- `borderColor`
- `diagonalMode`
  - `none | tl-br | tr-bl`
- `rowspan`
- `colspan`
- `colwidth`

## 3. rich_html 持久化方案

### 3.1 table 级

表格最终以 `table/thead/tbody/tr/th/td` 持久化，table 级属性走受控 `data-*`：

- `data-table-style`
- `data-table-width-mode`
- `data-table-width-value`
- `data-table-border-preset`
- `data-column-widths`

整体宽度允许最小化 `table.style.width`，仅用于受控宽度表达，不开放任意 style。

### 3.2 列宽桥接

- 编辑态仍使用 ProseMirror `colwidth`
- 序列化时映射为：
  - cell 上的 `data-colwidth`
  - table 上的 `data-column-widths`
- 重新加载时再从 `data-colwidth` / `data-column-widths` 恢复到 PM 识别的 `colwidth`

对应实现：

- 前端 schema：[frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js)
- 工具函数：[frontend/src/components/senseArticle/editor/table/tableSchema.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/table/tableSchema.js)

## 4. 选区与 TableContextBand

表格上下文状态由 [frontend/src/components/senseArticle/editor/table/tableSelectionState.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/table/tableSelectionState.js) 统一提供。

当前会返回：

- 是否在 table 中
- 是否为多单元格选区
- `canMerge` / `canSplit`
- 当前 cell attrs / table attrs
- 选区命中 merged cells 的情况
- 删除行/列拦截原因
- 选区摘要文案
- 边框边开关的批量状态

表格工具带挂在主工具栏下方，仍属于同一个 sticky shell，不使用浮动 mini toolbar。

## 5. merge / split 规则

### 5.1 merge

当前 merge 直接沿用 ProseMirror `mergeCells` 标准语义，规则如下：

- 仅允许合法矩形区域
- 合并后保留左上角单元格作为目标单元格
- 非空内容会汇总进目标单元格
- 格式以左上角单元格为主格式来源
  - 背景色：左上角
  - 对齐：左上角
  - 文字颜色：左上角
  - 边框覆盖：左上角
  - 斜线模式：左上角

实现入口：

- [frontend/src/components/senseArticle/editor/table/tableMergeUtils.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/table/tableMergeUtils.js)

### 5.2 split

当前 split 沿用 ProseMirror `splitCell` 标准语义，规则如下：

- 仅允许当前聚焦在单个已合并单元格上
- 内容保留在左上角单元格
- 新拆出的单元格内容为空
- 原单元格格式会复制到拆分后的各个单元格
  - 背景色：继承
  - 对齐：继承
  - 文字颜色：继承
  - 边框覆盖：继承
  - 斜线模式：继承

这套规则与 PM 默认实现保持一致，因此前后端 materialize / compare / validation 都按该语义理解。

## 6. 边框系统规则

### 6.1 table preset

支持：

- `all`
- `none`
- `outer`
- `inner-horizontal`
- `inner-vertical`
- `three-line`

样式落点：

- [frontend/src/components/senseArticle/SenseArticle.css](/home/wkd/neruoWar/frontend/src/components/senseArticle/SenseArticle.css)

### 6.2 优先级

边框优先级按下面规则处理：

1. 单元格显式边框覆盖优先于 table preset
2. `three-line` 作为 table preset 时，优先定义表格整体的上/下边线和表头分隔线
3. 邻接单元格冲突交给浏览器 `border-collapse: collapse` 处理
4. 批量边框操作会对当前选区逐格写入同一套受控 attrs，避免混合状态导致明显不一致

### 6.3 单元格边框 attrs

- `borderEdges`
- `borderWidth`
- `borderColor`

批量边框更新由 [frontend/src/components/senseArticle/editor/table/tableSelectionState.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/table/tableSelectionState.js) 里的 `applyAttrsToSelectedTableCells` 统一执行。

## 7. 三线表与斜线单元格

### 7.1 三线表

三线表由两层共同决定：

- `tableStyle="three-line"`
- `tableBorderPreset="three-line"`

阅读态和编辑态共用同一套 class 规则。

### 7.2 斜线单元格

斜线能力使用受控 `data-diagonal`：

- `tl-br`
- `tr-bl`

实现方式：

- 不使用 canvas
- 使用 CSS `linear-gradient`
- 主要面向表头单元格

## 8. sanitize / compare / validation

### 8.1 sanitize

后端只保留受控表格属性，不开放任意 style。

主文件：

- [backend/services/senseArticleRichContentService.js](/home/wkd/neruoWar/backend/services/senseArticleRichContentService.js)

保留范围包括：

- `table/thead/tbody/tr/th/td`
- `data-table-*`
- `data-colwidth`
- `rowspan`
- `colspan`
- 受控 `border-*`
- 受控 `text-align / vertical-align / width`

### 8.2 compare

后端 compare 会感知：

- 表格样式变化
- 宽度变化
- 列宽摘要变化
- 边框 preset 变化
- 斜线单元格变化
- cell format 摘要变化
- merge/split 结构变化
- merge 区域摘要变化

主文件：

- [backend/services/senseArticleTableMetaService.js](/home/wkd/neruoWar/backend/services/senseArticleTableMetaService.js)
- [backend/services/senseArticleRichCompareService.js](/home/wkd/neruoWar/backend/services/senseArticleRichCompareService.js)
- [frontend/src/components/senseArticle/SenseArticleComparePanel.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/SenseArticleComparePanel.js)

### 8.3 validation

当前 validation 会检查：

- 非法 `tableStyle`
- 非法 `tableBorderPreset`
- 非法 `tableWidthMode`
- 非法宽度值
- 非法 `columnWidths`
- 非法 `rowspan/colspan`
- 非 header cell 使用 diagonal 的 warning
- 空表格 warning
- 空壳表格 warning

主文件：

- [backend/services/senseArticleValidationService.js](/home/wkd/neruoWar/backend/services/senseArticleValidationService.js)

## 9. 阅读态与窄屏

阅读态表格由 [frontend/src/components/senseArticle/SenseArticleRichRenderer.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/SenseArticleRichRenderer.js) 渲染，并在 table 外包一层 `.sense-rich-table-wrap`，用于窄屏横向滚动。

当前优化点：

- 阅读态与编辑态共用表格 class
- 长表格默认横向滚动，不强行压缩列
- merged cell 有额外视觉描边
- 当前活动 cell 与批量选区有不同高亮
- 小屏下 popover 改为固定定位，避免超出视口

## 10. 已知限制

- 未支持行高拖拽
- 未支持单元格自由拉伸
- 未支持 mini toolbar
- 未支持内横/内竖以外的复杂 Excel 级边框编辑
- compare 仍是摘要级，不做逐格 tree diff
- diagonal 仍是第一版视觉能力，不提供双文本专用编辑器
