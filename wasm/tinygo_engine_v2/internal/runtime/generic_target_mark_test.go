package runtime

import (
	"reflect"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func targetMarkSkill(skill string, at int64, raw float64) (model.ProviderDefinition, model.SkillActionBinding, model.SkillActionPlan) {
	ref := func(ability string) string { return "source.provider[" + skill + "].ability[" + ability + "]" }
	damage := model.OperationDefinition{Operation: "damage", Target: "target", Ref: skill + ".root", DamageType: "damage/physics", Amount: authoringAmount(authoringConst(raw)), Types: []string{"damage_trait/delivery_skill", "damage_trait/origin_direct"}, VampQualification: model.VampResolved}
	candidate := model.SkillHitCandidate{CandidateKey: "root", EffectOccurrenceKey: "root", EffectKey: "root", ResultKey: "root", Semantic: model.SkillHitSemantic{ResultType: "DAMAGE", Target: "TARGET", Moment: "INSTANT"}, SpellShieldBlockScope: hitScope("SKILL"), Operations: []model.OperationDefinition{damage}}
	p := model.ProviderDefinition{ProviderKey: skill + "_def", Kind: "character", StableID: skill, SkillKey: skill, Processes: []model.ProcessDefinition{{ProcessKey: "cast", SkillKey: skill, Steps: []model.ProcessStepDefinition{{StepKey: "delay", StepType: "DELAY", OccupiesAction: model.BoolPtr(true), DelayMs: timedShieldExpr(250)}}, Costs: []model.ProcessCostDefinition{}, Cooldown: &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(8000), StartMoment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}}}},
		Abilities: []model.AbilityDefinition{{AbilityKey: "initial", SkillKey: skill, Kind: "active", Types: []string{"ability/spell", "ability/skill/" + skill}, ProcessControl: &model.ProcessControlDefinition{Action: "INITIAL", ProcessKey: "cast"}}, {AbilityKey: "hit", SkillKey: skill, Kind: "active", Types: []string{"ability/spell", "ability/skill/" + skill}, Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &model.SkillHitDefinition{SkillKey: skill, Candidates: []model.SkillHitCandidate{candidate}}}}}}}
	b := model.SkillActionBinding{BindingKey: skill, Source: "source", ProviderRef: skill, ProviderDefinitionRef: p.ProviderKey, SkillKey: skill, Controls: []model.SkillActionControl{{Action: "INITIAL", ProcessKey: "cast", AbilityRef: ref("initial")}}, HitBindings: []model.SkillActionHitBinding{{HitBindingKey: "hit", ProcessKey: "cast", Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, HitAbilityRef: ref("hit")}}}
	a := model.SkillActionPlan{InstructionKey: skill, FirstAtMs: at, SortOrder: 0, Source: "source", Target: "target", SkillKey: skill, BindingKey: skill, Action: "INITIAL", AbilityRef: ref("initial"), HitBindings: []model.SkillActionHitPreset{{HitBindingKey: "hit", Preset: "TARGET_HIT"}}}
	return p, b, a
}

