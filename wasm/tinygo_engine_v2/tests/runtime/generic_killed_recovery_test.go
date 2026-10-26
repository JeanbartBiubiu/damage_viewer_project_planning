// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

const recoveryAbilityRef = "source.provider[original_recovery_mount].ability[ordinary_recovery]"

func killedCondition() *model.GenericFormulaExpr {
	return authoringAmount(authoringBinary("eq", authoringRead("event.damage.killed"), authoringConst(1)))
}

func addKilledRecovery(c *model.CompileRequest, r *model.RunRequest, actor int, event string) {
	ensureC1CatalogTypes(c,
		model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"},
		model.TypeCatalogEntry{Key: model.EventTypeDamageTaken, Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_owner", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/target_owner", Domain: "event"})
	owner := c.Combatants[actor].Key
	filter := "event/source_owner"
	if actor == 1 {
		filter = "event/target_owner"
	}
	p := model.ProviderDefinition{ProviderKey: "recovery_definition", StableID: "recovery_definition", SkillKey: "recovery_skill", Kind: "character",
		Abilities: []model.AbilityDefinition{{AbilityKey: "ordinary_recovery", Kind: "passive_listener", SkillKey: "recovery_skill",
			ListenerSpec: &model.ListenerDefinition{ListenerKey: "ordinary_recovery", EventMatcher: model.TypeMatcher{All: []string{event, filter}}, Condition: killedCondition(),
				Operations: []model.OperationDefinition{
					{Operation: "heal", Target: "self", Amount: timedShieldExpr(40), Ref: "restore_hp"},
					{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: timedShieldExpr(12), Ref: "restore_mana"},
				}}}}}
	c.SharedProviders = append(c.SharedProviders, p)
	c.Combatants[actor].Providers = append(c.Combatants[actor].Providers, model.CombatantProviderMount{ProviderRef: "original_recovery_mount", DefinitionRef: p.ProviderKey})
	r.InitialSnapshot.Combatants[actor].Providers = append(r.InitialSnapshot.Combatants[actor].Providers, model.CombatantProviderSnapshot{ProviderRef: "original_recovery_mount", DefinitionRef: p.ProviderKey, Owner: owner, Source: owner, Stacks: 1})
	c.Combatants[actor].Resources = map[string]model.ResourceSlotDef{"mana": {Current: 1, Max: 50}}
	r.InitialSnapshot.Combatants[actor].Resources = c.Combatants[actor].Resources
}

func killedRecoveryInput(event string) (model.CompileRequest, model.RunRequest) {
	c, r := singleSkillInput(false)
	addKilledRecovery(&c, &r, 0, event)
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100})
	r.Sampling.Disabled = true
	return c, r
}

func recoveryEvidence(done model.DoneResult, kind model.EvidenceKind) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range done.Evidence.Items {
		if item.Kind == kind {
			out = append(out, item)
		}
	}
	return out
}

func assertRecoveryProvenance(t *testing.T, item model.EvidenceItem, operation string, use any) {
	t.Helper()
	for key, expected := range map[string]any{"owner": "source", "source": "source", "target": "source", "providerRef": "original_recovery_mount", "providerDefinitionRef": "recovery_definition", "abilityRef": recoveryAbilityRef, "operationRef": operation, "useRef": use} {
		value, present := item.Data[key]
		if !present || !reflect.DeepEqual(value, expected) {
			t.Fatal("recovery lost its original identity", key, value, expected, item)
		}
	}
	if path, valid := item.Data["operationPath"].(string); !valid || !strings.Contains(path, ".listenerSpec.operations[") {
		t.Fatal("recovery lost its compiled operation path", item)
	}
}

