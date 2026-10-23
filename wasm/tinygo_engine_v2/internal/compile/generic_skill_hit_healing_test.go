package compile

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// HealingHitRequestForTest exposes only a synthetic compile fixture to this
// package's external runtime tests; no production symbol is added.
func HealingHitRequestForTest() model.CompileRequest {
	req := automaticBindingCompileRequest()
	skillHitTypes(&req)
	provider := &req.SharedProviders[0]
	provider.Processes[0].Costs = nil
	provider.Processes[0].MomentOperations = nil
	provider.Processes[0].Steps = []model.ProcessStepDefinition{
		{StepKey: "cast", StepType: "DELAY", OccupiesAction: model.BoolPtr(true), DelayMs: processCompileNumber(250)},
		{StepKey: "landing", StepType: "DELAY", OccupiesAction: model.BoolPtr(false), DelayMs: processCompileNumber(250)},
	}
	damage := damageCandidate(ptrScope(model.SpellShieldScopeSkill))
	healing := model.SkillHitCandidate{
		CandidateKey: "wound", EffectOccurrenceKey: "wound", EffectKey: "wound", ResultKey: "healing",
		Semantic:             model.SkillHitSemantic{ResultType: model.SkillHitResultHealingModifier, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentPersistent},
		EventValueConditions: []model.SkillHitEventValueCondition{{Key: model.SkillHitValueBlocked, Comparator: "eq", Value: constN(0)}},
		Operations:           []model.OperationDefinition{{Operation: "apply_provider", Target: model.SelectorTarget, ProviderDefinitionRef: "synthetic:wound"}},
	}
	hit := hitAbility(damage, healing)
	hit.SkillKey, hit.Operations[0].SkillHit.SkillKey = provider.SkillKey, provider.SkillKey
	provider.Abilities = append(provider.Abilities, hit)
	mount := req.Combatants[0].Providers[0]
	req.Rules.SkillActionBindings[0].HitBindings = []model.SkillActionHitBinding{{HitBindingKey: "landing", ProcessKey: "cast", Moment: model.ProcessMomentDefinition{MomentType: "STEP_EXECUTION", StepKey: processCompileString("landing")}, HitAbilityRef: "source.provider[" + mount.ProviderRef + "].ability[skill_hit]"}}
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{
		ProviderKey: "synthetic:wound", StableID: "synthetic:wound", SkillKey: provider.SkillKey, Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: processCompileNumber(4000), MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace, InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "received", Kind: "pipeline", Command: "heal", HealDirection: model.HealReceived, HealCategory: model.HealAny, HealGroupKey: "synthetic:wounds", HealGroupCalculationMode: model.HealGroupRatioMax, ValuePolicy: "add_percent", Value: constN(-.4)}},
	})
	return req
}

