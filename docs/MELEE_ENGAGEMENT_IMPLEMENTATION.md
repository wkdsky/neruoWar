# Melee Engagement Implementation

## Scope
This change upgrades melee from pure range-threshold dueling to contact-band melee using:
- Engagement Slots
- Push & Fill
- LOS/block-aware retarget
- Spatial-hash local enemy queries

No backend protocol was changed. PVE remains frontend-authoritative simulation.

## Feature Flag
- Default: enabled
- Source: `frontend/src/game/battle/crowd/engagement.js`

Controls:
- URL query: `?meleeEngage=0|1|false|true|off|on`
- Global override:
  - `window.__MELEE_ENGAGEMENT_ENABLED = false`
  - `window.__MELEE_ENGAGEMENT_CONFIG = { ...partial overrides... }`

## Main Integration Points
- `frontend/src/game/battle/crowd/engagement.js`
  - `syncMeleeEngagement(crowd, sim, walls, dt, nowSec)`
  - Builds pair-level contact geometry and per-agent anchors.
- `frontend/src/game/battle/crowd/CrowdSim.js`
  - Calls `syncMeleeEngagement(...)` every simulation update.
  - Stores `crowd.spatial` and blends movement with:
    - original formation steering
    - engagement anchor steering
    - push pressure (front-fill)
- `frontend/src/game/battle/crowd/crowdCombat.js`
  - Replaces global nearest scans with spatial local candidate queries.
  - Adds LOS-aware squad target scoring.
  - Melee attack trigger now prefers engagement neighborhood, not only raw distance.

## Config Parameters (`MELEE_ENGAGEMENT_CONFIG`)
- `updateHz`: pair/slot recompute rate.
- `laneSpacingMul`: lane spacing multiplier.
- `bandHalfDepth`: contact band half thickness.
- `standOff`: base stand-off from contact center.
- `depthStepMul`: depth layer spacing multiplier.
- `depthLayersMin`, `depthLayersMax`: front/back layer count clamp.
- `pressureStrength`, `pressureFalloff`: push & fill pressure.
- `anchorSteerGain`, `anchorSteerCapMul`: max steering contribution from anchor.
- `blockedRetargetSec`: per-agent blocked LOS timer threshold.
- `losInflate`: LOS obstacle inflation.
- `laneSearchRadius`: lateral lane search width.
- `maxLaneShiftPerUpdate`: lane jump cap per update.
- `engageScanRadius`: local enemy query radius.
- `blockedSquadRatio`: squad blocked ratio trigger threshold.
- `retargetCooldownSec`: blocked target cooldown.
- `detourDistance`: local tangent detour waypoint length.
- `losPenalty`, `losRejectDistance`: LOS-based squad target scoring penalties.
- `stickyTargetBonus`: reduces unnecessary target churn.
- `laneOccupancyWeight`, `laneDiffWeight`, `laneNeighborBonus`: slot stability and lane affinity weights.

## Trade-offs
- Kept simulation near `O(A*k)` by using spatial hash for local candidate search.
- Avoided global A* pathfinding to preserve existing architecture and performance.
- Ranged/artillery rules are preserved; only target acquisition and local candidate source were enhanced.
- Feature flag allows immediate rollback to legacy melee behavior for A/B comparison.

## Optional Debug Hook (not enabled by default)
You can visualize anchors/lanes by adding temporary draw overlays in `PveBattleModal` using:
- `agent.engageAx`, `agent.engageAy`
- `agent.engageLane`
- `crowd.engagement.pairs`

No debug rendering is enabled by default to avoid UI/perf impact.
