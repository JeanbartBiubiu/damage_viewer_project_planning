package admission

import (
	"encoding/json"
	"testing"

	"tinygo_engine_v2/internal/compile"

	"tinygo_engine_v2/internal/base/attribute"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func initialSelectionInput() (Input, []model.CombatantSnapshot) {
	compiled := &planbundle.CompiledSession{}
	registry := &formula.Library{}
	input := Input{Compiled: compiled, Formulas: registry, Identity: Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}}
	var initial []model.CombatantSnapshot
	for index, key := range [2]string{model.SelectorSource, model.SelectorTarget} {
		raw := model.AttributeSlotDef{Base: 100, Current: 50, Max: 100, Resolved: 100}
		attributes := map[string]model.AttributeSlotDef{"hp": raw}
		compiled.Combatants = append(compiled.Combatants, planbundle.CompiledCombatant{Key: key, Attributes: attributes})
		initial = append(initial, model.CombatantSnapshot{Key: key, Attributes: attributes})
		resolved := raw
		resolved.Max, resolved.Resolved = 150, 150
		input.Actors[index] = Actor{Key: key, Attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"hp": resolved}), Present: true}
	}
	return input, initial
}

func TestInitialSelectionKeepsRawAndMaterializedHealthSeparate(t *testing.T) {
	input, initial := initialSelectionInput()
	if issue := ValidateInitialSelection(input, initial, true); issue != nil {
		t.Fatalf("half-health raw selection with a larger actual equipped maximum must pass: %+v", issue)
	}
	bad := input.Actors[0].Attributes.At("hp")
	bad.Current = bad.Max + 1
	input.Actors[0].Attributes = input.Actors[0].Attributes.With("hp", bad)
	issue := ValidateInitialSelection(input, initial, true)
	if issue == nil || issue.Path != "initialSnapshot.combatants.attributes.hp" || issue.SchemaHash != "schema" || issue.RulesHash != "rules" || issue.SessionID != "session" || issue.Ref != "" {
		t.Fatalf("actual health failure must keep its original location and identity: %+v", issue)
	}
	if issue := ValidateInitialSelection(input, initial, false); issue != nil {
		t.Fatalf("the caller's original maximum-check choice must remain effective: %+v", issue)
	}
}

func TestInitialSelectionRejectsRawMismatchBeforeActualMaximum(t *testing.T) {
	input, initial := initialSelectionInput()
	initial[0].Attributes = map[string]model.AttributeSlotDef{"hp": {Base: 200, Current: 50, Max: 100, Resolved: 100}}
	input.Actors[0].Attributes = attribute.Table{}
	issue := ValidateInitialSelection(input, initial, true)
	if issue == nil || issue.Message != "initial attribute differs from the compiled input" {
		t.Fatalf("raw selection failure must not be replaced by a later resolved-health failure: %+v", issue)
	}
}

func dynamicRecoveryInput(program formula.GenericProgram) (Input, planbundle.CompiledListener, planbundle.CompiledOperation) {
	compiled := &planbundle.CompiledSession{
		Providers: []planbundle.CompiledProvider{{ProviderKey: "passive", AbilityCount: 1}},
		Abilities: []planbundle.CompiledAbility{{Kind: "passive_listener", ProviderIndex: 0, Params: map[string]float64{"flat": 10}}},
	}
	registry := fixtureFormulaLibraryPtr([]formula.GenericProgram{program})
	input := Input{Compiled: compiled, Formulas: registry}
	input.Actors[0] = Actor{Key: "source", Present: true, Attributes: attribute.FromMap(map[string]model.AttributeSlotDef{"force": {Base: 20, Current: 20, Max: 20, Resolved: 20}})}
	return input, planbundle.CompiledListener{OwnerCombatantKey: "source", SourceAbilityIndex: 0}, planbundle.CompiledOperation{OwnerProviderIndex: 0, AmountProgram: 0}
}

func TestDynamicRecoveryChecksCurrentOwnerWithoutFreezingAmount(t *testing.T) {
	input, listener, operation := dynamicRecoveryInput(formula.GenericProgram{Instr: []formula.GenericInstr{
		{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "force.resolved"},
		{Op: formula.GenericOpRead, ReadKind: formula.ReadAbilityParam, ReadKey: "flat"},
		{Op: formula.GenericOpAdd},
	}})
	for _, test := range []struct{ current, want float64 }{{20, 30}, {50, 60}} {
		input.Actors[0].Attributes = input.Actors[0].Attributes.With("force", model.AttributeSlotDef{Base: test.current, Current: test.current, Max: test.current, Resolved: test.current})
		got, valid := EvaluateOwnedDynamicHealAmount(input, listener, operation)
		if !valid || got != test.want {
			t.Fatalf("current input %.0f: got %.0f, valid=%v, want %.0f", test.current, got, valid, test.want)
		}
	}
}

