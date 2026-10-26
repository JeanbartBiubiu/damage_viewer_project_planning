// 跨子系统组合测试只经公开编译、会话和运行入口验证。
package runtime_test

import (
	reflect "reflect"
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	runtimeengine "tinygo_engine_v2/internal/runtime"
)

func attackCooldownReductionInput(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	input, request := continuousAttackInput(1, 10000, 10, 0, 0, 5500)
	addMixedSpell(&input, &request, "own_release", 0, 1, false)
	provider := &input.SharedProviders[len(input.SharedProviders)-1]
	provider.Processes[0].Steps[0].StepType = "IMMEDIATE"
	provider.Processes[0].Steps[0].DelayMs = nil
	provider.Processes[0].Cooldown.DurationMs = authoringConst(7000)
	for _, key := range []string{model.EventTypeBasicAttackHit, "event/source_owner"} {
		found := false
		for _, entry := range input.TypeCatalog.Types {
			found = found || entry.Key == key
		}
		if !found {
			input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: key, Domain: "event"})
		}
	}
	binding := input.Rules.SkillActionBindings[0]
	provider.Listeners = []model.ListenerDefinition{{ListenerKey: "reduce_own", MaxTriggersPerEvent: 1,
		EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
		Operations: []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", AbilityRef: binding.Controls[0].AbilityRef,
			ValuePolicy: "reduce", Amount: timedShieldExpr(1000)}},
	}}
	request.DriverPlan.SkillActions = []model.SkillActionPlan{}
	request.DriverPlan.AutomaticSkills = &model.AutomaticSkillPlan{Rules: []model.AutomaticSkillRule{{RuleKey: "release", BindingKey: binding.BindingKey,
		SortOrder: 0, Target: "target", HitBindings: []model.SkillActionHitPreset{{HitBindingKey: binding.HitBindings[0].HitBindingKey, Preset: "TARGET_HIT"}}, WaitForCooldowns: []string{}}}}
	return input, request
}

func TestAttackCooldownReductionClampsAndWakesRealAutomaticRelease(t *testing.T) {
	input, request := attackCooldownReductionInput(t)
	compiled := authoringCompile(t, input)
	done, err := runtimeengine.RunGeneric(compiled, request)
	if err != nil {
		t.Fatal(err)
	}
	// 0ms主动先开始，首刀已减1000ms；第3秒第四刀把剩余冷却夹到当前时刻。
	if starts := activeAmmoStarts(done); !reflect.DeepEqual(starts, []int64{0, 3000}) {
		t.Fatal("actual cooldown wakeup", starts, done.AutomaticSkillSummary)
	}
	if done.Summary.SourceDamageDealt != 260 || done.Summary.TargetFinalHp != 9740 || done.Summary.BasicAttack.StartedCount != 6 {
		t.Fatal(done.Summary)
	}
	again, err := runtimeengine.RunGeneric(compiled, request)
	if err != nil || !reflect.DeepEqual(done, again) {
		t.Fatal("same-session replay inherited cooldown state", err)
	}
}

func TestAttackCooldownReductionWithoutBasicAttacksLeavesTheCooldownUnchanged(t *testing.T) {
	input, request := attackCooldownReductionInput(t)
	request.DriverPlan.BasicAttack = nil
	done := authoringRun(t, input, request)
	if starts := activeAmmoStarts(done); !reflect.DeepEqual(starts, []int64{0}) {
		t.Fatal("a dormant maintenance listener must not synthesize hits or reduce cooldowns", starts)
	}
	if done.Summary.SourceDamageDealt != 100 || len(done.AttackRecords) != 0 {
		t.Fatal("skill-only execution generated a basic attack", done.Summary, done.AttackRecords)
	}
}

func TestAttackCooldownReductionRejectsUnownedOrUnsupportedOperations(t *testing.T) {
	for _, scenario := range []string{"other_provider", "hit_ability", "no_reference", "no_amount", "wrong_event", "wrong_relation", "target", "wrong_policy", "dynamic", "negative", "fractional", "unsafe", "no_cooldown", "unplanned", "foreign_attack"} {
		t.Run(scenario, func(t *testing.T) {
			input, request := attackCooldownReductionInput(t)
			provider := &input.SharedProviders[len(input.SharedProviders)-1]
			listener := &provider.Listeners[0]
			op := &listener.Operations[0]
			switch scenario {
			case "other_provider":
				op.AbilityRef = request.DriverPlan.BasicAttack.InitialControlAbilityRef
			case "hit_ability":
				op.AbilityRef = input.Rules.SkillActionBindings[0].HitBindings[0].HitAbilityRef
			case "no_reference":
				op.AbilityRef = ""
			case "no_amount":
				op.Amount = nil
			case "wrong_event":
				listener.EventMatcher.All[0] = model.EventTypeBasicAttackStart
			case "wrong_relation":
				input.TypeCatalog.Types = append(input.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/target_owner", Domain: "event"})
				listener.EventMatcher.All[1] = "event/target_owner"
			case "target":
				op.Target = "target"
			case "wrong_policy":
				op.ValuePolicy = "extend"
			case "dynamic":
				op.Amount = authoringAmount(authoringRead("source.attr.hp.current"))
			case "negative":
				op.Amount = timedShieldExpr(-1)
			case "fractional":
				op.Amount = timedShieldExpr(.5)
			case "unsafe":
				op.Amount = timedShieldExpr(9007199254740992)
			case "no_cooldown":
				provider.Processes[0].Cooldown = nil
			case "unplanned":
				request.DriverPlan.AutomaticSkills = nil
			case "foreign_attack":
				request.DriverPlan.BasicAttack.Source = "target"
			}
			result := compilebundle.CompileGeneric(input)
			if !result.OK {
				return
			}
			if _, err := runtimeengine.RunGeneric(result.Session, request); err == nil {
				t.Fatal("unsupported source cooldown mutation was admitted")
			}
		})
	}
}
