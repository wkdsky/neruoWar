# 城内工坊机械传动系统设计与进度

> 维护约定：凡是修改城内工坊机械传动相关代码，都要同步更新本文档的“当前进度”“实现细节”或“后续任务”。这样新对话里的 AI 可以从本文档继续推进。

## 1. 任务目标

城内工坊需要一套足够符合直觉的机械传动系统，用于在画布上组合多个机械组件时判断：

- 哪些齿轮、齿条、固定轴、绑定板材会被带动。
- 它们的运动趋势是什么。
- 多个主动源驱动同一自由度时是否一致。
- 如果出现矛盾，应该阻止预览并提示最直接导致卡住的物件。
- 如果没有矛盾，应该允许运动，并让相关物件按约束真实运动。

目前不能继续靠单点补丁处理。长期目标是把齿轮、齿条、板材绑定、固定轴、碰撞阻挡统一成一个 motion intent / constraint graph。

## 2. 外部参考结论

- 多体机械系统通常用约束方程描述齿轮、齿条、关节和刚体之间的运动关系；多个输入必须满足同一组约束，否则就是约束冲突。
- Rack and pinion 是转动自由度和线性自由度之间的运动约束，而不是简单碰撞。
- 齿轮啮合约束会把一个齿轮的角速度按比例传给另一个齿轮；外齿轮直接啮合方向相反。
- 同一齿条同一侧的 pinion 若想推动齿条同向移动，齿轮转动方向必须一致；不同侧时方向关系相反。

参考：

- MathWorks Rack and Pinion Constraint: https://www.mathworks.com/help/sm/ref/rackandpinionconstraint.html
- MathWorks Gear Constraint: https://www.mathworks.com/help/sm/ug/model-gear-constraints-1.html
- Box2D Gear Joint: https://box2d.org/doc_version_2_4/structb2_gear_joint_def.html

## 3. 目标模型

### 3.1 Motion Intent

每个可运动对象都应有一个趋势描述：

```js
{
  id,
  kind: 'gear' | 'rack' | 'placement',
  motionType: 'rotation' | 'translation' | 'rigidRotation' | 'rigidTranslation',
  axis,
  valuePerSourceAngle,
  sourceIds,
  constraints,
  blockers
}
```

含义：

- `gear`：齿轮角运动趋势。
- `rack`：齿条沿自身轴线的线运动趋势。
- `placement`：被齿条或固定轴绑定的板材运动趋势。
- `valuePerSourceAngle`：相对触发源角度的运动比例。
- `constraints`：造成该趋势的齿轮啮合、齿条啮合、轴绑定等。
- `blockers`：冲突或碰撞来源。

### 3.2 Constraint Types

需要覆盖的约束：

- `gearMesh`：两个齿轮啮合，角速度按齿数比反向传播。
- `rackPinion`：齿轮与齿条啮合，角速度转换成齿条线速度。
- `rackCarry`：齿条绑定板材，板材随齿条平移。
- `axisBinding`：齿轮固定轴绑定板材，板材绕轴旋转。
- `rigidAssembly`：一组板材作为刚体一起运动。
- `collision`：运动路径碰到板材、墙或齿条自身阻挡。

### 3.3 Conflict Types

当前和目标都应能表达：

- `gearDriveConflict`：齿轮啮合链上多个主动源要求同一齿轮不同转动趋势。
- `rackDriveConflict`：多个主动 pinion 要求同一齿条不同线运动趋势。
- `placementMotionConflict`：同一板材被多个约束要求不同刚体运动。
- `collisionBlock`：运动趋势本身一致，但路径被静态物体阻挡。

## 4. 当前实现状态

### 4.1 已实现

- 第一版 `createMechanismMotionIntentGraph` 已建立，可以统一输出 `gears`、`racks`、`placements` 和冲突列表。
- 齿轮啮合图会传播 `driveRatio`。
- 显式主动齿轮的配置方向会参与齿轮啮合冲突检测。
- 未显式配置方向的普通齿轮可以作为从动/中继，不会误判为独立主动源。
- `gearDriveConflict` 会阻止预览，红闪直接相关齿轮所在板材，并提示：
  `主动齿轮之间的啮合方向互相矛盾，齿轮组被卡住。`
- 齿轮-齿条接触会计算有符号线运动系数。
- 同一齿条多个主动 pinion 的线运动趋势一致时，会合并连续接触区间，允许接力驱动。
- 同一齿条多个主动 pinion 的线运动趋势矛盾时，会生成 `rackDriveConflict`，齿条不动，并提示：
  `主动齿轮正在把同一齿条推向相反方向，齿条被卡住。`
