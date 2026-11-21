package compile

import (
	"strings"
	"testing"

	"tinygo_engine_v2/internal/formula"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/plan"
)

func receivedShieldCompileInput() model.CompileRequest {
	r := minimalValidCompileRequest()
	p6Types(&r)
	r.TypeCatalog.Types = append(r.TypeCatalog.Types, model.TypeCatalogEntry{Key: model.EventTypeDamageTaken, Domain: "event"}, model.TypeCatalogEntry{Key: "event/target_owner", Domain: "event"}, model.TypeCatalogEntry{Key: model.EventTypeSourceInitialized, Domain: "event"})
	p := &r.SharedProviders[0]
	p.Kind, p.SkillKey = "character", "native_guard"
	p.InitialStateSchema = map[string]interface{}{"wait": float64(0)}
	shield := model.OperationDefinition{Operation: "shield", Target: "self", ShieldRef: "native_guard/value", ShieldLifecycleProviderDefinitionRef: "native_guard/lifecycle", Amount: timedShieldExpr(100)}
	p.Listeners = []model.ListenerDefinition{
		{ListenerKey: "init_guard", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeSourceInitialized, "event/source_owner"}}, Operations: []model.OperationDefinition{shield}},
		{ListenerKey: "receive_guard", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeDamageTaken, "event/target_owner"}}, Condition: &model.GenericFormulaExpr{Op: "gt", Args: []model.GenericFormulaExpr{{Op: "read", Path: "event.damage.linked_shield[native_guard/value].absorbed"}, p6Const(0)}}, Operations: []model.OperationDefinition{{Operation: "state_change", Target: "self", Ref: "wait", Types: []string{"state_scope/provider"}, ValuePolicy: "set", Amount: timedShieldExpr(1)}}},
	}
	r.SharedProviders = append(r.SharedProviders, model.ProviderDefinition{ProviderKey: "native_guard/lifecycle", StableID: "native_guard/lifecycle", SkillKey: "native_guard", Kind: "status", LinkedShieldDefinitionRef: "native_guard/value", Lifecycle: &model.ProviderLifecycle{MaxStacks: float64(1), RefreshPolicy: "replace"}})
	return r
}

func TestCompileReceivedShieldBindsActualNaturalParentAndPassiveAbility(t *testing.T) {
	for _, mode := range []string{"provider_listener", "listener_spec_operations", "ability_operations"} {
		r := receivedShieldCompileInput()
		if mode != "provider_listener" {
			listener := r.SharedProviders[0].Listeners[1]
			r.SharedProviders[0].Listeners = r.SharedProviders[0].Listeners[:1]
			ability := model.AbilityDefinition{AbilityKey: "guard_received", Kind: "passive_listener", SkillKey: "native_guard", ListenerSpec: &listener}
			if mode == "ability_operations" {
				ability.Operations, listener.Operations = listener.Operations, nil
			}
			r.SharedProviders[0].Abilities = append(r.SharedProviders[0].Abilities, ability)
		}
		got := CompileGeneric(r)
		if !got.OK || !got.Session.Features.Has(plan.FeatureReceivedShieldReads) {
			t.Fatal("real own shield listener rejected", mode, got.Result.Errors)
		}
		p := got.Session.Providers[len(got.Session.Providers)-1]
		if !p.HasReceivedShieldBinding || p.ReceivedShieldParentIndex != 0 {
			t.Fatal("missing actual parent binding", p)
		}
		for id := 0; id < got.Session.Formulas.Metadata.Count(); id++ {

			instructions := got.Session.Formulas.Metadata.Instructions(formula.GenericProgramID(id))
			for _, in := range instructions {
				if in.ReadKind == formula.ReadReceivedLinkedShieldAbsorbed && (!in.ReferenceBound || int(in.RefIndex) != len(got.Session.Providers)-1) {
					t.Fatal("shield reference was not compiled", in)
				}
			}
		}
	}
}

