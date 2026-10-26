package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
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
		c, r = killedRecoveryInput(eventTypeDamageInstance)
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

func TestSettledDynamicSelfHealLaterNegativeClampsAndFailureRollsBackChild(t *testing.T) {
	for _, failure := range []bool{false, true} {
		t.Run(map[bool]string{false: "later_negative", true: "division_zero_child_rollback"}[failure], func(t *testing.T) {
			c, r := settledDynamicHealInput(true)
			setCombatantAttr(&c, &r, "target", "hp", authoringSlot(200))
			r.StopPolicy.DurationMs = 1101
			delta := float64(50)
			op := &c.SharedProviders[1].Abilities[0].ListenerSpec.Operations[0]
			op.Amount = authoringAmount(authoringBinary("sub", authoringConst(100), authoringRead("source.attr.ability_power.resolved")))
			if failure {
				delta = -100
				op.Amount = authoringAmount(authoringBinary("div", authoringConst(100), authoringRead("source.attr.ability_power.resolved")))
			}
			settledDynamicHealAPChange(&c, delta)
			s := frameCommitState(t, c, r)
			err := s.runLoop()
			done := s.buildDoneResult(false)
			if s.combatantHp("target") != 0 || s.combatantHp("source") != 200 || s.report.Totals().SourceDamageDealt != 200 || len(damageEvidenceItems(done)) != 2 {
				t.Fatal("listener child changed committed parent damage", err, done.Summary)
			}
			if failure {
				if err == nil || err.BudgetCause != "" || len(recoveryEvidence(done, model.EvidenceKindHeal)) != 0 || len(recoveryEvidence(done, "resource_restore")) != 0 || len(s.report.Snapshot().HealingRecords) != 0 || s.combatants["source"].resourceView().At("mana").Current != 1 {
					t.Fatal("formula failure leaked child recovery or changed error boundary", err, done.Evidence)
				}
			} else if err != nil || s.combatants["source"].resourceView().At("mana").Current != 13 {
				t.Fatal("later negative did not preserve the existing zero clamp", err, done.Summary)
			}
		})
	}
}
