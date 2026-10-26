// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func killedBasicAttackRecoveryInput(kind string, targetHP, damage float64) (model.CompileRequest, model.RunRequest) {
	c, r := continuousAttackInput(1, targetHP, damage, 0, 0, 1)
	addKilledRecovery(&c, &r, 0, "event/damage_instance")
	c.SharedProviders[1].Kind = kind
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000})
	// Selected authoring values remain independent named programs; admission
	// must establish that their actual dependencies are static.
	c.Formulas = append(c.Formulas,
		formuladefinition.FromExpr("recovery/hp_static", "recovery_skill", authoringBinary("add", authoringConst(18), authoringBinary("mul", authoringConst(2), authoringConst(11))), nil),
		formuladefinition.FromExpr("recovery/mana_static", "recovery_skill", authoringBinary("add", authoringConst(4), authoringConst(8)), nil))
	operations := c.SharedProviders[1].Abilities[0].ListenerSpec.Operations
	operations[0].Amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "recovery/hp_static"})
	operations[1].Amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: "recovery/mana_static"})
	return c, r
}

func TestKilledBasicAttackRecoveryAdmitsPermanentSourceAndFinishesTail(t *testing.T) {
	for _, kind := range []string{"character", "build"} {
		for _, mode := range []string{"lethal", "overkill", "nonlethal", "zero_damage", "zero_resource", "clipped", "postlethal_zero"} {
			t.Run(kind+"/"+mode, func(t *testing.T) {
				c, r := killedBasicAttackRecoveryInput(kind, 100, 100)
				wantBeforeHP, wantBeforeMana := float64(500), float64(1)
				wantHealing, wantMana := float64(40), float64(12)
				wantHPOverflow, wantManaOverflow := float64(0), float64(0)
				wantPackets := 1
				switch mode {
				case "overkill":
					setCombatantAttr(&c, &r, "target", "hp", authoringSlot(80))
				case "nonlethal":
					setCombatantAttr(&c, &r, "target", "hp", authoringSlot(101))
					wantHealing, wantMana = 0, 0
				case "zero_damage":
					setCombatantAttr(&c, &r, "source", "attack_damage", authoringSlot(0))
					wantHealing, wantMana = 0, 0
				case "zero_resource":
					wantBeforeMana = 0
					c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 0, Max: 50}
				case "clipped":
					wantBeforeHP, wantBeforeMana = 990, 45
					wantHealing, wantMana, wantHPOverflow, wantManaOverflow = 10, 5, 30, 7
					setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 990, Max: 1000, Resolved: 1000})
					c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 45, Max: 50}
				case "postlethal_zero":
					plan := c.SharedProviders[0].Abilities[2].Operations[0].SkillHit
					zero := plan.Candidates[0]
					zero.CandidateKey, zero.EffectOccurrenceKey, zero.EffectKey, zero.ResultKey = "late_zero", "late_zero", "late_zero", "late_zero"
					zero.Operations = []model.OperationDefinition{{Operation: "damage", Target: "target", DamageType: "damage/physics", Ref: "late_zero", Amount: timedShieldExpr(0)}}
					plan.Candidates = append(plan.Candidates, zero)
					wantPackets = 2
				}
				done := authoringRun(t, c, r)
				if done.Summary.BasicAttack == nil || done.Summary.BasicAttack.StartedCount != 1 || done.Summary.BasicAttack.CompletedCount != 1 || !done.Summary.Execution.Complete || done.Summary.SourceFinalHp != wantBeforeHP+wantHealing || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != wantBeforeMana+wantMana || len(done.AttackRecords) != 1 {
					t.Fatal("real background attack admission or synchronous recovery failed", done.Summary, done.FinalSnapshot, done.AttackRecords)
				}
				packets := emittedEventsByRef(done, "event/damage_instance")
				if len(packets) != wantPackets || done.AttackRecords[0].UseRef == "" {
					t.Fatal("missing actual attack packet or use", packets, done.AttackRecords)
				}
				use := done.AttackRecords[0].UseRef
				for index, packet := range packets {
					wantKilled := float64(0)
					if wantHealing > 0 && index == 0 {
						wantKilled = 1
					}
					if packet.Data["useRef"] != use || packet.Data["damage"].(map[string]interface{})["killed"] != wantKilled {
						t.Fatal("background attack lost real per-packet identity", packets, use)
					}
				}
				heals, restores := recoveryEvidence(done, model.EvidenceKindHeal), recoveryEvidence(done, "resource_restore")
				if wantHealing == 0 {
					if len(heals) != 0 || len(restores) != 0 {
						t.Fatal("nonlethal background attack recovered", heals, restores)
					}
					return
				}
				if len(heals) != 1 || len(restores) != 1 || heals[0].TimeMs != 0 || restores[0].TimeMs != 0 || done.Summary.StopReason != model.StopReasonTargetDead || done.Summary.DurationMs != 0 {
					t.Fatal("kill stopped before ordinary recovery tail", done.Summary, heals, restores)
				}
				assertRecoveryProvenance(t, heals[0], "restore_hp", use)
				assertRecoveryProvenance(t, restores[0], "restore_mana", use)
				for key, want := range map[string]float64{"healingBeforeModifiers": 40, "actualHealing": wantHealing, "overheal": wantHPOverflow, "hpBefore": wantBeforeHP, "hpAfter": wantBeforeHP + wantHealing} {
					vampAmount(t, heals[0].Data, key, want)
				}
				for key, want := range map[string]float64{"requestedAmount": 12, "actualDelta": wantMana, "overflow": wantManaOverflow, "currentBefore": wantBeforeMana, "currentAfter": wantBeforeMana + wantMana} {
					vampAmount(t, restores[0].Data, key, want)
				}
				if repeated := authoringRun(t, c, r); !reflect.DeepEqual(done, repeated) {
					t.Fatal("fresh background-attack runs retained recovery state")
				}
			})
		}
	}
}