- 有限齿条离开所有主动 pinion 接触范围后会停止，不会远程继续移动。
- 齿条向下穿入水平板材时会被阻挡，并能对多个阻挡板材红闪。
- `placementMotionConflict` 已有第一版 graph 检测：同一板材在同次触发里收到不同运动趋势时会进入 `conflicts`。
- placement intent 现在带 `motionSignature`，同类型刚体运动会比较几何含义，而不是只比较运动类型。
- 刚体平移会比较每源角度的有效位移向量，支持轴向相反但驱动符号也相反的等价平移。
- 刚体旋转会比较角速度、旋转轴心和旋转轴面；同类型但轴心/轴面不同的旋转会被视为运动趋势冲突。
- 当旋转 entry 没有真实轴心坐标时，graph 会回退比较 `fixedAxisId`，避免把缺失坐标误判为同一个世界轴心。
- `findMechanismMotionObstructions` 已加入模拟层，统一收集旋转组件和齿条平移组件的路径阻挡。
- `createMechanismMotionIntentGraph` 现在可以接收 `collisionBlocks`，并把阻挡表达为 `collisionBlock` 冲突。
- Three Runtime 的碰撞阻挡判断已改为通过模拟层 helper 产出，并回填到 motion intent graph 后再读取。
- `rackDriveConflict` 和齿条相关 `collisionBlock` 会携带 `rackIds/racks`，用于直接提示齿条本体。
- Three Runtime 的红闪提示现在支持齿条目标，齿条传动冲突不再只能闪宿主板材或主动齿轮所在板材。
- `gearDriveConflict` 和 `rackDriveConflict` 会携带 `gearKeys/gearTargets`，用于直接提示导致冲突的具体齿轮。
- Three Runtime 的红闪提示现在支持齿轮目标，可以按 `${componentKey}:${mountId}` 找到 gear mesh 并创建红色齿轮 overlay。
- graph 现在会显式排序冲突优先级：`gearDriveConflict` > `rackDriveConflict` > `placementMotionConflict` > `collisionBlock`。
- runtime 继续读取 `conflicts[0]`，但该顺序现在由明确 priority 表保证，不再依赖隐式数组拼接约定。
- 齿轮传播图现在会检查 `viaRackId` 齿条边上的闭环 ratio 矛盾；如果同一齿轮同时被齿轮网和齿条网要求不同转动趋势，会生成 `gearDriveConflict`。
- 由齿条边导致的 `gearDriveConflict` 会携带 `viaRackId`，graph 会补充 `rackIds/racks` 供红闪提示使用。
- 但同一齿条上多个显式主动轮方向矛盾时，`viaRackId` 不会抢先生成齿轮冲突，仍由更直接的 `rackDriveConflict` 负责提示。

### 4.2 主要文件

- `frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.js`
  - 齿轮图、齿条位移、冲突检测、运行快照。
- `frontend/src/components/game/cityChannel/three/CityChannelThreeRuntime.js`
  - 触发机制、预览、红闪和 toast。
- `frontend/src/components/game/cityChannel/cityChannelMechanismSimulation.test.js`
  - 机械规则单元测试。
- `frontend/src/components/game/cityChannel/three/CityChannelThreeRuntime.test.js`
  - Three Runtime 触发和提示测试。

## 5. 已覆盖的关键场景

- 单个主动轮驱动有限齿条，离开接触范围后停止。
- 多个同向主动轮在同一齿条上接力驱动。
- 同侧主动轮反向驱动同一齿条时卡住。
- 不同侧主动轮反向转动驱动同一齿条时允许。
- 显式主动齿轮直接啮合且方向矛盾时卡住。
- 普通中继齿轮没有显式方向时不误判冲突。
- 齿条碰到下方水平板材时阻挡并红闪多个板材。
- 同一板材收到等价平移趋势时允许，不会仅因来源不同而误判卡住。
- 同一板材收到不同旋转轴趋势时会生成 `placementMotionConflict`。
- 多条齿条同时拖动同一板材且位移趋势不一致时，会生成 `placementMotionConflict`。
- 齿轮-齿条-齿轮闭环中，齿轮网和齿条网给出的转动趋势一致时允许，不一致时生成 `gearDriveConflict`。

## 6. 仍需推进

1. 给冲突对象提供更精确的可视目标：
   - 齿轮冲突已能闪齿轮本体和齿轮宿主板材；后续可细化到具体啮合接触点。
   - 齿条冲突已能闪参与冲突的 pinion 宿主和齿条；后续可细化到具体齿条接触段。
   - 板材运动冲突闪被矛盾驱动的板材。
