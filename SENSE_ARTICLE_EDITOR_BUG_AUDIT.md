# SENSE_ARTICLE_EDITOR_BUG_AUDIT

> 审计方式：静态代码审计  
> 审计日期：2026-03-11  
> 审计范围：当前仓库 `frontend/src/components/senseArticle/` 及其上层页面装配链路  
> 说明：本报告基于“当前仓库状态”撰写，只做信息收集、链路梳理、根因判断与证据整理，不包含修复 patch。

# 1. 审计范围

本次重点检查了以下目录与文件：

- 富文本主链路
  - `frontend/src/components/senseArticle/SenseArticleEditor.js`
  - `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
  - `frontend/src/components/senseArticle/editor/RichToolbar.js`
  - `frontend/src/components/senseArticle/editor/TableContextBand.js`
  - `frontend/src/components/senseArticle/editor/richContentState.js`
- 表格相关
  - `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js`
  - `frontend/src/components/senseArticle/editor/table/tableSchema.js`
  - `frontend/src/components/senseArticle/editor/table/tableSelectionState.js`
  - `frontend/src/components/senseArticle/editor/dialogs/TableCellFormatPopover.js`
  - `frontend/src/components/senseArticle/editor/dialogs/TableBorderPopover.js`
- 列表 / 缩进 / 快捷键相关
  - `frontend/src/components/senseArticle/editor/extensions/ListStyle.js`
  - `frontend/src/components/senseArticle/editor/extensions/Indent.js`
  - `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js`
- 媒体插入相关
  - `frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js`
  - `frontend/src/components/senseArticle/editor/extensions/FigureImage.js`
  - `frontend/src/components/senseArticle/editor/extensions/AudioNode.js`
  - `frontend/src/components/senseArticle/editor/extensions/VideoNode.js`
- 页面层 / 路由层 / 上下文层
  - `frontend/src/App.js`
  - `frontend/src/components/senseArticle/SenseArticlePage.js`
  - `frontend/src/components/senseArticle/SenseArticleDashboardPage.js`
  - `frontend/src/components/senseArticle/senseArticleNavigation.js`
- 状态回写 / 自动保存
  - `frontend/src/components/senseArticle/hooks/useSenseArticleAutosave.js`

主链路文件：

- `SenseArticleEditor.js`
- `RichSenseArticleEditorShell.js`
- `RichToolbar.js`
- `App.js`

外围支撑文件：

- 各扩展、各弹窗、`tableSchema.js`、`tableSelectionState.js`、`useSenseArticleAutosave.js`

未深入检查到的部分：

- 未逐个检查所有 API 后端实现，只检查了前端调用点。
- 未逐个检查 Tiptap / ProseMirror 第三方库源码；对其默认行为的判断属于“根据当前仓库没有覆写该行为而做出的推断”。
- 未做浏览器运行时断点与 transaction 日志采集；因此个别结论仍需运行时日志做最终坐实。

# 2. 编辑器架构概览

## 2.1 当前编辑器框架

当前百科编辑页使用的是 **React + Tiptap 3 + ProseMirror**。

直接证据：

- `frontend/package.json`
  - `@tiptap/react: ^3.20.1`
  - `@tiptap/starter-kit: ^3.20.1`
  - `@tiptap/extension-table*`
  - `@tiptap/extension-task-list`
  - `@tiptap/extension-text-align`

## 2.2 页面层到编辑器层的连接关系

调用关系树：

```text
App.js
└─ SenseArticleEditor
   ├─ 负责加载 revision / 保存草稿 / 提交 / 媒体库
   └─ RichSenseArticleEditorShell
      ├─ useEditor(...) 创建 Tiptap editor
      ├─ RichToolbar
      │  ├─ 链接/表格/媒体/Markdown 对话框
      │  └─ 对齐/列表/缩进/插入命令
      ├─ TableContextBand
      │  └─ 表格结构/格式/边框操作
      └─ EditorContent