func TestCompileSkillHitFiniteHealingProviderRejectsIncompleteGraph(t *testing.T) {
	mutations := map[string]func(*model.CompileRequest, *model.SkillHitDefinition, *model.ProviderDefinition){
		"missing_witness": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates = h.Candidates[1:]
		},
		"late_witness": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0], h.Candidates[1] = h.Candidates[1], h.Candidates[0]
		},
		"result_before_skill": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0].SpellShieldBlockScope = ptrScope(model.SpellShieldScopeResult)
		},
		"false_witness": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0].ParticipationCondition = processCompileNumber(0)
		},
		"dynamic_witness": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0].ParticipationCondition = &model.GenericFormulaExpr{Op: "read", Path: "target.attr.hp.current"}
		},
		"first_contact_witness": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0].EventValueConditions = append(h.Candidates[0].EventValueConditions, model.SkillHitEventValueCondition{Key: model.SkillHitValueFirstContact, Comparator: "eq", Value: constN(1)})
		},
		"witness_quota": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.RuleGroups = []model.SkillHitRuleGroup{{RuleKey: "once", CandidateKeys: []string{h.Candidates[0].CandidateKey}, OncePerUse: &model.OncePerUseLimit{GroupKey: "once", Scope: model.OncePerUseScopeProviderTarget}}}
		},
		"healing_quota": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.RuleGroups = []model.SkillHitRuleGroup{{RuleKey: "once", CandidateKeys: []string{h.Candidates[1].CandidateKey}, OncePerUse: &model.OncePerUseLimit{GroupKey: "once", Scope: model.OncePerUseScopeProviderTarget}}}
		},
		"witness_condition": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0].Operations[0].Condition = processCompileNumber(1)
		},
		"witness_repeat": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0].Operations[0].RepeatCount = 1
		},
		"witness_nested": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[0].Operations[0].AbilityRef = "source.provider[champion:source_demo].ability[initial]"
		},
		"missing_blocked": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].EventValueConditions = nil
		},
		"blocked_one": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].EventValueConditions[0].Value = constN(1)
		},
		"extra_event_condition": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].EventValueConditions = append(h.Candidates[1].EventValueConditions, model.SkillHitEventValueCondition{Key: model.SkillHitValueFirstContact, Comparator: "eq", Value: constN(1)})
		},
		"healing_false": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].ParticipationCondition = processCompileNumber(0)
		},
		"healing_provider_read": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].ParticipationCondition = processCompileNumber(1)
			h.Candidates[1].ParticipationProviderRef = "champion:source_demo"
		},
		"non_null_healing_scope": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].SpellShieldBlockScope = ptrScope(model.SpellShieldScopeResult)
		},
		"empty_healing_scope": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].SpellShieldBlockScope = ptrScope("")
		},
		"source_target": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Semantic.Target = model.SkillHitTargetSOURCE
			h.Candidates[1].Operations[0].Target = "source"
		},
		"instant": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Semantic.Moment = model.SkillHitMomentInstant
		},
		"healing_amount": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Operations[0].Amount = processCompileNumber(0)
		},
		"healing_payload": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Operations[0].Payload = map[string]interface{}{"hidden": 1}
		},
		"healing_condition": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Operations[0].Condition = processCompileNumber(1)
		},
		"healing_instance": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Operations[0].ProviderRef = "previous"
		},
		"healing_repeat": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Operations[0].RepeatTag = "hidden"
		},
		"healing_extra_op": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Operations = append(h.Candidates[1].Operations, model.OperationDefinition{Operation: "heal", Target: "self", Amount: processCompileNumber(1)})
		},
		"missing_definition": func(_ *model.CompileRequest, h *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			h.Candidates[1].Operations[0].ProviderDefinitionRef = "missing"
		},
		"no_binding": func(r *model.CompileRequest, _ *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			r.Rules.SkillActionBindings = nil
		},
		"wrong_skill": func(r *model.CompileRequest, _ *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			r.SharedProviders[0].SkillKey = "another:skill"
		},
		"wrong_owner": func(r *model.CompileRequest, _ *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			r.Combatants[1].Providers = append(r.Combatants[1].Providers, r.Combatants[0].Providers[0])
		},
		"basic_attack": func(r *model.CompileRequest, _ *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			r.SharedProviders[0].Abilities[1].Types = []string{model.AbilityTypeBasicAttack}
		},
		"entry_condition": func(r *model.CompileRequest, _ *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			r.SharedProviders[0].Abilities[1].Operations[0].Condition = processCompileNumber(1)
		},
		"dynamic_parent": func(r *model.CompileRequest, _ *model.SkillHitDefinition, _ *model.ProviderDefinition) {
			r.SharedProviders[0].Lifecycle = &model.ProviderLifecycle{DurationMs: processCompileNumber(5000), MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace}
		},
		"foreign_definition": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.SkillKey = "foreign:skill"
		},
		"type": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Types = []string{model.ProviderTypeSpellShield}
		},
		"kind": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Kind = "champion"
		},
		"ability": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Abilities = []model.AbilityDefinition{{AbilityKey: "hidden", Kind: "active"}}
		},
		"listener": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Listeners = []model.ListenerDefinition{{ListenerKey: "hidden", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit}}}}
		},
		"state": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.InitialStateSchema = map[string]interface{}{"hidden": 0}
		},
		"process": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Processes = []model.ProcessDefinition{{ProcessKey: "hidden"}}
		},
		"shield": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.LinkedShieldDefinitionRef = "shield"
		},
		"missing_duration": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.DurationMs = nil
		},
		"zero_duration": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.DurationMs = processCompileNumber(0)
		},
		"fractional_duration": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.DurationMs = processCompileNumber(.5)
		},
		"dynamic_duration": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.DurationMs = &model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"}
		},
		"periodic": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.TickIntervalMs = 1000
		},
		"scope": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.InstanceScope = ""
		},
		"stack": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.MaxStacks = 2
		},
		"refresh": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Lifecycle.RefreshPolicy = "extend"
		},
		"extra_modifier": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers = append(p.Modifiers, p.Modifiers[0])
		},
		"done": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].HealDirection = model.HealDone
		},
		"direct_only": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].HealCategory = model.HealDirect
		},
		"ratio_add": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].HealGroupCalculationMode = model.HealGroupRatioAdd
		},
		"empty_group": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].HealGroupKey = ""
		},
		"positive_ratio": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].Value = constN(.1)
		},
		"below_minus_one": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].Value = constN(-1.1)
		},
		"infinite_ratio": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].Value = constN(math.Inf(1))
		},
		"hidden_dynamic_ratio": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].Value = model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{constN(1), constN(-.4), {Op: "read", Path: "source.attr.attack_damage.resolved"}}}
		},
		"modifier_condition": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].Condition = processCompileNumber(1)
		},
		"damage_channel": func(_ *model.CompileRequest, _ *model.SkillHitDefinition, p *model.ProviderDefinition) {
			p.Modifiers[0].Channel = "physical"
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			req := HealingHitRequestForTest()
			hit := req.SharedProviders[0].Abilities[1].Operations[0].SkillHit
			mutate(&req, hit, &req.SharedProviders[1])
			if result := CompileGeneric(req); result.OK {
				t.Fatal("accepted incomplete finite healing hit graph")
			}
		})
	}
}

