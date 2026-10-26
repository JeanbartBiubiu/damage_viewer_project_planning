// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func cappedFlatInput(t *testing.T, chance float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := continuousAttackInput(1, 1000, 20, 0, chance, 1)
	c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	var mod model.ModifierDefinition
	if err := json.Unmarshal([]byte(`{"modifierKey":"physical_cap","kind":"pipeline","command":"damage","channel":"all_damage","stage":"incoming_pre_mitigation","bucket":"all_instances","valuePolicy":"subtract","value":{"op":"const","value":13},"condition":{"op":"read","path":"damage.type.damage/physics"},"maximumReductionRatio":0.5}`), &mod); err != nil {
		t.Fatal(err)
	}
	addPermanentSkillSource(&c, &r, 1, "guard_skill", "character", mod)
	c.SharedProviders[len(c.SharedProviders)-2].SkillKey = "guard_skill"
	c.SharedProviders[len(c.SharedProviders)-1].SkillKey = "guard_skill"
	return c, r
}

func TestIncomingCappedFlatSeparatesCriticalBranches(t *testing.T) {
	c, r := cappedFlatInput(t, .5)
	done := authoringRun(t, c, r)
	// Before runtime: .5*(20-min(13,10)) + .5*(40-min(13,20)) = 18.5.
	if math.Abs(done.Summary.SourceDamageDealt-18.5) > 1e-12 {
		t.Fatalf("damage=%v want 18.5 (merged-first 17 is invalid)", done.Summary.SourceDamageDealt)
	}
	d := firstOriginalDamage(t, done)
	if evidenceDataFloat(d, "rawAmount") != 30 || evidenceDataFloat(d, "normalPart") != 10 || evidenceDataFloat(d, "critPart") != 20 {
		t.Fatal("target reduction rewrote raw/crit facts", d)
	}
}

func TestIncomingCappedFlatActualPassiveAbilityInitializer(t *testing.T) {
	c, r := cappedFlatInput(t, .5)
	parent := &c.SharedProviders[len(c.SharedProviders)-1]
	listener := parent.Listeners[0]
	parent.Listeners = nil
	parent.Abilities = []model.AbilityDefinition{{AbilityKey: "initialize", Kind: "passive_listener", SkillKey: parent.SkillKey, ListenerSpec: &listener}}
	done := authoringRun(t, c, r)
	if done.Summary.SourceDamageDealt != 18.5 {
		t.Fatal(done.Summary)
	}
}

// This synthetic graph uses the existing real skill-plan constructor. The cap
// initializer shares that actual character mount; the opposite owner stays pure.
func cappedFlatCoexistenceInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := singleSkillInput(false)
	r.StopPolicy.DurationMs = 400
	c.TypeCatalog.Types = append(c.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"})
	mod := model.ModifierDefinition{ModifierKey: "guard", Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "incoming_pre_mitigation", Bucket: "all_instances", ValuePolicy: "subtract", Value: authoringConst(13), Condition: authoringAmount(authoringRead("damage.type.damage/physical")), MaximumReductionRatio: model.Float64Ptr(.5)}
	parent := &c.SharedProviders[0]
	parent.SkillKey = "configured_spell"
	parent.Listeners = []model.ListenerDefinition{{ListenerKey: "initialize_guard", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}}, MaxTriggersPerEvent: 1,
		Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderRef: "source_guard", ProviderDefinitionRef: "source_guard"}}}}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "source_guard", StableID: "source_guard", Kind: "status", SkillKey: "configured_spell", Modifiers: []model.ModifierDefinition{mod}})
	addPermanentSkillSource(&c, &r, 1, "target_guard", "character", mod)
	c.SharedProviders[len(c.SharedProviders)-2].SkillKey = "configured_spell"
	c.SharedProviders[len(c.SharedProviders)-1].SkillKey = "configured_spell"
	return c, r
}

