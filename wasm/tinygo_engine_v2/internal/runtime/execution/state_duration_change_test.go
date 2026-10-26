package execution

import (
	testing "testing"
	model "tinygo_engine_v2/internal/model"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	sdcProviderRef = "item:sdc_timer_probe"
	sdcTimedKey    = "timed_flag"
	sdcTargetKey   = "target_flag"
	sdcSubListener = "listener_sdc_subtract"
	sdcDurationMs  = 6000.0
	sdcChampionRef = spellbladeChampionRef
	sdcHitAbility  = spellbladeHitAbilityKey
	sdcProbeKey    = "sdc_probe"
)

func sdcTimedSlot(durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  float64(0),
		"maxValue":      float64(1),
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func sdcEnsureTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "armor")
	formuladefinition.SetDamageFormula(req, "damage/physical", formuladefinition.ResistanceDefense("armor"))

	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, t := range need {
		if !have[t.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, t)
		}
	}
}

func sdcMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, scope string, subtractAmount float64, armOnDamage bool) {
	one := 1.0
	schemaKey := sdcTimedKey
	if scope == "state_scope/provider_target" {
		schemaKey = sdcTargetKey
	}
	ops := []model.OperationDefinition{}
	if armOnDamage {
		ops = append(ops, model.OperationDefinition{
			Operation:   "state_change",
			Target:      "source",
			Ref:         schemaKey,
			Types:       []string{scope},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		})
	}
	ops = append(ops, model.OperationDefinition{
		Operation:   model.OperationKindStateDurationChange,
		Target:      "source",
		Ref:         schemaKey,
		Types:       []string{scope},
		ValuePolicy: "subtract",
		Amount:      &model.GenericFormulaExpr{Op: "const", Value: &subtractAmount},
	})
	listener := model.ListenerDefinition{
		ListenerKey:  sdcSubListener,
		EventMatcher: model.TypeMatcher{All: []string{"event/damage_instance", "ability/basic_attack", "event/source_owner"}},
		Operations:   ops,
	}
	readPath := "provider.state." + schemaKey
	if scope == "state_scope/provider_target" {
		readPath = "provider.target_state." + schemaKey
	}
	// Modifier forces attribute resolve to lazy-expire the timed key on probes.
	mod := model.ModifierDefinition{
		ModifierKey: "sdc_probe_as",
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(0.01),
				{Op: "read", Path: readPath},
			},
		},
	}
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: sdcProviderRef,
		Kind:        "item",
		StableID:    "sdc_probe",
		InitialStateSchema: map[string]interface{}{
			schemaKey: sdcTimedSlot(sdcDurationMs),
		},
		Modifiers: []model.ModifierDefinition{mod},
		Listeners: []model.ListenerDefinition{listener},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: sdcProviderRef, DefinitionRef: sdcProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{ProviderRef: sdcProviderRef, DefinitionRef: sdcProviderRef, Stacks: 1, State: map[string]interface{}{}},
		)
	}
}

func sdcConfigureAA(compileReq *model.CompileRequest) {
	one := 1.0
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: sdcHitAbility,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Ref:        "op:sdc_aa",
		}},
	}}
}

func sdcAARef() string {
	return "source.provider[" + sdcChampionRef + "].ability[" + sdcHitAbility + "]"
}

func sdcAttachProbe(compileReq *model.CompileRequest) {
	one := 1.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: sdcProbeKey,
		Kind:       "active",
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Ref:        "op:sdc_probe",
		}},
	})
}

func sdcLoad(t *testing.T, scope string, subtractAmount float64, armOnDamage bool) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	sdcEnsureTypes(&compileReq)
	sdcConfigureAA(&compileReq)
	sdcAttachProbe(&compileReq)
	sdcMountProvider(&compileReq, &runReq, scope, subtractAmount, armOnDamage)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: 0.6, Current: 0.6, Max: 0.6, Resolved: 0.6,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}
