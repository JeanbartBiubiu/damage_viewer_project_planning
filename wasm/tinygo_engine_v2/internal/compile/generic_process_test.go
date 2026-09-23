package compile

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func processCompileNumber(value float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: model.Float64Ptr(value)}
}

func processCompileString(value string) *string { return &value }
func processCompileBool(value bool) *bool       { return &value }

func processCompileRequest() model.CompileRequest {
	req := minimalValidCompileRequest()
	provider := &req.SharedProviders[0]
	provider.Abilities = []model.AbilityDefinition{
		{AbilityKey: "initial", Kind: "active", SkillKey: "skill:q", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "cast", Action: "INITIAL"}},
		{AbilityKey: "recast", Kind: "active", SkillKey: "skill:q", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "cast", Action: "RECAST", StepKey: "window"}},
		{AbilityKey: "cancel", Kind: "active", SkillKey: "skill:q", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "cast", Action: "CANCEL", FailureReason: "ACTIVE_CANCELLED"}},
	}
	provider.Processes = []model.ProcessDefinition{{
		ProcessKey: "cast", SkillKey: "skill:q",
		Steps: []model.ProcessStepDefinition{
			{StepKey: "begin", StepType: "IMMEDIATE"},
			{StepKey: "delay", StepType: "DELAY", DelayMs: processCompileNumber(250)},
			{StepKey: "window", StepType: "RECAST", WindowMs: processCompileNumber(1000)},
		},
		Costs:    []model.ProcessCostDefinition{{ResourceKey: "mana", Amount: *processCompileNumber(60)}},
		Cooldown: &model.ProcessCooldownDefinition{DurationMs: *processCompileNumber(1000), StartMoment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}},
		MomentOperations: []model.ProcessMomentOperations{{
			Moment:     model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"},
			Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{Op: "read", Path: "process.actual_cost.mana"}}},
		}},
	}}
	return req
}

func requireProcessCompileError(t *testing.T, req model.CompileRequest, path string) {
	t.Helper()
	result := CompileGeneric(req)
	if result.OK || !hasErrorPath(result.Result.Errors, path) {
		t.Fatalf("expected process compile error at %s, ok=%v errors=%+v", path, result.OK, result.Result.Errors)
	}
}

func TestProcessCompileProjectsStepsCostsAndControl(t *testing.T) {
	req := processCompileRequest()
	req.SharedProviders[0].Processes[0].Costs = append(req.SharedProviders[0].Processes[0].Costs,
		model.ProcessCostDefinition{ResourceKey: "mana", Amount: *processCompileNumber(10)},
		model.ProcessCostDefinition{ResourceKey: "energy", Amount: *processCompileNumber(0)},
	)
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	process := result.Session.Providers[0].Processes[0]
	if process.ProcessKey != "cast" || process.SkillKey != "skill:q" || len(process.Steps) != 3 || len(process.Costs) != 3 || process.InitialAbilityIndex != 0 {
		t.Fatalf("process=%+v", process)
	}
	if !process.Steps[1].HasDelay || !process.Steps[2].HasWindow || process.Steps[0].HasDelay {
		t.Fatalf("steps=%+v", process.Steps)
	}
	for i, want := range []float64{60, 10, 0} {
		value, err := result.Session.Formulas.Eval(process.Costs[i].AmountProgram, formula.GenericEvalContext{})
		if err != nil || value != want {
			t.Fatalf("cost[%d]=%v err=%v", i, value, err)
		}
	}
	control := result.Session.Abilities[1].ProcessControl
	if control == nil || control.ProcessIndex != 0 || control.Action != "RECAST" || control.StepKey != "window" {
		t.Fatalf("control=%+v", control)
	}
}

func TestProcessCompilePreservesMatchingMomentAuthorOrder(t *testing.T) {
	req := processCompileRequest()
	process := &req.SharedProviders[0].Processes[0]
	process.MomentOperations = nil
	for i, reason := range []*string{nil, processCompileString("ACTIVE_CANCELLED"), nil} {
		process.MomentOperations = append(process.MomentOperations, model.ProcessMomentOperations{
			Moment:     model.ProcessMomentDefinition{MomentType: "PROCESS_FAILURE", FailureReason: reason},
			Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: processCompileNumber(float64(i + 1))}},
		})
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	bindings := result.Session.Providers[0].Processes[0].MomentOperations
	for i, binding := range bindings {
		if binding.OperationCount != 1 {
			t.Fatalf("binding[%d]=%+v", i, binding)
		}
		op := result.Session.Operations[binding.OperationStart]
		value, err := result.Session.Formulas.Eval(op.AmountProgram, formula.GenericEvalContext{})
		if err != nil || value != float64(i+1) || (binding.Moment.FailureReason == nil) != (i != 1) {
			t.Fatalf("author order lost at %d: %+v value=%v err=%v", i, binding, value, err)
		}
	}
}

