package execution

import (
	testing "testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

func singleSkillInput(healing bool) (model.CompileRequest, model.RunRequest) {
	occupies := false
	hp := model.AttributeSlotDef{Base: 1000, Current: 500, Max: 1000, Resolved: 1000}
	zero := model.AttributeSlotDef{}
	actors := []model.CombatantDefinition{{Key: "source", Attributes: map[string]model.AttributeSlotDef{"hp": hp, "armor": zero}, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{{ProviderRef: "caster", DefinitionRef: "skill_source"}}}, {Key: "target", Attributes: map[string]model.AttributeSlotDef{"hp": hp, "armor": zero}, Resources: map[string]model.ResourceSlotDef{}, Providers: []model.CombatantProviderMount{}}}
	initialRef := "source.provider[caster].ability[initial]"
	hitRef := "source.provider[caster].ability[hit]"
	process := model.ProcessDefinition{ProcessKey: "cast", SkillKey: "configured_spell", Steps: []model.ProcessStepDefinition{{StepKey: "delay", StepType: "DELAY", OccupiesAction: &occupies, DelayMs: timedShieldExpr(250)}}, Costs: []model.ProcessCostDefinition{}, Cooldown: &model.ProcessCooldownDefinition{DurationMs: *timedShieldExpr(1000), StartMoment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}}, MomentOperations: []model.ProcessMomentOperations{}}
	provider := model.ProviderDefinition{ProviderKey: "skill_source", Kind: "character", StableID: "configured_spell", Processes: []model.ProcessDefinition{process}, Abilities: []model.AbilityDefinition{{AbilityKey: "initial", Kind: "active", SkillKey: "configured_spell", Types: []string{"ability/spell"}, ProcessControl: &model.ProcessControlDefinition{Action: "INITIAL", ProcessKey: "cast"}}}}
	binding := model.SkillActionBinding{BindingKey: "bound_spell", Source: "source", ProviderRef: "caster", ProviderDefinitionRef: "skill_source", SkillKey: "configured_spell", Controls: []model.SkillActionControl{{Action: "INITIAL", ProcessKey: "cast", AbilityRef: initialRef}}, HitBindings: []model.SkillActionHitBinding{}}
	plan := model.SkillActionPlan{InstructionKey: "cast_once", FirstAtMs: 100, SortOrder: 0, Source: "source", Target: "target", SkillKey: "configured_spell", BindingKey: "bound_spell", Action: "INITIAL", AbilityRef: initialRef, HitBindings: []model.SkillActionHitPreset{}}
	if healing {
		plan.Target = "source"
		threshold := model.GenericFormulaExpr{Op: "lt", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.hp.current"}, *timedShieldExpr(400)}}
		normal := model.GenericFormulaExpr{Op: "gte", Args: threshold.Args}
		provider.Listeners = []model.ListenerDefinition{{ListenerKey: "low_heal", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, Condition: &threshold, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(150), Ref: "low"}}}, {ListenerKey: "normal_heal", EventMatcher: model.TypeMatcher{All: []string{"event/ability_started"}}, Condition: &normal, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(100), Ref: "normal"}}}}
	} else {
		candidate := model.SkillHitCandidate{CandidateKey: "primary", EffectOccurrenceKey: "primary", EffectKey: "primary", ResultKey: "damage", Semantic: model.SkillHitSemantic{ResultType: model.SkillHitResultDamage, Target: "TARGET", Moment: "INSTANT"}, SpellShieldBlockScope: nil, Operations: []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: timedShieldExpr(100), DamageType: "damage/physical", Ref: "primary_damage"}}}
		hit := model.SkillHitDefinition{SkillKey: "configured_spell", Candidates: []model.SkillHitCandidate{candidate}}
		provider.Abilities = append(provider.Abilities, model.AbilityDefinition{AbilityKey: "hit", Kind: "active", SkillKey: "configured_spell", Types: []string{"ability/spell"}, Operations: []model.OperationDefinition{{Operation: model.OperationKindResolveSkillHit, Target: "target", SkillHit: &hit}}})
		binding.HitBindings = []model.SkillActionHitBinding{{HitBindingKey: "primary_hit", ProcessKey: "cast", Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, HitAbilityRef: hitRef}}
		plan.HitBindings = []model.SkillActionHitPreset{{HitBindingKey: "primary_hit", Preset: "TARGET_HIT"}}
	}
	request := model.CompileRequest{SchemaVersion: "generic-p0", SchemaHash: "single_skill_schema", RulesHash: "single_skill_rules", TypeCatalog: model.TypeCatalog{Types: []model.TypeCatalogEntry{{Key: "ability/spell", Domain: "ability"}, {Key: "event/ability_started", Domain: "event"}, {Key: "event/skill_hit", Domain: "event"}, {Key: "damage/physical", Domain: "damage"}}, Relations: []model.TypeRelation{}}, Combatants: actors, SharedProviders: []model.ProviderDefinition{provider}, Rules: model.RulesContainer{SkillActionBindings: []model.SkillActionBinding{binding}}}
	formuladefinition.SetDamageFormula(&request, "damage/physical", formuladefinition.ConstantDefense("1"))
	snapshot := model.Snapshot{SchemaHash: request.SchemaHash, RulesHash: request.RulesHash, Combatants: []model.CombatantSnapshot{}}
	for _, actor := range actors {
		providers := []model.CombatantProviderSnapshot{}
		for _, mount := range actor.Providers {
			providers = append(providers, model.CombatantProviderSnapshot{ProviderRef: mount.ProviderRef, DefinitionRef: mount.DefinitionRef, Source: actor.Key, Owner: actor.Key, Stacks: 1})
		}
		snapshot.Combatants = append(snapshot.Combatants, model.CombatantSnapshot{Key: actor.Key, Attributes: actor.Attributes, Resources: actor.Resources, Providers: providers})
	}
	return request, model.RunRequest{InitialSnapshot: snapshot, DriverPlan: model.DriverPlan{Entries: []model.DriverEntry{}, SkillActions: []model.SkillActionPlan{plan}}, StopPolicy: model.StopPolicy{DurationMs: 1000}}
}

func TestSingleSkillCooldownGateDoesNotPublishRejectedUse(test *testing.T) {
	for _, now := range []int64{999, 1000} {
		request, run := singleSkillInput(false)
		compiled := compilebundle.CompileGeneric(request)
		state, err := newGenericRunState(compiled.Session, run)
		if err != nil {
			test.Fatal(err)
		}
		state.loop.Advance(now)
		state.combatants["source"].cooldowns.Set(actionpkg.AbilityCooldownIdentity("source", run.DriverPlan.SkillActions[0].AbilityRef), 1000, now)
		if err := state.handleSkillAction(0); err != nil {
			test.Fatal(err)
		}
		if now < 1000 {
			if state.actions.ManualAt(0).Summary().RejectedCount != 1 || state.actions.ManualAt(0).Uses().StartedCount != 0 || len(state.skillUses) != 0 || state.actions.ProcessCount() != 0 || state.report.Snapshot().SkillActionRecords[0].UseRef != nil || *state.report.Snapshot().SkillActionRecords[0].Reason != "cooldown_not_ready" {
				test.Fatal(state.report.Snapshot().SkillActionRecords)
			}
		} else if state.actions.ManualAt(0).Summary().AcceptedCount != 1 || state.actions.ManualAt(0).Uses().StartedCount != 1 {
			test.Fatal(state.actions.ManualAt(0).Summary())
		}
	}
}
