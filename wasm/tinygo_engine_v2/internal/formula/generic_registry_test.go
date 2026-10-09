package formula

import (
	"errors"
	"math"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"unsafe"

	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func registryConstProgram(key string, value float64) GenericProgram {
	return GenericProgram{Key: key, Instr: []GenericInstr{{Op: GenericOpConst, Value: value}}}
}

func registryAssertUnchanged(t *testing.T, reg GenericRegistry, before GenericRegistry) {
	t.Helper()
	if !reflect.DeepEqual(reg, before) {
		t.Fatalf("failed registration changed registry: programs %d/%d, instructions %d/%d, bytes %d/%d",
			len(reg.Programs), len(before.Programs), reg.instructionCount, before.instructionCount, reg.memoryBytes, before.memoryBytes)
	}
}

func TestGenericRegistryProgramIDBoundaryAndLastEvaluation(t *testing.T) {
	var reg GenericRegistry
	var last GenericProgramID
	for i := 0; i < MaxGenericPrograms; i++ {
		id, err := reg.Register(registryConstProgram(strconv.Itoa(i), float64(i)))
		if err != nil || int(id) != i {
			t.Fatalf("register %d: id=%d err=%v", i, id, err)
		}
		last = id
	}
	if last != GenericProgramID(65535) || len(reg.Index) != MaxGenericPrograms {
		t.Fatalf("last=%d index=%d", last, len(reg.Index))
	}
	value, err := reg.Eval(last, GenericEvalContext{})
	if err != nil || value != 65535 {
		t.Fatalf("last program got=%v err=%v", value, err)
	}
	before := *reg.CloneForRun()
	if _, err := reg.Register(registryConstProgram("overflow", 999)); !errors.Is(err, errGenericProgramLimit) {
		t.Fatalf("65537th program err=%v", err)
	}
	registryAssertUnchanged(t, reg, before)
	if id, err := reg.Register(registryConstProgram("65535", 65535)); err != nil || id != last {
		t.Fatalf("reuse at full table id=%d err=%v", id, err)
	}
	registryAssertUnchanged(t, reg, before)
	value, err = reg.Eval(0, GenericEvalContext{})
	if err != nil || value != 0 {
		t.Fatalf("overflow overwrote program 0: value=%v err=%v", value, err)
	}
}

func registryProgramInstructions(n int) []GenericInstr {
	instr := make([]GenericInstr, n)
	instr[0] = GenericInstr{Op: GenericOpConst, Value: 1}
	for i := 1; i < n; i++ {
		instr[i] = GenericInstr{Op: GenericOpRound}
	}
	return instr
}

func TestGenericRegistryPerProgramAndCumulativeInstructionBoundaries(t *testing.T) {
	var reg GenericRegistry
	instr := registryProgramInstructions(MaxGenericProgramInstructions)
	for i := 0; i < MaxGenericTotalInstructions/MaxGenericProgramInstructions; i++ {
		if _, err := reg.Register(GenericProgram{Key: strconv.Itoa(i), Instr: instr}); err != nil {
			t.Fatalf("register program %d: %v", i, err)
		}
	}
	if reg.instructionCount != MaxGenericTotalInstructions {
		t.Fatalf("instructions=%d", reg.instructionCount)
	}
	before := *reg.CloneForRun()
	if _, err := reg.Register(registryConstProgram("one-more", 1)); !errors.Is(err, errGenericTotalLimit) {
		t.Fatalf("cumulative maximum +1 err=%v", err)
	}
	registryAssertUnchanged(t, reg, before)
	if _, err := reg.Register(GenericProgram{Key: "too-large", Instr: registryProgramInstructions(MaxGenericProgramInstructions + 1)}); !errors.Is(err, errGenericInstructionLimit) {
		t.Fatalf("513 instruction program err=%v", err)
	}
	registryAssertUnchanged(t, reg, before)
	value, err := reg.Eval(GenericProgramID(len(reg.Programs)-1), GenericEvalContext{})
	if err != nil || value != 1 {
		t.Fatalf("last 512 instruction program got=%v err=%v", value, err)
	}
}

func TestGenericRegistryKeyReuseComparesEveryInstructionField(t *testing.T) {
	original := GenericProgram{Key: "fixed", Instr: []GenericInstr{{
		Op: GenericOpConst, Value: 1, ReadKind: ReadSourceAttr, ReadKey: "hp.current", RefIndex: 8, Decimals: 3, JumpTarget: 6,
	}}}
	var reg GenericRegistry
	id, err := reg.Register(original)
	if err != nil {
		t.Fatal(err)
	}
	before := *reg.CloneForRun()
	identical := GenericProgram{Key: original.Key, Instr: append([]GenericInstr(nil), original.Instr...)}
	if got, err := reg.Register(identical); err != nil || got != id {
		t.Fatalf("identical program id=%d err=%v", got, err)
	}
	registryAssertUnchanged(t, reg, before)
	mutations := []struct {
		name string
		edit func(*GenericInstr)
	}{
		{"operation", func(in *GenericInstr) { in.Op = GenericOpRead }},
		{"value", func(in *GenericInstr) { in.Value = 2 }},
		{"read_kind", func(in *GenericInstr) { in.ReadKind = ReadTargetAttr }},
		{"read_key", func(in *GenericInstr) { in.ReadKey = "hp.max" }},
		{"reference", func(in *GenericInstr) { in.RefIndex++ }},
		{"decimals", func(in *GenericInstr) { in.Decimals++ }},
		{"jump", func(in *GenericInstr) { in.JumpTarget++ }},
	}
	for _, mutation := range mutations {
		t.Run(mutation.name, func(t *testing.T) {
			candidate := GenericProgram{Key: original.Key, Instr: append([]GenericInstr(nil), original.Instr...)}
			mutation.edit(&candidate.Instr[0])
			if _, err := reg.Register(candidate); !errors.Is(err, errGenericKeyConflict) {
				t.Fatalf("changed content err=%v", err)
			}
			registryAssertUnchanged(t, reg, before)
		})
	}
	if _, err := reg.Register(GenericProgram{Key: original.Key, Instr: append(append([]GenericInstr(nil), original.Instr...), GenericInstr{Op: GenericOpRound})}); !errors.Is(err, errGenericKeyConflict) {
		t.Fatalf("changed length err=%v", err)
	}
	registryAssertUnchanged(t, reg, before)
	var signedZero GenericRegistry
	if _, err := signedZero.Register(registryConstProgram("zero", 0)); err != nil {
		t.Fatal(err)
	}
	if _, err := signedZero.Register(registryConstProgram("zero", math.Copysign(0, -1))); !errors.Is(err, errGenericKeyConflict) {
		t.Fatalf("changed float bits err=%v", err)
	}
}

func TestGenericRegistryMemoryAccountingBoundaryAndFailureAtomicity(t *testing.T) {
	program := registryConstProgram("内存", 1)
	headerBytes := int(unsafe.Sizeof(GenericProgram{})) + int(unsafe.Sizeof(GenericInstr{})) + len(program.Key)
	readKeyBytes := MaxGenericFormulaMemoryBytes - headerBytes
	storage := strings.Repeat("x", readKeyBytes+1)
	program.Instr[0].ReadKey = storage[:readKeyBytes]
	var reg GenericRegistry
	if _, err := reg.Register(program); err != nil {
		t.Fatalf("memory maximum: %v", err)
	}
	if reg.memoryBytes != uint64(MaxGenericFormulaMemoryBytes) {
		t.Fatalf("bytes=%d want=%d", reg.memoryBytes, MaxGenericFormulaMemoryBytes)
	}
	before := *reg.CloneForRun()
	if _, err := reg.Register(registryConstProgram("more", 2)); !errors.Is(err, errGenericMemoryLimit) {
		t.Fatalf("memory maximum +1 program err=%v", err)
	}
	registryAssertUnchanged(t, reg, before)

	var empty GenericRegistry
	emptyBefore := empty
	oversized := GenericProgram{Key: program.Key, Instr: append([]GenericInstr(nil), program.Instr...)}
	oversized.Instr[0].ReadKey = storage
	if _, err := empty.Register(oversized); !errors.Is(err, errGenericMemoryLimit) {
		t.Fatalf("single program memory maximum +1 byte err=%v", err)
	}
	registryAssertUnchanged(t, empty, emptyBefore)
	if empty.Index != nil || empty.Programs != nil {
		t.Fatal("rejected first registration allocated table state")
	}
	if _, err := empty.Register(registryConstProgram("after-failure", 3)); err != nil {
		t.Fatalf("registration after failure: %v", err)
	}
}

func TestGenericRegistryPlatformAccountingUsesRetainedBytes(t *testing.T) {
	program := GenericProgram{Key: "公式", Instr: []GenericInstr{
		{Op: GenericOpConst, Value: 1, ReadKey: "生命"},
		{Op: GenericOpRound, ReadKey: "生命"},
	}}
	got, err := genericProgramMemoryBytes(program)
	want := uint64(unsafe.Sizeof(GenericProgram{})) + 2*uint64(unsafe.Sizeof(GenericInstr{})) + uint64(len(program.Key)) + 2*uint64(len("生命"))
	if err != nil || got != want {
		t.Fatalf("memory=%d want=%d err=%v", got, want, err)
	}
	t.Logf("GOARCH=%s programHeader=%d instruction=%d logicalBytes=%d", runtime.GOARCH, unsafe.Sizeof(GenericProgram{}), unsafe.Sizeof(GenericInstr{}), got)
}

func TestGenericRegistryCloneForRunOwnsDescriptorsAndIndex(t *testing.T) {
	reg := GenericRegistry{Programs: make([]GenericProgram, 0, 8)}
	if _, err := reg.Register(registryConstProgram("original", 10)); err != nil {
		t.Fatal(err)
	}
	originalLength, originalInstructions, originalBytes := len(reg.Programs), reg.instructionCount, reg.memoryBytes
	clone := reg.CloneForRun()
	if &clone.Programs[0] == &reg.Programs[0] || &clone.Programs[0].Instr[0] != &reg.Programs[0].Instr[0] {
		t.Fatal("clone must own program descriptors and share only read-only instructions")
	}
	if cap(clone.Programs) != len(clone.Programs) {
		t.Fatalf("cloned program capacity=%d length=%d", cap(clone.Programs), len(clone.Programs))
	}
	id, err := clone.Register(registryConstProgram("temporary", 20))
	if err != nil || id != 1 {
		t.Fatalf("temporary id=%d err=%v", id, err)
	}
	clone.Programs[0].Key = "changed-clone-descriptor"
	delete(clone.Index, "original")
	if len(reg.Programs) != originalLength || reg.Programs[0].Key != "original" || len(reg.Index) != 1 || reg.Index["original"] != 0 ||
		reg.instructionCount != originalInstructions || reg.memoryBytes != originalBytes {
		t.Fatal("clone changed original registry")
	}
	if reg.Programs[:cap(reg.Programs)][1].Key != "" {
		t.Fatal("run append wrote original spare capacity")
	}
	value, err := reg.Eval(0, GenericEvalContext{})
	if err != nil || value != 10 {
		t.Fatalf("original value=%v err=%v", value, err)
	}
	fresh := reg.CloneForRun()
	if len(fresh.Programs) != 1 || len(fresh.Index) != 1 {
		t.Fatal("next run inherited temporary registration")
	}
}

func TestGenericRegistryAccountsHandConstructedTableBeforeAppending(t *testing.T) {
	reg := GenericRegistry{
		Programs: []GenericProgram{registryConstProgram("existing", 1)},
		Index:    map[string]GenericProgramID{"existing": 0},
	}
	existingBytes, _ := genericProgramMemoryBytes(reg.Programs[0])
	newProgram := registryConstProgram("new", 2)
	newBytes, _ := genericProgramMemoryBytes(newProgram)
	if id, err := reg.Register(newProgram); err != nil || id != 1 || reg.instructionCount != 2 || reg.memoryBytes != existingBytes+newBytes {
		t.Fatalf("id=%d instructions=%d bytes=%d err=%v", id, reg.instructionCount, reg.memoryBytes, err)
	}
}

func registryExprWithInstructions(n int) model.GenericFormulaExpr {
	if n == 1 {
		return ifConst(1)
	}
	if n%2 == 0 {
		child := registryExprWithInstructions(n - 1)
		return model.GenericFormulaExpr{Op: "round", Expr: &child}
	}
	left := (n - 1) / 2
	return model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{
		registryExprWithInstructions(left), registryExprWithInstructions(n - 1 - left),
	}}
}

