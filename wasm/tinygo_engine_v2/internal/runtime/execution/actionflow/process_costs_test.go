package actionflow

import (
	"math"
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	actionpkg "tinygo_engine_v2/internal/runtime/action"
)

type processCostFixture struct {
	current  float64
	present  bool
	fraction bool
	amounts  []float64
	order    []string
}

func (fixture *processCostFixture) ProcessAmount(program formula.GenericProgramID) (float64, *model.EngineError) {
	fixture.order = append(fixture.order, "read")
	if fixture.fraction {
		return fixture.current / 2, nil
	}
	return fixture.amounts[int(program)], nil
}

func (fixture *processCostFixture) ProcessResource(owner, resource string) (float64, bool) {
	fixture.order = append(fixture.order, "resource")
	return fixture.current, fixture.present
}

func (fixture *processCostFixture) PayProcessResource(owner, resource string, amount float64) (float64, *model.EngineError) {
	fixture.order = append(fixture.order, "pay")
	fixture.current -= amount
	return amount, nil
}

func processCostCase(costs ...planbundle.CompiledProcessCost) (ProcessExecutor, *actionpkg.ProcessChangeSet) {
	state, process := processFixture()
	seed := actionpkg.ProcessSeed{Snapshot: process.Snapshot(), Definition: &planbundle.CompiledProcess{Path: "processes[cast]", Costs: costs}, StepIndex: -1}
	process = actionpkg.NewProcess(seed)
	return NewProcessExecutor(&state, Identity{}), actionpkg.StageProcess(process)
}

func TestProcessCostsReadAllRowsFromOnePaymentBeforeView(t *testing.T) {
	executor, changes := processCostCase(
		planbundle.CompiledProcessCost{ResourceKey: "mana", AmountProgram: 0, Path: "costs[0]"},
		planbundle.CompiledProcessCost{ResourceKey: "mana", AmountProgram: 1, Path: "costs[1]"},
	)
	costs := &processCostFixture{current: 10, present: true, fraction: true}
	affordable, err := executor.PrepareCosts(changes, costs, true)
	if err != nil || !affordable || costs.current != 0 || changes.View().Costs().At("mana") != 10 || !reflect.DeepEqual(costs.order, []string{"read", "read", "resource", "pay"}) {
		t.Fatal("later row read a post-payment resource or payment occurred before all checks", affordable, err, costs.current, changes.View().Costs(), costs.order)
	}
}

func TestInvalidSecondCostAndMissingZeroNeverPayEarlierRows(t *testing.T) {
	for _, test := range []struct {
		name    string
		second  float64
		current float64
		present bool
		message string
		path    string
	}{
		{"negative", -1, 10, true, "process cost must be finite and non-negative", "costs[1]"},
		{"not finite", math.Inf(1), 10, true, "process cost must be finite and non-negative", "costs[1]"},
		{"missing zero", 0, 0, false, "process cost requires an explicit finite resource", "combatants.source.resources.mana"},
	} {
		t.Run(test.name, func(t *testing.T) {
			executor, changes := processCostCase(
				planbundle.CompiledProcessCost{ResourceKey: "mana", AmountProgram: 0, Path: "costs[0]"},
				planbundle.CompiledProcessCost{ResourceKey: "mana", AmountProgram: 1, Path: "costs[1]"},
			)
			costs := &processCostFixture{current: test.current, present: test.present, amounts: []float64{0, test.second}}
			allowed, err := executor.PrepareCosts(changes, costs, true)
			if err == nil || allowed || err.Message != test.message || err.Path != test.path || changes.View().Costs().Len() != 0 || costs.current != test.current {
				t.Fatal("invalid cost became a valid zero or paid an earlier row", allowed, err, changes.View().Costs(), costs)
			}
			for _, operation := range costs.order {
				if operation == "pay" {
					t.Fatal("row validation failed after payment", costs.order)
				}
			}
		})
	}
}

func TestCandidateCostsNeverPayAndExplicitZeroRemainsValid(t *testing.T) {
	executor, changes := processCostCase(planbundle.CompiledProcessCost{ResourceKey: "mana", Path: "costs[0]"})
	costs := &processCostFixture{current: 0, present: true, amounts: []float64{0}}
	allowed, err := executor.PrepareCosts(changes, costs, false)
	if err != nil || !allowed || !reflect.DeepEqual(costs.order, []string{"read", "resource"}) || changes.View().Costs().Len() != 0 {
		t.Fatal("candidate paid a resource or rejected an explicit zero cost", allowed, err, costs.order, changes.View().Costs())
	}
}
