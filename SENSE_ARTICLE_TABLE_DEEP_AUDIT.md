# 百科富文本表格深改前置审计报告

## 1. 当前表格能力入口定位
### 1.1 页面与编辑壳层入口
代码事实

- 百科阅读页、编辑页、审阅页、历史页都由 `frontend/src/App.js:6563-6640` 挂载；表格深改直接相关的编辑入口是 `SenseArticleEditor`，阅读/审阅/历史分别影响 renderer 和 compare。
- 编辑页在 `frontend/src/components/senseArticle/SenseArticleEditor.js:473-484` 渲染 `RichSenseArticleEditorShell`；这是一切 TipTap 表格编辑能力的壳层入口。
- 编辑器壳层在 `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:60-101` 初始化 TipTap，表格扩展通过 `TableStyleExtension.configure({ resizable: true })`、`RichTableRow`、`RichTableHeader`、`RichTableCell` 接入。
- 壳层的 sticky 工具栏容器在 `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:188-218`；工具栏高度通过 `ResizeObserver` 在 `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:48-58` 实时测量，并写入 CSS 变量 `--sense-editor-toolbar-height`。
- 阅读页由 `frontend/src/components/senseArticle/SenseArticlePage.js` 承接，审阅页由 `frontend/src/components/senseArticle/SenseArticleReviewPage.js` 承接，历史页由 `frontend/src/components/senseArticle/SenseArticleHistoryPage.js` 承接；三者都不直接复用编辑态表格交互，但会消费 renderer / compare / validation 的结果。

判断

- 下一阶段“表格编辑模式”如果要与现有编辑器壳层最稳妥对接，首选挂载点仍然是 `RichSenseArticleEditorShell`，而不是更外层的 `SenseArticleEditor`。原因是 sticky、toolbar 高度测量、目录导航、scroll-margin 补偿都已在这一层完成。

### 1.2 表格相关组件与扩展文件
代码事实

- 页面入口文件
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/SenseArticlePage.js`
  - `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
  - `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- 编辑器壳层文件
  - `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
- Rich toolbar 文件
  - `frontend/src/components/senseArticle/editor/RichToolbar.js`
  - `frontend/src/components/senseArticle/editor/ToolbarGroup.js`
  - `frontend/src/components/senseArticle/editor/ToolbarButton.js`
- 插入表格 dialog 文件
  - `frontend/src/components/senseArticle/editor/dialogs/InsertTableDialog.js`
  - 公共 dialog 壳层：`frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js`
- 表格 extension 文件
  - `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js`
- rich renderer 文件
  - `frontend/src/components/senseArticle/SenseArticleRichRenderer.js`
  - 阅读态适配入口：`frontend/src/components/senseArticle/SenseArticleRenderer.js`
- compare / review / validation / serializer / service 中与表格有关的文件
  - `backend/services/senseArticleRichContentService.js`
  - `backend/services/senseArticleRichCompareService.js`
  - `backend/services/senseArticleDiffService.js`
  - `backend/services/senseArticleValidationService.js`
  - `backend/services/senseArticleSerializer.js`
  - `backend/services/senseArticleService.js`
  - `backend/models/SenseArticleRevision.js`
  - `backend/models/NodeSense.js`
- 样式文件
  - `frontend/src/components/senseArticle/SenseArticle.css`
- 粘贴/导入相关
  - `frontend/src/components/senseArticle/editor/paste/normalizePastedContent.js`
  - `frontend/src/components/senseArticle/editor/paste/markdownToRichContent.js`
  - `frontend/src/components/senseArticle/editor/legacyMarkupToRichHtml.js`

### 1.3 当前表格 UI 入口盘点
代码事实

- 主工具栏入口：`frontend/src/components/senseArticle/editor/RichToolbar.js:358-367` 中的“插入表格”按钮。
- 插入表格弹窗：`frontend/src/components/senseArticle/editor/RichToolbar.js:425-428` 打开 `InsertTableDialog`；表单定义在 `frontend/src/components/senseArticle/editor/dialogs/InsertTableDialog.js:12-99`。
- 选中表格后的上下文操作：不是独立浮层，而是主工具栏内的条件分组。`frontend/src/components/senseArticle/editor/RichToolbar.js:369-398` 通过 `editor.isActive('table')` 决定是否显示“表格设置”组。
- 已有表格上下文操作仅包括：
  - 行列增删：`RichToolbar.js:371-376`
  - 首行/首列表头切换：`RichToolbar.js:377-378`
  - 样式切换：`RichToolbar.js:379-391`
  - 单元格水平对齐：`RichToolbar.js:393-395`
  - 删除表格：`RichToolbar.js:396`
- 右键菜单：未找到。
- BubbleMenu / FloatingMenu：未找到。全仓库仅发现 `editor.isActive('table')` 这一处表格上下文显示逻辑，见 `frontend/src/components/senseArticle/editor/RichToolbar.js:369`。
- 编辑器内表格专属 floating panel：未找到。

判断

- 现状里的“表格上下文”其实是“主工具栏尾部临时出现一个 group”，还不是独立的“表格编辑模式”。
- 这意味着下一阶段可以复用现有 `isActive('table')` 触发方式，但 UI 形态需要从“主工具栏内部一个 group”升级成“独立语义层级的 contextual band / panel”。

### 1.4 当前表格功能边界
代码事实

- 已实现能力
  - 插入表格：`RichToolbar.js:197-201` + `InsertTableDialog.js:43-56`
  - 指定行数/列数/首行表头/首列表头：`InsertTableDialog.js:45-49`
  - 基础行列增删：`RichToolbar.js:371-376`
  - 首行/首列表头切换：`RichToolbar.js:377-378`
  - 三种表格样式预设：`default` / `compact` / `zebra`，见 `InsertTableDialog.js:81-87`、`TableStyleExtension.js:6-10`
  - 单元格文字水平对齐：`TableStyleExtension.js:39-45`、`RichToolbar.js:393-395`
- 未找到的现有能力
  - 独立表格上下文工具带
  - 右键菜单
  - merge/split 的 UI 入口
  - 单元格垂直对齐 UI
  - 单元格背景色 UI
  - 边框控制 UI
  - 行高控制 UI
  - 表格整体宽高控制 UI
  - 斜线表头/斜线单元格
  - 三线表/三栏表模板
  - 面向表格属性的 compare 粒度

判断

- 当前实现可定义为“成熟第一版”的理由是：它已经不是纯插入表格，而是具备基础结构编辑、样式预设和 cell 对齐；但它仍明显停留在“文档块工具”的层级，而未进入“表格编辑模式”。

## 2. 当前表格内核实现
### 2.1 TipTap / ProseMirror 表格扩展识别
代码事实

