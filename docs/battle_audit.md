# Battle / Movement / Collision / Camera / Map 专项审计

## 1. Quick Start（本地最少步骤）
1. 在仓库根目录执行：`./start.sh`。
2. 打开脚本输出的前端地址（默认 `http://localhost:3000`）并登录。
3. 进入训练场路径：顶部导航 `军事 -> 训练场`（`frontend/src/App.js:5929`, `frontend/src/App.js:6180`）。
4. 进入围城 PVE 战斗路径：围城弹窗里点击 `进攻`（`frontend/src/App.js:6578`，请求 `GET /api/nodes/:nodeId/siege/pve/battle-init`，见 `backend/routes/nodes.js:7726`）。
5. 训练场初始化接口：`GET /api/army/training/init`（`backend/routes/army.js:239`）。

## 2. Relevant File Map（按模块分组）

### 快速结构树（仅战斗/移动/碰撞/相机/地图相关）
```text
frontend/src/
  components/game/
    BattleSceneModal.js
    PveBattleModal.js
    TrainingGroundPanel.js
  game/
    battle_v2/
      runtime/
        BattleRuntime.js
        BattleClock.js
        FlagBearer.js
      render/
        CameraController.js
        GroundRenderer.js
      ui/
        BattleDebugPanel.js
        BattleHUD.js
        Minimap.js
    battle/
      crowd/
        CrowdSim.js
        crowdPhysics.js
        crowdCombat.js
        engagement.js
backend/routes/
  army.js
  nodes.js
```

### Battle Runtime
- `frontend/src/game/battle_v2/runtime/BattleRuntime.js`
  - `startBattle`, `commandMove`, `commandBehavior`, `step`, `getFocusAnchor`, `getDebugStats`
  - 关键变量：`TEAM_ZONE_GUTTER`, `field`, `sim`, `crowd`, `debugStats`
- `frontend/src/game/battle_v2/runtime/BattleClock.js`
  - `tick`（fixed-step 累加器）
- `frontend/src/game/battle_v2/runtime/FlagBearer.js`
  - `resolveSquadAnchor`, `resolveFallbackAnchor`

### AI / 指令 / 行为
- `frontend/src/game/battle/crowd/CrowdSim.js`
  - `updateSquadBehaviorPlan`, `leaderMoveStep`, `updateCrowdSim`, `triggerCrowdSkill`
  - `ensureFlagBearer`, `aggregateSquadFromAgents`
- `frontend/src/game/battle/crowd/engagement.js`
  - `syncMeleeEngagement`（近战配对、车道、绕行 waypoint 注入）
- `frontend/src/game/battle/crowd/crowdCombat.js`
  - `updateCrowdCombat`（自动攻击、LOS、投射物/伤害）

### Movement / Collision
- `frontend/src/game/battle/crowd/crowdPhysics.js`
  - `pushOutOfRect`, `buildSpatialHash`, `querySpatialNearby`, `estimateLocalFlowWidth`, `raycastObstacles`

### Camera / Render
- `frontend/src/game/battle_v2/render/CameraController.js`
  - `update`, `buildMatrices`
- `frontend/src/components/game/BattleSceneModal.js`
  - RAF 主循环、输入命令、相机跟随、HUD/Debug 挂载
- `frontend/src/game/battle_v2/ui/BattleDebugPanel.js`
  - FPS、模拟耗时、渲染耗时、小人模型数量等显示

### Map / Boundary / Deploy
- `frontend/src/game/battle_v2/render/GroundRenderer.js`
  - 地面左右/中线视觉分区（shader mask）
- `frontend/src/game/battle_v2/ui/Minimap.js`
- `frontend/src/components/game/TrainingGroundPanel.js`
- `backend/routes/army.js`（训练场 init）
- `backend/routes/nodes.js`（围城 battle-init/result）

## 3. Runtime Pipeline（调用链 / 数据流）

### 3.1 输入到命令
- 用户输入（鼠标点地面 / 小地图 / 按钮）
  - `BattleSceneModal.handleMapCommand` / `handleMinimapClick` / `handleBehavior`
- 生成指令
  - `runtime.commandMove(...)`
  - `runtime.commandBehavior(...)`
  - `runtime.commandSkill(...)`

### 3.2 命令到模拟
- RAF 帧循环（`requestAnimationFrame`）
  - `BattleSceneModal` 每帧计算 `deltaSec`
- 固定步推进（simulation）
  - `BattleClock.tick(deltaSec, stepFn)`
  - `stepFn -> BattleRuntime.step(fixedStep)`

### 3.3 模拟内部
- `BattleRuntime.step`
  - `updateCrowdSim(crowd, sim, dt)`
  - 然后执行硬边界修正（squad/agent/waypoint/rally/goal 的 team-zone clamp）
- `updateCrowdSim`
  - `syncMeleeEngagement`（配对/站位锚点/绕行）
  - `updateSquadBehaviorPlan`（自动行为写 waypoint）
  - `leaderMoveStep`（编队锚点移动）
  - agent slot 跟随 + separation + wall push + 积分
  - `aggregateSquadFromAgents`（把 squad.x/y 写回旗手锚点）
  - `updateCrowdCombat`（自动攻击、投射物、伤害）

### 3.4 模拟到渲染与相机
- 渲染快照
  - `runtime.getRenderSnapshot()` -> `units/buildings/projectiles/effects`
- 相机跟随
  - `runtime.getFocusAnchor()` -> `resolveSquadAnchor()`（优先旗手）
  - `camera.update(deltaSec, followAnchor)`（lerp + look-ahead）
  - `camera.buildMatrices(...)`
- 渲染器执行
  - `ground/building/impostor/projectile/effect.render(...)`

## 4. Current Implementation Findings（A~F）

### A. leader/旗手是否参与推挤解算？collider 是什么？谁写入位置？更新频率？
结论：**参与**。

- 关键位置
  - `createAgent` 定义单体半径：`radius: AGENT_RADIUS`（`frontend/src/game/battle/crowd/CrowdSim.js:560`）。
  - `ensureFlagBearer` 仅决定谁是旗手（`frontend/src/game/battle/crowd/CrowdSim.js:597`）。
  - agent 统一运动循环中，旗手也在 `sorted.forEach` 里执行 separation、障碍推出、位置积分（`frontend/src/game/battle/crowd/CrowdSim.js:1143`）。
  - `aggregateSquadFromAgents` 用旗手位置回写 `squad.x/y`（`frontend/src/game/battle/crowd/CrowdSim.js:791`, `frontend/src/game/battle/crowd/CrowdSim.js:801`）。

- collider / 推挤
  - 近邻分离由 `computeTeamAwareSeparation` 提供（`frontend/src/game/battle/crowd/CrowdSim.js:193`）。
  - 与墙体碰撞由 `pushOutOfRect` 处理（`frontend/src/game/battle/crowd/crowdPhysics.js:33`，调用点 `frontend/src/game/battle/crowd/CrowdSim.js:1204`）。

