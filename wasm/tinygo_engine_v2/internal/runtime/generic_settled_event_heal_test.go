package runtime

import (
	"math"
	"reflect"
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

const settledEventDeliverySkill = "damage_trait/delivery_skill"

// Expectations are hand-calculated and frozen in output/morgana-settled-heal-native.
// This fixture uses the existing real active process and complete permanent mount.
func settledEventHealInput() (model.CompileRequest, model.RunRequest) {
	c, r := killedRecoveryInput(eventTypeDamageInstance)
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 1000, Max: 1000, Resolved: 1000})
	ability := &c.SharedProviders[1].Abilities[0]
	ability.Params = map[string]float64{"heal_percent_points": 18}
	listener := ability.ListenerSpec
	listener.Condition = nil
	listener.Operations = listener.Operations[:1]
	listener.Operations[0].Amount = authoringAmount(authoringBinary("max", authoringConst(0),
		authoringBinary("div", authoringBinary("mul", authoringRead("event.damage.mitigatedAmount"), authoringRead("ability.param.heal_percent_points")), authoringConst(100))))
	return c, r
}

func TestSettledEventSelfHealRealActivePacket(t *testing.T) {
	c, r := settledEventHealInput()
	done := authoringRun(t, c, r)
	heals := recoveryEvidence(done, model.EvidenceKindHeal)
	if done.Summary.SourceFinalHp != 518 || done.Summary.TargetFinalHp != 900 || len(heals) != 1 {
		t.Fatal("100 settled damage must request and apply 18 self heal", done.Summary, heals)
	}
	vampAmount(t, heals[0].Data, "healingBeforeModifiers", 18)
	assertRecoveryProvenance(t, heals[0], "restore_hp", "skill:cast_once")
}

func TestSettledEventSelfHealRealBackgroundPacket(t *testing.T) {
	c, r := continuousAttackInput(.1, 1000, 100, 0, 0, 1)
	addKilledRecovery(&c, &r, 0, eventTypeDamageInstance)
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000})
	listener := c.SharedProviders[1].Abilities[0].ListenerSpec
	listener.Condition = nil
	listener.Operations = listener.Operations[:1]
	listener.Operations[0].Amount = authoringAmount(authoringBinary("mul", authoringRead("event.damage.mitigatedAmount"), authoringConst(.18)))
	done := authoringRun(t, c, r)
	heals := recoveryEvidence(done, model.EvidenceKindHeal)
	if done.Summary.SourceFinalHp != 518 || done.Summary.TargetFinalHp != 900 || len(heals) != 1 || done.Summary.BasicAttack.CompletedCount != 1 {
		t.Fatal("actual source-owned settled packet must heal 18", done.Summary, heals)
	}
}

func settledEventHealMixedInput() (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(.1, 1000, 50, 0, 0, 1000)
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000})
	addMixedSpell(&c, &r, "spell", 250, 0, false)
	c.SharedProviders[1].Processes[0].Steps[0].StepType = "IMMEDIATE"
	c.SharedProviders[1].Processes[0].Steps[0].DelayMs = nil
	addKilledRecovery(&c, &r, 0, eventTypeDamageInstance)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: settledEventDeliverySkill, Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: receivedDeliveryBasic, Domain: "damage_trait"}, model.TypeCatalogEntry{Key: receivedOriginDirect, Domain: "damage_trait"},
		model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"}, model.TypeCatalogEntry{Key: "magic_resist", Domain: "attribute"})
	setCombatantAttr(&c, &r, "target", "magic_resist", authoringSlot(100))
	formuladefinition.SetDamageFormula(&c, "damage/magic", formuladefinition.ResistanceDefense("magic_resist"))
	op := &c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0]
	op.Amount, op.DamageType, op.Types = timedShieldExpr(200), "damage/magic", []string{settledEventDeliverySkill, receivedOriginDirect}
	op.VampQualification = model.VampResolved
	listener := c.SharedProviders[2].Abilities[0].ListenerSpec
	listener.Condition = nil
	listener.EventMatcher.All = append(listener.EventMatcher.All, settledEventDeliverySkill)
	listener.Operations = listener.Operations[:1]
	listener.Operations[0].Amount = authoringAmount(authoringBinary("div",
		authoringBinary("mul", authoringRead("event.damage.mitigatedAmount"), authoringConst(18)), authoringConst(100)))
	c.Combatants[0].Resources, r.InitialSnapshot.Combatants[0].Resources = nil, nil
	settledEventHealMixedVamp(&c, &r, 0, 0)
	return c, r
}

