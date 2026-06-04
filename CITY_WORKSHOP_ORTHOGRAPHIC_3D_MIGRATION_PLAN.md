# 城内工坊正交 3D 改造计划

## 目标

把“城内工坊 -> 编辑模板”从 Phaser 2D 等距伪 3D 渲染，迁移到 Three.js 正交 3D 渲染。迁移后仍保留当前地图数据结构、模板选择、编辑状态、吸附、移动、复制、旋转、机关、齿轮、验证和保存逻辑；编辑期间所有逻辑状态继续在用户本地运行，只有点击保存时才做持久化或未来的服务端通信。

外部资料依据：

- Three.js `OrthographicCamera` 是正交投影，相同尺寸物体不会因为距离相机远近而改变屏幕大小，适合保留当前等距读图习惯：https://threejs.org/docs/pages/OrthographicCamera.html
- React `lazy` 可以把组件代码推迟到首次渲染时加载，适合把 3D 编辑器做成按需 chunk：https://react.dev/reference/react/lazy

## 当前状态

- `GameApp` 已经用 `React.lazy` 懒加载 `CityWorkshopPage`。
- 当前编辑入口已默认使用正交 Three runtime：
  - `CityWorkshopPage` 改为点击模板后才 lazy 加载 `CityChannelEditor`。
  - `CityChannelEditor` 保留原有 UI、状态栏、热栏、设置、机关面板和缩略图，只替换中间编辑画布 runtime。
  - `CityChannelEditor` 仍然只有打开压力板 3D 检视时才 lazy 加载 `CityChannelPressurePlateInspect3D`。
- `phaser` package 依赖已删除，编辑器入口不再动态 import 或实例化 Phaser。
- `three` 已被战场预览、单位预览、物品预览和压力板 3D 检视使用，不能为了城内工坊单独删除。
- 当前城内工坊编辑器没有轮询或后端自动同步；保存入口目前写入 `localStorage` 草稿。
- 第一轮拆包后的 `npm run build` 已通过，gzip 基线为：`main.js` 51.42 kB，最大 JS chunk 348.58 kB，后续需要用浏览器 Network 或 analyzer 继续确认每个 hash chunk 的归属。
- 第二轮阶段 0/1 落地后：
  - `web-vitals` 已从前端依赖中移除，并通过 `npm prune` 清掉本地残留包。
  - `@testing-library/*` 已迁移到 `devDependencies`。
  - 新增 Three 正交 3D 预览骨架，作为 Phaser 编辑器的覆盖层预览和工坊页独立 3D 预览入口。
  - 新增 `cityChannel/three` 几何测试，当前城内工坊测试为 23 suites / 219 tests。
  - `npm run build` 通过，`main.js` 51.47 kB；新增的 3D 预览 chunk 约 4.18 kB JS / 471 B CSS gzip。
- 第三轮阶段 2 可视细节落地后：
  - Three 正交预览已显示传动骨骼线、齿轮挂点、入口/出口立体标记。
  - Three 正交预览支持点击板材保持选中高亮，为后续接删除、移动、属性面板提供选择状态基础。
  - 城内工坊测试为 23 suites / 221 tests。
  - `npm run build` 通过，`main.js` 51.49 kB；3D 预览 chunk 约 5.35 kB JS / 471 B CSS gzip。
- 第四轮阶段 3 放置链路落地后：
  - Three runtime 已用正交相机射线与地面层平面求交，把 world 坐标转换为 cell。
  - 3D 预览在当前 2D 编辑器已选择“放置板材”工具时显示绿色/红色地板 ghost。
  - 在 3D 预览点击合法空格会提交同一套 `onCommitOperations`，由现有本地 React 编辑状态更新，不访问服务器。
  - 当前仅覆盖单块地面板放置；边缘竖板、竖直板和吸附轴循环仍待迁移。
  - 城内工坊测试为 23 suites / 222 tests。
  - `npm run build` 通过，`main.js` 51.49 kB；3D 预览 chunk 约 6.37 kB JS / 471 B CSS gzip。
