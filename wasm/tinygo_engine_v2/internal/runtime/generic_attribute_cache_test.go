package runtime

import (
	"encoding/json"
	"testing"

	"tinygo_engine_v2/internal/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func memoTestResolver(read formula.GenericInstr) (genericRunState, pipeline.AttributeResolver) {
	state := genericRunState{formulas: formula.GenericRegistry{Programs: []formula.GenericProgram{{Key: "memo", Instr: []formula.GenericInstr{read}}}}}
	resolver := pipeline.AttributeResolver{}
	resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{Kind: "attribute", Target: "speed", HasValue: true, ValueProgram: 0, ValuePolicy: "add"})
	return state, resolver
}

func TestAttributeMemoMissingTargetDoesNotCreateProviderContext(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderState, ReadKey: "stacks"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})
	calls := 0
	provider := func(string, string) pipeline.ProviderFormulaContext {
		calls++
		return pipeline.ProviderFormulaContext{HasProviderContext: true, ProviderState: map[string]float64{"stacks": 2}}
	}
	if _, err := state.resolveOrdinaryAttributes("source", attrs, resolver, formula.GenericEvalContext{}, provider); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("missing target caused %d provider callbacks", calls)
	}
	attrs = attrs.With("speed", authoringSlot(100))
	resolved, err := state.resolveOrdinaryAttributes("source", attrs, resolver, formula.GenericEvalContext{}, provider)
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
		return pipeline.ProviderFormulaContext{HasProviderContext: true, ProviderState: stacks}
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
		resolved, err := state.resolveOrdinaryAttributes("source", attrs, resolver, ctx, provider)
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
		resolved, err := state.resolveOrdinaryAttributes("source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs}, nil)
		if err != nil || resolved.At("speed").Resolved != 100+current {
			t.Fatal(resolved, err)
		}
	}
	resolved, err := state.resolveOrdinaryAttributes("source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs, StrictReads: true}, nil)
	if err != nil || resolved.At("speed").Resolved != 100 {
		t.Fatal(resolved, err)
	}
	// JSON字段存在性由作者共同绑定检查；内部旧读取只检查属性槽。
	var registry formula.GenericRegistry
	definition := formuladefinition.FromExpr("hp_total", "buff", model.GenericFormulaExpr{Op: "read", Path: "source.attr.hp.resolved"}, nil)
	formula.CompileDeclaredNamedFormulas([]model.NamedFormula{definition}, []string{"hp"}, &registry, func(code model.GenericErrCode, path, message, ref string) { t.Fatal(code, path, message) })
	state.formulas = registry
	state.attributeMemos = nil
	if _, err := state.resolveOrdinaryAttributes("source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs, StrictReads: true}, nil); err != nil {
		t.Fatal(err)
	}
	var missing model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"base":100,"current":3,"max":100}`), &missing); err != nil {
		t.Fatal(err)
	}
	attrs = attrs.With("hp", missing)
	if _, err := state.resolveOrdinaryAttributes("source", attrs, resolver, formula.GenericEvalContext{SourceAttrs: attrs, StrictReads: true}, nil); err == nil {
		t.Fatal("memo hid a missing resolved field")
	}
}

func TestAttributeMemoUnknownContextContinuesEvaluation(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadAbilityParam, ReadKey: "bonus"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)})
	for _, amount := range []float64{2, 3} {
		resolved, err := state.resolveOrdinaryAttributes("source", attrs, resolver, formula.GenericEvalContext{AbilityParams: map[string]float64{"bonus": amount}}, nil)
		if err != nil || resolved.At("speed").Resolved != 100+amount {
			t.Fatal(resolved, err)
		}
	}
}

func TestAttributeRefreshMemoHealthOnlyAndActualHealthDependency(t *testing.T) {
	for _, readsHealth := range []bool{false, true} {
		state := genericRunState{combatants: map[string]combatantRuntime{
			"source": {key: "source", attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100), "speed": authoringSlot(100)})},
			"target": {key: "target", attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": authoringSlot(100)})},
		}}
		if readsHealth {
			read := formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "hp.current"}
			programs, resolver := memoTestResolver(read)
			state.formulas = programs.formulas
			host := state.combatants["source"]
			host.resolver = resolver
			state.combatants["source"] = host
		}
		frame := state.newExecutionFrame("source", "target", "")
		ability := planbundle.CompiledAbility{}
		frame.reResolveStagedAttributesTwoPass(ability)
		frame.reResolveStagedAttributesTwoPass(ability) // 依赖已稳定。
		host := frame.stageFor("source")
		hp := host.attributes.At("hp")
		hp.Current, hp.Resolved = 20, 20
		host.attributes = host.attributes.With("hp", hp)
		_, _, unchanged := frame.refreshMemo(frame.evalContext(ability))
		if unchanged == readsHealth {
			t.Fatalf("health dependency=%v, unchanged=%v", readsHealth, unchanged)
		}
		frame.reResolveStagedAttributesTwoPass(ability)
		want := 100.0
		if readsHealth {
			want = 120
		}
		if frame.fatal || host.attributes.At("speed").Resolved != want || host.attributes.At("hp").Current != 20 || host.attributes.At("hp").Resolved != 20 {
			t.Fatal(readsHealth, host.attributes, frame.fatalErr)
		}
		if !readsHealth {
			allocs := testing.AllocsPerRun(20, func() { frame.reResolveStagedAttributesTwoPass(ability) })
			if allocs != 0 {
				t.Fatalf("unchanged refresh allocated %.1f objects", allocs)
			}
		}
	}
}
