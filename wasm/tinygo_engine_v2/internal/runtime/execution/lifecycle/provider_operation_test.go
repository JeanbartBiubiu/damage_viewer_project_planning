package lifecycle

import (
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

type providerContextFailure struct {
	err            *model.EngineError
	source, target string
}

func (f *providerContextFailure) ProviderContext(_ plan.CompiledAbility, source, target string) (formula.GenericEvalContext, *model.EngineError) {
	return f.ApplicationContext(source, target)
}

func (f *providerContextFailure) ApplicationContext(source, target string) (formula.GenericEvalContext, *model.EngineError) {
	f.source, f.target = source, target
	return formula.GenericEvalContext{}, f.err
}

func TestPrepareProviderMutationReturnsContextErrorBeforeLifecycleEvaluation(t *testing.T) {
	compiled := &plan.CompiledSession{Providers: []plan.CompiledProvider{{
		ProviderKey: "effect", Lifecycle: &plan.CompiledProviderLifecycle{HasDuration: true},
	}}}
	executor := New(compiled, nil, nil, "")
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "provider context failed")
	reads := &providerContextFailure{err: &failure}
	out, err := executor.PrepareProviderMutation(ProviderPreparationInput{Definition: "effect", Source: "source", Target: "target"}, reads)
	if err != &failure || out.HasExpireAt || out.Contributions.Present() || reads.source != "source" || reads.target != "target" {
		t.Fatal("provider preparation must return the original context error before evaluating duration", err, out, reads)
	}
}