- 位置写入链
  - `leaderMoveStep` 写 `squad.x/y`（`frontend/src/game/battle/crowd/CrowdSim.js:751`）。
  - agent 更新写 `agent.x/y`（`frontend/src/game/battle/crowd/CrowdSim.js:1216`）。
  - 再由 `aggregateSquadFromAgents` 把 `squad.x/y` 写成旗手位置（`frontend/src/game/battle/crowd/CrowdSim.js:801`）。
  - `BattleRuntime.step` 最后又做 team-zone clamp（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:1003`）。

- 更新频率
  - fixed-step：默认 `1/30s`（`frontend/src/game/battle_v2/runtime/BattleClock.js:2`, `frontend/src/game/battle_v2/runtime/BattleClock.js:27`）。

### B. 相机跟随目标是什么？是否平滑/死区？是否存在 sim/render 不同步抖动？
结论：目标来自**旗手锚点体系**，实际喂给相机的是“`squad`位置 + 锚点速度”；有平滑，无显式死区；存在 sim/render phase mismatch 风险。

- 关键链路
  - `runtime.getFocusAnchor()` -> `resolveSquadAnchor()`（旗手优先）
    - `frontend/src/game/battle_v2/runtime/BattleRuntime.js:1137`
    - `frontend/src/game/battle_v2/runtime/FlagBearer.js:18`
  - 渲染帧里构造 `followAnchor`
    - 位置优先 `runtime.getSquadById(...).x/y`，速度取 `rawFollowAnchor.vx/vy`
    - `frontend/src/components/game/BattleSceneModal.js:679`, `frontend/src/components/game/BattleSceneModal.js:684`
  - 相机更新
    - `followLerp = clamp(dt * 6.8, 0, 1)`
    - look-ahead：`speed * lookAheadScale`
    - `frontend/src/game/battle_v2/render/CameraController.js:279`

- 不同步风险
  - 仿真是 fixed-step（`BattleClock.tick`），渲染是 RAF 可变步（`BattleSceneModal`）。
  - UI 状态同步每 120ms 一次（`frontend/src/components/game/BattleSceneModal.js:737`），虽然相机每帧更新，但观测面板与真实模拟相位不完全一致。
  - 旗手切换（死亡/重选）会造成锚点跳变（`ensureFlagBearer`）。

### C. 混编部队速度如何计算？如果没有混编结构，数据结构如何？
结论：存在“部队内多兵种”结构，但**无专门混编机动模型**；速度主要是“部队均速 + 单体乘子”。

- 数据结构
  - `squad.units` 是 `{ unitTypeId: count }`（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:381`）。
  - `aggregateStats` 对各兵种按人数加权平均，得到 `stats.speed/atk/def/range`（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:74`）。
  - `classTag` 取主兵种（数量最多的类型）推断（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:115`）。

- 速度计算
  - leader：`speedBase = squad.stats.speed * 18`（再乘士气/疲劳/技能）
    - `frontend/src/game/battle/crowd/CrowdSim.js:697`
  - agent：`squad.stats.speed * 20 * agent.moveSpeedMul`（再乘士气/疲劳/拥挤）
    - `frontend/src/game/battle/crowd/CrowdSim.js:1159`
  - `agent.moveSpeedMul` 按 unitType.speed 归一（`frontend/src/game/battle/crowd/CrowdSim.js:168`）。

- 当前行为判断
  - 不存在“慢兵种限制整队速度”“队内速度耦合器”“编队重整延迟”这类机制，混编速度表现更像线性混合。

### D. 当前部队移动为什么偏僵硬？是否缺 maxTurnRate / acceleration / arrival？是否有撤退？
结论：偏僵硬主要来自**直接指向目标的速度积分**，确实缺 turn-rate/acceleration/arrival 曲线；撤退状态存在。

- 证据
  - `leaderMoveStep` 直接 `dir = normalize(target - squadPos)`，`step = speed * dt`，没有角速度上限/加速度状态机（`frontend/src/game/battle/crowd/CrowdSim.js:729`, `frontend/src/game/battle/crowd/CrowdSim.js:735`）。
  - 到点逻辑是固定半径阈值清 waypoint（`<=5.4`，`frontend/src/game/battle/crowd/CrowdSim.js:772`）。
  - agent 朝 slot 点 + separation 直接积分（`frontend/src/game/battle/crowd/CrowdSim.js:1171`, `frontend/src/game/battle/crowd/CrowdSim.js:1202`）。
  - yaw 直接用速度方向赋值（`frontend/src/game/battle/crowd/CrowdSim.js:1220`）。
  - 撤退状态明确存在：`commandBehavior('retreat')` + fallback waypoint（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:982`, `frontend/src/game/battle/crowd/CrowdSim.js:501`）。

### E. “不听指挥/左右拉扯”原因：指令语义？自动交战覆盖 Move？频繁重算路径/重选目标？
结论：存在多源写 waypoint/行为的竞争，且没有显式 `AttackMove` 指令语义分层。

- 指令系统现状
  - 显式指令只有 `commandMove`, `commandBehavior`, `commandSkill`。
  - 无独立 `AttackMove` / `Charge` 指令对象。
  - 骑兵“冲锋”是 `commandSkill -> squad.skillRush`（`frontend/src/game/battle/crowd/CrowdSim.js:986`）。

- 可能覆盖链
  - 手操 attacker（`behavior === idle/move`）才跳过 `updateSquadBehaviorPlan`；否则会被自动行为改写（`frontend/src/game/battle/crowd/CrowdSim.js:1073`）。
  - `engagement` 在阻塞时会注入 detour waypoint（`frontend/src/game/battle/crowd/engagement.js:503`）。
  - `crowdCombat` 在 `idleCanRetaliate` 条件下仍可进攻（`frontend/src/game/battle/crowd/crowdCombat.js:452`）。
  - `BattleRuntime.step` 每步还会重写 waypoint 到 team-zone（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:1010`）。

- 当前行为判断
  - 出现“左右拉扯”时，常见是：手动 waypoint、engagement detour、自动进攻与边界 clamp 共同作用。

### F. 中线 x=0 卡死：路径跨不过去？边界判定？网格错位？
结论：**最主要不是 path/nav 问题，而是显式边界策略**。

- 直接证据
  - `clampXToTeamZone`：attacker 最大 x 被限制到 `-TEAM_ZONE_GUTTER - radius`，defender 最小 x 被限制到 `+TEAM_ZONE_GUTTER + radius`（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:223`）。
  - `commandMove` 目标点先被同样 clamp（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:944`）。
  - `step` 每步对 squad/agent/waypoint/rally/goal 再次 clamp（`frontend/src/game/battle_v2/runtime/BattleRuntime.js:1003`）。

- 路径系统现状
  - 战斗核心没有 navmesh/astar/flow-field 路径求解；是局部 steering + separation + 矩形障碍推出。
  - `path/nav/grid` 关键词命中主要来自渲染网格、UI 或非战斗域；战斗移动核心未见全局寻路器。

### Repro Steps（可复现步骤）

#### 复现 leader 抖动 & 相机抖动
1. 进入 `军事 -> 训练场`。
2. 点击一键布置，选“随机配置”，例如双方各 `20` 支、各 `5万` 人（高密度更明显）。
3. 点击 `开始训练`，打开调试面板（右上“调试”）。
4. 选中我方一支靠近中线或障碍的部队，连续下达贴近中线/障碍边缘的移动指令。
5. 观察：
   - 旗手（编队锚点）附近出现微抖动；
   - 相机中心跟随点（调试面板“跟随目标/实际焦点”）会出现高频小幅变化；
   - FPS 稳定时仍可见位置颤动。

