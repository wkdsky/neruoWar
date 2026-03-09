# Explain Page Freeze Fix Report

## 修复目标
本次改动以“最小但有效”的方式，优先止血“释义百科页 -> 更新释义 -> 编辑文本时随机卡死 / 页面假死 / 最终崩溃”问题，不重写现有百科系统，也不改变既有 API 路径。

## 本次修改文件

### 前端编辑器与渲染
- `frontend/src/components/senseArticle/SenseArticleEditor.js`
- `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- `frontend/src/components/senseArticle/SenseArticleErrorBoundary.js`
- `frontend/src/App.js`
- `frontend/src/utils/senseArticleApi.js`

### 后端保存与序列化
- `backend/services/senseArticleService.js`
- `backend/services/senseArticleSerializer.js`
- `backend/tests/senseArticleServiceReferenceTargets.test.js`

## 每个文件改了什么

### `frontend/src/components/senseArticle/SenseArticleEditor.js`
- 移除了“每次输入都立即全量刷新预览”的热路径。
- 改为：
  - 小文本：停止输入 `1000ms` 后再自动刷新预览。
  - 大文本：暂停自动预览，仅提示“点击刷新预览”。
  - 始终保留“刷新预览”按钮，手动触发全文 parse/render。
- scoped 修订模式下，停止输入期自动计算 tracked diff；改为手动点击“查看/刷新修订痕迹”后才计算。
- 为 tracked diff 增加复杂度上限，文本过大时直接给提示，不阻塞主线程。
- 通过新的 scoped helper 复用范围定位结果，避免 `scopedText` 每次变化都重做整套定位。
- 详情加载和引用搜索都加了 `AbortController`，防止旧请求回写新状态。
- `saveDraft` / `submit` 改为兼容轻量 mutation 响应，不再依赖保存接口回传完整 revision detail。
- 加入开发环境性能日志：预览 parse 耗时、tracked diff 耗时。

### `frontend/src/components/senseArticle/senseArticleScopedRevision.js`
- 拆分出稳定范围定位和热路径正文替换：
  - `buildScopedRevisionScope(...)`
  - `resolveScopedRevisionText(...)`
- `buildScopedRevisionState(...)` 支持复用预计算的 scope。
- 当 base revision / anchor / heading / mode 不变时，不再因为输入变化重复做 section/selection 定位。
- 输入期仅做必要的字符串拼装，降低 scoped 模式卡顿概率。

### `frontend/src/components/senseArticle/SenseArticleRenderer.js`
- 对渲染器本体增加 `React.memo`。
- 对 block / inline 渲染增加基础 memo 化。
- 对 `blocks`、`referenceMap`、标注映射等大对象做 `useMemo`，减少无意义重复 render。
- 加入开发环境预览 render 次数日志，便于排查是否仍有异常重渲染。

### `frontend/src/components/senseArticle/SenseArticleReviewPage.js`
- revision detail 拉取增加 `AbortController`。
- 页面切换 / revisionId 变更时取消旧请求，避免旧响应覆盖当前审阅页状态。

### `frontend/src/components/senseArticle/SenseArticleErrorBoundary.js`
- 新增局部错误边界。
- 渲染异常时只隔离 sense article 区域，显示可恢复 UI，而不是炸掉整个 App。
- 提供“重试当前页面 / 返回”动作。

### `frontend/src/App.js`
- 为以下页面挂载局部错误边界：
  - `SenseArticlePage`
  - `SenseArticleEditor`
  - `SenseArticleReviewPage`
  - `SenseArticleHistoryPage`
- 使用 `resetKey` 按视图与 revision 变化自动重置边界状态。

### `frontend/src/utils/senseArticleApi.js`
- `getRevisionDetail` / `updateDraft` / `submitRevision` / `updateMetadata` 增加超时控制。
- 支持传入外部 `signal`，并与内部 timeout 中断信号合并。
- 优先使用 `response.json()` 解析大型 JSON，避免统一走 `response.text() + JSON.parse()`。
- 保留文本 fallback，兼容非标准错误响应。
- 增加开发环境 `updateDraft` 请求耗时日志。

### `backend/services/senseArticleSerializer.js`
- 新增 `serializeRevisionMutationResult(...)`。
- `updateDraft` / `submitRevision` 返回 revision summary + 轻量统计，而非完整 revision detail。
- 减少保存成功后的超大响应体与前端后续大对象 merge 成本。

### `backend/services/senseArticleService.js`
- 修复确定性 bug：`reviewableNodes is not defined`，改为使用 `resolveReferenceTargets()` 实际查询到的 `nodes`。
- 新增 `buildRevisionMutationResponse(...)`，统一轻量 mutation 返回结构。
- `updateDraftRevision()` 改为返回轻量 revision mutation result。
- `submitRevision()` 的 noop / conflict-noop / success 分支统一返回轻量结果。
- 保持现有路由和业务流程不变，仅减小保存链路的响应负载。

### `backend/tests/senseArticleServiceReferenceTargets.test.js`
- 新增最小回归测试，覆盖 `resolveReferenceTargets()` 的节点名称解析路径。
- 防止 `reviewableNodes` 这类变量名错误再次导致 create/updateDraft/submit 路径崩溃。

## 哪些改动主要解决“输入卡顿”
- `SenseArticleEditor.js`：停止每次输入即全量预览 parse + render。
- `SenseArticleEditor.js`：停止 scoped 模式输入期自动 tracked diff。
- `senseArticleScopedRevision.js`：缓存 scoped 范围定位，避免输入时重复重算范围。
- `SenseArticleRenderer.js`：通过 memo 降低预览区域重复渲染。

## 哪些改动主要解决“保存崩溃 / 假死”
- `senseArticleApi.js`：增加 timeout，避免长时间 pending 看起来像页面卡死。
- `senseArticleApi.js`：增加 abort，避免离开页面后旧请求回写造成状态错乱。
- `senseArticleService.js`：修复 `reviewableNodes is not defined`，消除确定性后端异常。
- `SenseArticleErrorBoundary.js` + `App.js`：局部错误隔离，避免异常直接炸穿整个前端。

## 哪些改动主要解决“大响应 / 大渲染”
- `senseArticleService.js` + `senseArticleSerializer.js`：`updateDraft` / `submitRevision` 改为轻量返回。
- `SenseArticleEditor.js`：不再依赖保存接口直接回传完整 revision detail。
- `SenseArticleRenderer.js`：减少大预览树的重复 render。

## 手动验证建议

### 1. 编辑输入稳定性
1. 打开“释义百科页”。
2. 点击“更新释义”进入 `SenseArticleEditor`。
3. 在整页模式下连续快速输入 30~60 秒：
   - 页面应保持可输入。
   - 预览不应每次按键都立刻闪动。
   - 小文本场景下，停止输入约 1 秒后预览刷新。
4. 在大文本正文中继续输入：
   - 应显示“预览已暂停，点击刷新”的提示。
   - 点击“刷新预览”后再进行一次全文预览。

### 2. scoped 修订稳定性
1. 从标题/选区进入局部修订。
2. 连续输入、删除、粘贴中等长度文本。
3. 观察：
   - 不应在每次按键时自动生成修订痕迹。
   - 点击“查看修订痕迹”后才计算。
   - 文本较大时应给出“跳过痕迹细粒度计算”的提示，而不是卡住页面。

### 3. 保存链路
1. 编辑后点击“保存草稿”。
2. 观察 Network：
   - `updateDraft` 响应体应明显小于旧版本。
   - 返回中只包含 summary / 状态 / parseErrors / 统计字段，而不是完整 detail。
3. 再点击“提交修订”。
4. 观察页面应正常跳转历史页，不应因大响应 merge 而长时间卡死。

### 4. 旧请求覆盖验证
1. 进入某个 revision 的编辑页。
2. 在弱网下快速切换到另一个 revision 或返回。
3. 观察不应出现旧详情请求回写新页面的情况。

### 5. 错误边界验证
1. 人工在开发环境临时抛出编辑器 render 异常。
2. 观察仅 sense article 页面块显示错误态。
3. 主应用其余区域仍可继续操作。

## 开发环境可观测日志
仅在非生产环境输出：
- `preview parse` 耗时
- `tracked diff` 计算耗时
- `preview render` 次数
- `updateDraft request` 请求耗时

建议结合以下信息一起抓取：
- 输入字数
- `previewSource.length`
- tracked diff token 数量
- `updateDraft` 响应体大小
- 保存耗时与超时次数

## 验证结果
- 后端定向回归测试通过：
  - `node --test tests/senseArticleServiceReferenceTargets.test.js`
- 前端生产构建通过：
  - `npm run build`
- 后端全量 `npm run test:sense-articles` 仍有两条既存失败：
  - `tests/senseArticlePermission.test.js`
  - `tests/senseArticleWorkflow.test.js`
- 上述两条失败与本次 freeze 修复无直接关系，本次新增回归测试已通过。

## 仍未彻底消除但已明显缓解的风险
- `updateDraft` 服务端仍会做 parse / resolve refs / diff / save，只是前端已避开输入热路径，且 mutation 响应已减重。
- `submit` 仍包含一次 `updateDraft` + `submitRevision` 的串行过程，但 UI 已减少保存后的大对象处理开销。
- `SenseArticleReviewPage` 仍会在打开时计算 scoped diff 展示；这不在当前“输入卡顿”热路径里，但若后续发现审阅页也偏重，可继续按相同思路改为懒计算。
- 其余 sense article 页面内部仍存在一些非本次范围内的 React hook lint 警告，本次未做业务外扩整改。
