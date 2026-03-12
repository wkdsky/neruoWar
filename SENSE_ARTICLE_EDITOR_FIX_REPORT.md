# SENSE_ARTICLE_EDITOR_FIX_REPORT

## 修改概览

本次修复聚焦 3 类问题：

1. 表格内样式设置闪一下后回退
2. 有序/无序列表的 `Tab` 缩进与光标丢失
3. 插入图片/音频/视频后页面回顶部、退出编辑、再次点击又失效

修复策略遵循“最小侵入但链路正确”：

- 保留现有 React + Tiptap + ProseMirror 架构
- 不替换编辑器框架
- 不大改页面层
- 重点收紧内容同步、焦点恢复、列表快捷键、表格 attrs 更新后的 focus 策略

## 修改文件

- `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
- `frontend/src/components/senseArticle/editor/RichToolbar.js`
- `frontend/src/components/senseArticle/editor/TableContextBand.js`
- `frontend/src/components/senseArticle/editor/ToolbarButton.js`
- `frontend/src/components/senseArticle/editor/table/tableSelectionState.js`
- `frontend/src/components/senseArticle/editor/dialogs/TableCellFormatPopover.js`
- `frontend/src/components/senseArticle/editor/dialogs/TableBorderPopover.js`
- `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js`
- `frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js`
- `frontend/src/components/senseArticle/editor/extensions/ListKeymapExtension.js`
- `frontend/src/components/senseArticle/editor/editorDebug.js`

## 每个文件改了什么

### `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`

改动：

- 新增 `lastEmittedHtmlRef`、`lastAppliedValueRef`、`isApplyingExternalValueRef`
- 收紧 `value -> setContent(...)` 的触发条件
- 只有当外部 `value` 与：
  - 当前 editor HTML
  - 最近一次内部发出的 HTML
  - 最近一次已应用的外部值
  都不等价时，才执行 `setContent(...)`
- `scopedFocus` 自动滚动改成只在“目标变化”时滚动，不再依赖每次 `value` 变化
- 挂载新的 `ListKeymapExtension`
- 新增 editor 内部 `dragstart/drop` 拦截，禁止非媒体文本在 editor 内被原生拖拽搬移
- 整表选中按钮不再在选中后额外强制 focus 折叠 selection
- 增加受 debug flag 控制的同步日志

原因：

- 这是表格样式回退、列表 selection 重建、媒体插入后内容再回灌的共性根因点

对应修复：

- 表格样式不持久
- 列表 `Tab` 后 selection 被重建
- 媒体插入后编辑器局部失稳
- `scopedFocus` 放大页面乱滚
- 表格文字被拖到其他单元格
- 整表选中后又退化成单元格光标

### `frontend/src/components/senseArticle/editor/RichToolbar.js`

改动：

- 新增 `focusEditor()` 辅助函数
- 表格单元格对齐改为：更新 attrs 后显式回到 editor focus
- `restoreSelection()` 与普通聚焦改为优先使用 `editor.view.focus()`，避免 `chain().focus()` 对表格 selection 进行二次折叠
- 新增 `applyIndentChange()`：
  - 在 `listItem` 内，工具栏“增加/减少缩进”改走 `sinkListItem/liftListItem`
  - 在普通段落内，仍走原有 `increaseIndent/decreaseIndent`
- 媒体提交流程改为：
  - 用 bookmark 恢复插入位置
  - 插入媒体 node
  - 关闭弹窗后用 `requestAnimationFrame` 显式回到 editor
- 媒体取消关闭流程改为：
  - 不恢复到 toolbar 按钮
  - 弹窗关闭后恢复 bookmark 并 focus editor
- 打开模态型浮层前先 `blur` editor，减少 dialog 交互期间编辑器仍持有活动选择导致的乱滚
- 新增少量 debug 日志

原因：

- 以前媒体成功后只关闭弹窗，没有明确把焦点交还 editor
- 工具栏缩进按钮在列表环境里和“段落 indent”语义混杂

对应修复：

- 媒体插入后退出编辑 / 回顶部
- 列表缩进逻辑不稳定
- 表格对齐后光标体感漂移

### `frontend/src/components/senseArticle/editor/TableContextBand.js`

改动：

- 表格格式/边框 attrs 更新成功后，统一只在 band 层显式 `editor.view.focus()`
- 清除边框覆盖、边框 edge 切换后也走同一策略
- 增加受 debug flag 控制的最小日志

原因：

- 以前表格 attrs 更新后，focus 既可能在 `tableSelectionState` 里强推，也可能在别处再推，来源太多

对应修复：

- 表格垂直对齐、边框颜色、边框粗细、背景色、文本色等操作后更稳定

### `frontend/src/components/senseArticle/editor/table/tableSelectionState.js`

改动：

- `applyAttrsToSelectedTableCells(...)` 不再在底层强制 `editor.view.focus()`
- `selectEntireTable(...)` 不再在底层追加 `focus()`，避免 `CellSelection` 被折叠
- 保留 transaction dispatch
- 补充受 debug flag 控制的 attrs 更新日志

原因：

- 底层工具函数不应该抢最终 focus 策略
- 否则会和 `RichToolbar`、`TableContextBand` 的 bookmark/focus 恢复打架

对应修复：

- 表格样式设置后 selection/focus 不再被多处重复干预

### `frontend/src/components/senseArticle/editor/ToolbarButton.js`

改动：

- 为 toolbar 按钮统一增加 `onMouseDown -> preventDefault()`
- 鼠标点击 toolbar 按钮时不再先把浏览器焦点抢走

原因：

- 以前工具栏按钮会先拿到焦点，再靠 bookmark 把 selection 拉回去
- 这在表格里最容易表现成“每点一次对齐，光标横向跳一个单元格”

对应修复：

- 顶部左/中/右对齐导致表格光标错位

### `frontend/src/components/senseArticle/editor/dialogs/TableCellFormatPopover.js`

改动：

- 表格格式弹层中的 chip / 色块按钮统一在 `mousedown` 阶段 `preventDefault + stopPropagation`

原因：

- 这些按钮原本会先拿走浏览器焦点，导致表格内当前选区在点击弹层瞬间被打断

对应修复：

- “格式布局”里点垂直对齐、底色、文字色、斜线后看不到效果

### `frontend/src/components/senseArticle/editor/dialogs/TableBorderPopover.js`

改动：

- 表格边框弹层中的 preset / edge / 粗细 / 颜色 / 清除按钮统一在 `mousedown` 阶段阻止焦点偷走

原因：

- 和表格格式弹层同理，先保住表格当前选区，命令才能稳定作用在目标单元格

对应修复：

- “表格边框”里点 preset、边框粗细、边框颜色后看不到效果

### `frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js`

改动：

- 新增可配置参数：
  - `restoreFocusOnClose`
  - `restoreFocusTarget`
  - `onAfterCloseFocus`
- 默认 focus restore 保持兼容
- restore 时优先使用 `preventScroll: true`

原因：

- 以前所有弹窗关闭都会无条件把焦点还给“打开前的元素”
- 对媒体场景，这个元素通常就是 toolbar 按钮，直接把视口拉回顶部附近

对应修复：

- 媒体插入后页面回顶部
- 编辑状态被强制退出

### `frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js`

改动：

- 透传 `restoreFocusOnClose` / `restoreFocusTarget` / `onAfterCloseFocus` 给 `DialogFrame`

原因：

- 让媒体弹窗可以单独控制关闭后的焦点策略，而不继承默认“还给工具栏按钮”

对应修复：

- 媒体插入后焦点错误恢复

### `frontend/src/components/senseArticle/editor/extensions/ListKeymapExtension.js`

改动：

- 新增自定义列表快捷键扩展
- 在 `listItem` 环境中显式接管：
  - `Tab` -> `sinkListItem('listItem')`
  - `Shift-Tab` -> `liftListItem('listItem')`
- 在列表环境中无论是否真正下沉/上提，都 `return true`
- 非列表环境不拦截

原因：

- 当前仓库没有稳定的正文内 `Tab` 接管
- 浏览器默认 `Tab` 会把焦点切走

对应修复：

- 列表 `Tab` 缩进不稳定
- `Tab` 后光标消失 / 焦点跳走

### `frontend/src/components/senseArticle/editor/editorDebug.js`

改动：

- 新增统一 debug 工具：
  - `isSenseEditorDebugEnabled()`
  - `senseEditorDebugLog(...)`
- 仅在：
  - `NODE_ENV !== 'production'`
  - 且 `window.__SENSE_EDITOR_DEBUG__ === true`
  时输出日志

原因：

- 需要保留最小运行时观测点，但不能污染生产逻辑

对应修复：

- 为后续验证 `onUpdate`、`setContent`、列表 `Tab`、媒体焦点恢复提供最小调试入口

## 关键修复思路说明

### 1. 为什么这次能压住表格“闪一下”

核心不是改表格 schema，而是收紧外部回灌。

之前：

```text
table attrs 更新
-> onUpdate
-> parent setState(value)
-> child effect 里又可能 setContent(...)
```

现在：

- 先记住最近一次内部发出的 HTML
- 再比较新 `value` 是否只是内部编辑后的同一份内容
- 只有真正外部输入变化才 `setContent(...)`

这样可以明显减少：

- 单元格对齐刚更新就被旧 value 再灌回去
- 边框颜色/粗细改完又被覆盖

### 2. 为什么媒体插入后不会再被 toolbar 抢焦点

核心是两点：

1. `DialogFrame` 不再强制把焦点还给旧按钮
2. 媒体提交成功后，显式把焦点交回 editor

也就是说提交路径现在是：

```text
bookmark 恢复
-> 插入媒体 node
-> 关闭弹窗
-> requestAnimationFrame
-> editor.focus()
```

而不是：

```text
关闭弹窗
-> toolbar button.focus()
```

### 3. 为什么列表 `Tab` 会更稳定

以前仓库没有自己的列表 `Tab` 接管。  
现在明确规定：

- 只要当前 selection 在 `listItem` 内，就由编辑器命令处理
- 不让浏览器把焦点切去下一个按钮或输入框

这直接解决“光标没了、需要重新点”的主问题。

### 4. 为什么这轮又补了表格交互修正

用户追加反馈的 3 个表格交互问题，这轮分别做了对应修正：

1. 表格文字可被拖进别的单元格
   - 在 `RichSenseArticleEditorShell` 里阻止 editor 内部非媒体文本的原生拖放

2. 点击左上角整表选择后只是跑到右下角
   - 在整表选中 helper 与按钮后续逻辑中去掉多余 focus 折叠

3. 顶部左/中/右对齐会把光标往左跳
   - toolbar 按钮 `mousedown` 不再抢焦点
   - 表格命令后的聚焦改成 `editor.view.focus()`，不再额外跑 `chain().focus()`

4. 表格弹层里的按钮点击后仍无效果
   - 对格式/边框弹层内部按钮统一做 `mousedown` 拦截，避免弹层本身把表格选区打断

5. 媒体 dialog 里点击任意位置仍把页面拉回顶部
   - 打开模态前先 `blur` editor
   - dialog 初始 focus 改成 `preventScroll`

## 还剩什么风险

### 已知未完全覆盖的边界

1. 当前 `ListKeymapExtension` 只显式处理 `listItem`
   - 对 `taskItem` 没额外扩展
   - 这次修复目标主要是有序/无序列表

2. 媒体插入后 selection 的最终位置仍取决于 Tiptap `insertContent` 的默认行为
   - 当前已保证回到 editor 并能继续编辑
   - 但“插入后 caret 精确停在 node 前/后”的 UX 仍可能因 node 类型不同略有差异

3. 表格相关命令当前仍保留两套 bookmark 恢复：
   - `RichToolbar`
   - `TableContextBand`
   这次已经把底层强制 `focus()` 移掉，冲突显著减轻，但还不是完全单一实现

4. `scopedFocus` 现在只在目标变化时滚动
   - 这能压住媒体/表格操作带来的乱滚
   - 但如果某些极端场景下“目标没变但内容刚异步加载完”，首次定位体验可能需要再做一轮运行时观察

5. 为了避免表格文本被错误拖放，这次禁止了 editor 内部非媒体文本拖放
   - 如果后续产品希望支持正文拖拽重排，需要再做白名单式设计

6. 表格弹层中的 `input[type=color]` 仍会获得自己的焦点
   - 这通常不影响 attrs 提交
   - 但如果浏览器对原生颜色面板有特殊滚动行为，需要再做一次跨浏览器验证

## 手工测试清单

1. 表格单元格输入文字后点“居中”
   - 观察文字对齐是否稳定
   - 连续输入是否仍在原单元格内

2. 表格里改垂直对齐、背景色、文字色
   - 点击编辑区其他位置再点回
   - 确认样式不回退

3. 表格边框改颜色、粗细
   - 单元格边框覆盖与表格 preset 混用时确认不会闪退

4. 在表格单元格中拖选部分文字
   - 确认不会把文字拖进别的单元格
   - 确认可以保留文本选区

5. 点击表格左上角整表选择按钮
   - 确认出现整表选中态，而不是只落到右下角单元格

6. 整表选中后点击顶部左/中/右对齐
   - 确认不会每点一次就横向跳到左侧单元格

7. 打开“格式布局”和“表格边框”
   - 连续点击垂直对齐、边框颜色、边框粗细、底色
   - 确认每次都能立即看到效果，不会无变化

8. 打开图片 / 音频 / 视频对话框后，在输入框、tab、资源列表、取消按钮上点击
   - 确认页面不会自己跳回编辑区顶部

9. 新建有序列表 / 无序列表
   - 在第二个 list item 上按 `Tab`
   - 确认进入下一级且光标不丢
   - 再按 `Shift+Tab` 回上一级

10. 点击插入图片 / 音频 / 视频
   - 取消关闭：确认仍回到 editor
   - 提交成功：确认不回顶部、不落到 toolbar、可继续编辑

11. 如果要看调试日志
   - 在开发环境控制台执行 `window.__SENSE_EDITOR_DEBUG__ = true`
   - 重点观察：
     - `shell` 的 `onUpdate` / `setContent` 日志
     - `toolbar` 的媒体焦点日志
     - `list-keymap` 的 `Tab` 命中日志

## 验证结果

已执行：

- `npm run build`
- `npm test -- --runInBand --watch=false src/components/senseArticle/editor/richContentState.test.js src/components/senseArticle/editor/TableContextBand.test.js src/components/senseArticle/editor/table/tableSchema.test.js`

结果：

- 构建通过
- 上述 3 组现有测试通过
- 仍有项目原有 ESLint warning，与本次修复无直接新增错误对应
