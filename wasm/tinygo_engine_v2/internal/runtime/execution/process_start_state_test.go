package execution

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func capturedEmpoweredInput(t *testing.T, value float64) (model.CompileRequest, model.RunRequest) {
	input, run := empoweredInput(t, "captured_charge", 200, 10000, 1500)
	provider := &input.SharedProviders[1]
	provider.SkillKey = "captured_charge"
	provider.InitialStateSchema = map[string]interface{}{}
	for _, key := range []string{"entry_count", "captured_count"} {
		initial := 0.0
		if key == "entry_count" {
			initial = value
		}
		provider.InitialStateSchema[key] = map[string]interface{}{"valueType": "integer", "defaultValue": initial, "maxValue": float64(maxJSONSafeInteger), "durationMs": float64(0)}
	}
	ensureC1CatalogTypes(&input, model.TypeCatalogEntry{Key: "state_scope/provider", Domain: "state_scope"})
	provider.Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_START"}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "captured_count", ValuePolicy: "set", Amount: &model.GenericFormulaExpr{Op: "read", Path: "provider.state.entry_count"}}}}}
	definition := formuladefinition.FromExpr("captured_value", "captured_charge", model.GenericFormulaExpr{Op: "read", Path: "ability.param.stack"}, nil)
	definition.Parameters[0].ValueType = "INTEGER"
	definition.Parameters[0].RuntimeSource = &model.FormulaRuntimeSource{Kind: "process_start_state", StateKey: "captured_count"}
	input.Formulas = append(input.Formulas, definition)
	provider.Abilities[1].Operations[0].SkillHit.Candidates[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "ref", Ref: definition.Key}
	return input, run
}

func TestProcessStartStateJSONSafeIntegersAndFrozenAfterStart(t *testing.T) {
	for i, value := range []float64{0, 100, 2147483649, 4294967297, 9007199254740991} {
		input, run := capturedEmpoweredInput(t, value)
		p := &input.SharedProviders[1]
		p.Processes[0].MomentOperations = append(p.Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: &p.Processes[0].Steps[0].StepKey}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "captured_count", ValuePolicy: "set", Amount: timedShieldExpr(999)}}})
		data, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		var roundtrip model.CompileRequest
		if err := json.Unmarshal(data, &roundtrip); err != nil {
			t.Fatal(err)
		}
		rawRun, err := json.Marshal(run)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(rawRun, &run); err != nil {
			t.Fatal(err)
		}
		done := authoringRun(t, roundtrip, run)
		found := false
		for _, row := range done.DamageRecords {
			if row["useRef"] == "skill:captured_charge_first" {
				found = true
				if row["rawAmount"] != value {
					t.Fatal(value, row)
				}
			}
		}
		if !found {
			t.Fatal("missing captured payload", value)
		}
		if os.Getenv("DAMAGE_NASUS_DUMP") == "1" {
			dir := filepath.Join(executionModuleRoot(), "target", "nasus-mechanisms-2026-10-19", "native-v1", "fixtures")
			if configured := os.Getenv("DAMAGE_NASUS_DUMP_DIR"); configured != "" {
				dir = configured
			}
			if err := os.MkdirAll(dir, 0755); err != nil {
				t.Fatal(err)
			}
			for _, item := range []struct {
				name  string
				value interface{}
			}{{"compile", roundtrip}, {"request", run}, {"done", done}} {
				raw, err := json.MarshalIndent(item.value, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(dir, "capture-"+string(rune('0'+i))+"-"+item.name+".json"), raw, 0644); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
}

func TestProcessStartStateRefusesMissingProducerAndOtherContexts(t *testing.T) {
	for _, change := range []string{"no_set", "two_set", "conditional", "number", "foreign_state", "no_binding", "ordinary_hit", "runtime_decimal"} {
		input, _ := capturedEmpoweredInput(t, 100)
		p := &input.SharedProviders[1]
		switch change {
		case "no_set":
			p.Processes[0].MomentOperations = nil
		case "two_set":
			p.Processes[0].MomentOperations[0].Operations = append(p.Processes[0].MomentOperations[0].Operations, p.Processes[0].MomentOperations[0].Operations[0])
		case "conditional":
			p.Processes[0].MomentOperations[0].Operations[0].Condition = timedShieldExpr(1)
		case "number":
			p.InitialStateSchema["captured_count"].(map[string]interface{})["valueType"] = "number"
		case "foreign_state":
			input.Formulas[len(input.Formulas)-1].Parameters[0].RuntimeSource.StateKey = "foreign"
		case "no_binding":
			input.Rules.SkillActionBindings = nil
		case "ordinary_hit":
			p.Processes[0].Steps[0].StepType = "DELAY"
			p.Processes[0].Steps[0].WindowMs = nil
			p.Processes[0].Steps[0].ConsumeMoment = nil
			p.Processes[0].Steps[0].DelayMs = timedShieldExpr(1)
		case "runtime_decimal":
			input.Formulas[len(input.Formulas)-1].Parameters[0].ValueType = "DECIMAL"
		}
		if result := compilebundle.CompileGeneric(input); result.OK {
			t.Fatal(change, "illegally admitted capture")
		}
	}
}

func TestProcessStartStateNewUseExpiryAndFailureIsolation(t *testing.T) {
	input, run := capturedEmpoweredInput(t, 100)
	p := &input.SharedProviders[1]
	p.Processes[0].MomentOperations = append(p.Processes[0].MomentOperations, model.ProcessMomentOperations{Moment: model.ProcessMomentDefinition{MomentType: "STEP_START", StepKey: &p.Processes[0].Steps[0].StepKey}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Types: []string{"state_scope/provider"}, Ref: "entry_count", ValuePolicy: "set", Amount: timedShieldExpr(200)}}})
	again := run.DriverPlan.SkillActions[0]
	again.FirstAtMs = 500
	again.InstructionKey = "captured_again"
	run.DriverPlan.SkillActions = append(run.DriverPlan.SkillActions, again)
	done := authoringRun(t, input, run)
	for _, row := range done.DamageRecords {
		if row["useRef"] == "skill:captured_again" && row["rawAmount"] != float64(200) {
			t.Fatal("new use borrowed old capture", row)
		}
	}
	for _, value := range []float64{-1, .5, 9007199254740992} {
		c, _ := capturedEmpoweredInput(t, value)
		if result := compilebundle.CompileGeneric(c); result.OK {
			t.Fatal("invalid integer accepted", value)
		}
	}
	input, run = capturedEmpoweredInput(t, 100)
	input.SharedProviders[1].Processes[0].Steps[0].WindowMs = timedShieldExpr(800)
	done = authoringRun(t, input, run)
	if done.Summary.SourceDamageDealt != 20 || empoweredProcess(t, done, "skill:captured_charge_first").Status != "failed" {
		t.Fatal("capture escaped exact deadline")
	}
	input, run = capturedEmpoweredInput(t, 100)
	run.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	done = authoringRun(t, input, run)
	if len(done.FinalSnapshot.ProcessInstances) > 1 || done.Summary.SkillUses.StartedCount != 0 {
		t.Fatal("failed start published captured use", done.Summary)
	}
}