- 依赖层使用的是 TipTap 3 的官方 table 扩展族，见 `frontend/package.json:15-18`：
  - `@tiptap/extension-table`
  - `@tiptap/extension-table-cell`
  - `@tiptap/extension-table-header`
  - `@tiptap/extension-table-row`
- 编辑器注册方式见 `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:91-96`：
  - `TableStyleExtension.configure({ resizable: true })`
  - `RichTableRow`
  - `RichTableHeader`
  - `RichTableCell`
- `TableStyleExtension` 是对官方 `Table` 的扩展，见 `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js:12-33`。
- `RichTableCell` / `RichTableHeader` 是基于官方 `TableCell` / `TableHeader` 的二次扩展，见 `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js:35-53`。
- 官方 `Table` 默认 `resizable: false`，但仓库中显式改为 `true`。官方默认项见 `frontend/node_modules/@tiptap/extension-table/dist/index.js:405-416`，项目配置见 `RichSenseArticleEditorShell.js:91-93`。

判断

- 当前不是自研 DOM 表格编辑器，而是“官方 TipTap/PM 表格内核 + 项目定制 attrs/UI”。
- 这对下一阶段是好事：结构与命令体系可以继续走 schema/command/attr 的正规路，而不是手搓 DOM patch。

### 2.2 Node / attrs / commands 结构
代码事实

- 当前表格 node 族
  - `table`：`TableStyleExtension`
  - `tableRow`：`RichTableRow`
  - `tableHeader`：`RichTableHeader`
  - `tableCell`：`RichTableCell`
- 自定义 table attrs 只有一个：`tableStyle`
  - 定义：`frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js:16-23`
  - parse：读取 `data-table-style`
  - render：输出 `data-table-style` 和 `class="sense-rich-table table-style-*"`
- 自定义 cell/header attrs 只有一个：`textAlign`
  - 定义：`frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js:39-45`
  - parse：读 `data-align` 或 `style.textAlign`
  - render：输出 `data-align` 与 `style="text-align: ..."`
- 当前自定义 command 只有一个：`setTableStyle`
  - 定义：`frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js:27-31`
- 官方 table extension 仍自带完整 command 集，见 `frontend/node_modules/@tiptap/extension-table/dist/index.js:467-540`
  - `insertTable`
  - `addColumnBefore` / `addColumnAfter` / `deleteColumn`
  - `addRowBefore` / `addRowAfter` / `deleteRow`
  - `deleteTable`
  - `mergeCells`
  - `splitCell`
  - `toggleHeaderColumn`
  - `toggleHeaderRow`
  - `toggleHeaderCell`
  - `mergeOrSplit`
  - `setCellAttribute`
  - `goToNextCell` / `goToPreviousCell`
  - `fixTables`
  - `setCellSelection`
- 但当前项目实际暴露到 UI 的只有：
  - `insertTable`：`RichToolbar.js:197-201`
  - `addColumnBefore` / `addColumnAfter` / `deleteColumn`：`RichToolbar.js:371-373`
  - `addRowBefore` / `addRowAfter` / `deleteRow`：`RichToolbar.js:374-376`
  - `toggleHeaderRow` / `toggleHeaderColumn`：`RichToolbar.js:377-378`
  - `updateAttributes('table', { tableStyle })` 经 `setTableStyle`：`RichToolbar.js:385`
  - `updateAttributes('tableCell'/'tableHeader', { textAlign })`：`RichToolbar.js:393-395`
  - `deleteTable`：`RichToolbar.js:396`
- 当前仓库未找到这些 command 的 UI 接入：
  - `mergeCells`
  - `splitCell`
  - `toggleHeaderCell`
  - `setCellAttribute`
  - `setCellSelection`

代码事实

- 官方 cell/header schema 还自带 attrs：`colspan`、`rowspan`、`colwidth`，见 `frontend/node_modules/@tiptap/extension-table/dist/index.js:11-35`、`48-83`。
- 当前项目没有覆盖这些官方 attrs，因此理论上编辑内核仍携带这三个 attrs。
- 当前项目未新增这些 attrs：
  - `valign`
  - `background`
  - `border`
  - `width`
  - `height`
  - `data-*` 的 border / diagonal / template 体系

判断

- 当前 attrs 体系只对 `tableStyle` 和 `textAlign` 做了“结构化、可持久化”的第一步；这说明下一阶段最自然的演进方向是继续在 `TableStyleExtension.js` 中扩展结构化 attrs，而不是再加一层纯 class 拼接。

### 2.3 rich_html 中的表格序列化形态
代码事实

- 当前 rich_html 主体仍是原生表格标签树：`table / thead / tbody / tr / th / td`。
  - Markdown 导入时直接生成该结构，见 `frontend/src/components/senseArticle/editor/paste/markdownToRichContent.js:94-97`
  - 后端 sanitize 允许这些标签，见 `backend/services/senseArticleRichContentService.js:141-146`
- 当前持久化到 HTML 的表格级属性
  - `class`
  - `data-table-style`
  - 对应白名单见 `backend/services/senseArticleRichContentService.js:168`
- 当前持久化到 HTML 的单元格级属性
  - `class`
  - `style`
  - `colspan`
  - `rowspan`
  - `data-align`
  - 对应白名单见 `backend/services/senseArticleRichContentService.js:169-170`
- sanitize 对 style 的允许范围由 `filterAllowedStyle` 决定，见 `backend/services/senseArticleRichContentService.js:44-66`
  - 允许：`color`、`background-color`、`text-align`、受限 `font-size`、受限 `list-style-type`、受限百分比 `width`
  - 不允许：`height`、`vertical-align`、`border-*`、像素宽度
- sanitize 对 table class 的允许值只有：
  - `sense-rich-table`
  - `table-style-default`
  - `table-style-compact`
  - `table-style-zebra`
  - 见 `backend/services/senseArticleRichContentService.js:190-193`
- sanitize 不允许的表格相关标签/属性
  - `colgroup`、`col` 标签：未在 allowedTags 中，见 `backend/services/senseArticleRichContentService.js:142-146`
  - `table.style`：`table` 允许属性里没有 `style`，见 `backend/services/senseArticleRichContentService.js:168`
  - `td/th` 的 `colwidth`：未在 allowedAttributes 中，见 `backend/services/senseArticleRichContentService.js:169-170`

判断

- 当前 rich_html 序列化形态是“语义标签 + 极少量受控 attrs/class/style”。
- 这一形态适合继续扩展，但如果未来要做列宽拖拽，现有 sanitize 与官方 TipTap 列宽输出格式是冲突的。

### 2.4 当前实现的主要局限
代码事实

- 后端 AST 物化阶段把表格压扁成：
  - `type: 'table'`
  - `tableStyle`
  - `rows: [{ id, cells: string[] }]`
  - `html`
  - 见 `backend/services/senseArticleRichContentService.js:437-449`
