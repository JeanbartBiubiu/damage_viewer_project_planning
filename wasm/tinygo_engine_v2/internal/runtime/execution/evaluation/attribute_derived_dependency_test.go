package evaluation

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func derivedDependencyFixture(t *testing.T, route string) (*attributeFixture, effectpkg.AttributeResolver, attribute.Table, attribute.Table) {
	t.Helper()
	var registry formula.GenericRegistry
	definition := formuladefinition.FromExpr("dependency_base", "dependency_skill", authoringRead("source.attr.pulse.base"), nil)
	formula.CompileDeclaredNamedFormulas([]model.NamedFormula{definition}, []string{"speed", "pulse"}, &registry, func(code model.GenericErrCode, path, message, ref string) {
		t.Fatal(code, path, message, ref)
	})
	program := formula.GenericProgramID(0)
	resolver := effectpkg.AttributeResolver{}
	if route == "set_modifier" {
		var err error
		program, err = registry.Register(formula.GenericProgram{Key: "constant_output", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 10}}})
		if err != nil {
			t.Fatal(err)
		}
		resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{ModifierKey: "dependency_add", Kind: "attribute", Target: "speed", ValuePolicy: "add", ValueProgram: 0, HasValue: true})
	}
	state := &attributeFixture{formulas: registry,
		compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{
			CombatantKey: "source", AttributeKey: "speed", SkillKey: "dependency_skill", ValueProgram: program, ValuePolicy: "set", ValueType: "DECIMAL", Path: "rules.attributeDerivations[0]",
		}}},
	}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100), "pulse": {Base: 2, Current: 3, Max: 4, Resolved: 5}})
	for index := 0; index < 178; index++ {
		attrs = attrs.With(fmt.Sprintf("unrelated_%03d", index), authoringSlot(float64(index+1)))
	}
	return state, resolver, attrs, attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})
}

func assertDerivedDependencyMatchesUncached(t *testing.T, state *attributeFixture, resolver effectpkg.AttributeResolver, attrs, target attribute.Table, provider pipeline.ProviderFormulaContextFunc) (attribute.Table, error) {
	t.Helper()
	before := independentAttributeTable(attrs)
	want, wantErr := ResolveDerivedAttributes(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, target, provider)
	got, gotErr := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "source", attrs, resolver, attrs, target, provider)
	if (wantErr == nil) != (gotErr == nil) || (wantErr != nil && wantErr.Error() != gotErr.Error()) || !reflect.DeepEqual(got, want) {
		t.Fatalf("cached path differs: got=%+v error=%v want=%+v error=%v", got, gotErr, want, wantErr)
	}
	if !reflect.DeepEqual(attrs, before) {
		t.Fatal("derived calculation mutated its input")
	}
	if wantErr != nil {
		var wantAuthored, gotAuthored *formula.AuthoredEvaluationError
		if errors.As(wantErr, &wantAuthored) && (!errors.As(gotErr, &gotAuthored) || !reflect.DeepEqual(gotAuthored.Issue, wantAuthored.Issue) || gotAuthored.ProgramKey != wantAuthored.ProgramKey || gotAuthored.DefinitionPath != wantAuthored.DefinitionPath || gotAuthored.CombatantKey != wantAuthored.CombatantKey) {
			t.Fatalf("cached path changed authored error: got=%v want=%v", gotErr, wantErr)
		}
	}
	return got, gotErr
}

func assertDerivedDependencyWarmHit(t *testing.T, state *attributeFixture, resolver effectpkg.AttributeResolver, attrs, target attribute.Table, provider pipeline.ProviderFormulaContextFunc) {
	t.Helper()
	memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", true, false, [2]string{}, resolver, attrs)
	if len(memo.values) != 1 || memo.output.Layout().Key(memo.values[0].index) != "speed" {
		t.Fatalf("derived-only memo retained unrelated values: attrs=%d values=%+v", attrs.Len(), memo.values)
	}
	ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: attrs, TargetAttrs: target}
	if !memo.Probe(attrs, &ctx, provider) {
		t.Fatal("unchanged valid derived inputs did not hit the warm cache")
	}
}

