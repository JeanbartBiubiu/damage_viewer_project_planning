package operation

import (
	"reflect"
	"testing"
	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/pipeline"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	"tinygo_engine_v2/internal/runtime/execution/evaluation"
)

type attributeWorkFixture struct {
	numbers       map[string]*actor.ChangeSet
	resolvers     map[string]effectpkg.AttributeResolver
	contextFailed []bool
	failures      []*model.EngineError
	contexts      int
	providers     int
	live          map[string]LiveAttributeState
	publications  []string
	initialOrders int
	initialCalls  []string
}

func attributeSlot(value float64) model.AttributeSlotDef {
	return model.AttributeSlotDef{Base: value, Current: value, Resolved: value, Max: value}
}

func newAttributeWork() *attributeWorkFixture {
	work := &attributeWorkFixture{numbers: map[string]*actor.ChangeSet{}, resolvers: map[string]effectpkg.AttributeResolver{}, live: map[string]LiveAttributeState{}}
	for _, owner := range []string{"source", "target"} {
		attrs := attribute.FromMap(map[string]model.AttributeSlotDef{"hp": attributeSlot(100), "speed": attributeSlot(10)})
		changes := actor.Stage(actor.New(owner, attrs, nil))
		work.numbers[owner] = &changes
		work.live[owner] = LiveAttributeState{Attributes: attrs}
	}
	return work
}

func attributeRulesFixture(t *testing.T, program formula.GenericProgram) AttributeRules {
	t.Helper()
	var builder formula.Builder
	if _, err := builder.Register(program); err != nil {
		t.Fatal(err)
	}
	library := builder.Freeze()
	return AttributeRules{Plan: &planbundle.CompiledSession{}, Formulas: &library, SessionID: "numeric-test", AbilityRef: "source.skill[test]"}
}

func (w *attributeWorkFixture) AttributeNumbers(owner string) *actor.ChangeSet {
	return w.numbers[owner]
}
func (w *attributeWorkFixture) AttributeResolver(owner string) effectpkg.AttributeResolver {
	return w.resolvers[owner]
}
func (w *attributeWorkFixture) AttributePair() [2]attribute.Table {
	return [2]attribute.Table{w.numbers["source"].Attributes(), w.numbers["target"].Attributes()}
}
func (w *attributeWorkFixture) AttributeContext(ability planbundle.CompiledAbility) formula.GenericEvalContext {
	w.contexts++
	w.contextFailed = append(w.contextFailed, len(w.failures) != 0)
	return formula.GenericEvalContext{StrictReads: true, SourceAttrs: w.numbers["source"].Attributes(), TargetAttrs: w.numbers["target"].Attributes()}
}
func (w *attributeWorkFixture) AttributeProviderContext(host, owner, provider string) pipeline.ProviderFormulaContext {
	w.providers++
	return pipeline.ProviderFormulaContext{}
}
func (w *attributeWorkFixture) RecordAttributeFailure(err *model.EngineError) {
	w.failures = append(w.failures, err)
}
func (w *attributeWorkFixture) AttributeFailed() bool { return len(w.failures) != 0 }

func (w *attributeWorkFixture) LiveAttributeState(owner string) (LiveAttributeState, bool) {
	state, exists := w.live[owner]
	return state, exists
}
func (w *attributeWorkFixture) LiveAttributeContext(source, target string) formula.GenericEvalContext {
	w.contexts++
	return formula.GenericEvalContext{SourceAttrs: w.live[source].Attributes, TargetAttrs: w.live[target].Attributes}
}
func (w *attributeWorkFixture) LiveAttributeProviderContext(host, activeTarget, owner, provider string) pipeline.ProviderFormulaContext {
	return pipeline.ProviderFormulaContext{}
}
func (w *attributeWorkFixture) PublishLiveAttributes(owner string, attrs attribute.Table) {
	state := w.live[owner]
	state.Attributes = attrs
	w.live[owner] = state
	w.publications = append(w.publications, owner)
}
func (w *attributeWorkFixture) RecordLiveAttributeFailure(err *model.EngineError) {
	w.failures = append(w.failures, err)
}
func (w *attributeWorkFixture) InitialAttributeOrder() []string {
	w.initialOrders++
	if w.initialOrders == 1 {
		return []string{"target", "source"}
	}
	return []string{"source", "target"}
}
func (w *attributeWorkFixture) InitialAttributeState(owner string) (LiveAttributeState, bool) {
	return w.LiveAttributeState(owner)
}
func (w *attributeWorkFixture) InitialAttributeProviders(owner, proxy string) pipeline.ProviderFormulaContextFunc {
	w.initialCalls = append(w.initialCalls, owner+":"+proxy)
	return nil
}
func (w *attributeWorkFixture) PublishInitialAttributes(owner string, attrs attribute.Table) {
	w.PublishLiveAttributes(owner, attrs)
}