func TestCompileGenericFormulaInstructionBoundaryAndNilOnError(t *testing.T) {
	for _, n := range []int{MaxGenericProgramInstructions, MaxGenericProgramInstructions + 1} {
		t.Run(strconv.Itoa(n), func(t *testing.T) {
			var failures []model.EngineError
			instr := CompileGenericFormula(registryExprWithInstructions(n), "amount", nil, nil, func(code model.GenericErrCode, path, message, ref string) {
				failures = append(failures, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
			})
			if n == MaxGenericProgramInstructions {
				if len(failures) != 0 || len(instr) != n || !validGenericProgramStack(instr) {
					t.Fatalf("valid boundary instructions=%d failures=%+v", len(instr), failures)
				}
			} else if instr != nil || len(failures) != 1 || !strings.Contains(failures[0].Message, "instruction count") || !strings.HasPrefix(failures[0].Path, "amount") {
				t.Fatalf("limit instructions=%v failures=%+v", instr, failures)
			}
		})
	}
	bad := model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{ifConst(1), {Op: "read", Path: "history.invalid"}}}
	if instr := CompileGenericFormula(bad, "amount", nil, nil, func(model.GenericErrCode, string, string, string) {}); instr != nil {
		t.Fatal("invalid expression returned partial bytecode")
	}
}