- 第五轮阶段 3 边缘竖板放置落地后：
  - 2D 编辑器覆盖层已把当前 `panelPose` 传入 Three 正交编辑器；当前热栏切到“竖放”时，3D ghost 会从地面板切换为真实厚度的边缘竖板。
  - Three runtime 已支持在地面层射线命中点中计算最近 cell 边缘，生成 `kind: 'wall'` / `action: 'place'` 的本地 operation，并继续复用现有 `onCommitOperations`，不新增任何保存前通信。
  - 3D 墙板合法性已覆盖同一物理墙面占用、入口/出口不可竖放、基础支撑判断；非法状态显示红色 ghost 和状态栏原因。
  - 边缘墙板 transform 修正为由尺寸直接表达方向，不再额外绕 Y 旋转；相邻格子的对向边会落在同一物理平面，传动线/齿轮挂点表面偏移也按物理轴保持一致，避免“前/后”视觉翻面。
  - 当前仍未迁移：竖直向上板、复杂 vertical snap 轴循环、拖拽移动/复制/删除在 3D 入口的完整交互、图层可见性控制和齿轮连接编辑。
  - 城内工坊测试为 23 suites / 225 tests。
  - `npm run build` 通过，`main.js` 51.49 kB；3D 预览 chunk 约 8.25 kB JS / 471 B CSS gzip。
- 第六轮阶段 3 竖直向上板放置落地后：
  - Three 竖直 tile transform 已与边缘墙轴向对齐：`rotation: 0/180` 表达东西向，`90/270` 表达南北向。
  - Three runtime 在竖放模式命中已有边缘墙或竖直 tile 顶部时，会生成 `kind: 'tile'` / `isVertical: true` 的本地 operation，并用真实厚度 ghost 显示竖直向上板。
  - `applyPlacementOperationsToMap` 已保留 `operation.isVertical`，且普通 tile 放置会显式放平旧竖直 tile，避免 React 状态落地时丢失姿态。
  - 当前仍未迁移：复杂 vertical snap 轴循环、拖拽移动/复制/删除在 3D 入口的完整交互、图层可见性控制和齿轮连接编辑。
  - 城内工坊测试为 23 suites / 228 tests。
  - `npm run build` 通过，`main.js` 51.49 kB；3D 预览 chunk 约 8.83 kB JS / 471 B CSS gzip。
- 第七轮阶段 3/4/7 默认替换落地后：
  - `CityChannelEditor` 直接挂载 `CityChannelThreeRuntime`，保留原 React UI、缩略图、小地图图层控制、保存、撤销、重做、验证和机关面板。
  - Three runtime 已补齐选择/Shift 多选、删除、移动/复制预览、Shift+滚轮传动旋转、齿轮安装/删除、角齿轮连轴绑定、图层显示截止、辅助网格、坐标标签和墙板透明模式。
  - `CityWorkshopPage` 删除 2D/3D 渲染器切换；独立 Three 预览文件不再提供“切回 2D”入口文案。
  - `phaser` 已从 `package.json` 和 `package-lock.json` 移除；`src` 与 package 文件中已无 Phaser 包 import 或依赖引用。
  - 城内工坊测试为 23 suites / 228 tests。
  - `npm run build` 通过，`main.js` 51.40 kB；最大 chunk 为 `385.5b57dd6d.chunk.js` 145.03 kB gzip。
- 第八轮阶段 3 交互回归修复后：
  - 选择工具下，空白/拖动仍执行框选；选中板材上长按会进入移动预览，不再触发画布平移。
  - 竖放放置不再从竖直支撑表面 fallback 到水平地面或最近边，水平板中心也不会生成竖板 ghost；只有真实边缘阈值内才显示边缘竖板 ghost。
  - 新放置板材恢复中心替换能力，显式替换 floor/wall/vertical tile 时仍走原 `place` operation，让 mutation 继续保留可迁移的齿轮挂点。
  - 竖直支撑顶部命中继续生成向上续搭的竖直 tile ghost，并把顶部判定收紧到 top face/极近顶部，避免侧面误触。
  - 城内工坊测试为 23 suites / 228 tests。
  - `npm run build` 通过，`main.js` 51.40 kB；最大 chunk 为 `385.5b57dd6d.chunk.js` 145.03 kB gzip。