```

## 2.3 数据流

### 初始 value 从哪里来

- `SenseArticleEditor.js:80-127`
  - 通过 `senseArticleApi.getRevisionDetail(nodeId, senseId, revisionId)` 加载修订详情。
  - 如果 `contentFormat === 'rich_html'`，直接 `setEditorHtml(nextRevision.editorSource || '<p></p>')`。
  - 如果是旧版 `legacy_markup`，先做 `legacyMarkupToRichHtmlWithDiagnostics(...)` 再 `setEditorHtml(...)`。

### 编辑内容如何回传

- `SenseArticleEditor.js:473-485`
  - `RichSenseArticleEditorShell` 以 `value={editorHtml}`、`onChange={setEditorHtml}` 的形式接入。
- `RichSenseArticleEditorShell.js:193-195`
  - Tiptap `onUpdate` 里直接执行 `onChange(normalizeRichHtmlContent(currentEditor.getHTML()))`。

也就是说：

```text
编辑器 transaction
-> Tiptap onUpdate
-> currentEditor.getHTML()
-> SenseArticleEditor.setEditorHtml(...)
-> 父组件重新 render
-> RichSenseArticleEditorShell 收到新的 value
```

### 保存草稿 / 自动保存 / 再回写

- `SenseArticleEditor.js:177-187`
  - `snapshot` 由 `editorHtml + revisionTitle + note + senseTitle + scope 信息` 组成。
- `SenseArticleEditor.js:210-225`
  - `useSenseArticleAutosave(...)` 监听 `snapshot`。
- `useSenseArticleAutosave.js:129-141`
  - 发现 `snapshotString !== lastSavedSignatureRef.current` 后，延迟 1800ms 自动调用 `saveNow()`。
- `SenseArticleEditor.js:218-225`
  - `onSave` 走 `senseArticleApi.updateDraft(...)`
  - `onAfterSave` 走 `applySavedRevision(response)`
- `SenseArticleEditor.js:189-208`
  - `applySavedRevision` 会更新 `detail.revision` 和 `mediaLibrary`

### 重新 setContent 的链路

- `RichSenseArticleEditorShell.js:224-229`
  - 每次收到新的 `value` 时：
    - 先把 `value` 归一化成 `normalizedValue`
    - 再比较 `areRichHtmlContentsEquivalent(editor.getHTML(), normalizedValue)`
    - 不等时执行 `editor.commands.setContent(normalizedValue, false)`

因此当前编辑器不是完全非受控，而是典型的 **半受控双向同步**：

```text
editor 内部文档
-> onUpdate -> 父 state(editorHtml)
-> 子收到新 value
-> 可能再次 setContent(...)
```

## 2.4 焦点 / selection / transaction / React re-render 的相互影响

几个关键点：

1. `RichToolbar` 里大量命令使用 `editor.chain().focus().xxx().run()`。
2. `RichToolbar` 对弹窗类操作有 `preserveSelection()` / `restoreSelectionFromBookmark()`。
3. `TableContextBand` 还有自己单独的一套 `lastTableSelectionBookmarkRef`，用于恢复“最近一次表格选区”。
4. `RichSenseArticleEditorShell` 会在 `value` 变化时重新比较并可能 `setContent(...)`。
5. `RichSenseArticleEditorShell` 还会在 `[scopedFocus, value]` 变化时执行 `matched.scrollIntoView(...)`。
6. `DialogFrame` 弹窗卸载时会把焦点还给“弹窗打开前的元素”。

这意味着当前实现里同时存在：

- 编辑器内部 selection
- 工具栏保存的 selection bookmark
- 表格 band 保存的 table selection bookmark
- React 父组件回写 value
- 弹窗关闭时的 DOM focus restore
- scopedFocus 自动滚动

这是一个高耦合实现，任何一个环路处理不稳，都会出现“闪一下”“样式回滚”“光标丢失”“页面跳到顶部/别处”的症状。

# 3. 文件清单与职责表

| 文件路径 | 组件/模块名 | 主要职责 | 与 3 类 bug 相关度 | 备注 |
| --- | --- | --- | --- | --- |
| `frontend/src/components/senseArticle/SenseArticleEditor.js` | `SenseArticleEditor` | 编辑页加载、保存、提交、媒体上传、向 shell 传 value/onChange | 高 | 半受控上层入口 |
| `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` | `RichSenseArticleEditorShell` | `useEditor` 创建、扩展装配、`onUpdate`、`setContent` 回写、表格 overlay、scopedFocus 滚动 | 极高 | 3 类问题都经过这里 |
| `frontend/src/components/senseArticle/editor/RichToolbar.js` | `RichToolbar` | 工具栏命令、弹窗状态、selection bookmark、媒体/表格/链接插入 | 极高 | 对齐、列表、媒体主入口 |
| `frontend/src/components/senseArticle/editor/TableContextBand.js` | `TableContextBand` | 表格结构、格式、边框操作 | 极高 | 表格样式问题主链路 |
| `frontend/src/components/senseArticle/editor/richContentState.js` | rich html 规范化工具 | HTML 归一化、canonical compare | 高 | 决定 `setContent` 是否触发 |
| `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js` | `TableStyleExtension` | table / cell attrs schema、renderHTML、TableView、table commands | 极高 | 表格 attrs 是否能持久化 |
| `frontend/src/components/senseArticle/editor/table/tableSchema.js` | table schema utils | table/cell attrs 默认值、标准化、inline style/data-attr 输出 | 极高 | 样式是否真正写入 HTML |
| `frontend/src/components/senseArticle/editor/table/tableSelectionState.js` | selection helpers | 当前表格状态、整表选中、批量改单元格 attrs | 极高 | 表格 UI 状态来源 |
| `frontend/src/components/senseArticle/editor/extensions/ListStyle.js` | `RichBulletList`/`RichOrderedList` | 列表样式 attrs 和切换命令 | 高 | 只管样式，不管 Tab |
| `frontend/src/components/senseArticle/editor/extensions/Indent.js` | `Indent` | 段落级 indent attrs 和 increase/decrease 命令 | 高 | 可能与列表缩进语义冲突 |
| `frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js` | `InsertMediaDialog` | 上传/URL/媒体库插入 UI | 高 | 媒体链路中段 |
| `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js` | `DialogFrame` | Portal、焦点陷阱、关闭时 focus restore | 极高 | 媒体插入后失活的强证据点 |
| `frontend/src/components/senseArticle/editor/extensions/FigureImage.js` | `FigureImage` | 图片 atom node | 中 | 媒体插入终点 |
| `frontend/src/components/senseArticle/editor/extensions/AudioNode.js` | `AudioNode` | 音频 atom node | 中 | 媒体插入终点 |
| `frontend/src/components/senseArticle/editor/extensions/VideoNode.js` | `VideoNode` | 视频 atom node | 中 | 媒体插入终点 |
| `frontend/src/components/senseArticle/hooks/useSenseArticleAutosave.js` | `useSenseArticleAutosave` | autosave 定时与 onAfterSave | 中 | 会触发额外 re-render |
| `frontend/src/App.js` | App view/router shell | `view` 与 `senseArticleContext` 切换、错误边界装配 | 高 | 判断“是否真的跳页”必须看这里 |
| `frontend/src/components/senseArticle/senseArticleNavigation.js` | nav helpers | subview context 构建与比较 | 中 | 分析 remount/resetKey 用 |
| `frontend/src/components/senseArticle/SenseArticle.css` | 样式表 | 编辑器表格/列表/选区/页面背景/toolbar/table css | 高 | 决定 attrs 是否被可视化消费 |

# 4. 三类问题的逐项深挖

## 4.1 表格样式设置不生效

### 4.1.1 “居中”按钮点击后触发了什么 command

当前仓库中，表格内对齐不再由表格弹窗单独处理，而是由上层 `RichToolbar` 的 `applyAlignment(value)` 接管。

关键代码：

- `frontend/src/components/senseArticle/editor/RichToolbar.js:151-167`

摘要：

- 先 `restoreSelectionFromBookmark()`
- 再调用 `getTableSelectionState(editor)`
- 如果当前在表格中：
  - 整表选中时：`setTableAlign(...)` / `setTableWidth(...)`
  - 否则：`applyAttrsToSelectedTableCells(editor, { textAlign: value })`
- 如果不在表格中：`editor.chain().focus().setTextAlign(value).run()`

结论：

- 表格单元格内点击“居中”，当前实现不是 `setTextAlign`，而是 `applyAttrsToSelectedTableCells(..., { textAlign: 'center' })`。
- 整表选中时，才会改 table 级 attrs `tableAlign`。

### 4.1.2 command 是否真的执行成功

从静态代码看，表格单元格 attrs 更新命令本身是“真 dispatch transaction”的，不是只改 DOM。

关键代码：

- `frontend/src/components/senseArticle/editor/table/tableSelectionState.js:124-153`

摘要：

- `getSelectedTableCellEntries(editor)` 先解析当前选中的 cell 列表
- 对每个 cell 做 `tr.setNodeMarkup(entry.pos, undefined, nextAttrs)`
- 最后 `editor.view.dispatch(tr)`
- 再 `editor.view.focus()`

结论：

- 这不是只改 CSS class 的假动作。
- 只要 `entries.length > 0` 且 patch 有变化，ProseMirror transaction 会真正提交到 document。

### 4.1.3 attrs 是否真的被 schema 支持并写回 HTML

支持。

证据链：

- `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js:220-258`
  - `textAlign`、`verticalAlign`、`backgroundColor`、`textColor`、`borderEdges`、`borderWidth`、`borderColor`、`diagonalMode` 都被定义为 cell attrs
- `frontend/src/components/senseArticle/editor/table/tableSchema.js:170-187`
  - 这些 attrs 会被写入 `data-align`、`data-background-color`、`data-border-width`、`data-border-color` 等 data attrs
- `frontend/src/components/senseArticle/editor/table/tableSchema.js:190-221`
  - 同时会被转成 inline style，例如：
    - `text-align: center`
    - `background-color: ...`
    - `border-top/right/bottom/left: ...`

结论：

- schema 层不是“没定义 attr”。
- renderer 层也不是“写了 attr 但没消费”。
- 表格样式持久化的契约在当前代码里是完整的。

### 4.1.4 为什么 UI 会“闪一下”

当前最强证据指向：**transaction 已经提交，但随后又可能被上层 value 同步链路回写或重建 selection/focus，造成视觉上只短暂生效。**

核心环路：

- `RichSenseArticleEditorShell.js:193-195`
  - `onUpdate -> onChange(normalizeRichHtmlContent(editor.getHTML()))`
- `SenseArticleEditor.js:473-485`
  - `onChange={setEditorHtml}`
- `RichSenseArticleEditorShell.js:224-229`
  - `value` 变化后再次比较，不等则 `editor.commands.setContent(normalizedValue, false)`

这条链路本质上是：

```text
表格命令改 document
-> onUpdate 触发
-> 父组件 setEditorHtml
-> 子组件重新收到 value
-> 有机会再次 setContent(...)
```

当前仓库已经加了 `areRichHtmlContentsEquivalent(...)`，会减少误判，但它不能从静态层面 100% 证明“所有 table style HTML 序列化差异都被消掉了”。

尤其是表格这里同时混用：

- table node attrs
- cell node attrs
- inline style
- data-* attrs
- 自定义 TableView 直接改 DOM

对应代码：

- `TableStyleExtension.js:52-82`
  - `RichTableView.applyRichAttributes(node)` 会直接改 `this.table.className`、`this.table.style.width`、`this.table.style.marginLeft/Right`、`data-*`
- `TableStyleExtension.js:144-167`
  - `renderHTML` 也会输出 class/style/data-*

这意味着编辑态 DOM 既受 ProseMirror renderHTML 支配，又受 TableView `update()` 直接改 DOM 支配。只要 `editor.getHTML()` 的序列化结果与父级 `value` 比较口径有一点差异，就会触发 `setContent`，然后出现“闪一下”。

### 4.1.5 为什么“居中”可能没表现为光标真正居中

这里要分两个层面：

1. **cell attrs 是否改了**
   - 从静态代码看，改了。
2. **用户看到的 caret 是否立刻在视觉中心**
   - 不一定。

原因：

- `text-align` 是写在 `td/th` 上，不是写在内部段落节点上。
  - 证据：`tableSchema.js:190-203`
- 如果随后 selection / focus 被恢复到别处，或者编辑器在 `setContent` 后重置 selection，用户看到的 caret 位置会回到“默认左侧文本起点”的感觉。

静态证据支持“selection/focus 有二次干预”的位置：

- `RichToolbar.js:121-149` selection bookmark restore
- `tableSelectionState.js:151-152` 更新完 attrs 后强制 `editor.view.focus()`
- `TableContextBand.js:142-162` 表格 band 自己还有一套 bookmark restore
- `RichSenseArticleEditorShell.js:224-229` prop 回写时可能 `setContent`

因此“样式 transaction 已经提交，但 caret/selection 又被恢复/重建”是完全可能的。

### 4.1.6 边框颜色 / 粗细为什么也会“闪一下”

边框链路与对齐链路不同点在于：它除了改单元格 attrs，还叠加了 table preset class。

链路一：表格 preset

- `TableContextBand.js:398-402`
  - `editor.chain().focus().setTableBorderPreset(value).run()`
- `TableStyleExtension.js:186-188`
  - 实际上是 `commands.updateAttributes('table', { tableBorderPreset: ... })`
- `tableSchema.js:138-145`
  - preset 会转成 `table-border-all` / `table-border-none` / `table-border-three-line` 等 class
- `SenseArticle.css:2664-2735`
  - CSS 用这些 class 画表级边框

链路二：单元格边框覆盖

- `TableContextBand.js:403-412`
  - 改 `borderEdges / borderWidth / borderColor`
- `tableSchema.js:205-220`
  - 生成每个单元格四边的 inline border style

这两层叠加关系见：

- `TableBorderPopover.js:138-140`
  - 文案就写着“单元格显式边框优先于表格 preset”

所以边框“闪一下”的可能路径有两个：

1. transaction 成功，但之后被 `value -> setContent` 覆盖回旧内容  
2. table preset class 和 cell inline border 同时存在，视觉上被另一层覆盖，看起来像没生效

第 2 点不是空猜，代码里确实存在“表格 preset class 画边框”和“单元格 inline border 再覆盖”的双通道。

### 4.1.7 是否存在“focus 之后 selection 丢失”

存在明显风险。

证据：

- `RichToolbar.js:151-167`：对齐命令前先 restore bookmark，再 `editor.chain().focus()`
- `TableContextBand.js:142-162`：表格工具操作前会尝试恢复“上一次表格选区”
- `tableSelectionState.js:150-152`：批量改单元格 attrs 后再次 `focus()`

这意味着同一次操作中，selection 至少可能被以下三处碰到：

- toolbar bookmark restore
- table band bookmark restore
- command 完成后的 `focus()`

如果 bookmark 已过期或 doc 已被修改，selection 很容易和用户当前看到的位置脱节。

### 4.1.8 是否存在“属性更新被 setContent 覆盖”

存在明确风险，且是本组问题的 P0 候选根因。

证据：

- `RichSenseArticleEditorShell.js:193-195`
  - 每次内部 transaction 都立刻把 `editor.getHTML()` 回传父组件
- `RichSenseArticleEditorShell.js:224-229`
  - 子组件又会根据新的 `value` 决定是否 `setContent(...)`

只要出现以下任一情况，就会覆盖掉刚刚的 table attrs：

- `editor.getHTML()` 与 `value` 的 canonical compare 仍有漏网差异
- 父组件持有的 `editorHtml` 本身晚于当前 transaction
- autosave / applySavedRevision 带来的上层 re-render 把旧 snapshot 再喂回来

### 4.1.9 是否存在“DOM 临时变化但 document state 没变”

对于 table 级样式，存在这类风险，因为 `RichTableView` 直接操作 DOM。

证据：

- `TableStyleExtension.js:52-82`
  - `this.table.className = ...`
  - `this.table.style.width = ...`
  - `this.table.style.marginLeft = ...`
  - `this.table.style.marginRight = ...`
  - `setAttribute(data-*)`

虽然这些值是从 node attrs 推导出来的，但编辑态确实同时存在：

- 文档 attrs
- renderHTML 输出
- TableView 直接 DOM patch

因此如果文档 attrs 没真正落进去，或者落进去后又被覆盖，DOM 仍可能短暂反映一次新样式，于是出现“闪一下”。

### 4.1.10 是否是整个编辑区域背景画布导致的

从当前 CSS 看，**“整个编辑区域背景画布导致表格样式失效”不是主因**。

证据：

- `SenseArticle.css:2372-2379`
  - 编辑面板背景是浅色 `rgba(248, 250, 252, 0.98)` 的容器背景
- `SenseArticle.css:2538-2548`
  - 表格本身背景独立为 `rgba(255, 255, 255, 0.96)`
- `SenseArticle.css:2596-2609`
  - `th/td` 自己有独立 border/padding/transition

当前 CSS 不存在“外层画布统一覆盖表格边框/对齐”的规则。

更接近问题本身的 CSS 反而是：

- `SenseArticle.css:2766-2778`
  - `.selectedCell` / `.sense-table-active-cell` 用 `box-shadow` 高亮当前单元格

当前仓库里这套高亮不再直接写 `background`，所以“背景色被高亮遮住”的历史问题在当前代码中已减弱，但它不能解释“边框/对齐闪一下后回滚”。

### 4.1.11 本组问题最可能根因 Top 1~3

#### Top 1

**半受控回写环路导致 table attrs 在 transaction 后被二次 `setContent` 覆盖或 selection 重建。**

证据链：

- `RichSenseArticleEditorShell.js:193-195`
- `SenseArticleEditor.js:473-485`
- `RichSenseArticleEditorShell.js:224-229`
- `TableStyleExtension.js:52-82`

为什么相关：

- 症状“闪一下”最符合“先成功提交，再被回写打掉”。

#### Top 2

**表格操作同时存在 toolbar bookmark、table bookmark、focus()、TableView DOM patch，多重 selection/focus 干预导致用户视觉上看不到真正持久的结果。**

证据链：

- `RichToolbar.js:121-167`
- `TableContextBand.js:142-180`
- `tableSelectionState.js:150-152`
- `TableStyleExtension.js:52-82`

#### Top 3

**表格 preset class 与单元格 inline border 是双层边框体系，用户看到的边框效果可能被另一层覆盖，误判为“没生效”。**

证据链：

- `TableBorderPopover.js:138-140`
- `tableSchema.js:138-145`
- `tableSchema.js:205-220`
- `SenseArticle.css:2664-2735`

### 4.1.12 还缺什么信息才能 100% 定论

- 点击“居中”前后，`editor.state.doc.toJSON()` 是否真的变化
- 点击“居中”前后，`editor.getHTML()` 与父组件 `editorHtml` 的差异
- `RichSenseArticleEditorShell` 的 `setContent(...)` 是否在该操作后立刻执行
- `selection` 在命令后是否被 bookmark 恢复到了别处

---

## 4.2 列表 Tab / 缩进 / 光标消失

### 4.2.1 当前 ordered / bullet list 用的是哪套扩展

证据：

- `RichSenseArticleEditorShell.js:115-123`
  - `StarterKit.configure({ bulletList: false, orderedList: false })`
  - 再挂自定义 `RichBulletList`、`RichOrderedList`
- `ListStyle.js:17-61`
  - 自定义只扩展了 `listStyleType` attrs 与 `setBulletListStyle` / `setOrderedListStyle`

结论：

- 当前列表结构底层仍是 Tiptap 的 bullet/ordered list 体系。
- 仓库自定义的只是“列表样式 type”，不是 Tab/Enter 的键盘行为。

### 4.2.2 Tab 键被谁接管

**当前仓库里没有发现任何编辑器内自定义 Tab 处理。**

搜索结果：

- 全局搜索 `addKeyboardShortcuts` / `handleKeyDown` / `keyboardShortcut` / `Tab`
- 结果中与编辑器正文相关的自定义 Tab 逻辑没有出现
- 唯一明确处理 `Tab` 的地方是 `DialogFrame.js:31-42`
  - 这是弹窗 focus trap，不是编辑器正文

结论：

- 编辑器正文中的 Tab 行为依赖 Tiptap / ProseMirror 默认 keymap。
- 仓库里没有自定义 `sinkListItem` / `liftListItem` / `ListKeymap` 覆写。

### 4.2.3 为什么“先回车，再 Tab”才能出现下一级

这点与当前代码高度一致，且更像 **默认列表语义**，不是仓库特有 bug。

理由：

1. 仓库没有覆写 Tab 行为。
2. 默认列表“下沉到子级”通常要求当前 list item 之前存在可挂载的兄弟项。
3. 新建一个列表后，用户通常站在第一条 list item 上；此时直接 Tab 没有可下沉的前序项，所以不会形成子级。
4. 先按 Enter 生成下一条 list item 后，再在第二条上 Tab，才具备“下沉到上一项之下”的结构条件。

与代码关联的证据：

- `RichToolbar.js:384-398`
  - 点击有序/无序列表按钮，只是 `toggleBulletList()` / `toggleOrderedList()`
  - 没有任何“创建二级列表”的自定义命令

因此：

- “先回车，再 Tab 才有下一级”在当前实现下并不奇怪。
- 如果产品预期是“第一项也能直接 Tab 进入二级列表”，那需要额外自定义键盘策略；当前仓库没有。

### 4.2.4 为什么出现下一级后光标会丢失

静态上有两个高风险路径。

#### 路径 A：Tab 没有被仓库显式接管，浏览器默认 focus traversal 仍可能介入

证据：

- 没有编辑器内的自定义 `Tab` handler
- 没有 `handleKeyDown` 针对正文 Tab 做 `preventDefault()`

这意味着只要默认 keymap 在某些 list 状态下没有成功截获，浏览器就会把焦点移到下一个 focusable 元素，表现为“光标没了，需要重新点一下”。

#### 路径 B：列表 transaction 后，外层半受控回写触发 `setContent(...)`，selection 被重建

证据：

- `RichSenseArticleEditorShell.js:193-195`
- `RichSenseArticleEditorShell.js:224-229`

这条链路并不专属于表格，对列表同样成立。  
如果 Tab 后父组件回写 value 再触发 `setContent(...)`，selection 很容易丢失。

### 4.2.5 是否存在自定义 Indent 扩展与列表扩展冲突

存在结构层面的潜在冲突，但当前静态证据不足以把它定为主因。

证据：

- `Indent.js:3`
  - `INDENT_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock']`
