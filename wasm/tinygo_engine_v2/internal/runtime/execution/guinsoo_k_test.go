package execution

import (
	math "math"
	testing "testing"
	attribute "tinygo_engine_v2/internal/base/attribute"
	compile "tinygo_engine_v2/internal/compile"
	model "tinygo_engine_v2/internal/model"
	actor "tinygo_engine_v2/internal/runtime/actor"
	effectpkg "tinygo_engine_v2/internal/runtime/effect"
	formuladefinition "tinygo_engine_v2/internal/testkit/formuladefinition"
)

const (
	guinsooKHitEvent           = "event/on_hit"
	guinsooKOtherProvider      = "item:other_on_hit"
	guinsooKCopyableAmt        = 30.0
	guinsooKOtherAmt           = 20.0
	guinsooKNonCopyAmt         = 15.0
	guinsooKAAAmt              = 10.0
	guinsooPhantomCounterKey   = "guinsoos_phantom_hit_counter"
	guinsooCadenceWindowMs     = 3000
	guinsooCadenceHitSpacingMs = 100
)

func ensureGuinsooKTypes(req *model.CompileRequest) {
	formuladefinition.DeclareAttributes(req, "magic_resist")
	formuladefinition.SetDamageFormula(req, "damage/magic", formuladefinition.ResistanceDefense("magic_resist"))

	formuladefinition.SetDamageFormula(req, "damage/true", formuladefinition.ConstantDefense("1"))

	need := []model.TypeCatalogEntry{
		{Key: guinsooKHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: "damage/true", Domain: "damage"},
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

func guinsooKStackSchema() map[string]interface{} {
	return map[string]interface{}{
		guinsooStackKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(4),
			"durationMs":    float64(10000),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func guinsooKConst(v float64) *model.GenericFormulaExpr {
	return &model.GenericFormulaExpr{Op: "const", Value: &v}
}

func guinsooKAAOps() []model.OperationDefinition {
	one := 1.0
	aa := guinsooKAAAmt
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
		},
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: guinsooKHitEvent,
			Ref:       guinsooKHitEvent,
		},
	}
}

func guinsooKCopyableListener(key string, amount float64, copyable bool) model.ListenerDefinition {
	return model.ListenerDefinition{
		ListenerKey:  key,
		EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Amount:        guinsooKConst(amount),
				CopyableOnHit: copyable,
			},
		},
	}
}

