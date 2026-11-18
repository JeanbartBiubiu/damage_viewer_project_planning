package execution

import (
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func ownCooldownExpiryInput(t *testing.T, window int64, speed float64, duration int64, consume bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := continuousAttackInput(speed, 10000, 10, 0, 0, duration)
	addMixedSpell(&c, &r, "armed", 100, 0, false)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: stateScopeProvider, Domain: "state_scope"})
	setCombatantAttr(&c, &r, "source", "ability_haste", authoringSlot(0))
	provider := &c.SharedProviders[1]
	provider.SkillKey = "armed"
	initialRef := "source.provider[armed].ability[initial]"
	amount := authoringBinary("div", authoringBinary("mul", authoringRead("ability.param.base_cooldown"), authoringConst(100)), authoringBinary("add", authoringConst(100), authoringRead("source.attr.ability_haste.resolved")))
	startCooldown := model.OperationDefinition{Operation: "cooldown_change", Target: "self", AbilityRef: initialRef, ValuePolicy: "set_remaining", Amount: &amount}
	write := func(value float64) model.OperationDefinition {
		return model.OperationDefinition{Operation: "state_change", Target: "self", Ref: "armed", Types: []string{stateScopeProvider}, ValuePolicy: "override", Amount: timedShieldExpr(value)}
	}
	provider.InitialStateSchema = map[string]interface{}{"armed": map[string]interface{}{"valueType": "integer", "defaultValue": float64(0), "maxValue": float64(1), "durationMs": float64(window), "refreshPolicy": "refresh_on_write", "onExpire": []model.OperationDefinition{startCooldown}}}
	provider.Abilities = provider.Abilities[:1]
	provider.Abilities[0].Params = map[string]float64{"base_cooldown": 700}
	provider.Abilities[0].CastCondition = authoringAmount(authoringBinary("eq", authoringRead("provider.state.armed"), authoringConst(0)))
	self := true
	provider.Abilities[0].ProcessControl.RequireExplicitSelfTarget = &self
	provider.Processes[0].Cooldown = nil
	provider.Processes[0].Steps = []model.ProcessStepDefinition{{StepKey: "activate", StepType: "IMMEDIATE", OccupiesAction: model.BoolPtr(false)}}
	provider.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{write(1)}}}
	provider.Listeners = nil
	if consume {
		provider.Listeners = []model.ListenerDefinition{{ListenerKey: "consume", MaxTriggersPerEvent: 1,
			EventMatcher: model.TypeMatcher{All: []string{model.EventTypeBasicAttackHit, "event/source_owner"}},
			Condition:    authoringAmount(authoringBinary("eq", authoringRead("provider.state.armed"), authoringConst(1))),
			Operations:   []model.OperationDefinition{write(0), startCooldown}}}
		bonus := followDamageCandidate("armed_bonus", "", "")
		bonus.ParticipationProviderRef = "armed"
		bonus.ParticipationCondition = authoringAmount(authoringBinary("eq", authoringRead("provider.state.armed"), authoringConst(1)))
		bonus.Operations[0].Amount = timedShieldExpr(20)
		c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates = append(c.SharedProviders[0].Abilities[2].Operations[0].SkillHit.Candidates, bonus)
	}
	c.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{}
	r.DriverPlan.SkillActions[0].HitBindings = []model.SkillActionHitPreset{}
	r.DriverPlan.SkillActions[0].Target = "source"
	return c, r
}

func armedInitialAgain(r *model.RunRequest, at int64, key string) {
	next := r.DriverPlan.SkillActions[0]
	next.FirstAtMs, next.InstructionKey = at, key
	r.DriverPlan.SkillActions = append(r.DriverPlan.SkillActions, next)
}

func armedCooldownReady(done model.DoneResult) int64 {
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key == "source" {
			value, exists := actor.Cooldowns["source.provider[armed].ability[initial]"].(map[string]interface{})
			if !exists {
				return -1
			}
			return numericAsInt64(value["readyAtMs"])
		}
	}
	return -1
}

func TestOwnCooldownExpiryStartsAtDeadlineBeforeSameTimeCastAndHit(t *testing.T) {
	c, r := ownCooldownExpiryInput(t, 500, 5.0/3.0, 700, true)
	armedInitialAgain(&r, 200, "while_armed")
	armedInitialAgain(&r, 600, "at_expiry")
	done := runSkillHit(t, c, r)
	if armedCooldownReady(done) != 1300 || done.Summary.SkillActions.AcceptedCount != 1 || done.Summary.SkillActions.RejectedCount != 2 {
		t.Fatal(done.Summary, done.FinalSnapshot)
	}
	if len(done.SkillActionRecords) != 3 || done.SkillActionRecords[1].Reason == nil || *done.SkillActionRecords[1].Reason != "condition_false" || done.SkillActionRecords[2].Reason == nil || *done.SkillActionRecords[2].Reason != "cooldown_not_ready" {
		t.Fatal(done.SkillActionRecords)
	}
	if done.Summary.SourceDamageDealt != 20 {
		t.Fatal("deadline must not rearm or consume twice", done.Summary)
	}
}