func targetMarkInput(withSkill, withAttack bool) (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, 1000, 20, 0, 0, 1250)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "event/skill_hit", Domain: "event"}, model.TypeCatalogEntry{Key: "event/ability_started", Domain: "event"}, model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"}, model.TypeCatalogEntry{Key: "ability/spell", Domain: "ability"}, model.TypeCatalogEntry{Key: "ability/skill/w", Domain: "ability"}, model.TypeCatalogEntry{Key: "ability/skill/q", Domain: "ability"},
		model.TypeCatalogEntry{Key: stateScopeProviderTarget, Domain: "state_scope"}, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: "damage_trait/delivery_skill", Domain: "damage_trait"}, model.TypeCatalogEntry{Key: "damage_trait/delivery_basic_attack", Domain: "damage_trait"}, model.TypeCatalogEntry{Key: "damage_trait/origin_direct", Domain: "damage_trait"}, model.TypeCatalogEntry{Key: "combatant/champion", Domain: "combatant"})
	formuladefinition.DeclareAttributes(&c, "magic_resistance", "ability_power", "life_steal_percent", "omnivamp_percent")
	formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ResistanceDefense("magic_resistance"))
	c.Rules.VampRules = []model.VampRuleDefinition{{VampType: model.VampLifeSteal, SourceAttributeKey: "life_steal_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: model.Float64Ptr(1), TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, AbilityMatcher: model.TypeMatcher{All: []string{model.AbilityTypeBasicAttack}}, DamageMatcher: model.TypeMatcher{All: []string{"damage_trait/delivery_basic_attack", "damage_trait/origin_direct"}}},
		{VampType: model.VampOmnivamp, SourceAttributeKey: "omnivamp_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: model.Float64Ptr(1), TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, AbilityMatcher: model.TypeMatcher{Any: []string{model.AbilityTypeBasicAttack, "ability/spell"}}, DamageMatcher: model.TypeMatcher{All: []string{"damage_trait/origin_direct"}}}}
	for i := range c.SharedProviders[0].Abilities {
		for j := range c.SharedProviders[0].Abilities[i].Operations {
			op := &c.SharedProviders[0].Abilities[i].Operations[j]
			if op.SkillHit != nil {
				for ci := range op.SkillHit.Candidates {
					for oi := range op.SkillHit.Candidates[ci].Operations {
						leaf := &op.SkillHit.Candidates[ci].Operations[oi]
						if leaf.Operation == "damage" {
							leaf.VampQualification = model.VampResolved
							leaf.Types = []string{"damage_trait/delivery_basic_attack", "damage_trait/origin_direct"}
						}
					}
				}
			}
		}
	}
	c.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000}
	c.Combatants[0].Attributes["ability_power"] = authoringSlot(100)
	c.Combatants[0].Attributes["life_steal_percent"] = authoringSlot(.1)
	c.Combatants[0].Attributes["omnivamp_percent"] = authoringSlot(.2)
	c.Combatants[1].Attributes["magic_resistance"] = authoringSlot(100)
	c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 80, Max: 100}
	if !withAttack {
		r.DriverPlan.BasicAttack = nil
		c.Combatants[0].Providers = nil
		c.SharedProviders[0].Abilities = nil
		c.SharedProviders[0].Listeners = nil
		c.SharedProviders[0].Processes = nil
	}
	r.DriverPlan.Entries = []model.DriverEntry{}
	r.DriverPlan.SkillActions = nil
	add := func(p model.ProviderDefinition, b model.SkillActionBinding, a model.SkillActionPlan) {
		c.SharedProviders = append(c.SharedProviders, p)
		c.Combatants[0].Providers = append(c.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: p.SkillKey, DefinitionRef: p.ProviderKey})
		c.Rules.SkillActionBindings = append(c.Rules.SkillActionBindings, b)
		r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, a)
	}
	at := int64(0)
	if withAttack {
		at = 100
	}
	w, wb, wa := targetMarkSkill("w", at, 0)
	w.InitialStateSchema = map[string]any{"mark": map[string]any{"valueType": "integer", "defaultValue": 0, "maxValue": 1, "durationMs": 4000, "refreshPolicy": "refresh_on_write"}}
	condition := authoringBinary("eq", authoringRead("event.skill_hit.blocked"), authoringConst(0))
	w.Abilities = append(w.Abilities, model.AbilityDefinition{AbilityKey: "arm", Kind: "passive_listener", SkillKey: "w", Types: []string{"ability/spell", "ability/skill/w"}, ListenerSpec: &model.ListenerDefinition{ListenerKey: "arm", MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit, "event/source_owner", "ability/skill/w"}}, Condition: &condition, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "mark", ValuePolicy: "set", Types: []string{stateScopeProviderTarget}, Amount: timedShieldExpr(1)}}}})
	damage := model.OperationDefinition{Operation: "damage", Target: "target", Ref: "w.detonate", DamageType: "damage/magic", Amount: authoringAmount(authoringBinary("add", authoringRead("ability.param.base"), authoringBinary("mul", authoringConst(.9), authoringRead("source.attr.ability_power.resolved")))), Types: []string{"damage_trait/delivery_skill", "damage_trait/origin_direct"}, VampQualification: model.VampResolved}
	consumer := func(key, kind, ref string, restore bool) model.AbilityDefinition {
		m := &model.TargetMarkDefinition{StateKey: "mark", StateScope: "provider_target", TriggerKind: kind, TriggerAbilityRef: ref, DamageBlockScope: "DAMAGE_INSTANCE", Damage: &damage}
		if restore {
			m.Restore = &model.OperationDefinition{Operation: "resource_change", Target: "self", Ref: "w.restore", ResourceKey: "mana", Amount: timedShieldExpr(60)}
		}
		all := []string{kind, "event/source_owner"}
		if kind == model.EventTypeSkillHit {
			all = append(all, "ability/skill/q")
		}
		return model.AbilityDefinition{AbilityKey: key, Kind: "passive_listener", SkillKey: "w", Types: []string{"ability/spell", "ability/skill/w"}, Params: map[string]float64{"base": 130}, ListenerSpec: &model.ListenerDefinition{ListenerKey: key, MaxTriggersPerEvent: 1, EventMatcher: model.TypeMatcher{All: all}, Operations: []model.OperationDefinition{{Operation: model.OperationKindConsumeTargetMark, Target: "target", Ref: "w." + key, TargetMark: m}}}}
	}
	if withSkill {
		w.Abilities = append(w.Abilities, consumer("consume_q", model.EventTypeSkillHit, "source.provider[q].ability[hit]", true))
	}
	if withAttack {
		w.Abilities = append(w.Abilities, consumer("consume_attack", model.EventTypeBasicAttackHit, authoringRef("native_hit"), false))
	}
	add(w, wb, wa)
	if withSkill {
		q, qb, qa := targetMarkSkill("q", 500, 100)
		add(q, qb, qa)
	}
	for i := range c.Combatants {
		actor := c.Combatants[i]
		providers := []model.CombatantProviderSnapshot{}
		for _, mount := range actor.Providers {
			providers = append(providers, model.CombatantProviderSnapshot{ProviderRef: mount.ProviderRef, DefinitionRef: mount.DefinitionRef, Source: actor.Key, Owner: actor.Key, Stacks: 1})
		}
		r.InitialSnapshot.Combatants[i] = model.CombatantSnapshot{Key: actor.Key, Attributes: actor.Attributes, Resources: actor.Resources, Providers: providers}
	}
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	return c, r
}

