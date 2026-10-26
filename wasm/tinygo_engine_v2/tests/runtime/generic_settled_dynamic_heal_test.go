// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	json "encoding/json"
	math "math"
	reflect "reflect"
	strings "strings"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

// Hand calculations are frozen in dynamic-heal-test-evidence before any run.
// These fixtures keep the real complete permanent mount and background driver.
func settledDynamicHealInput(background bool) (model.CompileRequest, model.RunRequest) {
	var c model.CompileRequest
	var r model.RunRequest
	if background {
		c, r = killedBasicAttackRecoveryInput("character", 100, 100)
	} else {
		c, r = killedRecoveryInput("event/damage_instance")
	}
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability_power", Domain: "attribute"})
	setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 200, Max: 1000, Resolved: 1000})
	setCombatantAttr(&c, &r, "source", "ability_power", authoringSlot(100))
	setCombatantAttr(&c, &r, "target", "ability_power", authoringSlot(200))
	c.SharedProviders[1].Abilities[0].Params = map[string]float64{"base": 30, "ratio": .5}
	// A real common formula reference is part of the permitted closure.
	c.Formulas = append(c.Formulas, formuladefinition.FromExpr("recovery/current_ap", "recovery_skill", authoringRead("source.attr.ability_power.resolved"), nil))
	amount := authoringBinary("add", authoringRead("ability.param.base"), authoringBinary("mul", authoringRead("ability.param.ratio"), model.GenericFormulaExpr{Op: "ref", Ref: "recovery/current_ap"}))
	c.SharedProviders[1].Abilities[0].ListenerSpec.Operations[0].Amount = authoringAmount(amount)
	return c, r
}

func settledDynamicHealAPChange(c *model.CompileRequest, delta float64) {
	ensureC1CatalogTypes(c, model.TypeCatalogEntry{Key: model.EventTypeBasicAttackHit, Domain: "event"})
	definition := hitFlatProvider("previous_hit_ap", "ability_power", delta)
	definition.SkillKey = "recovery_skill"
	definition.StableID = "recovery_definition"
	c.SharedProviders = append(c.SharedProviders, definition)
	c.SharedProviders[1].Abilities = append(c.SharedProviders[1].Abilities, model.AbilityDefinition{
		AbilityKey: "previous_hit_ap", SkillKey: "recovery_skill", Kind: "passive_listener",
		ListenerSpec: &model.ListenerDefinition{ListenerKey: "previous_hit_ap", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
			Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: definition.ProviderKey}}},
	})
}

func settledDynamicHealVamp(c *model.CompileRequest, r *model.RunRequest) {
	ensureC1CatalogTypes(c, model.TypeCatalogEntry{Key: "life_steal_percent", Domain: "attribute"},
		model.TypeCatalogEntry{Key: receivedDeliveryBasic, Domain: "damage_trait"}, model.TypeCatalogEntry{Key: receivedOriginDirect, Domain: "damage_trait"})
	setCombatantAttr(c, r, "source", "life_steal_percent", authoringSlot(.2))
	for i := range c.Combatants {
		c.Combatants[i].Types = []string{"combatant/champion"}
	}
	efficiency := 1.0
	c.Rules.VampRules = []model.VampRuleDefinition{{VampType: model.VampLifeSteal, SourceAttributeKey: "life_steal_percent", BasisOutputKind: model.VampPostDefense,
		DefaultEfficiency: &efficiency, TargetMatcher: model.TypeMatcher{All: []string{"combatant/champion"}},
		DamageMatcher: model.TypeMatcher{All: []string{receivedDeliveryBasic, receivedOriginDirect}}, AbilityMatcher: model.TypeMatcher{All: []string{model.AbilityTypeBasicAttack}}}}
	for i := range c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates {
		for j := range c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[i].Operations {
			op := &c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates[i].Operations[j]
			if op.Operation == "damage" {
				op.Types, op.VampQualification = []string{receivedDeliveryBasic, receivedOriginDirect}, model.VampResolved
			}
		}
	}
}

