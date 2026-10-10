package runtime

import (
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/command"
	"tinygo_engine_v2/internal/expression"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/inputbinding"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func assertNoLegacyDefenseFields(t *testing.T, data map[string]interface{}) {
	t.Helper()
	for _, key := range []string{"resistanceBeforePenetration", "penetrationPercent", "penetrationFlat", "effectiveResistance"} {
		if _, exists := data[key]; exists {
			t.Fatalf("removed defense field %s survived: %+v", key, data)
		}
	}
}

func TestFormulaPhase4DamagePlanGuardPrecedesEveryAmountShortcut(t *testing.T) {
	corruptions := []struct {
		name   string
		change func(*genericRunState, planbundle.CompiledDamageTypeFormula)
	}{
		{"missing", func(s *genericRunState, _ planbundle.CompiledDamageTypeFormula) {
			delete(s.compiled.DamageTypeFormulas, "damage/physical")
		}},
		{"nil binding", func(s *genericRunState, d planbundle.CompiledDamageTypeFormula) {
			d.Binding = nil
			s.compiled.DamageTypeFormulas[d.DamageType] = d
		}},
		{"out of range", func(s *genericRunState, d planbundle.CompiledDamageTypeFormula) {
			d.Program = 65535
			s.compiled.DamageTypeFormulas[d.DamageType] = d
		}},
		{"wrong identity", func(s *genericRunState, d planbundle.CompiledDamageTypeFormula) {
			d.DamageType = "foreign"
			s.compiled.DamageTypeFormulas["damage/physical"] = d
		}},
		{"internal program zero", func(s *genericRunState, d planbundle.CompiledDamageTypeFormula) {
			s.formulas.Programs[0] = formula.GenericProgram{Key: "sentinel-zero", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 999}}}
			d.Program = 0
			s.compiled.DamageTypeFormulas[d.DamageType] = d
		}},
		{"empty common program", func(s *genericRunState, d planbundle.CompiledDamageTypeFormula) {
			s.formulas.Programs[d.Program].Authored = &expression.Program{}
		}},
		{"mixed program", func(s *genericRunState, d planbundle.CompiledDamageTypeFormula) {
			s.formulas.Programs[d.Program].Instr = []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 999}}
		}},
		{"foreign skill program", func(s *genericRunState, d planbundle.CompiledDamageTypeFormula) {
			s.formulas.Programs[d.Program].NamedBinding = &formula.NamedBinding{}
		}},
	}
	for _, test := range corruptions {
		for _, input := range []struct {
			name   string
			amount float64
		}{{"zero", 0}, {"positive", 100}, {"negative", -1}, {"NaN", math.NaN()}, {"infinite", math.Inf(1)}} {
			t.Run(test.name+"/"+input.name, func(t *testing.T) {
				amount := input.amount
				c, r := frameCommitInput(frameCommitDamage(100))
				s := frameCommitState(t, c, r)
				f, ability, ops := frameCommitFrame(s)
				def := s.compiled.DamageTypeFormulas["damage/physical"]
				test.change(s, def)
				before := s.combatants["target"].attributes["hp"]
				cmd := command.Command{Kind: command.KindDamage, Source: "source", Target: "target", DamageType: "damage/physical", Amount: amount}
				_, issue := f.resolveDamageNumbers(cmd, ops[0], frozenCritEvidence{}, ability, nil)
				if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != ops[0].Path+".damageType" || issue.Ref != "damage/physical" {
					t.Fatalf("plan shortcut: amount=%v issue=%+v", amount, issue)
				}
				if s.combatants["target"].attributes["hp"] != before || s.sourceDamageDealt != 0 || len(s.damageHistory) != 0 {
					t.Fatal("invalid plan committed combat results")
				}
			})
		}
	}
}