func TestProcessCompileRejectsInvalidDefinitionMatrix(t *testing.T) {
	cases := []struct {
		name, path string
		mutate     func(*model.CompileRequest)
	}{
		{"empty process", "processKey", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].ProcessKey = "" }},
		{"spaced process", "processKey", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].ProcessKey = " cast" }},
		{"missing skill", "skillKey", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].SkillKey = "" }},
		{"duplicate process", "processKey", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes = append(r.SharedProviders[0].Processes, r.SharedProviders[0].Processes[0])
		}},
		{"empty steps", "steps", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].Steps = nil }},
		{"empty step key", "stepKey", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].Steps[0].StepKey = "" }},
		{"duplicate step", "stepKey", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].Steps[1].StepKey = "begin" }},
		{"unknown step", "stepType", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].Steps[0].StepType = "CHANNEL" }},
		{"nonterminal recast", "stepType", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps = append(r.SharedProviders[0].Processes[0].Steps, model.ProcessStepDefinition{StepKey: "extra", StepType: "IMMEDIATE"})
		}},
		{"unrelated delay", "delayMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps[0].DelayMs = processCompileNumber(1)
		}},
		{"missing delay", "delayMs", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].Steps[1].DelayMs = nil }},
		{"missing window", "windowMs", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].Steps[2].WindowMs = nil }},
		{"zero window", "windowMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps[2].WindowMs = processCompileNumber(0)
		}},
		{"negative delay", "delayMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps[1].DelayMs = processCompileNumber(-1)
		}},
		{"fractional delay", "delayMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps[1].DelayMs = processCompileNumber(1.5)
		}},
		{"overflow delay", "delayMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps[1].DelayMs = processCompileNumber(9223372036854775808.0)
		}},
		{"infinite delay", "delayMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps[1].DelayMs = processCompileNumber(math.Inf(1))
		}},
		{"empty cost resource", "resourceKey", func(r *model.CompileRequest) { r.SharedProviders[0].Processes[0].Costs[0].ResourceKey = "" }},
		{"negative cost", "costs[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Costs[0].Amount = *processCompileNumber(-1)
		}},
		{"nonfinite cost", "costs[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Costs[0].Amount = *processCompileNumber(math.NaN())
		}},
		{"missing cost formula", "costs[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Costs[0].Amount = model.GenericFormulaExpr{}
		}},
		{"fractional cooldown", "cooldown.durationMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Cooldown.DurationMs = *processCompileNumber(0.5)
		}},
		{"unknown moment", "momentType", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Moment.MomentType = "NATURAL_END"
		}},
		{"process moment step", "moment.stepKey", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Moment.StepKey = processCompileString("begin")
		}},
		{"reason outside failure", "failureReason", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Moment.FailureReason = processCompileString("CONTROLLED")
		}},
		{"missing step moment key", "startMoment.stepKey", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Cooldown.StartMoment.MomentType = "STEP_START"
		}},
		{"unknown moment step", "startMoment.stepKey", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: processCompileString("missing")}
		}},
		{"delay has no timeout", "startMoment.momentType", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Cooldown.StartMoment = model.ProcessMomentDefinition{MomentType: "STEP_TIMEOUT", StepKey: processCompileString("delay")}
		}},
		{"empty failure reason", "failureReason", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Moment = model.ProcessMomentDefinition{MomentType: "PROCESS_FAILURE", FailureReason: processCompileString("")}
		}},
		{"unknown operation", "operations[0].operation", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Operations[0].Operation = "invented"
		}},
		{"embedded hit", "operations[0].operation", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Operations[0].Operation = "resolve_skill_hit"
		}},
		{"embedded call", "operations[0].abilityRef", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Operations[0].AbilityRef = "self.provider[champion:source_demo].ability[initial]"
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := processCompileRequest()
			tc.mutate(&req)
			requireProcessCompileError(t, req, tc.path)
		})
	}
}