func settledEventHealMixedVamp(c *model.CompileRequest, r *model.RunRequest, lifeSteal, omni float64) {
	ensureC1CatalogTypes(c, model.TypeCatalogEntry{Key: "life_steal_percent", Domain: "attribute"}, model.TypeCatalogEntry{Key: "omnivamp_percent", Domain: "attribute"})
	setCombatantAttr(c, r, "source", "life_steal_percent", authoringSlot(lifeSteal))
	setCombatantAttr(c, r, "source", "omnivamp_percent", authoringSlot(omni))
	for i := range c.Combatants {
		c.Combatants[i].Types = []string{"combatant/champion"}
	}
	efficiency := 1.0
	c.Rules.VampRules = []model.VampRuleDefinition{
		{VampType: model.VampLifeSteal, SourceAttributeKey: "life_steal_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: &efficiency,
			TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, DamageMatcher: model.TypeMatcher{All: []string{receivedDeliveryBasic}}, AbilityMatcher: model.TypeMatcher{All: []string{model.AbilityTypeBasicAttack}}},
		{VampType: model.VampOmnivamp, SourceAttributeKey: "omnivamp_percent", BasisOutputKind: model.VampPostDefense, DefaultEfficiency: &efficiency,
			TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}}, DamageMatcher: model.TypeMatcher{Any: []string{receivedDeliveryBasic, settledEventDeliverySkill}}, AbilityMatcher: model.TypeMatcher{Any: []string{model.AbilityTypeBasicAttack, "ability/spell"}}},
	}
	for i := range c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates {
		for j := range c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[i].Operations {
			op := &c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[i].Operations[j]
			if op.Operation == "damage" {
				op.Types, op.VampQualification = []string{receivedDeliveryBasic, receivedOriginDirect}, model.VampResolved
			}
		}
	}
}

func TestSettledEventSelfHealEachPacketKeepsBackgroundVampAndReplay(t *testing.T) {
	c, r := settledEventHealMixedInput()
	settledEventHealMixedVamp(&c, &r, .1, .2)
	spell := &c.SharedProviders[1]
	op := spell.Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0]
	spell.Abilities = spell.Abilities[:1]
	spell.Processes[0].Steps[0].StepType = "DELAY"
	spell.Processes[0].Steps[0].DelayMs = timedShieldExpr(500)
	spell.Processes[0].MomentOperations = []model.ProcessMomentOperations{
		{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{op}},
		{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{op}},
	}
	c.Rules.SkillActionBindings[0].HitBindings = nil
	r.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	compiled := authoringCompile(t, c)
	r.ExpectedRulesHash = compiled.RulesHash
	done, err := RunGeneric(compiled, r)
	if err != nil {
		t.Fatal(err)
	}
	heals, vamps := recoveryEvidence(done, model.EvidenceKindHeal), vampEvents(done)
	if len(done.DamageRecords) != 3 || len(heals) != 2 || len(vamps) != 3 || done.Summary.BasicAttack.CompletedCount != 1 || done.Summary.SourceFinalHp != 591 || done.Summary.TargetFinalHp != 750 {
		t.Fatal("F1: 50 BAA + 100 + 100, vamp 55, direct 36", done.Summary, heals, vamps)
	}
	for i, hp := range []float64{553, 591} {
		vampAmount(t, heals[i].Data, "healingBeforeModifiers", 18)
		vampAmount(t, heals[i].Data, "hpAfter", hp)
		assertRecoveryProvenance(t, heals[i], "restore_hp", "skill:spell_first")
	}
	for i, vamp := range vamps {
		contributions := vamp.Data["contributions"].([]map[string]interface{})
		wantCount := 1
		if i == 0 {
			wantCount = 2
		}
		if len(contributions) != wantCount {
			t.Fatal("ordinary vamp qualifications changed", contributions)
		}
		for _, contribution := range contributions {
			basis, ratio, amount := 100.0, .2, 20.0
			if i == 0 {
				basis, amount = 50, 10
			}
			if contribution["vampType"] == model.VampLifeSteal {
				if i != 0 {
					t.Fatal("spell borrowed life steal", contribution)
				}
				ratio, amount = .1, 5
			} else if contribution["vampType"] != model.VampOmnivamp {
				t.Fatal("unknown vamp contribution", contribution)
			}
			for key, want := range map[string]float64{"basis": basis, "ratio": ratio, "efficiency": 1, "amount": amount} {
				vampAmount(t, contribution, key, want)
			}
		}
	}
	if heals[0].TimeMs != 250 || heals[1].TimeMs != 750 || len(emittedEventsByRef(done, eventTypeDamageInstance)) != 3 {
		t.Fatal("same use packets were merged or healing recursively emitted damage", heals)
	}
	if repeated, err := RunGeneric(compiled, r); err != nil || !reflect.DeepEqual(done, repeated) {
		t.Fatal("same session replay changed", err)
	}
}