- 物化后的 table block 丢失了这些维度：
  - `thead` / `tbody` 区分
  - `th` / `td` 区分
  - `colspan`
  - `rowspan`
  - `textAlign`
  - 任何未来边框/背景/尺寸/斜线属性
- compare 仅把表格内容展开为文本行，并额外记录 `tableStyle` / `rowCount` / `colCount`，见 `backend/services/senseArticleRichCompareService.js:50-56`、`72-78`、`97-103`
- validation 只识别“空表格”警告，见 `backend/services/senseArticleValidationService.js:99-111`

判断

- 当前实现最大的不是编辑器 UI 缺失，而是“存储和 compare/validation 链路对表格结构理解过浅”。
- 如果下一阶段只在前端加工具带，而不扩展 AST / compare / sanitize / validation，表格深改会在保存后或审阅链路里丢信息。

## 3. 当前表格样式体系
### 3.1 已有样式预设
代码事实

- 现有表格样式预设只有 3 个，定义于 `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js:6-10`
  - `default`
  - `compact`
  - `zebra`
- 插入表格弹窗只暴露这 3 个选项，见 `frontend/src/components/senseArticle/editor/dialogs/InsertTableDialog.js:81-87`
- 工具栏中的表格样式下拉也只暴露这 3 个选项，见 `frontend/src/components/senseArticle/editor/RichToolbar.js:379-391`
- CSS 具体效果位于 `frontend/src/components/senseArticle/SenseArticle.css`
  - 基础表格：`2174-2197`
  - 紧凑表格：`2199-2204`
  - 斑马纹：`2206-2208`

代码事实

- `default`：没有额外视觉规则，主要依赖基础 `.sense-rich-table` 样式。
- `compact`：仅缩小 cell padding，见 `SenseArticle.css:2199-2204`
- `zebra`：仅给 `tbody tr:nth-child(odd)` 设置背景色，见 `SenseArticle.css:2206-2208`
- “三线表 / 三栏表 / 斜线表头 / 紧凑度档位 / 表头高亮”等预设：未找到。

### 3.2 样式持久化方式
代码事实

- `tableStyle` 以 node attr 形式存在于 table 节点，见 `TableStyleExtension.js:16-23`
- 它会同时序列化为：
  - `data-table-style="default|compact|zebra"`
  - `class="sense-rich-table table-style-*"`
- 后端 sanitize 会保留 `data-table-style` 与允许列表中的表格 class，见 `senseArticleRichContentService.js:168`、`190-193`、`233-239`

判断

- 现有 `tableStyle` 实际上已经是“attrs + class/data attribute”的组合，不是纯静态 class 切换。
- 这为未来扩展 `data-table-template`、`data-table-density`、`data-table-border-mode` 等提供了明确先例。

### 3.3 编辑态与阅读态一致性
代码事实

- 编辑态与阅读态共用同一套表格 CSS 选择器，见 `frontend/src/components/senseArticle/SenseArticle.css:2174-2208`
  - `.sense-rich-editor-surface .sense-rich-table`
  - `.sense-rich-renderer .sense-rich-table`
- 表格横向滚动容器样式也同时覆盖编辑态与阅读态，见 `SenseArticle.css:2182-2188`
  - `.tableWrapper`
  - `.sense-rich-table-wrap`
- 阅读态 rich renderer 会把 `block.html` 重新解析成 DOM，再按 tagName 渲染，见 `frontend/src/components/senseArticle/SenseArticleRichRenderer.js:174-179`、`188-195`
- renderer 甚至支持 `col` / `colgroup` 的 React 渲染，见 `SenseArticleRichRenderer.js:140-149`，但后端 sanitize 当前不会保留它们。

代码事实

- 审阅页、历史页对表格不走“完整阅读态渲染”，而是走 compare 汇总卡片，见
  - `frontend/src/components/senseArticle/SenseArticleReviewPage.js:219-227`
  - `frontend/src/components/senseArticle/SenseArticleHistoryPage.js:128-135`
  - `frontend/src/components/senseArticle/SenseArticleComparePanel.js:48-77`

判断

- 编辑态与阅读态的视觉一致性目前较好，因为共用 CSS。
- 但“审阅态 / compare 态一致性”只成立于 `tableStyle + 行列数 + 文本内容` 这一层；一旦加入边框/颜色/尺寸/斜线，就会出现阅读态能显示、compare 态看不到差异的问题。

### 3.4 当前样式短板
代码事实

- 当前表格基础样式固定为 `width: 100%`、`table-layout: fixed`、`border-collapse: collapse`，见 `SenseArticle.css:2174-2180`
- cell 默认 `vertical-align: top` 写死在 CSS，见 `SenseArticle.css:2190-2197`
- 表格边框统一写死为 `1px solid rgba(148, 163, 184, 0.36)`，见 `SenseArticle.css:2194`

判断

- 现有样式体系偏“全局 CSS 默认值”，不是真正的表格属性体系。
- 这会直接限制：
  - 单元格垂直对齐
  - 单元格背景色
  - 边框可见性/粗细
  - 局部边框
  - 列宽/表格宽度
  - 模板型样式（如三线表）
- 下一阶段如果继续只靠 class 切换，复杂度会迅速失控；更适合把“模板”和“可调格式化属性”分层。

## 4. 表格上下文工具带可行性
### 4.1 当前 selection 判断链路
代码事实

- 编辑器侧未找到 `editor.on('selectionUpdate')` 或独立 selection store。
- 当前表格上下文判断完全依赖 `editor.isActive('table')`，见 `frontend/src/components/senseArticle/editor/RichToolbar.js:369`
- `useEditorState` 当前只抽取了 `paragraphType` 与 `activeFontSize`，见 `frontend/src/components/senseArticle/editor/RichToolbar.js:60-79`
- 当前工具栏中已有 selection 保持/恢复逻辑，用于 dialog/popover 打开后恢复插入位置，见 `RichToolbar.js:118-133`

判断

- 当前 selection 链路足够支撑“是否在表格中”的显示判断，但不足以支撑更复杂的“单元格多选态、某列被拖拽、某边框面板打开”等表格子状态。
- 如果下一阶段要做更丰富表格工具带，建议新增一层 editor UI state，而不是把所有条件继续塞进 `RichToolbar` 本体。

### 4.2 当前 toolbar / dialog / popover 体系
代码事实

- 主工具栏组件体系
  - group：`frontend/src/components/senseArticle/editor/ToolbarGroup.js:3-7`
  - button：`frontend/src/components/senseArticle/editor/ToolbarButton.js:3-15`
- 颜色弹层模式
  - 组件：`frontend/src/components/senseArticle/editor/dialogs/TextColorPopover.js:3-27`
  - 定位：相对工具栏按钮容器绝对定位，CSS 在 `SenseArticle.css:1977-1993`