func TestAttributeRecomputeRecordsFailureBeforeContinuingOriginalTwoPasses(t *testing.T) {
	rules := attributeRulesFixture(t, formula.GenericProgram{Key: "missing", Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "missing.current"}}})
	work := newAttributeWork()
	resolver := effectpkg.AttributeResolver{}
	resolver.MountCompiledModifierOwned("target", "buff", planbundle.CompiledModifier{Kind: "attribute", Target: "speed", HasValue: true, ValueProgram: 0, ValuePolicy: "add"})
	work.resolvers["target"] = resolver
	var cache evaluation.State
	RecomputeStagedAttributes(rules, &cache, "target", "source", planbundle.CompiledAbility{}, work)
	if !reflect.DeepEqual(work.contextFailed, []bool{false, false, true, true, true}) || len(work.failures) != 2 {
		t.Fatalf("failure was deferred or stopped the original loop: contexts=%v failures=%v", work.contextFailed, work.failures)
	}
	for _, err := range work.failures {
		if err.Path != "combatants.target.attributes" || err.SessionID != "numeric-test" {
			t.Fatalf("failure lost original owner or run identity: %+v", err)
		}
	}
}

func TestAttributeWarmRecomputeStillPreparesContextAndSynchronizesHealth(t *testing.T) {
	rules := attributeRulesFixture(t, formula.GenericProgram{Key: "constant", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}}})
	work := newAttributeWork()
	var cache evaluation.State
	RecomputeStagedAttributes(rules, &cache, "source", "target", planbundle.CompiledAbility{}, work)
	beforeContexts := work.contexts
	hp := work.numbers["source"].Attributes().At("hp")
	hp.Current = 25
	work.numbers["source"].SetAttributes(work.numbers["source"].Attributes().With("hp", hp))
	RecomputeStagedAttributes(rules, &cache, "source", "target", planbundle.CompiledAbility{}, work)
	if work.contexts-beforeContexts != 1 || work.numbers["source"].Attributes().At("hp").Resolved != 25 || len(work.failures) != 0 {
		t.Fatalf("warm refresh skipped preparation, changed health or missed cache: contexts=%d hp=%+v errors=%v", work.contexts-beforeContexts, work.numbers["source"].Attributes().At("hp"), work.failures)
	}
}

func TestAttributeLiveTwoPassAndRelatedSinglePassRemainDistinct(t *testing.T) {
	rules := attributeRulesFixture(t, formula.GenericProgram{Key: "constant", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}}})
	work := newAttributeWork()
	var cache evaluation.State
	RecomputeLiveAttributes(rules, &cache, "target", "source", work)
	if !reflect.DeepEqual(work.publications, []string{"target", "source", "target", "source"}) || work.contexts != 4 {
		t.Fatal("live two-pass direction or preparation changed", work.publications, work.contexts)
	}
	work.publications = nil
	ResolveRelatedLiveAttributes(rules, &cache, "target", "source", formula.GenericEvalContext{}, work)
	if !reflect.DeepEqual(work.publications, []string{"target", "source"}) || work.contexts != 4 {
		t.Fatal("related refresh rebuilt context or changed pass count", work.publications, work.contexts)
	}
}

func TestInitialAttributePreparationKeepsIndependentOrdersAndThreeStages(t *testing.T) {
	rules := attributeRulesFixture(t, formula.GenericProgram{Key: "constant", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}}})
	work := newAttributeWork()
	if err := PrepareInitialAttributes(rules, work); err != nil {
		t.Fatal(err)
	}
	if work.initialOrders != 2 || !reflect.DeepEqual(work.initialCalls, []string{"target:", "source:", "source:target", "target:target"}) || !reflect.DeepEqual(work.publications, []string{"target", "source", "source", "target", "source", "target"}) {
		t.Fatalf("initial stages were collapsed or traversal order reused: orders=%d calls=%v publish=%v", work.initialOrders, work.initialCalls, work.publications)
	}
}