func TestSettledEventSelfHealFrozenNumericBoundaries(t *testing.T) {
	for _, mode := range []string{"shield", "lethal_overkill", "full_health", "post_defense_multiplier", "zero", "positive_zero", "miss", "spell_shield"} {
		t.Run(mode, func(t *testing.T) {
			c, r := settledEventHealMixedInput()
			setCombatantAttr(&c, &r, "source", "attack_damage", authoringSlot(10))
			wantSource, wantTarget, wantRaw, wantActual, wantOverflow, wantHeals := 518.0, 890.0, 18.0, 18.0, 0.0, 1
			spell := &c.SharedProviders[1].Abilities[1].Operations[0].SkillHit.Candidates[0]
			switch mode {
			case "shield":
				setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 995, Max: 1000, Resolved: 1000})
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
				addPureInitializedShield(&c, &r, "target", "direct", 110)
				wantSource, wantTarget, wantActual, wantOverflow = 1000, 1000, 5, 13
			case "lethal_overkill":
				setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 60, Max: 1000, Resolved: 1000})
				settledEventHealMixedVamp(&c, &r, 0, .2)
				wantSource, wantTarget = 540, 0
			case "full_health":
				setCombatantAttr(&c, &r, "source", "hp", authoringSlot(1000))
				wantSource, wantActual, wantOverflow = 1000, 0, 18
			case "post_defense_multiplier":
				spell.Operations[0].Amount = timedShieldExpr(120)
				c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "half_magic", Kind: "status", StableID: "half_magic", Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(1000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: "source_target"},
					Modifiers: []model.ModifierDefinition{{ModifierKey: "half_magic", Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "incoming_post_mitigation", Bucket: "all_instances", ValuePolicy: "multiply", Value: authoringConst(.5), Condition: authoringAmount(authoringRead("damage.type.damage/magic"))}}})
				c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "half_magic"}}}}
				wantSource, wantTarget, wantRaw, wantActual = 505.4, 960, 5.4, 5.4
			case "zero", "positive_zero":
				spell.Operations[0].Amount = timedShieldExpr(0)
				wantSource, wantTarget, wantRaw, wantActual = 500, 990, 0, 0
				if mode == "positive_zero" {
					c.SharedProviders[2].Abilities[0].ListenerSpec.Condition = authoringAmount(authoringBinary("gt", authoringRead("event.damage.mitigatedAmount"), authoringConst(0)))
					wantHeals = 0
				}
			case "miss":
				r.DriverPlan.SkillActions[0].HitBindings[0].Preset = "MISS"
				wantSource, wantTarget, wantHeals = 500, 990, 0
			case "spell_shield":
				skillHitCatalog(&c)
				spell.SpellShieldBlockScope = hitScope(model.SpellShieldScopeResult)
				p := spellShieldProvider()
				p.Listeners = nil
				c.SharedProviders = append(c.SharedProviders, p)
				c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: p.ProviderKey}}}}
				wantSource, wantTarget, wantHeals = 500, 990, 0
			}
			done := authoringRun(t, c, r)
			heals := recoveryEvidence(done, model.EvidenceKindHeal)
			vampNear(t, "source HP", done.Summary.SourceFinalHp, wantSource)
			vampNear(t, "target HP", done.Summary.TargetFinalHp, wantTarget)
			if len(heals) != wantHeals || done.Summary.BasicAttack.CompletedCount != 1 || len(recoveryEvidence(done, "resource_restore")) != 0 {
				t.Fatal("wrong heal count/background/resource", done.Summary, heals)
			}
			if wantHeals == 1 {
				for key, want := range map[string]float64{"healingBeforeModifiers": wantRaw, "actualHealing": wantActual, "overheal": wantOverflow} {
					vampAmount(t, heals[0].Data, key, want)
				}
			}
			if mode == "lethal_overkill" && (done.Summary.DurationMs != 250 || done.Summary.StopReason != model.StopReasonTargetDead) {
				t.Fatal("kill stopped before self heal", done.Summary)
			}
			if mode == "post_defense_multiplier" {
				instances := emittedEventsByRef(done, eventTypeDamageInstance)
				vampAmount(t, instances[1].Data["damage"].(map[string]interface{}), "mitigatedAmount", 30)
			}
			wantDamageRecords := 2
			if mode == "miss" || mode == "spell_shield" {
				wantDamageRecords = 1
			}
			if len(done.DamageRecords) != wantDamageRecords || len(emittedEventsByRef(done, eventTypeDamageInstance)) != wantDamageRecords {
				t.Fatal("zero, block and actual damage facts were conflated", done.DamageRecords)
			}
		})
	}
}