func TestKilledRecoverySettledPacketsAndOriginalActiveUse(t *testing.T) {
	for _, event := range []string{"event/damage_instance", model.EventTypeDamageTaken} {
		for _, mode := range []string{"lethal", "overkill", "nonlethal", "zero", "absorbed", "clipped"} {
			t.Run(event+"/"+mode, func(t *testing.T) {
				c, r := killedRecoveryInput(event)
				wantKilled, wantHeal, wantMana, wantHPOverflow, wantManaOverflow := float64(1), float64(40), float64(12), float64(0), float64(0)
				wantBeforeHP, wantBeforeMana := float64(500), float64(1)
				switch mode {
				case "overkill":
					setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 80, Max: 1000, Resolved: 80})
				case "nonlethal":
					setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 101, Max: 1000, Resolved: 101})
					wantKilled = 0
				case "zero":
					c.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(0)
					wantKilled = 0
				case "absorbed":
					c.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "shield", Target: "target", Amount: timedShieldExpr(100), ShieldRef: "full_absorption"}}}}
					wantKilled = 0
				case "clipped":
					wantBeforeHP, wantBeforeMana = 990, 45
					setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 990, Max: 1000, Resolved: 990})
					c.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 45, Max: 50}
					wantHeal, wantMana, wantHPOverflow, wantManaOverflow = 10, 5, 30, 7
				}
				if wantKilled == 0 {
					wantHeal, wantMana = 0, 0
				}
				done := timedShieldMustRun(t, c, r)
				if done.Summary.SourceFinalHp != wantBeforeHP+wantHeal || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != wantBeforeMana+wantMana {
					t.Fatal("wrong final ordinary recovery", done.Summary, done.FinalSnapshot.Combatants[0].Resources)
				}
				instances, taken := emittedEventsByRef(done, "event/damage_instance"), emittedEventsByRef(done, model.EventTypeDamageTaken)
				if len(instances) != 1 || len(taken) != 1 || instances[0].Data["damage"].(map[string]interface{})["killed"] != wantKilled || taken[0].Data["killed"] != wantKilled || instances[0].Data["useRef"] != "skill:cast_once" || taken[0].Data["useRef"] != "skill:cast_once" {
					t.Fatal("per-instance events disagree or lost actual active use", instances, taken)
				}
				heals, restores := recoveryEvidence(done, model.EvidenceKindHeal), recoveryEvidence(done, "resource_restore")
				if wantKilled == 0 {
					if len(heals) != 0 || len(restores) != 0 {
						t.Fatal("non-kill recovery published", heals, restores)
					}
					return
				}
				if len(heals) != 1 || len(restores) != 1 || heals[0].TimeMs != 350 || restores[0].TimeMs != 350 || done.Summary.StopReason != model.StopReasonTargetDead || done.Summary.DurationMs != 350 {
					t.Fatal("final kill stopped before synchronous recovery", heals, restores, done.Summary)
				}
				assertRecoveryProvenance(t, heals[0], "restore_hp", "skill:cast_once")
				assertRecoveryProvenance(t, restores[0], "restore_mana", "skill:cast_once")
				for key, want := range map[string]float64{"hpBefore": wantBeforeHP, "hpAfter": wantBeforeHP + wantHeal, "healingBeforeModifiers": 40, "healingAfterModifiers": 40, "actualHealing": wantHeal, "overheal": wantHPOverflow} {
					vampAmount(t, heals[0].Data, key, want)
				}
				for key, want := range map[string]float64{"requestedAmount": 12, "currentBefore": wantBeforeMana, "currentAfter": wantBeforeMana + wantMana, "actualDelta": wantMana, "overflow": wantManaOverflow} {
					vampAmount(t, restores[0].Data, key, want)
				}
			})
		}
	}
}

