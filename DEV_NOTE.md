# PVE Ground Skill Refactor Note

## 1) New/updated data structures

### targetSpec (UI -> sim)
`triggerSquadSkill(sim, squadId, targetSpec)` now accepts ground-target payload:

```js
{
  kind: 'ground_aoe',
  x, y,
  radius,
  clipPolygon,      // optional world-space polygon points
  maxRange,
  blockedByWall
}
```

UI (`PveBattleModal`) builds `targetSpec` from `buildSkillAimOverlay` and passes it into crowd `triggerCrowdSkill`.

### squad.activeSkill (CrowdSim)
Ranged skill cast no longer one-shot. Each cast stores state on squad:

```js
{
  id,
  classTag,         // archer/artillery
  targetSpec,
  wavesTotal,
  wavesFired,
  intervalSec,
  nextWaveSec,
  ttlSec,
  config
}
```

`updateActiveGroundSkill` ticks this state and emits waves until complete.

### projectile extensions
`CombatEffects.resetProjectile` now supports:
- `impactRadius`, `blastRadius`, `blastFalloff`, `wallDamageMul`
- `maxHits`, `hitCount`
- `skillId`, `skillClass`, `waveIndex`
- `targetCenterX`, `targetCenterY`, `targetRadius`, `targetShape`, `blockedByWall`

## 2) Archer/Artillery skill params

Configured in `frontend/src/game/battle/crowd/CrowdSim.js` `GROUND_SKILL_CONFIG`.

| Class | radius(world) | waves | interval(s) | duration(s) | shotsPerWave | cooldown(s) | impactRadius | blastRadius | damageMul |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| archer | 72 | 4 | 0.26 | 1.22 | 12 | 8.6 | 2.8 | 0 | 2.05 |
| artillery | 126 | 3 | 0.46 | 1.65 | 6 | 13.5 | 4.8 | 13.5 | 2.75 |

## 3) Core behavior changes

- UI overlay circle uses world radius projection (not fixed px).
- UI clipped center/polygon is passed to sim via `targetSpec`.
- Sim uses sustained wave emission (`activeSkill`) for volley/barrage.
- Projectile update now uses segment sweep against rotated wall rects (`raycastObstacles`) to reduce tunneling.
- Projectile detonation applies area damage:
  - Arrow: impact-radius local hit
  - Shell: blast-radius AoE + falloff + wall splash damage
- Hit effects radius now tracks real impact/blast radius more closely.

## 4) Local validation checklist

1. Enter PVE battle, select attacker archer/artillery, activate skill.
2. Verify aim circle size scales with zoom/camera and matches expected world radius.
3. Cast near and far targets:
   - circle-inside enemies lose HP;
   - circle-outside enemies should rarely/never be damaged.
4. Cast with wall in between:
   - target center is clipped to wall-front;
   - shells/arrows collide with wall (no frequent thin-wall pass-through).
5. Observe sustained waves after one cast (multiple impact events over short duration).
6. Compare free fire vs skill cast: skill burst should be visibly stronger and denser.