func targetMarkRows(done model.DoneResult) []model.EvidenceItem {
	var rows []model.EvidenceItem
	for _, row := range done.Evidence.Items {
		if row.Kind == "target_mark_consumed" {
			rows = append(rows, row)
		}
	}
	return rows
}

func TestTargetMarkSkillAtomicDamageRestoreAndIdentity(t *testing.T) {
	for _, withAttack := range []bool{false, true} {
		c, r := targetMarkInput(true, withAttack)
		done := authoringRun(t, c, r)
		wantDamage, wantHeal := 210.0, 42.0
		if withAttack {
			wantDamage, wantHeal = 250, 54
		}
		vampNear(t, "damage", done.Summary.SourceDamageDealt, wantDamage)
		vampNear(t, "healing", *done.Summary.SourceVampHealing, wantHeal)
		if done.TargetMarkSummary == nil || done.TargetMarkSummary.ConsumedCount != 1 || done.TargetMarkSummary.SkillCount != 1 || done.TargetMarkSummary.AttackCount != 0 {
			t.Fatal(done.TargetMarkSummary)
		}
		rows := targetMarkRows(done)
		if len(rows) != 1 || rows[0].Data["useRef"] != "skill:q" || rows[0].Data["useSkillKey"] != "q" || rows[0].Data["providerRef"] != "w" || rows[0].Data["damageId"] == nil {
			t.Fatal(rows)
		}
		var found bool
		for _, row := range done.DamageRecords {
			if row["operationRef"] == "w.detonate" {
				found = true
				if row["rawAmount"] != 220.0 || row["postDefenseDamage"] != 110.0 || row["abilityRef"] != "source.provider[w].ability[consume_q]" || row["useRef"] != "skill:q" {
					t.Fatal(row)
				}
			}
		}
		if !found {
			t.Fatal("missing W damage")
		}
		if done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 100 {
			t.Fatal(done.FinalSnapshot.Combatants[0].Resources)
		}
		var restore bool
		for _, item := range done.Evidence.Items {
			if item.Kind == "resource_restore" {
				restore = true
				if item.Data["actualDelta"] != 20.0 || item.Data["overflow"] != 40.0 || item.Data["useRef"] != "skill:q" {
					t.Fatal(item)
				}
			}
		}
		if !restore {
			t.Fatal("missing restore")
		}
	}
}

func TestTargetMarkAttackDoesNotRestoreOrDuplicateUse(t *testing.T) {
	c, r := targetMarkInput(false, true)
	delete(c.Combatants[0].Resources, "mana")
	done := authoringRun(t, c, r)
	vampNear(t, "damage", done.Summary.SourceDamageDealt, 150)
	vampNear(t, "healing", *done.Summary.SourceVampHealing, 34)
	if done.TargetMarkSummary == nil || done.TargetMarkSummary.AttackCount != 1 || done.TargetMarkSummary.SkillCount != 0 || done.Summary.BasicAttack.CompletedCount != 2 {
		t.Fatal(done.Summary, done.TargetMarkSummary)
	}
	rows := targetMarkRows(done)
	if len(rows) != 1 || rows[0].Data["useRef"] != "basic:native-test:2" || rows[0].Data["useSkillKey"] != "test_attack" {
		t.Fatal(rows)
	}
	for _, item := range done.Evidence.Items {
		if item.Kind == "resource_restore" {
			t.Fatal("attack restored mana", item)
		}
	}
}

