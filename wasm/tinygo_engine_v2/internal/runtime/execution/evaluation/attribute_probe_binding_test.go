package evaluation

import effectpkg "tinygo_engine_v2/internal/runtime/effect"

import (
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/testkit/formuladefinition"
)

func TestAttributeProbeUniqueProviderOrderAndReadAssociation(t *testing.T) {
	state := attributeFixture{formulas: fixtureFormulaLibrary([]formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderState, ReadKey: "count"}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderTargetState, ReadKey: "count"}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 2}}},
	})}
	var resolver effectpkg.AttributeResolver
	for _, item := range []struct {
		key, owner, ref, target string
		program                 formula.GenericProgramID
	}{
		{"a0", "", "buff", "speed", 0}, {"a1", "", "buff", "speed", 1},
		{"b0", "source", "buff", "speed", 0}, {"b1", "source", "buff", "speed", 1},
		{"c0", "target", "buff", "speed", 0}, {"d0", "source", "constant", "speed", 2},
		{"e0", "source", "missing", "missing_target", 0},
	} {
		resolver.MountCompiledModifierOwned(item.owner, item.ref, planbundle.CompiledModifier{ModifierKey: item.key, Kind: "attribute", Target: item.target, HasValue: true, ValueProgram: item.program, ValuePolicy: "add"})
	}
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)})
	expectedProviders := []attributeMemoProvider{{"", "buff"}, {"source", "buff"}, {"target", "buff"}, {"source", "constant"}}
	states := map[attributeMemoProvider]map[string]float64{
		{"", "buff"}: {"count": 1}, {"source", "buff"}: {"count": 2}, {"target", "buff"}: {"count": 5},
	}
	targets := map[attributeMemoProvider]map[string]float64{{"", "buff"}: {"count": 3}, {"source", "buff"}: {"count": 4}}
	var calls []attributeMemoProvider
	provider := func(owner, ref string) pipeline.ProviderFormulaContext {
		key := attributeMemoProvider{owner, ref}
		calls = append(calls, key) // 仅测回调次数，公式不读取该计数。
		return pipeline.ProviderFormulaContext{HasProviderContext: true, ProviderState: model.BorrowNumericView(states[key]), ProviderTargetState: model.BorrowNumericView(targets[key])}
	}
	resolved, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, formula.GenericEvalContext{StrictReads: true}, provider)
	if err != nil || resolved.At("speed").Resolved != 117 {
		t.Fatal(resolved, err)
	}
	memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", false, false, [2]string{}, resolver, attrs)
	if !reflect.DeepEqual(memo.providers, expectedProviders) || len(memo.reads) != 5 {
		t.Fatalf("provider order or missing-target filtering changed: %+v reads=%+v", memo.providers, memo.reads)
	}
	for index, want := range []int{0, 0, 1, 1, 2} {
		if memo.reads[index].providerIndex != want {
			t.Fatalf("read %d provider index=%d want %d", index, memo.reads[index].providerIndex, want)
		}
	}
	calls = nil
	ctx := formula.GenericEvalContext{StrictReads: true}
	if !memo.Probe(attrs, &ctx, provider) || !reflect.DeepEqual(calls, expectedProviders) {
		t.Fatalf("warm probe must call each unique pair once in first-mount order: %+v", calls)
	}
	states[attributeMemoProvider{"source", "buff"}]["count"] = 9
	calls = nil
	if memo.Probe(attrs, &ctx, provider) || !reflect.DeepEqual(calls, expectedProviders) {
		t.Fatal("a changed state was hidden or its callback order changed", calls)
	}
	resolved, err = state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider)
	if err != nil || resolved.At("speed").Resolved != 124 {
		t.Fatal("same-ref providers on different owners were aliased", resolved, err)
	}
}