#### 复现中线 x=0 卡死
1. 进入训练场，布置我方与敌方各至少 1 支，开始训练。
2. 选中我方部队，点击中线右侧（`x > 0`）目标点，或在小地图右半侧下达移动。
3. 预期：部队跨过中线推进到敌方区域。
4. 实际：部队在中线左侧约 `x ~= -(10 + radius)` 附近停止/贴边移动，无法跨线。

## 5. Midline x=0 Root Cause Candidates（候选 + 代码位置 + 验证方法）

> 下面按“最可能 -> 次可能”排序。

### 候选1（最高概率）：team-zone 硬边界直接禁止越线
- 代码位置
  - `frontend/src/game/battle_v2/runtime/BattleRuntime.js:223` `clampXToTeamZone`
  - `frontend/src/game/battle_v2/runtime/BattleRuntime.js:1003` `step` 内硬边界循环
- 当前行为判断
  - attacker 永远被限制在 `x <= -10-radius`，defender 永远 `x >= +10+radius`。
- 验证方法
  - 打印每步 `beforeClampX/afterClampX/team/radius`。
  - 叠加 debug 竖线：`x = attackerMax`, `x = defenderMin`。
  - 将目标点设在 `x=0` 和 `x=+50`，观察 `afterClampX` 恒回到左侧。

### 候选2：命令阶段就把 waypoint 截断，导致“看起来在执行命令，实际目标已改写”
- 代码位置
  - `frontend/src/game/battle_v2/runtime/BattleRuntime.js:944` `commandMove`
- 当前行为判断
  - 玩家点击敌方半场时，waypoint 入队前就被 clamp 到本方半场边缘。
- 验证方法
  - 在 `commandMove` 打印 `input worldPoint` 与 `safe waypoint`。
  - 画 waypoint marker（原始点击点 vs 实际入队点）对比。

### 候选3：AI/engagement 生成跨界或临界 waypoint，随后被每步硬截断，形成边界拉扯
- 代码位置
  - `frontend/src/game/battle/crowd/CrowdSim.js:540` `updateSquadBehaviorPlan`
  - `frontend/src/game/battle/crowd/engagement.js:503` detour waypoint 注入
  - `frontend/src/game/battle_v2/runtime/BattleRuntime.js:1010` step 中 waypoint clamp
- 当前行为判断
  - waypoint 被不同模块写入，再被边界模块重写，出现“走-拉回-再走”的临界抖动。
- 验证方法
  - 每步记录 waypoint 写入来源（manual/behavior/engagement）和最终 clamp 后值。
  - 给 waypoint 颜色编码：蓝=原始，黄=AI，红=clamp后。

### 候选4：半径参与边界计算，导致“大编队越靠近中线越早被挡”，误感为 x=0 卡死
- 代码位置
  - `frontend/src/game/battle_v2/runtime/BattleRuntime.js:228` / `229`（`-TEAM_ZONE_GUTTER - r`, `+TEAM_ZONE_GUTTER + r`）
  - `frontend/src/game/battle/crowd/CrowdSim.js:803`（`squad.radius` 由阵型扩展计算）
- 当前行为判断
  - 半径越大，可达最大 x 越靠左（attacker），肉眼像“离中线还有一段就卡住”。
- 验证方法
  - 打印 `squad.radius` 与 `allowedMaxX`。
  - 以不同规模编队对比可达最前沿 x。

### 候选5：旗手锚点与 squad 双向回写 + 边界修正叠加，造成边界附近 jitter
- 代码位置
  - `frontend/src/game/battle/crowd/CrowdSim.js:751`（leader 写 squad）
  - `frontend/src/game/battle/crowd/CrowdSim.js:801`（aggregate 用旗手回写 squad）
  - `frontend/src/game/battle_v2/runtime/BattleRuntime.js:1007`（step 再 clamp squad）
- 当前行为判断
  - 多写入源在边界附近互相纠偏，易出现微抖。
- 验证方法
  - 同帧打印：`leaderMove result`, `aggregate anchor`, `post-step clamp` 三阶段坐标。
  - 临时冻结 `aggregateSquadFromAgents` 回写（仅实验分支）比较抖动差异。

### 候选6：相机跟随源（位置用 squad，速度用旗手）在边界时不一致放大视觉抖动
- 代码位置
  - `frontend/src/components/game/BattleSceneModal.js:684`（`x/y` from squad, `vx/vy` from raw anchor）
  - `frontend/src/game/battle_v2/render/CameraController.js:293`（look-ahead）
- 当前行为判断
  - 位置与速度采样源不完全一致，边界纠偏时会被 look-ahead 放大。
- 验证方法
  - A/B 测：跟随源统一改成“全 squad”或“全 flag”（实验分支）比较 jitter。
  - 调试面板输出 `followTarget` 与 `focusActual` 的差值曲线。

### 候选7（低概率）：仅视觉“中线/中心带”被误判为碰撞体
- 代码位置
  - `frontend/src/game/battle_v2/render/GroundRenderer.js:30-33`（左右/中区 mask）
- 当前行为判断
  - Ground shader 只画色带，不参与碰撞/导航；不是主因，但容易误导排查。
- 验证方法
  - 隐藏地面 divider 渲染，确认卡死仍在。
  - 同时显示真实碰撞体/边界线，避免视觉误判。

## 6. Gaps & Risks
- 多源写位置（leader、agent、aggregate、runtime clamp）导致状态竞争，边界附近放大抖动风险。
- 指令语义层过薄：`Move/Behavior/Skill` 混在一个层级，缺少 `AttackMove/Charge` 的独立优先级与抢占规则。
- 缺少全局路径规划（navmesh/grid/astar），复杂障碍布局下易出现局部最优与拉扯。
- 运动学模型偏“速度直接积分”，缺少 turn-rate/acceleration/arrival，观感僵硬。
- `team-zone` 与 AI 追击目标并存，天然引发“想往前追但每步被拉回”。
- 相机跟随无死区/预测稳定器，仅线性 lerp，目标抖动会直接传导到画面。
- 调试可观测性还不够：缺少 boundary-reason、waypoint-source、clamp-before/after 的可视化。

## 7. Suggested Refactor Plan (High-Level)
1. 指令层重构：定义 `Move / AttackMove / Charge / Retreat / Hold` 明确语义、优先级和可中断规则。
2. 运动学层重构：引入 `maxTurnRate + acceleration + deceleration + arrivalRadius`，替换瞬时朝向。
3. 编队-个体耦合重构：统一“锚点单写入源”，去掉双向回写抖动；队形变化通过约束求解而非覆盖写。
4. 边界策略解耦：将“不可越线”做成模式策略（训练场可跨线，围城可限制），不要硬编码进每步核心循环。
5. 局部避障与全局路径分层：全局路径（走廊）+ 局部避障（separation/push），避免绕行与边界冲突。
6. 相机系统重构：跟随目标改为“稳定质心/锚点滤波器”，增加死区和二阶阻尼；统一位置/速度数据源。
7. 更新循环优化：simulation 与 render 间加入插值快照（alpha interpolation），减少 fixed-step 与 RAF 相位抖动。
8. 可观测性建设：标准 debug overlay + 结构化日志 + 复现场景脚本（中线、障碍密集、混编大规模）。