- `Indent.js:36-48`
  - `increaseIndent/decreaseIndent` 实际做的是 `updateAttributes(type, { indent: ... })`
- `RichToolbar.js:375-381`
  - 工具栏上“增加缩进/减少缩进”始终存在

关键点：

- `Indent` 管的是段落节点 attrs，不是 list nesting。
- 对列表来说，用户通常把 “Tab” 理解成“进入子级列表”，而这里另有一套“段落 indent”命令。

结论：

- 当前仓库里同时存在“列表层级缩进”和“段落 data-indent 缩进”两套概念。
- 这会让交互语义混乱，但静态上还不能证明它直接导致了“Tab 后光标丢失”。

### 4.2.6 Tab 事件完整流转路径

基于当前仓库可还原的路径：

```text
用户在 EditorContent 内按 Tab
-> 当前仓库没有自定义正文 Tab handler
-> 进入 Tiptap / ProseMirror 默认 keymap（推断）
-> 若当前状态可 sink list item，则 transaction 生效
-> onUpdate -> onChange(editorHtml)
-> 父组件 re-render
-> 子组件收到新 value
-> 可能 setContent(...)
-> selection/focus 可能保持，也可能丢失

若默认 keymap未截获
-> 浏览器原生 Tab focus traversal
-> 光标直接离开编辑器
```