- 对话框模式
  - 组件：`frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js:14-79`
  - 通过 `createPortal(document.body)` 挂到 body
  - 含焦点恢复、Esc 关闭和简单 focus trap
- 阅读页已有一个悬浮选择工具条模式，可参考 `frontend/src/components/senseArticle/SenseArticlePage.js:410-435` 与 `SenseArticle.css:433-444`
- 阅读页还有侧滑浮动面板样式，可参考 `SenseArticle.css:824-872`

判断

- 当前项目已经有三套可复用交互资产：
  - sticky toolbar
  - 相对定位 popover
  - body portal dialog / floating panel
- 做“表格专属临时工具带”不需要从零写交互模式，关键是选哪一层最契合现有 sticky 和 selection。

### 4.3 方案候选对比
代码事实

- 候选 1：在 `RichSenseArticleEditorShell` 的 `.sense-rich-toolbar-shell` 内新增第二条 sticky band
  - 相关文件
    - `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:188-218`
    - `frontend/src/components/senseArticle/editor/RichToolbar.js`
    - `frontend/src/components/senseArticle/SenseArticle.css:1743-1755`、`1817-1869`
  - 优点
    - 复用现有 sticky 容器和 `ResizeObserver` 高度测量
    - 可明显与主工具栏分层，不必挤在同一行
    - scroll-margin 现成跟随 `--sense-editor-toolbar-height`
    - z-index 风险较低，仍在现有 `z-index: 30` 层级内
  - 风险
    - 需要把表格上下文状态从 `RichToolbar` 提升到 shell 或传递更多 editor UI state
    - 工具带变高后，移动端和窄屏可能更容易换行
  - 适配性
    - 高
- 候选 2：继续放在 `RichToolbar` 内，但拆成更显眼的“表格模式分组”
  - 相关文件
    - `frontend/src/components/senseArticle/editor/RichToolbar.js:369-398`
    - `frontend/src/components/senseArticle/SenseArticle.css:1817-1975`
  - 优点
    - 代码改动最少
    - 复用现有按钮和分组组件最直接
  - 风险
    - 很难在视觉上与主工具栏“明显区分”
    - 复杂表格控制一多，会把主工具栏撑爆
    - 后续继续扩展边框、模板、尺寸面板会迅速失控
  - 适配性
    - 中
- 候选 3：在表格上方或选区附近做 floating panel
  - 相关文件
    - 参考模式：`frontend/src/components/senseArticle/SenseArticlePage.js:410-435`
    - 参考样式：`frontend/src/components/senseArticle/SenseArticle.css:433-444`、`824-872`
    - 编辑器挂载点仍需接 `RichSenseArticleEditorShell.js`
  - 优点
    - 最接近 Word / 在线文档的“上下文弹出工具”
    - 视觉语义最强
  - 风险
    - 需要稳定获取表格 DOM rect、处理滚动、selection 变化、sticky 顶栏遮挡
    - 与颜色 popover、dialog、toast 的 z-index 管理更复杂
    - 表格多实例、长文档下定位与更新成本更高
  - 适配性
    - 中偏低

### 4.4 推荐方案
代码事实

- 现有 sticky 壳层已经具备：
  - 独立容器：`RichSenseArticleEditorShell.js:188-218`
  - 高度监听：`RichSenseArticleEditorShell.js:48-58`
  - scroll-margin 补偿：`SenseArticle.css:2243-2246`
- 现有表格上下文显隐已经能用 `editor.isActive('table')` 驱动：`RichToolbar.js:369`

判断

- 最推荐方案是候选 1：在 `RichSenseArticleEditorShell` 内、`RichToolbar` 下方新增独立的“表格上下文工具带”。
- 推荐原因
  - 它最容易做到“视觉上与主工具栏明显区分”
  - 它不需要把浮层定位、portal、表格 DOM 追踪一次性做满
  - 它可以先低风险承接第二阶段的一批功能，再视需求演进为更轻量的 floating panel
- 这也是最符合当前项目代码证据的改法，不是纯产品偏好判断。

### 4.5 视觉分层与交互边界
代码事实

- 当前工具栏壳层视觉已经偏“深色发光 command bar”，见 `SenseArticle.css:1743-1755`
- 按钮和 select 组件有统一 dark 风格，见 `SenseArticle.css:1872-1975`
- 颜色 popover z-index 为 60，dialog backdrop z-index 为 80，toast 为 120，见
  - `SenseArticle.css:1981-1993`
  - `SenseArticle.css:2252-2256`
  - `SenseArticleEditor.js:486-491` 对应 toast DOM，样式见摘要中的 `1628-1633`

判断

- 表格工具带如果走候选 1，建议视觉层级：
  - 仍留在 sticky shell 内
  - 用独立背景、上边框或左侧强调条，与主工具栏形成“临时模式”差异
  - 不建议第一阶段就走 body portal 浮层，因为现有 dialog/popover/z-index 已经较多
- 对 sticky 工具栏、预览顶栏、状态带、帮助入口、目录导航的最小干扰方案，就是“在现有 sticky shell 内增高”，而不是在编辑区上方再叠一层绝对定位浮窗。

## 5. 表格拖拽与尺寸调整可行性
### 5.1 当前 resize 相关基础
代码事实

- 编辑器已开启 TipTap 官方 column resizing：`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:91-93`
- 官方 table extension 在 `resizable: true` 时会注入 `columnResizing` ProseMirror plugin，见 `frontend/node_modules/@tiptap/extension-table/dist/index.js:561-576`
- 官方 `TableView` 会在编辑态创建：
  - `div.tableWrapper`
  - 内部 `table`
  - `colgroup`
  - `tbody`
  - 见 `frontend/node_modules/@tiptap/extension-table/dist/index.js:190-203`
- 官方 `updateColumns` / `createColGroup` 会把列宽写到：
  - `col` 的 `style="width|min-width: ...px"`
  - table 的 `style.width` 或 `style.minWidth`
  - 见 `frontend/node_modules/@tiptap/extension-table/dist/index.js:145-189`、`226-249`
- 官方 cell/header 还会解析 `colwidth` attr，见 `frontend/node_modules/@tiptap/extension-table/dist/index.js:19-35`、`66-73`

代码事实

- 当前仓库未找到表格专用 resize handle 的 CSS，如 `column-resize-handle`、`resize-cursor`、`selectedCell` 等。
- 当前仓库存在一套可复用的 pointer 拖拽实现，但用于“编辑区预览分栏宽度”，不用于表格：
  - hook：`frontend/src/components/senseArticle/useSenseEditorPreviewPane.js:75-349`
  - pointer down/move/up：`247-310`
  - rAF 节流：`281-288`
  - pointer capture：`260-266`、`295-300`
- 当前仓库也有对应 resize handle 的样式，但仅用于分栏 divider，见 `frontend/src/components/senseArticle/SenseArticle.css:967-1053`