func processCompileChargeRequest() model.CompileRequest {
	req := processCompileRequest()
	req.SharedProviders[0].Processes[0].Steps[2] = model.ProcessStepDefinition{
		StepKey: "window", StepType: "CHARGE", MinimumChargeMs: processCompileNumber(0), MaximumChargeMs: processCompileNumber(1000), ReleaseAtMaximum: processCompileBool(false),
	}
	req.SharedProviders[0].Abilities[1].ProcessControl.Action = "CHARGE_RELEASE"
	return req
}

func TestProcessCompileChargeBoundaries(t *testing.T) {
	for _, automatic := range []bool{false, true} {
		req := processCompileChargeRequest()
		req.SharedProviders[0].Processes[0].Steps[2].ReleaseAtMaximum = &automatic
		result := CompileGeneric(req)
		if !result.OK || result.Session.Providers[0].Processes[0].Steps[2].ReleaseAtMaximum != automatic {
			t.Fatalf("explicit release=%v result=%+v", automatic, result.Result)
		}
	}
	for _, tc := range []struct {
		name, path string
		mutate     func(*model.ProcessStepDefinition)
	}{
		{"missing boolean", "releaseAtMaximum", func(s *model.ProcessStepDefinition) { s.ReleaseAtMaximum = nil }},
		{"missing minimum", "minimumChargeMs", func(s *model.ProcessStepDefinition) { s.MinimumChargeMs = nil }},
		{"negative minimum", "minimumChargeMs", func(s *model.ProcessStepDefinition) { s.MinimumChargeMs = processCompileNumber(-1) }},
		{"zero maximum", "maximumChargeMs", func(s *model.ProcessStepDefinition) { s.MaximumChargeMs = processCompileNumber(0) }},
		{"minimum exceeds maximum", "minimumChargeMs", func(s *model.ProcessStepDefinition) { s.MinimumChargeMs = processCompileNumber(1001) }},
		{"wrong field", "windowMs", func(s *model.ProcessStepDefinition) { s.WindowMs = processCompileNumber(1) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := processCompileChargeRequest()
			tc.mutate(&req.SharedProviders[0].Processes[0].Steps[2])
			requireProcessCompileError(t, req, tc.path)
		})
	}
}

func TestProcessCompileControlValidation(t *testing.T) {
	cases := []struct {
		name, path string
		mutate     func(*model.CompileRequest)
	}{
		{"missing initial", "processes[0]", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities = r.SharedProviders[0].Abilities[1:] }},
		{"duplicate initial", "processControl", func(r *model.CompileRequest) {
			ability := r.SharedProviders[0].Abilities[0]
			ability.AbilityKey = "initial2"
			r.SharedProviders[0].Abilities = append(r.SharedProviders[0].Abilities, ability)
		}},
		{"unknown process", "processControl.processKey", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].ProcessControl.ProcessKey = "absent" }},
		{"wrong skill", "skillKey", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].SkillKey = "different" }},
		{"passive", "kind", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].Kind = "passive" }},
		{"cost", ".cost", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Cost = &model.AbilityCost{ResourceKey: "mana", Amount: *processCompileNumber(1)}
		}},
		{"cooldown", ".cooldown", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Cooldown = &model.AbilityCooldown{DurationMs: *processCompileNumber(1)}
		}},
		{"independent operations", "abilities[0].operations", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: processCompileNumber(1)}}
		}},
		{"cast condition", "castCondition", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].CastCondition = processCompileNumber(1)
		}},
		{"tick", "tickSpec", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].TickSpec = &model.TickSpec{IntervalMs: 1}
		}},
		{"initial step", "stepKey", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].ProcessControl.StepKey = "window" }},
		{"initial reason", "failureReason", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].ProcessControl.FailureReason = "CONTROLLED"
		}},
		{"missing recast step", "stepKey", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[1].ProcessControl.StepKey = "" }},
		{"wrong step type", "stepKey", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[1].ProcessControl.StepKey = "delay" }},
		{"wrong charge action", "stepKey", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[1].ProcessControl.Action = "CHARGE_RELEASE"
		}},
		{"cancel wrong reason", "failureReason", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[2].ProcessControl.FailureReason = "CONTROLLED"
		}},
		{"cancel missing reason", "failureReason", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[2].ProcessControl.FailureReason = "" }},
		{"interrupt cancellation", "failureReason", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[2].ProcessControl.Action = "INTERRUPT" }},
		{"unknown action", "action", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[2].ProcessControl.Action = "FINISH" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := processCompileRequest()
			tc.mutate(&req)
			requireProcessCompileError(t, req, tc.path)
		})
	}
	for _, reason := range []string{"CONTROLLED", "SOURCE_DIED", "TARGET_UNTARGETABLE", "EVENT_ABORTED"} {
		req := processCompileRequest()
		req.SharedProviders[0].Abilities[2].ProcessControl.Action = "INTERRUPT"
		req.SharedProviders[0].Abilities[2].ProcessControl.FailureReason = reason
		if result := CompileGeneric(req); !result.OK {
			t.Fatalf("legal interruption %s failed: %+v", reason, result.Result.Errors)
		}
	}
}

