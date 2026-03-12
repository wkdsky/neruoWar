# 百科编辑页富文本编辑器 Live Path Trace

## 说明

本文件只用于确认当前页面真实在运行的代码路径，避免继续围绕“看起来相关”的文件做误修。

结论先行：

- 媒体插入 live path 确实是 `App -> SenseArticleEditor -> RichSenseArticleEditorShell -> RichToolbar -> InsertMediaDialog -> DialogFrame`
- 表格格式 / 边框 live path 确实是 `App -> SenseArticleEditor -> RichSenseArticleEditorShell -> TableContextBand -> TableCellFormatPopover / TableBorderPopover -> applyAttrsToSelectedTableCells`
- 当前没有证据表明上次改到了“完全不生效的死代码”；更接近的事实是：上次命中了 live path，但没有命中真正导致跳顶 / 回退的状态链

## 一、页面挂载链路

### 1. `App.js` 是当前百科编辑页入口

- 文件：`frontend/src/App.js`
- 位置：`6582-6600`
- 证据：
  - `view === "senseArticleEditor"` 时直接渲染 `<SenseArticleEditor ... />`
  - `resetKey` 依赖 `view + nodeId + senseId + revisionId`
- 为什么确定是 live path：
  - 这是顶层 view 分发点
  - 只有这个分支会在当前应用中渲染百科编辑页

### 2. `SenseArticleEditor.js` 是当前富文本编辑页容器

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`473-485`
- 证据：
  - 页面在非 legacy fallback 时直接渲染 `<RichSenseArticleEditorShell ... />`
  - `value` 来源是本地 state `editorHtml`
  - `onChange` 直接是 `setEditorHtml`
- 为什么确定是 live path：
  - `App.js` 已直接引用它
  - 这里连接了页面 state、媒体上传接口、编辑器 shell

## 二、媒体插入真实链路

### 调用链

`App.js`
-> `SenseArticleEditor`
-> `RichSenseArticleEditorShell`
-> `RichToolbar`
-> 插入图片/音频/视频按钮
-> `InsertMediaDialog`
-> `DialogFrame`
-> `handleMediaSubmit`
-> `editor.chain().insertFigureImage / insertAudioNode / insertVideoNode`

### 1. `SenseArticleEditor` 向 shell 传入真实媒体上传函数

- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`332-342`
- 组件 / 函数：`uploadMedia`
- 证据摘要：
  - `senseArticleApi.uploadMedia(nodeId, senseId, { ...payload, revisionId })`
  - 上传成功后更新 `mediaLibrary`
- live path 理由：
  - 同文件 `473-485` 把 `onUploadMedia={uploadMedia}` 传给 `RichSenseArticleEditorShell`

### 2. shell 真实渲染工具栏

- 文件：`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
- 位置：`451-481`
- 组件：`RichSenseArticleEditorShell`
- 证据摘要：
  - JSX 内直接渲染 `<RichToolbar editor={editor} onUploadMedia={onUploadMedia} mediaLibrary={mediaLibrary} ... />`
- live path 理由：
  - 这是当前编辑器壳层唯一工具栏挂载点

### 3. 实际点击的是 `RichToolbar` 里的媒体按钮

- 文件：`frontend/src/components/senseArticle/editor/RichToolbar.js`
- 位置：`467-476`
- 组件 / 入口：
  - “插入图片”按钮：`472`
  - “插入音频”按钮：`473`
  - “插入视频”按钮：`474`
- 关键代码摘要：
  - `onClick={() => openSingleFloatingUi(() => setMediaDialogKind('image'|'audio'|'video'))}`
- live path 理由：
  - 同文件底部直接渲染媒体 dialog
  - 没有第二套媒体入口组件被 shell 渲染

### 4. 实际打开的是 `InsertMediaDialog`

- 文件：`frontend/src/components/senseArticle/editor/RichToolbar.js`
- 位置：`507-516`
- 组件：`InsertMediaDialog`
- 关键代码摘要：
  - `open={!!mediaDialogKind}`
  - `kind={mediaDialogKind || 'image'}`
  - `onClose={() => closeMediaDialog('cancel')}`
  - `onUpload={onUploadMedia}`
  - `onSubmit={handleMediaSubmit}`
- live path 理由：
  - `mediaDialogKind` 就是上面三个按钮设置的 state
  - JSX 明确直接挂载当前 dialog

### 5. 实际 dialog 外壳是 `DialogFrame`

- 文件：`frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js`
- 位置：`200-211`
- 组件：`DialogFrame`
- 关键代码摘要：
  - `InsertMediaDialog` 直接 `return <DialogFrame ...>`
  - `restoreFocusOnClose / restoreFocusTarget / onAfterCloseFocus` 都从这里继续往下传
- live path 理由：
  - `InsertMediaDialog` 没有别的壳层

### 6. 实际提交 handler 是 `RichToolbar.handleMediaSubmit`

- 文件：`frontend/src/components/senseArticle/editor/RichToolbar.js`
- 位置：`271-295`
- 函数：`handleMediaSubmit`
- 关键代码摘要：
  - image: `insertFigureImage / updateFigureImage`
  - audio: `insertAudioNode / updateAudioNode`
  - video: `insertVideoNode / updateVideoNode`
  - 然后 `closeFloatingUi()`，再 `requestAnimationFrame(() => focusEditor('media-submit'))`
- live path 理由：
  - `InsertMediaDialog` 的 `onSubmit` 直接指向它

### 7. 弹窗关闭 cleanup 真实来自 `DialogFrame`

- 文件：`frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js`
- 位置：`53-88`
- 函数：`useEffect(open)`
- 关键代码摘要：
  - open 时记录 `previousFocusedElementRef.current = document.activeElement`
  - 初始 focus 到 `closeButtonRef`
  - cleanup 时如果 `restoreFocusOnClose` 为真，调用 `focusWithoutScroll(...)`
- live path 理由：
  - 当前媒体 dialog 外壳就是它
  - 是否跳顶 / 焦点回 toolbar，这里是必须排查的真实点

## 三、表格格式 / 边框真实链路

### 调用链

`App.js`
-> `SenseArticleEditor`
-> `RichSenseArticleEditorShell`
-> `TableContextBand`
-> `TableCellFormatPopover / TableBorderPopover`
-> `applyCellAttributes`
-> `applyAttrsToSelectedTableCells`
-> `editor.view.dispatch(tr)`
-> `RichSenseArticleEditorShell.onUpdate`
-> `SenseArticleEditor.setEditorHtml`
-> shell `value` effect 可能再 `setContent`

### 1. shell 真实渲染 `TableContextBand`

- 文件：`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
- 位置：工具带在 shell JSX 中与 `RichToolbar` 并列渲染
- 证据摘要：
  - `import TableContextBand from './TableContextBand'`
  - JSX 明确渲染 `<TableContextBand editor={editor} ... />`