func TestSettledDynamicSelfHealBackgroundAndActiveKeepRealUseAndReplay(t *testing.T) {
	for _, background := range []bool{true, false} {
		t.Run(map[bool]string{true: "background", false: "active"}[background], func(t *testing.T) {
			c, r := settledDynamicHealInput(background)
			compiled := authoringCompile(t, c)
			done, err := runtimeengine.RunGeneric(compiled, r)
			if err != nil {
				t.Fatal(err)
			}
			if done.Summary.SourceFinalHp != 280 || done.Summary.TargetFinalHp != 0 || done.Summary.SourceDamageDealt != 100 || done.Summary.StopReason != model.StopReasonTargetDead {
				t.Fatal("dynamic 30+.5*100 healing did not finish the real kill", done.Summary)
			}
			use, at := "skill:cast_once", int64(350)
			if background {
				if len(done.AttackRecords) != 1 || done.Summary.BasicAttack.CompletedCount != 1 {
					t.Fatal("background driver was replaced or skipped", done.AttackRecords, done.Summary)
				}
				use, at = done.AttackRecords[0].UseRef, 0
			}
			heals := recoveryEvidence(done, model.EvidenceKindHeal)
			if len(heals) != 1 || heals[0].TimeMs != at {
				t.Fatal("wrong heal list", heals)
			}
			assertRecoveryProvenance(t, heals[0], "restore_hp", use)
			for key, want := range map[string]float64{"healingBeforeModifiers": 80, "actualHealing": 80, "hpBefore": 200, "hpAfter": 280, "overheal": 0} {
				vampAmount(t, heals[0].Data, key, want)
			}
			if repeated, err := runtimeengine.RunGeneric(compiled, r); err != nil || !reflect.DeepEqual(done, repeated) {
				t.Fatal("same compiled session retained recovery state", err)
			}
		})
	}
}

func TestSettledDynamicSelfHealReadsPreviousHitAPWithoutCaching(t *testing.T) {
	c, r := settledDynamicHealInput(true)
	setCombatantAttr(&c, &r, "target", "hp", authoringSlot(200))
	r.StopPolicy.DurationMs = 1101
	settledDynamicHealAPChange(&c, 50)
	done := authoringRun(t, c, r)
	heals := recoveryEvidence(done, model.EvidenceKindHeal)
	if len(done.AttackRecords) != 2 || done.AttackRecords[1].StartAtMs != 1000 || done.Summary.SourceDamageDealt != 200 || done.Summary.SourceFinalHp != 305 || len(heals) != 1 || heals[0].TimeMs != 1000 {
		t.Fatal("30+.5*150 was replaced by the initial 80", done.Summary, done.AttackRecords, heals)
	}
	vampAmount(t, heals[0].Data, "healingBeforeModifiers", 105)
	vampNear(t, "current AP", snapshotAttribute(t, done, "source", "ability_power"), 150)
	assertRecoveryProvenance(t, heals[0], "restore_hp", done.AttackRecords[1].UseRef)
}

func TestSettledDynamicSelfHealReadsHPAfterVampAndClips(t *testing.T) {
	for _, clipped := range []bool{false, true} {
		t.Run(map[bool]string{false: "post_vamp", true: "capacity"}[clipped], func(t *testing.T) {
			c, r := settledDynamicHealInput(true)
			settledDynamicHealVamp(&c, &r)
			c.SharedProviders[1].Abilities[0].ListenerSpec.Operations[0].Amount = authoringAmount(authoringBinary("mul", authoringConst(.5), authoringRead("source.attr.hp.current")))
			before, request, actual, after := float64(220), float64(110), float64(110), float64(330)
			if clipped {
				setCombatantAttr(&c, &r, "source", "hp", model.AttributeSlotDef{Base: 1000, Current: 970, Max: 1000, Resolved: 1000})
				before, request, actual, after = 990, 495, 10, 1000
			}
			done := authoringRun(t, c, r)
			heals, vamp := recoveryEvidence(done, model.EvidenceKindHeal), vampEvents(done)
			if len(heals) != 1 || len(vamp) != 1 || done.Summary.SourceFinalHp != after {
				t.Fatal("wrong post-vamp current-health treatment", done.Summary, heals, vamp)
			}
			vampAmount(t, vamp[0].Data, "actualHealing", 20)
			for key, want := range map[string]float64{"hpBefore": before, "hpAfter": after, "healingBeforeModifiers": request, "actualHealing": actual, "overheal": request - actual} {
				vampAmount(t, heals[0].Data, key, want)
			}
			vampIndex, healIndex := -1, -1
			for index, item := range done.Evidence.Items {
				if item.Kind == model.EvidenceKindVamp {
					vampIndex = index
				}
				if item.Kind == model.EvidenceKindHeal {
					healIndex = index
				}
			}
			if vampIndex < 0 || healIndex <= vampIndex {
				t.Fatal("direct heal preceded vamp", done.Evidence)
			}
		})
	}
}