### 4.2.7 光标丢失发生在什么阶段

静态最可疑的阶段有两个：

1. **Tab 默认行为未被截获，浏览器直接切焦点**
2. **transaction 成功后，半受控 `setContent(...)` 重建 selection**

当前仓库没有任何“list 专属 blur() / focus() / setTextSelection()”代码，因此不支持“是某个显式列表函数把光标弄丢了”的说法。

### 4.2.8 涉及哪些扩展 / 快捷键定义

- `RichBulletList` / `RichOrderedList`
  - `ListStyle.js:17-61`
  - 仅扩展列表样式，不含键盘快捷键
- `Indent`
  - `Indent.js:8-50`
  - 仅提供 toolbar 的 increase/decrease indent 命令
- `StarterKit`
  - `RichSenseArticleEditorShell.js:115-121`
  - 真正的 Enter / list behavior 主要依赖这里及 Tiptap 默认 list 行为
- `DialogFrame`
  - `DialogFrame.js:31-42`
  - 只在弹窗打开时拦截 Tab，不影响编辑器平时正文

### 4.2.9 本组结论

最接近事实的静态结论是：

1. “先回车，再 Tab 才出现下一级”与当前仓库没有自定义 Tab 行为、依赖默认列表下沉语义高度一致。
2. “出现下一级后光标丢失”并没有找到列表专属代码证据，更像：
   - 默认 Tab 没稳定接管，浏览器切焦点
   - 或 transaction 后被上层半受控回写重置了 selection

