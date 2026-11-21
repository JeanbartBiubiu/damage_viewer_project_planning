package operation

import (
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type failingNumericContext struct {
	NumericExecution
	err   *model.EngineError
	owner Owner
}

func (r failingNumericContext) NumericContext(planbundle.CompiledAbility) (formula.GenericEvalContext, *model.EngineError) {
	return formula.GenericEvalContext{}, r.err
}

func (r failingNumericContext) NumericOwner(string) Owner { return r.owner }

type numericPreparationSpy struct {
	Preparation
	commands int
}

func (*numericPreparationSpy) NumericFailure() (bool, *model.EngineError) { return false, nil }

func (s *numericPreparationSpy) PrepareNumericOperation(*planbundle.CompiledOperation) (bool, *model.EngineError) {
	s.commands++
	return true, nil
}

func TestNumericConditionContextFailureStopsBeforeCommandPreparation(t *testing.T) {
	want := &model.EngineError{Path: "projection.original"}
	preparation := &numericPreparationSpy{}
	executor := New(nil, nil, "", false)
	ops := []planbundle.CompiledOperation{{HasCondition: true}, {}}
	got := executor.Execute(&Frame{}, Input{}, failingNumericContext{err: want}, preparation, planbundle.CompiledAbility{}, ops)
	if got != want || preparation.commands != 0 {
		t.Fatalf("got error %p and %d prepared commands, want original error %p and no preparation", got, preparation.commands, want)
	}
}

func TestDamageModifierContextFailureLeavesFirstPerCastAvailable(t *testing.T) {
	want := &model.EngineError{Path: "projection.original"}
	var instances effectpkg.InstanceChangeSet
	instances.MountDamageCompiled("source", "buff", planbundle.CompiledModifier{
		Kind: "pipeline", Command: "damage", Channel: "all_damage", Stage: "outgoing",
		Bucket: "first_per_cast", ModifierKey: "first", HasValue: true, ValuePolicy: "add",
	})
	state := Frame{}
	evidence := []map[string]interface{}{{"stage": "prior"}}
	executor := New(&planbundle.CompiledSession{}, nil, "", true)
	reads := failingNumericContext{err: want, owner: Owner{Instances: &instances}}
	_, records, got := executor.PipelineModifiers(&state, Input{}, reads, "source", "source", "target", "damage", "outgoing", 10, planbundle.CompiledAbility{}, "", nil, evidence)
	if got != want || len(state.FirstPerCast()) != 0 || len(records) != 1 || records[0]["stage"] != "prior" {
		t.Fatalf("got error %p, first-per-cast usage %v and evidence %v, want original error %p and unchanged usage and evidence", got, state.FirstPerCast(), records, want)
	}
}