func TestKilledRecoveryDoesNotBorrowEarlierSameFrameDeathOrInventUse(t *testing.T) {
	c, r := frameCommitInput(frameCommitDamage(100), frameCommitDamage(7), frameCommitDamage(0))
	addKilledRecovery(&c, &r, 0, "event/damage_instance")
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 500})
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100})
	done := authoringRun(t, c, r)
	instances, taken := emittedEventsByRef(done, "event/damage_instance"), emittedEventsByRef(done, model.EventTypeDamageTaken)
	if len(instances) != 3 || len(taken) != 3 || done.Summary.SourceFinalHp != 540 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 13 {
		t.Fatal("same-frame packets reused the target's final dead state", done.Summary, instances, taken)
	}
	for index, want := range []float64{1, 0, 0} {
		if instances[index].Data["damage"].(map[string]interface{})["killed"] != want || taken[index].Data["killed"] != want || instances[index].Data["useRef"] != nil {
			t.Fatal("packet fact or absent-use ownership changed", index, instances[index], taken[index])
		}
	}
	heals, restores := recoveryEvidence(done, model.EvidenceKindHeal), recoveryEvidence(done, "resource_restore")
	if len(heals) != 1 || len(restores) != 1 {
		t.Fatal("same-frame death triggered multiple recovery frames", heals, restores)
	}
	assertRecoveryProvenance(t, heals[0], "restore_hp", nil)
	assertRecoveryProvenance(t, restores[0], "restore_mana", nil)
}

func TestKilledZeroIsARealConditionValueAndRecoveryKeepsHealingModifiers(t *testing.T) {
	c, r := killedRecoveryInput("event/damage_instance")
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 101, Max: 1000, Resolved: 101})
	c.SharedProviders[1].Abilities[0].ListenerSpec.Condition = authoringAmount(authoringBinary("eq", authoringRead("event.damage.killed"), authoringConst(0)))
	c.SharedProviders[0].Modifiers = []model.ModifierDefinition{
		{ModifierKey: "ordinary_done", Kind: "pipeline", Command: "heal", ValuePolicy: "add_percent", HealDirection: model.HealDone, HealCategory: model.HealDirect, HealGroupKey: "done", Value: authoringConst(.5)},
		{ModifierKey: "ordinary_received", Kind: "pipeline", Command: "heal", ValuePolicy: "add_percent", HealDirection: model.HealReceived, HealCategory: model.HealDirect, HealGroupKey: "received", Value: authoringConst(-.25)},
	}
	done := timedShieldMustRun(t, c, r)
	heals := recoveryEvidence(done, model.EvidenceKindHeal)
	if done.Summary.TargetFinalHp != 1 || done.Summary.SourceFinalHp != 545 || len(heals) != 1 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 13 {
		t.Fatal("valid zero was missing or ordinary healing modifiers were bypassed", done.Summary, done.Evidence)
	}
	for key, want := range map[string]float64{"healingBeforeModifiers": 40, "healingAfterDone": 60, "healingAfterModifiers": 45, "actualHealing": 45, "hpBefore": 500, "hpAfter": 545} {
		vampAmount(t, heals[0].Data, key, want)
	}
}

func TestKilledRecoveryDeadActualReceiverCannotReviveOrRestoreMana(t *testing.T) {
	c, r := singleSkillInput(false)
	addKilledRecovery(&c, &r, 1, model.EventTypeDamageTaken)
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100})
	done := timedShieldMustRun(t, c, r)
	if done.Summary.TargetFinalHp != 0 || done.FinalSnapshot.Combatants[1].Resources["mana"].Current != 1 || len(recoveryEvidence(done, model.EvidenceKindHeal)) != 0 || len(recoveryEvidence(done, "resource_restore")) != 0 {
		t.Fatal("dead listener owner received ordinary recovery", done.Summary, done.Evidence)
	}
}

func TestKilledRecoveryOwnerKilledByLaterSameFramePacketCannotRevive(t *testing.T) {
	selfDamage := frameCommitDamage(1000)
	selfDamage.Target = "self"
	c, r := frameCommitInput(frameCommitDamage(100), selfDamage)
	addKilledRecovery(&c, &r, 0, "event/damage_instance")
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 500})
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 100})
	done := authoringRun(t, c, r)
	if done.Summary.SourceFinalHp != 0 || done.Summary.TargetFinalHp != 0 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 1 || len(recoveryEvidence(done, model.EvidenceKindHeal)) != 0 || len(recoveryEvidence(done, "resource_restore")) != 0 {
		t.Fatal("listener used its earlier living snapshot to revive its owner", done.Summary, done.Evidence)
	}
}

