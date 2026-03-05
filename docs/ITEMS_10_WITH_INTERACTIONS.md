# 10个战场设置物（含交互）清单

本文档仅覆盖“战场设置物（Battlefield Objects）”，不包含城内建筑。

数据来源：`backend/seed/bootstrap_catalog_data.json`（`battlefieldItems`）。

## 总览

| itemId | 名称 | renderProfile.battle.meshId | topLayerKey | sideLayerKey | collider.parts | sockets | interactions |
|---|---|---|---|---|---:|---:|---|
| `it_build_wood_pillar` | 木制立柱 | `pillar` | `pillar_top` | `pillar_side` | 3 | 1 | - |
| `it_build_wood_plank` | 木制梁 | `plank` | `plank_top` | `plank_side` | 1 | 2 | - |
| `it_cover_sandbag` | 沙袋掩体 | `sandbag` | `sandbag_top` | `sandbag_side` | 3 | 0 | - |
| `it_cover_stone_wall` | 石墙段 | `wall` | `stone_wall_top` | `stone_wall_side` | 2 | 2 | - |
| `it_terrain_bush` | 草丛掩蔽 | `bush` | `bush_top` | `bush_side` | 4 | 0 | `concealment` |
| `it_trap_spikes` | 尖刺陷阱 | `trap` | `trap_spikes_top` | `trap_spikes_side` | 2 | 0 | `trapStagger` |
| `it_trap_snare_net` | 绊网陷阱 | `trap` | `trap_snare_top` | `trap_snare_side` | 1 | 0 | `trapStagger` |
| `it_hazard_cheval_de_frise` | 战术拒马 | `spikes` | `cheval_top` | `cheval_side` | 4 | 2 | `contactDot` |
| `it_hazard_poison_thorns` | 毒刺地毯 | `spikes` | `poison_thorns_top` | `poison_thorns_side` | 2 | 0 | `contactDot` |
| `it_support_watch_flag` | 警戒旗帜 | `flag` | `watch_flag_top` | `watch_flag_side` | 2 | 0 | `spotterAura` |

## 逐项定义

### 1) `it_build_wood_pillar`
- collider.parts:
```json
[
  {"cx":0,"cy":0,"cz":62,"w":18,"d":18,"h":124,"yawDeg":0},
  {"cx":0,"cy":0,"cz":8,"w":34,"d":34,"h":16,"yawDeg":0},
  {"cx":0,"cy":0,"cz":138,"w":24,"d":24,"h":20,"yawDeg":0}
]
```
- sockets: `top_center`（`compatibleTags=[wood_plank,bridge_piece]`, `snap.dist=16`, `yawStepDeg=15`）
- interactions: 无

### 2) `it_build_wood_plank`（木制梁）
- collider.parts:
```json
[{"cx":0,"cy":0,"cz":7,"w":124,"d":20,"h":14,"yawDeg":0}]
```
- sockets: `edge_left`、`edge_right`（均兼容 `pillar/wood_pillar`，`snap.dist=14`，`yawStepDeg=15`）
- interactions: 无

### 3) `it_cover_sandbag`
- collider.parts:
```json
[
  {"cx":-38,"cy":0,"cz":16,"w":44,"d":44,"h":32,"yawDeg":-8},
  {"cx":0,"cy":0,"cz":17,"w":46,"d":50,"h":34,"yawDeg":0},
  {"cx":38,"cy":0,"cz":16,"w":44,"d":44,"h":32,"yawDeg":8}
]
```
- sockets: 无
- interactions: 无（仅结构阻挡）

### 4) `it_cover_stone_wall`
- collider.parts:
```json
[
  {"cx":-44,"cy":0,"cz":36,"w":48,"d":38,"h":72,"yawDeg":0},
  {"cx":44,"cy":0,"cz":36,"w":48,"d":38,"h":72,"yawDeg":0}
]
```
- sockets: `edge_left`、`edge_right`（兼容 `stone_wall/wall_segment`，`yawStepDeg=90`）
- interactions: 无（仅结构阻挡）

### 5) `it_terrain_bush`
- collider.parts: 4个 OBB 近似团簇草丛
- interactions:
```json
{
  "kind":"concealment",
  "selector":{"rpsType":["mobility","ranged","defense"],"classTag":["infantry","cavalry","archer","artillery"],"tags":[]},
  "params":{"revealRadius":2.2}
}
```

### 6) `it_trap_spikes`
- collider.parts: 2个交叉 OBB（十字针刺）
- interactions:
```json
{
  "kind":"trapStagger",
  "selector":{"rpsType":["mobility","ranged","defense"],"classTag":["infantry","cavalry","archer","artillery"],"tags":[]},
  "params":{"hpDamage":10,"poiseDamage":96,"staggerTier":"heavy","cooldownSec":4.2}
}
```

### 7) `it_trap_snare_net`
- collider.parts: 1个矩形 OBB
- interactions:
```json
{
  "kind":"trapStagger",
  "selector":{"rpsType":["mobility","ranged","defense"],"classTag":["infantry","cavalry","archer","artillery"],"tags":[]},
  "params":{"hpDamage":7,"poiseDamage":120,"staggerTier":"heavy","cooldownSec":4.8}
}
```

### 8) `it_hazard_cheval_de_frise`
- collider.parts: 4个 OBB（主梁+斜刺）
- sockets: `edge_left`、`edge_right`（用于边缘拼接）
- interactions:
```json
{
  "kind":"contactDot",
  "selector":{"rpsType":["mobility","ranged","defense"],"classTag":["infantry","cavalry","archer","artillery"],"tags":[]},
  "params":{"hpDamageEnter":8,"hpDamageTick":5,"tickIntervalSec":1,"classMultiplier":{"cavalry":2},"rpsMultiplier":{"mobility":2}}
}
```

### 9) `it_hazard_poison_thorns`
- collider.parts: 2个低矮 patch OBB
- interactions:
```json
{
  "kind":"contactDot",
  "selector":{"rpsType":["mobility","ranged","defense"],"classTag":["infantry","cavalry","archer","artillery"],"tags":[]},
  "params":{"hpDamageEnter":4,"hpDamageTick":6,"tickIntervalSec":0.8}
}
```

### 10) `it_support_watch_flag`
- collider.parts: 细柱 + 旗面
- interactions:
```json
{
  "kind":"spotterAura",
  "selector":{"rpsType":["mobility","ranged","defense"],"classTag":["infantry","cavalry","archer","artillery"],"tags":[]},
  "params":{"revealBonusRadius":0.7}
}
```

## 默认库存

- 所有这 10 个物品在 seed 中 `enabled=true`，`initialCount=5`。
- 普通用户库存通过 `backend/services/battlefieldInventoryService.js` 懒初始化/注册初始化，缺失项补 `count=5`。
- 训练场模式在 `backend/routes/army.js` 的 `/army/training/init` 仍使用 `MAX_TEMPLATE_UNIT_COUNT`（无限/超大）行为。