func TestCompileReceivedShieldRejectsForeignIdentityAndNonConditionUses(t *testing.T) {
	read := model.GenericFormulaExpr{Op: "read", Path: "event.damage.linked_shield[native_guard/value].absorbed"}
	cases := []struct {
		name   string
		change func(*model.CompileRequest)
	}{
		{"any_event", func(r *model.CompileRequest) {
			r.SharedProviders[0].Listeners[1].EventMatcher = model.TypeMatcher{Any: []string{model.EventTypeDamageTaken, "event/target_owner"}}
		}},
		{"sender", func(r *model.CompileRequest) {
			r.SharedProviders[0].Listeners[1].EventMatcher.All = []string{"event/damage_instance", "event/source_owner"}
		}},
		{"no_target_owner", func(r *model.CompileRequest) {
			r.SharedProviders[0].Listeners[1].EventMatcher.All = []string{model.EventTypeDamageTaken}
		}},
		{"unknown_shield", func(r *model.CompileRequest) {
			r.SharedProviders[0].Listeners[1].Condition = &model.GenericFormulaExpr{Op: "read", Path: "event.damage.linked_shield[unknown].absorbed"}
		}},
		{"other_skill", func(r *model.CompileRequest) { r.SharedProviders[1].SkillKey = "another_skill" }},
		{"active_listener_spec", func(r *model.CompileRequest) {
			listener := r.SharedProviders[0].Listeners[1]
			r.SharedProviders[0].Listeners = r.SharedProviders[0].Listeners[:1]
			r.SharedProviders[0].Abilities = append(r.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "bad_listener", Kind: "active", SkillKey: "native_guard", ListenerSpec: &listener})
		}},
		{"duplicate_parent", func(r *model.CompileRequest) {
			r.Combatants[0].Providers = append(r.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "duplicate_parent", DefinitionRef: r.SharedProviders[0].ProviderKey})
		}},
		{"unmounted_parent", func(r *model.CompileRequest) { r.Combatants[0].Providers = nil }},
		{"target_shield", func(r *model.CompileRequest) { r.SharedProviders[0].Listeners[0].Operations[0].Target = "target" }},
		{"no_creator", func(r *model.CompileRequest) { r.SharedProviders[0].Listeners = r.SharedProviders[0].Listeners[1:] }},
		{"foreign_creator", func(r *model.CompileRequest) {
			op := r.SharedProviders[0].Listeners[0].Operations[0]
			r.SharedProviders = append(r.SharedProviders, model.ProviderDefinition{ProviderKey: "foreign", StableID: "foreign", Kind: "character", SkillKey: "native_guard", Abilities: []model.AbilityDefinition{{AbilityKey: "foreign_apply", Kind: "active", Operations: []model.OperationDefinition{op}}}})
		}},
		{"active_amount", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].Operations[0].Amount = &read }},
		{"listener_amount", func(r *model.CompileRequest) { r.SharedProviders[0].Listeners[1].Operations[0].Amount = &read }},
		{"active_condition", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].CastCondition = &read }},
		{"hidden_branch_amount", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations[0].Amount = &model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{p6Const(0), read, p6Const(1)}}
		}},
		{"global_modifier", func(r *model.CompileRequest) {
			r.Rules.Modifiers = []model.ModifierDefinition{{ModifierKey: "bad", Kind: "attribute", Target: "source.attr.hp", ValuePolicy: "add", Value: read}}
		}},
		{"inline_listener", func(r *model.CompileRequest) {
			r.Rules.Listeners = []model.ListenerDefinition{r.SharedProviders[0].Listeners[1]}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := receivedShieldCompileInput()
			tc.change(&r)
			got := CompileGeneric(r)
			if got.OK {
				t.Fatal("unauthorized own shield read compiled")
			}
			found := false
			for _, err := range got.Result.Errors {
				found = found || strings.Contains(err.Message, "shield")
			}
			if !found {
				t.Fatal("failed for an unrelated reason", got.Result.Errors)
			}
		})
	}
	for _, event := range []string{model.EventTypeDamageTaken, "event/damage_instance"} {
		r := receivedShieldCompileInput()
		r.SharedProviders[0].Abilities[0].Operations = append(r.SharedProviders[0].Abilities[0].Operations, model.OperationDefinition{Operation: "emit_event", Target: "target", EventType: event})
		if got := CompileGeneric(r); got.OK {
			t.Fatal("forged settlement event compiled", event)
		}
	}
}