func TestDynamicRecoveryRejectsUnavailableReadInUnselectedBranch(t *testing.T) {
	input, listener, operation := dynamicRecoveryInput(formula.GenericProgram{Instr: []formula.GenericInstr{
		{Op: formula.GenericOpConst, Value: 1},
		{Op: formula.GenericOpJumpIfZero, JumpTarget: 4},
		{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "force.resolved"},
		{Op: formula.GenericOpJump, JumpTarget: 5},
		{Op: formula.GenericOpRead, ReadKind: formula.ReadTargetAttr, ReadKey: "force.resolved"},
	}})
	if _, valid := EvaluateOwnedDynamicHealAmount(input, listener, operation); valid {
		t.Fatal("an unselected branch cannot gain access to the opponent through owner-only recovery admission")
	}
}

func TestDynamicRecoveryPreservesAttributeFieldPresence(t *testing.T) {
	input, listener, operation := dynamicRecoveryInput(formula.GenericProgram{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "force.resolved"}}})
	var partial model.AttributeSlotDef
	if err := json.Unmarshal([]byte(`{"base":20}`), &partial); err != nil {
		t.Fatal(err)
	}
	input.Actors[0].Attributes = attribute.FromMap(map[string]model.AttributeSlotDef{"force": partial})
	if _, valid := EvaluateOwnedDynamicHealAmount(input, listener, operation); valid {
		t.Fatal("a missing resolved field cannot become a valid zero after crossing the package boundary")
	}
}

func TestEquipmentPeriodicKeepsProviderAndTargetScopesDistinct(t *testing.T) {
	compiled := &planbundle.CompiledSession{
		Abilities:  []planbundle.CompiledAbility{{Kind: "tick", TickSpec: &planbundle.CompiledTickSpec{IntervalMs: 250, StartDelayMs: 250, OnTickCount: 1}}},
		Operations: []planbundle.CompiledOperation{{Operation: "state_change", StateScope: "state_scope/provider", Target: "self", HasAmount: true, Path: "periodic.state"}},
	}
	input := Input{Compiled: compiled}
	provider := planbundle.CompiledProvider{Kind: "item", StableID: "selected", AbilityCount: 1}
	if issue := ValidateEquipmentPeriodicDefinition(input, provider, "source"); issue != nil {
		t.Fatalf("owned provider state in the configured periodic source must pass: %+v", issue)
	}
	compiled.Operations[0].StateScope = "state_scope/provider_target"
	if issue := ValidateEquipmentPeriodicDefinition(input, provider, "source"); issue == nil || issue.Path != "periodic.state" {
		t.Fatalf("the same periodic source must reject target-scoped state: %+v", issue)
	}
}

func linkedShieldInput() (Input, planbundle.CompiledListener, InitialProvider) {
	listener := planbundle.CompiledListener{ListenerKey: "initialize", OwnerCombatantKey: "source", OwnerProviderRef: "mounted", SourceAbilityIndex: -1, OperationCount: 1}
	compiled := &planbundle.CompiledSession{
		Combatants: []planbundle.CompiledCombatant{{Key: "source", ProviderMounts: []planbundle.CompiledProviderMount{{ProviderRef: "mounted"}}}},
		Providers: []planbundle.CompiledProvider{
			{ProviderKey: "parent", Kind: "character", StableID: "selected", SkillKey: "skill", Listeners: []planbundle.CompiledListener{listener}},
			{ProviderKey: "shield_effect", Kind: "status", SkillKey: "skill", ShieldDefinitionRef: "shield"},
		},
		Operations: []planbundle.CompiledOperation{{Operation: "shield", OwnerProviderIndex: 0, Target: "self", HasAmount: true, HasShieldLifecycleProvider: true, ShieldLifecycleProviderIndex: 1, ShieldRef: "shield"}},
	}
	registry := fixtureFormulaLibraryPtr([]formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 100}}}})
	return Input{Compiled: compiled, Formulas: registry}, listener, InitialProvider{Present: true, DefinitionRef: "parent", Source: "source", Owner: "source", Stacks: 1}
}

func TestLinkedShieldRequiresTheActualFreshParentMount(t *testing.T) {
	input, listener, instance := linkedShieldInput()
	if !pureOwnedLinkedShieldInitialization(input, listener, instance) {
		t.Fatal("the unique fresh parent and its complete shield must pass")
	}
	for _, test := range []struct {
		name   string
		change func(*InitialProvider)
	}{
		{"missing", func(value *InitialProvider) { value.Present = false }},
		{"foreign_source", func(value *InitialProvider) { value.Source = "target" }},
		{"foreign_owner", func(value *InitialProvider) { value.Owner = "target" }},
		{"other_definition", func(value *InitialProvider) { value.DefinitionRef = "other" }},
		{"restored_state", func(value *InitialProvider) { value.StateCount = 1 }},
		{"finite_instance", func(value *InitialProvider) { value.ExpireAt = 1000 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			actual := instance
			test.change(&actual)
			if pureOwnedLinkedShieldInitialization(input, listener, actual) {
				t.Fatal("the compiled parent alone cannot authorize a missing, foreign or restored actual mount")
			}
		})
	}
	input.Compiled.Combatants[0].ProviderMounts = append(input.Compiled.Combatants[0].ProviderMounts, planbundle.CompiledProviderMount{ProviderRef: "duplicate"})
	if pureOwnedLinkedShieldInitialization(input, listener, instance) {
		t.Fatal("a second parent mount must invalidate the unique creator proof")
	}
}

