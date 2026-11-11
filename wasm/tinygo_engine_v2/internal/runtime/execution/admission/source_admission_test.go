package admission

import (
	"math"
	"reflect"
	"testing"

	"tinygo_engine_v2/internal/base/typeset"
	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
)

func sourceListenerInput(t *testing.T, event string, operations ...planbundle.CompiledOperation) (Input, planbundle.CompiledListener, ListenerSources) {
	t.Helper()
	addError := func(code model.GenericErrCode, path, message, ref string) {
		t.Fatalf("catalog: %s %s %s %s", code, path, message, ref)
	}
	catalog := typeset.CompileTypeCatalog(model.TypeCatalog{Types: []model.TypeCatalogEntry{
		{Key: model.EventTypeBasicAttackHit, Domain: "event"},
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
	}}, addError)
	hit, _ := catalog.Registry.Lookup(model.EventTypeBasicAttackHit)
	damage, _ := catalog.Registry.Lookup("event/damage_instance")
	owner, _ := catalog.Registry.Lookup("event/source_owner")
	compiled := &planbundle.CompiledSession{
		RuntimeTypes: planbundle.RuntimeTypeBindings{
			BasicAttackHit: planbundle.DeclaredType{ID: hit, Declared: true},
			DamageInstance: planbundle.DeclaredType{ID: damage, Declared: true},
			SourceOwner:    planbundle.DeclaredType{ID: owner, Declared: true},
		},
		Combatants: []planbundle.CompiledCombatant{{Key: model.SelectorSource, ProviderMounts: []planbundle.CompiledProviderMount{{ProviderRef: "selected", DefinitionIndex: 0}}}},
		Providers:  []planbundle.CompiledProvider{{ProviderKey: "parent"}},
		Operations: operations,
	}
	input := Input{Compiled: compiled, Formulas: &formula.Library{}, Identity: Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}}
	listener := planbundle.CompiledListener{ListenerKey: "listener", OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "selected", SourceAbilityIndex: 0,
		OperationCount: uint16(len(operations)), MaxTriggersPerEvent: 1,
		EventMatcher: typeset.CompileGenericMatcher(model.TypeMatcher{All: []string{event, "event/source_owner"}}, catalog, typeset.EntityListener, "matcher", addError)}
	return input, listener, ListenerSources{}
}

func requireSourceAdmissionError(t *testing.T, got *model.EngineError, message, path string) {
	t.Helper()
	want := &model.EngineError{Phase: model.GenericPhaseRun, Code: model.GenericErrRuntimeInvariantFailed, Message: message, Path: path,
		Severity: model.GenericSeverityError, SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("complete admission error changed:\n got %+v\nwant %+v", got, want)
	}
}

func TestListenerAdmissionPreservesHeaderAndOperationFirstErrors(t *testing.T) {
	input, listener, sources := sourceListenerInput(t, model.EventTypeBasicAttackHit,
		planbundle.CompiledOperation{Operation: "state_change", StateScope: "state_scope/provider", Target: "self", HasAmount: true, Ref: "missing", Path: "operations.first"},
		planbundle.CompiledOperation{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "missing_result", Path: "operations.second"})
	const stateError = "source state operation requires its complete declared field"
	requireSourceAdmissionError(t, ValidateEquipmentHitListener(input, listener, sources), stateError, "operations.first")
	listener.HasAbilityRef = true
	requireSourceAdmissionError(t, ValidateEquipmentHitListener(input, listener, sources), "source requires a complete owner-start/hit/link or receiver-only engine event listener", "listeners.listener")
	listener.HasAbilityRef = false
	sources.StateFields = map[string]planbundle.CompiledProviderStateField{"missing": {DefaultValue: 0}}
	requireSourceAdmissionError(t, ValidateEquipmentHitListener(input, listener, sources), "equipment result has no complete provider definition", "missing_result")
	listener.OperationCount = 1
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue != nil {
		t.Fatalf("declared zero field must remain distinct from a missing field: %+v", issue)
	}
}

func TestListenerDurationAdmissionRequiresActualSelectionAndAttackOwner(t *testing.T) {
	input, listener, sources := sourceListenerInput(t, model.EventTypeBasicAttackHit,
		planbundle.CompiledOperation{Operation: "provider_duration_change", Target: "self", ValuePolicy: "ensure_remaining", OwnerProviderIndex: 0, Path: "operations.duration"})
	input.Compiled.HasProviderDurationChange = true
	binding := planbundle.CompiledSkillActionBinding{SkillActionBinding: model.SkillActionBinding{Source: model.SelectorSource, ProviderRef: "selected"}}
	input.Compiled.SkillActionBindings = []planbundle.CompiledSkillActionBinding{binding}
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue == nil {
		t.Fatal("a compiled but unselected parent cannot authorize duration extension")
	}
	sources.Selection.SkillBindings = []planbundle.CompiledSkillActionBinding{binding}
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue != nil {
		t.Fatalf("the actual selected parent with no selected attack must retain its admission: %+v", issue)
	}
	sources.Selection.BasicAttack = &model.BasicAttackPlan{Source: model.SelectorTarget}
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue == nil {
		t.Fatal("an actual attack selected for the wrong owner cannot be treated as no attack")
	}
	sources.Selection.BasicAttack.Source = model.SelectorSource
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue != nil {
		t.Fatalf("the selected owner's attack must pass: %+v", issue)
	}
}