## 8. Appendix: Grep Results（全仓库）

说明：以下检索在仓库根目录执行，排除 `.git` 与 `node_modules`。每组给出命中文件列表与代表性命中片段（每段 <= 20 行）。

---

### G1: `camera|follow|lerp|smooth|spring|pivot|target`

**命中文件列表**
```text
docs/PVE_MELEE_COMBAT_CONTEXT.md
docs/MELEE_ENGAGEMENT_IMPLEMENTATION.md
docs/pve_deploy_camera_rotate_audit.md
docs/PVE_BATTLE_SYSTEM_AUDIT.md
docs/PVE_UNIT_SKILLS_CONTEXT.md
docs/WORLD_MAP_BLANK_SCREEN_DEBUG.md
SCALABILITY_REFACTOR_PROGRESS.md
start.sh
BATTLEFIELD_PREVIEW_EDITOR_AUDIT.md
backend/routes/senses.js
backend/routes/auth.js
backend/routes/nodes.js
backend/routes/alliance.js
backend/scripts/seed_realistic_behavior.js
DEV_NOTE.md
backend/scripts/migrateAllDataAndVerify.js
backend/scripts/seed_scalability_dataset.js
ARCHITECTURE_REBUILD_PLAN.md
backend/package.json
frontend/src/WebGLNodeRenderer.js
frontend/src/components/common/NumberPadDialog.js
frontend/src/components/auth/Login.js
backend/worker.js
frontend/src/components/modals/AllianceDetailModal.js
frontend/src/components/modals/MiniPreviewRenderer.js
frontend/src/App.js
frontend/src/components/modals/NodeInfoModal.js
frontend/src/LayoutManager.js
frontend/src/components/modals/CreateNodeModal.css
frontend/src/components/modals/CreateNodeAssociationManager.js
frontend/src/components/game/ArmyPanel.js
frontend/src/LocationSelectionModal.js
frontend/src/components/modals/CreateNodeModal.js
frontend/src/components/game/Home.js
frontend/src/components/game/ProfilePanel.js
backend/services/KnowledgeDistributionService.js
frontend/src/SceneManager.js
frontend/src/components/modals/CreateAllianceModal.js
frontend/src/App.css
frontend/src/components/game/BattleSceneModal.js
frontend/src/index.css
backend/services/domainTitleProjectionStore.js
frontend/src/components/game/Home.css
frontend/package-lock.json
backend/services/domainTitleStateStore.js
backend/services/domainGraphTraversalService.js
backend/reset-node.js
frontend/src/components/game/BattlefieldPreviewModal.js
frontend/src/components/game/KnowledgeDomainScene.js
frontend/src/components/game/battleMath.js
frontend/src/game/formation/ArmyFormationRenderer.js
frontend/src/components/shared/AssociationAddFlowEditor.js
backend/models/DomainTitleRelation.js
backend/models/Node.js
frontend/src/game/battle_v2/render/ProjectileRenderer.js
frontend/src/game/battle/crowd/engagement.js
backend/models/User.js
frontend/src/game/battle_v2/render/GroundRenderer.js
frontend/src/game/battle/crowd/CrowdSim.js
frontend/src/game/battle_v2/render/BuildingRenderer.js
frontend/src/game/battle/effects/CombatEffects.js
frontend/src/game/battle/crowd/crowdPhysics.js
frontend/src/game/battle/crowd/crowdCombat.js
frontend/src/components/admin/AdminPanel.js
frontend/src/components/admin/Admin.css
frontend/src/game/battle_v2/render/CameraController.js
frontend/build/static/css/main.92d365ea.css.map
frontend/src/game/battle_v2/render/ImpostorRenderer.js
frontend/src/game/battle_v2/render/EffectRenderer.js
frontend/src/game/battle_v2/ui/Minimap.js
frontend/src/game/battle_v2/ui/BattleDebugPanel.js
frontend/src/game/battle_v2/runtime/BattleRuntime.js
frontend/build/static/css/main.92d365ea.css
frontend/build/static/js/main.d1702a69.js
frontend/build/static/js/main.d1702a69.js.map
```

**命中片段 1**（`frontend/src/game/battle_v2/render/CameraController.js`）
```js
279  update(dtSec, anchor = null) {
280    const dt = Math.max(0, Number(dtSec) || 0);
289    if (anchor && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
293      const lookAhead = Math.min(this.lookAheadMax, speed * this.lookAheadScale);
296      const targetX = (Number(anchor.x) || 0) + (dirX * lookAhead);
297      const targetY = (Number(anchor.y) || 0) + (dirY * lookAhead);
298      const followLerp = clamp(dt * 6.8, 0, 1);
299      this.centerX += (targetX - this.centerX) * followLerp;
300      this.centerY += (targetY - this.centerY) * followLerp;
301    }
302  }
```

**命中片段 2**（`frontend/src/components/game/BattleSceneModal.js`）
```js
679  const rawFocusAnchor = runtime.getFocusAnchor();
684  const followAnchor = nowPhase === 'battle'
685    ? {
686        x: Number(followSquad?.x ?? rawFollowAnchor?.x) || 0,
687        y: Number(followSquad?.y ?? rawFollowAnchor?.y) || 0,
688        vx: Number(rawFollowAnchor?.vx) || 0,
689        vy: Number(rawFollowAnchor?.vy) || 0,
690        squadId: followTargetSquadId
691      }
692    : null;
693  cameraRef.current.update(deltaSec, followAnchor);
```

---

### G2: `leader|flag|banner|standard|anchor|formation`

**命中文件列表**
```text
docs/PVE_MELEE_COMBAT_CONTEXT.md
docs/MELEE_ENGAGEMENT_IMPLEMENTATION.md
docs/WORLD_MAP_BLANK_SCREEN_DEBUG.md
docs/PVE_BATTLE_SYSTEM_AUDIT.md
backend/scripts/seed_realistic_behavior.js
backend/routes/auth.js
BATTLEFIELD_PREVIEW_EDITOR_AUDIT.md
backend/routes/alliance.js
backend/DATABASE_TOOLS.md
backend/scripts/seed_scalability_dataset.js
frontend/src/LayoutManager.js
frontend/build/static/css/main.92d365ea.css.map
frontend/src/components/modals/NodeInfoModal.css
frontend/package-lock.json
frontend/src/components/modals/CreateAllianceModal.js
frontend/build/static/css/main.92d365ea.css
frontend/src/components/modals/AllianceDetailModal.js
backend/services/notificationStore.js
backend/package-lock.json
frontend/src/components/modals/NodeInfoModal.js
frontend/src/components/modals/CreateNodeModal.js
frontend/src/components/game/AlliancePanel.js
frontend/src/components/game/pveBattle.css
frontend/src/components/modals/CreateAllianceModal.css
frontend/src/components/modals/AllianceDetailModal.css
frontend/src/App.js
backend/routes/nodes.js
frontend/build/static/js/main.d1702a69.js
frontend/src/components/game/BattlefieldPreviewModal.js
frontend/src/components/game/BattleSceneModal.js
frontend/src/App.css
backend/models/EntropyAlliance.js
frontend/src/WebGLNodeRenderer.js
frontend/src/game/battle_v2/runtime/BattleRuntime.js
frontend/src/game/battle_v2/runtime/FlagBearer.js
frontend/src/components/admin/Admin.css
frontend/src/components/admin/AdminPanel.js
frontend/src/game/battle_v2/ui/Minimap.js
frontend/src/game/battle_v2/ui/SquadCards.js
frontend/src/game/battle_v2/render/CameraController.js
frontend/src/utils/allianceVisualStyle.js
frontend/src/game/battle_v2/render/ImpostorRenderer.js
frontend/src/game/formation/ArmyFormationRenderer.js
frontend/src/game/battle/crowd/engagement.js
frontend/src/game/battle/crowd/CrowdSim.js
frontend/src/game/battle/crowd/crowdCombat.js
frontend/build/static/js/main.d1702a69.js.map
```

