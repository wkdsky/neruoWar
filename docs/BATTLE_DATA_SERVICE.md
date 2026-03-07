# Battle Data Service

统一入口文件：`frontend/src/game/battle/data/BattleDataService.js`

## 方法

- `getPveBattleInit({ nodeId, gateKey, signal? })`
  - endpoint: `GET /api/nodes/:nodeId/siege/pve/battle-init?gateKey=...`
  - 返回要点：`battleId`, `attacker`, `defender`, `battlefield.layouts/itemCatalog/objects/defenderDeployments`

- `postPveBattleResult({ nodeId, payload, signal? })`
  - endpoint: `POST /api/nodes/:nodeId/siege/pve/battle-result`
  - payload 要点：`battleId`, `gateKey`, `durationSec`, `attacker`, `defender`, `details`, `startedAt`, `endedAt`

- `getBattlefieldLayout({ nodeId, gateKey, layoutId?, signal? })`
  - endpoint: `GET /api/nodes/:nodeId/battlefield-layout?gateKey=...&layoutId=...`
  - 返回要点：`layoutBundle`, `defenderRoster`, `canEdit`, `canView`

- `putBattlefieldLayout({ nodeId, gateKey, payload, signal? })`
  - endpoint: `PUT /api/nodes/:nodeId/battlefield-layout`
  - payload 要点：`gateKey`, `layout`, `itemCatalog`, `objects`, `defenderDeployments`

## 约束

- 组件不得直接 `fetch` 以上 battle/layout API。
- 所有 battle/layout 请求必须统一经过 `BattleDataService`，以确保：
  - endpoint path 不再散落；
  - 统一 JSON 解析与错误信息；
  - 统一 `AbortController.signal` 支持；
  - 后续 DTO 演进只需在 service / adapter 层收口。
