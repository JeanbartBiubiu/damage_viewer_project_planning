package compile

import (
	"testing"
	"tinygo_engine_v2/internal/model"
)

func closedStatusBindingRequest() model.CompileRequest {
	request := minimalValidCompileRequest()
	skillHitTypes(&request)
	request.TypeCatalog.Types = append(request.TypeCatalog.Types, model.TypeCatalogEntry{Key: "status/bonded", Domain: "status"})
	request.SharedProviders = append(request.SharedProviders, model.ProviderDefinition{
		ProviderKey: "control", Kind: "status", StableID: "control",
		Types:     []string{model.ClosedStatusKindProviderType[model.StatusKindStun]},
		Lifecycle: &model.ProviderLifecycle{DurationMs: processCompileNumber(2000), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: "source_target"},
	})
	candidate := model.SkillHitCandidate{CandidateKey: "control", EffectOccurrenceKey: "control", EffectKey: "control", ResultKey: "control",
		Semantic: model.SkillHitSemantic{ResultType: model.SkillHitResultStatusOperation, Target: model.SkillHitTargetTARGET,
			Moment: model.SkillHitMomentPersistent, StatusOperation: model.StatusOperationApply, StatusKey: "bonded", StatusKind: model.StatusKindStun},
		SpellShieldBlockScope: ptrScope(model.SpellShieldScopeResult),
		Operations:            []model.OperationDefinition{{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "control"}},
	}
	request.SharedProviders[0].Abilities = []model.AbilityDefinition{hitAbility(candidate)}
	return request
}

func TestClosedControlBindsActualDeclaredKeyAndRejectsAmbiguity(t *testing.T) {
	request := closedStatusBindingRequest()
	result := CompileGeneric(request)
	if !result.OK || result.Session.Providers[1].ClosedStatusKey != "bonded" {
		t.Fatalf("actual status key was not bound independently of its stun kind: %+v", result.Result.Errors)
	}
	request.TypeCatalog.Types = request.TypeCatalog.Types[:len(request.TypeCatalog.Types)-1]
	requireProcessCompileError(t, request, "semantic.statusKey")
	request = closedStatusBindingRequest()
	request.TypeCatalog.Types = append(request.TypeCatalog.Types, model.TypeCatalogEntry{Key: "status/another", Domain: "status"})
	candidate := request.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates[0]
	candidate.CandidateKey, candidate.ResultKey, candidate.EffectOccurrenceKey = "other", "other", "other"
	candidate.Semantic.StatusKey = "another"
	request.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates = append(request.SharedProviders[0].Abilities[0].Operations[0].SkillHit.Candidates, candidate)
	requireProcessCompileError(t, request, "semantic.statusKey")
}