判断

- 当前项目不是“完全没有拖拽基础”，而是“表格拖拽内核已开、项目级视觉和持久化未接”。
- 预览分栏拖拽逻辑适合复用其 pointer state machine 思路，但不适合直接复用 DOM/CSS。

### 5.2 列宽 / 行高 / 整体尺寸的可落地性
代码事实

- 编辑态 CSS 已允许 `.tableWrapper` 横向滚动，见 `SenseArticle.css:2182-2188`
- 表格基础样式固定 `width: 100%` 且 `table-layout: fixed`，见 `SenseArticle.css:2174-2180`
- 后端 sanitize 当前会清掉：
  - `colgroup`
  - `col`
  - `table.style`
  - `td/th` 的 `colwidth`
  - 见 `senseArticleRichContentService.js:141-170`

判断

- 整体表格宽度预设
  - 可落地性：高
  - 原因：后端 style 白名单已允许百分比 `width`，见 `senseArticleRichContentService.js:63-64`
  - 但当前 `table` 本身不保留 `style`，所以更适合新增 `tableWidthPreset` 类 attrs，而不是直接依赖 `table.style`
- 列宽拖拽
  - 可落地性：中
  - 编辑器内核已经具备官方能力，但当前 sanitize/AST/compare/render 链路不支持其默认持久化格式
  - 如果要做，建议改为结构化持久化，而不是直接依赖 `colgroup/col + table.style`
- 行高拖拽
  - 可落地性：低
  - 当前没有任何 row height schema / style 白名单 / UI 基础；CSS 也没有行高 handle 设计
- 单元格自由拉伸
  - 可落地性：很低
  - 需要同时解决列宽、行高、跨行跨列、selection、多 handle 命中和持久化问题

### 5.3 rich_html 持久化建议方向
代码事实

- sanitize 允许受限 `width`，但仅在 style 白名单层面；`table` 标签本身当前不允许 `style` 属性，见 `senseArticleRichContentService.js:147-170`
- `td/th` 当前允许 `style`，但 style 白名单里没有 `height`、`vertical-align`、`border-*`，见 `senseArticleRichContentService.js:44-66`
- `SenseArticleRichRenderer` 已能读取任意保留下来的 `style` / `class`，见 `frontend/src/components/senseArticle/SenseArticleRichRenderer.js:86-88`、`156-160`

判断

- 表格尺寸持久化最合理的方向不是直接复用官方 `colgroup + table.style` 原样落库，而是做“结构化 attrs + 受控 HTML 投影”。
- 更适合考虑的字段方向
  - table 级
    - `data-table-width`
    - `data-table-layout`
    - `data-table-template`
  - 列级
    - `data-col-widths="120,160,..."` 或 table attrs 中的 JSON/序列串
  - 行级
    - 第一阶段不建议持久化行高
  - 单元格级
    - `data-cell-bg`
    - `data-cell-valign`
    - `data-cell-border-*`
- 如果仍沿用官方列宽拖拽内核，建议做二次 bridge：
  - 编辑态用 PM `colwidth`
  - 保存前映射到项目自定义 attrs
  - 读回编辑器时再映射回 PM 可识别结构

### 5.4 sanitize / renderer / compare 约束
代码事实

- 后端 sanitize 当前不会保留官方列宽输出的关键节点/属性，见 `senseArticleRichContentService.js:141-170`
- renderer 具备消费 `col` / `colgroup` 的能力，见 `SenseArticleRichRenderer.js:140-149`
- compare 当前对 table meta 只看 `tableStyle`、`rowCount`、`colCount`，见 `senseArticleRichCompareService.js:97-103`
- validation 当前不校验列宽、边框、背景、rowspan/colspan 结构正确性，见 `senseArticleValidationService.js:18-119`

判断

- 列宽拖拽一旦要持久化，不是前端单点改动，至少会牵连：
  - `TableStyleExtension`
  - `senseArticleRichContentService`
  - `SenseArticleRichRenderer`
  - `senseArticleRichCompareService`
  - `senseArticleValidationService`
  - 可能还有 revision migration

### 5.5 推荐优先级与风险判断
代码事实

- 当前内核已开官方列宽 resize，但保存链路不兼容。
- 当前没有行高、自由拉伸的任何现成字段或校验。

判断

- 目前最适合优先支持的是：`5) 上述组合`，但应限定为“1) 整体表格宽度预设 + 2) 列宽拖拽”。
- 分阶段建议
  - 低风险可落地：`1) 仅整体表格宽度预设`
  - 中风险但值得做：`2) 列宽拖拽`
  - 明显高风险：`3) 行高拖拽`、`4) 单元格自由拉伸`
- 原因
  - `1` 只需要 table 级 attrs、CSS 和 sanitize 扩展，链路最短
  - `2` 虽然编辑器内核已具备，但要补持久化和 compare/validation
  - `3/4` 当前既缺 schema，也缺 sanitize，也缺 UI 与性能基础

## 6. 单元格格式化能力现状与扩展点
### 6.1 对齐能力
代码事实

- 水平对齐已支持：左/中/右
  - schema attr：`TableStyleExtension.js:39-45`
  - toolbar 按钮：`RichToolbar.js:393-395`
- `text-align` 被 sanitize 保留，见 `senseArticleRichContentService.js:58`、`231-232`
- 垂直对齐
  - editor UI：未找到
  - schema attr：未找到
  - sanitize style 白名单：未包含 `vertical-align`，见 `senseArticleRichContentService.js:44-66`
  - CSS 默认值写死为 `vertical-align: top`，见 `SenseArticle.css:2194-2196`

判断

- 垂直对齐是很适合下一阶段补上的能力，因为当前 CSS 默认值已经明确，改成 attrs + CSS 映射成本可控。

### 6.2 颜色能力
代码事实

- 编辑器已有成熟颜色面板，但只用于 text color / highlight
  - 组件：`TextColorPopover.js:3-27`
  - 挂载：`RichToolbar.js:299-320`
- 单元格背景色 UI：未找到。
- 单元格文字颜色 UI：未找到。
- 后端 sanitize 对 `td/th` 的 `background-color`、`color` 理论上允许，见 `senseArticleRichContentService.js:56-58`

判断

- 颜色体系在 UI 交互层面有现成资产，但 table cell 没有 schema attrs。
- 如果直接把单元格背景色写进 `td.style`，阅读态能消费，但编辑态 round-trip 是否稳定取决于 cell schema 是否显式声明该 attr；基于当前 `TableStyleExtension.js:35-45`，我判断不应继续依赖“隐式 style 保留”，而应加显式 attrs。

### 6.3 边框能力
代码事实