func TestSettledEventSelfHealRejectsForeignAndNonProportionalShapes(t *testing.T) {
	modes := []string{"negative", "event_divisor", "zero_divisor", "event_squared", "offset", "other_event", "actual_hp_loss", "source_attribute", "target_attribute", "resource_read", "provider_read", "missing_parameter", "nan_parameter", "infinite_parameter", "hidden_illegal_branch", "wrong_owner", "no_owner_filter", "received", "unsettled", "resource_restore", "mixed", "once", "temporary", "foreign_mount", "extra_trigger", "operation_condition"}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			c, r := settledEventHealMixedInput()
			ability := &c.SharedProviders[2].Abilities[0]
			listener := ability.ListenerSpec
			op := &listener.Operations[0]
			read := authoringRead("event.damage.mitigatedAmount")
			var expression model.GenericFormulaExpr
			changeExpression, compileMayReject := true, false
			switch mode {
			case "negative":
				expression = authoringBinary("max", authoringConst(0), authoringBinary("mul", read, authoringConst(-.18)))
			case "event_divisor":
				expression = authoringBinary("div", authoringConst(18), read)
			case "zero_divisor":
				expression = authoringBinary("div", read, authoringConst(0))
			case "event_squared":
				expression = authoringBinary("mul", read, read)
			case "offset":
				expression = authoringBinary("add", read, authoringConst(1))
			case "other_event":
				expression = authoringRead("event.damage.preMitigationAmount")
			case "actual_hp_loss":
				expression = authoringRead("event.damage.actualHpLoss")
				compileMayReject = true
			case "source_attribute":
				expression = authoringBinary("mul", read, authoringRead("source.attr.hp.current"))
			case "target_attribute":
				expression = authoringBinary("mul", read, authoringRead("target.attr.hp.current"))
			case "resource_read":
				expression = authoringBinary("mul", read, authoringRead("source.resource.mana.current"))
			case "provider_read":
				expression = authoringBinary("mul", read, authoringRead("provider.state.extra"))
			case "missing_parameter", "nan_parameter", "infinite_parameter":
				expression = authoringBinary("mul", read, authoringRead("ability.param.factor"))
				if mode != "missing_parameter" {
					value := math.NaN()
					if mode == "infinite_parameter" {
						value = math.Inf(1)
					}
					ability.Params = map[string]float64{"factor": value}
					compileMayReject = true
				}
			case "hidden_illegal_branch":
				expression = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(0), authoringRead("target.attr.hp.current"), authoringBinary("mul", read, authoringConst(.18))}}
			default:
				changeExpression = false
				switch mode {
				case "no_owner_filter":
					listener.EventMatcher.All = []string{eventTypeDamageInstance}
				case "received":
					listener.EventMatcher.All = []string{model.EventTypeDamageTaken, "event/target_owner"}
				case "unsettled":
					ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeBasicAttackHit, Domain: "event"})
					listener.EventMatcher.All = []string{model.EventTypeBasicAttackHit, "event/source_owner"}
				case "resource_restore":
					op.Operation, op.ResourceKey = "resource_change", "mana"
				case "mixed":
					listener.Operations = append(listener.Operations, model.OperationDefinition{Operation: "heal", Target: "self", Amount: timedShieldExpr(1)})
				case "once":
					listener.OncePerUse = &model.OncePerUseLimit{GroupKey: "one", Scope: model.OncePerUseScopeProvider}
				case "temporary":
					c.SharedProviders[2].Lifecycle = &model.ProviderLifecycle{DurationMs: timedShieldExpr(1000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: "source_target"}
				case "foreign_mount":
					r.InitialSnapshot.Combatants[0].Providers[2].ProviderRef = "foreign"
				case "extra_trigger":
					listener.MaxTriggersPerEvent = 2
				case "operation_condition":
					op.Condition = authoringAmount(authoringConst(1))
				}
			}
			if changeExpression {
				op.Amount = authoringAmount(expression)
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				if compileMayReject {
					return
				}
				t.Fatal("fixture did not reach runtime admission", compiled.Result.Errors)
			}
			if mode == "wrong_owner" {
				for i := range compiled.Session.Operations {
					if compiled.Session.Operations[i].Ref == "restore_hp" {
						compiled.Session.Operations[i].OwnerProviderIndex = 0
					}
				}
			}
			if _, err := RunGeneric(compiled.Session, r); err == nil || err.BudgetCause != "" {
				t.Fatal("illegal event heal admitted or disguised as budget failure", err)
			}
		})
	}
}

