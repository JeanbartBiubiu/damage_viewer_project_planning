package execution

import (
	model "tinygo_engine_v2/internal/model"
)

func continuousAttackInput(as, hp, damage, armor, crit float64, duration int64) (model.CompileRequest, model.RunRequest) {
	c, r := authoringInput()
	c.SharedProviders[0].Processes[0].Cooldown.DurationMs = model.GenericFormulaExpr{Op: "ref", Ref: "test/attack_interval_ms"}
	c.SharedProviders[0].Processes[0].Cooldown.RoundPositiveMs = true
	values := map[string]float64{"attack_speed": as, "attack_damage": damage, "critical_strike_chance": crit, "critical_strike_damage_bonus_percent": 0, "armor_pen_percent": 0, "armor_pen_flat": 0}
	for k, v := range values {
		c.Combatants[0].Attributes[k] = authoringSlot(v)
		r.InitialSnapshot.Combatants[0].Attributes[k] = authoringSlot(v)
	}
	c.Combatants[1].Attributes["hp"] = authoringSlot(hp)
	c.Combatants[1].Attributes["armor"] = authoringSlot(armor)
	r.InitialSnapshot.Combatants[1].Attributes["hp"] = authoringSlot(hp)
	r.InitialSnapshot.Combatants[1].Attributes["armor"] = authoringSlot(armor)
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}, BasicAttack: &model.BasicAttackPlan{PlanKey: "native-test", Source: "source", Target: "target", SkillKey: "test_attack", StartAbilityRef: authoringRef("native_start"), HitAbilityRef: authoringRef("native_hit"), InitialControlAbilityRef: authoringRef("initial"), AttackSpeedAttributeKey: "attack_speed", AttackSpeedInputMax: as}}
	r.SkillUses = nil
	r.AttackStartFacts = nil
	r.SkillHitFacts = nil
	r.ProcessCommandFacts = nil
	r.StopPolicy.DurationMs = duration
	r.Sampling = model.SamplingConfig{Disabled: true}
	return c, r
}