func TestIncomingCappedFlatActualInitialCoexistence(t *testing.T) {
	for _, mode := range []string{"manual", "automatic", "future_initial"} {
		t.Run(mode, func(t *testing.T) {
			c, r := cappedFlatCoexistenceInput(t)
			if mode == "automatic" {
				plan := r.DriverPlan.SkillActions[0]
				r.DriverPlan.SkillActions = nil
				r.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "one_cast", BindingKey: plan.BindingKey, Target: "target", HitBindings: plan.HitBindings, WaitForCooldowns: []string{}}}}
			}
			if mode == "future_initial" {
				r.DriverPlan.SkillActions[0].FirstAtMs = 300
			}
			done := authoringRun(t, c, r)
			want := float64(87) // 100 - min(13, .5*100); defense is the declared constant 1.
			if mode == "future_initial" {
				want = 0 // Its real 300ms INITIAL has not reached 550ms execution.
			}
			if done.Summary.SourceDamageDealt != want || done.Summary.SourceFinalHp != 500 || done.Summary.TargetFinalHp != 500-want {
				t.Fatal(done.Summary)
			}
			for _, actor := range done.FinalSnapshot.Combatants {
				found := false
				for _, provider := range actor.Providers {
					found = found || provider.DefinitionRef == "source_guard" && actor.Key == "source" || provider.DefinitionRef == "target_guard_effect" && actor.Key == "target"
				}
				if !found {
					t.Fatal("permanent cap did not initialize on its actual owner", actor.Key)
				}
			}
			if !reflect.DeepEqual(done, authoringRun(t, c, r)) {
				t.Fatal("fresh replay drift")
			}
		})
	}
}

func TestIncomingCappedFlatInitialClosureRejectsUnboundMembers(t *testing.T) {
	for _, name := range []string{"missing_binding", "wrong_owner", "wrong_mount", "wrong_skill", "extra_active", "extra_process", "extra_listener", "extra_state", "extra_cap_writer"} {
		t.Run(name, func(t *testing.T) {
			c, _ := cappedFlatCoexistenceInput(t)
			parent := &c.SharedProviders[0]
			switch name {
			case "missing_binding":
				c.Rules.SkillActionBindings = nil
			case "wrong_owner":
				c.Rules.SkillActionBindings[0].Source = "target"
			case "wrong_mount":
				c.Rules.SkillActionBindings[0].ProviderRef = "target_guard"
			case "wrong_skill":
				c.Rules.SkillActionBindings[0].SkillKey = "another_skill"
			case "extra_active":
				ability := parent.Abilities[1]
				ability.AbilityKey = "unbound_hit"
				parent.Abilities = append(parent.Abilities, ability)
			case "extra_process":
				process := parent.Processes[0]
				process.ProcessKey = "unbound_process"
				parent.Processes = append(parent.Processes, process)
			case "extra_listener":
				listener := parent.Listeners[0]
				listener.ListenerKey = "another_initializer"
				parent.Listeners = append(parent.Listeners, listener)
			case "extra_state":
				parent.InitialStateSchema = map[string]interface{}{"hidden": map[string]interface{}{"valueType": "integer", "defaultValue": 0}}
			case "extra_cap_writer":
				parent.Abilities[1].Operations = append(parent.Abilities[1].Operations, model.OperationDefinition{Operation: "apply_provider", Target: "self", ProviderRef: "source_guard", ProviderDefinitionRef: "source_guard"})
			}
			if result := compile.CompileGeneric(c); result.OK {
				t.Fatal("unbound/foreign parent member accepted", name)
			}
		})
	}
}