func TestCompileReceivedShieldRepeatBoundaryUsesCompleteOperationTable(t *testing.T) {
	repeat := model.OperationDefinition{Operation: model.OperationKindRepeat, RepeatScope: model.RepeatScopeCopyableOnHit, RepeatCount: 1, RepeatTag: "extra_hit", TriggerStateKey: "wait", Threshold: 3}
	for _, reads := range []bool{false, true} {
		r := receivedShieldCompileInput()
		if !reads {
			r.SharedProviders[0].Listeners[1].Condition = timedShieldExpr(1)
		}
		r.SharedProviders[0].Abilities[0].Operations = append(r.SharedProviders[0].Abilities[0].Operations, repeat)
		got := CompileGeneric(r)
		if got.OK == reads {
			t.Fatal("repeat boundary changed the old path or missed a new reader", reads, got.Result.Errors)
		}
	}
	r := receivedShieldCompileInput()
	r.SharedProviders[0].Abilities[0].Operations[0].CopyableOnHit = true
	if got := CompileGeneric(r); !got.OK {
		t.Fatal("a marker alone is not a replay operation", got.Result.Errors)
	}
	for _, hasReplay := range []bool{false, true} {
		r := receivedShieldCompileInput()
		r.SharedProviders[0].Processes = []model.ProcessDefinition{{ProcessKey: "normal_multistep", SkillKey: "native_guard", Costs: []model.ProcessCostDefinition{}, Steps: []model.ProcessStepDefinition{{StepKey: "initial", StepType: "IMMEDIATE"}, {StepKey: "later", StepType: "DELAY", DelayMs: timedShieldExpr(100)}}}}
		r.SharedProviders[0].Abilities = append(r.SharedProviders[0].Abilities, model.AbilityDefinition{AbilityKey: "begin_process", Kind: "active", SkillKey: "native_guard", ProcessControl: &model.ProcessControlDefinition{ProcessKey: "normal_multistep", Action: "INITIAL"}})
		if hasReplay {
			r.SharedProviders[0].Processes[0].MomentOperations = []model.ProcessMomentOperations{{Moment: model.ProcessMomentDefinition{MomentType: "PROCESS_COMPLETE"}, Operations: []model.OperationDefinition{repeat}}}
		}
		got := CompileGeneric(r)
		if got.OK == hasReplay {
			t.Fatal("a normal process was mistaken for replay, or late process replay escaped the completed table", hasReplay, got.Result.Errors)
		}
	}
}

func TestReceivedShieldDependencyGateExpandsNamedAndAllBranches(t *testing.T) {
	read := formula.GenericInstr{Op: formula.GenericOpRead, ReadKind: formula.ReadReceivedLinkedShieldAbsorbed, ReadKey: "native_guard/value"}
	for _, condition := range []bool{false, true} {
		collector := newGenericCollector("s", "r")
		session := plan.CompiledSession{Formulas: fixtureFormulaLibrary([]formula.GenericProgram{
			{Key: "named", DeclaredNamed: true, Instr: []formula.GenericInstr{read}},
			{Key: "wrapper", Instr: []formula.GenericInstr{{Op: formula.GenericOpRef, RefIndex: 0}}},
		})}
		listener := model.ListenerDefinition{EventMatcher: model.TypeMatcher{All: []string{model.EventTypeDamageTaken, "event/target_owner"}}}
		ctx := genericCompileContext{collector: collector, session: &session, currentListener: &listener, compilingListenerCondition: condition}
		validateReceivedShieldReadContext(session.Formulas.Metadata.ReadDependencies(1), "wrapper", &ctx)
		if (len(collector.errors) == 0) != condition {
			t.Fatal("named dependency borrowed an operation's listener context", condition, collector.errors)
		}
	}
	r := receivedShieldCompileInput()
	r.SharedProviders[0].Listeners[1].Condition = &model.GenericFormulaExpr{Op: "if", Args: []model.GenericFormulaExpr{p6Const(0), {Op: "read", Path: "event.damage.linked_shield[unknown].absorbed"}, p6Const(1)}}
	if got := CompileGeneric(r); got.OK {
		t.Fatal("an unselected branch bypassed definition authorization")
	}
}