func TestProcessCompileActualCostReadScopesAndNamedFormulas(t *testing.T) {
	for _, moment := range []string{"PROCESS_COMPLETE", "PROCESS_FAILURE"} {
		req := processCompileRequest()
		req.Formulas = []model.NamedFormula{{Key: "actual", Expression: model.GenericFormulaExpr{Op: "read", Path: "process.actual_cost.mana"}}}
		binding := &req.SharedProviders[0].Processes[0].MomentOperations[0]
		binding.Moment.MomentType = moment
		binding.Operations[0].Amount = &model.GenericFormulaExpr{Op: "ref", Ref: "actual"}
		if result := CompileGeneric(req); !result.OK {
			t.Fatalf("legal %s named read: %+v", moment, result.Result.Errors)
		}
	}
	for _, tc := range []struct {
		name, path string
		mutate     func(*model.CompileRequest)
	}{
		{"start refund", "operations[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Moment.MomentType = "PROCESS_START"
		}},
		{"step refund", "operations[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Moment = model.ProcessMomentDefinition{MomentType: "STEP_COMPLETE", StepKey: processCompileString("delay")}
		}},
		{"unknown resource", "operations[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].MomentOperations[0].Operations[0].Amount.Path = "process.actual_cost.energy"
		}},
		{"cost reads itself", "costs[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Costs[0].Amount = model.GenericFormulaExpr{Op: "ref", Ref: "actual"}
		}},
		{"time reads cost", "steps[1].delayMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Steps[1].DelayMs = &model.GenericFormulaExpr{Op: "ref", Ref: "actual"}
		}},
		{"cooldown start reads cost", "cooldown.durationMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Processes[0].Cooldown.DurationMs = model.GenericFormulaExpr{Op: "ref", Ref: "actual"}
		}},
		{"ordinary ability amount", "abilities[3].operations[0].amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities = append(r.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "ordinary", Kind: "active", Operations: []model.OperationDefinition{{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{Op: "ref", Ref: "actual"}}}})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := processCompileRequest()
			req.Formulas = []model.NamedFormula{{Key: "actual", Expression: model.GenericFormulaExpr{Op: "read", Path: "process.actual_cost.mana"}}}
			tc.mutate(&req)
			requireProcessCompileError(t, req, tc.path)
		})
	}
}

func TestProcessCompileRejectsMissingFormulaContexts(t *testing.T) {
	for _, read := range []string{"damage.amount", "event.source.attr.attack_damage.resolved", "event.skill_hit.blocked"} {
		t.Run(read, func(t *testing.T) {
			req := processCompileRequest()
			req.SharedProviders[0].Processes[0].MomentOperations[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "read", Path: read}
			requireProcessCompileError(t, req, "operations[0].amount")
		})
	}
	req := processCompileRequest()
	req.SharedProviders[0].Processes[0].Steps[1].DelayMs = &model.GenericFormulaExpr{Op: "read", Path: "damage.amount"}
	requireProcessCompileError(t, req, "delayMs")
}

func TestProcessCompileListenerCannotInvokeControl(t *testing.T) {
	for _, selector := range []string{"source", "self", "opponent"} {
		req := processCompileRequest()
		mount := req.Combatants[0].Providers[0].ProviderRef
		req.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "call_process", EventMatcher: model.TypeMatcher{}, AbilityRef: selector + ".provider[" + mount + "].ability[initial]"}}
		requireProcessCompileError(t, req, "rules.listeners[0].abilityRef")
	}
}