func TestSettledEventSelfHealStaticCoefficientReferencesAndZero(t *testing.T) {
	for _, mode := range []string{"coefficient_left", "ability_parameter", "static_named", "zero_coefficient", "unbound_author_provenance_only"} {
		t.Run(mode, func(t *testing.T) {
			c, r := settledEventHealMixedInput()
			ability := &c.SharedProviders[2].Abilities[0]
			event := authoringRead("event.damage.mitigatedAmount")
			expression := authoringBinary("mul", authoringConst(.18), event)
			want := 18.0
			switch mode {
			case "ability_parameter":
				ability.Params = map[string]float64{"percent": 18}
				expression = authoringBinary("max", authoringBinary("div", authoringBinary("mul", event, authoringRead("ability.param.percent")), authoringConst(100)), authoringConst(0))
			case "static_named":
				c.Formulas = append(c.Formulas, formuladefinition.FromExpr("recovery/static_ratio", "recovery_skill", authoringBinary("div", authoringConst(18), authoringConst(100)), nil))
				expression = authoringBinary("mul", event, model.GenericFormulaExpr{Op: "ref", Ref: "recovery/static_ratio"})
			case "zero_coefficient":
				expression = authoringBinary("mul", event, authoringConst(0))
				want = 0
			case "unbound_author_provenance_only":
				c.Formulas = append(c.Formulas, model.NamedFormula{Key: "recovery/original_event_amount", Scope: "skill", SkillKey: "recovery_skill",
					Parameters: []model.FormulaParameter{{ParameterKey: "settled_damage", ValueMode: "RUNTIME_INPUT", ValueType: "DECIMAL"}},
					Expression: formuladefinition.Definition([]any{map[string]any{"key": "damage", "binding": map[string]any{"kind": "parameter", "skillKey": "recovery_skill", "parameterKey": "settled_damage"}}},
						[]any{formuladefinition.Stage("amount", map[string]any{"op": "mul", "args": []any{map[string]any{"op": "read", "inputKey": "damage"}, formuladefinition.Const(.18)}})}, "amount")})
			}
			ability.ListenerSpec.Operations[0].Amount = authoringAmount(expression)
			done := authoringRun(t, c, r)
			heals := recoveryEvidence(done, model.EvidenceKindHeal)
			if len(heals) != 1 {
				t.Fatal("missing amount record", heals)
			}
			vampAmount(t, heals[0].Data, "healingBeforeModifiers", want)
			vampNear(t, "source", done.Summary.SourceFinalHp, 500+want)
		})
	}
}

