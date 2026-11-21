package lifecycle

import (
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type linkedPreparationFixture struct {
	order          []string
	failure        *model.EngineError
	contextFailure *model.EngineError
	stage          effectpkg.InstanceChangeSet
	mutations      []Mutation
}

func (f *linkedPreparationFixture) ShieldDeadline(plan.CompiledOperation, plan.CompiledAbility) (int64, *model.EngineError) {
	f.order = append(f.order, "deadline")
	return 200, f.failure
}
func (f *linkedPreparationFixture) LinkedShieldContext(plan.CompiledAbility, string, string) (formula.GenericEvalContext, *model.EngineError) {
	f.order = append(f.order, "context")
	return formula.GenericEvalContext{}, f.contextFailure
}
func (f *linkedPreparationFixture) LinkedShieldStaging(string) LinkedShieldStage {
	f.order = append(f.order, "stage")
	return LinkedShieldStage{Instances: &f.stage, Mutations: f.mutations}
}

func TestLinkedShieldValidatesBeforeReadsAndBorrowsStageAfterDeadline(t *testing.T) {
	for _, fail := range []string{"amount", "deadline", "context", ""} {
		t.Run(fail, func(t *testing.T) {
			compiled := &plan.CompiledSession{Providers: []plan.CompiledProvider{{ProviderKey: "linked", ShieldDefinitionRef: "shield"}}}
			identities := effectpkg.NewIdentityRegistry()
			executor := New(compiled, nil, &identities, "session")
			f := &linkedPreparationFixture{stage: effectpkg.StageInstances(effectpkg.NewInstances(effectpkg.ProviderList{}, effectpkg.ShieldList{}.Append(effectpkg.Shield{ShieldRef: "old", DefinitionRef: "shield", LifecycleProviderRef: "prior", Source: "source", Owner: "target", Remaining: 10}), effectpkg.AttributeResolver{}, effectpkg.DamageResolver{}, effectpkg.ResourceContributions{}), 100)}
			failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "deadline failed")
			amount := float64(0)
			wantOrder := []string{"deadline", "context", "stage"}
			if fail == "amount" {
				amount, wantOrder = -1, nil
			}
			if fail == "deadline" {
				f.failure, wantOrder = &failure, []string{"deadline"}
			}
			if fail == "context" {
				f.contextFailure, wantOrder = &failure, []string{"deadline", "context"}
			}
			result, err := executor.ExecuteLinkedShield(plan.CompiledOperation{ShieldRef: "shield", HasShieldDuration: true}, plan.CompiledAbility{}, "source", "target", amount, 100, f)
			if (err != nil) != (fail != "") || !reflect.DeepEqual(f.order, wantOrder) {
				t.Fatal("linked shield changed validation, deadline or stage-borrow order", err, f.order)
			}
			if fail == "context" && (err != &failure || result.Changed || len(result.Mutations) != 0 || result.Expiry != (ShieldExpiry{})) {
				t.Fatal("context failure must preserve the original error and leave the shield unstaged", err, result)
			}
			if fail != "" && f.stage.Shields().Len() != 1 {
				t.Fatal("preparation failure touched the old shield")
			}
			if fail == "" && (f.stage.Shields().Len() != 0 || len(result.Mutations) != 1 || result.Mutations[0].Kind != "expire" || result.Mutations[0].ProviderRef != "prior" || result.Expiry.ShieldRef != "") {
				t.Fatal("zero shield must remove its old association without minting another", result, f.stage.Shields())
			}
		})
	}
}

type invalidDurationPreparation struct{ touched bool }

func (f *invalidDurationPreparation) PrepareDurationRead() *model.EngineError {
	f.touched = true
	return nil
}
func (f *invalidDurationPreparation) DurationProviders(string) effectpkg.ProviderList {
	f.touched = true
	return effectpkg.ProviderList{}
}

func TestProviderDurationRejectsStaticIdentityBeforeDynamicPreparation(t *testing.T) {
	executor, _ := liveEffectCase()
	reads := &invalidDurationPreparation{}
	_, changed, err := executor.PrepareDurationChange(plan.CompiledOperation{}, "source", "source", "provider", 100, reads)
	if err == nil || changed || reads.touched {
		t.Fatal("invalid duration change prepared or read dynamic effects before its original rejection", changed, err, reads)
	}
}
