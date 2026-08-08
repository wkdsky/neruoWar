import {
  ArrowUpRight,
  Ban,
  BrainCircuit,
  Crosshair,
  Flame,
  Focus,
  Gauge,
  HeartPulse,
  Layers,
  Link2,
  LocateFixed,
  Move,
  Orbit,
  Radar,
  Radio,
  Rocket,
  RotateCw,
  ScanLine,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sword,
  Swords,
  Target,
  Waves,
  Wind,
  Zap
} from 'lucide-react';

// Resolve by id first so two branches never silently collapse to the same glyph.
const ICON_BY_SKILL_ID = Object.freeze({
  melee_war_form: Shield,
  melee_heavy_blow: Swords,
  melee_rapid_slash: Zap,
  melee_weapon_aura: Wind,
  melee_circular_step: RotateCw,
  melee_breach_charge: ArrowUpRight,
  melee_wave_sweep: Waves,
  melee_blade_persistence: Sword,
  melee_circumference: Orbit,
  ranged_ballistic_form: Crosshair,
  ranged_fixed_volley: Target,
  ranged_run_fire: Move,
  ranged_piercing_barrage: Layers,
  ranged_suppression_fan: Radar,
  ranged_hunter_lock: Focus,
  ranged_deep_pierce: ScanLine,
  ranged_fire_net: Flame,
  ranged_longshot: LocateFixed,
  support_coordination_protocol: Radio,
  support_specialized_boost: Gauge,
  support_comprehensive_tuning: SlidersHorizontal,
  support_chain_amplifier: Link2,
  support_battlefield_resonance: BrainCircuit,
  support_purification_pulse: HeartPulse,
  support_precision_overload: Rocket,
  support_total_command: ShieldCheck,
  support_intervention_domain: Ban
});

const FALLBACK_ICON_BY_NAME = Object.freeze({
  ArrowUpRight,
  Ban,
  Crosshair,
  Flame,
  Gauge,
  HeartPulse,
  Layers,
  Move,
  Orbit,
  Radio,
  Rocket,
  RotateCw,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sword,
  Swords,
  Target,
  Waves,
  Wind,
  Zap
});

export const resolveSkillTreeIcon = (skill = null) => {
  const skillId = String(skill?.id || skill?.skillId || '').trim();
  return ICON_BY_SKILL_ID[skillId]
    || FALLBACK_ICON_BY_NAME[skill?.icon]
    || Sparkles;
};

export { ICON_BY_SKILL_ID };