func TestProcessCompileLaterProviderOwnsItsControl(t *testing.T) {
	req := processCompileRequest()
	second := req.SharedProviders[0]
	second.ProviderKey, second.StableID = "second", "second"
	// 结构切片不修改元素，保留两个相同键但不同供值器的独立过程定义。
	req.SharedProviders = append(req.SharedProviders, second)
	req.Combatants[1].Providers = append(req.Combatants[1].Providers, model.CombatantProviderMount{ProviderRef: "second", DefinitionRef: "second"})
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	if result.Session.Providers[1].AbilityStart != 3 || result.Session.Providers[1].AbilityCount != 3 || result.Session.Providers[1].Processes[0].InitialAbilityIndex != 3 {
		t.Fatalf("later provider index crossed ownership: %+v", result.Session.Providers[1])
	}
	for i, ability := range result.Session.Abilities {
		if int(ability.ProviderIndex) != i/3 || ability.ProcessControl == nil || ability.ProcessControl.ProcessIndex != 0 {
			t.Fatalf("ability[%d]=%+v", i, ability)
		}
	}
}

func TestProcessCompileAllSevenMomentsAndFailureFilters(t *testing.T) {
	moments := []model.ProcessMomentDefinition{
		{MomentType: "PROCESS_START"},
		{MomentType: "PROCESS_COMPLETE"},
		{MomentType: "PROCESS_FAILURE"},
		{MomentType: "STEP_START", StepKey: processCompileString("begin")},
		{MomentType: "STEP_EXECUTION", StepKey: processCompileString("delay")},
		{MomentType: "STEP_COMPLETE", StepKey: processCompileString("window")},
		{MomentType: "STEP_TIMEOUT", StepKey: processCompileString("window")},
	}
	for _, reason := range []string{"CONTROLLED", "SOURCE_DIED", "TARGET_UNTARGETABLE", "ACTIVE_CANCELLED", "EVENT_ABORTED"} {
		moments = append(moments, model.ProcessMomentDefinition{MomentType: "PROCESS_FAILURE", FailureReason: processCompileString(reason)})
	}
	for _, moment := range moments {
		req := processCompileRequest()
		process := &req.SharedProviders[0].Processes[0]
		process.Cooldown.StartMoment = moment
		process.Cooldown.DurationMs = *processCompileNumber(0)
		process.MomentOperations[0].Moment = moment
		process.MomentOperations[0].Operations[0].Amount = processCompileNumber(0)
		if result := CompileGeneric(req); !result.OK {
			t.Fatalf("legal moment %+v: %+v", moment, result.Result.Errors)
		}
	}
	for _, wrong := range []string{"STEP_EXECUTE", "PROCESS_TIMEOUT", "", "PROCESS_CANCEL_REQUESTED"} {
		req := processCompileRequest()
		req.SharedProviders[0].Processes[0].MomentOperations[0].Moment.MomentType = wrong
		requireProcessCompileError(t, req, "moment.momentType")
	}
}

func TestProcessCompileFoldsNamedTimeAndCosts(t *testing.T) {
	for _, tc := range []struct {
		name, path string
		expression model.GenericFormulaExpr
	}{
		{"negative sum", "costs[0].amount", model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{*processCompileNumber(5), *processCompileNumber(-6)}}},
		{"division by zero", "costs[0].amount", model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{*processCompileNumber(1), *processCompileNumber(0)}}},
		{"fractional folded time", "delayMs", model.GenericFormulaExpr{Op: "div", Args: []model.GenericFormulaExpr{*processCompileNumber(3), *processCompileNumber(2)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := processCompileRequest()
			req.Formulas = []model.NamedFormula{{Key: "inner", Expression: tc.expression}, {Key: "outer", Expression: model.GenericFormulaExpr{Op: "ref", Ref: "inner"}}}
			if tc.path == "delayMs" {
				req.SharedProviders[0].Processes[0].Steps[1].DelayMs = &model.GenericFormulaExpr{Op: "ref", Ref: "outer"}
			} else {
				req.SharedProviders[0].Processes[0].Costs[0].Amount = model.GenericFormulaExpr{Op: "ref", Ref: "outer"}
			}
			requireProcessCompileError(t, req, tc.path)
		})
	}
}