- 第九轮阶段 3/4 Three 原生交互重做后：
  - Three runtime 不再以 Phaser 的目标解析为准，改为基于 Three raycast 命中点转换到板材局部坐标：中心区域替换，边缘区域吸附，竖直支撑顶部续搭。
  - 放置和移动共用同一套 hover target；移动预览现在会实时显示 ghost，并支持边缘/顶部吸附目标。
  - ghost 从单个半透明 box 改为完整 group：真实尺寸板材、边线、传动骨骼、传动节点和默认齿轮挂点都统一显示。
  - 齿轮挂点改回真实中心/四角位置，齿轮 mesh 按板材表面法线定向；安装齿轮时会高亮中心和四角候选点，并预览当前最近 socket。
  - 城内工坊测试为 23 suites / 228 tests。
  - `npm run build` 通过，`main.js` 51.40 kB；Three 编辑 chunk `217.9ca25cd6.chunk.js` 为 50.24 kB gzip。
- 第十轮阶段 3/4 ghost、吸附和齿轮错位修复后：
  - Three 板材拾取材质改为双面，避免鼠标看起来停在竖直板材背面时 raycast 穿透到后方水平板，导致水平 ghost 错误亮起。
  - hover target 规则收紧为：中心替换永远匹配被命中的板材姿态；只有真实边缘触发边缘吸附；只有竖直支撑顶部触发向上续搭。
  - 选择工具拖动继续优先进入框选；长按移动只在按住未移动时启动，避免框选、长按移动和画布操作抢状态。
  - 竖面齿轮 socket 和高亮点改为基于真实 3D 表面 frame 计算，保留相邻格子对向边同一物理面的规范化显示，并支持 front/back 面。
  - 新增 Three 几何回归测试覆盖对向墙同面、front/back 齿轮 socket、水平/竖直 hover zone 判定。
  - 城内工坊测试为 23 suites / 230 tests。
  - `npm run build` 通过，`main.js` 51.40 kB；Three 编辑 chunk `217.658d5e14.chunk.js` 为 50.34 kB gzip。

## 非目标

- 不重写地图 schema、模板 meta、白线验证、机械模拟的领域逻辑。
- 不引入 GLB/FBX 模型、大贴图、后期特效、实时阴影作为首版依赖。
- 不把正交 3D 编辑器提前打入首页或主游戏首屏包。
- 不在迁移期间删除 Phaser 代码，除非 Three 版已经覆盖当前行为并通过测试。

## 阶段 0：依赖和加载清理

1. 建立包体基线：
   - 运行 `npm run build`，记录 CRA 输出的主包、城内工坊 chunk、Three/Phaser chunk 大小。
   - 记录打开首页、打开城内工坊列表、点击编辑模板三个时刻的 Network 加载差异。
2. 清理依赖分类：
   - `@testing-library/*` 当前在 `dependencies`，应迁移到 `devDependencies`。这不会直接减少浏览器包，但会减少生产安装依赖噪声。
   - `web-vitals` 当前未在 `src` 中发现引用，可在确认没有隐藏入口后删除。
   - `three` 保留，因为全站其他 3D 预览仍在使用。
   - `socket.io-client` 保留，因为 `useAppSocket` 在使用。
   - Tiptap 相关包保留，因为富文本编辑器在使用。
   - `phaser` 暂时保留，等 Three 正交编辑器完成替换后删除。
3. 加载策略：
   - 城内工坊首页只加载模板列表和缩略图。
   - 点击模板后才加载编辑器壳。
   - 编辑器壳加载后再动态加载 Three 正交渲染 runtime。
   - 压力板 3D 检视、复杂机关预览、未来调试面板继续按功能懒加载。
4. 资源策略：
   - 首版不使用外部模型文件。
   - 板材、齿轮、端口、路线、选择框全部用代码生成几何体或 line mesh。
   - 材质使用纯色和程序化 canvas texture；如需纹理，尺寸控制在小图集并按需生成。

## 阶段 1：Three 正交编辑器骨架

