# Battle Refactor Phase-3 Checklist

## 目标

验证 render snapshot 打包逻辑已经集中到 `snapshot/` 目录；并确认新 schema / pool / builder 不改变战斗表现与渲染顺序。

## 手工验收步骤

1. 进入战斗可运行（deploy / 开战 / 结束）
   - 从正常入口打开 PVE 战斗。
   - deploy 阶段正常显示、可开战。
   - 开战后能正常推进到结束并出结果面板。

2. 单位 / 建筑 / 投射物 / 特效均正常显示
   - deploy 阶段确认单位与建筑可见。
   - battle 阶段确认投射物、命中特效、建筑显示正常。
   - 不应出现实例错位、颜色错位、yaw 方向错乱。

3. 观察控制台：正常情况下不应每帧扩容
   - 首次进入大型战斗时，`BattleSnapshotPool` 允许打印一次扩容日志。
   - 稳定运行后不应持续出现 `grow units/buildings/projectiles/effects` 日志。

4. 性能回归
   - 对常规战斗场景确认无明显帧率回退。
   - 如有大型场景（例如 2 万单位），重构后不应因 snapshot 层增加额外 draw call 或明显掉帧。

5. Stride 协议检查
   - 开发环境下，renderer 初始化时应运行一次 schema/renderer stride 一致性检查。
   - 不应出现 `stride mismatch` 错误。

6. 结构检查
   - 运行：
     - `rg -n "UNIT_INSTANCE_STRIDE|BUILDING_INSTANCE_STRIDE|PROJECTILE_INSTANCE_STRIDE|EFFECT_INSTANCE_STRIDE" frontend/src/game/battle/presentation/runtime/BattleRuntime.js`
   - 预期：runtime 内不再散落这些 stride 常量与 typed array grow 逻辑。
   - 打包逻辑应集中在 `frontend/src/game/battle/presentation/snapshot/`。