**命中片段 1**（`frontend/src/game/battle/crowd/CrowdSim.js`）
```js
597 const ensureFlagBearer = (squad, agents = []) => {
603   let flagBearer = alive.find((agent) => agent.id === squad?.flagBearerAgentId) || null;
610   alive.forEach((agent) => {
611     agent.isFlagBearer = !!flagBearer && agent.id === flagBearer.id;
612   });
613   if (squad) squad.flagBearerAgentId = flagBearer?.id || '';
614   return flagBearer;
615 };
```

**命中片段 2**（`frontend/src/game/battle_v2/runtime/FlagBearer.js`）
```js
18 export const resolveSquadAnchor = (sim, crowd, squadId) => {
19   const squad = (sim?.squads || []).find((row) => row.id === squadId) || null;
21   const flag = resolveFlagBearerAgent(crowd, squad);
22   if (flag) {
23     return {
24       x: Number(flag.x) || 0,
25       y: Number(flag.y) || 0,
26       vx: Number(flag.vx) || 0,
27       vy: Number(flag.vy) || 0,
28       squadId: squad.id,
29       team: squad.team
30     };
31   }
```

---

### G3: `collision|collider|overlap|separate|push|resolve|penetration`

**命中文件列表**
```text
BATTLEFIELD_PREVIEW_EDITOR_AUDIT.md
docs/PVE_MELEE_COMBAT_CONTEXT.md
docs/MELEE_ENGAGEMENT_IMPLEMENTATION.md
docs/PVE_BATTLE_SYSTEM_AUDIT.md
docs/PVE_UNIT_SKILLS_CONTEXT.md
backend/server.js
backend/services/domainAdminResignService.js
backend/routes/senses.js
backend/services/allianceBroadcastService.js
backend/services/KnowledgeDistributionService.js
backend/routes/auth.js
backend/services/GameService.js
backend/services/siegeParticipantStore.js
backend/routes/admin.js
backend/services/schedulerService.js
backend/routes/nodes.js
backend/worker.js
backend/routes/alliance.js
backend/services/nodeSenseStore.js
backend/package-lock.json
backend/services/domainTitleProjectionStore.js
backend/services/domainTitleStateStore.js
frontend/src/LayoutManager.js
backend/services/domainGraphTraversalService.js
frontend/public/index.html
frontend/src/SceneManager.js
frontend/src/LocationSelectionModal.js
frontend/src/index.js
backend/models/Node.js
backend/scripts/migrateDomainTitleStatesToCollection.js
backend/scripts/seed_realistic_behavior.js
backend/scripts/initCatalogAndUnitData.js
backend/scripts/clearBattlefieldObjects.js
backend/scripts/seed_scalability_dataset.js
backend/scripts/migrateAllDataAndVerify.js
backend/scripts/migrateNodeSensesToCollection.js
frontend/src/App.js
backend/models/EntropyAlliance.js
backend/scripts/migrateDistributionParticipants.js
frontend/package-lock.json
frontend/src/runtimeConfig.js
frontend/src/WebGLNodeRenderer.js
frontend/src/components/admin/AdminPanel.js
frontend/src/game/battle_v2/runtime/BattleRuntime.js
frontend/src/components/game/BattlefieldPreviewModal.js
frontend/src/game/battle/effects/CombatEffects.js
frontend/src/components/game/KnowledgeDomainScene.js
frontend/src/game/formation/ArmyFormationRenderer.js
frontend/src/game/battle_v2/runtime/FlagBearer.js
frontend/src/components/shared/associationFlowShared.js
frontend/src/components/modals/NavigationTreeModal.js
frontend/src/game/battle/crowd/engagement.js
frontend/src/game/battle_v2/ui/BattleDebugPanel.js
frontend/src/components/game/BattleSceneModal.js
frontend/src/game/battle/crowd/crowdPhysics.js
frontend/src/game/battle/crowd/CrowdSim.js
frontend/src/game/battle/crowd/crowdCombat.js
frontend/src/components/modals/MiniPreviewRenderer.js
frontend/src/components/modals/CreateNodeModal.js
frontend/build/static/js/main.d1702a69.js
frontend/build/static/js/main.d1702a69.js.map
```

**命中片段 1**（`frontend/src/game/battle/crowd/crowdPhysics.js`）
```js
33 export const pushOutOfRect = (point, rect, inflate = 0) => {
41   const hw = (Math.max(1, Number(rect?.width) || 1) / 2) + inflate;
42   const hh = (Math.max(1, Number(rect?.depth) || 1) / 2) + inflate;
43   if (Math.abs(local.x) > hw || Math.abs(local.y) > hh) return { x: cx, y: cy, pushed: false };
45   const dx = hw - Math.abs(local.x);
46   const dy = hh - Math.abs(local.y);
47   if (dx < dy) {
48     local.x += local.x >= 0 ? dx : -dx;
49   } else {
50     local.y += local.y >= 0 ? dy : -dy;
51   }
56   pushed: true
57 };
```

**命中片段 2**（`frontend/src/game/battle/crowd/CrowdSim.js`）
```js
1166 const neighbors = querySpatialNearby(spatial, agent.x, agent.y, 12);
1167 const sep = computeTeamAwareSeparation(agent, neighbors, spacing * 0.94);
1171 let vx = (toDesired.x * speed) + (sep.x * 40 * sepScale);
1172 let vy = (toDesired.y * speed) + (sep.y * 40 * sepScale);
1204 walls.forEach((wall) => {
1205   const pushed = pushOutOfRect({ x: nx, y: ny }, wall, (agent.radius || AGENT_RADIUS) + 0.5);
1206   nx = pushed.x;
1207   ny = pushed.y;
1208 });
```

---

### G4: `steer|arrive|seek|separation|cohesion|alignment|avoid`

**命中文件列表**
```text
docs/PVE_MELEE_COMBAT_CONTEXT.md
docs/MELEE_ENGAGEMENT_IMPLEMENTATION.md
backend/routes/nodes.js
backend/routes/auth.js
backend/scripts/migrateAllDataAndVerify.js
backend/scripts/syncUserIntelSnapshots.js
backend/scripts/seed_scalability_dataset.js
backend/services/KnowledgeDistributionService.js
backend/services/siegeParticipantStore.js
backend/services/domainTitleStateStore.js
backend/models/User.js
frontend/src/App.js
backend/models/Node.js
backend/models/SiegeParticipant.js
backend/models/DomainSiegeState.js
frontend/src/components/game/BattlefieldPreviewModal.js
frontend/src/game/battle/crowd/engagement.js
frontend/src/game/battle/crowd/crowdPhysics.js
frontend/src/game/battle/crowd/CrowdSim.js
frontend/build/static/js/main.d1702a69.js
frontend/build/static/js/main.d1702a69.js.map
```