func TestFormulaPhase4BrokenDefenseDropsEarlierStagedWritesAndRecovers(t *testing.T) {
	c, r := frameCommitInput(model.OperationDefinition{Operation: "shield", Target: "target", Amount: authoringAmount(authoringConst(50))}, frameCommitDamage(100))
	s := frameCommitState(t, c, r)
	def := s.compiled.DamageTypeFormulas["damage/physical"]
	before := *s.formulas.CloneForRun()
	delete(s.compiled.DamageTypeFormulas, "damage/physical")
	issue := s.runLoop()
	if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != "sharedProviders[0].abilities[0].operations[1].damageType" {
		t.Fatalf("run=%+v", issue)
	}
	if s.combatants["target"].attributes["hp"].Current != 1000 || len(s.combatants["target"].shields) != 0 || s.sourceDamageDealt != 0 || len(s.damageHistory) != 0 {
		t.Fatal("failed frame submitted earlier shield or damage")
	}
	if !reflect.DeepEqual(s.formulas, before) {
		t.Fatal("failed invariant modified formulas")
	}
	s.compiled.DamageTypeFormulas["damage/physical"] = def
	done, issue := RunGeneric(s.compiled, r)
	if issue != nil || done.Summary.TargetFinalHp != 950 || done.Summary.SourceDamageDealt != 100 {
		t.Fatalf("following run contaminated: %+v %+v", done.Summary, issue)
	}
}

func TestFormulaPhase4GenericDamageFallbackCannotWrite(t *testing.T) {
	c, r := frameCommitInput(frameCommitDamage(100))
	s := frameCommitState(t, c, r)
	f, ability, ops := frameCommitFrame(s)
	issue := f.applyCommand(command.Command{Kind: command.KindDamage, Source: "source", Target: "target", DamageType: "damage/physical", Amount: 100}, ops[0], ability)
	if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != ops[0].Path+".damageType" || len(f.staged) != 0 || s.sourceDamageDealt != 0 {
		t.Fatalf("generic fallback escaped guard: %+v", issue)
	}
}

func TestFormulaPhase4CopiedZeroDamageRequiresRealPlan(t *testing.T) {
	c, r := frameCommitInput(frameCommitDamage(100))
	s := frameCommitState(t, c, r)
	delete(s.compiled.DamageTypeFormulas, "damage/physical")
	operation := planbundle.CompiledOperation{Path: "original.listener.operations[3]", Operation: "damage", DamageType: "damage/physical"}
	damage := copyableDamageFrozen{sourceKey: "source", targetKey: "target", damageType: "damage/physical", operation: operation, rawAmount: 0}
	issue := s.applyPhantomCopyableDamage(&eventCopyableCollector{}, damage, "copy")
	if issue == nil || issue.Code != model.GenericErrRuntimeInvariantFailed || issue.Path != operation.Path+".damageType" || s.combatants["target"].attributes["hp"].Current != 1000 || len(s.damageHistory) != 0 {
		t.Fatalf("copied zero bypassed guard: %+v", issue)
	}
}

// 手工运行态测试也必须由作者明确给出原键和完整共同定义。
func registerTestDefense(t *testing.T, state *genericRunState, key string, definition map[string]any) {
	t.Helper()
	var allowed []any
	var catalog []expression.Binding
	var reads []planbundle.CompiledDamageAttributeRead
	for _, item := range definition["inputs"].([]any) {
		b := item.(map[string]any)["binding"].(map[string]any)
		allowed = append(allowed, b)
		binding := expression.Binding{Kind: "attribute", Object: b["object"].(string), AttributeKey: b["attributeKey"].(string), ValueKind: "TOTAL", View: "current_frame"}
		catalog = append(catalog, binding)
		reads = append(reads, planbundle.CompiledDamageAttributeRead{Object: binding.Object, AttributeKey: binding.AttributeKey})
	}
	program, issue := expression.CompileDefinition(definition, allowed)
	if issue != nil {
		t.Fatal(issue)
	}
	bound, issue := inputbinding.Bind(program, catalog)
	if issue != nil {
		t.Fatal(issue)
	}
	id, err := state.formulas.Register(formula.GenericProgram{Key: "test-defense/" + key, Authored: program, BindingBytes: bound.ChargedBytes()})
	if err != nil {
		t.Fatal(err)
	}
	if state.compiled.DamageTypeFormulas == nil {
		state.compiled.DamageTypeFormulas = map[string]planbundle.CompiledDamageTypeFormula{}
	}
	state.compiled.DamageTypeFormulas[key] = planbundle.CompiledDamageTypeFormula{DamageType: key, Program: id, Binding: bound, Reads: reads, Path: "test-defense/" + key, OutputPath: "test-defense/" + key}
}
