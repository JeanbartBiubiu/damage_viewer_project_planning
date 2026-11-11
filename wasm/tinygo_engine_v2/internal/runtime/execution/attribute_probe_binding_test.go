package execution

import (
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
)

func TestAttributeProbeUniqueCallbacksKeepRealLazyExpiryAndHold(t *testing.T) {
	for _, hold := range []bool{false, true} {
		t.Run(map[bool]string{false: "expired", true: "inclusive_hold"}[hold], func(t *testing.T) {
			attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"speed": authoringSlot(100)})
			bagState := testProviderStates(providerStateTestSeeds{"buff": {state: map[string]float64{"count": 2}, expireAt: map[string]int64{"count": 10}, fieldDefs: map[string]effectpkg.FieldDefinition{"count": {DurationMs: 10}}, targetKey: "target", targetValues: map[string]float64{"count": 3}, targetExpireAt: map[string]int64{"count": 10}}})
			bag := bagState.Lookup("buff")
			state := Engine{loop: newTestLoopAt(0), formulas: fixtureFormulaLibrary([]formula.GenericProgram{
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderState, ReadKey: "count"}}},
				{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadProviderTargetState, ReadKey: "count"}}},
			}), combatants: map[string]combatantRuntime{
				"source": {numbers: actor.New("source", attrs, nil), providerState: bagState},
				"target": {numbers: actor.New("target", attrs, nil)},
			}}
			var resolver effectpkg.AttributeResolver
			for index := 0; index < 2; index++ {
				resolver.MountCompiledModifierOwned("source", "buff", planbundle.CompiledModifier{ModifierKey: []string{"a", "b"}[index], Kind: "attribute", Target: "speed", HasValue: true, ValueProgram: formula.GenericProgramID(index), ValuePolicy: "add"})
			}
			frame := state.newExecutionFrame("source", "target", "probe")
			frame.strictReads = true
			realCallback := frame.providerFormulaContextFunc("source")
			calls := 0
			provider := func(owner, ref string) pipeline.ProviderFormulaContext { calls++; return realCallback(owner, ref) }
			ctx := formula.GenericEvalContext{StrictReads: true}
			if out, err := state.evaluation.ResolveOrdinary(state.formulas, "source", attrs, resolver, ctx, provider); err != nil || out.At("speed").Resolved != 105 {
				t.Fatal(out, err)
			}
			memo := state.evaluation.Memo(state.compiled.AttributeDerivations, state.formulas, "source", false, false, [2]string{}, resolver, attrs)
			calls = 0
			if !memo.Probe(attrs, &ctx, provider) || calls != 1 {
				t.Fatal("warm probe skipped or repeated a real provider callback", calls)
			}
			stagedBag := frame.stageFor("source").providerState.Edit("buff", false)
			if hold {
				stagedBag.SetInclusiveAtExpiryHold("target", "count")
			}
			state.loop.Advance(10)
			calls = 0
			if memo.Probe(attrs, &ctx, provider) || calls != 1 || stagedBag.State().At("count") != 0 || stagedBag.ExpireAt().At("count") != 0 {
				t.Fatal("unique callback did not perform provider-scope expiry", calls, stagedBag)
			}
			want := 100.0
			if hold {
				want = 103
			}
			if out, err := state.evaluation.ResolveOrdinary(state.formulas, "source", attrs, resolver, ctx, provider); err != nil || out.At("speed").Resolved != want {
				t.Fatal("inclusive target-state expiry semantics changed", out, err)
			}
			calls = 0
			if !memo.Probe(attrs, &ctx, provider) || calls != 1 {
				t.Fatal("expiry callback was not idempotent", calls)
			}
			if bag.State().At("count") != 2 || bag.TargetValues().At("count") != 3 {
				t.Fatal("a read probe published its staged expiry to the live bag")
			}
		})
	}
}