**命中片段 1**（`frontend/src/game/battle/crowd/CrowdSim.js`）
```js
193 const computeTeamAwareSeparation = (agent, neighbors = [], sameTeamGap = 5.2) => {
204   let targetGap = sameTeam ? sameTeamGap : CROWD_ENEMY_TARGET_GAP;
205   let strength = sameTeam ? CROWD_SAME_TEAM_SEP_STRENGTH : CROWD_ENEMY_SEP_STRENGTH;
214   const push = ((targetGap - dist) / targetGap) * strength;
215   sx += (dx / dist) * push;
216   sy += (dy / dist) * push;
218   return { x: sx, y: sy };
219 };
```

**命中片段 2**（`frontend/src/game/battle/crowd/CrowdSim.js`）
```js
1173 if (hasAnchor) {
1174   const anchorDir = normalizeVec((Number(agent.engageAx) || 0) - (agent.x || 0), (Number(agent.engageAy) || 0) - (agent.y || 0));
1175   const steerGain = clamp(Number(engagementCfg?.anchorSteerGain) || 0.72, 0.08, 1.8);
1176   const steerCap = speed * clamp(Number(engagementCfg?.anchorSteerCapMul) || 0.58, 0.1, 1.4);
1184   vx += steerVx;
1185   vy += steerVy;
1191 }
```

---

### G5: `path|nav|navmesh|grid|walkable|astar|flow field`

**命中文件列表**
```text
docs/PVE_MELEE_COMBAT_CONTEXT.md
docs/MELEE_ENGAGEMENT_IMPLEMENTATION.md
SCALABILITY_REFACTOR_PROGRESS.md
start.sh
docs/PVE_UNIT_SKILLS_CONTEXT.md
backend/routes/senses.js
backend/routes/auth.js
backend/services/KnowledgeDistributionService.js
backend/routes/nodes.js
backend/routes/alliance.js
backend/package-lock.json
backend/services/domainGraphTraversalService.js
backend/models/User.js
backend/scripts/syncUserIntelSnapshots.js
backend/scripts/initCatalogAndUnitData.js
backend/models/EntropyAlliance.js
backend/scripts/seed_realistic_behavior.js
backend/scripts/seed_scalability_dataset.js
frontend/src/LocationSelectionModal.js
frontend/src/App.js
frontend/src/WebGLNodeRenderer.js
backend/scripts/clearBattlefieldObjects.js
frontend/build/static/css/main.92d365ea.css.map
backend/scripts/migrateAllDataAndVerify.js
frontend/src/utils/allianceVisualStyle.js
frontend/build/static/css/main.92d365ea.css
frontend/src/game/formation/ArmyFormationRenderer.js
frontend/src/App.css
frontend/package-lock.json
frontend/src/components/common/NumberPadDialog.css
frontend/src/components/modals/CreateNodeAssociationManager.js
frontend/src/game/battle_v2/runtime/BattleRuntime.js
frontend/src/components/modals/AllianceDetailModal.js
frontend/src/components/common/NumberPadDialog.js
frontend/src/components/modals/MiniPreviewRenderer.js
frontend/src/game/battle_v2/render/GroundRenderer.js
frontend/src/components/modals/CreateAllianceModal.css
frontend/src/components/modals/CreateNodeModal.css
frontend/src/game/battle_v2/ui/Minimap.js
frontend/src/components/modals/CreateNodeModal.js
frontend/src/components/auth/Login.js
frontend/src/components/modals/NavigationTreeModal.js
frontend/src/game/battle_v2/ui/DeployActionButtons.js
frontend/src/components/modals/AllianceDetailModal.css
frontend/src/components/shared/AssociationAddFlowEditor.js
frontend/src/components/modals/AllianceStylePreview.css
frontend/src/components/modals/NavigationTreeModal.css
frontend/src/components/game/ArmyPanel.js
frontend/src/components/modals/CreateAllianceModal.js
frontend/src/components/game/Home.js
frontend/src/components/game/ProfilePanel.css
frontend/src/components/game/ProfilePanel.js
frontend/src/game/battle_v2/ui/AimOverlayCanvas.js
frontend/src/components/game/pveBattle.css
frontend/src/components/game/Home.css
frontend/src/components/game/NodeDetail.css
frontend/src/components/game/BattlefieldPreviewModal.css
frontend/src/components/game/NodeDetail.js
frontend/src/components/game/ArmyPanel.css
frontend/src/components/admin/Admin.css
frontend/src/components/game/AlliancePanel.js
frontend/src/components/game/KnowledgeDomainScene.css
frontend/src/components/game/KnowledgeDomainScene.js
frontend/src/components/game/BattleSceneModal.js
frontend/src/components/game/BattlefieldPreviewModal.js
frontend/src/components/admin/AdminPanel.js
frontend/build/static/js/main.d1702a69.js
frontend/build/static/js/main.d1702a69.js.map
```

**命中片段 1**（`frontend/src/game/battle/crowd/crowdPhysics.js`）
```js
191 export const estimateLocalFlowWidth = (origin, forward, obstacles = [], options = {}) => {
198   const probeSide = (sign = 1) => {
202     const blocked = obstacles.some((obs) => !obs?.destroyed && isInsideRotatedRect({ x: px, y: py }, obs, inflate));
204     return Math.max(step, d - step);
208   return maxProbe;
210 const left = probeSide(1);
211 const right = probeSide(-1);
212 return Math.max(step * 2, left + right);
213 };
```

**命中片段 2**（`frontend/src/game/battle/crowd/CrowdSim.js`）
```js
1126 const allowFlowCompact = leaderMoving || squad.behavior === 'auto' || squad.behavior === 'defend' || squad.behavior === 'retreat';
1128 if (allowFlowCompact) {
1129   const flowWidth = estimateLocalFlowWidth({ x: squad.x, y: squad.y }, forward, walls, {
1130     step: 3.2,
1131     maxProbe: 120,
1132     inflate: AGENT_RADIUS + 1
1133   });
1134   const flowCols = Math.max(1, Math.floor(flowWidth / ((AGENT_RADIUS * 2) + AGENT_GAP)));
1135   columns = Math.max(1, Math.min(baseCols, flowCols));
1136 }
```

---

### G6: `mid|center|boundary|territory|team|x>0|x<0|sign|Math.sign|floor|round|clamp`