func mountGuinsooKOtherProvider(compileReq *model.CompileRequest, runReq *model.RunRequest, listeners []model.ListenerDefinition) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: guinsooKOtherProvider,
		Kind:        "item",
		StableID:    "other_on_hit",
		Listeners:   listeners,
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: guinsooKOtherProvider, DefinitionRef: guinsooKOtherProvider,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: guinsooKOtherProvider, DefinitionRef: guinsooKOtherProvider, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func loadGuinsooKFixture(t *testing.T, guinsooListeners []model.ListenerDefinition, otherListeners []model.ListenerDefinition, hits int) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureGuinsooKTypes(&compileReq)

	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = guinsooHitAbility
	compileReq.SharedProviders[0].Abilities[0].Operations = guinsooKAAOps()
	compileReq.SharedProviders[0].Listeners = guinsooListeners

	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})

	if len(otherListeners) > 0 {
		mountGuinsooKOtherProvider(&compileReq, &runReq, otherListeners)
	}

	abilityRef := "source.provider[" + guinsooProviderRef + "].ability[" + guinsooHitAbility + "]"
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "k_hit_" + itoaRuntime(i),
			AbilityRef: abilityRef,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  int64(i * guinsooCadenceHitSpacingMs),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*guinsooCadenceHitSpacingMs + 100)
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func itoaRuntime(n int) string {
	if n == 0 {
		return "0"
	}
	var b [16]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func TestGenericPhantomReplayStableOrderViaShieldHP(t *testing.T) {
	armor := 100.0
	hp0 := 100.0
	shield0 := 40.0
	entryArmor := model.AttributeSlotDef{Base: armor, Current: armor, Max: armor, Resolved: armor}
	s := &Engine{loop: newTestLoopAt(0),
		budget: model.DefaultSafetyBudget(),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				numbers: actor.New(model.SelectorSource, attribute.Table{}, nil),
				providerState: testProviderStates(providerStateTestSeeds{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				}),
			},
			model.SelectorTarget: {instances: effectpkg.NewInstances(effectpkg.Providers([]effectpkg.Provider{}), effectpkg.Shields([]effectpkg.Shield{{
				ShieldRef: "test_shield", Source: model.SelectorSource, Owner: model.SelectorTarget,
				Remaining: shield0, Priority: 0,
			}}), effectpkg.AttributeResolver{}, effectpkg.DamageResolver{}, effectpkg.ResourceMaxContributions([]effectpkg.ResourceContribution{})), numbers: actor.New(model.SelectorTarget,
				attribute.FromMap(map[string]model.AttributeSlotDef{
					"hp":    {Base: hp0, Current: hp0, Max: hp0, Resolved: hp0},
					"armor": entryArmor,
				}), nil),
			},
		},
	}
	registerTestDefense(t, s, "damage/physical", formuladefinition.ResistanceDefense("armor"))
	registerTestDefense(t, s, "damage/magic", formuladefinition.ConstantDefense("1"))
	// 故意按 provenance 逆序 append：z 在前、a 在后；physical/magic 抗性不同。
	collector := newTestCopyableCollector(collectorTestSeed{
		damages: []copyableDamageFrozen{
			{
				ProviderRef: "prov:z", OriginRef: "listener:z", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget,
				DamageType: "damage/physical", RawAmount: 100,
				EventTargetKey: model.SelectorTarget, EntryTargetAttrs: attribute.FromMap(map[string]model.AttributeSlotDef{"armor": entryArmor}),
			},
			{
				ProviderRef: "prov:a", OriginRef: "listener:a", SourceKey: model.SelectorSource, TargetKey: model.SelectorTarget,
				DamageType: "damage/magic", RawAmount: 60,
				EventTargetKey: model.SelectorTarget, EntryTargetAttrs: attribute.FromMap(map[string]model.AttributeSlotDef{"armor": entryArmor}),
			},
		},
		repeats: []deferredRepeatRequest{{
			OwnerCombatantKey: model.SelectorSource, OwnerProviderRef: "prov:gate",
			TriggerStateKey: "stacks", Threshold: 4, RepeatCount: 1,
			RepeatScope: model.RepeatScopeCopyableOnHit, RepeatTag: "phantom_hit",
		}},
	})

	if err := s.flushDeferredPhantomReplay(collector); err != nil {
		t.Fatalf("flush: %+v", err)
	}

	// provenance：prov:a (magic 60) 先于 prov:z (physical 100→50)
	if len(reportedDamageHistory(s)) != 2 {
		t.Fatalf("damageHistory len=%d want 2 phantom hits", len(reportedDamageHistory(s)))
	}
	if math.Abs(reportedDamageHistory(s)[0].Amount-60) > 1e-6 || math.Abs(reportedDamageHistory(s)[1].Amount-50) > 1e-6 {
		t.Fatalf("phantom order amounts=%v,%v want 60 then 50 (provenance a/magic before z/physical); append order would be 50 then 60",
			reportedDamageHistory(s)[0].Amount, reportedDamageHistory(s)[1].Amount)
	}

	tgt := s.combatants[model.SelectorTarget]
	// magic60：护盾40→HP-20；physical50：HP-50 → HP=30；护盾耗尽
	wantHP := hp0 - (60 - shield0) - 50
	gotHP := tgt.attributesView().At("hp").Current
	if math.Abs(gotHP-wantHP) > 1e-6 {
		t.Fatalf("target hp=%v want %v", gotHP, wantHP)
	}
	remShield := 0.0
	for instanceIndex, instanceValues := 0, tgt.instances.Shields(); instanceIndex < instanceValues.Len(); instanceIndex++ {
		sh := instanceValues.At(instanceIndex)
		remShield += sh.Remaining
	}
	if remShield > 1e-6 {
		t.Fatalf("remaining shield=%v want 0", remShield)
	}
	if math.Abs(s.report.Totals().SourceDamageDealt-110) > 1e-6 {
		t.Fatalf("dealt=%v want 110 (mitigated pre-shield total)", s.report.Totals().SourceDamageDealt)
	}
}

func damageEvidenceItems(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindDamage {
			out = append(out, item)
		}
	}
	return out
}

func evidenceDataFloat(data map[string]interface{}, key string) float64 {
	v, _ := data[key].(float64)
	return v
}

// TestGenericRunDamageEvidenceTruncationCountsByKind damage evidence 服从 MaxEvidenceItems 截断与 CountsByKind。
func TestGenericRunDamageEvidenceTruncationCountsByKind(t *testing.T) {
	listeners := []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true),
	}
	compileReq, runReq := loadGuinsooKFixture(t, listeners, nil, 3)
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	state, runErr := newGenericRunState(result.Session, runReq)
	if runErr != nil {
		t.Fatal(runErr)
	}
	state.budget.MaxEvidenceItems = 3
	if err := state.runLoop(); err != nil {
		t.Fatal(err)
	}
	done := state.buildDoneResult(false)
	if !done.Summary.EvidenceTruncated || !done.Evidence.Truncated {
		t.Fatal("expected evidence truncated")
	}
	if len(done.Evidence.Items) != 3 {
		t.Fatalf("items=%d want 3 (MaxEvidenceItems)", len(done.Evidence.Items))
	}
	damageCount := done.Evidence.CountsByKind[string(model.EvidenceKindDamage)]
	if damageCount < 4 {
		t.Fatalf("countsByKind damage=%d want >=4 including truncated", damageCount)
	}
	keptDamage := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindDamage {
			keptDamage++
		}
	}
	if keptDamage > damageCount {
		t.Fatalf("kept damage items=%d > countsByKind=%d", keptDamage, damageCount)
	}
	if done.Evidence.TruncatedEvidenceCount < 1 {
		t.Fatalf("truncatedEvidenceCount=%d want >=1", done.Evidence.TruncatedEvidenceCount)
	}
}
