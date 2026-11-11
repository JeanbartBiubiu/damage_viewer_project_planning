package formula

import (
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/base/expression"
	"tinygo_engine_v2/internal/base/inputbinding"
	"tinygo_engine_v2/internal/model"
)

// isolatedStoreForTest 通过正式冻结和本场构建路径取得独立前态，不复制一套旧克隆算法。
func (r programStore) isolatedStoreForTest() *programStore {
	builder := Builder{store: &r}
	run := NewBuilder(builder.Freeze())
	return run.writable()
}

func compileNamedForTest(defs []model.NamedFormula, add func(model.GenericErrCode, string, string, string)) programStore {
	b := CompileNamedFormulas(defs, add)
	return *b.current()
}

func TestBuilderClosesRegistrationAliasesAndFrozenMutationHandles(t *testing.T) {
	code := []GenericInstr{{Op: GenericOpConst, Value: 7}}
	var builder Builder
	id, err := builder.Register(GenericProgram{Key: "seven", Instr: code})
	if err != nil {
		t.Fatal(err)
	}
	first := builder.Freeze()
	code[0].Value = 99
	publicCode := first.Metadata.Instructions(id)
	publicCode[0].Value = 199
	oldHandle := builder
	if _, err = oldHandle.Register(GenericProgram{Key: "later", Instr: []GenericInstr{{Op: GenericOpConst, Value: 11}}}); err != nil {
		t.Fatal(err)
	}
	if first.Metadata.Count() != 1 {
		t.Fatal("frozen count changed")
	}
	if _, found := first.Metadata.Find("later"); found {
		t.Fatal("frozen index changed")
	}
	if value, err := first.Evaluation.Eval(id, GenericEvalContext{}); err != nil || value != 7 {
		t.Fatal(value, err)
	}
	if builder.Count() != 2 {
		t.Fatal("copied build handles lost their single build scope")
	}
	second := builder.Freeze()
	if second.Metadata.Count() != 2 {
		t.Fatal("new freeze did not include successful registration")
	}
}

func TestFrozenReferenceBindingAndAttributeRebindingUseIndependentCode(t *testing.T) {
	var builder Builder
	id, err := builder.Register(GenericProgram{Key: "shield", Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadLinkedShieldPresent, ReadKey: "shield"}}})
	if err != nil {
		t.Fatal(err)
	}
	before := builder.Freeze()
	if err = builder.BindReadReference(id, 0, 4); err != nil {
		t.Fatal(err)
	}
	bound := builder.Freeze()
	if before.Metadata.Instructions(id)[0].ReferenceBound || !bound.Metadata.Instructions(id)[0].ReferenceBound || bound.Metadata.Instructions(id)[0].RefIndex != 4 {
		t.Fatal("binding modified an earlier freeze")
	}
	if err = builder.BindReadReference(id, 1, 9); err == nil {
		t.Fatal("out of range read accepted")
	}
	if err = builder.BindReadReference(77, 0, 9); err == nil {
		t.Fatal("unknown program accepted")
	}
	plain, err := builder.Register(GenericProgram{Key: "attribute", Instr: []GenericInstr{{Op: GenericOpRead, ReadKind: ReadSourceAttr, ReadKey: "power.base"}}})
	if err != nil {
		t.Fatal(err)
	}
	unbound := builder.Freeze()
	layout := attribute.NewLayout([]string{"power"})
	builder.BindAttributeLayout(layout)
	withLayout := builder.Freeze()
	if unbound.Metadata.Instructions(plain)[0].AttrIndexBound || !withLayout.Metadata.Instructions(plain)[0].AttrIndexBound {
		t.Fatal("attribute binding leaked across freeze")
	}
	ctx := GenericEvalContext{SourceAttrs: attribute.FromMap(map[string]model.AttributeSlotDef{"power": {Base: 13}}, layout)}
	if value, err := withLayout.Evaluation.Eval(plain, ctx); err != nil || value != 13 {
		t.Fatal(value, err)
	}
	if value, err := unbound.Evaluation.Eval(plain, ctx); err != nil || value != 13 {
		t.Fatal(value, err)
	}
	left, right := NewBuilder(withLayout), NewBuilder(withLayout)
	if _, err := left.Register(GenericProgram{Key: "left", Instr: []GenericInstr{{Op: GenericOpConst, Value: 1}}}); err != nil {
		t.Fatal(err)
	}
	if _, exists := right.Find("left"); exists {
		t.Fatal("per-run append crossed build scopes")
	}
	if right.Count() != withLayout.Metadata.Count() {
		t.Fatal("per-run append changed reusable plan")
	}
	// Unmodified instruction storage stays shared across distinct run builders.
	if &left.current().programs[plain].Instr[0] != &withLayout.Metadata.store.programs[plain].Instr[0] {
		t.Fatal("run builder deep copied immutable instructions")
	}
}

func TestRegistrationOwnsOpaqueAuthoredProgramHeader(t *testing.T) {
	program := authoredRegistryProgram(t, 1, 0)
	bound, issue := inputbinding.Bind(program, nil)
	if issue != nil {
		t.Fatal(issue)
	}
	var builder Builder
	id, err := builder.Register(GenericProgram{Key: "authored", Authored: program})
	if err != nil {
		t.Fatal(err)
	}
	library := builder.Freeze()
	*program = expression.Program{}
	value, err := library.Evaluation.EvalBound(id, bound, nil)
	if err != nil || value != 1 {
		t.Fatal("caller overwritten program changed immutable registry", value, err)
	}
}

func TestBuilderRejectsImpossiblePublicProgramKinds(t *testing.T) {
	for _, program := range []GenericProgram{
		{Key: "empty", Authored: &expression.Program{}},
		{Key: "mixed", Authored: authoredRegistryProgram(t, 1, 0), Instr: []GenericInstr{{Op: GenericOpConst, Value: 2}}},
	} {
		var builder Builder
		if _, err := builder.Register(program); err == nil || builder.Count() != 0 {
			t.Fatal("invalid program obtained a public runtime capability", err)
		}
	}
}

func TestBuilderOwnsNamedParameterAndBindingDescriptors(t *testing.T) {
	program := authoredRegistryProgram(t, 1, 0)
	plan, issue := inputbinding.Bind(program, nil)
	if issue != nil {
		t.Fatal(issue)
	}
	fixed, scene := 4.0, 5.0
	binding := &NamedBinding{scope: "skill", skillKey: "skill", plan: plan,
		parameters: []model.FormulaParameter{{ParameterKey: "fixed", ValueMode: "FIXED", Value: &fixed}, {ParameterKey: "scene", ValueMode: "RUNTIME_INPUT", RuntimeSource: &model.FormulaRuntimeSource{Kind: "scene_parameter", Value: &scene}}}}
	var builder Builder
	p := GenericProgram{Key: "named", Authored: program, NamedBinding: binding}
	id, err := builder.Register(p)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate, err := builder.Register(p); err != nil || duplicate != id {
		t.Fatal("copying parameter descriptors changed key reuse", err)
	}
	library := builder.Freeze()
	fixed, scene = 40, 50
	*plan = inputbinding.Plan{}
	*binding = NamedBinding{}
	owned := library.Metadata.store.programs[id].NamedBinding
	if *owned.parameters[0].Value != 4 || *owned.parameters[1].RuntimeSource.Value != 5 {
		t.Fatal("parameter pointers still alias construction input")
	}
	if value, err := library.Evaluation.Eval(id, GenericEvalContext{}); err != nil || value != 1 {
		t.Fatal("source binding overwrite changed frozen formula", value, err)
	}
}