func TestSettledDynamicSelfHealTargetOwnerAndDeadReceiver(t *testing.T) {
	for _, lethal := range []bool{false, true} {
		t.Run(map[bool]string{false: "target_owner", true: "no_revive"}[lethal], func(t *testing.T) {
			c, r := continuousAttackInput(1, 200, 100, 0, 0, 1)
			addKilledRecovery(&c, &r, 1, model.EventTypeDamageTaken)
			ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability_power", Domain: "attribute"})
			setCombatantAttr(&c, &r, "source", "ability_power", authoringSlot(100))
			setCombatantAttr(&c, &r, "target", "ability_power", authoringSlot(200))
			setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 200, Max: 1000, Resolved: 1000})
			listener := c.SharedProviders[1].Abilities[0].ListenerSpec
			listener.Condition = authoringAmount(authoringBinary("eq", authoringRead("event.damage.killed"), authoringConst(0)))
			listener.Operations[0].Amount = authoringAmount(authoringBinary("add", authoringConst(30), authoringBinary("mul", authoringConst(.5), authoringRead("source.attr.ability_power.resolved"))))
			if lethal {
				setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Current: 100, Max: 1000, Resolved: 1000})
				listener.Condition = killedCondition()
			}
			done := authoringRun(t, c, r)
			heals := recoveryEvidence(done, model.EvidenceKindHeal)
			if lethal {
				if done.Summary.TargetFinalHp != 0 || len(heals) != 0 || done.FinalSnapshot.Combatants[1].Resources["mana"].Current != 1 {
					t.Fatal("dead receiver revived", done.Summary, heals)
				}
				return
			}
			if done.Summary.TargetFinalHp != 230 || len(heals) != 1 {
				t.Fatal("target owner borrowed attacker AP", done.Summary, heals)
			}
			vampAmount(t, heals[0].Data, "healingBeforeModifiers", 130)
			for key, want := range map[string]any{"owner": "target", "source": "target", "target": "target", "providerRef": "original_recovery_mount", "providerDefinitionRef": "recovery_definition", "abilityRef": "target.provider[original_recovery_mount].ability[ordinary_recovery]", "useRef": done.AttackRecords[0].UseRef} {
				if heals[0].Data[key] != want {
					t.Fatal("wrong receiver recovery identity", key, heals[0])
				}
			}
		})
	}
}

