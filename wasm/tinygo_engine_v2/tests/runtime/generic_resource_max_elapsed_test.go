// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	testing "testing"
	model "tinygo_engine_v2/internal/model"
)

func coldHealthMomentInput(t *testing.T, endpoint int64, lethal bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := permanentResourceMaxInput(t, 655, 160)
	setCombatantAttr(&c, &r, "target", "hp", model.AttributeSlotDef{Base: 1000, Max: 1160, Resolved: 1160, Current: 1160})
	addPermanentSkillSource(&c, &r, 1, "target_cold_health", "character", model.ModifierDefinition{ModifierKey: "permanent_hp", Kind: "resource_max", Target: "self.attr.hp", ValuePolicy: "add", Value: authoringConst(160), CurrentValuePolicy: "preserve_initial_current"})
	for i := len(c.SharedProviders) - 2; i < len(c.SharedProviders); i++ {
		c.SharedProviders[i].SkillKey = "target_cold_health"
	}
	addMixedSpell(&c, &r, "elapsed_control", 0, 1125, false)
	parent := &c.SharedProviders[len(c.SharedProviders)-1]
	slow := stunCand("slow", "single_contact", "slow", "")
	slow.Semantic.StatusKey, slow.Semantic.StatusKind, slow.Semantic.Moment = "landing", model.StatusKindMovementSlow, model.SkillHitMomentPersistent
	slow.Operations[0].ProviderDefinitionRef = "landing_slow"
	parent.Abilities[1].Operations[0].SkillHit.Candidates = append(parent.Abilities[1].Operations[0].SkillHit.Candidates, slow)
	if lethal {
		parent.Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = hitConstAmt(2000)
	}
	c.SharedProviders = append(c.SharedProviders, momentSlowProvider())
	r.StopPolicy.DurationMs = endpoint
	r.StopPolicy.StopWhenNoEvents = model.BoolPtr(false)
	r.StopPolicy.StopOnTargetDeath = model.BoolPtr(true)
	r.Sampling.Disabled = true
	return c, r
}

func assertColdHealthResolved(t *testing.T, done model.DoneResult, sourceCurrent, targetCurrent float64) {
	t.Helper()
	for _, actor := range done.FinalSnapshot.Combatants {
		hp := actor.Attributes["hp"]
		maximum, current := 1310.0, sourceCurrent
		if actor.Key == "target" {
			maximum, current = 1160, targetCurrent
		}
		if hp.Base != 1000 || hp.Max != maximum || hp.Current != current || hp.Resolved != current {
			t.Fatal("live reconstruction broke HP current/max/base invariant", actor.Key, hp, "wantCurrent", current)
		}
	}
	if done.ResourceChangeSummary.ChangeCount != 0 || done.ResourceChangeSummary.Source.MaxIncrease != 0 || done.ResourceChangeSummary.Target.MaxIncrease != 0 || done.ResourceChangeSummary.Source.CurrentIncrease != 0 || done.ResourceChangeSummary.Target.CurrentIncrease != 0 || len(*done.ResourceChangeRecords) != 0 {
		t.Fatal("resolved-only rebuild invented a resource change", done.ResourceChangeSummary, done.ResourceChangeRecords)
	}
}

func TestResourceMaxMomentQuietEndpointPreservesColdCurrent(t *testing.T) {
	for _, endpoint := range []int64{1124, 1125, 2124, 2125, 3624, 3625} {
		c, r := coldHealthMomentInput(t, endpoint, false)
		full := authoringRun(t, c, r)
		attacks := float64(endpoint/1000 + 1)
		spell := 0.0
		if endpoint >= 1125 {
			spell = 100
		}
		assertColdHealthResolved(t, full, 655, 1160-attacks*100-spell)
		if full.Summary.SourceDamageDealt != attacks*100+spell || full.Summary.SkillUses.HitCount != boolInt(endpoint >= 1125) || len(recoveryEvidence(full, "resource_max_initialized")) != 2 {
			t.Fatal("quiet refresh changed real combat or initialized capacity twice", full.Summary)
		}
		for _, mode := range []model.RunOutputMode{model.RunOutputSummary, model.RunOutputDetailed} {
			r.OutputMode = mode
			zero := 0
			r.RecordBudget = &model.RecordBudget{MaxResourceChangeRecords: &zero, MaxDamageRecords: &zero, MaxSkillUseRecords: &zero}
			bounded := authoringRun(t, c, r)
			if !reflect.DeepEqual(full.FinalSnapshot, bounded.FinalSnapshot) || !reflect.DeepEqual(full.ResourceChangeSummary, bounded.ResourceChangeSummary) || full.Summary.SourceFinalHp != bounded.Summary.SourceFinalHp || full.Summary.TargetFinalHp != bounded.Summary.TargetFinalHp {
				t.Fatal("record mode changed resolved HP", endpoint, mode)
			}
		}
	}
}

func TestResourceMaxMomentDeathEndpointPreservesZeroResolved(t *testing.T) {
	c, r := coldHealthMomentInput(t, 10000, true)
	done := authoringRun(t, c, r)
	assertColdHealthResolved(t, done, 655, 0)
	if !done.Summary.Execution.TargetKilled || *done.Summary.Execution.TargetKilledAtMs != 1125 || done.Summary.TargetHpLoss != 1160 || done.Summary.DurationMs != 1125 {
		t.Fatal("death or permanent HP changed", done.Summary)
	}
}