func TestKilledBasicAttackRecoveryTakenUsesActualReceiverAndDeathGate(t *testing.T) {
	for _, lethal := range []bool{false, true} {
		t.Run(map[bool]string{false: "live_receiver", true: "dead_receiver"}[lethal], func(t *testing.T) {
			c, r := continuousAttackInput(1, 200, 100, 0, 0, 1)
			addKilledRecovery(&c, &r, 1, model.EventTypeDamageTaken)
			wantHP, wantMana := float64(140), float64(13)
			c.SharedProviders[1].Abilities[0].ListenerSpec.Condition = authoringAmount(authoringBinary("eq", authoringRead("event.damage.killed"), authoringConst(0)))
			if lethal {
				setCombatantAttr(&c, &r, "target", "hp", authoringSlot(100))
				c.SharedProviders[1].Abilities[0].ListenerSpec.Condition = killedCondition()
				wantHP, wantMana = 0, 1
			}
			done := authoringRun(t, c, r)
			if done.Summary.BasicAttack.CompletedCount != 1 || done.Summary.TargetFinalHp != wantHP || done.FinalSnapshot.Combatants[1].Resources["mana"].Current != wantMana {
				t.Fatal("taken recovery confused the receiver with the attacker", done.Summary, done.FinalSnapshot)
			}
			heals, restores := recoveryEvidence(done, model.EvidenceKindHeal), recoveryEvidence(done, "resource_restore")
			if lethal {
				if len(heals)+len(restores) != 0 {
					t.Fatal("dead receiver published recovery", heals, restores)
				}
				return
			}
			if len(heals) != 1 || len(restores) != 1 {
				t.Fatal("live actual receiver did not recover", heals, restores)
			}
			for _, item := range []model.EvidenceItem{heals[0], restores[0]} {
				if item.Data["owner"] != "target" || item.Data["source"] != "target" || item.Data["target"] != "target" || item.Data["providerRef"] != "original_recovery_mount" || item.Data["providerDefinitionRef"] != "recovery_definition" || item.Data["abilityRef"] != "target.provider[original_recovery_mount].ability[ordinary_recovery]" || item.Data["useRef"] != done.AttackRecords[0].UseRef {
					t.Fatal("actual receiver recovery lost original causal use or mount", item)
				}
			}
		})
	}
}