- 当前边框能力只有全局默认边框样式，写在 CSS：`SenseArticle.css:2194`
- 未找到边框控制 UI、schema attrs、sanitize 白名单支持：
  - `border-width`
  - `border-color`
  - `border-style`
  - 上/下/左/右/内横/内竖/无边框

判断

- 边框控制不适合仅靠 class 切换。
- 更合理的方向是“模板预设 + 结构化边框 attrs”分层：
  - 常规、三线表等走模板预设
  - 局部边框开关走 cell / table 级 attrs

### 6.4 斜线单元格/表头可行性
代码事实

- 当前仓库未找到任何 `diagonal`、`slash header`、斜线 class、伪元素实现。
- sanitize 目前也未保留相关 `data-*` 字段，见 `senseArticleRichContentService.js:168-170`
- renderer 只会渲染保留下来的 class/style/attrs，见 `SenseArticleRichRenderer.js:86-88`、`156-160`

判断

- 斜线单元格/表头在当前实现上属于“特殊能力”，不应混入普通边框逻辑。
- 更适合实现为：
  - 明确的模板/模式 attr，例如 `data-diagonal="header-tl-br"`
  - 配套 CSS 绘制与特殊内容布局
- 不建议第一阶段做成“任意角度、任意分割线”的自由配置；当前代码基础更适合有限枚举模式。

### 6.5 表格模板（常规/三线/斜线等）可行性
代码事实

- 当前已有模板雏形只有 `tableStyle` 一维枚举，见 `TableStyleExtension.js:16-23`
- AST 和 compare 当前只认识 `tableStyle`，见 `senseArticleRichContentService.js:443`、`senseArticleRichCompareService.js:98`

判断

- “常规表 / 三线表 / 斜线表 / 斑马纹 / 紧凑表”更适合实现为“模板预设 + attrs”，而不是全自由配置。
- 原因
  - 当前已经有 `tableStyle` 枚举先例
  - compare 已有 `tableStyle` 这一元数据位，可以自然扩展
  - 三线表、斜线表都带强结构语义，单靠散装边框开关不容易保证一致性
- “三栏表”从现有代码证据看并不天然是样式概念，而更像“插入时结构模板骨架”；如果真要做，建议作为“插入模板”而非通用 style 名称。

## 7. 相关链路影响面
### 7.1 rich renderer
代码事实

- 阅读态 rich renderer 使用 `block.html` 进行 DOMParser 解析并递归渲染，见 `frontend/src/components/senseArticle/SenseArticleRichRenderer.js:174-179`、`188-195`
- renderer 会透传 class/style，见 `SenseArticleRichRenderer.js:86-88`、`156-160`
- 它已支持 `col` / `colgroup`，见 `SenseArticleRichRenderer.js:140-149`

判断

- renderer 不是主要瓶颈；只要 sanitize 能保留、editor 能输出，它大概率能显示。
- 真正要增强的是“哪些 attrs 能稳定进入 `block.html` 并在 compare/validation 中被感知”。

### 7.2 compare / review
代码事实

- compare 的 table compareText 把每行 cell 文本用 ` | ` 拼接，见 `backend/services/senseArticleRichCompareService.js:50-56`
- table preview 只显示 `X 行 × Y 列`，见 `senseArticleRichCompareService.js:72-78`
- table meta 只包括 `tableStyle` / `rowCount` / `colCount`，见 `senseArticleRichCompareService.js:97-103`
- diff service 只把表格变化聚合成 `tables_changed`，见 `backend/services/senseArticleDiffService.js:223-230`
- 审阅页和历史页都通过 `SenseArticleComparePanel` 展示 compare 结果，不渲染真实表格差异，见
  - `SenseArticleReviewPage.js:219-227`
  - `SenseArticleHistoryPage.js:128-135`
  - `SenseArticleComparePanel.js:48-77`

判断

- 如果后续加入边框/颜色/尺寸/斜线/列宽属性，compare 必须增强，否则审阅者看不到关键变化。
- 最少需要补的 compare 粒度
  - table-level template / style
  - column width meta
  - cell format meta 是否变化
  - 重要结构变化（表头类型、merge/split）

### 7.3 validation
代码事实

- 当前 validation 阻塞项只有：空正文、非法引用、缺失媒体，见 `backend/services/senseArticleValidationService.js:26-83`
- 表格仅有 warning：空表格，见 `senseArticleValidationService.js:99-111`

判断

- 表格深改后建议新增 validation，但未必都应是 blocking。
- 最值得新增的方向
  - 非法列宽/尺寸值
  - 非法模板值
  - diagonal 模式与单元格内容不兼容
  - rowspan/colspan 结构不一致
  - 空模板壳表格

### 7.4 serializer / service / migration
代码事实

- revision detail DTO 会把 `editorSource`、`ast`、`headingIndex`、`renderSnapshot`、`validationSnapshot`、`diffFromBase` 一并返回，见 `backend/services/senseArticleSerializer.js:63-96`
- 创建/更新草稿时都会执行：
  - `materializeRevisionPayload`：`backend/services/senseArticleService.js:576-619`
  - `buildRevisionMediaAndValidation`：`621-639`
  - create path：`907-1018`
  - update path：`1021-1083`
- 提交/发布前都会再次用 `validationSnapshot` 卡住流程，见 `senseArticleService.js:1215-1218`、`1528-1531`

判断

- 表格深改一旦加新 attrs，最容易漏改的是 `materializeRichHtmlContent`。因为它决定了 AST、compare、validation 之后能看到什么。
- migration 目前不是立即阻塞项，因为现有 rich_html 表格能力还很轻；但如果引入新的结构化 attrs，最好准备向后兼容默认值逻辑。

### 7.5 NodeSense.content 兼容性
代码事实

- 发布时会把 `editorSource` 镜像回 `NodeSense.content`，见 `backend/services/senseArticleService.js:1611-1618`
- `NodeSense.content` 是 `String`，`contentFormat` 支持 `rich_html`，见 `backend/models/NodeSense.js:19-28`
- `SenseArticleRevision.editorSource` 也是字符串，其他富文本派生结构都放在 `Mixed` 字段中，见 `backend/models/SenseArticleRevision.js:152-205`
- 请求体限制是 `10mb`，见 `backend/server.js:85-86`

判断

- `NodeSense.content` 能承载新增表格 attrs，本身没有 schema 阻碍。
- 真正需要关注的是“HTML 体积增长 + revision ast/diff/validation snapshot 一起增大”，尤其是大量表格和列宽元数据并存时。

## 8. 安全、样式与布局约束
### 8.1 sanitize 白名单限制
代码事实

- sanitize 主逻辑在 `backend/services/senseArticleRichContentService.js:141-248`
- 表格相关允许标签
  - `table`、`thead`、`tbody`、`tr`、`th`、`td`
  - 不含 `colgroup`、`col`
- 表格相关允许属性
  - `table`: `class`、`data-table-style`
  - `td/th`: `class`、`style`、`colspan`、`rowspan`、`data-align`