func TestIncomingCappedFlatActiveRequiresRealRunPlan(t *testing.T) {
	for _, name := range []string{"no_plan", "wrong_binding", "external_entry"} {
		t.Run(name, func(t *testing.T) {
			c, r := cappedFlatCoexistenceInput(t)
			session := authoringCompile(t, c)
			r.ExpectedRulesHash = session.RulesHash
			if name == "wrong_binding" {
				r.DriverPlan.SkillActions[0].BindingKey = "not_the_compiled_binding"
			} else {
				r.DriverPlan.SkillActions = nil
			}
			if name == "external_entry" {
				r.DriverPlan.Entries = []model.DriverEntry{{AbilityRef: "source.provider[caster].ability[initial]"}}
			}
			if _, issue := runtimeengine.RunGeneric(session, r); issue == nil {
				t.Fatal("unused active graph or arbitrary entry gained cap admission", name)
			}
		})
	}
}

func TestIncomingCappedFlatShieldVampAndZeroDetails(t *testing.T) {
	for _, zeroDetails := range []bool{false, true} {
		t.Run(map[bool]string{false: "detailed", true: "zero_records"}[zeroDetails], func(t *testing.T) {
			c, r := cappedFlatInput(t, .5)
			addPureInitializedShield(&c, &r, "target", "listener_spec_operations", 40)
			setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Max: 1000, Resolved: 1000, Current: 500})
			setCombatantAttr(&c, &r, "source", "life_steal_percent", authoringSlot(.1))
			setCombatantAttr(&c, &r, "source", "omnivamp_percent", authoringSlot(.2))
			formuladefinition.DeclareAttributes(&c, "life_steal_percent", "omnivamp_percent")
			c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: receivedDeliveryBasic, Domain: "damage_trait"}, model.TypeCatalogEntry{Key: receivedOriginDirect, Domain: "damage_trait"})
			body := cappedBody(&c)
			body.Types = []string{receivedDeliveryBasic, receivedOriginDirect}
			body.VampQualification = model.VampResolved
			efficiency := 1.0
			for _, v := range []struct{ kind, key string }{{model.VampLifeSteal, "life_steal_percent"}, {model.VampOmnivamp, "omnivamp_percent"}} {
				c.Rules.VampRules = append(c.Rules.VampRules, model.VampRuleDefinition{VampType: v.kind, SourceAttributeKey: v.key, BasisOutputKind: model.VampPostDefense, DefaultEfficiency: &efficiency, TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, DamageMatcher: model.TypeMatcher{All: []string{receivedDeliveryBasic, receivedOriginDirect}}, AbilityMatcher: model.TypeMatcher{All: []string{model.AbilityTypeBasicAttack}}})
			}
			if zeroDetails {
				zero := 0
				r.RecordBudget = &model.RecordBudget{MaxAttackRecords: &zero, MaxDamageRecords: &zero}
			}
			done := authoringRun(t, c, r)
			if done.Summary.SourceVampHealing == nil || math.Abs(*done.Summary.SourceVampHealing-5.55) > 1e-10 || math.Abs(done.Summary.SourceFinalHp-505.55) > 1e-10 || done.Summary.TargetFinalHp != 1000 || done.Summary.SourceDamageDealt != 18.5 {
				t.Fatal(done.Summary)
			}
			shields := done.FinalSnapshot.Combatants[1].Shields
			if len(shields) != 1 || shields[0].Remaining != 21.5 {
				t.Fatal(shields)
			}
			if zeroDetails && len(done.DamageRecords) != 0 {
				t.Fatal("zero budget leaked damage")
			}
		})
	}
}

func cappedBody(c *model.CompileRequest) *model.OperationDefinition {
	return &c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0].Operations[0]
}

