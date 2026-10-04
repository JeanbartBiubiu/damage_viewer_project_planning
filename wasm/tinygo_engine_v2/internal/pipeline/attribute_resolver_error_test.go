package pipeline

import (
	"testing"

	compilebundle "tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
)

func TestAttributeResolverRejectsMissingReadsInsteadOfDroppingModifier(t *testing.T) {
	registry := formula.GenericRegistry{Programs: []formula.GenericProgram{{Key: "missing", Instr: []formula.GenericInstr{
		{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "missing.resolved"},
	}}}}
	var resolver AttributeResolver
	resolver.MountCompiledModifierOwned("source", "gear", compilebundle.CompiledModifier{
		ModifierKey: "bad", Kind: "attribute", Target: "armor", ValuePolicy: "add", ValueProgram: 0, HasValue: true,
	})
	attrs := map[string]model.AttributeSlotDef{"armor": {Base: 10, Current: 10, Resolved: 10}}
	resolved, err := resolver.ResolveAttributes(attrs, formula.GenericEvalContext{SourceAttrs: attrs, StrictReads: true}, registry)
	if err == nil || resolved != nil || attrs["armor"].Resolved != 10 {
		t.Fatalf("modifier must fail atomically: resolved=%v err=%v attrs=%v", resolved, err, attrs)
	}
}