- 当前未来候选字段是否会被吞掉
  - `border-width`：会被吞
  - `background-color`：可保留，但仅在 `td/th.style`
  - `text-align`：可保留
  - `vertical-align`：会被吞
  - `width/height`
    - 百分比 `width` 只有 style 白名单允许，但 `table` 当前不接受 style
    - `height` 会被吞
  - `colgroup` / `col`：会被吞
  - `data-table-style`：可保留
  - `data-cell-border-*`：会被吞
  - `data-diagonal`：会被吞

判断

- 当前最适合扩展白名单的方式，不是“放开任意 style”，而是：
  - 新增有限枚举的 `data-*` attrs
  - 只对白名单中的几个受控 style 属性扩容
- 对表格深改来说，`data-* + 受控 CSS 变量/枚举值` 比“任意 style 注入”更可维护、更安全。

### 8.2 编辑态/阅读态 CSS 约束
代码事实

- 表格编辑态/阅读态共用样式：`SenseArticle.css:2174-2208`
- 表格横向滚动由 `.tableWrapper` / `.sense-rich-table-wrap` 负责，见 `SenseArticle.css:2182-2188`
- 选中块高亮靠 `.ProseMirror-selectednode`，见 `SenseArticle.css:2039-2045`

判断

- 当前 CSS 已为“表格被选中”提供基础高亮，但没有为“列宽拖拽 handle、边框面板、单元格选区态”预留专门视觉。
- 如果下一阶段要做表格编辑模式，CSS 至少要补三层：
  - 表格模式工具带
  - 编辑区内 table handles
  - cell selection / border preview 态

### 8.3 sticky / z-index / popover 约束
代码事实

- sticky 工具栏：`SenseArticle.css:1743-1755`，`z-index: 30`
- 阅读页 selection toolbar：`SenseArticle.css:433-444`，`z-index: 10`
- 浮动侧板：`SenseArticle.css:824-832`，`z-index: 40`
- 颜色 popover：`SenseArticle.css:1981-1993`，`z-index: 60`
- dialog：`SenseArticle.css:2252-2256`，`z-index: 80`

判断

- 如果表格工具带留在 sticky shell 内，z-index 几乎不需要重新洗牌。
- 如果做 floating panel，需要明确它应该在 `30` 之上、`60` 以下还是复用 `60+`；否则会和颜色 popover、dialog 形成遮挡冲突。

### 8.4 移动端与响应式风险
代码事实

- 当前主工具栏本身就是 `flex-wrap: wrap`，见 `SenseArticle.css:1817-1828`
- toolbar group body 也会换行，见 `SenseArticle.css:1856-1864`
- 表格宽度当前默认 `width: 100%`，横向滚动依赖 wrapper，见 `SenseArticle.css:2174-2188`

判断

- 小屏幕下最容易撑爆的是“工具带按钮数量”，不是表格本体。
- 如果新增完整表格工具带，移动端更适合：
  - 分层按钮组
  - 二级弹出面板
  - 或让一部分格式化能力收进 popover
- 若把所有边框、颜色、尺寸、模板按钮平铺到 band，当前布局会很快失控。

## 9. 可复用资产与高风险区域
### 9.1 可复用组件/逻辑
代码事实

- toolbar group/button
  - `frontend/src/components/senseArticle/editor/ToolbarGroup.js`
  - `frontend/src/components/senseArticle/editor/ToolbarButton.js`
- dialog frame + 焦点恢复
  - `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js:21-49`
- color popover 模式
  - `frontend/src/components/senseArticle/editor/dialogs/TextColorPopover.js`
  - `frontend/src/components/senseArticle/SenseArticle.css:1977-1993`
- selection/focus 恢复逻辑
  - `frontend/src/components/senseArticle/editor/RichToolbar.js:118-133`
- preview split drag 逻辑
  - `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js:247-310`
- sticky 壳层与高度补偿
  - `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:48-58`、`188-218`
  - `frontend/src/components/senseArticle/SenseArticle.css:2243-2246`
- 阅读页 selection toolbar / floating panel 视觉模式
  - `frontend/src/components/senseArticle/SenseArticlePage.js:410-435`
  - `frontend/src/components/senseArticle/SenseArticle.css:433-444`、`824-872`

判断

- 后续表格工具带最值得沿用的是：
  - `DialogFrame` 的 aria + focus 管理
  - `TextColorPopover` 的轻量弹层模式
  - `RichToolbar` 的 selection preserve/restore
  - `useSenseEditorPreviewPane` 的 pointer capture + rAF 节流思路

### 9.2 不建议继续叠加的部分
代码事实

- 当前 `RichToolbar.js:369-398` 的表格功能只是一个条件 group。
- 当前表格样式能力只有 `tableStyle` 一维枚举。
- 当前 AST 物化对表格信息丢失严重，见 `senseArticleRichContentService.js:437-449`

判断

- 不建议继续直接在 `RichToolbar` 的现有表格 group 上堆更多按钮；这会把“主工具栏”和“表格模式”彻底混在一起。
- 不建议把更多表格能力继续做成“多几个 class + sanitize 允许几个 class 名”。
- 不建议依赖当前 AST 的 `rows[].cells[]` 形态承载下一阶段深改，因为它对 cell 格式和结构信息几乎失明。

### 9.3 最值得优先修改的文件
代码事实

