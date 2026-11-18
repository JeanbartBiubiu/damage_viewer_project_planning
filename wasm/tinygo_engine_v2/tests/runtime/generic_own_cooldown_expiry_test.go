package runtime_test

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func TestOwnTimedCounterCooldownPublicDeadlineBeforeRecast(t *testing.T) {
	c, r := continuousAttackInput(5.0/3.0, 10000, 10, 0, 0, 700)
	addMixedSpell(&c, &r, "armed", 100, 0, false)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	provider := &c.SharedProviders[1]
	provider.SkillKey = "armed"
	initialRef := "source.provider[armed].ability[initial]"
	startCooldown := model.OperationDefinition{Operation: "cooldown_change", Target: "self", AbilityRef: initialRef, ValuePolicy: "set_remaining", Amount: timedShieldExpr(700)}
	write := func(value float64) model.OperationDefinition {
		return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "armed", Types: []string{"state_scope/provider"}, ValuePolicy: "override", Amount: timedShieldExpr(value)}
	}
	provider.InitialStateSchema = map[string]interface{}{"armed": map[string]interface{}{"valueType": "integer", "defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(500), "refreshPolicy": "refresh_on_write", "onExpire": []model.OperationDefinition{startCooldown}}}
	provider.Abilities = provider.Abilities[:1]
	provider.Abilities[0].CastCondition = authoringAmount(authoringBinary("eq", authoringRead("provider.state.armed"), authoringConst(0)))
	self := true
	provider.Abilities[0].ProcessControl.RequireExplicitSelfTarget = &self
	provider.Processes[0].Cooldown = nil
	provider.Processes[0].Steps = []model.ProcessStepDefinition{{StepKey: "activate", StepType: "IMMEDIATE", OccupiesAction: model.BoolPtr(false)}}
	provider.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{write(1)}}}
	provider.Listeners = []model.ListenerDefinition{{ListenerKey: "consume", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
		Condition:    authoringAmount(authoringBinary("eq", authoringRead("provider.state.armed"), authoringConst(1))),
		Operations:   []model.OperationDefinition{write(0), startCooldown}}}
	c.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{}
	r.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	r.DriverPlan.SkillActions[0].Target = "source"
	second := r.DriverPlan.SkillActions[0]
	second.InstructionKey, second.FirstAtMs = "at_expiry", 600
	r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, second)
	done := authoringRun(t, c, r)
	if done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillActions.RejectedCount != 1 || len(done.SkillActionRecords) != 2 || done.SkillActionRecords[1].Reason == nil || *done.SkillActionRecords[1].Reason != "cooldown_not_ready" {
		t.Fatal(done.Summary, done.SkillActionRecords)
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key != "source" {
			continue
		}
		cooldown, present := actor.Cooldowns[initialRef].(map[string]interface{})
		if !present || cooldown["readyAtMs"] != int64(1300) {
			t.Fatal(actor.Cooldowns)
		}
	}
}
