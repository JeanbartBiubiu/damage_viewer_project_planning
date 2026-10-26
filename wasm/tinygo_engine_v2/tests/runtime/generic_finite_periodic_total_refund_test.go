// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	strconv "strconv"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

// Independent hand mathematics is frozen in the parent w-mechanism-analysis.
// This synthetic source retains the real continuous attack and active process.
func finitePeriodicCastInput(t *testing.T, cooldown float64, refund bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := continuousAttackInput(.1, 1000, 10, 0, 0, 5000)
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Max: 1000, Current: 500, Resolved: 1000})
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability_power", Domain: "attribute"}, model.TypeCatalogEntry{Key: settledEventDeliverySkill, Domain: "damage_trait"}, model.TypeCatalogEntry{Key: receivedOriginDirect, Domain: "damage_trait"})
	setCombatantAttr(&c, &r, "source", "ability_power", authoringSlot(100))
	addMixedSpell(&c, &r, "area_cast", 0, 250, true)
	p := &c.SharedProviders[1]
	p.SkillKey = "area_cast"
	p.Abilities = p.Abilities[:1]
	p.Processes[0].Cooldown.DurationMs = authoringConst(cooldown)
	p.Processes[0].Cooldown.RoundPositiveMs = true
	p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "finite_area"}}}}
	c.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{}
	r.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	var tick model.TickSpec
	if err := json.Unmarshal([]byte(`{"intervalMs":500,"startDelayMs":0,"onTick":[]}`), &tick); err != nil {
		t.Fatal(err)
	}
	minimum := authoringBinary("div", authoringBinary("add", authoringConst(18), authoringBinary("mul", authoringConst(.2), authoringRead("source.attr.ability_power.resolved"))), authoringConst(2))
	missingMultiplier := authoringBinary("sub", authoringConst(2), authoringBinary("div", authoringRead("target.attr.hp.current"), authoringRead("target.attr.hp.max")))
	tick.OnTick = []model.OperationDefinition{{Operation: "damage", Target: "target", Ref: "area_damage", DamageType: "damage/physics", Amount: authoringAmount(authoringBinary("mul", minimum, missingMultiplier)), Types: []string{settledEventDeliverySkill, receivedOriginDirect}}}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "finite_area", Kind: "status", StableID: p.StableID, SkillKey: p.SkillKey, Lifecycle: sourceTargetLifecycle(5000), Abilities: []model.AbilityDefinition{{AbilityKey: "tick", Kind: "tick", SkillKey: p.SkillKey, Types: []string{"ability/spell"}, TickSpec: &tick}}})
	addKilledRecovery(&c, &r, 0, "event/damage_instance")
	healing := &c.SharedProviders[3].Abilities[0]
	healing.ListenerSpec.Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.mitigatedAmount"), authoringConst(0)))
	healing.ListenerSpec.EventMatcher.All = append(healing.ListenerSpec.EventMatcher.All, settledEventDeliverySkill)
	healing.ListenerSpec.Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Ref: "area_p_heal", Amount: authoringAmount(authoringBinary("mul", authoringRead("event.damage.mitigatedAmount"), authoringConst(.18)))}}
	if refund {
		c.SharedProviders[3].Abilities = append(c.SharedProviders[3].Abilities, model.AbilityDefinition{AbilityKey: "refund", Kind: "passive_listener", SkillKey: c.SharedProviders[3].SkillKey, ListenerSpec: &model.ListenerDefinition{ListenerKey: "refund", EventMatcher: healing.ListenerSpec.EventMatcher, Condition: healing.ListenerSpec.Condition, MaxTriggersPerEvent: 1, Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", Ref: "area_refund", ValuePolicy: "reduce_total_ratio", AbilityRef: c.Rules.SkillActionBindings[0].Controls[0].AbilityRef, Amount: timedShieldExpr(.05)}}}})
	}
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return c, r
}

func finiteAreaRows(done model.DoneResult) []map[string]interface{} {
	var out []map[string]interface{}
	for _, row := range done.DamageRecords {
		if row["operationRef"] == "area_damage" {
			out = append(out, row)
		}
	}
	return out
}

func TestFinitePeriodicImmediateFirstTenTicksAndIndependentAttack(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, false)
	done := authoringRun(t, c, r)
	rows := finiteAreaRows(done)
	var times []int64
	for _, row := range rows {
		times = append(times, row["timeMs"].(int64))
	}
	if !reflect.DeepEqual(times, []int64{0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500}) {
		t.Fatal("new finite area must begin now and expire exclusively", times)
	}
	if len(done.AttackRecords) != 1 || done.AttackRecords[0].StartAtMs != 250 || math.Abs(done.Summary.SourceDamageDealt-218.94197029880172) > 1e-9 || math.Abs(done.Summary.SourceFinalHp-537.6095546537843) > 1e-9 {
		t.Fatal("fixed damage/HP/real BAA", done.Summary, done.AttackRecords)
	}
}

func TestTotalCooldownRatioSettledSiblingRefundWakesAutomaticAndPreservesAreaPhase(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 6000, true)
	b := c.Rules.SkillActionBindings[0]
	r.DriverPlan.SkillActions = []model.SkillActionPlan{}
	r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "area", BindingKey: b.BindingKey, Target: "target", SortOrder: 0, HitBindings: []model.SkillActionHitPreset{}, WaitForCooldowns: []string{}}}}
	done := authoringRun(t, c, r)
	if starts := activeAmmoStarts(done); !reflect.DeepEqual(starts, []int64{0, 3600}) {
		t.Fatal("real ordinary cooldown refund must wake 3600 recast", starts, done.Summary)
	}
	rows := finiteAreaRows(done)
	var times []int64
	for _, row := range rows {
		times = append(times, row["timeMs"].(int64))
	}
	if !reflect.DeepEqual(times, []int64{0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000}) || math.Abs(done.Summary.SourceDamageDealt-242.10186773447895) > 1e-9 || math.Abs(done.Summary.SourceFinalHp-541.7783361922062) > 1e-9 {
		t.Fatal("refresh added a first tick or changed fixed math", times, done.Summary)
	}
	instances := 0
	for _, actor := range done.FinalSnapshot.Combatants {
		for _, instance := range actor.Providers {
			if instance.DefinitionRef == "finite_area" {
				instances++
				if instance.ExpireAt == nil || *instance.ExpireAt != 8600 {
					t.Fatal("refresh lost expiry", instance)
				}
			}
		}
	}
	if instances != 1 {
		t.Fatal("refresh stacked or old expiry deleted the area", instances)
	}
	compiled := authoringCompile(t, c)
	firstReplay, firstError := runtimeengine.RunGeneric(compiled, r)
	again, secondError := runtimeengine.RunGeneric(compiled, r)
	if firstError != nil || secondError != nil || !reflect.DeepEqual(done, firstReplay) || !reflect.DeepEqual(firstReplay, again) {
		t.Fatal("same-session period/refund replay leaked state")
	}
}

