package execution

import (
	math "math"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	scheduler "tinygo_engine_v2/internal/scheduler"
)

func totalRatioPacketInput(t *testing.T, total float64, amounts ...float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := finitePeriodicCastInput(t, total, true)
	op := c.SharedProviders[2].Abilities[0].TickSpec.OnTick[0]
	c.SharedProviders = append(c.SharedProviders[:2], c.SharedProviders[3:]...)
	var ops []model.OperationDefinition
	for _, amount := range amounts {
		next := op
		next.Amount = timedShieldExpr(amount)
		ops = append(ops, next)
	}
	c.SharedProviders[1].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: ops}}
	r.StopPolicy.DurationMs = 500
	return c, r
}

func TestTotalCooldownRatioCommitsFinalDurationAndNeverRecomputesAfterAttributeOrModifierChange(t *testing.T) {
	for _, mode := range []string{"haste17", "duration_factor"} {
		t.Run(mode, func(t *testing.T) {
			c, r := totalRatioPacketInput(t, 12000, 100)
			c.SharedProviders[1].Processes[0].MomentOperations[0].Moment.MomentType = "PROCESS_COMPLETE"
			wantTotal, wantRefund := int64(10256), int64(513)
			if mode == "haste17" {
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability_haste", Domain: "attribute"})
				setCombatantAttr(&c, &r, "source", "ability_haste", authoringSlot(17))
				c.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringBinary("div", authoringConst(1200000), authoringBinary("add", authoringConst(100), authoringRead("source.attr.ability_haste.resolved")))
				c.SharedProviders = append(c.SharedProviders, hitFlatProvider("haste_change_window", "ability_haste", -17))
				c.SharedProviders[1].Processes[0].MomentOperations = append([]model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: "self", ProviderDefinitionRef: "haste_change_window"}}}}, c.SharedProviders[1].Processes[0].MomentOperations...)
			} else {
				c.SharedProviders[1].Processes[0].Cooldown.DurationMs = authoringConst(6000)
				refs := []string{c.Rules.SkillActionBindings[0].Controls[0].AbilityRef}
				p := hitFlatProvider("duration_window", "armor", 0)
				p.Modifiers = []model.ModifierDefinition{{ModifierKey: "duration", Kind: "cooldown_duration", Target: "self", ValuePolicy: "multiply", Value: authoringConst(.5), AffectedAbilityRefs: &refs}}
				c.SharedProviders = append(c.SharedProviders, p)
				wantTotal, wantRefund = 3000, 150
			}
			s := frameCommitState(t, c, r)
			*s.loop.Queue() = scheduler.NewGenericHeap(32)
			if mode == "duration_factor" {
				applyDurationWindow(t, s)
			}
			if err := s.handleSkillAction(0); err != nil {
				t.Fatal(err)
			}
			id := actionpkg.AbilityCooldownIdentity("source", c.Rules.SkillActionBindings[0].Controls[0].AbilityRef)
			entry := s.combatants["source"].cooldowns.EntryValue(id)
			if !entry.HasOrdinaryTotal || entry.OrdinaryTotalMs != wantTotal {
				t.Fatal("not a real final commit fact", entry, wantTotal)
			}
			var frame Frame
			s.initExecutionFrame(&frame, "source", "target", "later_change")
			if mode == "haste17" {
				slot, exists := s.combatants["source"].attributesView().Lookup("ability_haste")
				if !exists || slot.Resolved != 0 {
					t.Fatal("actual post-commit attribute operation did not change haste", slot)
				}
			} else {
				for instanceIndex, instanceValues := 0, s.combatants["source"].instances.Providers(); instanceIndex < instanceValues.Len(); instanceIndex++ {
					inst := instanceValues.At(instanceIndex)
					if inst.DefinitionRef == "duration_window" {
						if err := frame.executeOperations(planbundle.CompiledAbility{}, []planbundle.CompiledOperation{{Operation: "expire_provider", Target: "self", ProviderRef: inst.ProviderRef}}); err != nil {
							t.Fatal(err)
						}
					}
				}
				frame.commit()
				if frame.fatal {
					t.Fatal(frame.fatalErr)
				}
			}
			if err := s.runLoop(); err != nil {
				t.Fatal(err)
			}
			entry = s.combatants["source"].cooldowns.EntryValue(id)
			if entry.ReadyAt != wantTotal-wantRefund || entry.OrdinaryTotalMs != wantTotal || !entry.HasOrdinaryTotal {
				t.Fatal("refund recomputed total or dropped provenance", entry, wantTotal, wantRefund)
			}
		})
	}
}

func TestTotalCooldownRatioMissingContextKeepsCommittedDamageAndIndependentHeal(t *testing.T) {
	c, r := finitePeriodicCastInput(t, 12000, true)
	s := frameCommitState(t, c, r)
	*s.loop.Queue() = scheduler.NewGenericHeap(32)
	if err := s.handleSkillAction(0); err != nil {
		t.Fatal(err)
	}
	id := actionpkg.AbilityCooldownIdentity("source", c.Rules.SkillActionBindings[0].Controls[0].AbilityRef)
	ledger := s.combatants["source"].cooldowns
	readyAt := ledger.ReadyAt(id)
	ledger.Reset(id, s.loop.TimeMs())
	ledger.Set(id, readyAt, s.loop.TimeMs()) // A plain deadline cannot recreate ordinary-commit provenance.
	err := s.runLoop()
	if err == nil || s.combatantHp("target") != 981 || math.Abs(s.combatantHp("source")-503.42) > 1e-9 || s.report.Totals().SourceDamageDealt != 19 || ledger.ReadyAt(id) != 12000 {
		t.Fatal("refund failure crossed an already committed child frame", err, s.combatantHp("source"), s.combatantHp("target"), ledger.EntryValue(id))
	}
}