func TestCompileGenericFormulaIfBudgetStopsBeforeJumpWrites(t *testing.T) {
	cases := []struct {
		name string
		expr model.GenericFormulaExpr
	}{
		{"condition_jump", ifExpr(registryExprWithInstructions(512), ifConst(1), ifConst(2))},
		{"end_jump", ifExpr(ifConst(1), registryExprWithInstructions(510), ifConst(2))},
		{"false_branch", ifExpr(ifConst(1), ifConst(2), registryExprWithInstructions(509))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var out []GenericInstr
			errors := 0
			if compileGenericNode(tc.expr, "amount", nil, make(map[string]bool), &out, 1, func(model.GenericErrCode, string, string, string) { errors++ }) {
				t.Fatal("over-budget branch compiled")
			}
			if len(out) != MaxGenericProgramInstructions || errors != 1 {
				t.Fatalf("partial length=%d errors=%d", len(out), errors)
			}
			if instr := CompileGenericFormula(tc.expr, "amount", nil, nil, func(model.GenericErrCode, string, string, string) {}); instr != nil {
				t.Fatal("over-budget if returned partial jumps")
			}
		})
	}
}

func TestCompileGenericFormulaStopsExponentialReferenceExpansion(t *testing.T) {
	named := map[string]model.GenericFormulaExpr{"n0": ifConst(1)}
	for i := 1; i <= 15; i++ {
		ref := model.GenericFormulaExpr{Op: "ref", Ref: "n" + strconv.Itoa(i-1)}
		named["n"+strconv.Itoa(i)] = model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{ref, ref}}
	}
	visiting := make(map[string]bool)
	var out []GenericInstr
	var failures []model.EngineError
	root := model.GenericFormulaExpr{Op: "ref", Ref: "n15"}
	add := func(code model.GenericErrCode, path, message, ref string) {
		failures = append(failures, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	}
	if compileGenericNode(root, "amount", named, visiting, &out, 1, add) || len(out) != MaxGenericProgramInstructions || len(failures) != 1 || !strings.Contains(failures[0].Message, "instruction count") {
		t.Fatalf("expansion length=%d failures=%+v", len(out), failures)
	}
	if len(visiting) != 0 {
		t.Fatalf("failed expansion retained visiting keys: %v", visiting)
	}
	failures = nil
	if instr := CompileGenericFormula(root, "amount", named, visiting, add); instr != nil || len(failures) != 1 {
		t.Fatalf("expansion instr=%v failures=%+v", instr, failures)
	}
	named["n0"] = model.GenericFormulaExpr{Op: "const"}
	failures = nil
	if instr := CompileGenericFormula(root, "amount", named, visiting, add); instr != nil || len(failures) != 1 || !strings.Contains(failures[0].Message, "requires value") {
		t.Fatalf("invalid expansion kept walking: instr=%v failures=%+v", instr, failures)
	}
}

