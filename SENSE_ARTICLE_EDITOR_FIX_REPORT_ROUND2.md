# SENSE_ARTICLE_EDITOR_FIX_REPORT_ROUND2

## A. 上次为什么没有修好

### 1. 上次没有改错大方向，但缺少“真实运行链路证明”

- 上次改到的文件并不是死代码。静态核对结果见 [SENSE_EDITOR_LIVE_PATH_TRACE.md](/home/wkd/neruoWar/SENSE_EDITOR_LIVE_PATH_TRACE.md)。
- 真实 live path 仍然是：
  - 媒体：`App -> SenseArticleEditor -> RichSenseArticleEditorShell -> RichToolbar -> InsertMediaDialog -> DialogFrame`
  - 表格：`App -> SenseArticleEditor -> RichSenseArticleEditorShell -> TableContextBand -> TableCellFormatPopover / TableBorderPopover -> applyAttrsToSelectedTableCells`

### 2. 上次命中了 live path，但没有命中最关键的状态点

- 媒体问题上次主要围绕“关闭后如何恢复 focus”处理，但没有把这些点一起证据化：
  - 打开媒体 UI 时 editor 原生 DOM selection 是否还留在页面里
  - dialog 打开时初始 focus 到底落在哪
  - 页面层 `view / revisionId / editor shell` 是否发生了重建
  - 点击 dialog 内部控件时是否又触发了新的 focus/scroll 链
- 表格问题上次主要围绕 `setContent` 回写和 focus 收敛处理，但没有直接证明：
  - 鼠标点击 popover 控件时 selection 是否已经先丢了
  - `applyAttrsToSelectedTableCells` 执行后 doc 是否真的 `docChanged`
  - attrs 是否真的进入 `editor.getHTML()`

### 3. 这次没有发现“上次误改了完全非真实生效路径”的证据

- 没有发现上次改到 dead path。
- 更准确的结论是：上次改在了 live path 上，但缺了关键运行时证据和对真实失效时机的处理。

## B. 这次确认的真实运行链路

### 媒体问题

`frontend/src/App.js:6582-6600`
-> `frontend/src/components/senseArticle/SenseArticleEditor.js:473-485`
-> `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` 渲染 `RichToolbar`
-> `frontend/src/components/senseArticle/editor/RichToolbar.js:472-474` 媒体按钮
-> `frontend/src/components/senseArticle/editor/RichToolbar.js:507-516` 渲染 `InsertMediaDialog`
-> `frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js:200-211` 渲染 `DialogFrame`
-> `frontend/src/components/senseArticle/editor/RichToolbar.js:271-295` `handleMediaSubmit`
-> `insertFigureImage / insertAudioNode / insertVideoNode`

### 表格问题

`frontend/src/App.js:6582-6600`
-> `frontend/src/components/senseArticle/SenseArticleEditor.js:473-485`
-> `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js` 渲染 `TableContextBand`
-> `frontend/src/components/senseArticle/editor/TableContextBand.js:376-445`
-> `frontend/src/components/senseArticle/editor/dialogs/TableCellFormatPopover.js`
-> `frontend/src/components/senseArticle/editor/dialogs/TableBorderPopover.js`
-> `frontend/src/components/senseArticle/editor/TableContextBand.js:169-184` `applyCellAttributes`
-> `frontend/src/components/senseArticle/editor/table/tableSelectionState.js:125-161` `applyAttrsToSelectedTableCells`
-> `frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js:242-310` `onUpdate / value -> setContent`

## C. 这次真正修改的文件

### [frontend/src/components/senseArticle/editor/RichToolbar.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/RichToolbar.js)

- 加了媒体 live path 调试日志：
  - 打开前 activeElement / scrollY / selection 类型
  - dialog state 变化
  - 提交前后 activeElement / scroll / selection / command `didRun`
- 打开任意 floating UI 前，除了 `editor.commands.blur()`，又显式对 `editor.view.dom.blur()` 和浏览器原生 selection 做清理。
- 媒体按钮的 `openSingleFloatingUi(...)` 现在带明确 `reason`，便于直接看日志判断是哪条入口触发。
- 这是 live path，因为真实媒体按钮和真实 `InsertMediaDialog` 都在这里。
- 对应症状：
  - 媒体打开后跳顶
  - dialog 内点击失焦
  - 提交后再次点回编辑区失效

### [frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/dialogs/DialogFrame.js)

- 新增 `autoFocusTarget`，媒体 dialog 改为先 focus dialog 容器，不再默认 focus 顶部关闭按钮。
- Tab 焦点环用 `focusWithoutScroll(...)`，避免焦点循环自身触发滚动。
- 加了 open / cleanup / restoreFocus 的调试日志。
- 这是 live path，因为 `InsertMediaDialog` 真实直接包在它里面。
- 对应症状：
  - 媒体 dialog 打开瞬间 / cleanup 时页面跳顶

### [frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/dialogs/InsertMediaDialog.js)