func TestSettledDynamicSelfHealRejectsIncompleteAndForeignDependencies(t *testing.T) {
	modes := []string{"missing_attribute", "incomplete_attribute", "nan_attribute", "infinite_attribute", "unselected_missing_attribute", "unselected_incomplete_attribute", "unselected_missing_parameter", "unselected_foreign_attribute", "negative_initial", "missing_parameter", "nan_parameter", "target_attribute", "event_amount", "resource", "provider_state", "status", "runtime_parameter", "dynamic_resource", "wrong_owner", "foreign_mount", "temporary_provider", "incomplete_listener", "aggregate", "unsettled", "no_owner_filter", "wrong_target"}
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			c, r := settledDynamicHealInput(true)
			ability := &c.SharedProviders[1].Abilities[0]
			listener := ability.ListenerSpec
			amount := &listener.Operations[0].Amount
			// Flatten only the amount under test; the positive case tests refs.
			*amount = authoringAmount(authoringBinary("add", authoringRead("ability.param.base"), authoringBinary("mul", authoringRead("ability.param.ratio"), authoringRead("source.attr.ability_power.resolved"))))
			compileMayReject := false
			switch mode {
			case "missing_attribute":
				delete(c.Combatants[0].Attributes, "ability_power")
				delete(r.InitialSnapshot.Combatants[0].Attributes, "ability_power")
			case "incomplete_attribute", "unselected_incomplete_attribute":
				var incomplete model.AttributeSlotDef
				if err := json.Unmarshal([]byte(`{"base":100,"current":100,"max":100}`), &incomplete); err != nil {
					t.Fatal(err)
				}
				setCombatantAttr(&c, &r, "source", "ability_power", incomplete)
			case "nan_attribute", "infinite_attribute":
				value := math.NaN()
				if mode == "infinite_attribute" {
					value = math.Inf(1)
				}
				setCombatantAttr(&c, &r, "source", "ability_power", authoringSlot(value))
			case "unselected_missing_attribute":
				delete(c.Combatants[0].Attributes, "ability_power")
				delete(r.InitialSnapshot.Combatants[0].Attributes, "ability_power")
			case "negative_initial":
				*amount = authoringAmount(authoringBinary("sub", authoringConst(99), authoringRead("source.attr.ability_power.resolved")))
			case "missing_parameter":
				delete(ability.Params, "base")
			case "nan_parameter":
				ability.Params["base"] = math.NaN()
			case "target_attribute":
				*amount = authoringAmount(authoringRead("target.attr.ability_power.resolved"))
			case "event_amount":
				*amount = authoringAmount(authoringRead("event.damage.baseRawAmount"))
			case "resource":
				*amount = authoringAmount(authoringRead("source.resource.mana.current"))
			case "provider_state":
				c.SharedProviders[1].InitialStateSchema = map[string]interface{}{"layers": discreteSourceField(0, 3, 1000)}
				*amount = authoringAmount(authoringRead("provider.state.layers"))
			case "status":
				*amount = authoringAmount(authoringRead("source.status.stunned.present"))
				compileMayReject = true
			case "runtime_parameter":
				definition := formuladefinition.FromExpr("recovery/runtime", "recovery_skill", authoringBinary("add", authoringRead("ability.param.base"), authoringRead("source.attr.ability_power.resolved")), nil)
				definition.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "ability_parameter"}
				c.Formulas = append(c.Formulas, definition)
				*amount = authoringAmount(model.GenericFormulaExpr{Op: "ref", Ref: definition.Key})
			case "dynamic_resource":
				listener.Operations[1].Amount = authoringAmount(authoringRead("source.attr.ability_power.resolved"))
			case "foreign_mount":
				r.InitialSnapshot.Combatants[0].Providers[1].ProviderRef = "foreign_mount"
			case "temporary_provider":
				c.SharedProviders[1].Lifecycle = &model.ProviderLifecycle{DurationMs: timedShieldExpr(1000)}
			case "incomplete_listener":
				listener.MaxTriggersPerEvent = 2
			case "aggregate", "unsettled", "no_owner_filter":
				listener.Condition = nil
				if mode == "no_owner_filter" {
					listener.EventMatcher.All = []string{"event/damage_instance"}
				} else {
					event := "event/damage_dealt"
					if mode == "unsettled" {
						event = model.EventTypeBasicAttackHit
					}
					ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: event, Domain: "event"})
					listener.EventMatcher.All = []string{event, "event/source_owner"}
				}
			case "wrong_target":
				listener.Operations[0].Target = "target"
				compileMayReject = true
			}
			if strings.HasPrefix(mode, "unselected_") {
				read := authoringRead("source.attr.ability_power.resolved")
				if mode == "unselected_missing_parameter" {
					read = authoringRead("ability.param.missing")
				}
				if mode == "unselected_foreign_attribute" {
					read = authoringRead("target.attr.ability_power.resolved")
				}
				*amount = authoringAmount(model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{authoringConst(0), read, authoringRead("source.attr.hp.current")}})
			}
			compiled := compilebundle.CompileGeneric(c)
			if !compiled.OK {
				if compileMayReject {
					return
				}
				t.Fatal("negative fixture did not reach runtime admission", compiled.Result.Errors)
			}
			if mode == "wrong_owner" {
				for i := range compiled.Session.Operations {
					if compiled.Session.Operations[i].Ref == "restore_hp" {
						compiled.Session.Operations[i].OwnerProviderIndex = 0
					}
				}
			}
			if _, err := runtimeengine.RunGeneric(compiled.Session, r); err == nil || err.BudgetCause != "" {
				t.Fatal("illegal recovery admitted or misreported as a budget failure", err)
			}
		})
	}
}
