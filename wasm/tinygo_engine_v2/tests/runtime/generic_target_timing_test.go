// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	fmt "fmt"
	math "math"
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func timingSet(key string, value float64) model.OperationDefinition {
	return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: key, Types: []string{"state_scope/provider_target"}, ValuePolicy: "set", Amount: timedShieldExpr(value)}
}

func timingDamage(key string, amount model.GenericFormulaExpr) model.OperationDefinition {
	return model.OperationDefinition{Operation: "damage", Target: "target", Ref: key, DamageType: "damage/magic", Amount: &amount, Types: []string{"damage_trait/delivery_skill", "damage_trait/origin_direct"}, VampQualification: model.VampResolved}
}

func targetTimingInput(explode bool, hitTimes ...int64) (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, 1000, 0, 0, 0, 6500)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "damage_trait/delivery_basic_attack", Domain: "damage_trait"})
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "state_scope/provider_target", Domain: "state_scope"}, model.TypeCatalogEntry{Key: "event/skill_hit", Domain: "event"}, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"}, model.TypeCatalogEntry{Key: "event/ability_started", Domain: "event"}, model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"}, model.TypeCatalogEntry{Key: "ability/passive", Domain: "ability"}, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: "damage_trait/delivery_skill", Domain: "damage_trait"}, model.TypeCatalogEntry{Key: "damage_trait/origin_direct", Domain: "damage_trait"}, model.TypeCatalogEntry{Key: "combatant/champion", Domain: "combatant"})
	formuladefinition.DeclareAttributes(&c, "magic_resistance", "ability_power", "omnivamp_percent")
	formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ConstantDefense("1"))
	c.Rules.VampRules = []model.VampRuleDefinition{{VampType: model.VampOmnivamp, SourceAttributeKey: "omnivamp_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: model.Float64Ptr(1), TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, AbilityMatcher: model.TypeMatcher{Any: []string{"ability/spell", "ability/passive", model.AbilityTypeBasicAttack}}, DamageMatcher: model.TypeMatcher{All: []string{"damage_trait/origin_direct"}}}}
	for ai := range c.SharedProviders[0].Abilities {
		for oi := range c.SharedProviders[0].Abilities[ai].Operations {
			op := &c.SharedProviders[0].Abilities[ai].Operations[oi]
			if op.SkillHit != nil {
				for ci := range op.SkillHit.Candidates {
					for li := range op.SkillHit.Candidates[ci].Operations {
						leaf := &op.SkillHit.Candidates[ci].Operations[li]
						if leaf.Operation == "damage" {
							leaf.VampQualification = model.VampResolved
							leaf.Types = []string{"damage_trait/delivery_basic_attack", "damage_trait/origin_direct"}
						}
					}
				}
			}
		}
	}
	for i := range c.Combatants {
		c.Combatants[i].Attributes["ability_power"] = authoringSlot(0)
		c.Combatants[i].Attributes["omnivamp_percent"] = authoringSlot(0)
		c.Combatants[i].Attributes["magic_resistance"] = authoringSlot(0)
	}
	c.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Max: 1000, Current: 500, Resolved: 1000}
	c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 100}
	r.DriverPlan.Entries = []model.DriverEntry{}
	for i, at := range hitTimes {
		key := fmt.Sprintf("phase_contact_%d", i)
		ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability/skill/" + key, Domain: "ability"})
		p, b, a := targetMarkSkill(key, at, 0)
		p.Processes[0].Steps[0] = model.ProcessStepDefinition{StepKey: "delay", StepType: "IMMEDIATE", OccupiesAction: model.BoolPtr(false)}
		c.SharedProviders = append(c.SharedProviders, p)
		c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: key, DefinitionRef: p.ProviderKey})
		c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, b)
		r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, a)
	}
	p := model.ProviderDefinition{ProviderKey: "timed_natural", Kind: "character", StableID: "timed_passive", SkillKey: "timed_passive", InitialStateSchema: map[string]interface{}{}}
	for _, key := range []string{"slot1", "slot2", "slot3", "pending", "cap", "count"} {
		max := float64(1)
		duration := float64(4000)
		if key == "count" {
			max = 3
		}
		if key == "pending" {
			duration = 2000
		}
		p.InitialStateSchema[key] = map[string]interface{}{"valueType": "integer", "defaultValue": 0, "maxValue": max, "durationMs": duration, "refreshPolicy": "refresh_on_write"}
	}
	for i := 1; i <= 3; i++ {
		key := fmt.Sprintf("slot%d", i)
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "tick_" + key, SkillKey: p.SkillKey, Kind: "tick", Types: []string{"ability/passive"}, TickSpec: &model.TickSpec{IntervalMs: 250, AnchorScope: "state_scope/provider_target", AnchorStateKey: key, PhasePolicy: "preserve_on_extend", OnTick: []model.OperationDefinition{timingDamage("tick_"+key, authoringBinary("mul", authoringConst(.00125), authoringRead("target.attr.hp.max")))}}})
	}
	if explode {
		ops := []model.OperationDefinition{timingSet("slot1", 0), timingSet("slot2", 0), timingSet("slot3", 0), timingSet("count", 0), timingDamage("explosion", authoringBinary("mul", authoringBinary("add", authoringConst(.06), authoringBinary("mul", authoringConst(.0002), authoringRead("source.attr.ability_power.resolved"))), authoringRead("target.attr.hp.max"))), timingSet("cap", 1), timingSet("slot1", 1), timingSet("count", 1)}
		alive := authoringBinary("gt", authoringRead("target.attr.hp.current"), authoringConst(0))
		ops[6].Condition = &alive
		ops[7].Condition = &alive
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "detonate", Kind: "stateful", SkillKey: p.SkillKey, Types: []string{"ability/passive"}, TargetExpirySpec: &model.TargetExpirySpec{AnchorScope: "state_scope/provider_target", AnchorStateKey: "pending", OnExpire: ops}})
	}
	for count := 0; count <= 3; count++ {
		unblocked := authoringBinary("eq", authoringRead("event.skill_hit.blocked"), authoringConst(0))
		isCount := authoringBinary("eq", authoringRead("provider.target_state.count"), authoringConst(float64(count)))
		cond := authoringBinary("min", unblocked, authoringBinary("min", isCount, authoringBinary("gt", authoringRead("target.attr.hp.current"), authoringConst(0))))
		ops := []model.OperationDefinition{}
		if count == 0 {
			ops = append(ops, timingSet("slot1", 0), timingSet("slot2", 0), timingSet("slot3", 0), timingSet("pending", 0))
		}
		if count < 3 {
			ops = append(ops, timingSet(fmt.Sprintf("slot%d", count+1), 1))
		}
		for i := 1; i <= 3; i++ {
			ops = append(ops, model.OperationDefinition{Operation: model.OperationKindStateDurationChange, Target: "self", Ref: fmt.Sprintf("slot%d", i), ValuePolicy: "ensure_remaining_preserve_phase", Types: []string{"state_scope/provider_target"}, Amount: timedShieldExpr(4000)})
		}
		next := count + 1
		if next > 3 {
			next = 3
		}
		ops = append(ops, timingSet("count", float64(next)))
		if count == 2 && explode {
			ops = append(ops, timingSet("pending", 1))
		}
		p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: fmt.Sprintf("on_hit_%d", count), SkillKey: p.SkillKey, Kind: "passive_listener", Params: map[string]float64{}, ListenerSpec: &model.ListenerDefinition{ListenerKey: fmt.Sprintf("on_hit_%d", count), EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner"}}, MaxTriggersPerEvent: 1, Condition: &cond, Operations: ops}})
	}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "timed_mount", DefinitionRef: p.ProviderKey})
	for i, actor := range c.Combatants {
		providers := []model.CombatantProviderSnapshot{}
		for _, m := range actor.Providers {
			providers = append(providers, model.CombatantProviderSnapshot{ProviderRef: m.ProviderRef, DefinitionRef: m.DefinitionRef, Source: actor.Key, Owner: actor.Key, Stacks: 1})
		}
		r.InitialSnapshot.Combatants[i] = model.CombatantSnapshot{Key: actor.Key, Attributes: actor.Attributes, Resources: actor.Resources, Providers: providers}
	}
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return c, r
}