func TestListenerAttackCooldownAdmissionKeepsStaticZeroAndActualBinding(t *testing.T) {
	input, listener, sources := sourceListenerInput(t, model.EventTypeBasicAttackHit,
		planbundle.CompiledOperation{Operation: "cooldown_change", Target: "self", ValuePolicy: "reduce", HasAmount: true, HasAbilityRef: true, AbilityRefStr: "self.provider[selected].ability[initial]", OwnerProviderIndex: 0, Path: "operations.cooldown"})
	*input.Formulas = fixtureFormulaLibrary([]formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: 0}}}})
	input.Compiled.Abilities = []planbundle.CompiledAbility{{AbilityKey: "initial", Kind: "active", ProviderIndex: 0, SkillKey: "skill", ProcessControl: &planbundle.CompiledProcessControl{ProcessControlDefinition: model.ProcessControlDefinition{Action: "INITIAL"}, ProcessIndex: 0}}}
	input.Compiled.Providers[0].Processes = []planbundle.CompiledProcess{{SkillKey: "skill", Cooldown: &planbundle.CompiledProcessCooldown{}}}
	binding := planbundle.CompiledSkillActionBinding{SkillActionBinding: model.SkillActionBinding{Source: model.SelectorSource, ProviderRef: "selected", ProviderDefinitionRef: "parent", SkillKey: "skill"}, ControlAbilityIndices: map[string]uint16{"INITIAL": 0}}
	input.Compiled.SkillActionBindings = []planbundle.CompiledSkillActionBinding{binding}
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue == nil {
		t.Fatal("all compiled bindings cannot replace the real planned binding")
	}
	sources.Selection.SkillBindings = []planbundle.CompiledSkillActionBinding{binding}
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue != nil {
		t.Fatalf("explicit static zero with its selected INITIAL binding must pass: %+v", issue)
	}
	*input.Formulas = fixtureFormulaLibrary([]formula.GenericProgram{{Instr: []formula.GenericInstr{{Op: formula.GenericOpConst, Value: -1}}}})
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue == nil {
		t.Fatal("a negative static amount must remain rejected")
	}
}

func TestListenerTotalRefundAdmissionKeepsUniqueMountAndSelectedInitial(t *testing.T) {
	input, listener, sources := sourceListenerInput(t, "event/damage_instance",
		planbundle.CompiledOperation{Operation: "cooldown_change", Target: "self", ValuePolicy: "reduce_total_ratio", OwnerProviderIndex: 0, Path: "operations.refund", TotalCooldownTarget: &planbundle.CompiledCooldownDurationTarget{CombatantKey: model.SelectorSource, ProviderRef: "selected", ProviderIndex: 0, AbilityIndex: 1}})
	input.Compiled.Abilities = []planbundle.CompiledAbility{{Kind: "passive_listener", ProviderIndex: 0}, {Kind: "active", ProviderIndex: 0}}
	binding := planbundle.CompiledSkillActionBinding{SkillActionBinding: model.SkillActionBinding{Source: model.SelectorSource, ProviderRef: "selected", ProviderDefinitionRef: "parent"}, InitialAbilityIndex: 1}
	input.Compiled.SkillActionBindings = []planbundle.CompiledSkillActionBinding{binding}
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue == nil {
		t.Fatal("the total cooldown target must belong to a real selected INITIAL source")
	}
	sources.Selection.SkillBindings = []planbundle.CompiledSkillActionBinding{binding}
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue != nil {
		t.Fatalf("the unique actual mount and selected INITIAL must pass: %+v", issue)
	}
	input.Compiled.Combatants[0].ProviderMounts = append(input.Compiled.Combatants[0].ProviderMounts, input.Compiled.Combatants[0].ProviderMounts[0])
	if issue := ValidateEquipmentHitListener(input, listener, sources); issue == nil {
		t.Fatal("a duplicated mount cannot retain unique total-refund ownership")
	}
}