- live path 理由：
  - 当前页面表格工具没有第二套渲染入口

### 2. “格式布局 / 表格边框”按钮真实在 `TableContextBand`

- 文件：`frontend/src/components/senseArticle/editor/TableContextBand.js`
- 位置：
  - 格式布局按钮 `376-396`
  - 表格边框按钮 `399-445`
- 关键代码摘要：
  - 格式布局弹层使用 `TableCellFormatPopover`
  - 表格边框弹层使用 `TableBorderPopover`
- live path 理由：
  - 组件只在这里被 import/render
  - shell 直接挂载它

### 3. 格式布局实际回调

- 文件：`frontend/src/components/senseArticle/editor/TableContextBand.js`
- 位置：`388-395`
- 关键代码摘要：
  - `onVerticalAlignChange={(value) => applyCellAttributes({ verticalAlign: value })}`
  - `onBackgroundColorChange={(value) => applyCellAttributes({ backgroundColor: value })}`
  - `onTextColorChange={(value) => applyCellAttributes({ textColor: value })}`
- live path 理由：
  - `TableCellFormatPopover` 只在这里被实例化

### 4. 边框设置实际回调

- 文件：`frontend/src/components/senseArticle/editor/TableContextBand.js`
- 位置：`411-444`
- 关键代码摘要：
  - `onBorderWidthChange` -> `applyCellAttributes({ borderEdges, borderWidth, borderColor })`
  - `onBorderColorChange` -> `applyCellAttributes({ borderEdges, borderWidth, borderColor })`
  - `onEdgeToggle` -> `toggleBorderEdge`
- live path 理由：
  - `TableBorderPopover` 只在这里被实例化

### 5. attrs 写入真实 helper

- 文件：`frontend/src/components/senseArticle/editor/TableContextBand.js`
- 位置：`169-184`
- 函数：`applyCellAttributes`
- 关键代码摘要：
  - 先 `withActiveTableSelection(...)`
  - 再调用 `applyAttrsToSelectedTableCells(editor, attrs)`
  - 成功后 `focusEditorView()`
- live path 理由：
  - 所有格式布局 / 边框覆盖都汇聚到这里

### 6. 真正 dispatch transaction 的位置

- 文件：`frontend/src/components/senseArticle/editor/table/tableSelectionState.js`
- 位置：`125-161`
- 函数：`applyAttrsToSelectedTableCells`
- 关键代码摘要：
  - `entries = getSelectedTableCellEntries(editor)`
  - `tr = tr.setNodeMarkup(entry.pos, undefined, nextAttrs)`
  - `editor.view.dispatch(tr)`
- live path 理由：
  - 当前表格单元格 attrs 修改的唯一统一 helper

### 7. 表格 attrs 对应 schema / serializer

- 文件：`frontend/src/components/senseArticle/editor/extensions/TableStyleExtension.js`
- 位置：
  - 单元格 attrs 定义：`220-259`
  - cell renderHTML：`263-275`
- 文件：`frontend/src/components/senseArticle/editor/table/tableSchema.js`
- 位置：
  - data attrs：`170-188`
  - inline style：`190-222`
- live path 理由：
  - `RichSenseArticleEditorShell` 的 `useEditor` 明确加载 `TableStyleExtension`, `RichTableCell`, `RichTableHeader`
  - 所有 cell attrs 最终都依赖这里进入 HTML / DOM

### 8. 回写链路

- 文件：`frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js`
- 位置：
  - `onUpdate`：`242-250`
  - `value -> setContent` effect：`280-310`
- 文件：`frontend/src/components/senseArticle/SenseArticleEditor.js`
- 位置：`39`, `64`, `177-187`, `473-476`
- 关键代码摘要：
  - shell `onUpdate` 调 `onChange(normalizedHtml)`
  - 页面层 `onChange={setEditorHtml}`
  - shell 又用 `value` effect 决定是否 `editor.commands.setContent(...)`
- live path 理由：
  - 这是当前编辑器的真实半受控状态环

## 四、对“上次误改了非真实生效路径”的核对

当前静态核对结果：

- **没有发现上次改到完全不参与当前页面渲染的死代码**
- 上次改动涉及的 `RichToolbar.js / InsertMediaDialog.js / DialogFrame.js / TableContextBand.js / tableSelectionState.js / RichSenseArticleEditorShell.js` 都处于当前 live path 上

更准确的判断是：

- 上次虽然改到了 live path
- 但没有准确打断“媒体点击期间的跳顶 / 失焦链路”
- 也没有拿到“表格 attrs 写入后是否被回滚 / 是否根本没落到正确选区 / 是否 DOM 已变但视觉被覆盖”的直接证据