func timingRows(d model.DoneResult, ref string) []map[string]interface{} {
	var rows []map[string]interface{}
	for _, row := range d.DamageRecords {
		if row["operationRef"] == ref {
			rows = append(rows, row)
		}
	}
	return rows
}

func timingEnd(t *testing.T, d model.DoneResult, key string) (float64, float64) {
	t.Helper()
	bag := sourceProviderState(t, d.FinalSnapshot, "timed_mount")
	target := bag["targetState"].(map[string]interface{})
	values := target["values"].(map[string]interface{})
	expires := target["expireAt"].(map[string]interface{})
	v, _ := values[key].(float64)
	e, _ := expires[key].(float64)
	return v, e
}

func TestPhasedTargetTimingIndependentClocksAndExplosion(t *testing.T) {
	for _, test := range []struct {
		name    string
		explode bool
		hits    []int64
		end     int64
		ticks   int
		damage  float64
	}{{"single", false, []int64{0}, 4000, 16, 20}, {"extended_off_phase", false, []int64{0, 400}, 4400, 33, 41.25}, {"three_then_explosion", true, []int64{0, 100, 200}, 2200, 24, 90}, {"new_layer_first", true, []int64{0, 100, 200}, 2450, 25, 91.25}, {"three_terminal_holds", false, []int64{0, 250, 500}, 4500, 51, 63.75}} {
		t.Run(test.name, func(t *testing.T) {
			c, r := targetTimingInput(test.explode, test.hits...)
			r.StopPolicy.DurationMs = test.end
			d := authoringRun(t, c, r)
			if !d.Summary.Execution.Complete || d.Summary.SourceDamageDealt != test.damage || d.Summary.TargetFinalHp != 1000-test.damage {
				t.Fatal(d.Summary)
			}
			ticks := len(timingRows(d, "tick_slot1")) + len(timingRows(d, "tick_slot2")) + len(timingRows(d, "tick_slot3"))
			if ticks != test.ticks {
				t.Fatalf("ticks %d expected %d", ticks, test.ticks)
			}
			if test.name == "extended_off_phase" {
				for _, row := range timingRows(d, "tick_slot1") {
					if row["timeMs"] == int64(4400) {
						t.Fatal("off-phase deadline manufactured a tick")
					}
				}
			}
			if test.name == "new_layer_first" {
				rows := timingRows(d, "tick_slot1")
				if rows[len(rows)-1]["timeMs"] != int64(2450) {
					t.Fatal(rows)
				}
			}
			session := authoringCompile(t, c)
			again, err := runtimeengine.RunGeneric(session, r)
			if err != nil || !reflect.DeepEqual(d, again) {
				t.Fatal("repeat mismatch", err)
			}
		})
	}
}

