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

func TestGenericPhantomProvenanceSortStable(t *testing.T) {
	// 逆序 append；排序后按 provenance 升序；等键项（用 rawAmount 区分）保持相对顺序。
	damages := []copyableDamageFrozen{
		{providerRef: "p2", originRef: "o2", sourceKey: "source", targetKey: "target", damageType: "damage/true", rawAmount: 2},
		{providerRef: "p2", originRef: "o1", sourceKey: "source", targetKey: "target", damageType: "damage/magic", rawAmount: 21},
		{providerRef: "p1", originRef: "o9", sourceKey: "source", targetKey: "target", damageType: "damage/physical", rawAmount: 11},
		{providerRef: "p1", originRef: "o9", sourceKey: "source", targetKey: "target", damageType: "damage/physical", rawAmount: 12},
		{providerRef: "p1", originRef: "o8", sourceKey: "source", targetKey: "target", damageType: "damage/true", rawAmount: 10},
	}
	sortCopyableDamagesStable(damages)
	wantDamages := []copyableDamageFrozen{
		{providerRef: "p1", originRef: "o8", sourceKey: "source", targetKey: "target", damageType: "damage/true", rawAmount: 10},
		{providerRef: "p1", originRef: "o9", sourceKey: "source", targetKey: "target", damageType: "damage/physical", rawAmount: 11},
		{providerRef: "p1", originRef: "o9", sourceKey: "source", targetKey: "target", damageType: "damage/physical", rawAmount: 12},
		{providerRef: "p2", originRef: "o1", sourceKey: "source", targetKey: "target", damageType: "damage/magic", rawAmount: 21},
		{providerRef: "p2", originRef: "o2", sourceKey: "source", targetKey: "target", damageType: "damage/true", rawAmount: 2},
	}
	if len(damages) != len(wantDamages) {
		t.Fatalf("damages len=%d want %d", len(damages), len(wantDamages))
	}
	for i := range wantDamages {
		got, want := damages[i], wantDamages[i]
		if got.providerRef != want.providerRef || got.originRef != want.originRef ||
			got.sourceKey != want.sourceKey || got.targetKey != want.targetKey ||
			got.damageType != want.damageType || got.rawAmount != want.rawAmount {
			t.Fatalf("damages[%d]=prov=%s origin=%s src=%s tgt=%s type=%s amt=%v want prov=%s origin=%s src=%s tgt=%s type=%s amt=%v",
				i, got.providerRef, got.originRef, got.sourceKey, got.targetKey, got.damageType, got.rawAmount,
				want.providerRef, want.originRef, want.sourceKey, want.targetKey, want.damageType, want.rawAmount)
		}
	}

	// 逆序/乱序 repeats；等键两项用相同 provenance，稳定排序后相对顺序不变。
	equalA := deferredRepeatRequest{
		ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a",
		triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 1,
	}
	equalB := equalA // 完全相同 provenance；稳定排序后 A 仍在 B 前
	repeats := []deferredRepeatRequest{
		{ownerProviderRef: "item:z", ownerCombatantKey: "source", repeatTag: "b", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 2},
		{ownerProviderRef: "item:a", ownerCombatantKey: "target", repeatTag: "a", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "z", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "later", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "stacks", repeatScope: "other_scope", threshold: 4, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 5, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 3},
		equalA,
		equalB,
	}
	sortDeferredRepeatsStable(repeats)
	wantRepeats := []deferredRepeatRequest{
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "later", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 1},
		equalA,
		equalB,
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 3},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 5, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "a", triggerStateKey: "stacks", repeatScope: "other_scope", threshold: 4, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "source", repeatTag: "z", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 1},
		{ownerProviderRef: "item:a", ownerCombatantKey: "target", repeatTag: "a", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 1},
		{ownerProviderRef: "item:z", ownerCombatantKey: "source", repeatTag: "b", triggerStateKey: "stacks", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 4, repeatCount: 2},
	}
	if len(repeats) != len(wantRepeats) {
		t.Fatalf("repeats len=%d want %d", len(repeats), len(wantRepeats))
	}
	for i := range wantRepeats {
		if repeats[i] != wantRepeats[i] {
			t.Fatalf("repeats[%d]=%+v want %+v", i, repeats[i], wantRepeats[i])
		}
	}

	c := &eventCopyableCollector{
		damages: []copyableDamageFrozen{
			{providerRef: "b", originRef: "o", sourceKey: "s", targetKey: "t", damageType: "damage/true"},
			{providerRef: "a", originRef: "o", sourceKey: "s", targetKey: "t", damageType: "damage/magic"},
		},
		repeats: []deferredRepeatRequest{
			{ownerProviderRef: "b", ownerCombatantKey: "source", repeatTag: "x", triggerStateKey: "k", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 1, repeatCount: 1},
			{ownerProviderRef: "a", ownerCombatantKey: "source", repeatTag: "x", triggerStateKey: "k", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 1, repeatCount: 1},
		},
	}
	sortEventCopyableProvenanceStable(c)
	if c.damages[0].providerRef != "a" || c.damages[1].providerRef != "b" {
		t.Fatalf("collector damages order=%s,%s want a,b", c.damages[0].providerRef, c.damages[1].providerRef)
	}
	if c.repeats[0].ownerProviderRef != "a" || c.repeats[1].ownerProviderRef != "b" {
		t.Fatalf("collector repeats order=%s,%s want a,b", c.repeats[0].ownerProviderRef, c.repeats[1].ownerProviderRef)
	}

	// cloneAndSort 不得破坏 collector 原始 append 顺序。
	raw := &eventCopyableCollector{
		damages: []copyableDamageFrozen{
			{providerRef: "z", originRef: "o", sourceKey: "s", targetKey: "t", damageType: "damage/true", rawAmount: 1},
			{providerRef: "a", originRef: "o", sourceKey: "s", targetKey: "t", damageType: "damage/magic", rawAmount: 2},
		},
		repeats: []deferredRepeatRequest{
			{ownerProviderRef: "z", ownerCombatantKey: "source", repeatTag: "r", triggerStateKey: "k", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 1, repeatCount: 1},
			{ownerProviderRef: "a", ownerCombatantKey: "source", repeatTag: "r", triggerStateKey: "k", repeatScope: model.RepeatScopeCopyableOnHit, threshold: 1, repeatCount: 1},
		},
	}
	sortedDamages, sortedRepeats := cloneAndSortEventCopyableProvenance(raw)
	if raw.damages[0].providerRef != "z" || raw.damages[1].providerRef != "a" {
		t.Fatalf("collector damages mutated in place: %s,%s", raw.damages[0].providerRef, raw.damages[1].providerRef)
	}
	if raw.repeats[0].ownerProviderRef != "z" || raw.repeats[1].ownerProviderRef != "a" {
		t.Fatalf("collector repeats mutated in place: %s,%s", raw.repeats[0].ownerProviderRef, raw.repeats[1].ownerProviderRef)
	}
	if sortedDamages[0].providerRef != "a" || sortedDamages[1].providerRef != "z" {
		t.Fatalf("sorted damages=%s,%s want a,z", sortedDamages[0].providerRef, sortedDamages[1].providerRef)
	}
	if sortedRepeats[0].ownerProviderRef != "a" || sortedRepeats[1].ownerProviderRef != "z" {
		t.Fatalf("sorted repeats=%s,%s want a,z", sortedRepeats[0].ownerProviderRef, sortedRepeats[1].ownerProviderRef)
	}
}