func TestKilledRecoveryLeavesExistingNegativeResourceOperationTarget(t *testing.T) {
	c, r := killedRecoveryInput("event/damage_instance")
	spend := &c.SharedProviders[1].Abilities[0].ListenerSpec.Operations[1]
	spend.Target, spend.Amount = "target", timedShieldExpr(-1)
	c.Combatants[1].Resources = map[string]model.ResourceSlotDef{"mana": {Current: 5, Max: 50}}
	r.InitialSnapshot.Combatants[1].Resources = c.Combatants[1].Resources
	done := timedShieldMustRun(t, c, r)
	if done.Summary.SourceFinalHp != 540 || done.FinalSnapshot.Combatants[1].Resources["mana"].Current != 4 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 1 || len(recoveryEvidence(done, "resource_restore")) != 0 {
		t.Fatal("ordinary recovery changed a negative resource operation", done.Summary, done.FinalSnapshot, done.Evidence)
	}
}

func TestCompileKilledRejectsUnsettledWrongAndOperationContexts(t *testing.T) {
	for _, mode := range []string{"any", "aggregate", "unsettled", "custom", "active_amount", "listener_amount", "listener_operation_condition", "modifier", "modifier_condition", "dead_if_branch", "forged_instance", "forged_taken", "wrong_self_target"} {
		t.Run(mode, func(t *testing.T) {
			c, _ := killedRecoveryInput("event/damage_instance")
			listener := c.SharedProviders[1].Abilities[0].ListenerSpec
			switch mode {
			case "any":
				listener.EventMatcher = model.TypeMatcher{Any: []string{"event/damage_instance"}}
			case "aggregate", "unsettled", "custom":
				event := map[string]string{"aggregate": "event/damage_dealt", "unsettled": model.EventTypeSkillHit, "custom": "event/custom_kill"}[mode]
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: event, Domain: "event"})
				listener.EventMatcher.All = []string{event}
			case "active_amount":
				c.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = authoringAmount(authoringRead("event.damage.killed"))
			case "listener_amount":
				listener.Operations[0].Amount = authoringAmount(authoringRead("event.damage.killed"))
			case "listener_operation_condition":
				listener.Operations[0].Condition = killedCondition()
			case "modifier", "modifier_condition":
				mod := model.ModifierDefinition{ModifierKey: "illegal_kill_read", Kind: "attribute", Target: "source", ValuePolicy: "add", Value: authoringConst(0)}
				if mode == "modifier" {
					mod.Value = authoringRead("event.damage.killed")
				} else {
					mod.Condition = killedCondition()
				}
				c.Rules.Modifiers = []model.ModifierDefinition{mod}
			case "dead_if_branch":
				listener.Operations[0].Amount = authoringAmount(model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(0), authoringRead("event.damage.killed"), authoringConst(40)}})
			case "forged_instance", "forged_taken":
				event := "event/damage_instance"
				if mode == "forged_taken" {
					event = model.EventTypeDamageTaken
				}
				listener.Operations = append(listener.Operations, model.OperationDefinition{Operation: "emit_event", Target: "self", EventType: event})
			case "wrong_self_target":
				listener.Operations[0].Target = "target"
			}
			compiled := compilebundle.CompileGeneric(c)
			if compiled.OK {
				t.Fatal("unqualified kill fact or recovery target compiled", mode)
			}
			if mode != "forged_instance" && mode != "forged_taken" && mode != "wrong_self_target" {
				found := false
				for _, issue := range compiled.Result.Errors {
					found = found || issue.Ref == "event.damage.killed"
				}
				if !found {
					t.Fatal("test did not exercise the kill-fact admission check", compiled.Result.Errors)
				}
			}
		})
	}
}
