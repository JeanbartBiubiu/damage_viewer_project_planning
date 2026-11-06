package execution

import (
	testing "testing"
	formula "tinygo_engine_v2/internal/formula"
	model "tinygo_engine_v2/internal/model"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

// A native Generic status fixture is mounted between real contacts. This is
// intentionally not a new management-authoring spell-shield application path.
func targetMarkShieldState(t *testing.T, c model.CompileRequest, r model.RunRequest, count int) *Engine {
	t.Helper()
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeSpellShieldBlocked, Domain: "event"}, model.TypeCatalogEntry{Key: model.ProviderTypeSpellShield, Domain: "provider"})
	for i := 0; i < count; i++ {
		shield := spellShieldProvider()
		if i > 0 {
			shield.ProviderKey = "shield:other"
		}
		shield.Listeners[0].Operations = shield.Listeners[0].Operations[1:]
		if r.DriverPlan.BasicAttack != nil {
			shield.Listeners = nil
		}
		c.SharedProviders = append(c.SharedProviders, shield)
	}
	s := targetMarkState(t, c, r)
	runPrefixThroughForTest(t, s, r.DriverPlan.SkillActions[0].FirstAtMs+250)

	s.publishBasicAttackWait()
	for i := 0; i < count; i++ {
		definition := "shield:spell"
		if i > 0 {
			definition = "shield:other"
		}
		if err := s.applyProviderInstanceWithRef("target", "target", definition, definition, 0, false, effectpkg.ContributionView{}); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

func TestTargetMarkShieldKeepsOriginalContactAndConsumesIndependentUnit(t *testing.T) {
	for _, skill := range []bool{false, true} {
		c, r := targetMarkInput(skill, !skill)
		s := targetMarkShieldState(t, c, r, 1)
		if err := s.runLoop(); err != nil {
			t.Fatal(err)
		}
		done := s.buildDoneResult(false)
		if skill {
			if done.TargetMarkSummary.ConsumedCount != 0 || len(targetMarkRows(done)) != 0 || done.Summary.SourceDamageDealt != 0 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 80 {
				t.Fatal(done.Summary, done.TargetMarkSummary)
			}
		} else {
			if done.TargetMarkSummary.AttackCount != 1 || done.TargetMarkSummary.DamageBlockedCount != 1 || done.Summary.SourceDamageDealt != 40 || done.Summary.BasicAttack.HitCount != 2 {
				t.Fatal(done.Summary, done.TargetMarkSummary)
			}
			rows := targetMarkRows(done)
			if len(rows) != 1 || rows[0].Data["damageBlocked"] != true || rows[0].Data["damageId"] != nil {
				t.Fatal(rows)
			}
			for _, row := range done.DamageRecords {
				if row["operationRef"] == "w.detonate" {
					t.Fatal("blocked W manufactured damage", row)
				}
			}
		}
		wantProviders := 0
		if !skill {
			wantProviders = 1
		} // The legal attack probe has no invented consume listener.
		if len(done.FinalSnapshot.Combatants[1].Providers) != wantProviders {
			t.Fatal("real shield consumer did not remove exact instance", done.FinalSnapshot.Combatants[1].Providers)
		}
		blocked := 0
		for _, item := range done.Evidence.Items {
			if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == model.EventTypeSpellShieldBlocked {
				blocked++
				if item.Data["shieldProviderRef"] == "" {
					t.Fatal(item)
				}
			}
		}
		if blocked != 1 {
			t.Fatal("wrong number of shield units", blocked)
		}
	}
}

func TestTargetMarkSkillIndependentShieldUsesRealConsumerWithoutNewContact(t *testing.T) {
	c, r := targetMarkInput(true, false)
	c.SharedProviders[2].Abilities[1].Operations[0].SkillHit.Candidates[0].SpellShieldBlockScope = nil
	s := targetMarkShieldState(t, c, r, 1)
	if err := s.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := s.buildDoneResult(false)
	if done.TargetMarkSummary.SkillCount != 1 || done.TargetMarkSummary.DamageBlockedCount != 1 || done.Summary.SourceDamageDealt != 100 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 100 || len(done.FinalSnapshot.Combatants[1].Providers) != 0 {
		t.Fatal(done.Summary, done.TargetMarkSummary, done.FinalSnapshot.Combatants[1].Providers)
	}
	if _, stored := s.hits.BlockUnit("skill:q"); stored || s.skillUses["skill:q"].history.ContactCount() != 1 || len(targetMarkRows(done)) != 1 {
		t.Fatal("local shield polluted root contact/ledger")
	}
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindSkillHit && item.Data["skillKey"] == "q" && item.Data["blocked"] != float64(0) {
			t.Fatal("changed original blocked fact", item)
		}
	}
}