---

## 4.3 插入图片/音频/视频后页面回第一页并退出编辑

### 4.3.1 工具栏按钮后的完整调用链

静态链路可以完整还原：

```text
RichToolbar 点击“插入图片/音频/视频”
-> openSingleFloatingUi(...)
-> preserveSelection()
-> setMediaDialogKind('image' | 'audio' | 'video')
-> InsertMediaDialog 打开
-> DialogFrame createPortal + 聚焦关闭按钮
-> 用户上传文件 / 选择 URL / 选择已上传资源
-> InsertMediaDialog.handleSubmit()
-> onUpload(...) 可选
-> onSubmit(payload)
-> RichToolbar.handleMediaSubmit(payload)
-> chainWithPreservedSelection().insertFigureImage / insertAudioNode / insertVideoNode
-> closeFloatingUi()
-> DialogFrame 卸载 cleanup
-> previousFocusedElementRef.current.focus()
```

关键代码：

- `RichToolbar.js:272-276`
  - `openSingleFloatingUi()`：保存 selection，然后打开弹窗
- `RichToolbar.js:417-419`
  - 三个媒体按钮
- `InsertMediaDialog.js:122-175`
  - `handleSubmit()`
- `SenseArticleEditor.js:332-342`
  - `uploadMedia(...)`