// TestGenericPhantomReplayStableOrderViaShieldHP 直接 flush：逆序 append 的 copyable damages
// 必须按 provenance 回放；用 damageHistory 顺序 + 护盾/HP/不同 damageType 断言，而非只比总伤害。
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
	collector := &eventCopyableCollector{
		damages: []copyableDamageFrozen{
			{
				providerRef: "prov:z", originRef: "listener:z", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget,
				damageType: "damage/physical", rawAmount: 100,
				eventTargetKey: model.SelectorTarget, entryTargetAttrs: attribute.FromMap(map[string]model.AttributeSlotDef{"armor": entryArmor}),
			},
			{
				providerRef: "prov:a", originRef: "listener:a", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget,
				damageType: "damage/magic", rawAmount: 60,
				eventTargetKey: model.SelectorTarget, entryTargetAttrs: attribute.FromMap(map[string]model.AttributeSlotDef{"armor": entryArmor}),
			},
		},
		repeats: []deferredRepeatRequest{{
			ownerCombatantKey: model.SelectorSource, ownerProviderRef: "prov:gate",
			triggerStateKey: "stacks", threshold: 4, repeatCount: 1,
			repeatScope: model.RepeatScopeCopyableOnHit, repeatTag: "phantom_hit",
		}},
	}
	appendProv := []string{collector.damages[0].providerRef, collector.damages[1].providerRef}

	if err := s.flushDeferredPhantomReplay(collector); err != nil {
		t.Fatalf("flush: %+v", err)
	}
	if collector.damages[0].providerRef != appendProv[0] || collector.damages[1].providerRef != appendProv[1] {
		t.Fatalf("flush must not reorder collector in place: got %s,%s want %s,%s",
			collector.damages[0].providerRef, collector.damages[1].providerRef, appendProv[0], appendProv[1])
	}

	// provenance：prov:a (magic 60) 先于 prov:z (physical 100→50)
	if len(reportedDamageHistory(s)) != 2 {
		t.Fatalf("damageHistory len=%d want 2 phantom hits", len(reportedDamageHistory(s)))
	}
	if math.Abs(reportedDamageHistory(s)[0].amount-60) > 1e-6 || math.Abs(reportedDamageHistory(s)[1].amount-50) > 1e-6 {
		t.Fatalf("phantom order amounts=%v,%v want 60 then 50 (provenance a/magic before z/physical); append order would be 50 then 60",
			reportedDamageHistory(s)[0].amount, reportedDamageHistory(s)[1].amount)
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