func finiteAreaReady(t *testing.T, done model.DoneResult) int64 {
	t.Helper()
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "source" {
			row, ok := actor.Cooldowns["source.provider[area_cast].ability[initial]"].(map[string]interface{})
			if !ok {
				t.Fatal("missing real ordinary cooldown", actor.Cooldowns)
			}
			return row["readyAtMs"].(int64)
		}
	}
	t.Fatal("missing source")
	return -1
}

func TestFinitePeriodicWholeRequestRoundTripAndOmittedDefault(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, false)
	encoded, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	var roundTrip model.CompileRequest
	if err := json.Unmarshal(encoded, &roundTrip); err != nil {
		t.Fatal(err)
	}
	runBytes, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var roundRun model.RunRequest
	if err := json.Unmarshal(runBytes, &roundRun); err != nil {
		t.Fatal(err)
	}
	done := authoringRun(t, roundTrip, roundRun)
	if rows := finiteAreaRows(done); len(rows) != 10 || rows[0]["timeMs"] != int64(0) {
		t.Fatal("full input codec lost immediate first", rows)
	}
	c.SharedProviders[2].Abilities[0].TickSpec.HasStartDelayMs = false
	done = authoringRun(t, c, r)
	if rows := finiteAreaRows(done); len(rows) != 9 || rows[0]["timeMs"] != int64(500) {
		t.Fatal("omitted delay default changed", rows)
	}
}

func TestFinitePeriodicCurrentAttributesAndMissingHealth(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, true)
	addMixedSpell(&c, &r, "ap_change", 750, 1, false)
	p := &c.SharedProviders[4]
	p.Abilities = p.Abilities[:1]
	p.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "ap_change_window"}}}}
	c.SharedProviders = append(c.SharedProviders, hitFlatProvider("ap_change_window", "ability_power", 100))
	c.Rules.SkillActionBindings[1].HitBindings = nil
	r.DriverPlan.SkillActions[1].HitBindings = []model.SkillActionHitPreset{}
	r.StopPolicy.DurationMs = 1000
	done := authoringRun(t, c, r)
	rows := finiteAreaRows(done)
	if len(rows) != 3 || math.Abs(rows[2]["rawAmount"].(float64)-30.407979) > 1e-9 || math.Abs(done.Summary.TargetFinalHp-921.041021) > 1e-9 || math.Abs(done.Summary.SourceFinalHp-512.41261622) > 1e-9 {
		t.Fatal("tick cached AP or missing health", rows, done.Summary)
	}
}

