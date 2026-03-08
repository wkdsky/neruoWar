# Items Phase-4 Checklist

## 布置编辑器

- 柱 + 梁（`wood_pillar` + `wood_beam` / 兼容 `wood_plank`）socket 吸附正确
- 保存 layout 后，`attach.parentObjectId / parentSocketId / childSocketId` 回读不丢
- composite OBB 碰撞生效：物品之间不能穿插，但仍可正常吸附组合

## 战斗显示与一致性

- 进入战斗后，40° / 90° 俯视都能看清物品顶面
- 近景 3D 预览与战场外观保持同一套 OBB/mesh 近似
- 结构物（沙袋/石墙）碰撞阻挡与外观一致
- 结构物提供阻挡 / LoS 阻隔，但不会附带额外 cover buff

## 草丛隐蔽

- 敌方 squad 进入草丛后，从主场景 snapshot 中消失
- 小地图同步隐藏该敌方 squad
- 己方 squad 接近到 `revealRadius` 内时，敌方立即重新出现
- 隐蔽只影响可见性/目标选择，不影响物理碰撞

## 陷阱与持续伤害

- `trap`：进入触发时只有微小 hp 伤害，但能触发明显硬直/打断
- `trap`：cooldown 生效，不会每帧重复触发
- `contactDot`：进入时扣一次血，停留时按 `tickIntervalSec` 持续扣血，离开后停止
- `cheval_de_frise` 对 mobility/cavalry 标签有更高伤害

## 揭示与可见性

- watch flag 的 `auraReveal` 能增强附近友军的破隐能力
- hidden 的敌方目标不会被最近敌军选择/目标选择逻辑直接锁定

## 性能

- 不应出现每帧“全量扫描 items × squads”调试日志
- 交互系统应基于 item spatial hash 只查询邻域候选
- snapshot / render loop 无新增 draw call

## 结构检查

- 运行：
  - `rg -n "battlefield-layout|battle-init|battle-result" frontend/src/App.js frontend/src/game/battle/screens/BattleSceneContainer.js frontend/src/components/game/BattlefieldPreviewModal.js frontend/src/game/battle`
  - endpoint 字符串仍应只集中在 `BattleDataService`
- 运行：
  - `rg -n "ItemGeometryRegistry|ItemInteractionSystem" frontend/src/game frontend/src/components/game`
  - 几何与交互入口应指向统一 canonical 文件