**命中文件列表**
```text
BATTLEFIELD_PREVIEW_EDITOR_AUDIT.md
docs/PVE_MELEE_COMBAT_CONTEXT.md
docs/MELEE_ENGAGEMENT_IMPLEMENTATION.md
docs/pve_deploy_camera_rotate_audit.md
docs/PVE_BATTLE_SYSTEM_AUDIT.md
docs/PVE_UNIT_SKILLS_CONTEXT.md
DEV_NOTE.md
SCALABILITY_REFACTOR_PROGRESS.md
docs/WORLD_MAP_BLANK_SCREEN_DEBUG.md
frontend/src/LayoutManager.js
frontend/src/WebGLNodeRenderer.js
frontend/src/App.js
backend/routes/senses.js
backend/routes/army.js
frontend/src/components/common/NumberPadDialog.css
backend/routes/auth.js
frontend/src/components/common/NumberPadDialog.js
frontend/src/LocationSelectionModal.js
backend/routes/users.js
backend/routes/admin.js
backend/routes/nodes.js
backend/routes/alliance.js
frontend/src/SceneManager.js
backend/services/domainAdminResignService.js
frontend/src/App.css
frontend/src/components/auth/Login.css
backend/services/KnowledgeDistributionService.js
frontend/src/components/auth/Login.js
backend/services/placeableCatalogService.js
backend/services/siegeParticipantStore.js
backend/services/GameService.js
backend/services/domainTitleStateStore.js
backend/worker.js
backend/package-lock.json
backend/scripts/syncUserIntelSnapshots.js
backend/seed/bootstrap_catalog_data.json
backend/scripts/seed_scalability_dataset.js
backend/scripts/initCatalogAndUnitData.js
frontend/src/components/modals/NodeInfoModal.css
backend/server.js
frontend/src/game/battle_v2/render/ProjectileRenderer.js
backend/scripts/migrateAllDataAndVerify.js
frontend/src/components/modals/AllianceDetailModal.css
frontend/src/game/battle_v2/render/GroundRenderer.js
frontend/src/components/modals/CreateAllianceModal.js
frontend/src/components/modals/CreateNodeModal.css
frontend/src/components/modals/AssociationModal.css
frontend/src/components/modals/NavigationTreeModal.css
frontend/src/components/modals/CreateAllianceModal.css
frontend/src/components/modals/NavigationTreeModal.js
frontend/src/game/battle_v2/render/BuildingRenderer.js
frontend/src/components/modals/AllianceStylePreview.css
frontend/src/components/modals/NodeInfoModal.js
backend/models/User.js
frontend/src/components/modals/MiniPreviewRenderer.js
frontend/src/game/battle_v2/render/CameraController.js
frontend/package-lock.json
frontend/src/game/battle_v2/render/ImpostorRenderer.js
frontend/src/components/modals/AllianceDetailModal.js
frontend/src/game/battle_v2/render/WebGL2Context.js
frontend/src/game/battle/effects/CombatEffects.js
frontend/src/game/battle_v2/runtime/BattleRuntime.js
frontend/src/game/battle_v2/render/EffectRenderer.js
backend/models/BattlefieldItem.js
frontend/src/game/battle_v2/runtime/BattleSummary.js
frontend/src/game/battle/crowd/engagement.js
backend/models/Notification.js
frontend/src/components/game/ArmyPanel.js
frontend/src/game/battle/crowd/CrowdSim.js
frontend/src/game/battle_v2/runtime/RepMapping.js
backend/models/DomainDefenseLayout.js
frontend/src/game/battle/crowd/crowdCombat.js
frontend/src/game/battle_v2/runtime/FlagBearer.js
backend/models/Node.js
frontend/src/game/battle/crowd/crowdPhysics.js
frontend/src/components/game/TrainingGroundPanel.js
frontend/src/components/game/pveBattle.css
frontend/src/components/game/BattlefieldPreviewModal.js
frontend/src/components/game/KnowledgeDomainScene.css
frontend/src/components/game/NodeDetail.css
frontend/src/components/game/Home.css
frontend/src/game/formation/ArmyFormationRenderer.js
frontend/src/game/battle_v2/ui/Minimap.js
frontend/src/components/game/ProfilePanel.css
frontend/src/game/battle_v2/ui/BattleDebugPanel.js
frontend/src/components/admin/Admin.css
frontend/src/components/game/KnowledgeDomainScene.js
frontend/src/game/battle_v2/ui/BattleHUD.js
frontend/src/components/game/battleMath.js
frontend/src/components/game/ArmyPanel.css
frontend/src/game/battle_v2/ui/SquadCards.js
frontend/src/game/battle_v2/ui/AimOverlayCanvas.js
frontend/src/components/game/NodeDetail.js
frontend/src/components/admin/AdminPanel.js
frontend/src/components/game/BattlefieldPreviewModal.css
frontend/src/components/game/AlliancePanel.js
frontend/src/components/game/BattleSceneModal.js
frontend/src/components/game/Home.js
frontend/build/static/css/main.92d365ea.css
frontend/src/components/shared/AssociationAddFlowEditor.js
frontend/build/static/css/main.92d365ea.css.map
frontend/build/static/js/main.d1702a69.js
frontend/build/static/js/main.d1702a69.js.map
```

**命中片段 1**（`frontend/src/game/battle_v2/runtime/BattleRuntime.js`）
```js
223 const clampXToTeamZone = (x, fieldWidth, radius = 0, team = TEAM_ATTACKER) => {
228   const attackerMax = Math.min(maxX, -TEAM_ZONE_GUTTER - r);
229   const defenderMin = Math.max(minX, TEAM_ZONE_GUTTER + r);
230   if (team === TEAM_DEFENDER) {
231     return clamp(Number(x) || 0, defenderMin, maxX);
232   }
233   return clamp(Number(x) || 0, minX, attackerMax);
234 };
```

**命中片段 2**（`frontend/src/game/battle_v2/runtime/BattleRuntime.js`）
```js
1003 // Hard boundary: attacker stays on left (blue), defender stays on right (red).
1004 (this.sim.squads || []).forEach((squad) => {
1008   squad.x = clampXToTeamZone(safePoint.x, this.field.width, radius, squad.team);
1010   if (Array.isArray(squad.waypoints) && squad.waypoints.length > 0) {
1014     point.x = clampXToTeamZone(safeWp.x, this.field.width, radius, squad.team);
1018   if (squad.rallyPoint) {
1020     squad.rallyPoint.x = clampXToTeamZone(safeRally.x, this.field.width, radius, squad.team);
1024 (this.crowd?.allAgents || []).forEach((agent) => {
1028   agent.x = clampXToTeamZone(safePos.x, this.field.width, radius, agent.team);
```

---

### G7: `update|tick|fixed|delta|dt|requestAnimationFrame`

