package compile

import (
	"testing"

	"tinygo_engine_v2/internal/model"
)

func finiteExprPtr(v model.GenericFormulaExpr) *model.GenericFormulaExpr { return &v }

func finiteHitAttributeProvider(name string) model.ProviderDefinition {
	duration := constN(2000)
	return model.ProviderDefinition{
		ProviderKey: name, StableID: name, Kind: "status",
		Lifecycle: &model.ProviderLifecycle{DurationMs: &duration, MaxStacks: 1, RefreshPolicy: model.RefreshPolicyReplace, InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "flat", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: constN(-20)}},
	}
}

func finiteHitAttributeCandidate(name string) model.SkillHitCandidate {
	return model.SkillHitCandidate{
		CandidateKey: "flat", EffectOccurrenceKey: "occ", EffectKey: "debuff", ResultKey: "flat",
		Semantic:   model.SkillHitSemantic{ResultType: model.SkillHitResultAttributeChange, Target: model.SkillHitTargetTARGET, Moment: model.SkillHitMomentPersistent},
		Operations: []model.OperationDefinition{{Operation: "apply_provider", Target: model.SelectorTarget, ProviderDefinitionRef: name}},
	}
}

func TestCompileSkillHitFiniteTargetAttributeProvider(t *testing.T) {
	for _, name := range []string{"quartz_defense", "amber_guard"} {
		for _, before := range []bool{false, true} {
			req := minimalValidCompileRequest()
			skillHitTypes(&req)
			req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(finiteHitAttributeCandidate(name))}
			provider := finiteHitAttributeProvider(name)
			if before {
				req.SharedProviders = append([]model.ProviderDefinition{provider}, req.SharedProviders...)
			} else {
				req.SharedProviders = append(req.SharedProviders, provider)
			}
			if result := CompileGeneric(req); !result.OK {
				t.Fatalf("name=%s before=%v: %+v", name, before, result.Result.Errors)
			}
		}
	}
}

func TestCompileSkillHitFiniteTargetAttributeProviderRejectsMixedDefinitions(t *testing.T) {
	mutations := map[string]func(*model.ProviderDefinition, *model.SkillHitCandidate){
		"ability": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Abilities = []model.AbilityDefinition{{AbilityKey: "hidden", Kind: "active"}}
		},
		"listener": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Listeners = []model.ListenerDefinition{{ListenerKey: "hidden", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSkillHit}}, Operations: []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: finiteExprPtr(constN(1))}}}}
		},
		"state": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.InitialStateSchema = map[string]interface{}{"hidden": float64(0)}
		},
		"process": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Processes = []model.ProcessDefinition{{ProcessKey: "hidden"}}
		},
		"kind": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Kind = "character" },
		"control_type": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Types = []string{model.ProviderTypeSpellShield}
		},
		"shield": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.LinkedShieldDefinitionRef = "hidden_shield"
		},
		"status": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.StatusContributions = []model.StatusContributionDefinition{{ResultRef: "hidden", StatusKey: "slow", StatusKind: model.StatusKindMovementSlow, Strength: constN(0.1)}}
		},
		"no_lifecycle": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Lifecycle = nil },
		"zero_duration": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Lifecycle.DurationMs = finiteExprPtr(constN(0))
		},
		"dynamic_duration": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Lifecycle.DurationMs = &model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"}
		},
		"scope":   func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Lifecycle.InstanceScope = "" },
		"stack":   func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Lifecycle.MaxStacks = 2 },
		"refresh": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Lifecycle.RefreshPolicy = "extend" },
		"period":  func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Lifecycle.TickIntervalMs = 1 },
		"ratio": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Modifiers[0].ValuePolicy = "add_percent"
		},
		"pipeline": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Modifiers[0].Kind = "pipeline" },
		"hp":       func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) { p.Modifiers[0].Target = "self.attr.hp" },
		"foreign_target": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Modifiers[0].Target = "target.attr.attack_damage"
		},
		"dynamic_value": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Modifiers[0].Value = model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"}
		},
		"condition": func(p *model.ProviderDefinition, _ *model.SkillHitCandidate) {
			p.Modifiers[0].Condition = finiteExprPtr(constN(1))
		},
		"source_semantic": func(_ *model.ProviderDefinition, c *model.SkillHitCandidate) {
			c.Semantic.Target = model.SkillHitTargetSOURCE
			c.Operations[0].Target = "source"
		},
		"instant_semantic": func(_ *model.ProviderDefinition, c *model.SkillHitCandidate) {
			c.Semantic.Moment = model.SkillHitMomentInstant
		},
		"target_mismatch": func(_ *model.ProviderDefinition, c *model.SkillHitCandidate) { c.Operations[0].Target = "self" },
		"mixed_damage": func(_ *model.ProviderDefinition, c *model.SkillHitCandidate) {
			c.Operations = append(c.Operations, model.OperationDefinition{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: finiteExprPtr(constN(1))})
		},
	}
	for name, mutate := range mutations {
		for _, before := range []bool{false, true} {
			t.Run(name+"/"+map[bool]string{false: "later", true: "earlier"}[before], func(t *testing.T) {
				req := minimalValidCompileRequest()
				skillHitTypes(&req)
				provider := finiteHitAttributeProvider("flat_defense")
				candidate := finiteHitAttributeCandidate(provider.ProviderKey)
				mutate(&provider, &candidate)
				req.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(candidate)}
				if before {
					req.SharedProviders = append([]model.ProviderDefinition{provider}, req.SharedProviders...)
				} else {
					req.SharedProviders = append(req.SharedProviders, provider)
				}
				if result := CompileGeneric(req); result.OK {
					t.Fatal("mixed persistent attribute definition was accepted")
				}
			})
		}
	}
}