func TestOwnCooldownConsumeCancelsOldExpiryAndAllowsNextUse(t *testing.T) {
	c, r := ownCooldownExpiryInput(t, 3000, 1, 3300, true)
	armedInitialAgain(&r, 1800, "after_cooldown")
	done := runSkillHit(t, c, r)
	if armedCooldownReady(done) != 2700 || done.Summary.SkillActions.AcceptedCount != 2 || done.Summary.SkillActions.RejectedCount != 0 {
		t.Fatal("old 3100ms expiry must not restart the consumed second window", done.Summary, done.FinalSnapshot)
	}
}

func TestOwnCooldownExpiryReadsActualEndTimeHasteAndInitialParameters(t *testing.T) {
	c, r := ownCooldownExpiryInput(t, 500, 1, 700, false)
	state, err := newGenericRunState(authoringCompile(t, c), r)
	if err != nil {
		t.Fatal(err)
	}
	runPrefixThroughForTest(t, state, 599)
	actor := state.combatants["source"]
	actor.numbers = actor.numbers.WithAttributes(actor.attributesView().With("ability_haste", authoringSlot(100)))
	state.combatants["source"] = actor
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	if ready := armedCooldownReady(state.buildDoneResult(false)); ready != 950 {
		t.Fatal("haste at expiry must apply to real INITIAL parameter 700", ready)
	}
}

func TestOwnCooldownSetAfterActualSiblingSkillHitKeepsBothInitialIdentities(t *testing.T) {
	c, r := ownCooldownExpiryInput(t, 5000, 1, 500, true)
	addMixedSpell(&c, &r, "contact", 200, 1, false)
	ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: "ability/skill/contact", Domain: "ability"})
	c.SharedProviders[2].Abilities[1].Types = append(c.SharedProviders[2].Abilities[1].Types, "ability/skill/contact")
	c.SharedProviders[1].Listeners[0].EventMatcher.All = []string{model.EventTypeSkillHit, "event/source_owner", "ability/skill/contact"}
	done := runSkillHit(t, c, r)
	if armedCooldownReady(done) != 901 {
		t.Fatal("actual contact at201 must start owned 700ms cooldown using its INITIAL params", done.FinalSnapshot)
	}
	for _, actor := range done.FinalSnapshot.Combatants {
		if actor.Key != "source" {
			continue
		}
		value, present := actor.Cooldowns["source.provider[contact].ability[initial]"].(map[string]interface{})
		if !present || numericAsInt64(value["readyAtMs"]) != 1200 {
			t.Fatal("contact's own cooldown changed", actor.Cooldowns)
		}
	}
}

func TestOwnCooldownExpiryRejectsWrongOwnerAndUnboundedInputs(t *testing.T) {
	for _, variant := range []string{"other_initial", "opponent", "target_amount", "resource_amount", "hp_amount", "initialization", "duration_mutation", "no_actual_initial", "other_owner_mount", "unqualified_skill_hit"} {
		t.Run(variant, func(t *testing.T) {
			c, r := ownCooldownExpiryInput(t, 500, 1, 700, true)
			provider := &c.SharedProviders[1]
			operations := provider.InitialStateSchema["armed"].(map[string]interface{})["onExpire"].([]model.OperationDefinition)
			switch variant {
			case "other_initial":
				operations[0].AbilityRef = authoringRef("initial")
			case "opponent":
				operations[0].Target = "target"
			case "target_amount":
				operations[0].Amount = authoringAmount(authoringRead("target.attr.armor.resolved"))
			case "resource_amount":
				operations[0].Amount = authoringAmount(authoringRead("source.resource.mana.current"))
			case "hp_amount":
				operations[0].Amount = authoringAmount(authoringRead("source.attr.hp.resolved"))
			case "initialization":
				ensureC1CatalogTypes(&c, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
				provider.Listeners[0].EventMatcher.All[0] = model.EventTypeSourceInitialized
			case "duration_mutation":
				provider.Listeners[0].Operations[0].Operation = model.OperationKindStateDurationChange
			case "no_actual_initial":
				r.DriverPlan.SkillActions = nil
			case "other_owner_mount":
				c.Combatants[1].Providers = append(c.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "armed", DefinitionRef: provider.ProviderKey})
			case "unqualified_skill_hit":
				provider.Listeners[0].EventMatcher.All[0] = model.EventTypeSkillHit
			}
			compiled := compilebundle.CompileGeneric(c)
			if compiled.OK {
				if variant != "initialization" && variant != "no_actual_initial" && variant != "unqualified_skill_hit" {
					t.Fatal("invalid cooldown expiry compiled")
				}
				if _, err := runForTest(compiled.Session, r); err == nil {
					t.Fatal("initialization cannot consume a real-hit cooldown")
				}
			}
		})
	}
}