2. 补充更多组合测试：
   - 固定轴旋转板材与齿条平移板材同时驱动。
   - 同一个齿轮同时被齿轮网和齿条网约束。

## 7. 测试命令

相关测试：

```bash
cd frontend
npm test -- --watchAll=false --runTestsByPath src/components/game/cityChannel/cityChannelMechanismSimulation.test.js src/components/game/cityChannel/three/CityChannelThreeRuntime.test.js
```

完整 cityChannel 测试：

```bash
cd frontend
npm test -- --watchAll=false src/components/game/cityChannel
```

格式检查：

```bash
git diff --check
```

## 8. 当前注意事项

- 工作区可能存在用户截图文件变动，不要把它们当作代码变更处理。
- 当前实现仍处于过渡状态：已有第一版公开 motion intent graph，主动冲突和碰撞阻挡已接入 graph；部分板材运动趋势仍需要继续细化。
- 后续每次改动代码后，必须更新本文档。

## 9. 本轮记录

- 额外需求：修复“齿条上移带动齿条侧被动齿轮后，该被动齿轮没有继续带动相邻齿轮”的问题。结论是 runtime snapshot 只把 `rackDrivenGearStates` 写入最终 `gears`，没有再通过普通 gear mesh 继续传播。
- `createMechanismRuntimeSnapshot` 已新增 rack-driven gear mesh 传播：齿条扫过产生的被动齿轮旋转会作为临时根节点，通过普通齿轮接触图继续 BFS 传播相位和 `speedRatio`；主动 drive root 不会被该临时传播覆盖。
- `cityChannelMechanismSimulation.test.js` 已新增“齿条带动被动齿轮，被动齿轮继续带动相邻被动齿轮”的回归用例，确保相邻齿轮获得相反 `speedRatio` 和按现有整数相位归一化规则得到的相位。
- 继续排查实际截图无变化：已新增使用真实 `getGearWorldPosition` / `getGearMeshPlane` / `getGearSurfaceKey` 的跨层竖直板齿轮啮合测试，并使用长竖直齿条确保齿条扫过中间被动齿轮，避免手写节点坐标绕过真实接触判定。
- rack-driven 及其后续 mesh 传播生成的齿轮 runtime state 已强制 `axisBindingOverride: null`，确保这些间接被动齿轮按 free axis 显示旋转，不会因为旧轴绑定或所在板材 runtime placement 吞掉自身相位。
- `CityChannelThreeRuntime.test.js` 已新增渲染同步回归：即使存档 gear mount 带 axis binding，只要 runtime state 是 `axisType: freeAxis` 且 `axisBinding: null`，`syncGearMeshRuntimeTransform` 就会抑制绑定并使用 runtime phase。
- 继续修复“上方两个齿轮没有啮合标志”：`buildGearContactGraph` 现在除节圆相切距离外，也会把同一机械平面上相邻 1 格的显式中心齿轮视为啮合；任意松散距离和缺少 mount/position 信息的节点仍不建边。新增测试覆盖相邻竖直板中心齿轮会建 gear-mesh 边。
- `CityChannelThreeRuntime.test.js` 已新增相邻竖直板中心齿轮的啮合标志回归，确保 `addGearContactVisuals` 会为这类 gear-mesh 边绘制 marker 和 contact tube。
- `CityChannelThreeRuntime.test.js` 已新增竖直板中心齿轮到相邻格角点齿轮的啮合标志回归，使用真实 `mapData -> renderModel -> getAllGearNodes -> addGearContactVisuals` 路径覆盖上方间接传动里常见的中心/角点跨层接触。
- 相邻中心齿轮的 1 格建边只对同一机械平面内的真实相邻接触开放：竖直板面只允许同高度、沿墙面切线方向相邻的中心齿轮啮合，不把上下堆叠的中心齿轮误判成直接啮合；水平面允许 x/y 两个网格方向的中心相邻啮合。
- PASSIVE 齿轮语义正在调整：PASSIVE 只表示“不是主动源/不提供独立方向输入”，不再表示“被齿轮或齿条带动后不能驱动轴绑定板材”。`isDrivenGearAxisBindingActive` 现在允许已有 `driveRatio` 的被动齿轮带动有效轴绑定；绑定回主动源装配体的降级仍由 `axisBindingSuppressed` 保留。
- `createMechanismRuntimeSnapshot` 正在补齐动态连轴：齿条平移过程中才接触到的齿轮，以及这些齿轮继续通过普通 gear mesh 带动的齿轮，如果存在轴绑定，会在 snapshot 内生成临时 fixed-axis runtime entry，让绑定板材/绑定装配体跟随旋转，而不是只让齿轮本体播放 free-axis 动画。
- 连轴有效性正在改为装配体级别：如果齿轮绑定到某块板，但该板所在机械装配体里的另一块板才是真正同轴角点，则 `getGearAxisBindingStatus` 会解析到真实同轴板材并视为有效；这样同一刚体整体里选择上板或下板不会出现一个有效、一个感叹号的差异。
- 回归测试正在同步：旧的“被动齿轮不驱动绑定板材”用例已改为“被驱动的 PASSIVE 齿轮会驱动轴绑定”；真实竖直板齿条-齿轮-齿轮间接传动用例现在断言轴绑定板材进入 `snapshot.placements`；`cityChannelMechanismRuntime.test.js` 新增同一机械装配体内解析真实同轴板材的绑定状态用例。
- rack-driven gear mesh / passive axis binding targeted 测试已通过：`npm test -- --watchAll=false --runTestsByPath src/components/game/cityChannel/cityChannelMechanismSimulation.test.js`，67 个 tests 全部通过。
- 机械装配和连轴状态 targeted 测试已通过：`npm test -- --watchAll=false --runTestsByPath src/components/game/cityChannel/cityChannelMechanismRuntime.test.js`，22 个 tests 全部通过。
- Three Runtime targeted 测试已通过：`npm test -- --watchAll=false --runTestsByPath src/components/game/cityChannel/three/CityChannelThreeRuntime.test.js`，140 个 tests 全部通过。
- 完整 cityChannel 测试已通过：`npm test -- --watchAll=false src/components/game/cityChannel`，16 个 test suites、339 个 tests 全部通过。
- 生产编译已通过：`npm run build` 输出 `Compiled successfully.`。
- 3001 dev server 已确认包含本轮代码：`CityChannelEditor` chunk 可搜到 `createRackDrivenAxisBindingRuntimeEntries`，`CityWorkshopPage` chunk 可搜到 `findAssemblyAxisBindingPivotCandidate` / `resolvedFromBinding`。
- 额外需求：移除竖直板材最高连续搭四块的限制。已在 Three 几何放置校验中加入 `allowLayerExpansion` 参数，使指定调用可以按目标层临时扩展 `mapData.layers` 后再校验 `isValidCell`，保留 x/y 越界、占用、支撑和材料限制。
- `getThreeVerticalTilePlacementBlockReason` / `createThreeVerticalTilePlacementOperation` 已默认允许顶端续搭扩层，因此第 4 块竖直板上方的第 5 块不会再被当前 `layers = 4` 误判为 `invalidCell`。
- Three Runtime 的 `createVerticalTopSnapTarget` 已对竖直板和 edge wall 顶端续搭传入 `allowLayerExpansion: true`；普通地面、替换、侧边放置仍沿用原层高校验。
- `cityChannelThreeGeometry.test.js` 已更新：覆盖竖直板顶端续搭超过当前层数会生成操作，同时 x/y 越界、占用、入口/出口材料限制仍然会阻止放置；edge wall 顶端续搭也覆盖扩层。
- `CityChannelThreeRuntime.test.js` 已新增四块竖直板之上继续顶端吸附的回归用例，预期目标为 `z: 4` 且 `valid: true`。
- 顶端续搭相关 targeted 测试已通过：`npm test -- --watchAll=false --runTestsByPath src/components/game/cityChannel/three/cityChannelThreeGeometry.test.js src/components/game/cityChannel/three/CityChannelThreeRuntime.test.js`。
- 完整 cityChannel 测试已通过：`npm test -- --watchAll=false src/components/game/cityChannel`，结果为 16 个 test suites、332 个 tests 全部通过。
- 新增 `createMechanismMotionIntentGraph`，初步统一齿轮、齿条、板材的运动趋势描述。
- Three Runtime 的 `triggerMechanismAtCell` 已改为从 motion intent graph 读取 `gearDriveConflict` 和 `rackDriveConflict`，不再在运行时内联重复收集这两类冲突。
- Three Runtime 会先用未去重的 assembly entries 进行 motion intent 分析；如果发现 `placementMotionConflict`，会阻止预览、红闪冲突板材，并提示：
  `同一板材被多个机械约束要求不同运动，传动被卡住。`