- 加了 dialog open 和 submit 的真实运行日志。
- 媒体 dialog 显式传 `autoFocusTarget="dialog"` 给 `DialogFrame`。
- 这是 live path，因为 `RichToolbar` 真实渲染的媒体 UI 就是它。
- 对应症状：
  - dialog 打开后初始 focus 不稳
  - 提交链缺证据

### [frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/RichSenseArticleEditorShell.js)

- 补了 editor `onCreate / onDestroy / onUpdate / setContent` 的调试日志。
- 现在可以直接看出：
  - editor 是否 remount
  - `value` effect 是否真的触发 `setContent`
  - `scopedFocus.scrollIntoView` 是否再次执行
- 这是 live path，因为当前 `useEditor(...)` 和 `EditorContent` 都在这里。
- 对应症状：
  - 媒体后是否 remount / 回灌
  - 表格 attrs 是否被 `setContent` 覆盖

### [frontend/src/components/senseArticle/editor/TableContextBand.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/TableContextBand.js)

- 对格式布局 / 边框操作前后，记录 selection、currentCellAttrs、currentTableAttrs、scroll、activeElement。
- `focusEditorView()` 改成仅在 editor 当前未 focused 时才补 focus，减少无意义抢焦点。
- 这是 live path，因为当前表格上下文工具带就是它。
- 对应症状：
  - 表格格式设置后选区丢失
  - 样式看起来“点了没反应”

### [frontend/src/components/senseArticle/editor/table/tableSelectionState.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/table/tableSelectionState.js)

- 对 `applyAttrsToSelectedTableCells(...)` 增加了真实证据日志：
  - patch 前 attrs
  - patch 后 attrs
  - `tr.docChanged`
  - dispatch 后 state 中的首个 cell attrs
  - `editor.getHTML()` 是否已经包含对应 `data-*` 属性
- 这是 live path，因为表格单元格 attrs 修改统一从这里 dispatch transaction。
- 对应症状：
  - 表格 attrs 到底有没有进 editor state / HTML

### [frontend/src/components/senseArticle/editor/dialogs/TableCellFormatPopover.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/dialogs/TableCellFormatPopover.js)

- 把鼠标触发从“先 click 再执行”改成“`mousedown` 时就执行 action，并阻止焦点被 popover 按钮拿走”。
- 额外补了键盘 `Enter/Space` 触发，避免只剩鼠标路径。
- 这是 live path，因为 `TableContextBand` 真实渲染它。
- 对应症状：
  - 垂直对齐 / 背景色 / 文字色点击后 selection 先丢，导致看起来无效

### [frontend/src/components/senseArticle/editor/dialogs/TableBorderPopover.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/dialogs/TableBorderPopover.js)

- 同样把预设、边、粗细、颜色 swatch、清除覆盖，改成 `mousedown` 立即执行 action，并阻止焦点漂移。
- 补了键盘触发。
- 这是 live path，因为 `TableContextBand` 真实渲染它。
- 对应症状：
  - 边框颜色 / 边框粗细点击后像闪一下、不持久

### [frontend/src/components/senseArticle/SenseArticleEditor.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/SenseArticleEditor.js)

- 加了页面级 mount / unmount / key props 调试日志。
- 用来确认媒体操作时是否真的退出编辑页、是否发生 shell 外层重建。
- 这是 live path，因为当前编辑页容器就是它。

### [frontend/src/App.js](/home/wkd/neruoWar/frontend/src/App.js)

- 加了 `view + senseArticleContext` 的 debug 日志。
- 用来确认媒体操作期间是否出现 `view` 或 revision 上下文切换。
- 这是 live path，因为当前编辑页顶层分发就在这里。

### [frontend/src/components/senseArticle/editor/editorDebug.js](/home/wkd/neruoWar/frontend/src/components/senseArticle/editor/editorDebug.js)

- 新增统一 debug helper：
  - `describeActiveElement`
  - `describeScrollPosition`
  - `describeEditorSelection`
- 所有埋点统一受 `window.__SENSE_EDITOR_DEBUG__ === true` 控制。

## D. 关键证据

### 1. 真实 live path 证据

- 页面入口：`frontend/src/App.js:6582-6600`
- 当前编辑器容器：`frontend/src/components/senseArticle/SenseArticleEditor.js:473-485`
- 真实媒体入口：`frontend/src/components/senseArticle/editor/RichToolbar.js:472-474`
- 真实媒体 dialog：`frontend/src/components/senseArticle/editor/RichToolbar.js:507-516`
- 真实表格入口：`frontend/src/components/senseArticle/editor/TableContextBand.js:376-445`
- 真实 attrs dispatch：`frontend/src/components/senseArticle/editor/table/tableSelectionState.js:125-161`

### 2. 这次新增的关键运行时日志

打开浏览器控制台后先执行：

```js
window.__SENSE_EDITOR_DEBUG__ = true
```