- `RichToolbar.js:256-270`
  - `handleMediaSubmit(...)`
- `DialogFrame.js:21-50`
  - 打开时记住 `previousFocusedElementRef`，关闭时再 `focus()`

### 4.3.2 是不是显式切回了别的页面

**静态代码没有发现任何“插入媒体后显式调用 `setView(...)` / `navigateSenseArticleSubView(...)` / 路由跳转”的链路。**

反证：

- `RichToolbar.js`
  - 媒体链路里没有 `setView`、没有 `navigateSenseArticleSubView`
- `SenseArticleEditor.js:332-342`
  - 上传后只更新 `mediaLibrary.recentAssets`
- `App.js:636-639`
  - 真正切百科子页只能通过 `navigateSenseArticleSubView(...)`
- 本次审计没有在媒体链路上发现对它的调用

结论：

- “回第一页”不是代码里明文跳回 `senseArticle` / `senseArticleDashboard` 之类的子页。
- 更像是 **焦点被还给页面顶部工具栏按钮，浏览器把视口滚回顶部**，或者 **scopedFocus 的 scrollIntoView 把页面滚到某个上方块**。

### 4.3.3 为什么会“退出编辑状态”

这是本报告里证据最强的一条。

#### 强证据 1：DialogFrame 关闭时强制把焦点还给弹窗打开前的元素

- `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js:21-50`

摘要：

- `open` 时：
  - `previousFocusedElementRef.current = document.activeElement`
  - `closeButtonRef.current?.focus?.()`
- cleanup 时：
  - `previousFocusedElementRef.current?.focus?.()`

而“打开前的元素”对媒体链路来说，正是工具栏上的“插入图片/音频/视频”按钮。

这意味着：

- 关闭弹窗后，焦点会回到顶部工具栏按钮，而不是编辑器正文。
- 浏览器通常会滚动以保证被 focus 的按钮可见。

这与用户描述的两条症状高度吻合：

- “UI 会强制回到第一页”
- “编辑状态被强制退出”

#### 强证据 2：媒体提交成功后，没有任何代码把焦点重新放回编辑器

- `RichToolbar.js:256-270`

摘要：

- `handleMediaSubmit(...)`
  - 插入 node 后只调用 `closeFloatingUi()`
  - **没有调用 `restoreSelection()`**

对比取消关闭：

- `RichToolbar.js:456-459`
  - `onClose` 时会 `restoreSelection(); setMediaDialogKind('');`

但提交成功并不是走 `onClose`，而是直接 `handleMediaSubmit -> closeFloatingUi()`。

结论：

- 媒体插入成功后，焦点恢复逻辑比“取消关闭”还更弱。
- 这足以解释“插入完后几乎无法继续编辑”。

### 4.3.4 为什么会“点回编辑区会刷一下，又马上失效”

这里有两层高风险叠加。

#### 叠加 A：半受控回写

- `RichSenseArticleEditorShell.js:193-195`
- `RichSenseArticleEditorShell.js:224-229`

插入媒体 node 会触发 `onUpdate`，父组件立刻拿到新 HTML，再重新走一轮 `value` 同步。  
如果 compare 失配，`setContent(...)` 会发生。

#### 叠加 B：scopedFocus 会在 `value` 变化时再次滚动到目标块

- `RichSenseArticleEditorShell.js:247-271`

关键点：

- effect 依赖是 `[scopedFocus, value]`
- 每次 `value` 变化，它都会：
  - 在编辑区里找匹配块
  - `matched.scrollIntoView({ block: 'center', behavior: 'smooth' })`

因此只要当前修订是 `selection` / `section` 范围：

- 插入媒体 -> `value` 变 -> `scrollIntoView(...)`
- 用户点回编辑区 -> 下一轮 value/selection 再变 -> 继续滚

这会造成非常强的“页面自己跳”“刚点回去又刷一下”的体感。

### 4.3.5 editor 实例有没有被销毁 / 重建

静态上没有直接证据表明“媒体插入成功后 editor instance 被销毁重建”。

反证：

- `RichSenseArticleEditorShell.js:113-196`
  - `useEditor(...)` 在组件存活时创建 editor
- `App.js:6582-6600`
  - `SenseArticleEditor` 的挂载条件依赖 `view === 'senseArticleEditor' && revisionId`
- 媒体链路里未发现 `navigateSenseArticleSubView(...)`

但存在局部重置风险：

- `RichSenseArticleEditorShell.js:224-229`
  - 可能 `setContent(...)`