func TestFinitePeriodicNewInstanceAfterExpiryAndRefreshWithoutExtraTick(t *testing.T) {
	for _, at := range []int64{3600, 5000} {
		t.Run(strconv.FormatInt(at, 10), func(t *testing.T) {
			c, r := finitePeriodicCastInput(t, 3000, false)
			c.SharedProviders[2].Abilities[0].TickSpec.OnTick[0].Amount = timedShieldExpr(1)
			second := r.DriverPlan.SkillActions[0]
			second.InstructionKey, second.FirstAtMs = "second_area", at
			r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, second)
			r.StopPolicy.DurationMs = at + 500
			done := authoringRun(t, c, r)
			rows, atCount := finiteAreaRows(done), 0
			for _, row := range rows {
				if row["timeMs"] == at {
					atCount++
				}
			}
			if at == 3600 && (atCount != 0 || len(rows) != 9) || at == 5000 && (atCount != 1 || len(rows) != 12) {
				t.Fatal("active refresh/new instance first tick", at, rows)
			}
		})
	}
}

func TestFinitePeriodicRejectsIncompleteOrForeignDefinition(t *testing.T) {
	for _, name := range []string{"permanent", "two_stacks", "wrong_refresh", "mixed_tick", "two_tick_abilities", "wrong_parent", "missing_skill", "mounted_area", "target_application", "two_parent_mounts", "tick_cost", "tick_condition"} {
		t.Run(name, func(t *testing.T) {
			c, _ := finitePeriodicCastInput(t, 12000, false)
			p, area := &c.SharedProviders[1], &c.SharedProviders[2]
			switch name {
			case "permanent":
				area.Lifecycle = nil
			case "two_stacks":
				area.Lifecycle.MaxStacks = 2
			case "wrong_refresh":
				area.Lifecycle.RefreshPolicy = "add"
			case "mixed_tick":
				area.Abilities[0].TickSpec.OnTick = append(area.Abilities[0].TickSpec.OnTick, model.OperationDefinition{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)})
			case "two_tick_abilities":
				area.Abilities = append(area.Abilities, model.AbilityDefinition{AbilityKey: "other", Kind: "active"})
			case "wrong_parent":
				area.StableID = "foreign"
			case "missing_skill":
				area.SkillKey = ""
			case "mounted_area":
				c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "bad", DefinitionRef: area.ProviderKey})
			case "target_application":
				p.Processes[0].MomentOperations[0].Operations[0].Target = "target"
			case "two_parent_mounts":
				c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "foreign", DefinitionRef: p.ProviderKey})
			case "tick_cost":
				area.Abilities[0].Cost = &model.AbilityCost{ResourceKey: "mana", Amount: authoringConst(1)}
			case "tick_condition":
				area.Abilities[0].CastCondition = timedShieldExpr(1)
			}
			if compiled := compilebundle.CompileGeneric(c); compiled.OK {
				t.Fatal("incomplete immediate finite period compiled", name)
			}
		})
	}
}

func TestFinitePeriodicUsesItsActualOpponentWithoutBasicAttackAndRejectsSelfTarget(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, true)
	r.DriverPlan.BasicAttack = nil
	r.StopPolicy.DurationMs = 1
	done := authoringRun(t, c, r)
	if done.Summary.TargetFinalHp != 981 || math.Abs(done.Summary.SourceFinalHp-503.42) > 1e-9 || len(done.AttackRecords) != 0 {
		t.Fatal("area guessed its target from a basic attack or hit itself", done.Summary)
	}
	r.DriverPlan.SkillActions[0].Target = "source"
	compiled := authoringCompile(t, c)
	if _, err := runtimeengine.RunGeneric(compiled, r); err == nil {
		t.Fatal("self-target plan acquired opponent area damage")
	}
}

func TestFinitePeriodicWithoutPassiveKeepsDamageAndOrdinaryCooldown(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, true)
	c.SharedProviders = c.SharedProviders[:3]
	c.Combatants[0].Providers = c.Combatants[0].Providers[:2]
	r.InitialSnapshot.Combatants[0].Providers = r.InitialSnapshot.Combatants[0].Providers[:2]
	done := authoringRun(t, c, r)
	if math.Abs(done.Summary.SourceDamageDealt-218.94197029880172) > 1e-9 || done.Summary.SourceFinalHp != 500 || finiteAreaReady(t, done) != 12000 || len(recoveryEvidence(done, model.EvidenceKindHeal)) != 0 {
		t.Fatal("absent passive synthesized healing/refunds", done.Summary)
	}
}