func targetMarkAdmissionInput() (Input, TargetMarkSources) {
	mark := &planbundle.CompiledTargetMark{OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "parent", StateKey: "mark", TriggerKind: model.EventTypeSkillHit, TriggerAbilityRef: "source.provider[trigger].ability[hit]", Restore: &planbundle.CompiledOperation{ResourceKey: "mana"}}
	input := Input{Compiled: &planbundle.CompiledSession{HasTargetMarkConsumption: true, Operations: []planbundle.CompiledOperation{{TargetMark: mark, Path: "operations.mark"}}}, Identity: Identity{SchemaHash: "schema", RulesHash: "rules", SessionID: "session"}}
	input.Actors[0] = Actor{Key: model.SelectorSource, Present: true, Resources: model.BorrowResources(map[string]model.ResourceSlotDef{"mana": {Current: 0, Max: 100}})}
	sources := TargetMarkSources{Selection: SourceSelection{SkillBindings: []planbundle.CompiledSkillActionBinding{
		{SkillActionBinding: model.SkillActionBinding{Source: model.SelectorSource, ProviderRef: "parent"}},
		{SkillActionBinding: model.SkillActionBinding{Source: model.SelectorSource, ProviderRef: "trigger"}},
	}}, Initial: []TargetMarkInitialState{{OperationIndex: 0}}}
	input.Compiled.SkillActionBindings = append([]planbundle.CompiledSkillActionBinding(nil), sources.Selection.SkillBindings...)
	return input, sources
}

func TestTargetMarkAdmissionKeepsAbsentAndZeroStateAndResources(t *testing.T) {
	for _, present := range []bool{false, true} {
		input, sources := targetMarkAdmissionInput()
		sources.Initial[0].BagPresent = present
		if issue := ValidateTargetMarkSources(input, sources); issue != nil {
			t.Fatalf("absent or explicit zero bag with explicit zero current resource must pass: present=%v issue=%+v", present, issue)
		}
	}
	for _, slot := range []model.ResourceSlotDef{{Current: 0, Max: 0}, {Current: -1, Max: 100}, {Current: 101, Max: 100}, {Current: math.NaN(), Max: 100}, {Current: 0, Max: math.Inf(1)}} {
		input, sources := targetMarkAdmissionInput()
		input.Actors[0].Resources = model.BorrowResources(map[string]model.ResourceSlotDef{"mana": slot})
		requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark restore requires an explicit finite current and positive resource capacity", "operations.mark")
	}
	input, sources := targetMarkAdmissionInput()
	input.Actors[0].Resources = model.ResourceView{}
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark restore requires an explicit finite current and positive resource capacity", "operations.mark")
}

func TestTargetMarkAdmissionPreservesCompleteFirstError(t *testing.T) {
	input, sources := targetMarkAdmissionInput()
	sources.StartMs = 1
	sources.Selection.SkillBindings = nil
	input.Actors[0].Present = false
	sources.Initial[0] = TargetMarkInitialState{OperationIndex: 0, BagPresent: true, Value: 1, ExpireAt: 1000}
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark requires a fresh zero-time scene and its actual planned parent", "operations.mark")
	sources.StartMs = 0
	sources.Selection.SkillBindings = input.Compiled.SkillActionBindings[:1]
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark skill trigger is not driven by its real INITIAL source", "operations.mark")
	sources.Selection.SkillBindings = input.Compiled.SkillActionBindings
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark owner is missing", "operations.mark")
	input.Actors[0].Present = true
	input.Actors[0].Resources = model.ResourceView{}
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark cannot restore an external active target field", "operations.mark")
	input.Compiled.Operations = append(input.Compiled.Operations, planbundle.CompiledOperation{TargetMark: &planbundle.CompiledTargetMark{OwnerCombatantKey: model.SelectorTarget}, Path: "operations.later"})
	sources.Initial = append(sources.Initial, TargetMarkInitialState{OperationIndex: 1})
	sources.Initial[0].Value, sources.Initial[0].ExpireAt = 0, 0
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark restore requires an explicit finite current and positive resource capacity", "operations.mark")
}

func TestTargetMarkAdmissionRequiresTheActualSelectedAttack(t *testing.T) {
	input, sources := targetMarkAdmissionInput()
	mark := input.Compiled.Operations[0].TargetMark
	mark.TriggerKind, mark.TriggerAbilityRef = model.EventTypeBasicAttackHit, "source.provider[native].ability[hit]"
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark attack trigger is not the actual selected native hit", "operations.mark")
	sources.Selection.BasicAttack = &model.BasicAttackPlan{Source: model.SelectorSource, HitAbilityRef: "source.provider[other].ability[hit]"}
	requireSourceAdmissionError(t, ValidateTargetMarkSources(input, sources), "target mark attack trigger is not the actual selected native hit", "operations.mark")
	sources.Selection.BasicAttack.HitAbilityRef = mark.TriggerAbilityRef
	if issue := ValidateTargetMarkSources(input, sources); issue != nil {
		t.Fatalf("the actual selected native attack must pass: %+v", issue)
	}
}