- `SenseArticleEditor.js:203-207`
  - 自动保存后会刷新 `mediaLibrary`
- `SenseArticleEditor.js:129-150`
  - `detail` 变化会 `onContextPatch(...)` 到 App 级 context

所以更像是：

- **不是 editor instance 整体重建**
- 而是 **focus / selection / value / scroll 被多方重置**

### 4.3.6 “第一页”到底更像什么

从当前代码看，它更像下面二者之一，而不是百科子页路由切换：

1. **编辑页顶部工具栏重新获得 focus，浏览器滚动到顶部**
   - 证据：`DialogFrame.js:48`
2. **scopedFocus 重新 `scrollIntoView` 到上方目标块**
   - 证据：`RichSenseArticleEditorShell.js:247-271`

反而不像这些：

- 顶层 `view` 切回 `senseArticle`
  - 没找到媒体链路上的 `setView(...)`
- `pageIndex/currentPage` 被重置
  - 在当前编辑器主链路里没有对应状态
- 路由跳转
  - 没有媒体插入后导航代码

### 4.3.7 本组结论

本组问题最强静态结论是：

1. **媒体插入后“退出编辑状态”是实锤风险**  
   原因是 `DialogFrame` 关闭时会把焦点还给工具栏按钮，而 `handleMediaSubmit` 本身没有恢复 editor selection/focus。

2. **“回第一页”更像是焦点回到顶部按钮引发的浏览器滚动，而不是页面路由跳转。**

3. **“点回去又刷一下”很像 `value` 回写 + `scopedFocus.scrollIntoView(...)` 的叠加表现。**

# 5. 焦点与状态回写专项分析

## 5.1 当前编辑器是不是“半受控”

是。

证据：

- 父组件持有 `editorHtml` state：`SenseArticleEditor.js:39`
- 子组件拿 `value`：`SenseArticleEditor.js:473-485`
- 子组件内部 `onUpdate -> onChange`：`RichSenseArticleEditorShell.js:193-195`
- 子组件收到新 `value` 后可能再 `setContent(...)`：`RichSenseArticleEditorShell.js:224-229`

这就是典型半受控。

## 5.2 `value` 和 `editor.getHTML()` 如何双向同步

```text
editor 内部变更
-> currentEditor.getHTML()
-> normalizeRichHtmlContent(...)
-> onChange(...)
-> SenseArticleEditor.setEditorHtml(...)
-> RichSenseArticleEditorShell 收到新的 value
-> areRichHtmlContentsEquivalent(...)
-> 不等则 editor.commands.setContent(...)
```

关键位置：

- `SenseArticleEditor.js:39`
- `SenseArticleEditor.js:64`
- `RichSenseArticleEditorShell.js:193-195`
- `RichSenseArticleEditorShell.js:224-229`
- `richContentState.js:71-96`

## 5.3 有没有典型的“内部刚改完，父组件又用旧 value 覆盖回来”的风险

有，而且这是当前实现的核心系统性风险。

最危险的场景：

1. 表格 cell attrs / table attrs 这类 HTML 序列化较复杂的节点
2. 列表嵌套这种会改变结构的 transaction
3. 媒体 atom node 插入

因为这三类操作都会立即触发：

- `onUpdate`
- 父 state 更新
- 再比较 HTML
- 必要时 `setContent(...)`

## 5.4 哪些 `useEffect` / `onUpdate` / `setContent` 最可疑

### 可疑 1

- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:193-195`

原因：

- 所有编辑 transaction 的入口都会经过这里。

### 可疑 2

- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:224-229`

原因：

- 这是唯一明确会把父组件 `value` 再灌回 editor 的地方。

### 可疑 3

- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:247-271`

原因：

- `value` 每次变化都可能触发 `scrollIntoView(...)`。

### 可疑 4

- `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js:21-50`

原因：

- 弹窗关闭时会把焦点还给打开按钮。

## 5.5 哪些场景会导致 selection 或 focus 丢失

1. 弹窗打开 / 关闭
   - `DialogFrame.js:21-50`
2. toolbar 通过 bookmark restore 后再 `focus()`
   - `RichToolbar.js:121-167`
3. table band 恢复旧 table bookmark
   - `TableContextBand.js:124-180`
4. cell attrs 更新后额外 `editor.view.focus()`
   - `tableSelectionState.js:150-152`
5. prop 回写触发 `setContent(...)`
   - `RichSenseArticleEditorShell.js:224-229`

## 5.6 哪些操作后 editor instance 可能被重新创建

静态上没有看到“普通编辑操作会重建 editor instance”的直接代码。

真正可能造成页面级 remount 的条件在 `App.js`：

- `App.js:6582-6600`
  - `view === 'senseArticleEditor' && senseArticleContext.revisionId`
- `App.js:6584`
  - 错误边界 `resetKey` 依赖 `view/nodeId/senseId/revisionId`

因此只有这些场景更像重建：

- `view` 切换
- `revisionId` 切换
- 组件抛错进入 error boundary 后 reset

媒体插入链路里没看到显式满足这些条件的代码，所以“媒体后失活”不必假设 editor 被 remount。

## 5.7 高风险状态环路图

### 环路 A：表格 / 列表 / 媒体通用

```text
toolbar click / keyboard action
-> command run
-> editor transaction
-> onUpdate
-> onChange(editorHtml)
-> parent state update
-> child props change(value)
-> areRichHtmlContentsEquivalent(...)
-> editor.commands.setContent(...)
-> selection/focus 可能被重建
```

### 环路 B：媒体弹窗

```text
toolbar media button
-> preserveSelection()
-> DialogFrame open
-> closeButton.focus()
-> 上传/提交
-> insertFigureImage / insertAudioNode / insertVideoNode
-> closeFloatingUi()
-> DialogFrame cleanup
-> previousFocusedElement.focus()   // 工具栏按钮重新获得焦点
-> 浏览器滚动到顶部按钮
-> 编辑器失焦
```

### 环路 C：局部修订自动滚动

```text
插入媒体 / 修改内容
-> value 变化
-> scopedFocus effect
-> matched.scrollIntoView(...)
-> 页面视口被再次拉回目标块
```

# 6. 与问题最相关的代码位置索引

- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` 第 113-196 行：`useEditor` 装配、扩展列表、`onUpdate`
- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` 第 224-229 行：`value` 回写 `setContent(...)`
- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` 第 247-271 行：`scopedFocus` 在 `value` 变化时 `scrollIntoView(...)`
- `frontend/src/components/senseArticle/editor/RichToolbar.js` 第 121-149 行：selection bookmark 保存/恢复
- `frontend/src/components/senseArticle/editor/RichToolbar.js` 第 151-167 行：顶部对齐命令在表格内如何分流
- `frontend/src/components/senseArticle/editor/RichToolbar.js` 第 244-270 行：插表格 / 插媒体的命令提交点
- `frontend/src/components/senseArticle/editor/RichToolbar.js` 第 272-276 行：`openSingleFloatingUi()` 保存 selection
- `frontend/src/components/senseArticle/editor/RichToolbar.js` 第 452-463 行：`InsertMediaDialog` 的打开/关闭接线
- `frontend/src/components/senseArticle/editor/TableContextBand.js` 第 142-180 行：恢复最近表格选区后再执行命令
- `frontend/src/components/senseArticle/editor/TableContextBand.js` 第 393-422 行：边框 preset / 宽度 / 颜色 / 清除覆盖
- `frontend/src/components/senseArticle/editor/table/tableSelectionState.js` 第 124-153 行：批量改单元格 attrs 并 dispatch transaction
- `frontend/src/components/senseArticle/editor/table/tableSelectionState.js` 第 243-317 行：表格状态源 `getTableSelectionState(...)`
- `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js` 第 40-82 行：`RichTableView` 直接改 DOM
- `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js` 第 108-141 行：table attrs schema
- `frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js` 第 211-275 行：cell attrs schema / renderHTML
- `frontend/src/components/senseArticle/editor/table/tableSchema.js` 第 124-159 行：table attrs 标准化、对齐/宽度 style 生成
- `frontend/src/components/senseArticle/editor/table/tableSchema.js` 第 170-221 行：cell attrs -> data attrs + inline style
- `frontend/src/components/senseArticle/editor/extensions/ListStyle.js` 第 17-61 行：列表样式扩展，没有 Tab 逻辑
- `frontend/src/components/senseArticle/editor/extensions/Indent.js` 第 17-48 行：段落级 indent attrs 与命令
- `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js` 第 21-50 行：弹窗关闭时的焦点恢复
- `frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js` 第 122-175 行：上传/URL 媒体提交逻辑
- `frontend/src/components/senseArticle/SenseArticleEditor.js` 第 177-225 行：snapshot + autosave + onAfterSave
- `frontend/src/components/senseArticle/SenseArticleEditor.js` 第 332-342 行：媒体上传后刷新 mediaLibrary
- `frontend/src/App.js` 第 636-639 行：真正的百科子页切换只经过 `navigateSenseArticleSubView(...)`
- `frontend/src/App.js` 第 6582-6600 行：编辑页挂载与 error boundary `resetKey`
- `frontend/src/components/senseArticle/SenseArticle.css` 第 2538-2778 行：表格对齐、边框、单元格高亮 CSS

# 7. 初步根因判断

## P0：最可能的根因

**编辑器采用半受控实现，`onUpdate -> onChange -> value 回写 -> 可能 setContent(...)` 是三类问题共同的高风险状态环路。**

可验证性：

- 给 `RichSenseArticleEditorShell.js:224-229` 加日志即可验证某次问题操作后是否发生 `setContent(...)`。

## P1：次可能根因

**媒体弹窗关闭时焦点被 `DialogFrame` 强制还给工具栏按钮，而提交成功路径没有重新 focus 编辑器，这是“媒体后失活/回顶部”的最强直接证据。**

可验证性：

- 记录 `document.activeElement` 在媒体提交前后即可坐实。

## P2：外围诱因

**表格实现同时存在 document attrs、renderHTML、TableView 直接 DOM patch、table preset class、cell inline border 多层机制，放大了“闪一下”“看起来没生效”的概率。**

可验证性：

- 记录一次边框修改前后：
  - `doc.toJSON()`
  - `editor.getHTML()`
  - 实际 DOM `td.style.cssText`

## P3：需要运行时验证的点

1. 列表 Tab 后光标丢失，到底是浏览器原生切焦点还是 `setContent(...)` 重建 selection
2. 表格居中/边框失败时，transaction 是否已进 doc，但随后被回滚
3. 媒体插入后的“第一页”是页面滚回顶部，还是 scopedFocus 滚到了某个上方块

# 8. 后续修复前还需要补充的最小信息集

- `RichSenseArticleEditorShell` 中这三个点的运行日志顺序：
  - `onUpdate`
  - `value` 同步 effect
  - `setContent(...)`
- 表格“居中 / 边框颜色 / 边框粗细”操作前后的：
  - `editor.getHTML()`
  - `editor.state.selection`
  - `editor.state.doc.toJSON()`
- 列表按 `Enter` / `Tab` 时：
  - `document.activeElement`
  - 是否触发浏览器默认 Tab 切焦点
- 媒体插入成功前后：
  - `document.activeElement`
  - `window.scrollY`
  - `scopedFocus` effect 是否执行
- 如果要彻底坐实“回第一页”的定义：
  - 录一段最小复现视频
  - 或给出“当时是整页修订、选段修订、还是小节修订”

---

## 补充观察

本次额外执行了 `frontend` 的一次构建检查：`npm run build`。  
结果：构建通过，项目存在若干既有 ESLint warning，但没有暴露出与本次 3 类问题直接对应的编译错误。