func TestCompileNamedFormulasRegistersWithBoundedCapacityAndNoOverwrite(t *testing.T) {
	var excessive []model.EngineError
	tooMany := CompileNamedFormulas(make([]model.NamedFormula, MaxGenericPrograms+1), func(code model.GenericErrCode, path, message, ref string) {
		excessive = append(excessive, model.EngineError{Code: code, Path: path})
	})
	if len(tooMany.Programs) != 0 || len(excessive) != 1 || excessive[0].Code != "FORMULA_LIMIT" || excessive[0].Path != "/formulas/65536/key" {
		t.Fatal("named count budget created a partial table", excessive)
	}
	defs := make([]model.NamedFormula, 64)
	for i := range defs {
		defs[i] = formuladefinition.Constant(strconv.Itoa(i), "test", float64(i))
	}
	var failures []model.EngineError
	reg := CompileNamedFormulas(defs, func(code model.GenericErrCode, path, message, ref string) {
		failures = append(failures, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	})
	if len(failures) != 0 || len(reg.Programs) != len(defs) || reg.instructionCount != len(defs)*2 {
		t.Fatalf("named boundary programs=%d cap=%d instructions=%d failures=%+v", len(reg.Programs), cap(reg.Programs), reg.instructionCount, failures)
	}
	last, err := reg.Eval(reg.Index["63"], GenericEvalContext{})
	if err != nil || last != 63 {
		t.Fatalf("named last value=%v err=%v", last, err)
	}
	failures = nil
	reg = CompileNamedFormulas([]model.NamedFormula{formuladefinition.Constant("duplicate", "test", 1), formuladefinition.Constant("duplicate", "test", 2)}, func(code model.GenericErrCode, path, message, ref string) {
		failures = append(failures, model.EngineError{Code: code, Path: path, Message: message, Ref: ref})
	})
	if len(reg.Programs) != 1 || reg.Index["duplicate"] != 0 || len(failures) != 1 {
		t.Fatalf("duplicate table=%+v failures=%+v", reg, failures)
	}
	value, err := reg.Eval(0, GenericEvalContext{})
	if err != nil || value != 1 {
		t.Fatalf("duplicate overwrote old program: value=%v err=%v", value, err)
	}
}