- `cityChannelMechanismSimulation.test.js` 已增加 graph 输出断言，覆盖 `gearDriveConflict`、`rackDriveConflict`、`placementMotionConflict` 会进入 `conflicts`。
- `CityChannelThreeRuntime.test.js` 已增加运行时用例，覆盖同一板材同时收到旋转和平移趋势时会被拦截并提示。
- `findMechanismMotionObstructions` 已加入，用于在模拟层统一收集旋转/齿条平移路径上的阻挡。
- Three Runtime 的 `triggerMechanismAtCell` 已从 motion intent graph 读取 `collisionBlock`，不再内联分别调用旋转阻挡和齿条阻挡查询。
- Three Runtime 不再直接依赖齿条/旋转阻挡底层查询，触发路径通过 `findMechanismMotionObstructions` 收敛。
- `cityChannelMechanismSimulation.test.js` 已增加 `collisionBlock` 回填到 graph 的断言。
- `placementMotionConflict` 已升级为 `motionSignature` 比较：平移按有效位移向量判断，旋转按角速度、轴心和轴面判断。
- 旋转签名只有在 entry 带 pivot/anchor 或 fixed axis 可解析到 component/cell 时才使用世界轴心，否则用 `fixedAxisId` 做保守判断。
- `cityChannelMechanismSimulation.test.js` 已增加等价平移、不同未解析旋转轴冲突、同一已解析旋转轴允许三类用例。
- `rackDriveConflict` 和齿条相关 `collisionBlock` 已补充 `rackIds/racks`；Three Runtime 的 `flashMechanismObstruction` 已能为这些 rack 目标创建红色齿条闪烁。
- `cityChannelMechanismSimulation.test.js` 和 `CityChannelThreeRuntime.test.js` 已补充齿条冲突目标断言，确保 `rackIds/racks` 会传到红闪入口。
- Runtime 测试按 normalize 后的 rack 对象断言 `id`，不要依赖原始 rack 引用完全一致。
- `CityChannelThreeRuntime.test.js` 已补充 `flashMechanismObstruction({ rackId })` 用例，直接覆盖齿条红闪 group 创建和材质替换。
- `gearDriveConflict` / `rackDriveConflict` 已补充 `gearKeys/gearTargets`，Three Runtime 会按 gear mesh key 创建齿轮红闪 overlay。
- `cityChannelMechanismSimulation.test.js` 已断言齿轮/齿条冲突会输出 `gearKeys/gearTargets`。
- `CityChannelThreeRuntime.test.js` 已断言 gear conflict 会把具体齿轮目标传入红闪入口，并补充 `flashMechanismObstruction({ gearTargets })` 的齿轮红闪 overlay 用例。
- gear target 生成会优先用 `sourceGearMountId`，旧测试/旧节点缺少该字段时会从 `sourceGearNodeId = componentKey:mountId` 回退解析。
- `createMechanismMotionIntentGraph` 已加入显式冲突优先级排序，测试覆盖四类冲突同时存在时的顺序。
- `cityChannelMechanismSimulation.test.js` 已补充多齿条共享同一板材但位移趋势不同的 `placementMotionConflict` 用例。
- `resolveDrivenGearNodes` 已不再跳过 `viaRackId` 边的闭环 ratio 检查，齿轮网和齿条网双约束冲突会进入 `gearDriveConflict`。
- `cityChannelMechanismSimulation.test.js` 已补充齿轮-齿条-齿轮闭环一致允许、闭环矛盾卡住两类用例。
- `viaRackId` 显式主动轮方向矛盾会让位给 `rackDriveConflict`，避免同一齿条多主动轮冲突被误提示为齿轮闭环冲突。
- 本轮验证通过：
  - `npm test -- --watchAll=false --runTestsByPath src/components/game/cityChannel/cityChannelMechanismSimulation.test.js src/components/game/cityChannel/three/CityChannelThreeRuntime.test.js`
  - `npm test -- --watchAll=false src/components/game/cityChannel`
- graph 当前输出：
  - `gears`
  - `racks`
  - `placements`
  - `conflicts`
- graph 当前覆盖的冲突：
  - `gearDriveConflict`
  - `rackDriveConflict`
  - `placementMotionConflict`
  - `collisionBlock`
- 额外修复：交叉口根齿轮现在会使用安装时记录的源板材/源 socket 作为姿态参考，竖直板面上的交叉口齿轮不再被水平 fallback transform 固定为平放；传动节点的 `meshPlane` 也随源面计算。
- 交叉口根齿轮选择不再要求 `placement`，`hostKind: 'intersection'` 会进入 component selection；Runtime 的齿轮移动预览和 Editor 的 Delete 删除路径都能识别 `mapData.gears` 中的根齿轮。
- 本轮验证通过：`npm test -- --watchAll=false src/components/game/cityChannel`，16 个 test suites、354 个 tests 全部通过；`git diff --check` 通过。补充覆盖空白点击不会在 `getPlacementSelectionFromData(null)` 报错。