func TestPhasedTargetTimingOldEndpointAndReservationStayFixed(t *testing.T) {
	c, r := targetTimingInput(true, 0, 100, 200, 500)
	r.StopPolicy.DurationMs = 2200
	d := authoringRun(t, c, r)
	if rows := timingRows(d, "explosion"); len(rows) != 1 || rows[0]["timeMs"] != int64(2200) {
		t.Fatal("later hit moved the reservation", rows)
	}
	if value, expiry := timingEnd(t, d, "cap"); value != 1 || expiry != 6200 {
		t.Fatal(value, expiry)
	}
	c, r = targetTimingInput(false, 0, 400)
	r.StopPolicy.DurationMs = 4250
	d = authoringRun(t, c, r)
	if len(timingRows(d, "tick_slot1")) != 17 {
		t.Fatal("old 4000 cleanup cancelled retained 4250 phase")
	}
}

func TestPhasedTargetTimingMissAndShieldDoNotActivate(t *testing.T) {
	for _, blocked := range []bool{false, true} {
		c, r := targetTimingInput(false, 0)
		if !blocked {
			r.DriverPlan.SkillActions[0].HitBindings[0].Preset = "MISS"
		} else {
			skillHitCatalog(&c)
			shield := model.ProviderDefinition{ProviderKey: "shield", StableID: "shield", Kind: "status", Types: []string{model.ProviderTypeSpellShield}}
			c.SharedProviders = append(c.SharedProviders, shield)
			c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "shield", DefinitionRef: "shield"})
			r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "shield", DefinitionRef: "shield", Source: "target", Owner: "target", Stacks: 1})
			// Public Generic shield probe: the production attack admission does not
			// authorize this synthetic initial shield as management equipment.
			r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "shield_contact", AbilityRef: "source.provider[phase_contact_0].ability[hit]", Source: "source", Target: "target"}}}
			r.SkillUses = []model.SkillUseFact{{UseKey: "shield_use", Source: "source", SkillKey: "phase_contact_0", HistoryState: "complete"}}
			r.SkillHitFacts = []model.SkillHitFact{{DriverEntryKey: "shield_contact", UseRef: hitUse("shield_use"), Sequence: seqN(1)}}
		}
		r.StopPolicy.DurationMs = 4500
		d := authoringRun(t, c, r)
		if len(timingRows(d, "tick_slot1")) != 0 || d.Summary.SourceDamageDealt != 0 {
			t.Fatal("miss/blocked contact armed phase", blocked, d.Summary)
		}
	}
}

