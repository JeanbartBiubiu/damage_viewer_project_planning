package runtime

import (
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

// A native Generic status fixture is mounted between real contacts. This is
// intentionally not a new management-authoring spell-shield application path.
func targetMarkShieldState(t *testing.T, c model.CompileRequest, r model.RunRequest, count int) *genericRunState {
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
	duration := s.durationMs
	s.durationMs = r.DriverPlan.SkillActions[0].FirstAtMs + 250
	if err := s.runLoop(); err != nil {
		t.Fatal(err)
	}
	s.durationMs = duration
	s.stopReasonSet = false
	s.stopReason = ""
	s.publishBasicAttackWait()
	for i := 0; i < count; i++ {
		definition := "shield:spell"
		if i > 0 {
			definition = "shield:other"
		}
		if err := s.applyProviderInstanceWithRef("target", "target", definition, definition, 0, false, nil); err != nil {
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
		done := s.buildDoneResult()
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
	done := s.buildDoneResult()
	if done.TargetMarkSummary.SkillCount != 1 || done.TargetMarkSummary.DamageBlockedCount != 1 || done.Summary.SourceDamageDealt != 100 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 100 || len(done.FinalSnapshot.Combatants[1].Providers) != 0 {
		t.Fatal(done.Summary, done.TargetMarkSummary, done.FinalSnapshot.Combatants[1].Providers)
	}
	if len(s.skillHitLedger) != 0 || len(s.skillUses["skill:q"].contacts) != 1 || len(targetMarkRows(done)) != 1 {
		t.Fatal("local shield polluted root contact/ledger")
	}
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindSkillHit && item.Data["skillKey"] == "q" && item.Data["blocked"] != float64(0) {
			t.Fatal("changed original blocked fact", item)
		}
	}
}

func TestTargetMarkExactExpiryAndMissKeepTheCorrectWindow(t *testing.T) {
	for _, hitAt := range []int64{4249, 4250, 4251} {
		c, r := targetMarkInput(true, false)
		r.DriverPlan.SkillActions[1].FirstAtMs = hitAt - 250
		r.StopPolicy.DurationMs = hitAt
		done := authoringRun(t, c, r)
		want := int64(0)
		damage, mana := 100.0, 80.0
		if hitAt == 4249 {
			want, damage, mana = 1, 210, 100
		}
		if done.TargetMarkSummary.ConsumedCount != want || done.Summary.SourceDamageDealt != damage || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != mana {
			t.Fatal(hitAt, done.Summary, done.TargetMarkSummary)
		}
	}
	c, r := targetMarkInput(true, false)
	r.DriverPlan.SkillActions[1].HitBindings[0].Preset = "MISS"
	done := authoringRun(t, c, r)
	if done.TargetMarkSummary.ConsumedCount != 0 || done.Summary.SourceDamageDealt != 0 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 80 {
		t.Fatal(done.Summary, done.TargetMarkSummary)
	}
	bag := sourceProviderState(t, done.FinalSnapshot, "w")
	target := bag["targetState"].(map[string]any)
	if target["values"].(map[string]any)["mark"] != float64(1) || target["expireAt"].(map[string]any)["mark"] != float64(4250) {
		t.Fatal(bag)
	}
}

func TestTargetMarkDeathEdgesDoNotForgeSecondKillOrVamp(t *testing.T) {
	for _, rootDamage := range []float64{150, 30} {
		c, r := targetMarkInput(true, false)
		ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeDamageTaken, Domain: "event"})
		c.Combatants[1].Attributes["hp"] = authoringSlot(100)
		c.Combatants[1].Attributes["magic_resistance"] = authoringSlot(0)
		c.SharedProviders[2].Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = timedShieldExpr(rootDamage)
		// W's own base130+AP90=220, independent of the triggering Q.
		done := authoringRun(t, c, r)
		vampNear(t, "post-defense total", done.Summary.SourceDamageDealt, rootDamage+220)
		vampNear(t, "actual loss", done.Summary.TargetHpLoss, 100)
		want := rootDamage * .2
		if rootDamage == 30 {
			want += 44
		}
		vampNear(t, "death-qualified vamp", *done.Summary.SourceVampHealing, want)
		if done.TargetMarkSummary.ConsumedCount != 1 || done.Summary.TargetFinalHp != 0 || done.FinalSnapshot.Combatants[0].Resources["mana"].Current != 100 {
			t.Fatal(done.Summary, done.TargetMarkSummary)
		}
		kills := map[string]float64{}
		for _, item := range done.Evidence.Items {
			if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == model.EventTypeDamageTaken && item.Data["target"] == "target" {
				if ref, ok := item.Data["operationRef"].(string); ok {
					kills[ref] = item.Data["killed"].(float64)
				}
			}
			if item.Kind == model.EvidenceKindVamp && item.Ref == "w.detonate" && rootDamage == 150 && item.Data["skippedReason"] != "target_was_dead" {
				t.Fatal(item)
			}
		}
		rootKilled, markKilled := float64(1), float64(0)
		if rootDamage == 30 {
			rootKilled, markKilled = 0, 1
		}
		if len(kills) != 3 || kills["q.root"] != rootKilled || kills["w.detonate"] != markKilled || kills["w.root"] != 0 {
			t.Fatal("kill fact moved from its real HP transition", kills)
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
			var s *genericRunState
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
			if s.targetMarkSummary.ConsumedCount != 0 || s.combatants["source"].resources["mana"].Current != 80 {
				t.Fatal("group facts or recovery escaped rollback", s.targetMarkSummary)
			}
			if s.combatants["source"].providerState["w"].targetValues["mark"] != 1 {
				t.Fatal("mark escaped failed group rollback")
			}
			for _, row := range s.damageRecords {
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

func TestTargetMarkNamedOwnFormulaAndHiddenRuntimeParameter(t *testing.T) {
	build := func() (model.CompileRequest, model.RunRequest) {
		c, r := targetMarkInput(true, false)
		c.Formulas = append(c.Formulas, formuladefinition.FromExpr("mark_amount", "w", authoringBinary("add", authoringRead("ability.param.base"), authoringBinary("mul", authoringConst(.9), authoringRead("source.attr.ability_power.resolved"))), map[string]float64{"base": 130}))
		c.SharedProviders[1].Abilities[3].ListenerSpec.Operations[0].TargetMark.Damage.Amount = &model.GenericFormulaExpr{Op: "ref", Ref: "mark_amount"}
		return c, r
	}
	c, r := build()
	done := authoringRun(t, c, r)
	if done.Summary.SourceDamageDealt != 210 {
		t.Fatal(done.Summary)
	}
	for _, kind := range []string{"foreign_skill", "scene_parameter"} {
		t.Run(kind, func(t *testing.T) {
			bad, _ := build()
			if kind == "foreign_skill" {
				bad.Formulas[len(bad.Formulas)-1].SkillKey = "q"
			} else {
				for i := range bad.Formulas[len(bad.Formulas)-1].Parameters {
					p := &bad.Formulas[len(bad.Formulas)-1].Parameters[i]
					p.ValueMode = "RUNTIME_INPUT"
					p.Value = nil
					p.RuntimeSource = &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: model.Float64Ptr(130)}
				}
			}
			if result := compilebundle.CompileGeneric(bad); result.OK {
				t.Fatal("hidden runtime/foreign named binding accepted")
			}
		})
	}
}
