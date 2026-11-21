package lifecycle

import (
	"testing"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func TestProjectDynamicReturnsSnapshotContextErrorBeforeMarkingMutation(t *testing.T) {
	compiled := &plan.CompiledSession{Providers: []plan.CompiledProvider{{
		ProviderKey: "effect", AtomicDynamic: true, HasModifierSnapshots: true,
	}}}
	executor := New(compiled, nil, nil, "")
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "snapshot context failed")
	reads := &providerContextFailure{err: &failure}
	var live effectpkg.InstanceState
	stage := effectpkg.StageInstances(live, 100)
	mutations := []Mutation{{Kind: "apply", DefinitionRef: "effect", SourceKey: "source", TargetKey: "target"}}
	var projection Projection
	dirty := false
	changed, err := executor.ProjectDynamic(ProjectionInput{Now: 100, State: &projection, Reads: reads,
		Owners: [2]OwnerProjection{{Key: "target", Instances: &stage, Dirty: &dirty, Mutations: mutations}}})
	if err != &failure || changed || dirty || len(projection.changes) != 0 ||
		stage.Providers().Len() != 0 || mutations[0].Projected || mutations[0].ProviderRef != "" ||
		reads.source != "source" || reads.target != "target" {
		t.Fatal("snapshot preparation failure must return the original error without projecting its mutation", err, changed, projection.changes, mutations)
	}
}