func TestCompileSkillHitFiniteHealingProvider(t *testing.T) {
	for _, before := range []bool{false, true} {
		for _, ratio := range []float64{0, -.4, -1} {
			req := HealingHitRequestForTest()
			req.SharedProviders[1].Modifiers[0].Value = constN(ratio)
			if before {
				req.SharedProviders[0], req.SharedProviders[1] = req.SharedProviders[1], req.SharedProviders[0]
			}
			result := CompileGeneric(req)
			if !result.OK {
				t.Fatalf("before=%v ratio=%v: %+v", before, ratio, result.Result.Errors)
			}
		}
	}
}

func TestCompileSkillHitFiniteHealingProviderAllowsAuthoredOperationRef(t *testing.T) {
	req := HealingHitRequestForTest()
	operation := &req.SharedProviders[0].Abilities[1].Operations[0].SkillHit.Candidates[1].Operations[0]
	operation.Ref = "skills.synthetic_skill.effects.wound.results.healing"
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatal(result.Result.Errors)
	}
	hit := result.Session.Operations[result.Session.Abilities[1].OperationStart].SkillHit
	if actual := result.Session.Operations[hit.Candidates[1].OperationStart].Ref; actual != operation.Ref {
		t.Fatalf("author provenance changed: %q", actual)
	}
	operation.OutputRef = "hidden_output"
	if denied := CompileGeneric(req); denied.OK {
		t.Fatal("author Ref must not authorize OutputRef")
	}
}

func TestCompileSkillHitFiniteHealingProviderStableWitnessVariants(t *testing.T) {
	for _, conditions := range []bool{false, true} {
		req := HealingHitRequestForTest()
		hit := req.SharedProviders[0].Abilities[1].Operations[0].SkillHit
		for i := range hit.Candidates {
			hit.Candidates[i].ParticipationCondition = processCompileNumber(1)
		}
		if !conditions {
			hit.Candidates[0].EventValueConditions = nil
		}
		hit.Candidates[0].Operations[0].Amount = processCompileNumber(0)
		if result := CompileGeneric(req); !result.OK {
			t.Fatal(result.Result.Errors)
		}
	}
}

func TestCompileSkillHitFiniteHealingProviderRejectsEarlierBlockUnitAndEmpowered(t *testing.T) {
	req := HealingHitRequestForTest()
	hit := req.SharedProviders[0].Abilities[1].Operations[0].SkillHit
	prefix := damageCandidate(ptrScope(model.SpellShieldScopeResult))
	prefix.CandidateKey, prefix.EffectOccurrenceKey, prefix.ResultKey = "prefix", "prefix", "prefix"
	hit.Candidates = append([]model.SkillHitCandidate{prefix}, hit.Candidates...)
	if result := CompileGeneric(req); result.OK {
		t.Fatal("earlier RESULT unit was accepted ahead of the SKILL witness")
	}
	req = HealingHitRequestForTest()
	compiled := CompileGeneric(req)
	if !compiled.OK {
		t.Fatal(compiled.Result.Errors)
	}
	compiled.Session.SkillActionBindings[0].HasEmpoweredAttack = true
	compiled.Session.SkillActionBindings[0].EmpoweredAbilityIndex = 1
	ctx := &genericCompileContext{session: &compiled.Session}
	actualHit := compiled.Session.Operations[compiled.Session.Abilities[1].OperationStart].SkillHit
	if healingHitHasOriginalBinding(1, req.SharedProviders[0], actualHit, ctx) {
		t.Fatal("actual empowered payload was accepted by the final identity check")
	}
}