func TestIncomingCappedFlatUsesDeclaredBonusDomainWithoutAttributeNames(t *testing.T) {
	c, r := cappedFlatInput(t, .5)
	formuladefinition.DeclareAttributes(&c, "lab_declared_bonus")
	setCombatantAttr(&c, &r, "target", "lab_declared_bonus", authoringSlot(0))
	expr := map[string]any{"inputs": []any{phase3Input("b", "source", "lab_declared_bonus", "BONUS")}, "stages": []any{phase3Stage("out", phase3Binary("add", phase3Const("5"), phase3Binary("mul", phase3Const("0.03"), phase3Read("b"))))}, "outputStageKey": "out"}
	c.Formulas = append(c.Formulas, model.NamedFormula{Key: "generic_bonus_guard", Scope: "skill", SkillKey: "guard_skill", Expression: expr, Parameters: []model.FormulaParameter{}})
	c.SharedProviders[len(c.SharedProviders)-2].Modifiers[0].Value = model.GenericFormulaExpr{Op: "ref", Ref: "generic_bonus_guard"}
	addPermanentSkillSource(&c, &r, 1, "lab_bonus_initializer", "character", model.ModifierDefinition{ModifierKey: "bonus", Kind: "attribute", Target: "self.attr.lab_declared_bonus", ValuePolicy: "add", Value: authoringConst(10)})
	done := authoringRun(t, c, r)
	if math.Abs(done.Summary.SourceDamageDealt-24.7) > 1e-12 {
		t.Fatal(done.Summary)
	}
}

func TestIncomingCappedFlatSeparatePacketsBypassAndRecordModes(t *testing.T) {
	for _, mode := range []model.RunOutputMode{model.RunOutputDetailed, model.RunOutputSummary} {
		t.Run(string(mode), func(t *testing.T) {
			c, r := cappedFlatInput(t, 0)
			r.OutputMode = mode
			c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: "damage/real", Domain: "damage"})
			formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ConstantDefense("1"))
			formuladefinition.SetDamageFormula(&c, "damage/real", formuladefinition.ConstantDefense("1"))
			body := *cappedBody(&c)
			for _, kind := range []string{"damage/physics", "damage/magic", "damage/real"} {
				op := body
				op.DamageType = kind
				op.CritEligible = false
				op.CritChance, op.CritMultiplier, op.CritMultiplierMin = nil, nil, nil
				op.Ref = "extra:" + kind
				candidate := c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[0]
				candidate.CandidateKey = "extra_" + kind[len("damage/"):]
				candidate.ResultKey = candidate.CandidateKey
				candidate.Operations = []model.OperationDefinition{op}
				c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates = append(c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates, candidate)
			}
			done := authoringRun(t, c, r)
			// Each of two physical packets 20->10, magic and real each remain20.
			if done.Summary.SourceDamageDealt != 60 || done.Summary.TargetHpLoss != 60 {
				t.Fatal(done.Summary)
			}
			if mode == model.RunOutputDetailed && len(done.DamageRecords) != 4 {
				t.Fatal(done.DamageRecords)
			}
			if mode == model.RunOutputSummary && len(done.DamageRecords) != 0 {
				t.Fatal("summary produced details")
			}
		})
	}
}

