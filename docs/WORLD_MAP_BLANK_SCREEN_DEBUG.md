# WORLD_MAP_BLANK_SCREEN_DEBUG

## 目录
- [结论摘要](#结论摘要)
- [Step 0：入口与文件索引](#step-0入口与文件索引)
- [Step 1：复现路径与空白类型判定](#step-1复现路径与空白类型判定)
- [Step 2：容器尺寸与 Canvas 尺寸链路](#step-2容器尺寸与-canvas-尺寸链路)
- [Step 3：渲染循环检查](#step-3渲染循环检查)
- [Step 4：相机/坐标系/可视范围](#step-4相机坐标系可视范围)
- [Step 5：场景内容创建与数据源](#step-5场景内容创建与数据源)
- [Step 6：根因列表（按概率排序）](#step-6根因列表按概率排序)
- [Step 7：已提交的最小修复与验证方法](#step-7已提交的最小修复与验证方法)
- [长期修复建议](#长期修复建议)

## 结论摘要
最可能导致“大地图空白/黑屏/只有 UI 没地图”的主因是：
1. 首页渲染存在数据门槛，`rootNodes` 和 `featuredNodes` 同时为空时，`showHome` 不会执行，导致场景不进入布局渲染链。证据：`frontend/src/App.js:4025-4038`（已修复前为条件门槛）。
2. 渲染器持续循环仅在 `nodes.size > 0` 时启动，且无“空数据占位图形”，导致无节点时只剩底色。证据：`frontend/src/WebGLNodeRenderer.js:1085-1110`。
3. 容器尺寸更新原先仅依赖窗口 `resize`，对父容器尺寸变化不敏感，可能产生错误尺寸/可视异常。证据：`frontend/src/App.js:660-805`（本次已补充 `ResizeObserver`）。

本次已做“先可见”补丁：即使没有节点数据，也会绘制调试网格+坐标轴+文本占位，避免纯空白。

## Step 0：入口与文件索引
### 0.1 调用链（路由/页面 -> 组件 -> 初始化 -> 循环 -> draw）
1. 视图路由状态：`view === "home"` 时挂载首页组件。`frontend/src/App.js:5865-5885`
2. 首页组件挂载 WebGL canvas。`frontend/src/components/game/Home.js:170-175`
3. `App` 在 `webglCanvasRef.current` 存在时创建 `SceneManager`。`frontend/src/App.js:660-709`
4. `SceneManager` 内部创建 `WebGLNodeRenderer` 与 `LayoutManager`。`frontend/src/SceneManager.js:10-14`
5. 首页数据变化时调用 `sceneManager.showHome(...)`。`frontend/src/App.js:4025-4038`
6. `showHome` 计算布局并 `setLayout`。`frontend/src/SceneManager.js:59-83`
7. `setLayout` 调 `renderer.setNode/setLines/render`。`frontend/src/SceneManager.js:287-296`
8. `render()` 发起 GL 绘制（lines/nodes/buttons/overlay），并在有节点时启动 rAF 循环。`frontend/src/WebGLNodeRenderer.js:1045-1089`
9. `startRenderLoop()` 每帧更新 overlay，节点为空时停止循环。`frontend/src/WebGLNodeRenderer.js:1092-1110`

### 0.2 文件索引表
| 分组 | 文件 | 作用 |
|---|---|---|
| frontend | `frontend/src/App.js` | 页面路由、首页数据请求、SceneManager 初始化、尺寸同步、场景切换入口 |
| frontend | `frontend/src/components/game/Home.js` | 首页 UI 与 WebGL canvas 挂载点 |
| frontend | `frontend/src/SceneManager.js` | 场景编排、布局切换、将 layout 转换为 renderer 输入 |
| frontend | `frontend/src/LayoutManager.js` | 首页/详情布局坐标计算（世界坐标来源） |
| frontend | `frontend/src/WebGLNodeRenderer.js` | WebGL 上下文、shader、draw call、交互、rAF 循环 |
| frontend | `frontend/src/App.css` | 通用 `.webgl-scene-container` / `.webgl-canvas` 样式 |
| frontend | `frontend/src/components/game/Home.css` | 首页特有容器样式（含 fixed 全屏设定） |
| backend | `backend/routes/nodes.js` | 首页节点数据接口：`/public/root-nodes`、`/public/featured-nodes` |
| docs | `docs/PVE_BATTLE_SYSTEM_AUDIT.md` | 战斗链路审计文档（与本问题直接链路不同，但可区分“大地图”与“战斗场景”） |

## Step 1：复现路径与空白类型判定
### 1.1 最短复现路径
1. 登录进入首页（`view = home`）。
2. 首页请求 `GET /api/nodes/public/root-nodes` 与 `GET /api/nodes/public/featured-nodes`。`frontend/src/App.js:2431-2463`
3. 若两者都为空数组（或业务上无可展示节点），旧逻辑不调用 `showHome`，画面容易表现为“只有背景/UI，没有地图节点”。

### 1.2 空白类型判定
- A) Canvas 未挂载：本链路通常不是。`Home` 明确渲染 `<canvas ref={webglCanvasRef} />`。`frontend/src/components/game/Home.js:170-175`
- B) Canvas 尺寸异常：存在风险（已修）。尺寸来自父容器；旧逻辑只监听 window resize。`frontend/src/App.js:660-805`
- C) 有渲染循环但场景无对象：成立。`nodes.size===0` 时循环不启动。`frontend/src/WebGLNodeRenderer.js:1085-1110`
- D) WebGL/shader 失败：存在风险。编译/链接错误仅 `console.error`，无强兜底。`frontend/src/WebGLNodeRenderer.js:385-410`
- E) 数据未加载/空数组导致 early return：成立。旧首页 effect 对数据有硬门槛（已修）。`frontend/src/App.js:4025-4038`

结论：当前问题最符合 **E + C** 组合，B/D 为高相关次要风险。

## Step 2：容器尺寸与 Canvas 尺寸链路
### 2.1 尺寸来源与设置位置
- 容器：`.webgl-scene-container`。`frontend/src/components/game/Home.js:170`，样式见 `frontend/src/App.css:2257-2263` 和 `frontend/src/components/game/Home.css:815-821`
- Canvas 样式：`width:100%; height:100%`。`frontend/src/App.css:2267-2271`
- Canvas 物理像素：由 `parent.getBoundingClientRect()` 写入 `canvas.width/height`。`frontend/src/App.js:685-690`

### 2.2 Resize 链路
- 本次修复后：
  - `window.resize` + `ResizeObserver(parent)` 双通道更新。`frontend/src/App.js:789-803`
  - 尺寸下限 `Math.max(1, ...)`，避免 0 尺寸。`frontend/src/App.js:687-688`

### 2.3 DPR 使用
- 当前世界地图 renderer 未显式乘 DPR（直接使用 `canvas.width/height` 作为绘制分辨率）。相关绘制入口：`frontend/src/WebGLNodeRenderer.js:1049-1051`

## Step 3：渲染循环检查
- 渲染入口：`renderer.render()`。`frontend/src/SceneManager.js:295` -> `frontend/src/WebGLNodeRenderer.js:1045-1089`
- 循环入口：`startRenderLoop()` 仅在 `nodes.size > 0` 时启动。`frontend/src/WebGLNodeRenderer.js:1085-1087`
- 循环停止条件：`nodes.size===0 || animating`。`frontend/src/WebGLNodeRenderer.js:1099-1102`

本次最小修复：
- 即使 `nodes.size===0`，`render()` 仍绘制占位网格/坐标轴。`frontend/src/WebGLNodeRenderer.js:1053-1055`, `frontend/src/WebGLNodeRenderer.js:1389-1421`
- overlay 增加空数据提示文本。`frontend/src/WebGLNodeRenderer.js:1382-1384`, `frontend/src/WebGLNodeRenderer.js:1423-1452`

## Step 4：相机/坐标系/可视范围
- 相机类型：2D 变换相机（非 Three Perspective/Ortho），参数为 `offsetX/offsetY/zoom`。`frontend/src/WebGLNodeRenderer.js:288-293`
- 坐标变换：`worldToScreen/screenToWorld`。`frontend/src/WebGLNodeRenderer.js:443-454`
- 世界边界与中心：由布局器宽高决定 `centerX/centerY`。`frontend/src/LayoutManager.js:7-12`
- 首页节点坐标生成：`calculateHomeLayout` 中基于 `this.width/this.height` 计算。`frontend/src/LayoutManager.js:37-153`

说明：该世界地图链路没有 `near/far/fov` 概念（不是 3D camera）。

## Step 5：场景内容创建与数据源
### 5.1 数据源
- 根节点接口：`GET /api/nodes/public/root-nodes`。前端调用 `frontend/src/App.js:2431-2446`，后端实现 `backend/routes/nodes.js:5161-5258`
- 热门节点接口：`GET /api/nodes/public/featured-nodes`。前端调用 `frontend/src/App.js:2448-2463`，后端实现 `backend/routes/nodes.js:5261-5318`

### 5.2 内容创建
- `showHome(rootNodes, featuredNodes, [])` -> `LayoutManager.calculateHomeLayout` -> `layout.nodes/layout.lines`。`frontend/src/SceneManager.js:59-66`, `frontend/src/LayoutManager.js:37-153`
- `setLayout` 把 layout 写入 renderer。`frontend/src/SceneManager.js:287-296`

### 5.3 条件分支/feature flag
- 首页 WebGL 更新条件：`view==='home'` 且 `sceneManager/isWebGLReady`。`frontend/src/App.js:4025-4028`
- 搜索模式下 `LayoutManager` 返回空布局（search 用 React 面板展示，不走 WebGL 节点）。`frontend/src/LayoutManager.js:43-50`
- 后端读模型分支：`isDomainTitleProjectionReadEnabled()` 影响 `/public/root-nodes` 与 `/public/featured-nodes` 查询路径。`backend/routes/nodes.js:5168-5194`, `backend/routes/nodes.js:5269-5279`

### 5.4 单位/建筑数据源（本问题要求项）
在世界地图主链路（`App/SceneManager/LayoutManager/WebGLNodeRenderer/Home`）中未发现战斗单位/建筑绘制输入；该类数据属于围城/战斗模块，不是首页大地图渲染输入。检索范围与关键词：
- 范围：`frontend/src/App.js`, `frontend/src/SceneManager.js`, `frontend/src/WebGLNodeRenderer.js`, `frontend/src/LayoutManager.js`, `frontend/src/components/game/Home.js`
- 关键词：`unit|units|building|battlefield|projectile|squad|agent`

## Step 6：根因列表（按概率排序）
| 排名 | 根因 | 现象 | 代码证据 | 复现条件 | 快速验证 |
|---|---|---|---|---|---|
| 1 | 首页数据门槛导致不触发 `showHome`（已修） | UI 在，地图节点完全不出现 | `frontend/src/App.js:4025-4038` | `rootNodes=[]` 且 `featuredNodes=[]` | 打开 `?mapDebug=1`，看 `[MapDebug] showHome` 的节点计数 |
| 2 | `nodes.size===0` 时无占位图形，循环停止 | 仅背景色，误判黑屏 | `frontend/src/WebGLNodeRenderer.js:1085-1110` | layout 为空或数据未注入 | 现在应看到网格/坐标轴与“暂无节点”提示 |
| 3 | 容器尺寸变化未被稳定监听（已修） | 画面区域异常、内容不可见/偏移 | `frontend/src/App.js:685-803` | 父容器尺寸变化但未触发 window resize | `?mapDebug=1` 下看 `[MapDebug] canvas-size` 是否实时变化 |
| 4 | 搜索模式布局返回空节点 | 搜索时地图节点消失，仅保留搜索 UI | `frontend/src/LayoutManager.js:43-50` | `searchResults.length > 0` 且走 `calculateHomeLayout(searchResults)` | 触发搜索并观察布局分支 |
| 5 | Shader 编译/链接失败缺少强兜底 | 控制台有 shader 错误，画面可能空 | `frontend/src/WebGLNodeRenderer.js:385-410` | GLSL 编译失败、驱动差异 | 看 console `Vertex shader error/Fragment shader error` |
| 6 | 后端接口返回空/失败但前端仅 alert | 地图无节点数据，用户只看到 UI | `frontend/src/App.js:2431-2463`, `backend/routes/nodes.js:5161-5318` | 数据库无根/热门节点，或接口失败 | Network 面板看两个接口返回体中的 `nodes` |

## Step 7：已提交的最小修复与验证方法
### 7.1 已改动代码
1. `frontend/src/App.js:94-100`
- 新增 `isMapDebugEnabled()`，用于 `?mapDebug=1` 调试开关。

2. `frontend/src/App.js:685-803`
- 将 canvas 尺寸同步抽为 `syncCanvasSize`。
- 初始化时设置 `canvas.width/height` 下限为 `>=1`。
- 补充 `ResizeObserver(parent)`，解决仅 window resize 不足的问题。
- 调试日志：`[MapDebug] canvas-size`。

3. `frontend/src/App.js:4025-4038`
- 去掉“首页有数据才渲染”的门槛，改为始终调用 `showHome(rootNodes, featuredNodes, [])`。
- 调试日志：`[MapDebug] showHome`。

4. `frontend/src/WebGLNodeRenderer.js:248-254`
- 新增 URL 调试开关读取 `readMapDebugFlag()`。

5. `frontend/src/WebGLNodeRenderer.js:1053-1055`, `frontend/src/WebGLNodeRenderer.js:1389-1452`
- 当 `nodes.size===0` 时绘制调试网格+中心坐标轴+空数据文本占位。
- 避免“纯空白/纯黑背景”误判。

6. `frontend/src/WebGLNodeRenderer.js:1069-1081`
- 增加 render 状态调试日志：`[MapDebug] render-state`。

### 7.2 构建结果
- 已执行：`npm -C frontend run build`
- 结果：构建成功（仅仓库已有 ESLint warning，无新增致命错误）。

### 7.3 手动验证步骤
1. 启动后端与前端。
2. 访问首页路径（登录后默认首页）。
3. 使用 `?mapDebug=1`（例如 `http://localhost:3000/?mapDebug=1`）。
4. 验证：
   - 即使没有任何节点数据，也应看到网格+中心轴+提示文案。
   - console 应输出 `[MapDebug] canvas-size`、`[MapDebug] showHome`、`[MapDebug] render-state`。
5. 关闭调试：去掉 URL 参数 `mapDebug` 或设为 `0`。

## 长期修复建议
1. 把世界地图“空数据态”做成正式 UI 状态（空态卡片 + 重试按钮），不要仅靠调试占位。
2. 将 shader 编译失败升级为可见错误面板（并附 `gl.getShaderInfoLog`），避免静默失败。
3. 引入统一渲染健康监测（context lost/restored、draw call 计数、帧耗时），并在 HUD 中可开关展示。
4. 将尺寸管理统一为 `ResizeObserver + DPR` 方案，明确 CSS 像素与 drawingBuffer 像素策略。
5. 统一首页/详情页的场景初始化时机，避免 `view` 切换时重复创建销毁导致的闪屏与竞态。
