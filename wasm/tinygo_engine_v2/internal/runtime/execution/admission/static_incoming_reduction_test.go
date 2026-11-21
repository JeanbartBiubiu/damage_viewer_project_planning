package admission

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func staticIncomingInitializer(t *testing.T, value float64, typed bool) (Input, *initialSourceFixture) {
	t.Helper()
	input, listener, reads := initialSourceListener(t, model.EventTypeSourceInitialized)
	input.Formulas = fixtureFormulaLibraryPtr([]formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: value}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadDamageType, ReadKey: "magic"}}},
	})
	listener.OperationCount = 1
	modifier := planbundle.CompiledModifier{ModifierKey: "reduction", Kind: "pipeline", Command: "damage",
		Stage: "incoming_post_mitigation", Channel: "all_damage", Bucket: "all_instances", ValuePolicy: "multiply",
		HasValue: true, ValueProgram: 0, HasCondition: typed, ConditionProg: 1}
	input.Compiled.Providers = []planbundle.CompiledProvider{
		{ProviderKey: "parent", StableID: "passive", Kind: "character", SkillKey: "sample_passive", Listeners: []planbundle.CompiledListener{listener}},
		{ProviderKey: "effect", StableID: "passive", Kind: "status", SkillKey: "sample_passive", Modifiers: []planbundle.CompiledModifier{modifier}},
	}
	input.Compiled.Listeners = []planbundle.CompiledListener{listener}
	input.Compiled.Operations = []planbundle.CompiledOperation{{Operation: "apply_provider", Target: "self",
		OwnerProviderIndex: 0, ProviderRef: "permanent_reduction", ProviderDefinitionRef: "effect", Path: "operations.initialize"}}
	input.Compiled.Combatants = []planbundle.CompiledCombatant{{Key: "source",
		ProviderMounts: []planbundle.CompiledProviderMount{{DefinitionIndex: 0, ProviderRef: "selected"}}}}
	return input, reads
}

func admitStaticIncoming(input Input, reads *initialSourceFixture) *model.EngineError {
	input.Compiled.Formulas = *input.Formulas
	compile.BuildStaticAdmissionFacts(input.Compiled)
	return ValidateStaticInitializer(input, input.Compiled.Providers[0], "source", "selected", reads)
}

func TestStaticIncomingReductionInitializesConstantsAndTypePredicate(t *testing.T) {
	for _, value := range []float64{0, 0.9, 1} {
		for _, typed := range []bool{false, true} {
			input, reads := staticIncomingInitializer(t, value, typed)
			if issue := admitStaticIncoming(input, reads); issue != nil {
				t.Fatalf("value=%v typed=%v rejected: %+v", value, typed, issue)
			}
		}
	}
}

func TestStaticIncomingReductionRejectsUnavailableValuesAndOtherShapes(t *testing.T) {
	for _, value := range []float64{-0.1, 1.1, math.NaN(), math.Inf(1)} {
		input, reads := staticIncomingInitializer(t, value, true)
		if issue := admitStaticIncoming(input, reads); issue == nil || issue.Path != "operations.initialize" {
			t.Fatalf("out-of-range/non-finite value %v admitted or misplaced: %+v", value, issue)
		}
	}
	for _, test := range []struct {
		name   string
		change func(*planbundle.CompiledModifier)
	}{
		{"missing_value", func(m *planbundle.CompiledModifier) { m.HasValue = false }},
		{"invalid_value_program", func(m *planbundle.CompiledModifier) { m.ValueProgram = 9 }},
		{"dynamic_read_mode", func(m *planbundle.CompiledModifier) { m.ValueReadMode = "MOMENT_EVALUATION" }},
		{"extra_cap", func(m *planbundle.CompiledModifier) { m.HasMaximumReductionRatio = true }},
		{"grouped_reduction", func(m *planbundle.CompiledModifier) { m.HasMultiplierGroup = true }},
		{"outgoing", func(m *planbundle.CompiledModifier) { m.Stage = "outgoing_pre_mitigation" }},
		{"other_channel", func(m *planbundle.CompiledModifier) { m.Channel = "normal_damage" }},
		{"other_bucket", func(m *planbundle.CompiledModifier) { m.Bucket = "first_per_cast" }},
		{"subtract", func(m *planbundle.CompiledModifier) { m.ValuePolicy = "subtract" }},
		{"add", func(m *planbundle.CompiledModifier) { m.ValuePolicy = "add" }},
		{"invalid_condition_program", func(m *planbundle.CompiledModifier) { m.ConditionProg = 9 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			input, reads := staticIncomingInitializer(t, 0.9, true)
			test.change(&input.Compiled.Providers[1].Modifiers[0])
			if issue := admitStaticIncoming(input, reads); issue == nil || issue.Path != "operations.initialize" {
				t.Fatalf("unsupported modifier admitted or misplaced: %+v", issue)
			}
		})
	}
	for _, test := range []struct {
		name    string
		program formula.GenericProgram
		amount  bool
	}{
		{"attribute_amount", formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "force.resolved"}}}, true},
		{"attribute_condition", formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "force.resolved"}}}, false},
		{"constant_condition", formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1}}}, false},
		{"empty_type", formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadDamageType}}}, false},
		{"compound_condition", formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadDamageType, ReadKey: "magic"}, {Op: formula.GenericOpConst, Value: 1}, {Op: formula.GenericOpAdd}}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			input, reads := staticIncomingInitializer(t, 0.9, true)
			test.program.Key = test.name
			id, err := fixtureRegister(input.Formulas, test.program)
			if err != nil {
				t.Fatal(err)
			}
			if test.amount {
				input.Compiled.Providers[1].Modifiers[0].ValueProgram = id
			} else {
				input.Compiled.Providers[1].Modifiers[0].ConditionProg = id
			}
			if issue := admitStaticIncoming(input, reads); issue == nil || issue.Path != "operations.initialize" {
				t.Fatalf("unsupported program admitted or misplaced: %+v", issue)
			}
		})
	}
}