- 前端第一入口
  - `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
  - `frontend/src/components/senseArticle/editor/RichToolbar.js`
  - `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js`
- 后端第一入口
  - `backend/services/senseArticleRichContentService.js`
  - `backend/services/senseArticleRichCompareService.js`
  - `backend/services/senseArticleValidationService.js`
- 视觉样式
  - `frontend/src/components/senseArticle/SenseArticle.css`

判断

- 若只允许挑最先动的一批文件，我会优先看：
  - `TableStyleExtension.js`
  - `RichSenseArticleEditorShell.js`
  - `senseArticleRichContentService.js`
- 因为它们分别决定“编辑 schema”、“上下文工具带入口”、“持久化/安全边界”。

### 9.4 最容易牵连的高风险文件
代码事实

- `backend/services/senseArticleRichContentService.js`
  - 同时负责 sanitize、AST 物化、renderSnapshot 源
- `backend/services/senseArticleRichCompareService.js`
  - 直接影响 review/history compare
- `backend/services/senseArticleService.js`
  - 贯穿草稿保存、校验、发布、NodeSense 镜像
- `frontend/src/components/senseArticle/SenseArticle.css`
  - 同时覆盖编辑态与阅读态

判断

- 这四个文件是最“牵一发而动全身”的区域。
- 尤其 `senseArticleRichContentService.js` 是表格深改的总闸门；如果这里不改，前端做再多也无法安全持久化。

## 10. 给下一阶段改造 Prompt 的事实清单
请整理成“短句 + 文件路径”的清单

- 当前表格编辑入口在 `RichSenseArticleEditorShell` 初始化 TipTap 时接入，且已开启 `resizable: true`。`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
- 当前表格上下文 UI 只是在主工具栏内部用 `editor.isActive('table')` 条件显示一个 group。`frontend/src/components/senseArticle/editor/RichToolbar.js`
- 当前插入表格弹窗只支持 rows/cols/headerRow/headerColumn/style，style 只有 `default/compact/zebra`。`frontend/src/components/senseArticle/editor/dialogs/InsertTableDialog.js`
- 当前自定义 table attrs 只有 `tableStyle`，cell/header attrs 只有 `textAlign`。`frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js`
- 官方 TipTap table 仍自带 `colspan/rowspan/colwidth` 和 `mergeCells/splitCell/setCellAttribute/setCellSelection` 等 command，但项目 UI 未接这些能力。`frontend/node_modules/@tiptap/extension-table/dist/index.js`
- 官方 column resizing 已在编辑器内核开启，但默认持久化依赖 `colgroup/col/table.style`。`frontend/node_modules/@tiptap/extension-table/dist/index.js`
- 后端 sanitize 当前允许 `table/thead/tbody/tr/th/td`，但不允许 `colgroup/col`，也不保留 `table.style`。`backend/services/senseArticleRichContentService.js`
- 后端 style 白名单允许 `background-color`、`text-align`、受限百分比 `width`，但不允许 `vertical-align`、`height`、`border-*`。`backend/services/senseArticleRichContentService.js`
- 当前 AST 物化把表格压缩成 `tableStyle + rows[].cells[] + html`，丢失 `th/td`、`thead/tbody`、`colspan/rowspan`、cell attrs。`backend/services/senseArticleRichContentService.js`
- 当前 compare 对表格只识别文本、`tableStyle`、行列数，不识别 cell 格式和尺寸变化。`backend/services/senseArticleRichCompareService.js`
- 当前 review/history 页面展示的是 compare 卡片，不是完整表格渲染差异。`frontend/src/components/senseArticle/SenseArticleReviewPage.js` `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- 当前 validation 只对空表格给 warning，没有尺寸/边框/模板/结构一致性校验。`backend/services/senseArticleValidationService.js`
- 阅读态 rich renderer 已支持 `col` / `colgroup` 和通用 style/class 渲染，说明 renderer 不是主要瓶颈。`frontend/src/components/senseArticle/SenseArticleRichRenderer.js`
- 编辑态和阅读态共用 `.sense-rich-table` 样式，表格横向滚动由 `.tableWrapper` 负责。`frontend/src/components/senseArticle/SenseArticle.css`
- 当前 sticky 工具栏 shell 已有高度测量和 scroll-margin 补偿，适合挂第二条表格上下文工具带。`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` `frontend/src/components/senseArticle/SenseArticle.css`
- 当前项目已有 dialog、color popover、selection toolbar、pointer drag 的成熟模式，可复用但不应直接照搬为表格浮层。`frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js` `frontend/src/components/senseArticle/editor/dialogs/TextColorPopover.js` `frontend/src/components/senseArticle/SenseArticlePage.js` `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`
- 当前更适合把“常规/三线/斜线/紧凑/斑马”等做成模板预设 attrs，而不是继续堆 class。`frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js` `backend/services/senseArticleRichCompareService.js`
- 当前最稳妥的上下文工具带方案是在 `RichSenseArticleEditorShell` 的 sticky toolbar shell 内新增第二条 band。`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` `frontend/src/components/senseArticle/SenseArticle.css`
- 当前拖拽优先级建议是“先整体宽度预设，再列宽拖拽”；行高和自由拉伸在现状下明显高风险。`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` `backend/services/senseArticleRichContentService.js`

## 11. 附录：关键文件路径索引
按“前端页面 / 前端编辑器层 / extensions / dialogs / renderer / hooks / 后端 service / serializer / validation / compare / 样式文件”分组列出

前端页面

- `frontend/src/App.js`
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/SenseArticlePage.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleHistoryPage.js`
- `frontend/src/components/senseArticle/SenseArticleComparePanel.js`

前端编辑器层

- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
- `frontend/src/components/senseArticle/editor/RichToolbar.js`
- `frontend/src/components/senseArticle/editor/ToolbarGroup.js`
- `frontend/src/components/senseArticle/editor/ToolbarButton.js`
- `frontend/src/components/senseArticle/editor/richContentState.js`
- `frontend/src/components/senseArticle/editor/extractRichHtmlOutline.js`
- `frontend/src/components/senseArticle/editor/legacyMarkupToRichHtml.js`

extensions

- `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js`
- `frontend/node_modules/@tiptap/extension-table/dist/index.js`
- `frontend/node_modules/@tiptap/extension-table-cell/dist/index.js`
- `frontend/node_modules/@tiptap/extension-table-header/dist/index.js`
- `frontend/node_modules/@tiptap/extension-table-row/dist/index.js`

dialogs

- `frontend/src/components/senseArticle/editor/dialogs/InsertTableDialog.js`
- `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js`
- `frontend/src/components/senseArticle/editor/dialogs/TextColorPopover.js`

renderer

- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/SenseArticleRichRenderer.js`

hooks

- `frontend/src/components/senseArticle/useSenseArticleCompare.js`
- `frontend/src/components/senseArticle/useSenseEditorPreviewPane.js`

后端 service

- `backend/services/senseArticleRichContentService.js`
- `backend/services/senseArticleService.js`
- `backend/services/senseArticleDiffService.js`

serializer

- `backend/services/senseArticleSerializer.js`

validation

- `backend/services/senseArticleValidationService.js`

compare

- `backend/services/senseArticleRichCompareService.js`
- `backend/services/senseArticleDiffService.js`

后端 model

- `backend/models/SenseArticleRevision.js`
- `backend/models/NodeSense.js`

样式文件

- `frontend/src/components/senseArticle/SenseArticle.css`

测试文件

- `backend/tests/senseArticleRichContent.test.js`
- `backend/tests/senseArticleValidation.test.js`
- `frontend/src/components/senseArticle/editor/paste/normalizePastedContent.test.js`
- `frontend/src/components/senseArticle/editor/paste/markdownToRichContent.test.js`

未找到项索引

- 编辑器内表格右键菜单：未找到
- 编辑器内 BubbleMenu / FloatingMenu：未找到
- merge/split 的现有 UI 入口：未找到
- 单元格背景色现有 UI：未找到
- 单元格垂直对齐现有 UI：未找到
- 边框控制现有 UI：未找到
- 行高拖拽现有实现：未找到
- 斜线表头/斜线单元格现有实现：未找到
- 三线表/三栏表现有模板：未找到