func TestIncomingCappedFlatRejectsInvalidShapes(t *testing.T) {
	for _, name := range []string{"missing_cap", "negative_cap", "large_cap", "nan_cap", "wrong_stage", "extra_modifier", "extra_action", "build_parent", "foreign_skill", "pre_mount", "orphan", "global", "wrong_condition", "negative_points", "foreign_read", "finite_status", "second_source", "alias_parent_ref", "foreign_static_formula", "total_read"} {
		t.Run(name, func(t *testing.T) {
			c, r := cappedFlatInput(t, .5)
			status, parent := len(c.SharedProviders)-2, len(c.SharedProviders)-1
			m := &c.SharedProviders[status].Modifiers[0]
			switch name {
			case "missing_cap":
				m.MaximumReductionRatio = nil
			case "negative_cap":
				m.MaximumReductionRatio = model.Float64Ptr(-.1)
			case "large_cap":
				m.MaximumReductionRatio = model.Float64Ptr(1.1)
			case "nan_cap":
				m.MaximumReductionRatio = model.Float64Ptr(math.NaN())
			case "wrong_stage":
				m.Stage = "incoming_post_mitigation"
			case "extra_modifier":
				c.SharedProviders[status].Modifiers = append(c.SharedProviders[status].Modifiers, *m)
			case "extra_action":
				c.SharedProviders[parent].Listeners[0].Operations = append(c.SharedProviders[parent].Listeners[0].Operations, model.OperationDefinition{Operation: "emit_event", Target: "self", EventType: model.EventTypeSourceInitialized})
			case "build_parent":
				c.SharedProviders[parent].Kind = "build"
			case "foreign_skill":
				c.SharedProviders[parent].SkillKey = "unrelated"
			case "pre_mount":
				c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "pre", DefinitionRef: c.SharedProviders[status].ProviderKey})
			case "orphan":
				c.SharedProviders[parent].Listeners = nil
			case "alias_parent_ref":
				c.SharedProviders[parent].Listeners[0].Operations[0].ProviderRef = c.Combatants[1].Providers[0].ProviderRef
			case "global":
				c.Rules.Modifiers = append(c.Rules.Modifiers, *m)
			case "wrong_condition":
				m.Condition = authoringAmount(authoringConst(1))
			case "negative_points":
				m.Value = authoringConst(-1)
			case "foreign_read":
				m.Value = authoringRead("target.attr.armor.resolved")
			case "foreign_static_formula":
				c.Formulas = append(c.Formulas, formuladefinition.FromExpr("foreign_guard", "other_skill", authoringConst(13), nil))
				m.Value = model.GenericFormulaExpr{Op: "ref", Ref: "foreign_guard"}
			case "total_read":
				c.Formulas = append(c.Formulas, formuladefinition.FromExpr("total_guard", "guard_skill", authoringRead("source.attr.armor.resolved"), nil))
				m.Value = model.GenericFormulaExpr{Op: "ref", Ref: "total_guard"}
			case "finite_status":
				c.SharedProviders[status].Lifecycle = &model.ProviderLifecycle{DurationMs: authoringAmount(authoringConst(1000)), MaxStacks: 1, RefreshPolicy: "replace"}
			case "second_source":
				addPermanentSkillSource(&c, &r, 1, "second_guard", "character", *m)
				c.SharedProviders[len(c.SharedProviders)-2].SkillKey = "second_guard"
				c.SharedProviders[len(c.SharedProviders)-1].SkillKey = "second_guard"
			}
			result := compile.CompileGeneric(c)
			if result.OK {
				t.Fatal("invalid capped flat compiled", name)
			}
		})
	}
}

func TestIncomingCappedFlatFreshRunAndReplay(t *testing.T) {
	c, r := cappedFlatInput(t, .5)
	session := authoringCompile(t, c)
	a, err := runtimeengine.RunGeneric(session, r)
	if err != nil {
		t.Fatal(err)
	}
	b, err := runtimeengine.RunGeneric(session, r)
	if err != nil || !reflect.DeepEqual(a, b) {
		t.Fatal("repeat changed", err)
	}
	for _, name := range []string{"owner", "state", "expiry", "entries", "ledger"} {
		t.Run(name, func(t *testing.T) {
			var request model.RunRequest
			data, _ := json.Marshal(r)
			if err := json.Unmarshal(data, &request); err != nil {
				t.Fatal(err)
			}
			switch name {
			case "owner":
				request.InitialSnapshot.Combatants[1].Providers[0].Owner = "source"
			case "state":
				request.InitialSnapshot.Combatants[1].Providers[0].State = map[string]interface{}{"fake": 1}
			case "expiry":
				at := int64(100)
				request.InitialSnapshot.Combatants[1].Providers[0].ExpireAt = &at
			case "entries":
				request.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "fake", AbilityRef: authoringRef("native_hit"), Source: "source", Target: "target"}}
			case "ledger":
				request.InitialSnapshot.ProcessInstances = []model.ProcessInstanceSnapshot{{Owner: "target"}}
			}
			if _, err := runtimeengine.RunGeneric(session, request); err == nil {
				t.Fatal("restored/fake source admitted")
			}
		})
	}
}
