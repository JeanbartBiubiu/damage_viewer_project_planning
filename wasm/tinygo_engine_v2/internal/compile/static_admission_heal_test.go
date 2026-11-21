package compile

import (
	"testing"

	"tinygo_engine_v2/internal/formula"
)

func TestSettledHealProofPreservesReferenceDepthBudgetAndParameters(t *testing.T) {
	var formulas formula.Builder
	register := func(key string, instructions ...formula.GenericInstr) formula.GenericProgramID {
		t.Helper()
		id, err := formulas.Register(formula.GenericProgram{Key: key, Instr: instructions})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	coefficient := register("parameter", formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadAbilityParam, ReadKey: "ratio"})
	amount := register("proportion",
		formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadEventDamage, ReadKey: "mitigatedAmount"},
		formula.GenericInstr{Op: formula.GenericOpRef, RefIndex: uint16(coefficient)},
		formula.GenericInstr{Op: formula.GenericOpMul},
	)
	both := register("repeated_coefficient",
		formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadEventDamage, ReadKey: "mitigatedAmount"},
		formula.GenericInstr{Op: formula.GenericOpRef, RefIndex: uint16(coefficient)},
		formula.GenericInstr{Op: formula.GenericOpMul},
		formula.GenericInstr{Op: formula.GenericOpRef, RefIndex: uint16(coefficient)},
		formula.GenericInstr{Op: formula.GenericOpMul},
	)
	library := formulas.Freeze()
	limit := formula.MaxGenericTotalInstructions
	for _, test := range []struct {
		name                    string
		program                 formula.GenericProgramID
		depth, spent, wantSpent int
		params                  map[string]float64
		wantValid               bool
	}{
		{"reference_at_depth_32", amount, 31, 0, 4, map[string]float64{"ratio": .5}, true},
		{"reference_at_depth_33", amount, 32, 0, 3, map[string]float64{"ratio": .5}, false},
		{"repeated_reference_at_budget", both, 1, limit - 7, limit, map[string]float64{"ratio": .5}, true},
		{"repeated_reference_over_budget", both, 1, limit - 6, limit, map[string]float64{"ratio": .5}, false},
		{"parameter_missing", amount, 1, 0, 4, nil, false},
		{"parameter_zero", amount, 1, 0, 4, map[string]float64{"ratio": 0}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			spent := test.spent
			term, valid := settledEventHealFormulaTerm(&library, test.program, test.params, test.depth, &spent)
			if valid != test.wantValid || spent != test.wantSpent {
				t.Fatalf("valid = %v, spent = %d, want %v, %d", valid, spent, test.wantValid, test.wantSpent)
			}
			if valid {
				factor := test.params["ratio"]
				if test.program == both {
					factor *= factor
				}
				if !term.damage || term.factor != factor {
					t.Fatalf("invalid settled damage coefficient: %+v", term)
				}
			}
		})
	}
}