func TestProcessCompileActualCostCannotEscapeThroughOtherFormulaSlots(t *testing.T) {
	read := model.GenericFormulaExpr{Op: "ref", Ref: "outer"}
	cases := []struct {
		name, path string
		mutate     func(*model.CompileRequest)
	}{
		{"ability cost", "abilities[3].cost.amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[3].Cost = &model.AbilityCost{ResourceKey: "mana", Amount: read}
		}},
		{"ability cooldown", "abilities[3].cooldown.durationMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[3].Cooldown = &model.AbilityCooldown{DurationMs: read}
		}},
		{"ability condition", "abilities[3].castCondition", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[3].CastCondition = &read }},
		{"operation condition", "abilities[3].operations[0].condition", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[3].Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: processCompileNumber(1), Condition: &read}}
		}},
		{"shield duration", "abilities[3].operations[0].shieldDurationMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[3].Operations = []model.OperationDefinition{{Operation: "shield", Target: "self", Amount: processCompileNumber(1), ShieldRef: "s", ShieldDurationMs: &read}}
		}},
		{"modifier value", "modifiers[0].value", func(r *model.CompileRequest) {
			r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "m", Kind: "attribute", ValuePolicy: "add", Value: read}}
		}},
		{"modifier condition", "modifiers[0].condition", func(r *model.CompileRequest) {
			r.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "m", Kind: "attribute", ValuePolicy: "add", Value: *processCompileNumber(1), Condition: &read}}
		}},
		{"provider duration", "lifecycle.durationMs", func(r *model.CompileRequest) {
			r.SharedProviders[0].Lifecycle = &model.ProviderLifecycle{DurationMs: &read}
		}},
		{"provider strength", "statusContributions[0].strength", func(r *model.CompileRequest) {
			r.SharedProviders[0].StatusContributions = []model.StatusContributionDefinition{{ResultRef: "r", StatusKey: "s", StatusKind: model.StatusKindMovementSlow, Strength: read}}
		}},
		{"listener condition", "listeners[0].condition", func(r *model.CompileRequest) {
			r.Rules.Listeners = []model.ListenerDefinition{{ListenerKey: "listen", Condition: &read}}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := processCompileRequest()
			req.Formulas = []model.NamedFormula{
				{Key: "inner", Expression: model.GenericFormulaExpr{Op: "read", Path: "process.actual_cost.mana"}},
				{Key: "outer", Expression: model.GenericFormulaExpr{Op: "ref", Ref: "inner"}},
			}
			req.SharedProviders[0].Abilities = append(req.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "ordinary", Kind: "active"})
			tc.mutate(&req)
			requireProcessCompileError(t, req, tc.path)
		})
	}
}

func TestProcessCompileOperationOutputsStayWithinOrderedBinding(t *testing.T) {
	req := processCompileRequest()
	binding := &req.SharedProviders[0].Processes[0].MomentOperations[0]
	binding.Operations = []model.OperationDefinition{
		{Operation: "damage", Target: "target", DamageType: "damage/physical", Amount: processCompileNumber(10), OutputRef: "hit"},
		{Operation: "resource_change", Target: "self", ResourceKey: "mana", Amount: &model.GenericFormulaExpr{Op: "read", Path: "operation.output.hit.ACTUAL_HP_LOSS"}},
	}
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("ordered same binding output: %+v", result.Result.Errors)
	}
	binding.Operations[0].Amount = binding.Operations[1].Amount
	requireProcessCompileError(t, req, "operations[0].amount")
	binding.Operations[0].Amount = processCompileNumber(10)
	right := model.ProcessMomentOperations{Moment: binding.Moment, Operations: binding.Operations[1:]}
	binding.Operations = binding.Operations[:1]
	req.SharedProviders[0].Processes[0].MomentOperations = append(req.SharedProviders[0].Processes[0].MomentOperations, right)
	requireProcessCompileError(t, req, "momentOperations[1].operations[0].amount")
}

func TestProcessCompileCooldownReferencesMustExist(t *testing.T) {
	req := processCompileRequest()
	binding := &req.SharedProviders[0].Processes[0].MomentOperations[0]
	ref := "self.provider[" + req.Combatants[0].Providers[0].ProviderRef + "].ability[initial]"
	binding.Operations = []model.OperationDefinition{{Operation: "cooldown_change", Target: "self", AbilityRef: ref, ValuePolicy: "set_remaining", Amount: processCompileNumber(0)}}
	if result := CompileGeneric(req); !result.OK {
		t.Fatalf("own initial cooldown reference rejected: %+v", result.Result.Errors)
	}
	binding.Operations[0].AbilityRef = "self.provider[missing].ability[initial]"
	requireProcessCompileError(t, req, "operations[0].abilityRef")
}

func TestProcessCompileDuplicateAbilityCannotHideInitialControl(t *testing.T) {
	req := processCompileRequest()
	req.SharedProviders[0].Abilities = append(req.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "initial", Kind: "active"})
	requireProcessCompileError(t, req, "abilities[3].abilityKey")
}