func TestKilledBasicAttackRecoveryRejectsUnownedUnsettledOrIncompleteInputs(t *testing.T) {
	for _, mode := range []string{"wrong_target", "any_only", "no_owner_filter", "wrong_relation", "aggregate", "unsettled", "negative", "dynamic", "missing_resource", "hp_resource", "zero_max", "negative_current", "over_max", "infinite_max", "nan_current", "incomplete_listener", "temporary_provider", "foreign_mount", "wrong_owner_index", "invalid_owner_index", "missing_amount", "missing_program"} {
		t.Run(mode, func(t *testing.T) {
			c, r := killedBasicAttackRecoveryInput("character", 100, 100)
			listener := c.SharedProviders[1].Abilities[0].ListenerSpec
			switch mode {
			case "wrong_target":
				listener.Operations[1].Target = "target"
			case "any_only":
				listener.Condition = nil
				listener.EventMatcher = model.TypeMatcher{All: []string{"event/source_owner"}, Any: []string{"event/damage_instance"}}
			case "no_owner_filter":
				listener.EventMatcher.All = []string{"event/damage_instance"}
			case "wrong_relation":
				listener.EventMatcher.All = []string{"event/damage_instance", "event/target_owner"}
			case "aggregate", "unsettled":
				event := "event/damage_dealt"
				if mode == "unsettled" {
					event = model.EventTypeBasicAttackHit
				}
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: event, Domain: "event"})
				listener.Condition = nil
				listener.EventMatcher.All = []string{event, "event/source_owner"}
			case "negative":
				listener.Operations[1].Amount = timedShieldExpr(-1)
			case "dynamic":
				listener.Operations[1].Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "missing_resource":
				delete(c.Combatants[0].Resources, "mana")
			case "hp_resource":
				listener.Operations[1].ResourceKey = "hp"
				c.Combatants[0].Resources["hp"] = model.ResourceSlotDef{Current: 1, Max: 50}
			case "zero_max", "negative_current", "over_max", "infinite_max", "nan_current":
				slot := c.Combatants[0].Resources["mana"]
				switch mode {
				case "zero_max":
					slot.Max = 0
				case "negative_current":
					slot.Current = -1
				case "over_max":
					slot.Current = 51
				case "infinite_max":
					slot.Max = math.Inf(1)
				case "nan_current":
					slot.Current = math.NaN()
				}
				c.Combatants[0].Resources["mana"] = slot
			case "incomplete_listener":
				listener.MaxTriggersPerEvent = 2
			case "temporary_provider":
				c.SharedProviders[1].Lifecycle = &model.ProviderLifecycle{DurationMs: timedShieldExpr(100)}
			case "foreign_mount":
				r.InitialSnapshot.Combatants[0].Providers[1].ProviderRef = "foreign_mount"
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				if mode != "wrong_target" {
					t.Fatal("negative fixture did not reach real BasicAttack runtime admission", mode, compiled.Result.Errors)
				}
				return
			}
			for index := range compiled.Session.Operations {
				operation := &compiled.Session.Operations[index]
				if operation.Ref != "restore_mana" {
					continue
				}
				switch mode {
				case "wrong_owner_index":
					operation.OwnerProviderIndex = 0
				case "invalid_owner_index":
					operation.OwnerProviderIndex = len(compiled.Session.Providers) + 1
				case "missing_amount":
					operation.HasAmount = false
				case "missing_program":
					operation.AmountProgram = formula.GenericProgramID(len(compiled.Session.Formulas.Programs) + 1)
				}
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil || err.BudgetCause != "" {
				t.Fatal("invalid ordinary recovery admitted or misclassified as budget", mode, err)
			}
		})
	}
}

