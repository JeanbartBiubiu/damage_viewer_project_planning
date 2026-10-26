package formula

import (
	"errors"
	"strconv"
	"testing"

	"tinygo_engine_v2/internal/base/expression"
)

func authoredRegistryProgram(t *testing.T, stages, inputs int) *expression.Program {
	t.Helper()
	declared, allowed := []any{}, []any{}
	for i := 0; i < inputs; i++ {
		binding := map[string]any{"kind": "context", "contextKey": "slot" + strconv.Itoa(i)}
		declared = append(declared, map[string]any{"key": "input" + strconv.Itoa(i), "binding": binding})
		allowed = append(allowed, binding)
	}
	results := []any{}
	for i := 0; i < stages; i++ {
		results = append(results, map[string]any{"key": "stage" + strconv.Itoa(i), "name": "结果", "expression": map[string]any{"op": "const", "value": "1"}})
	}
	program, issue := expression.CompileDefinition(map[string]any{"inputs": declared, "stages": results, "outputStageKey": "stage0"}, allowed)
	if issue != nil {
		t.Fatal(issue)
	}
	return program
}

func TestGenericRegistryAuthoredAndLegacyMutuallyExclusiveSameIdentityAndClone(t *testing.T) {
	p := authoredRegistryProgram(t, 1, 0)
	var reg GenericRegistry
	if _, err := reg.Register(GenericProgram{Key: "mixed", Authored: p, Instr: registryProgramInstructions(1)}); err == nil {
		t.Fatal("two content kinds accepted")
	}
	if len(reg.Programs) != 0 || reg.Index != nil {
		t.Fatal("failed registration consumed id0")
	}
	id, err := reg.Register(GenericProgram{Key: "authored", Authored: p, BindingBytes: 91})
	if err != nil || id != 0 {
		t.Fatal(id, err)
	}
	id, err = reg.Register(registryConstProgram("legacy", 2))
	if err != nil || id != 1 {
		t.Fatal(id, err)
	}
	if reg.instructionCount != 3 || reg.stageCount != 1 {
		t.Fatal("separate budget created", reg.instructionCount, reg.stageCount)
	}
	if id, err := reg.Register(GenericProgram{Key: "authored", Authored: p, BindingBytes: 91}); err != nil || id != 0 {
		t.Fatal(id, err)
	}
	before := *reg.CloneForRun()
	if _, err := reg.Register(GenericProgram{Key: "authored", Authored: authoredRegistryProgram(t, 1, 0), BindingBytes: 91}); !errors.Is(err, errGenericKeyConflict) {
		t.Fatal("same key replaced immutable program", err)
	}
	registryAssertUnchanged(t, reg, before)
	clone := reg.CloneForRun()
	if clone.Programs[0].Authored != p {
		t.Fatal("run clone copied or mutated authored content")
	}
	if _, err := clone.Register(registryConstProgram("temporary", 3)); err != nil {
		t.Fatal(err)
	}
	registryAssertUnchanged(t, reg, before)
	value, err := reg.Eval(0, GenericEvalContext{})
	if err != nil || value != 1 {
		t.Fatal(value, err)
	}
}