func TestTargetTimingCompileRejectsExpandedBehaviorAndLegacyExtension(t *testing.T) {
	for _, bad := range []string{"extra_damage", "condition", "state_tick", "dynamic_amount", "copy", "output", "crit", "unknown_phase", "four_phase", "duplicate_anchor", "mixed_active", "expiry_two_damage", "expiry_rearm", "expiry_dynamic_state", "expiry_condition", "old_ensure", "wrong_scope", "bad_ensure_amount", "amount_read", "any_matcher"} {
		t.Run(bad, func(t *testing.T) {
			c, _ := targetTimingInput(true, 0, 100, 200)
			p := &c.SharedProviders[len(c.SharedProviders)-1]
			tick := p.Abilities[0].TickSpec
			switch bad {
			case "extra_damage":
				tick.OnTick = append(tick.OnTick, tick.OnTick[0])
			case "condition":
				tick.OnTick[0].Condition = timedShieldExpr(1)
			case "state_tick":
				tick.OnTick = []model.OperationDefinition{timingSet("count", 0)}
			case "dynamic_amount":
				tick.OnTick[0].Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "copy":
				tick.OnTick[0].CopyableOnHit = true
			case "output":
				tick.OnTick[0].OutputRef = "not_authorized"
			case "crit":
				tick.OnTick[0].CritEligible = true
			case "unknown_phase":
				tick.PhasePolicy = "restart"
			case "four_phase":
				extra := p.Abilities[0]
				extra.AbilityKey = "four"
				copy := *extra.TickSpec
				copy.AnchorStateKey = "cap"
				extra.TickSpec = &copy
				p.Abilities = append(p.Abilities, extra)
			case "duplicate_anchor":
				p.Abilities[1].TickSpec.AnchorStateKey = "slot1"
			case "mixed_active":
				p.Abilities = append(p.Abilities, model.AbilityDefinition{AbilityKey: "bad", Kind: "active"})
			case "expiry_two_damage":
				p.Abilities[3].TargetExpirySpec.OnExpire = append(p.Abilities[3].TargetExpirySpec.OnExpire, p.Abilities[3].TargetExpirySpec.OnExpire[4])
			case "expiry_rearm":
				p.Abilities[3].TargetExpirySpec.OnExpire[0] = timingSet("pending", 1)
			case "expiry_dynamic_state":
				p.Abilities[3].TargetExpirySpec.OnExpire[0].Amount = authoringAmount(authoringRead("target.attr.hp.max"))
			case "expiry_condition":
				p.Abilities[3].TargetExpirySpec.OnExpire[6].Condition = timedShieldExpr(1)
			case "old_ensure":
				p.Abilities[4].ListenerSpec.Operations[5].ValuePolicy = "ensure_remaining"
			case "wrong_scope":
				p.Abilities[4].ListenerSpec.Operations[5].Types = []string{"state_scope/provider"}
			case "bad_ensure_amount":
				p.Abilities[4].ListenerSpec.Operations[5].Amount = timedShieldExpr(.5)
			case "amount_read":
				p.Abilities[4].ListenerSpec.Operations[5].Amount = authoringAmount(authoringRead("provider.state.count"))
			case "any_matcher":
				p.Abilities[4].ListenerSpec.EventMatcher = model.TypeMatcher{Any: []string{model.EventTypeSkillHit, "event/source_owner"}}
			}
			got := compilebundle.CompileGeneric(c)
			if got.OK {
				t.Fatal("accepted unauthorized new behavior", bad)
			}
		})
	}
}