func TestAttributeProbeBoundZeroGuardsDifferentLayoutsAndValueSemantics(t *testing.T) {
	layout := attribute.NewLayout([]string{"dep", "speed"})
	registry := fixtureFormulaLibrary([]formula.GenericProgram{{Instr: []formula.GenericInstr{
		{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "dep.resolved"},
		{Op: formula.GenericOpRead, ReadKind: formula.ReadTargetAttr, ReadKey: "dep.current"}, {Op: formula.GenericOpAdd},
	}}})
	fixtureBindLayout(&registry, layout)
	state := attributeFixture{formulas: registry}
	var resolver effectpkg.AttributeResolver
	resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{Kind: "attribute", Target: "speed", HasValue: true, ValuePolicy: "add"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)}, layout)
	source := attribute.FromMap(map[string]model.AttributeSlotDef{"dep": {Base: 2, Current: 2, Max: 5, Resolved: 0}}, layout)
	target := attribute.FromMap(map[string]model.AttributeSlotDef{"aaa": {Current: 99}, "dep": {Current: 5}})
	ctx := formula.GenericEvalContext{SourceAttrs: source, TargetAttrs: target}
	if out, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, nil); err != nil || out.At("speed").Resolved != 107 {
		t.Fatal(out, err)
	}
	memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", false, false, [2]string{}, resolver, attrs)
	for _, read := range memo.reads {
		if !read.attributeIndexBound || read.attributeIndex != 0 || read.key != "dep" {
			t.Fatalf("bound formula slot zero was not retained: %+v", read)
		}
	}
	if !memo.Probe(attrs, &ctx, nil) {
		t.Fatal("warm probe failed its different-layout fallback")
	}
	slot := source.At("dep")
	slot.Current = 3
	ctx.SourceAttrs = source.With("dep", slot)
	if memo.Probe(attrs, &ctx, nil) {
		t.Fatal("legacy zero fallback current was not checked")
	}
	ctx.StrictReads = true
	if out, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, nil); err != nil || out.At("speed").Resolved != 105 {
		t.Fatal("strict zero incorrectly reused the current fallback", out, err)
	}
	slot.Resolved = math.Copysign(0, -1)
	ctx.SourceAttrs = ctx.SourceAttrs.With("dep", slot)
	if memo.Probe(attrs, &ctx, nil) || memo.scratch[0].value != math.Float64bits(slot.Resolved) {
		t.Fatal("negative-zero dependency lost its float bits")
	}
	if _, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, nil); err != nil {
		t.Fatal(err)
	}
	ctx.TargetAttrs = target.Without("dep")
	if memo.Probe(attrs, &ctx, nil) {
		t.Fatal("a directory entry was mistaken for a present slot")
	}
	_, cachedErr := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, nil)
	_, directErr := resolver.ResolveAttributesWithProviderContext(attrs, ctx, state.formulas, nil)
	if cachedErr == nil || directErr == nil || cachedErr.Error() != directErr.Error() {
		t.Fatal("missing-slot error changed", cachedErr, directErr)
	}
	ctx.TargetAttrs = attribute.FromMap(map[string]model.AttributeSlotDef{"bbb": {Current: 500}, "dep": {Current: 7}})
	if out, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, nil); err != nil || out.At("speed").Resolved != 107 {
		t.Fatal("probe failed to recover with a different attached-key directory", out, err)
	}
}

func TestAttributeProbeUnboundExtraAttributeRetainsKeyLookup(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadTargetAttr, ReadKey: "extra.current"})
	layout := attribute.NewLayout([]string{"speed"})
	fixtureBindLayout(&state.formulas, layout)
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)}, layout)
	ctx := formula.GenericEvalContext{StrictReads: true, TargetAttrs: attribute.FromMap(map[string]model.AttributeSlotDef{"aaa": {Current: 99}, "extra": {Current: 4}})}
	if out, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, nil); err != nil || out.At("speed").Resolved != 104 {
		t.Fatal(out, err)
	}
	memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", false, false, [2]string{}, resolver, attrs)
	if memo.reads[0].attributeIndexBound || !memo.Probe(attrs, &ctx, nil) {
		t.Fatal("runtime extra key did not retain the safe key path")
	}
	ctx.TargetAttrs = attribute.FromMap(map[string]model.AttributeSlotDef{"extra": {Current: 6}, "zzz": {Current: 1000}})
	if out, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, nil); err != nil || out.At("speed").Resolved != 106 {
		t.Fatal("extra-key directory change read another slot", out, err)
	}
}