func killedBasicAttackParameterRecoveryInput() (model.CompileRequest, model.RunRequest) {
	c, r := killedBasicAttackRecoveryInput("character", 100, 100)
	ability := &c.SharedProviders[1].Abilities[0]
	ability.Params = map[string]float64{"health_restore_on_kill": 52, "mana_restore_on_kill": 9.48}
	for index, key := range []string{"health_restore_on_kill", "mana_restore_on_kill"} {
		ability.ListenerSpec.Operations[index].Amount = authoringAmount(authoringBinary("max", authoringRead("ability.param."+key), authoringConst(0)))
	}
	return c, r
}

func TestKilledBasicAttackRecoveryUsesActualCompiledAbilityParameters(t *testing.T) {
	for _, mode := range []string{"selected_values", "zero_values", "clipped", "static_reference_and_parameters", "both_owner_mounts"} {
		t.Run(mode, func(t *testing.T) {
			c, r := killedBasicAttackParameterRecoveryInput()
			wantHPBefore, wantManaBefore := float64(500), float64(1)
			requestedHP, requestedMana := float64(52), float64(9.48)
			actualHP, actualMana := requestedHP, requestedMana
			switch mode {
			case "zero_values":
				c.SharedProviders[1].Abilities[0].Params = map[string]float64{"health_restore_on_kill": 0, "mana_restore_on_kill": 0}
				requestedHP, requestedMana, actualHP, actualMana = 0, 0, 0, 0
			case "clipped":
				wantHPBefore, wantManaBefore, actualHP, actualMana = 990, 45, 10, 5
				setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 990, Max: 1000, Resolved: 1000})
				c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 45, Max: 50}
			case "static_reference_and_parameters":
				amount := &c.SharedProviders[1].Abilities[0].ListenerSpec.Operations[1].Amount
				*amount = authoringAmount(authoringBinary("add", **amount, model.GenericFormulaExpr{Op: "ref", Ref: "recovery/mana_static"}))
				requestedMana, actualMana = 21.48, 21.48
			case "both_owner_mounts":
				c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "opposite_recovery_mount", DefinitionRef: "recovery_definition"})
				r.InitialSnapshot.Combatants[1].Providers = append(r.InitialSnapshot.Combatants[1].Providers, model.CombatantProviderSnapshot{ProviderRef: "opposite_recovery_mount", DefinitionRef: "recovery_definition", Owner: "target", Source: "target", Stacks: 1})
				c.Combatants[1].Resources = map[string]model.ResourceSlotDef{"mana": {Current: 1, Max: 50}}
				r.InitialSnapshot.Combatants[1].Resources = c.Combatants[1].Resources
			}
			done := authoringRun(t, c, r)
			if done.Summary.BasicAttack.CompletedCount != 1 || done.Summary.StopReason != model.StopReasonTargetDead || done.Summary.SourceFinalHp != wantHPBefore+actualHP || math.Abs(done.FinalSnapshot.Combatants[0].Resources["mana"].Current-wantManaBefore-actualMana) > 1e-9 {
				t.Fatal("real compiled listener parameters were not admitted or used", mode, done.Summary, done.FinalSnapshot)
			}
			heals, restores := recoveryEvidence(done, model.EvidenceKindHeal), recoveryEvidence(done, "resource_restore")
			if len(heals) != 1 || len(restores) != 1 {
				t.Fatal("parameter-based recovery published the wrong complete list", heals, restores)
			}
			assertRecoveryProvenance(t, heals[0], "restore_hp", done.AttackRecords[0].UseRef)
			assertRecoveryProvenance(t, restores[0], "restore_mana", done.AttackRecords[0].UseRef)
			for key, want := range map[string]float64{"healingBeforeModifiers": requestedHP, "actualHealing": actualHP, "overheal": requestedHP - actualHP, "hpBefore": wantHPBefore, "hpAfter": wantHPBefore + actualHP} {
				vampAmount(t, heals[0].Data, key, want)
			}
			for key, want := range map[string]float64{"requestedAmount": requestedMana, "actualDelta": actualMana, "overflow": requestedMana - actualMana, "currentBefore": wantManaBefore, "currentAfter": wantManaBefore + actualMana} {
				vampAmount(t, restores[0].Data, key, want)
			}
			if mode == "both_owner_mounts" && done.FinalSnapshot.Combatants[1].Resources["mana"].Current != 1 {
				t.Fatal("foreign owner's same parameter keys authorized recovery", done.FinalSnapshot)
			}
		})
	}
}

