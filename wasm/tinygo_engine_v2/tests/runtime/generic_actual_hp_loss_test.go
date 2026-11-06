// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	math "math"
	testing "testing"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
)

func actualHPLossExpiryInput(incoming float64) (model.CompileRequest, model.RunRequest) {
	c, r := ownExpiryInput(500, 1, incoming, 1)
	c.SharedProviders[2].Listeners[1].Condition = authoringAmount(model.GenericFormulaExpr{Op: "gt", Args: []model.GenericFormulaExpr{authoringRead("event.damage.actualHpLoss"), gfConst(0)}})
	r.StopPolicy.DurationMs = 600
	return c, r
}

func TestDamageTakenActualHPLossZeroDoesNotStartWaiting(t *testing.T) {
	c, r := actualHPLossExpiryInput(115)
	done := authoringRun(t, c, r)
	if done.Summary.SourceFinalHp != 1000 || math.Abs(ownShieldRemaining(done)-50) > 1e-9 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	actualSeen := false
	for _, event := range done.Evidence.Items {
		if event.Kind == "provider_state_expired" {
			t.Fatal("shield-only damage started an HP-loss waiting period", event)
		}
		if event.Ref == model.EventTypeDamageTaken && event.Data["target"] == "source" {
			actualSeen = true
			if event.Data["actualHpLoss"] != float64(0) || math.Abs(event.Data["shieldAbsorbed"].(float64)-50) > 1e-9 || event.Data["postDefenseDamage"].(float64) <= 0 {
				t.Fatal(event)
			}
		}
	}
	if !actualSeen {
		t.Fatal("missing real fully absorbed damage event")
	}
}

func TestDamageTakenActualHPLossOverflowStartsWaiting(t *testing.T) {
	c, r := actualHPLossExpiryInput(460)
	done := authoringRun(t, c, r)
	if done.Summary.SourceFinalHp != 900 || ownShieldRemaining(done) != 100 || done.FinalSnapshot.Combatants[0].Attributes["armor"].Resolved != 130 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	expiries, damageEvents := 0, 0
	for _, event := range done.Evidence.Items {
		if event.Kind == "provider_state_expired" {
			expiries++
			if event.TimeMs != 500 {
				t.Fatal(event)
			}
		}
		if event.Ref == model.EventTypeDamageTaken && event.Data["target"] == "source" {
			damageEvents++
			if event.Data["actualHpLoss"] != float64(100) || event.Data["shieldAbsorbed"] != float64(100) || event.Data["postDefenseDamage"] != float64(200) {
				t.Fatal(event)
			}
		}
	}
	if expiries != 1 {
		t.Fatal("expected one actual HP-loss restart", expiries)
	}
	if damageEvents != 1 {
		t.Fatal("expected one real received damage event", damageEvents)
	}
}

func TestDamageTakenActualHPLossLethalIsCappedAndNeverRecharges(t *testing.T) {
	c, r := actualHPLossExpiryInput(4600)
	done := authoringRun(t, c, r)
	if done.Summary.SourceFinalHp != 0 || done.Summary.StopReason != "source_dead" || ownShieldRemaining(done) != 0 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	seen := false
	for _, event := range done.Evidence.Items {
		if event.Kind == "provider_state_expired" {
			t.Fatal("dead source recharged", event)
		}
		if event.Ref == model.EventTypeDamageTaken && event.Data["target"] == "source" {
			seen = true
			if event.Data["actualHpLoss"] != float64(1000) || event.Data["postDefenseDamage"] != float64(2000) {
				t.Fatal("overkill was included in actual HP loss", event)
			}
		}
	}
	if !seen {
		t.Fatal("missing actual lethal receive event")
	}
}

func TestCompileActualHPLossOnlyAdmitsActualDamageTakenListener(t *testing.T) {
	for _, mode := range []string{"received", "instance", "any_only", "active", "initializer", "expiry", "modifier"} {
		t.Run(mode, func(t *testing.T) {
			c, _ := actualHPLossExpiryInput(460)
			p := &c.SharedProviders[2]
			switch mode {
			case "received":
				p.Listeners[1].EventMatcher.All = []string{model.EventTypeBasicAttackReceived, "event/target_owner"}
			case "instance":
				c.TypeCatalog.Types = append(c.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/damage_instance", Domain: "event"})
				p.Listeners[1].EventMatcher.All = []string{"event/damage_instance", "event/target_owner"}
			case "any_only":
				p.Listeners[1].EventMatcher = model.TypeMatcher{All: []string{"event/target_owner"}, Any: []string{model.EventTypeDamageTaken}}
			case "active":
				c.SharedProviders[0].Abilities = append(c.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "read_unowned_fact", Kind: "active", CastCondition: authoringAmount(authoringRead("event.damage.actualHpLoss"))})
			case "initializer":
				p.Listeners[0].Condition = authoringAmount(authoringRead("event.damage.actualHpLoss"))
			case "expiry":
				field := p.InitialStateSchema["wait"].(map[string]interface{})
				ops := field["onExpire"].([]model.OperationDefinition)
				ops[0].Amount = authoringAmount(authoringRead("event.damage.actualHpLoss"))
			case "modifier":
				c.SharedProviders[1].Modifiers[0].Value = authoringRead("event.damage.actualHpLoss")
			}
			if compile.CompileGeneric(c).OK {
				t.Fatal("unqualified actual HP-loss context admitted", mode)
			}
		})
	}
}