func TestTargetTimingFreshOnlyBeforeRestorationAndDriverRejection(t *testing.T) {
	for _, bad := range []string{"value", "expiry", "target", "external_fact", "compile_initial", "direct_expiry"} {
		t.Run(bad, func(t *testing.T) {
			c, r := targetTimingInput(true, 0)
			switch bad {
			case "value":
				r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"timed_mount": map[string]interface{}{"state": map[string]interface{}{"slot1": float64(1)}}}
			case "expiry":
				r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"timed_mount": map[string]interface{}{"expireAt": map[string]interface{}{"slot1": float64(5000)}}}
			case "target":
				r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"timed_mount": map[string]interface{}{"targetState": map[string]interface{}{"target": "target"}}}
			case "external_fact":
				r.InitialSnapshot.Combatants[0].ProviderState = map[string]interface{}{"timed_mount": map[string]interface{}{"timing": map[string]interface{}{"generation": float64(1)}}}
			case "compile_initial":
				c.Combatants[0].Providers[len(c.Combatants[0].Providers)-1].InitialState = map[string]interface{}{"slot1": float64(1)}
			case "direct_expiry":
				r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{{EntryKey: "forged", Source: "source", Target: "target", AbilityRef: "source.provider[timed_mount].ability[detonate]"}}}
			}
			if bad != "direct_expiry" && bad != "compile_initial" {
				r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}}
			}
			compiled := compilebundle.CompileGeneric(c)
			if bad == "compile_initial" {
				if compiled.OK {
					t.Fatal("non-fresh compile mount accepted")
				}
				return
			}
			if !compiled.OK {
				t.Fatal(compiled.Result.Errors)
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil {
				t.Fatal("non-fresh/direct expiry request accepted", bad)
			}
		})
	}
}