func TestKilledBasicAttackRecoveryRejectsMissingForeignOrRuntimeParameterReads(t *testing.T) {
	for _, mode := range []string{"missing_parameter", "foreign_parameter_map", "nan_parameter", "infinite_parameter", "negative_amount", "missing_source_ability", "foreign_source_ability", "out_of_range_source_ability", "foreign_provider_index", "unselected_missing_parameter", "unselected_attribute", "unselected_resource", "unselected_event", "authored_runtime_parameter"} {
		t.Run(mode, func(t *testing.T) {
			c, r := killedBasicAttackParameterRecoveryInput()
			ability := &c.SharedProviders[1].Abilities[0]
			amount := &ability.ListenerSpec.Operations[1].Amount
			switch mode {
			case "missing_parameter":
				delete(ability.Params, "mana_restore_on_kill")
			case "foreign_parameter_map":
				delete(ability.Params, "mana_restore_on_kill")
				c.SharedProviders[0].Abilities[0].Params = map[string]float64{"mana_restore_on_kill": 9.48}
			case "nan_parameter":
				ability.Params["mana_restore_on_kill"] = math.NaN()
			case "infinite_parameter":
				ability.Params["mana_restore_on_kill"] = math.Inf(1)
			case "negative_amount":
				ability.Params["mana_restore_on_kill"] = -1
				*amount = authoringAmount(authoringRead("ability.param.mana_restore_on_kill"))
			case "unselected_missing_parameter", "unselected_attribute", "unselected_resource", "unselected_event":
				path := map[string]string{"unselected_missing_parameter": "ability.param.missing", "unselected_attribute": "source.attr.hp.current", "unselected_resource": "source.resource.mana.current", "unselected_event": "event.damage.baseRawAmount"}[mode]
				*amount = authoringAmount(model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(0), authoringRead(path), **amount}})
			case "authored_runtime_parameter":
				definition := formuladefinition.FromExpr("recovery/runtime_parameter", "recovery_skill", authoringRead("ability.param.mana_restore_on_kill"), nil)
				definition.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "ability_parameter"}
				c.Formulas = append(c.Formulas, definition)
				*amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: definition.Key})
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				t.Fatal("parameter negative fixture did not reach real BasicAttack admission", mode, compiled.Result.Errors)
			}
			for index := range compiled.Session.Listeners {
				listener := &compiled.Session.Listeners[index]
				if listener.ListenerKey != "ordinary_recovery" {
					continue
				}
				switch mode {
				case "missing_source_ability":
					listener.SourceAbilityIndex = -1
				case "foreign_source_ability":
					listener.SourceAbilityIndex = 0
				case "out_of_range_source_ability":
					listener.SourceAbilityIndex = len(compiled.Session.Abilities)
				case "foreign_provider_index":
					compiled.Session.Abilities[listener.SourceAbilityIndex].ProviderIndex = 0
				}
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil || err.BudgetCause != "" {
				t.Fatal("missing, foreign or runtime context was used as a static recovery value", mode, err)
			}
		})
	}
}