**命中文件列表**
```text
SCALABILITY_REFACTOR_PROGRESS.md
docs/PVE_MELEE_COMBAT_CONTEXT.md
docs/WORLD_MAP_BLANK_SCREEN_DEBUG.md
BATTLEFIELD_PREVIEW_EDITOR_AUDIT.md
docs/MELEE_ENGAGEMENT_IMPLEMENTATION.md
docs/PVE_BATTLE_SYSTEM_AUDIT.md
DEV_NOTE.md
ARCHITECTURE_REBUILD_PLAN.md
docs/PVE_UNIT_SKILLS_CONTEXT.md
frontend/public/index.html
frontend/build/index.html
backend/utils/cursorPagination.js
backend/server.js
backend/services/domainGraphTraversalService.js
backend/reset-node.js
backend/services/armyUnitTypeService.js
backend/services/domainAdminResignService.js
backend/seed/bootstrap_catalog_data.json
frontend/build/static/media/default_male_2.ae354331749c0b3391e352b37ba5a9ce.svg
frontend/build/static/media/default_male_1.2626f88439d250f743e7b0645cf2035f.svg
frontend/build/static/media/default_male_3.81fcdd0813eb0c01bc36c132b425a771.svg
frontend/build/static/media/default_female_3.f5713987b2893eef24244b58ef55810d.svg
frontend/build/static/media/default_female_1.97cb12d85d40d207bf45d890f28bdf12.svg
backend/services/allianceBroadcastService.js
backend/routes/senses.js
backend/services/nodeSenseStore.js
frontend/build/static/media/default_female_2.5fbf67cbf082762111ea1d7365f59ffb.svg
backend/services/KnowledgeDistributionService.js
backend/services/GameService.js
frontend/src/App.js
backend/services/placeableCatalogService.js
backend/services/schedulerService.js
backend/models/EntropyAlliance.js
backend/routes/army.js
backend/models/User.js
frontend/package-lock.json
backend/services/notificationStore.js
backend/services/domainTitleProjectionStore.js
backend/models/BattlefieldItem.js
backend/services/siegeParticipantStore.js
backend/models/DomainTitleProjection.js
frontend/src/assets/avatars/default_male_3.svg
backend/routes/auth.js
backend/services/maintenanceCleanupService.js
backend/services/domainTitleStateStore.js
backend/models/ScheduledTask.js
frontend/src/assets/avatars/default_male_1.svg
backend/routes/users.js
backend/models/DomainDefenseLayout.js
frontend/src/assets/avatars/default_female_2.svg
backend/models/DomainSiegeState.js
frontend/src/LayoutManager.js
backend/models/Node.js
frontend/src/assets/avatars/default_female_3.svg
backend/models/NodeSenseEditSuggestion.js
backend/models/DomainTitleRelation.js
backend/routes/admin.js
backend/models/SiegeParticipant.js
frontend/src/assets/avatars/default_female_1.svg
backend/models/NodeSense.js
frontend/src/assets/avatars/default_male_2.svg
frontend/src/SceneManager.js
backend/routes/nodes.js
frontend/src/game/battle_v2/ui/Minimap.js
frontend/src/game/formation/ArmyFormationRenderer.js
frontend/src/App.css
frontend/src/components/common/NumberPadDialog.css
frontend/src/game/battle_v2/runtime/BattleRuntime.js
frontend/build/static/css/main.92d365ea.css.map
backend/routes/alliance.js
frontend/src/WebGLNodeRenderer.js
frontend/src/game/battle_v2/ui/AimOverlayCanvas.js
frontend/src/game/battle_v2/render/ProjectileRenderer.js
frontend/src/game/battle_v2/runtime/BattleClock.js
frontend/src/game/battle_v2/ui/BattleDebugPanel.js
frontend/src/game/battle/crowd/engagement.js
frontend/src/game/battle/effects/CombatEffects.js
frontend/src/LocationSelectionModal.js
frontend/src/game/battle/crowd/CrowdSim.js
frontend/src/components/auth/Login.css
frontend/src/game/battle_v2/render/GroundRenderer.js
frontend/src/game/battle/crowd/crowdCombat.js
frontend/src/game/battle_v2/render/WebGL2Context.js
frontend/build/static/css/main.92d365ea.css
frontend/src/components/shared/AssociationAddFlowEditor.js
frontend/src/components/auth/Login.js
frontend/src/components/admin/Admin.css
frontend/src/game/battle_v2/render/BuildingRenderer.js
backend/scripts/migrateNotificationsToCollection.js
frontend/src/game/battle_v2/render/EffectRenderer.js
frontend/src/game/battle/crowd/crowdPhysics.js
backend/scripts/seed_realistic_behavior.js
frontend/src/components/game/battleMath.js
frontend/src/components/game/ProfilePanel.css
frontend/src/components/game/Home.css
frontend/src/game/battle_v2/render/ImpostorRenderer.js
backend/scripts/initUserLevels.js
backend/scripts/migrateDomainTitleStatesToCollection.js
frontend/src/components/game/BattlefieldPreviewModal.js
frontend/src/components/game/ArmyPanel.js
frontend/src/game/battle_v2/render/CameraController.js
backend/scripts/migrateDomainTitleProjection.js
backend/worker.js
frontend/src/components/modals/NodeInfoModal.css
frontend/src/components/game/pveBattle.css
frontend/src/components/admin/AdminPanel.js
backend/DATABASE_TOOLS.md
backend/scripts/migrateNodeSensesToCollection.js
frontend/src/components/game/NodeDetail.css
frontend/src/components/game/ProfilePanel.js
backend/reset-user.js
frontend/src/components/game/ArmyPanel.css
backend/package-lock.json
frontend/src/components/game/Home.js
backend/scripts/clearBattlefieldObjects.js
frontend/src/components/game/KnowledgeDomainScene.css
frontend/src/components/game/BattleSceneModal.js
frontend/src/components/game/NodeDetail.js
frontend/src/components/game/BattlefieldPreviewModal.css
backend/scripts/syncUserIntelSnapshots.js
frontend/src/components/modals/AssociationModal.css
backend/scripts/initCatalogAndUnitData.js
backend/scripts/seed_scalability_dataset.js
frontend/src/components/modals/AllianceStylePreview.css
frontend/src/components/modals/CreateNodeModal.css
backend/scripts/initUserDomainPreferences.js
backend/config/database.js
frontend/src/components/modals/AllianceDetailModal.js
backend/scripts/migrateDistributionParticipants.js
frontend/build/static/js/main.d1702a69.js
frontend/src/components/modals/NavigationTreeModal.js
frontend/src/components/modals/CreateNodeAssociationManager.js
frontend/src/components/modals/CreateAllianceModal.css
frontend/src/components/modals/AllianceDetailModal.css
frontend/src/components/modals/NavigationTreeModal.css
frontend/src/components/modals/MiniPreviewRenderer.js
frontend/src/components/game/KnowledgeDomainScene.js
backend/scripts/migrateAllDataAndVerify.js
frontend/src/components/modals/CreateNodeModal.js
frontend/build/static/js/main.d1702a69.js.map
```

**命中片段 1**（`frontend/src/game/battle_v2/runtime/BattleClock.js`）
```js
21  tick(deltaSec, stepFn) {
22    const dt = Math.max(0, Math.min(this.maxFrame, Number(deltaSec) || 0));
25    this.accumulator = Math.min(this.maxCatchUp, this.accumulator + dt);
27    while (this.accumulator >= this.fixedStep) {
28      stepFn(this.fixedStep);
29      this.accumulator -= this.fixedStep;
30      steps += 1;
31      if (steps > 24) {
32        this.accumulator = 0;
33        break;
34      }
35    }
36    return steps;
37  }
```

**命中片段 2**（`frontend/src/components/game/BattleSceneModal.js`）
```js
637 const frame = (ts) => {
640   const deltaSec = clamp((ts - last) / 1000, 0, 0.05);
663   clockRef.current.tick(deltaSec, (fixedStep) => runtime.step(fixedStep));
693   cameraRef.current.update(deltaSec, followAnchor);
717   const renderStart = performance.now();
734   runtime.setRenderMs(performance.now() - renderStart);
817   rafRef.current = requestAnimationFrame(frame);
820 rafRef.current = requestAnimationFrame(frame);
```