func TestSettledEventSelfHealRuntimeMissingSnapshotAndOverflowKeepCommittedDamage(t *testing.T) {
	for _, mode := range []string{"missing_snapshot", "overflow"} {
		t.Run(mode, func(t *testing.T) {
			c, r := settledEventHealMixedInput()
			if mode == "overflow" {
				c.SharedProviders[2].Abilities[0].ListenerSpec.Operations[0].Amount = authoringAmount(authoringBinary("mul", authoringRead("event.damage.mitigatedAmount"), authoringConst(math.MaxFloat64)))
			}
			s := frameCommitState(t, c, r)
			err := s.runLoop()
			wantHp, wantHeals := 500.0, 0
			if mode == "missing_snapshot" {
				if err != nil {
					t.Fatal(err)
				}
				wantHp, wantHeals = 518, 1
				err = s.dispatchListeners(emittedEvent{eventType: eventTypeDamageInstance, sourceKey: "source", targetKey: "target", types: []string{eventTypeDamageInstance, settledEventDeliverySkill}}, 0)
			}
			done := s.buildDoneResult()
			if err == nil || err.BudgetCause != "" || s.combatantHp("source") != wantHp || s.combatantHp("target") != 850 || s.sourceDamageDealt != 150 || len(recoveryEvidence(done, model.EvidenceKindHeal)) != wantHeals || len(done.DamageRecords) != 2 {
				t.Fatal("event amount failure borrowed old snapshot, leaked heal, or undid committed damage", err, done.Summary)
			}
		})
	}
}

func TestSettledEventSelfHealActualOwnerAndNoRevive(t *testing.T) {
	for _, mode := range []string{"other_owner", "dead_owner"} {
		t.Run(mode, func(t *testing.T) {
			c, r := settledEventHealMixedInput()
			wantSource, wantTarget := 500.0, 850.0
			if mode == "other_owner" {
				mount := c.Combatants[0].Providers[2]
				c.Combatants[0].Providers = c.Combatants[0].Providers[:2]
				c.Combatants[1].Providers = append(c.Combatants[1].Providers, mount)
				r.InitialSnapshot.Combatants[0].Providers = r.InitialSnapshot.Combatants[0].Providers[:2]
				r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: mount.ProviderRef, DefinitionRef: mount.DefinitionRef, Owner: "target", Source: "target", Stacks: 1})
			} else {
				setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 1000})
				setCombatantAttr(&c, &r, "source", "magic_resist", authoringSlot(0))
				c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "damage", Target: "self", Ref: "recoil", DamageType: "damage/magic", Amount: timedShieldExpr(300), Types: []string{settledEventDeliverySkill, receivedOriginDirect}, VampQualification: model.VampResolved}}}}
				wantSource, wantTarget = 0, 950
			}
			done := authoringRun(t, c, r)
			if done.Summary.SourceFinalHp != wantSource || done.Summary.TargetFinalHp != wantTarget || len(recoveryEvidence(done, model.EvidenceKindHeal)) != 0 {
				t.Fatal("borrowed the other owner's event or revived a dead owner", done.Summary)
			}
		})
	}
}