func TestGenericRegistryMixedProgramAndInstructionBoundaries(t *testing.T) {
	program := authoredRegistryProgram(t, 1, 0)
	var reg GenericRegistry
	for i := 0; i < MaxGenericPrograms; i++ {
		candidate := registryConstProgram(strconv.Itoa(i), 1)
		if i%2 == 0 {
			candidate = GenericProgram{Key: candidate.Key, Authored: program}
		}
		if id, err := reg.Register(candidate); err != nil || int(id) != i {
			t.Fatal(i, id, err)
		}
	}
	before := *reg.CloneForRun()
	if _, err := reg.Register(GenericProgram{Key: "next", Authored: program}); !errors.Is(err, errGenericProgramLimit) {
		t.Fatal(err)
	}
	registryAssertUnchanged(t, reg, before)
	var instr GenericRegistry
	for i := 0; i < 511; i++ {
		if _, err := instr.Register(GenericProgram{Key: strconv.Itoa(i), Instr: registryProgramInstructions(512)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := instr.Register(GenericProgram{Key: "authored", Authored: program}); err != nil {
		t.Fatal(err)
	}
	if _, err := instr.Register(GenericProgram{Key: "last", Instr: registryProgramInstructions(510)}); err != nil {
		t.Fatal(err)
	}
	if instr.instructionCount != MaxGenericTotalInstructions {
		t.Fatal(instr.instructionCount)
	}
	before = *instr.CloneForRun()
	if _, err := instr.Register(GenericProgram{Key: "more", Authored: program}); !errors.Is(err, errGenericTotalLimit) {
		t.Fatal(err)
	}
	registryAssertUnchanged(t, instr, before)
}

func TestGenericRegistryAuthoredResultsAndIsolatedInputCounterBoundaries(t *testing.T) {
	program := authoredRegistryProgram(t, 64, 0)
	var reg GenericRegistry
	if _, err := reg.Register(registryConstProgram("legacy", 2)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 1024; i++ {
		if _, err := reg.Register(GenericProgram{Key: strconv.Itoa(i), Authored: program}); err != nil {
			t.Fatal(i, err)
		}
	}
	if reg.stageCount != MaxGenericTotalStages {
		t.Fatal(reg.stageCount)
	}
	before := *reg.CloneForRun()
	if _, err := reg.Register(GenericProgram{Key: "one-more-result", Authored: authoredRegistryProgram(t, 1, 0)}); !errors.Is(err, errGenericStageLimit) {
		t.Fatal(err)
	}
	registryAssertUnchanged(t, reg, before)
	// 输入保留结构还受32MiB预算约束；单独检查输入计数器的精确边界。
	usage, err := addUsage(genericUsage{}, genericUsage{inputs: MaxGenericTotalInputs})
	if err != nil || usage.inputs != MaxGenericTotalInputs {
		t.Fatal(usage, err)
	}
	if _, err := addUsage(usage, genericUsage{inputs: 1}); !errors.Is(err, errGenericInputLimit) {
		t.Fatal(err)
	}
	inputs := authoredRegistryProgram(t, 1, 64)
	var counters GenericRegistry
	if _, err := counters.Register(GenericProgram{Key: "inputs", Authored: inputs}); err != nil || counters.inputCount != 64 {
		t.Fatal(err, counters.inputCount)
	}
}

func TestGenericRegistryAuthoredBindingsShareMemoryBudgetAndFailureIsAtomic(t *testing.T) {
	program := authoredRegistryProgram(t, 1, 1)
	candidate := GenericProgram{Key: "authored", Authored: program}
	bytes, err := genericProgramMemoryBytes(candidate)
	if err != nil {
		t.Fatal(err)
	}
	candidate.BindingBytes = uint64(MaxGenericFormulaMemoryBytes) - bytes
	var reg GenericRegistry
	if _, err := reg.Register(candidate); err != nil || reg.memoryBytes != MaxGenericFormulaMemoryBytes {
		t.Fatal(err, reg.memoryBytes)
	}
	before := *reg.CloneForRun()
	if _, err := reg.Register(registryConstProgram("legacy", 1)); !errors.Is(err, errGenericMemoryLimit) {
		t.Fatal(err)
	}
	registryAssertUnchanged(t, reg, before)
	candidate.BindingBytes++
	var empty GenericRegistry
	if _, err := empty.Register(candidate); !errors.Is(err, errGenericMemoryLimit) {
		t.Fatal(err)
	}
	if empty.Index != nil || len(empty.Programs) != 0 || empty.memoryBytes != 0 {
		t.Fatal("memory failure consumed state")
	}
	if id, err := empty.Register(registryConstProgram("retry", 7)); err != nil || id != 0 {
		t.Fatal(id, err)
	}
}