func TestTargetMarkCompileClosedReferenceGates(t *testing.T) {
	mutations := map[string]func(*model.CompileRequest){
		"foreign_owner": func(c *model.CompileRequest) {
			c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "w", DefinitionRef: "w_def"})
		},
		"unbounded": func(c *model.CompileRequest) {
			c.SharedProviders[1].InitialStateSchema["mark"].(map[string]any)["durationMs"] = 0
		},
		"wrong_cap": func(c *model.CompileRequest) {
			c.SharedProviders[1].InitialStateSchema["mark"].(map[string]any)["maxValue"] = 2
		},
		"wrong_root": func(c *model.CompileRequest) {
			c.SharedProviders[1].Abilities[3].ListenerSpec.Operations[0].TargetMark.TriggerAbilityRef = "source.provider[w].ability[hit]"
		},
		"missing_guard": func(c *model.CompileRequest) { c.SharedProviders[1].Abilities[2].ListenerSpec.Condition = nil },
		"guard_OR": func(c *model.CompileRequest) {
			spec := c.SharedProviders[1].Abilities[2].ListenerSpec
			spec.Condition = authoringAmount(authoringBinary("max", *spec.Condition, authoringConst(1)))
		},
		"extra_writer": func(c *model.CompileRequest) {
			c.SharedProviders[1].Abilities = append(c.SharedProviders[1].Abilities, model.AbilityDefinition{AbilityKey: "forged", Kind: "active", SkillKey: "w", Operations: []model.OperationDefinition{targetRemainingStateOperation(1)}})
		},
		"hidden_event_amount": func(c *model.CompileRequest) {
			op := c.SharedProviders[1].Abilities[3].ListenerSpec.Operations[0].TargetMark.Damage
			op.Amount = &model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(1), authoringConst(220), authoringRead("provider.target_state.mark")}}
		},
		"dynamic_restore": func(c *model.CompileRequest) {
			c.SharedProviders[1].Abilities[3].ListenerSpec.Operations[0].TargetMark.Restore.Amount = authoringAmount(authoringRead("source.attr.ability_power.resolved"))
		},
		"direct_body": func(c *model.CompileRequest) {
			a := &c.SharedProviders[1].Abilities[3]
			a.Operations = a.ListenerSpec.Operations
			a.ListenerSpec.Operations = nil
		},
		"extra_listener_op": func(c *model.CompileRequest) {
			a := c.SharedProviders[1].Abilities[3].ListenerSpec
			a.Operations = append(a.Operations, model.OperationDefinition{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)})
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			c, _ := targetMarkInput(true, false)
			mutate(&c)
			compiled := compilebundle.CompileGeneric(c)
			if compiled.OK {
				t.Fatal("accepted unauthorized target mark", name)
			}
		})
	}
}

func TestTargetMarkZeroRecordsAndIndependentColdReplay(t *testing.T) {
	c, r := targetMarkInput(true, true)
	session := authoringCompile(t, c)
	full, err := RunGeneric(session, r)
	if err != nil {
		t.Fatal(err)
	}
	zero := 0
	r.RecordBudget = &model.RecordBudget{MaxDamageRecords: &zero, MaxAttackRecords: &zero, MaxMechanicRecords: &zero, MaxSkillActionRecords: &zero, MaxSkillUseRecords: &zero, MaxHealingRecords: &zero}
	for _, mode := range []model.RunOutputMode{"detailed", "summary"} {
		r.OutputMode = mode
		var first model.DoneResult
		for i := 0; i < 5; i++ {
			done, err := RunGeneric(session, r)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(done.Summary, full.Summary) || !reflect.DeepEqual(done.FinalSnapshot, full.FinalSnapshot) || !reflect.DeepEqual(done.TargetMarkSummary, full.TargetMarkSummary) {
				t.Fatal("record budget changed settlement")
			}
			if i == 0 {
				first = done
			} else if !reflect.DeepEqual(first, done) {
				t.Fatal("repeat drift")
			}
		}
	}
}

func targetMarkState(t *testing.T, c model.CompileRequest, r model.RunRequest) *genericRunState {
	t.Helper()
	s, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	return s
}