func TestDerivedDependencyNonOutputBaseAndPresenceRemainRequired(t *testing.T) {
	for _, route := range []string{"derivation", "set_modifier"} {
		t.Run(route, func(t *testing.T) {
			state, resolver, attrs, target := derivedDependencyFixture(t, route)
			callbacks := 0
			provider := func(owner, ref string) pipeline.ProviderFormulaContext {
				if owner != "source" || ref != "buff" {
					t.Fatal("unexpected modifier provenance", owner, ref)
				}
				callbacks++
				return pipeline.ProviderFormulaContext{HasProviderContext: true}
			}
			out, err := assertDerivedDependencyMatchesUncached(t, state, resolver, attrs, target, provider)
			if err != nil {
				t.Fatal(err)
			}
			initial := 2.0
			if route == "set_modifier" {
				initial = 12
			}
			if out.At("speed").Resolved != initial {
				t.Fatal(out.At("speed"), initial)
			}
			beforeWarmCallbacks := callbacks
			assertDerivedDependencyWarmHit(t, state, resolver, attrs, target, provider)
			if route == "set_modifier" && callbacks <= beforeWarmCallbacks {
				t.Fatal("a warm set-modifier cache skipped its provider callback")
			}
			pulse := attrs.At("pulse")
			pulse.Base = 4
			attrs = attrs.With("pulse", pulse)
			out, err = assertDerivedDependencyMatchesUncached(t, state, resolver, attrs, target, provider)
			if err != nil || out.At("speed").Resolved != initial+2 {
				t.Fatalf("non-output base change was lost: %+v %v", out, err)
			}
			assertDerivedDependencyWarmHit(t, state, resolver, attrs, target, provider)
			var missing model.AttributeSlotDef
			if err := json.Unmarshal([]byte(`{"current":3,"max":4,"resolved":5}`), &missing); err != nil {
				t.Fatal(err)
			}
			// 数值位仍与暖缓存相同，只有真正的作者字段存在性变了。
			missing.Base = pulse.Base
			attrs = attrs.With("pulse", missing)
			_, err = assertDerivedDependencyMatchesUncached(t, state, resolver, attrs, target, provider)
			var authored *formula.AuthoredEvaluationError
			if !errors.As(err, &authored) || authored.Issue.Code != "FORMULA_MISSING_INPUT" {
				t.Fatalf("missing non-output BASE field was hidden: %v", err)
			}
			attrs = attrs.With("pulse", pulse)
			if _, err := assertDerivedDependencyMatchesUncached(t, state, resolver, attrs, target, provider); err != nil {
				t.Fatal(err)
			}
			assertDerivedDependencyWarmHit(t, state, resolver, attrs, target, provider)
		})
	}
}

func TestDerivedDependencySameSizeKeyReplacementRebuildsAndRecovers(t *testing.T) {
	for _, route := range []string{"derivation", "set_modifier"} {
		for _, removed := range []string{"speed", "pulse"} {
			t.Run(route+"/remove_"+removed, func(t *testing.T) {
				state, resolver, attrs, target := derivedDependencyFixture(t, route)
				if _, err := assertDerivedDependencyMatchesUncached(t, state, resolver, attrs, target, nil); err != nil {
					t.Fatal(err)
				}
				assertDerivedDependencyWarmHit(t, state, resolver, attrs, target, nil)
				oldMemo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", true, false, [2]string{}, resolver, attrs)
				original := attrs.At(removed)
				attrs = attrs.Without(removed)
				attrs = attrs.With("unrelated_replacement", authoringSlot(99))
				if attrs.Len() != 180 {
					t.Fatal("key replacement must retain the same count")
				}
				out, err := assertDerivedDependencyMatchesUncached(t, state, resolver, attrs, target, nil)
				if removed == "pulse" {
					var authored *formula.AuthoredEvaluationError
					if !errors.As(err, &authored) || authored.Issue.Code != "FORMULA_MISSING_INPUT" {
						t.Fatalf("missing dependency was hidden by equal key count: %v", err)
					}
				} else {
					// 原未缓存入口可补回派生输出，继续保持该实际行为。
					if _, exists := out.Lookup("speed"); err != nil || !exists {
						t.Fatalf("missing output differs from uncached behavior: %+v %v", out, err)
					}
				}
				if state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", true, false, [2]string{}, resolver, attrs) == oldMemo {
					t.Fatal("equal-sized key replacement reused the old key-set memo")
				}
				attrs = attrs.Without("unrelated_replacement")
				attrs = attrs.With(removed, original)
				if _, err := assertDerivedDependencyMatchesUncached(t, state, resolver, attrs, target, nil); err != nil {
					t.Fatal(err)
				}
				assertDerivedDependencyWarmHit(t, state, resolver, attrs, target, nil)
			})
		}
	}
}

func TestDerivedDependencyMemoWithoutActorOutputStoresNoValues(t *testing.T) {
	state, resolver, attrs, _ := derivedDependencyFixture(t, "derivation")
	before := independentAttributeTable(attrs)
	if _, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "target", attrs, resolver, attrs, attrs, nil); err != nil {
		t.Fatal(err)
	}
	memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "target", true, false, [2]string{}, resolver, attrs)
	ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: attrs, TargetAttrs: attrs}
	if len(memo.values) != 0 || len(memo.derivedInputs) != 0 || !memo.Probe(attrs, &ctx, nil) {
		t.Fatalf("no-output actor retained the 180 unrelated slots: %+v", memo.values)
	}
	out, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "target", attrs, resolver, attrs, attrs, nil)
	if err != nil || !reflect.DeepEqual(out, before) || !reflect.DeepEqual(attrs, before) {
		t.Fatal("no-output actor changed input", out, err)
	}
}
