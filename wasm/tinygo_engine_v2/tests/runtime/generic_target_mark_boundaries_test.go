// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

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
