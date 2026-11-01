package lifecycle

import (
	"testing"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type terminalFailureExecution struct {
	bag       effectpkg.BagChange
	published bool
	held      bool
	recorded  bool
}

func (*terminalFailureExecution) AnchoredCooldownBlocked(string, string) bool { return false }
func (*terminalFailureExecution) AnchoredConditionBlocked(string, string, plan.CompiledAbility, string) (bool, *model.EngineError) {
	return false, nil
}
func (execution *terminalFailureExecution) RunAnchoredFrame(invocation AnchoredInvocation) (bool, *model.EngineError) {
	execution.bag.LazyExpireProviderTargetState(10)
	execution.held = execution.bag.TargetValues().At("mark") == 1
	failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "tail failed")
	return execution.published, &failure
}
func (execution *terminalFailureExecution) ReleaseAnchoredHold(payload effectpkg.AnchoredPayload, settled bool) {
	ReleaseAnchoredHold(payload, execution.bag, settled)
}
func (execution *terminalFailureExecution) RecordAnchoredTick(AnchoredInvocation) {
	execution.recorded = true
}

func TestAnchoredTerminalTailFailureReleasesOnlyPublishedHold(t *testing.T) {
	for _, published := range []bool{false, true} {
		t.Run(map[bool]string{false: "frame_failed", true: "published_tail_failed"}[published], func(t *testing.T) {
			state := effectpkg.RestoreBags(map[string]interface{}{
				"p": map[string]interface{}{
					"targetState": map[string]interface{}{
						"target":   "target",
						"values":   map[string]interface{}{"mark": float64(1)},
						"expireAt": map[string]interface{}{"mark": float64(10)},
					},
				},
			})
			bag := state.Edit("p", false)
			bag.Ensure()
			bag.BindFieldDefs(effectpkg.CompileFields(map[string]plan.CompiledProviderStateField{
				"mark": {DurationMs: 10, DefaultValue: 0},
			}))
			generation := bag.BumpAnchoredTickGeneration("mark")
			compiled := plan.CompiledSession{}
			executor := New(&compiled, nil, nil, "")
			execution := &terminalFailureExecution{bag: bag, published: published}
			payload := effectpkg.AnchoredPayload{OwnerKey: "source", ProviderRef: "p", SourceKey: "source",
				TargetKey: "target", AnchorStateKey: "mark", Generation: generation, ExpectedExpireAt: 10}
			err := executor.RunAnchoredTick(effectpkg.Provider{ProviderRef: "p", Source: "source"},
				plan.CompiledAbility{TickSpec: &plan.CompiledTickSpec{IntervalMs: 10}}, payload, bag, 10, execution)
			if err == nil || !execution.held || execution.recorded {
				t.Fatalf("terminal failure lost its original boundary: err=%v held=%v recorded=%v", err, execution.held, execution.recorded)
			}
			bag.LazyExpireProviderTargetState(10)
			expected := 1.0
			if published {
				expected = 0
			}
			if actual := bag.TargetValues().At("mark"); actual != expected {
				t.Fatalf("published=%v: target state=%v, want %v", published, actual, expected)
			}
		})
	}
}
