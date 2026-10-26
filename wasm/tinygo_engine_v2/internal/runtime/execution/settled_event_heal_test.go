package execution

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const settledEventDeliverySkill = "damage_trait/delivery_skill"

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
			done := s.buildDoneResult(false)
			if err == nil || err.BudgetCause != "" || s.combatantHp("source") != wantHp || s.combatantHp("target") != 850 || s.report.Totals().SourceDamageDealt != 150 || len(recoveryEvidence(done, model.EvidenceKindHeal)) != wantHeals || len(done.DamageRecords) != 2 {
				t.Fatal("event amount failure borrowed old snapshot, leaked heal, or undid committed damage", err, done.Summary)
			}
		})
	}
}