func TestAttributeProbeNamedTargetActorDirectionAndPresence(t *testing.T) {
	var registry formula.Library
	definition := formuladefinition.FromExpr("target_values", "probe_skill", model.GenericFormulaExpr{Op: "add", Args: []model.GenericFormulaExpr{{Op: "read", Path: "source.attr.dep.base"}, {Op: "read", Path: "target.attr.dep.current"}}}, nil)
	fixtureCompileDeclaredNamed([]model.NamedFormula{definition}, []string{"dep", "speed"}, &registry, func(code model.GenericErrCode, path, message, ref string) { t.Fatal(code, path, message) })
	layout := attribute.NewLayout([]string{"dep", "speed"})
	fixtureBindLayout(&registry, layout)
	state := attributeFixture{formulas: registry, compiled: planbundle.CompiledSession{AttributeDerivations: []planbundle.CompiledAttributeDerivation{{CombatantKey: "target", AttributeKey: "speed", ValuePolicy: "set", ValueType: "DECIMAL"}}}}
	var resolver effectpkg.AttributeResolver
	source := attribute.FromMap(map[string]model.AttributeSlotDef{"dep": {Base: 2, Current: 3, Max: 10, Resolved: 2}}, layout)
	target := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100), "dep": {Base: 40, Current: 7, Max: 100, Resolved: 40}}, layout)
	if out, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "target", target, resolver, source, target, nil); err != nil || out.At("speed").Resolved != 43 {
		t.Fatal("target actor reads changed direction", out, err)
	}
	memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "target", true, false, [2]string{}, resolver, target)
	ctx := formula.GenericEvalContext{StrictReads: true, SourceAttrs: source, TargetAttrs: target}
	if !memo.Probe(target, &ctx, nil) {
		t.Fatal("target actor bound dependency did not hit")
	}
	var partial model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"current":7,"max":100,"resolved":40}`), &partial); err != nil {
		t.Fatal(err)
	}
	partial.Base = 40 // 数值不变，仅原作者字段存在性缺失。
	target = target.With("dep", partial)
	_, err := state.cache.ResolveDerived(state.compiled.AttributeDerivations, state.formulas, "target", target, resolver, source, target, nil)
	var authored *formula.AuthoredEvaluationError
	if !errors.As(err, &authored) || authored.Issue.Code != "FORMULA_MISSING_INPUT" {
		t.Fatal("bound presence checks hid the missing author field", err)
	}
}

func TestAttributeProbeProviderPresenceDefaultsAndNegativeZero(t *testing.T) {
	state, resolver := memoTestResolver(formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderState, ReadKey: "count"})
	attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)})
	values, defaults := map[string]float64{"count": 0}, map[string]float64{}
	present := true
	provider := func(string, string) pipeline.ProviderFormulaContext {
		return pipeline.ProviderFormulaContext{HasProviderContext: present, ProviderState: model.BorrowNumericView(values), ProviderStateDefaults: model.BorrowNumericView(defaults)}
	}
	ctx := formula.GenericEvalContext{StrictReads: true}
	if _, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider); err != nil {
		t.Fatal(err)
	}
	memo := state.cache.Memo(state.compiled.AttributeDerivations, state.formulas, "source", false, false, [2]string{}, resolver, attrs)
	if !memo.Probe(attrs, &ctx, provider) || memo.reads[0].providerIndex != 0 {
		t.Fatal("provider index zero was mistaken for an absent association")
	}
	delete(values, "count")
	if memo.Probe(attrs, &ctx, provider) {
		t.Fatal("an absent zero-valued provider field reused the cache")
	}
	_, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider)
	_, directErr := resolver.ResolveAttributesWithProviderContext(attrs, ctx, state.formulas, provider)
	if err == nil || directErr == nil || err.Error() != directErr.Error() {
		t.Fatal("strict missing provider field changed", err, directErr)
	}
	defaults["count"] = math.Copysign(0, -1)
	if _, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider); err != nil {
		t.Fatal(err)
	}
	if !memo.Probe(attrs, &ctx, provider) || memo.stamps[0].presence != 5 || memo.stamps[0].fallback != math.Float64bits(defaults["count"]) {
		t.Fatal("provider default presence or negative-zero bits changed")
	}
	values["count"] = math.Copysign(0, -1)
	delete(defaults, "count")
	if memo.Probe(attrs, &ctx, provider) || memo.scratch[0].presence != 3 || memo.scratch[0].value != math.Float64bits(values["count"]) {
		t.Fatal("provider value presence was aliased with its equal default")
	}
	if _, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider); err != nil {
		t.Fatal(err)
	}
	present = false
	if memo.Probe(attrs, &ctx, provider) {
		t.Fatal("provider context presence was not checked")
	}
	_, err = state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider)
	_, directErr = resolver.ResolveAttributesWithProviderContext(attrs, ctx, state.formulas, provider)
	if err == nil || directErr == nil || err.Error() != directErr.Error() {
		t.Fatal("missing provider context error changed", err, directErr)
	}
	present, ctx.StrictReads = true, false
	delete(values, "count")
	if out, err := state.cache.ResolveOrdinary(nil, state.formulas, "source", attrs, resolver, ctx, provider); err != nil || out.At("speed").Resolved != 100 {
		t.Fatal("legacy missing provider field no longer reads zero", out, err)
	}
}