func dynamicFinalAttributeInput() Input {
	input, _ := initialSelectionInput()
	input.Formulas = fixtureFormulaLibraryPtr([]formula.GenericProgram{
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 3.33}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpRead, ReadKind: formula.ReadSourceAttr, ReadKey: "attack_damage.resolved"}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 1e308}, {Op: formula.GenericOpConst, Value: 1e308}, {Op: formula.GenericOpMul}}},
		{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 0}}},
	})
	for index := range input.Actors {
		input.Actors[index].Attributes = input.Actors[index].Attributes.With("attack_speed", model.AttributeSlotDef{Base: 4, Current: 4, Max: 4, Resolved: 4})
		input.Actors[index].Attributes = input.Actors[index].Attributes.With("attack_damage", model.AttributeSlotDef{Base: 60, Current: 60, Max: 60, Resolved: 60})
	}
	input.Compiled.Combatants[0].ProviderMounts = []planbundle.CompiledProviderMount{{ProviderRef: "natural", DefinitionIndex: 0}}
	input.Compiled.Providers = []planbundle.CompiledProvider{
		{ProviderKey: "parent", Kind: "character", StableID: "actual-source"},
		{ProviderKey: "timed", Kind: "status", StableID: "actual-source", Lifecycle: &planbundle.CompiledProviderLifecycle{
			HasDuration: true, MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
			Modifiers: []planbundle.CompiledModifier{
				{Kind: "attribute", Target: "self.attr.attack_speed", ValuePolicy: "add", HasValue: true},
				{Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", HasValue: true, ValueProgram: 1},
				{Kind: "attribute", Target: "self.attr.attack_speed", Stage: "final", ValuePolicy: "min", HasValue: true},
			}},
	}
	return input
}

func TestDynamicFinalAttributeAdmissionKeepsFiniteSelfScope(t *testing.T) {
	for _, program := range []formula.GenericProgramID{0, 3} {
		input := dynamicFinalAttributeInput()
		input.Compiled.Providers[1].Modifiers[2].ValueProgram = program
		input.Compiled.Formulas = *input.Formulas
		compile.BuildStaticAdmissionFacts(input.Compiled)
		if issue := ValidateEquipmentDynamicDefinition(input, "source", "natural", "timed", "self"); issue != nil {
			t.Fatalf("static final limit in a complete finite self attribute group must pass, program=%d: %+v", program, issue)
		}
		if OwnedAttributePolicy(input.Compiled.Providers[1].Modifiers[2]) {
			t.Fatal("finite final admission must not authorize the same operation for permanent owned sources")
		}
	}
	for _, test := range []struct {
		name   string
		change func(*Input)
		target string
	}{
		{"ordinary_min", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].Stage = "" }, "self"},
		{"final_max", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].ValuePolicy = "max" }, "self"},
		{"final_multiply", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].ValuePolicy = "multiply" }, "self"},
		{"dynamic_limit", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].ValueProgram = 1 }, "self"},
		{"overflow_limit", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].ValueProgram = 2 }, "self"},
		{"missing_value", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].HasValue = false }, "self"},
		{"condition", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].HasCondition = true }, "self"},
		{"group", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].HasMultiplierGroup = true }, "self"},
		{"bucket", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].Bucket = "flat" }, "self"},
		{"value_read_mode", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].ValueReadMode = "APPLICATION_SNAPSHOT" }, "self"},
		{"health", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].Target = "self.attr.hp" }, "self"},
		{"resource_max", func(input *Input) { input.Compiled.Providers[1].Modifiers[2].Kind = "resource_max" }, "self"},
		{"opponent", func(input *Input) {}, "target"},
		{"foreign_mount", func(input *Input) { input.Compiled.Providers[1].StableID = "foreign" }, "self"},
		{"permanent", func(input *Input) { input.Compiled.Providers[1].Lifecycle.HasDuration = false }, "self"},
		{"periodic", func(input *Input) { input.Compiled.Providers[1].Lifecycle.TickIntervalMs = 100 }, "self"},
		{"missing_slot", func(input *Input) {
			input.Actors[0].Attributes = attribute.FromMap(map[string]model.AttributeSlotDef{})
		}, "self"},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := dynamicFinalAttributeInput()
			test.change(&input)
			input.Compiled.Formulas = *input.Formulas
			compile.BuildStaticAdmissionFacts(input.Compiled)
			if issue := ValidateEquipmentDynamicDefinition(input, "source", "natural", "timed", test.target); issue == nil {
				t.Fatal("invalid or out-of-scope final limit must remain rejected")
			}
		})
	}
}