func TestTargetMarkRuntimeFailureRollsBackTheGroupOnly(t *testing.T) {
	for _, failure := range []string{"amount", "restore", "multiple_shields"} {
		t.Run(failure, func(t *testing.T) {
			c, r := targetMarkInput(true, false)
			if failure == "amount" {
				c.SharedProviders[1].Abilities[3].ListenerSpec.Operations[0].TargetMark.Damage.Amount = authoringAmount(authoringBinary("div", authoringConst(1), authoringRead("source.attr.ability_power.resolved")))
				c.Combatants[0].Attributes["ability_power"] = authoringSlot(0)
			}
			if failure == "multiple_shields" {
				c, r = targetMarkInput(false, true)
			}
			var s *Engine
			if failure == "multiple_shields" {
				s = targetMarkShieldState(t, c, r, 2)
			} else {
				s = targetMarkState(t, c, r)
			}
			if failure == "restore" {
				for _, op := range s.compiled.Operations {
					if op.TargetMark != nil && op.TargetMark.Restore != nil {
						program := op.TargetMark.Restore.AmountProgram
						s.formulas.Programs[program].Instr = []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpConst, Value: 0}, {Op: formula.GenericOpDiv}}
					}
				}
			}
			err := s.runLoop()
			if err == nil && s.budgetCause == "" {
				t.Fatal("failure was accepted")
			}
			if s.report.TargetMarkSummary().ConsumedCount != 0 || s.combatants["source"].resourceView().At("mana").Current != 80 {
				t.Fatal("group facts or recovery escaped rollback", s.report.TargetMarkSummary())
			}
			if s.combatants["source"].providerState.Lookup("w").TargetValues().At("mark") != 1 {
				t.Fatal("mark escaped failed group rollback")
			}
			for _, row := range s.report.Snapshot().DamageRecords {
				if row["operationRef"] == "w.detonate" {
					t.Fatal("uncommitted W damage escaped", row)
				}
			}
			wantHP := 900.0
			if failure == "multiple_shields" {
				wantHP = 960
			}
			vampNear(t, "committed root retained", s.combatantHp("target"), wantHP)
		})
	}
}

func TestTargetMarkRuntimeCannotRestoreOrBorrowDriverBindings(t *testing.T) {
	for _, scenario := range []string{"unplanned_parent", "unplanned_trigger", "missing_slot", "wrong_attack", "nonzero_time", "restored_mark"} {
		t.Run(scenario, func(t *testing.T) {
			c, r := targetMarkInput(true, false)
			switch scenario {
			case "unplanned_parent":
				r.DriverPlan.SkillActions = r.DriverPlan.SkillActions[1:]
			case "unplanned_trigger":
				r.DriverPlan.SkillActions = r.DriverPlan.SkillActions[:1]
			case "missing_slot":
				delete(c.Combatants[0].Resources, "mana")
			case "wrong_attack":
				c, r = targetMarkInput(false, true)
				r.DriverPlan.BasicAttack.HitAbilityRef = "source.provider[w].ability[hit]"
			case "nonzero_time":
				r.InitialSnapshot.TimeMs = 1
			case "restored_mark":
				r.InitialSnapshot.Combatants[0].ProviderState = map[string]any{"w": map[string]any{"targetState": map[string]any{"target": "target", "values": map[string]any{"mark": 1}, "expireAt": map[string]any{"mark": 4250}}}}
			}
			_, err := newGenericRunState(authoringCompile(t, c), r)
			if err == nil {
				t.Fatal("accepted invalid fresh mark source", scenario)
			}
		})
	}
}