然后可观察这些日志：

- 媒体问题：
  - `[sense-editor:toolbar] Opening floating UI`
  - `[sense-editor:toolbar] Media dialog state changed`
  - `[sense-editor:dialog-frame] Dialog opened`
  - `[sense-editor:media-dialog] Media dialog rendered/opened`
  - `[sense-editor:media-dialog] Submitting media dialog form`
  - `[sense-editor:toolbar] Media command executed`
  - `[sense-editor:dialog-frame] Dialog cleanup start`
  - `[sense-editor:toolbar] Media dialog closed`
  - `[sense-editor:app] View/context changed`
  - `[sense-editor:shell] Editor created / Editor destroyed`

- 表格问题：
  - `[sense-editor:table-band] Applying table cell attributes`
  - `[sense-editor:table-selection] Patching table cell attrs`
  - `[sense-editor:table-selection] Applied table cell attrs`
  - `[sense-editor:shell] onUpdate emitted editor HTML`
  - `[sense-editor:shell] Applying external value via setContent`
  - `[sense-editor:shell] Skipped external setContent`

### 3. 哪些日志可以直接证明问题是否还在

- 如果媒体一点击就跳顶：
  - 对比 `Opening floating UI`、`Dialog opened`、`Media dialog rendered/opened` 三条日志中的 `scroll.y`
  - 若 `scroll.y` 在 dialog 打开或点击内部控件时突然变成接近 0，可直接定位跳顶时机
- 如果媒体操作后退出编辑页：
  - 看 `[sense-editor:app] View/context changed`
  - 看 `[sense-editor:editor-page] SenseArticleEditor unmounted`
  - 看 `[sense-editor:shell] Editor destroyed`
- 如果表格设置后仍闪一下：
  - 看 `Applied table cell attrs` 的 `docChanged`
  - 看 `firstCellAttrsAfter`
  - 看 `htmlContains`
  - 再对比 shell 的 `Applying external value via setContent` 是否紧跟出现

### 4. 当前我能确认到的代码级证据

- 构建已通过：`npm run build`
- 这说明 live path 修改至少没有编译层面的断链。
- 但我没有在 CLI 里直接点浏览器，因此**当前没有真实浏览器日志截图或运行时控制台结果**。
- 所以这次报告不会把问题包装成“已由我本地实测闭环修复”。

## E. 手工验证脚本

### 先打开 debug

1. 打开百科编辑页。
2. 在浏览器控制台执行：

```js
window.__SENSE_EDITOR_DEBUG__ = true
```

3. 刷新页面一次。

### 媒体验证

1. 把页面滚到编辑器中段，不要停留在顶部工具栏。
2. 点击“插入图片”。
3. 观察：
   - 页面滚动位置是否立刻跳到顶部
   - 控制台里 `Opening floating UI`、`Dialog opened` 的 `scroll.y`
4. 在 dialog 内依次点击：
   - “上传文件”
   - “粘贴 URL”
   - 任意输入框
   - 任意资源项
5. 预期：
   - 页面不跳顶
   - 不出现 `SenseArticleEditor unmounted` 或 `Editor destroyed`
   - `view` 不应离开 `senseArticleEditor`
6. 再完成一次插入提交。
7. 预期：
   - 提交后焦点回编辑器正文
   - `Media command executed.didRun === true`
   - 再点编辑区不会出现“刷一下又失效”

### 表格验证

1. 插入一个 2x2 表格，在某个单元格输入文字。
2. 打开“格式布局”。
3. 依次点击：
   - 垂直居中
   - 背景色 swatch
   - 文字色 swatch
4. 预期：
   - 点击后肉眼可见立即生效
   - 控制台 `Applied table cell attrs.docChanged === true`
   - `firstCellAttrsAfter` 含对应新 attrs
   - shell 不应紧跟出现一次把旧值回灌的 `Applying external value via setContent`
5. 再打开“表格边框”。
6. 依次点击：
   - 粗细 `2px`
   - 某个边框颜色
   - 上 / 下 / 左 / 右边 toggles
7. 预期：
   - 边框可见变化
   - `Applied table cell attrs.htmlContains` 中相关 `data-border-*` 为 `true`
   - 再点回编辑区样式不回退

## F. 尚未覆盖的边界

- 我这次已经把修改限制在真实 live path 上，但**还没有在真实浏览器里抓到新增日志的实际输出**。
- 因此当前状态是：
  - 已完成真实链路确认
  - 已在真实链路上加入最小埋点
  - 已做两处最有可能命中的修正：
    - 媒体：dialog 初始 focus / 底层 selection 清理 / 页面层 remount 日志
    - 表格：popover 改为 `mousedown` 即执行，尽量在 selection 丢失前落命令
- 但我还不能诚实地写“已实测修复完成”。
- 如果你按上面的脚本再跑一轮，把控制台中对应日志贴回来，下一轮就可以直接根据真实运行日志继续收口，而不是再靠静态推断。