1. 新增目录：
   - `frontend/src/components/game/cityChannel/three/CityChannelThreeEditor.js`
   - `frontend/src/components/game/cityChannel/three/CityChannelThreeRuntime.js`
   - `frontend/src/components/game/cityChannel/three/cityChannelThreeGeometry.js`
   - `frontend/src/components/game/cityChannel/three/cityChannelThreePicking.js`
   - `frontend/src/components/game/cityChannel/three/cityChannelThreeMaterials.js`
2. 建立兼容接口：
   - 保持与现有 Phaser 编辑器接近的配置接口：`mapData`、工具状态、选择状态、回调、机关参数。
   - 先让 React 层可以在 `Phaser` 与 `Three` 两个编辑器之间切换，建议用本地常量或 feature flag。
3. Runtime 基础：
   - `WebGLRenderer` 只在编辑器挂载时创建。
   - 使用 `OrthographicCamera`，相机保持等距方向，例如 yaw 45 度、pitch 约 35 度。
   - `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`，移动端可进一步限制到 1.5。
   - 默认按需渲染：地图变化、相机变化、hover/selection 变化时 `requestRender()`，只有机关动画预览期间进入 RAF loop。
4. 坐标系统：
   - 保留现有 cell `{ x, y, z }` 语义。
   - 建立确定的 world mapping：`x` 和 `y` 为地面平面，`z` 为高度。
   - 定义板材真实尺寸：宽、深、厚度、竖板高度、齿轮半径。
   - 所有吸附和碰撞仍使用现有领域逻辑，Three 只负责可视化和拾取。

## 阶段 2：几何和视觉实现

1. 板材 mesh：
   - 地面板：真实厚度 box 或自定义 buffer geometry。
   - 边缘竖板：沿 cell 边缘生成真实厚度立面。
   - 竖直板：用真实 3D 朝向表达，不再依赖“前/后”视觉字段。
2. 拼接表现：
   - 转角、十字、T 字、并排拼接通过相邻关系计算 miter/接缝几何。
   - 前后同位的竖直结构使用同一份空间几何，不再做前后视觉差异。
   - 保留轻微 bevel/边线，让正交视角下仍有立体感。
3. 材质：
   - 基础板材、传动板、压力板、入口、出口分别使用少量共享材质。
   - 避免每块板材创建新材质。
   - 需要纹理时用小 canvas texture 缓存，按 panel type 复用。
4. 合批：
   - 相同材质、相同几何的普通板材用 `InstancedMesh`。
   - 需要单独交互或动画的板材保留独立 mesh 或维护 instance id 到 placement key 的映射。
   - 选择框、hover、ghost、路线 overlay 使用独立轻量 layer。

## 阶段 3：交互功能迁移

1. 浏览和相机：
   - 拖拽平移、滚轮缩放。
   - 保留当前 yaw/zoom 状态摘要。
   - 需要旋转视角时只在固定几个等距角度间切换，避免自由视角破坏编辑判断。
2. 拾取：
   - 使用 `Raycaster` 拾取板材 mesh、竖板 mesh、齿轮和端口。
   - 维护 `mesh.userData` 或 instance id 映射到 cell/wall/gear。
   - 空地点击使用与地面/层平面的 ray intersection，转换为 cell。
3. 放置：
   - 迁移地面板放置、边缘竖板放置、竖直板放置。
   - 保留当前 snap axis、snap plane cycle、支撑检查、替换逻辑。
   - ghost mesh 直接用半透明真实几何表示。
4. 选择和编辑：
   - 单选、多选、框选如当前能力不足可先保留单选和 shift 多选，再补框选。
   - 删除、复制、拖拽移动、批量移动。
   - 传动骨骼旋转，保留 Shift+滚轮和按钮入口。
   - 撤销、重做仍使用现有 `useCityChannelEditorState`。
5. 图层和可见性：
   - active layer、visible layer cutoff、helper grid、coordinates。
   - 高层隐藏时仅隐藏 mesh，不删除数据。