func TestTargetTimingSummaryZeroRetentionAndVampRemainNumerical(t *testing.T) {
	c, r := targetTimingInput(true, 0, 100, 200)
	c.Combatants[0].Attributes["omnivamp_percent"] = authoringSlot(.2)
	r.StopPolicy.DurationMs = 2200
	d := authoringRun(t, c, r)
	if math.Abs(d.Summary.SourceFinalHp-518) > 1e-9 || d.Summary.SourceDamageDealt != 90 {
		t.Fatal(d.Summary)
	}
	for _, mode := range []model.RunOutputMode{"summary", "detailed"} {
		r.OutputMode = mode
		zero := 0
		r.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero, MaxHealingRecords: &zero, MaxMechanicRecords: &zero}
		next := authoringRun(t, c, r)
		if next.Summary.SourceDamageDealt != 90 || math.Abs(next.Summary.SourceFinalHp-518) > 1e-9 || len(next.DamageRecords) != 0 {
			t.Fatal(next.Summary)
		}
	}
}

func TestPhasedTargetTimingActualTimerOrderAtTerminalAndOldExtendedEndpoint(t *testing.T) {
	for _, extended := range []bool{false, true} {
		hits := []int64{0, 3999}
		if extended {
			hits = []int64{0, 400, 3999}
		}
		c, r := targetTimingInput(false, hits...)
		last := len(hits)
		c.SharedProviders[last].Processes[0].Steps[0] = model.ProcessStepDefinition{StepKey: "delay", StepType: "DELAY", DelayMs: timedShieldExpr(1), OccupiesAction: model.BoolPtr(false)}
		r.StopPolicy.DurationMs = 4250
		d := authoringRun(t, c, r)
		var refs []string
		for _, row := range d.DamageRecords {
			if row["timeMs"] == int64(4000) {
				refs = append(refs, row["operationRef"].(string))
			}
		}
		root := fmt.Sprintf("phase_contact_%d.root", len(hits)-1)
		rootAt, tickAt := -1, -1
		for i, ref := range refs {
			if ref == root {
				rootAt = i
			}
			if ref == "tick_slot1" {
				tickAt = i
			}
		}
		if rootAt < 0 || tickAt < 0 || !extended && tickAt > rootAt || extended && tickAt < rootAt {
			t.Fatal("real process timer/terminal ordering changed", extended, refs)
		}
		if !extended && len(timingRows(d, "tick_slot1")) != 17 {
			t.Fatal("new generation did not start at 4000+250")
		}
	}
}

func TestTargetTimingSameCompiledSessionColdReplayAndGenericBudget(t *testing.T) {
	c, r := targetTimingInput(true, 0, 100, 200)
	addTimingKillRecovery(&c)
	r.StopPolicy.DurationMs = 2450
	session := authoringCompile(t, c)
	first, err := runtimeengine.RunGeneric(session, r)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		again, err := runtimeengine.RunGeneric(session, r)
		if err != nil || !reflect.DeepEqual(first, again) {
			t.Fatal("same compiled session retained a previous phase/reservation/ID", i, err)
		}
	}
	// Actual Generic root hits keep the compile-time bindings but do not use a
	// skill plan or background-attack budget owner. The reservation must still
	// open exactly one ordinary event budget at its own callback.
	c, r = targetTimingInput(true, 0, 100, 200)
	r.DriverPlan = model.DriverPlan{Entries: []model.DriverEntry{}}
	for i, at := range []int64{0, 100, 200} {
		key := fmt.Sprintf("generic_%d", i)
		skill := fmt.Sprintf("phase_contact_%d", i)
		use := key + "_use"
		r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: key, Source: "source", Target: "target", AbilityRef: "source.provider[" + skill + "].ability[hit]", FirstAtMs: at})
		r.SkillUses = append(r.SkillUses, model.SkillUseFact{UseKey: use, Source: "source", SkillKey: skill, HistoryState: "complete"})
		r.SkillHitFacts = append(r.SkillHitFacts, model.SkillHitFact{DriverEntryKey: key, UseRef: hitUse(use), Sequence: seqN(1)})
	}
	r.StopPolicy.DurationMs = 2200
	d := authoringRun(t, c, r)
	if d.Summary.SourceDamageDealt != 90 || len(timingRows(d, "explosion")) != 1 {
		t.Fatal("public Generic timing path failed", d.Summary)
	}
}
