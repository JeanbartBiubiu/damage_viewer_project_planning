package lifecycle

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

type stateContextFailure struct {
	StateExecution

	bag    effectpkg.BagChange
	err    *model.EngineError
	order  []string
	amount float64
}

func (f *stateContextFailure) StateAmount(formula.GenericProgramID, plan.CompiledAbility) (float64, *model.EngineError) {
	f.order = append(f.order, "amount")
	return f.amount, nil
}

func (f *stateContextFailure) StateContext(plan.CompiledAbility) (formula.GenericEvalContext, *model.EngineError) {
	f.order = append(f.order, "context")
	return formula.GenericEvalContext{}, f.err
}

func (f *stateContextFailure) StateBag(string, string, bool) effectpkg.BagChange {
	f.order = append(f.order, "bag")
	return f.bag
}

func (*stateContextFailure) StateProviders(string) effectpkg.ProviderList {
	return effectpkg.ProviderList{}
}
func (*stateContextFailure) ReadStateBag(string, string, bool) effectpkg.BagView {
	return effectpkg.BagView{}
}

func TestStateContextErrorStopsAtOriginalRead(t *testing.T) {
	for _, tc := range []struct {
		name, scope string
		duration    bool
		amount      float64
		wantValue   float64
	}{
		{name: "owner write", scope: stateScopeProvider, amount: 7, wantValue: 7},
		{name: "target write", scope: stateScopeProviderTarget, amount: 7, wantValue: 7},
		{name: "owner expires", scope: stateScopeProvider, duration: true, amount: 100, wantValue: 0},
		{name: "target expires", scope: stateScopeProviderTarget, duration: true, amount: 100, wantValue: 0},
		{name: "target remains active", scope: stateScopeProviderTarget, duration: true, amount: 25, wantValue: 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var live effectpkg.BagState
			stage := effectpkg.StageBags(&live)
			bag := stage.Edit("provider", true)
			bag.Ensure()
			bag.SetStateValue("mark", 3)
			bag.ActivateProviderTarget("target")
			bag.SetTargetValue("mark", 3)
			failure := model.NewEngineError(model.GenericPhaseRun, model.GenericErrRuntimeInvariantFailed, "state context failed")
			reads := &stateContextFailure{bag: bag, err: &failure, amount: tc.amount}
			input := StateExecutionInput{Owner: "source", Target: "target", Provider: "provider", Now: 100,
				Operation: plan.CompiledOperation{Ref: "mark", HasAmount: true, StateScope: tc.scope, ValuePolicy: "set", OwnerProviderIndex: -1}}
			executor := New(&plan.CompiledSession{}, nil, nil, "")
			var err *model.EngineError
			wantOrder := []string{"amount", "bag", "context"}
			if tc.duration {
				input.Operation.ValuePolicy, input.Operation.Target = "subtract", model.SelectorSelf
				bag.SetExpireAt("mark", 200)
				bag.SetTargetExpireAt("mark", 200)
				err = executor.ExecuteStateDuration(input, reads)
				wantOrder = []string{"bag", "amount", "context"}
			} else {
				err = executor.ExecuteStateWrite(input, reads)
			}
			value := bag.State().At("mark")
			if tc.scope == stateScopeProviderTarget {
				value = bag.ReadTargetValue("mark")
			}
			if err != &failure || value != tc.wantValue || live.Edit("provider", false).Present() || !reflect.DeepEqual(reads.order, wantOrder) {
				t.Fatal("state context failure changed the staged prefix or original read order", err, value, reads.order)
			}
		})
	}
}

type anchoredWriteFixture struct {
	providers effectpkg.ProviderList
	capacity  int
	at        []int64
	ticks     []effectpkg.AnchoredPayload
}

func (f *anchoredWriteFixture) StateProviders(string) effectpkg.ProviderList { return f.providers }
func (f *anchoredWriteFixture) RemainingTimingSlots() int                    { return f.capacity }
func (*anchoredWriteFixture) StageStateExpiry(int64, effectpkg.ExpiryPayload) {
	panic("ordinary anchored preparation must not append the source expiry")
}
func (f *anchoredWriteFixture) StageAnchoredTick(at int64, payload effectpkg.AnchoredPayload) {
	f.at = append(f.at, at)
	f.ticks = append(f.ticks, payload)
}

func TestAnchoredTargetWriteChecksCapacityBeforeGenerationAndKeepsOriginalExpiry(t *testing.T) {
	for _, source := range []string{"caster", ""} {
		t.Run(source, func(t *testing.T) {
			compiled := plan.CompiledSession{
				Providers: []plan.CompiledProvider{{AbilityCount: 1}},
				Abilities: []plan.CompiledAbility{{Kind: "tick", TickSpec: &plan.CompiledTickSpec{
					IntervalMs: 100, AnchorScope: "provider_target", AnchorStateKey: "mark",
				}}},
			}
			executor := New(&compiled, nil, nil, "")
			var state effectpkg.BagState
			bag := state.Edit("period", true)
			bag.Ensure()
			fixture := &anchoredWriteFixture{providers: effectpkg.Providers([]effectpkg.Provider{{
				ProviderRef: "period", DefinitionIndex: 0, Source: source,
			}}), capacity: 1}
			input := AnchoredWriteInput{Owner: "source", Provider: "period", Target: "target", Key: "mark",
				Expires: 500, Now: 100, Stop: 350, Bag: bag}
			err := executor.StageAnchoredTargetWrite(input, fixture, fixture)
			if err == nil || err.BudgetCause != model.BudgetCauseMaxQueueEvents ||
				bag.CurrentAnchoredTickGeneration("mark") != 0 || len(fixture.ticks) != 0 {
				t.Fatal("capacity failure changed the generation or staged a partial series", err, fixture)
			}
			fixture.capacity = 2
			if err := executor.StageAnchoredTargetWrite(input, fixture, fixture); err != nil {
				t.Fatal(err)
			}
			wantSource := source
			if wantSource == "" {
				wantSource = input.Owner
			}
			if len(fixture.ticks) != 2 || fixture.at[0] != 200 || fixture.at[1] != 300 {
				t.Fatal("run window changed the anchored phase", fixture)
			}
			for _, tick := range fixture.ticks {
				if tick.SourceKey != wantSource || tick.ExpectedExpireAt != 500 || tick.Generation != 1 ||
					tick.OwnerKey != input.Owner || tick.ProviderRef != input.Provider || tick.TargetKey != input.Target || tick.AnchorStateKey != input.Key {
					t.Fatal("tick lost the original state identity or complete expiry", tick)
				}
			}
		})
	}
}
