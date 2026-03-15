# Home To Mainview Transition Implementation Notes

## 改动文件

- `frontend/src/App.js`
- `frontend/src/App.css`
- `frontend/src/SceneManager.js`
- `frontend/src/WebGLNodeRenderer.js`
- `frontend/src/components/game/NodeDetail.js`
- `frontend/src/components/game/NodeDetail.css`
- `frontend/src/components/senseArticle/hooks/useSenseArticleNavigation.js`

## 新增文件

- `frontend/src/components/game/TransitionGhostLayer.js`
- `frontend/src/components/game/TransitionGhostLayer.css`

## 六边形 -> 圆形过渡的实现方式

- 首页真实节点仍然保留为 DOM/CSS 六边形卡片，来源锚点直接使用 `anchorElement.getBoundingClientRect()`。
- 在 `App` 顶层新增了独立于页面切换生命周期的 `homeDetailTransition` 状态，并把 `TransitionGhostLayer` 挂在高层，保证首页卸载后 ghost 仍可继续动画。
- `TransitionGhostLayer` 没有克隆真实 DOM，也没有使用截图方案，而是用轻量 SVG 轮廓做近似形变。
- 形变通过一组 pointy-top hex 轮廓点与 circle 轮廓点插值生成 path，实现明显可见的收圆过程。
- ghost 同时做了位置、尺寸、透明度、光晕、边框和文本层的 handoff，起始质感更接近首页卡片，结束时更接近主视角中心节点。

## 过渡上下文如何跨 view 保持

- `App.js` 中新增了过渡上下文，记录 source rect、source 文本、变体类型、目标 mode / nodeId / senseId、target screen center、target size、状态机等。
- 首页点击时只 `arm`，selector 打开不清掉这份上下文。
- selector 中用户确认进入 `titleDetail` 或 `nodeDetail` 时，先写入目标信息，再保持现有导航/数据请求逻辑继续执行。
- 详情页 ready 后，通过真实 renderer 的 `worldToScreen(...)` 和 canvas rect 计算中心节点目标屏幕坐标，ghost 再执行落场。
- 真实中心节点通过 renderer 的 reveal channel 延后提亮，避免 ghost 与 WebGL 中心节点硬重影。

## 主视角视觉升级的主要内容

- WebGL 节点改成多层渲染，不再只有单层球体色块。
- 按 `center / parent / child / title / search` 做了更明确的 glow、rim、pattern 和文字辅色区分。
- hover 除了 glow，还加入了轻微 scale / clarity 提升。
- label 样式改成更贴合节点的玻璃化标签，中心/父/子/标题节点有不同边框和显隐节奏。
- 连线增加了 glow trail、线芯分层和更自然的端点 caps。
- `fadeTransition` / `nodeToNodeTransition` 调整了 easing、stagger、overshoot 与入场顺序。
- `NodeDetail` 场景容器新增 atmosphere 层，补上渐变、网格、halo 等氛围。
- selector、relation popup、sense article entry banner 等 overlay 样式做了统一的边框、阴影和玻璃感收敛。

## 刻意没有改动的地方

- 没有把首页节点迁回 WebGL。
- 没有重写 `SceneManager` 的场景职责，也没有保留旧 scene manager 强行做过渡。
- 没有改 `home / titleDetail / nodeDetail` 的业务语义。
- 没有改知识域/释义数据结构。
- 没有改 `fetchTitleDetail / fetchNodeDetail` 的业务逻辑。
- 没有改布局语义，只调整了表现层参数、动画编排和视觉呈现。

## 仍可继续优化的点

- ghost 文本 handoff 目前是淡出式接力，后续可继续做更细的 label 对位与字符级 reveal。
- 主视角背景氛围目前主要靠容器层和 renderer glow，后续可以继续补更细的 shader 噪声或远层粒子。
- 如果后续需要更强的一致性，可以把首页卡片和 ghost 的视觉 token 再进一步抽到同一份配置。
