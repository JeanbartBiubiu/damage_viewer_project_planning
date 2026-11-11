package compile

import (
	"testing"
	"tinygo_engine_v2/internal/formula"

	"tinygo_engine_v2/internal/model"
)

func linkedShieldCompileInput() model.CompileRequest {
	req := minimalValidCompileRequest()
	req.SharedProviders = append(req.SharedProviders, model.ProviderDefinition{ProviderKey: "configured_lifecycle", StableID: "configured_lifecycle", Kind: "buff", LinkedShieldDefinitionRef: "configured_barrier"})
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "shield", Target: "target", ShieldRef: "configured_barrier", Amount: timedShieldExpr(75), ShieldDurationMs: timedShieldExpr(200), ShieldLifecycleProviderDefinitionRef: "configured_lifecycle"}}
	return req
}

func TestCompileLinkedShieldPresenceAllowsDeclaredDefinitionWithoutApply(t *testing.T) {
	req := linkedShieldCompileInput()
	req.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(0), Condition: &model.GenericFormulaExpr{Op: "read", Path: "provider.linked_shield[configured_barrier].present"}}}
	result := CompileGeneric(req)
	if !result.OK || !result.Session.HasLinkedShieldReads {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	var found bool
	for id := 0; id < result.Session.Formulas.Metadata.Count(); id++ {

		instructions := result.Session.Formulas.Metadata.Instructions(formula.GenericProgramID(id))
		for _, instruction := range instructions {
			if instruction.ReadKind == formula.ReadLinkedShieldPresent {
				found = instruction.ReferenceBound && instruction.RefIndex == 1
			}
		}
	}
	if !found {
		t.Fatal("presence read was not bound to declared dynamic definition")
	}
}

func TestCompileLinkedShieldPresenceRejectsUnknownAndUnsupportedContexts(t *testing.T) {
	for _, kind := range []string{"unknown", "rules", "modifier"} {
		t.Run(kind, func(t *testing.T) {
			req := linkedShieldCompileInput()
			read := &model.GenericFormulaExpr{Op: "read", Path: "provider.linked_shield[configured_barrier].present"}
			switch kind {
			case "unknown":
				read.Path = "provider.linked_shield[unknown].present"
				req.SharedProviders[0].Abilities[0].Operations[0].Condition = read
			case "rules":
				req.Rules.Operations = []model.OperationDefinition{{Operation: "heal", Target: "self", Amount: timedShieldExpr(0), Condition: read}}
			case "modifier":
				req.SharedProviders[0].Modifiers = []model.ModifierDefinition{{ModifierKey: "unsupported", Kind: "attribute", Target: "self", Channel: "hp", ValuePolicy: "add", Value: *read}}
			}
			result := CompileGeneric(req)
			if result.OK {
				t.Fatal("invalid presence read compiled")
			}
		})
	}
}

func TestCompileShieldLifecycleBindsProviderIndex(t *testing.T) {
	req := linkedShieldCompileInput()
	result := CompileGeneric(req)
	if !result.OK {
		t.Fatalf("compile: %+v", result.Result.Errors)
	}
	op := result.Session.Operations[0]
	if !result.Session.HasShieldLifecycle || !op.HasShieldLifecycleProvider || op.ShieldLifecycleProviderIndex != 1 || result.Session.Providers[1].ShieldDefinitionRef != "configured_barrier" {
		t.Fatalf("binding=%+v provider=%+v", op, result.Session.Providers[1])
	}
}

func TestCompileShieldLifecycleRejectsInvalidAssociations(t *testing.T) {
	cases := []struct {
		name   string
		change func(*model.CompileRequest)
	}{
		{"wrong_operation", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].Operations[0].Operation = "heal" }},
		{"no_shield_definition", func(r *model.CompileRequest) { r.SharedProviders[0].Abilities[0].Operations[0].ShieldRef = "" }},
		{"unknown_provider", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations[0].ShieldLifecycleProviderDefinitionRef = "unknown"
		}},
		{"self_ownership", func(r *model.CompileRequest) {
			r.SharedProviders[0].Abilities[0].Operations[0].ShieldLifecycleProviderDefinitionRef = r.SharedProviders[0].ProviderKey
		}},
		{"two_shields_one_provider", func(r *model.CompileRequest) {
			op := r.SharedProviders[0].Abilities[0].Operations[0]
			op.ShieldRef = "other"
			r.SharedProviders[0].Abilities[0].Operations = append(r.SharedProviders[0].Abilities[0].Operations, op)
		}},
		{"independent_apply", func(r *model.CompileRequest) {
			r.Rules.Operations = append(r.Rules.Operations, model.OperationDefinition{Operation: "apply_provider", Target: "target", ProviderDefinitionRef: "configured_lifecycle"})
		}},
		{"initial_mount", func(r *model.CompileRequest) {
			r.Combatants[0].Providers = append(r.Combatants[0].Providers, model.CombatantProviderMount{ProviderRef: "unpaired", DefinitionRef: "configured_lifecycle"})
		}},
		{"stacking", func(r *model.CompileRequest) {
			r.SharedProviders[1].Lifecycle = &model.ProviderLifecycle{MaxStacks: model.Float64Ptr(2), RefreshPolicy: "replace"}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := linkedShieldCompileInput()
			tc.change(&req)
			got := CompileGeneric(req)
			if got.OK {
				t.Fatal("invalid association compiled")
			}
		})
	}
}