6. 状态同步：
   - Three runtime 作为编辑中的本地实时视图。
   - React 只保存工具栏状态、面板状态、撤销栈、保存用 mapData。
   - 场景已本地应用的操作不做二次完整重建；只把操作结果提交给 React 状态。

## 阶段 4：机关和齿轮迁移

1. 齿轮：
   - 中心齿轮和角齿轮用程序几何生成。
   - 齿轮 attachment point 使用真实 3D 坐标，替代当前 2D 投影上的表面差异。
   - 连轴绑定候选用 line/curve overlay 表示。
2. 机械端口：
   - 复用现有 `mechanicalPorts` schema。
   - 端口位置从 placement runtime geometry 转换到 world 坐标。
   - 端口连接线用 Three line 或 tube 表示，默认关闭昂贵 tube。
3. 压力板和预览：
   - 首版可以继续保留现有独立 `CityChannelPressurePlateInspect3D`。
   - 后续把 inspect model 的几何构建迁入 shared Three geometry，减少重复。
4. 机关播放：
   - 复用当前 `cityChannelMechanismSimulation` 和 playback 结果。
   - 只有播放期间 RAF；播放结束后回到按需渲染。

## 阶段 5：功能等价验收清单

Three 版必须覆盖当前阶段已有能力：

- 模板列表打开草稿和内置模板。
- 编辑器进入/退出，未保存提示。
- 材料面板选择板材和齿轮。
- 地面板、边缘竖板、竖直板吸附放置。
- 转角、十字、T 字、上下层拼接显示稳定。
- 入口/出口放置和白线验证。
- 选择、删除、复制、移动、旋转、撤销、重做。
- 图层切换、显示至某层、辅助网格、坐标显示。
- 齿轮安装、移动、删除、连轴绑定。
- 机械端口连接和预览。
- 压力板检视和运行预览。
- 缩略图、状态栏、toast、设置面板仍可用。
- 点击保存后才持久化；编辑期间不发服务端请求。

## 阶段 6：测试和验证

1. 单元测试：
   - 保留并继续跑 `src/components/game/cityChannel` 现有测试。
   - 新增 Three 几何测试：cell 到 world、world 到 cell、edge wall transform、miter profile、gear socket world position。
   - 新增 picking 测试：ray 命中地面板、竖板、边缘墙、齿轮、空地。
2. 交互测试：
   - 用 Playwright 或现有 e2e 能力打开城内工坊，验证编辑器 canvas 非空。
   - 桌面和移动尺寸各截一次图，检查不重叠、不黑屏、不空白。
3. 包体测试：
   - `npm run build` 后记录 chunk。
   - 确认首页不会加载 Three 正交编辑器 chunk。
   - 确认城内工坊列表不会加载编辑器 runtime chunk。
   - 确认点击编辑模板才加载 Three runtime。
4. 性能测试：
   - 100、500、1000 块板材场景下记录初次构建、移动、缩放、选择耗时。
   - 低端设备优先关闭阴影、降低 pixel ratio、启用 instancing。

## 阶段 7：替换和清理

1. 默认启用 Three 正交编辑器。
2. 保留 Phaser 编辑器一到两个版本作为回退入口。
3. Three 版通过验收后删除：
   - `CityChannelPhaserEditor.js`
   - `cityChannel/phaser/` 下只服务旧编辑器的文件
   - `phaser` package 依赖和 lockfile 条目
4. 删除或迁移旧 Phaser 专属测试，保留领域逻辑测试。
5. 再跑完整构建和城内工坊测试，确认包体下降或至少没有主包回归。

## 实施顺序建议

1. 完成阶段 0 的依赖分类和 build 基线。
2. 新建 Three 编辑器骨架，只渲染现有 mapData 的地面板和边缘墙。
3. 接入正交相机、平移、缩放、基础 picking。
4. 接入放置 ghost 和单块放置提交。
5. 接入选择、删除、移动、复制、旋转。
6. 接入图层、网格、坐标、缩略图联动。
7. 接入齿轮、连轴绑定、机械端口。
8. 接入机关播放和压力板检视复用。
9. 开启 feature flag 对比 Phaser/Three 行为。
10. 完成验收后删除 Phaser 依赖和旧渲染器。