func TestStaticIncomingReductionPreservesInitializationGuards(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(Input, *initialSourceFixture)
	}{
		{"parent_abilities", func(i Input, _ *initialSourceFixture) { i.Compiled.Providers[0].AbilityCount = 1 }},
		{"parent_state", func(i Input, _ *initialSourceFixture) {
			i.Compiled.Providers[0].StateFields = map[string]planbundle.CompiledProviderStateField{"fake": {}}
		}},
		{"listener_condition", func(i Input, _ *initialSourceFixture) { i.Compiled.Listeners[0].HasCondition = true }},
		{"listener_ability", func(i Input, _ *initialSourceFixture) { i.Compiled.Listeners[0].HasAbilityRef = true }},
		{"listener_limit", func(i Input, _ *initialSourceFixture) { i.Compiled.Listeners[0].HasOncePerUse = true }},
		{"listener_throttle", func(i Input, _ *initialSourceFixture) { i.Compiled.Listeners[0].PerCastThrottleMs = 1 }},
		{"unmatched_owner_event", func(_ Input, r *initialSourceFixture) { r.matched = false }},
		{"opponent_apply", func(i Input, _ *initialSourceFixture) { i.Compiled.Operations[0].Target = "target" }},
		{"conditional_apply", func(i Input, _ *initialSourceFixture) { i.Compiled.Operations[0].HasCondition = true }},
		{"amount_apply", func(i Input, _ *initialSourceFixture) { i.Compiled.Operations[0].HasAmount = true }},
		{"event_provider", func(i Input, _ *initialSourceFixture) { i.Compiled.Operations[0].ProviderRefFromEvent = true }},
		{"finite_effect", func(i Input, _ *initialSourceFixture) {
			i.Compiled.Providers[1].Lifecycle = &planbundle.CompiledProviderLifecycle{}
		}},
		{"second_modifier", func(i Input, _ *initialSourceFixture) {
			i.Compiled.Providers[1].Modifiers = append(i.Compiled.Providers[1].Modifiers, i.Compiled.Providers[1].Modifiers[0])
		}},
		{"effect_listener", func(i Input, _ *initialSourceFixture) {
			i.Compiled.Providers[1].Listeners = []planbundle.CompiledListener{{}}
		}},
		{"effect_process", func(i Input, _ *initialSourceFixture) {
			i.Compiled.Providers[1].Processes = []planbundle.CompiledProcess{{}}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			input, reads := staticIncomingInitializer(t, 0.9, true)
			test.change(input, reads)
			if issue := admitStaticIncoming(input, reads); issue == nil {
				t.Fatal("incomplete initialization closure admitted")
			}
		})
	}
}

func TestStaticIncomingReductionDoesNotOpenDynamicSourcesOrChangeGroupedAmplification(t *testing.T) {
	input, reads := staticIncomingInitializer(t, 0.9, true)
	input.Compiled.Providers[1].Lifecycle = &planbundle.CompiledProviderLifecycle{HasDuration: true, MaxStacks: 1,
		RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget}
	input.Compiled.Formulas = *input.Formulas
	compile.BuildStaticAdmissionFacts(input.Compiled)
	issue := ValidateEquipmentDynamicDefinition(input, "source", "selected", "effect", "self")
	if issue == nil || issue.Message != "equipment dynamic result is outside received-healing ratio-max scope" {
		t.Fatalf("dynamic reduction changed existing scope or failed before modifier validation: %+v", issue)
	}
	input.Compiled.Providers[1].Lifecycle = nil
	id, err := fixtureRegister(input.Formulas, formula.GenericProgram{Key: "grouped", Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1.2}}})
	if err != nil {
		t.Fatal(err)
	}
	modifier := &input.Compiled.Providers[1].Modifiers[0]
	modifier.HasMultiplierGroup, modifier.ValueProgram = true, id
	input.Compiled.Formulas = *input.Formulas
	compile.BuildStaticAdmissionFacts(input.Compiled)
	if !modifier.AdmissionFacts.GroupedDamageSource {
		t.Fatal("existing grouped amplification was changed")
	}
	if issue := admitStaticIncoming(input, reads); issue != nil {
		t.Fatalf("existing grouped amplification initializer rejected: %+v", issue)
	}
}
