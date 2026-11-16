package evaluation

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"encoding/json"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func memoTestResolver(read formula.GenericInstr) (attributeFixture, effectpkg.AttributeResolver) {
	state := attributeFixture{formulas: fixtureFormulaLibrary([]formula.GenericProgram{{Key: "memo", Instr: []formula.GenericInstr{read}}})}
	resolver := effectpkg.AttributeResolver{}
	resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{Kind: "attribute", Target: "speed", HasValue: true, ValueProgram: 0, ValuePolicy: "add"})
	return state, resolver
}

func TestAttributeMemoMissingTargetDoesNotCreateProviderContext(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderState, ReadKey: "stacks"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})
	calls := 0
	provider := func(string, string) pipeline.ProviderFormulaContext {
		calls++
		return pipeline.ProviderFormulaContext{HasProviderContext: true, ProviderState: model.BorrowNumericView(map[string]float64{"stacks": 2})}
	}
	if _, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{}, provider); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("missing target caused %d provider callbacks", calls)
	}
	attrs = attrs.With("speed", authoringSlot(100))
	resolved, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{}, provider)
	if err != nil || resolved.At("speed").Resolved != 102 || calls == 0 {
		t.Fatal(resolved, calls, err)
	}
}

func TestAttributeMemoPreservesHealthAndExpiresProviderReads(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderState, ReadKey: "stacks"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100), "speed": authoringSlot(100)})
	stacks := map[string]float64{"stacks": 2}
	expired, callbacks := false, 0
	provider := func(string, string) pipeline.ProviderFormulaContext {
		callbacks++
		if expired {
			stacks["stacks"] = 0
		}
		return pipeline.ProviderFormulaContext{HasProviderContext: true, ProviderState: model.BorrowNumericView(stacks)}
	}
	ctx := formula.GenericEvalContext{}
	for _, want := range []float64{102, 102, 103, 100} {
		if want == 103 {
			stacks["stacks"] = 3
		}
		if want == 100 {
			expired = true
		}
		hp := attrs.At("hp")
		hp.Current = 25
		hp.Max = 150
		attrs = attrs.With("hp", hp)
		resolved, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider)
		if err != nil || resolved.At("speed").Resolved != want || resolved.At("hp").Current != 25 || resolved.At("hp").Max != 150 {
			t.Fatal(resolved, err)
		}
		if attrs.At("speed").Resolved != 100 {
			t.Fatal("memo changed caller input")
		}
	}
	if callbacks < 4 {
		t.Fatal("memo skipped provider expiry callbacks")
	}
}

func TestAttributeMemoReadPresenceAndLegacyZeroFallback(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "hp.resolved"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": {Base: 100, Current: 2, Max: 100, Resolved: 0}, "speed": authoringSlot(100)})
	for _, current := range []float64{2, 3} {
		hp := attrs.At("hp")
		hp.Current = current
		attrs = attrs.With("hp", hp)
		resolved, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs}, nil)
		if err != nil || resolved.At("speed").Resolved != 100+current {
			t.Fatal(resolved, err)
		}
	}
	resolved, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs, StrictReads: true}, nil)
	if err != nil || resolved.At("speed").Resolved != 100 {
		t.Fatal(resolved, err)
	}
	// JSON字段存在性由作者共同绑定检查；内部旧读取只检查属性槽。
	var registry formula.Library
	definition := formuladefinition.FromExpr("hp_total", "buff", model.GenericFormulaExpr{Op: "read", Path: "source.attr.hp.resolved"}, nil)
	fixtureCompileDeclaredNamed([]model.NamedFormula{definition}, []string{"hp"}, &registry, func(code model.GenericErrCode, path, message, ref string) { t.Fatal(code, path, message) })
	state.formulas = registry
	state.cache = State{}
	if _, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs, StrictReads: true}, nil); err != nil {
		t.Fatal(err)
	}
	var missing model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"base":100,"current":3,"max":100}`), &missing); err != nil {
		t.Fatal(err)
	}
	attrs = attrs.With("hp", missing)
	if _, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs, StrictReads: true}, nil); err == nil {
		t.Fatal("memo hid a missing resolved field")
	}
}

func TestAttributeMemoUnknownContextContinuesEvaluation(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadAbilityParam, ReadKey: "bonus"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)})
	for _, amount := range []float64{2, 3} {
		resolved, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{AbilityParams: model.BorrowNumericView(map[string]float64{"bonus": amount})}, nil)
		if err != nil || resolved.At("speed").Resolved != 100+amount {
			t.Fatal(resolved, err)
		}
	}
}

func TestElapsedProviderAttributeMemoNeverFreezesTime(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderElapsedMs})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)})
	var elapsed int64
	provider := func(string, string) pipeline.ProviderFormulaContext {
		return pipeline.ProviderFormulaContext{HasProviderContext: true, HasProviderElapsed: true, ProviderElapsedMs: elapsed}
	}
	for _, elapsed = range []int64{0, 750, 1499} {
		resolved, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{StrictReads: true}, provider)
		if err != nil || resolved.At("speed").Resolved != 100+float64(elapsed) {
			t.Fatal("elapsed-time dependency was frozen by the cache", elapsed, resolved, err)
		}
		memo := state.cache.Memo(nil, state.formulas, "source", false, false, [2]string{}, resolver, attrs)
		if memo.cacheable {
			t.Fatal("elapsed provider reused an attribute memo with no clock dependency")
		}
	}
}
