# Battle Interaction Implementation Notes

## 1) `battleUiMode` 状态机

在 `frontend/src/components/game/BattleSceneModal.js` 新增：

- `NONE`: 普通战斗交互态（LMB 只选中/取消，RMB 移动）
- `PATH_PLANNING`: 路径规划态（暂停）
- `MARCH_PICK`: 行进模式选择态（暂停）
- `GUARD`: 自由攻击命令触发瞬态（随后回到 `NONE`）
- `SKILL_PICK`: 技能栏展开态（不暂停）
- `SKILL_CONFIRM`: 技能确认态（暂停，LMB 确认，RMB 取消）

配套状态字段：

- `worldActionsVisibleForSquadId`
- `hoverSquadIdOnCard`
- `pendingPathPoints`
- `planningHoverPoint`
- `skillConfirmState`
- `marchModePickOpen`

输入分流（battle phase）：

- `LMB`
  - `SKILL_CONFIRM`：确认技能
  - `PATH_PLANNING`：追加 waypoint
  - 其他：只做选中/取消世界按钮，不下发移动命令
- `RMB`
  - `SKILL_CONFIRM`：取消技能确认
  - `PATH_PLANNING`：撤销最后 waypoint；为空时退出规划态
  - 其他：唯一移动命令入口（`commandMove`）

## 2) 六按钮 `actionId -> runtime` 映射

`frontend/src/game/battle/presentation/ui/BattleActionButtons.js`

- `planPath`
  - `BattleSceneModal`: 进入 `PATH_PLANNING`，暂停，编辑 `pendingPathPoints`
  - 完成时：`runtime.commandSetWaypoints(selectedSquadId, pendingPathPoints)`
- `marchMode`
  - `BattleSceneModal`: 进入 `MARCH_PICK`，暂停
  - 选择后：`runtime.commandMarchMode(selectedSquadId, 'cohesive'|'loose')`
- `freeAttack`
  - `runtime.commandGuard(squadId, {centerX, centerY, radius})`
- `skills`
  - `BattleSceneModal`: 进入 `SKILL_PICK`，展示 `BattleSkillBar`
- `standby`
  - `runtime.commandBehavior(squadId, 'standby')`
- `retreat`
  - `runtime.commandBehavior(squadId, 'retreat')`

卡片 hover 叠加按钮在 `SquadCards.js`，点击按钮先自动选中并相机跟随，再执行 action。

## 3) 技能确认态结构与取消规则

`skillConfirmState` 结构（`BattleSceneModal.js`）：

```js
{
  squadId: string,
  kind: 'infantry' | 'cavalry' | 'archer' | 'artillery',
  center: { x, y },
  dir: { x, y },
  len: number,
  aoeRadius: number,
  hoverPoint: { x, y } | null
}
```

确认与取消：

- `LMB`（`SKILL_CONFIRM`）
  - 步兵：直接 `runtime.commandSkill(..., {kind:'infantry'})`
  - 骑兵：按 `dir/len` 生成冲锋目标点后 `commandSkill`
  - 弓/炮：按 `hoverPoint` 落点 `commandSkill`
- `RMB`（`SKILL_CONFIRM`）
  - 统一取消：不释放技能，退出确认态并恢复时钟

Overlay 可视化在 `AimOverlayCanvas.js`：

- 骑兵：地面箭头（方向/长度可调）
- 弓/炮：虚抛物线簇 + AOE 圈
- 技能生效后：从 `selectedSquad.activeSkill.targetSpec` 继续绘制技能区域

## 4) 性能注意事项与关键优化

本次改造遵循“只渲染少量交互元素、避免新增 per-agent UI/状态”的原则：

- 交互 UI
  - 世界按钮仅针对当前选中部队绘制（DOM 锚点）
  - 卡片按钮只在 hover/选中时显示
- Overlay
  - 路径、marker、警戒圈、技能确认图形统一走 `AimOverlayCanvas`（2D canvas）
  - 不新增 per-agent DOM
- 仿真/战斗
  - guard 目标评分重算节流到 `0.15s` (`GUARD_REEVAL_SEC`)
  - 新增目标评分写入 `squad.debugTargetScore`，仅用于 debug 展示
  - 远程移动射击惩罚为常数级计算：`speedRatio -> hitChance/spread`，不引入重排序
- 渲染
  - `ImpostorRenderer` / `ProjectileRenderer` / `EffectRenderer` 增加 `sampler2DArray` 可插拔采样
  - 新增 `ProceduralTextures.js` 启动时一次性生成 procedural texture array
  - 特效继续走实例化数据流（snapshot + instancing）

## 5) 相关文件清单

- `frontend/src/components/game/BattleSceneModal.js`
- `frontend/src/game/battle/presentation/ui/BattleActionButtons.js`
- `frontend/src/game/battle/presentation/ui/BattleSkillBar.js`
- `frontend/src/game/battle/presentation/ui/SquadCards.js`
- `frontend/src/game/battle/presentation/ui/AimOverlayCanvas.js`
- `frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
- `frontend/src/game/battle/presentation/render/CameraController.js`
- `frontend/src/game/battle/simulation/crowd/CrowdSim.js`
- `frontend/src/game/battle/simulation/crowd/crowdCombat.js`
- `frontend/src/game/battle/presentation/render/ImpostorRenderer.js`
- `frontend/src/game/battle/presentation/render/ProjectileRenderer.js`
- `frontend/src/game/battle/presentation/render/EffectRenderer.js`
- `frontend/src/game/battle/presentation/assets/ProceduralTextures.js`
