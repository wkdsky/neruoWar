# Battle Refactor Phase-2 Checklist

## 目标

验证 Battle Data Service 已收口 battle/layout API；并确认 `defenderDeployments.rotation` 能从 preview 保存、回读并进入 battle deploy / 开战。

## 手工验收步骤

1. 打开布置界面：调整 defender 朝向 rotation（非默认角度，如 `30°` / `120°`）并保存
   - 在 `BattlefieldPreviewModal` 中选中守军 deployment。
   - 通过滚轮或原有朝向调整方式把 rotation 调整到明显非默认角度。
   - 点击保存。

2. 重新进入布置界面：确认 `layoutBundle` 回读 rotation 不丢
   - 重新打开同一 gate 的 battlefield layout。
   - 确认守军 deployment 的朝向与保存前一致。
   - 如需快速定位，可在浏览器网络面板查看 `GET /api/nodes/:nodeId/battlefield-layout` 返回中的 `layoutBundle.defenderDeployments[].rotation`。

3. 打开 PVE battle-init：确认 `defenderDeployments` 在 init payload 中带 `rotation`
   - 从正常入口打开 `battle-init`。
   - 查看返回 JSON 中 `battlefield.defenderDeployments[].rotation`。
   - 开发环境下，后端会输出一条轻量日志：`[battle-init] defenderDeployments with rotation=...`。

4. 进入 deploy / 开战：守军初始阵型朝向与布置一致（有 rotation 时）
   - 进入 battle deploy 阶段，观察守军 preview 阵型朝向是否与 preview 保存角度一致。
   - 点击开战，确认守军初始阵型方向不再退回旧默认朝向。

5. 老布局兼容性
   - 对一个没有 `rotation` 的旧布局进入 preview / battle。
   - 确认行为保持原样，不因本次改动被统一强制改向。

6. BattleSceneModal / PreviewModal / App 不再散落直连这些 battle/layout endpoint
   - 运行：
     - `rg -n "battle-init|battle-result|battlefield-layout" frontend/src/App.js frontend/src/game/battle/screens/BattleSceneContainer.js frontend/src/components/game/BattlefieldPreviewModal.js frontend/src/game/battle`
   - 预期：endpoint 字符串只出现在 `frontend/src/game/battle/data/BattleDataService.js`。
