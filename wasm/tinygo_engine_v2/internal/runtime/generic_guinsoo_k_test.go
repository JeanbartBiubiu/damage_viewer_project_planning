package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	shieldpkg "tinygo_engine_v2/internal/shield"
)

const (
	guinsooKHitEvent      = "event/on_hit"
	guinsooKOtherProvider = "item:other_on_hit"
	guinsooKCopyableAmt   = 30.0
	guinsooKOtherAmt      = 20.0
	guinsooKNonCopyAmt    = 15.0
	guinsooKAAAmt         = 10.0
)

func ensureGuinsooKTypes(req *model.CompileRequest) {
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

func guinsooKRepeatOp() model.OperationDefinition {
	return model.OperationDefinition{
		Operation:       model.OperationKindRepeat,
		RepeatScope:     model.RepeatScopeCopyableOnHit,
		RepeatCount:     1,
		RepeatTag:       "phantom_hit",
		TriggerStateKey: guinsooStackKey,
		Threshold:       4,
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

func guinsooKRepeatListener(key string) model.ListenerDefinition {
	return model.ListenerDefinition{
		ListenerKey:  key,
		EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
		Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
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
			FirstAtMs:  int64(i * 100),
		})
	}
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = int64(hits*100 + 100)
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

func runGuinsooK(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func emittedOnHitCount(done model.DoneResult) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == guinsooKHitEvent {
			n++
		}
	}
	return n
}

func expectedMitigatedPhysical(raw, armor float64) float64 {
	if armor >= 0 {
		return raw * 100 / (100 + armor)
	}
	return raw * (2 - 100/(100-armor))
}

func TestGenericRunGuinsooKLayers1to3NoPhantomFourthReplays(t *testing.T) {
	listeners := []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true),
		guinsooKRepeatListener("guinsoo_phantom"),
	}

	c3, r3 := loadGuinsooKFixture(t, listeners, nil, 3)
	done3 := runGuinsooK(t, c3, r3)
	want3 := guinsooKAAAmt*3 + guinsooKCopyableAmt*3
	if math.Abs(done3.Summary.SourceDamageDealt-want3) > 1e-6 {
		t.Fatalf("3hit dealt=%v want %v (no phantom before threshold)", done3.Summary.SourceDamageDealt, want3)
	}

	c4, r4 := loadGuinsooKFixture(t, listeners, nil, 4)
	done4 := runGuinsooK(t, c4, r4)
	want4 := guinsooKAAAmt*4 + guinsooKCopyableAmt*4 + guinsooKCopyableAmt
	if math.Abs(done4.Summary.SourceDamageDealt-want4) > 1e-6 {
		t.Fatalf("4hit dealt=%v want %v (fourth hit phantoms once)", done4.Summary.SourceDamageDealt, want4)
	}
	if done4.Summary.AbilityCastCount != 4 {
		t.Fatalf("abilityCastCount=%d want 4 (phantom must not cast)", done4.Summary.AbilityCastCount)
	}
	if done4.Summary.AbilityAttemptCount != 4 {
		t.Fatalf("abilityAttemptCount=%d want 4", done4.Summary.AbilityAttemptCount)
	}
	state := sourceProviderState(t, done4.FinalSnapshot, guinsooProviderRef)["state"].(map[string]interface{})
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 4 {
		t.Fatalf("stacks=%v want 4", stacks)
	}
}

func TestGenericRunGuinsooKCopiesSelfAndOtherSkipsNonCopyable(t *testing.T) {
	guinsooListeners := []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true),
		{
			ListenerKey:  "guinsoo_non_copy",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/true",
					Amount:        guinsooKConst(guinsooKNonCopyAmt),
					CopyableOnHit: false,
				},
			},
		},
		guinsooKRepeatListener("guinsoo_phantom"),
	}
	otherListeners := []model.ListenerDefinition{
		guinsooKCopyableListener("other_wrath", guinsooKOtherAmt, true),
	}
	c, r := loadGuinsooKFixture(t, guinsooListeners, otherListeners, 4)
	done := runGuinsooK(t, c, r)

	perHit := guinsooKAAAmt + guinsooKCopyableAmt + guinsooKOtherAmt + guinsooKNonCopyAmt
	phantom := guinsooKCopyableAmt + guinsooKOtherAmt
	want := perHit*4 + phantom
	if math.Abs(done.Summary.SourceDamageDealt-want) > 1e-6 {
		t.Fatalf("dealt=%v want %v (copy self+other; skip non-copyable)", done.Summary.SourceDamageDealt, want)
	}
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
	s := &genericRunState{
		budget: model.DefaultSafetyBudget(),
		combatants: map[string]combatantRuntime{
			model.SelectorSource: {
				key: model.SelectorSource,
				providerState: map[string]*providerStateBag{
					"prov:gate": {state: map[string]float64{"stacks": 4}},
				},
			},
			model.SelectorTarget: {
				key: model.SelectorTarget,
				attributes: map[string]model.AttributeSlotDef{
					"hp":    {Base: hp0, Current: hp0, Max: hp0, Resolved: hp0},
					"armor": entryArmor,
				},
				shields: []shieldpkg.Instance{{
					ShieldRef: "test_shield", Source: model.SelectorSource, Owner: model.SelectorTarget,
					Remaining: shield0, Priority: 0,
				}},
			},
		},
	}
	// 故意按 provenance 逆序 append：z 在前、a 在后；physical/magic 抗性不同。
	collector := &eventCopyableCollector{
		damages: []copyableDamageFrozen{
			{
				providerRef: "prov:z", originRef: "listener:z", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget,
				damageType: "damage/physical", rawAmount: 100,
				eventTargetKey: model.SelectorTarget, entryTargetAttrs: map[string]model.AttributeSlotDef{"armor": entryArmor},
			},
			{
				providerRef: "prov:a", originRef: "listener:a", sourceKey: model.SelectorSource, targetKey: model.SelectorTarget,
				damageType: "damage/magic", rawAmount: 60,
				eventTargetKey: model.SelectorTarget, entryTargetAttrs: map[string]model.AttributeSlotDef{"armor": entryArmor},
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
	if len(s.damageHistory) != 2 {
		t.Fatalf("damageHistory len=%d want 2 phantom hits", len(s.damageHistory))
	}
	if math.Abs(s.damageHistory[0].amount-60) > 1e-6 || math.Abs(s.damageHistory[1].amount-50) > 1e-6 {
		t.Fatalf("phantom order amounts=%v,%v want 60 then 50 (provenance a/magic before z/physical); append order would be 50 then 60",
			s.damageHistory[0].amount, s.damageHistory[1].amount)
	}

	tgt := s.combatants[model.SelectorTarget]
	// magic60：护盾40→HP-20；physical50：HP-50 → HP=30；护盾耗尽
	wantHP := hp0 - (60 - shield0) - 50
	gotHP := tgt.attributes["hp"].Current
	if math.Abs(gotHP-wantHP) > 1e-6 {
		t.Fatalf("target hp=%v want %v", gotHP, wantHP)
	}
	remShield := 0.0
	for _, sh := range tgt.shields {
		remShield += sh.Remaining
	}
	if remShield > 1e-6 {
		t.Fatalf("remaining shield=%v want 0", remShield)
	}
	if math.Abs(s.sourceDamageDealt-110) > 1e-6 {
		t.Fatalf("dealt=%v want 110 (mitigated pre-shield total)", s.sourceDamageDealt)
	}
}

func TestGenericRunGuinsooKRepeatOrderAndMountOrderStableTotals(t *testing.T) {
	runVariant := func(t *testing.T, repeatFirst bool, otherFirst bool) model.DoneResult {
		t.Helper()
		var guinsooListeners []model.ListenerDefinition
		copyL := guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true)
		repL := guinsooKRepeatListener("guinsoo_phantom")
		if repeatFirst {
			guinsooListeners = []model.ListenerDefinition{repL, copyL}
		} else {
			guinsooListeners = []model.ListenerDefinition{copyL, repL}
		}
		otherListeners := []model.ListenerDefinition{
			guinsooKCopyableListener("other_wrath", guinsooKOtherAmt, true),
		}
		compileReq, runReq := loadGuinsooKFixture(t, guinsooListeners, nil, 4)
		if otherFirst {
			compileReq.Combatants[0].Providers = nil
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorSource {
					runReq.InitialSnapshot.Combatants[i].Providers = nil
				}
			}
			mountGuinsooKOtherProvider(&compileReq, &runReq, otherListeners)
			compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
				ProviderRef: guinsooProviderRef, DefinitionRef: guinsooProviderRef,
			})
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
					continue
				}
				runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
					ProviderRef: guinsooProviderRef, DefinitionRef: guinsooProviderRef, Stacks: 1, State: map[string]interface{}{},
				})
			}
		} else {
			mountGuinsooKOtherProvider(&compileReq, &runReq, otherListeners)
		}
		return runGuinsooK(t, compileReq, runReq)
	}

	base := runVariant(t, false, false)
	for _, tc := range []struct {
		name        string
		repeatFirst bool
		otherFirst  bool
	}{
		{"repeat_first", true, false},
		{"other_mount_first", false, true},
		{"both_swapped", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := runVariant(t, tc.repeatFirst, tc.otherFirst)
			if math.Abs(got.Summary.SourceDamageDealt-base.Summary.SourceDamageDealt) > 1e-6 {
				t.Fatalf("dealt=%v want stable %v", got.Summary.SourceDamageDealt, base.Summary.SourceDamageDealt)
			}
			if math.Abs(got.Summary.TargetFinalHp-base.Summary.TargetFinalHp) > 1e-6 {
				t.Fatalf("targetHp=%v want stable %v", got.Summary.TargetFinalHp, base.Summary.TargetFinalHp)
			}
		})
	}
}

// TestGenericRunGuinsooKMountOrderPhantomStableOrder 互换 mount/listener 后，phantom 回放顺序仍按
// providerRef provenance 固定（champion:source_demo < item:other_on_hit），并保留总量/HP 断言。
// 顺序来自 EvidenceKindDamage phantom 项的 providerRef（非测试 hook）。
func TestGenericRunGuinsooKMountOrderPhantomStableOrder(t *testing.T) {
	wantPhantomProviders := []string{guinsooProviderRef, guinsooKOtherProvider} // provenance 升序
	runCapture := func(t *testing.T, otherFirst bool) (dealt, hp float64, phantomProviders []string) {
		t.Helper()
		guinsooListeners := []model.ListenerDefinition{
			guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true),
			guinsooKRepeatListener("guinsoo_phantom"),
		}
		otherListeners := []model.ListenerDefinition{
			guinsooKCopyableListener("other_wrath", guinsooKOtherAmt, true),
		}
		compileReq, runReq := loadGuinsooKFixture(t, guinsooListeners, nil, 4)
		// 低 HP + 护盾：使最终 HP 依赖吸收路径；总量仍用 mitigated 口径。
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
			Base: 200, Current: 200, Max: 200, Resolved: 200,
		})
		for i := range runReq.InitialSnapshot.Combatants {
			if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
				continue
			}
			runReq.InitialSnapshot.Combatants[i].Shields = []model.CombatantShieldSnapshot{{
				ShieldRef: "order_shield", Source: model.SelectorSource, Owner: model.SelectorTarget,
				Remaining: 25, Priority: 0, State: map[string]interface{}{},
			}}
		}
		if otherFirst {
			compileReq.Combatants[0].Providers = nil
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorSource {
					runReq.InitialSnapshot.Combatants[i].Providers = nil
				}
			}
			mountGuinsooKOtherProvider(&compileReq, &runReq, otherListeners)
			compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
				ProviderRef: guinsooProviderRef, DefinitionRef: guinsooProviderRef,
			})
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
					continue
				}
				runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
					ProviderRef: guinsooProviderRef, DefinitionRef: guinsooProviderRef, Stacks: 1, State: map[string]interface{}{},
				})
			}
		} else {
			mountGuinsooKOtherProvider(&compileReq, &runReq, otherListeners)
		}

		done := runGuinsooK(t, compileReq, runReq)
		for _, item := range damageEvidenceItems(done) {
			if !evidenceDataBool(item.Data, "phantom") {
				continue
			}
			phantomProviders = append(phantomProviders, evidenceDataString(item.Data, "providerRef"))
		}
		return done.Summary.SourceDamageDealt, done.Summary.TargetFinalHp, phantomProviders
	}

	dealtA, hpA, orderA := runCapture(t, false)
	dealtB, hpB, orderB := runCapture(t, true)
	if math.Abs(dealtA-dealtB) > 1e-6 {
		t.Fatalf("dealt unstable across mount order: %v vs %v", dealtA, dealtB)
	}
	if math.Abs(hpA-hpB) > 1e-6 {
		t.Fatalf("targetHp unstable across mount order: %v vs %v", hpA, hpB)
	}
	if len(orderA) != 2 || len(orderB) != 2 {
		t.Fatalf("phantom evidence counts=%d,%d want 2,2", len(orderA), len(orderB))
	}
	for i := range wantPhantomProviders {
		if orderA[i] != wantPhantomProviders[i] || orderB[i] != wantPhantomProviders[i] {
			t.Fatalf("phantom provider order mountNormal=%v mountOtherFirst=%v want provenance %v (not listener append order)",
				orderA, orderB, wantPhantomProviders)
		}
	}
}

func TestGenericRunGuinsooKPhantomNoRecurseNoEmitNoExtraCast(t *testing.T) {
	listeners := []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true),
		guinsooKRepeatListener("guinsoo_phantom"),
	}
	c, r := loadGuinsooKFixture(t, listeners, nil, 4)
	done := runGuinsooK(t, c, r)

	if got := emittedOnHitCount(done); got != 4 {
		t.Fatalf("emitted on_hit count=%d want 4 (phantom must not emit)", got)
	}
	if done.Summary.AbilityCastCount != 4 {
		t.Fatalf("castCount=%d want 4", done.Summary.AbilityCastCount)
	}
	want := guinsooKAAAmt*4 + guinsooKCopyableAmt*4 + guinsooKCopyableAmt
	if math.Abs(done.Summary.SourceDamageDealt-want) > 1e-6 {
		t.Fatalf("dealt=%v want %v (single phantom depth=1)", done.Summary.SourceDamageDealt, want)
	}
	state := sourceProviderState(t, done.FinalSnapshot, guinsooProviderRef)["state"].(map[string]interface{})
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 4 {
		t.Fatalf("stacks=%v want 4 (phantom must not add stacks)", stacks)
	}
}

func TestGenericRunGuinsooKNestedEmitCollectorIsolation(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureGuinsooKTypes(&compileReq)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/nested", Domain: "event"})

	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	four := 4.0
	parentDmg := 40.0
	nestedDmg := 7.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &four},
		},
		{Operation: "emit_event", Target: "target", EventType: guinsooKHitEvent, Ref: guinsooKHitEvent},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "parent_copy",
			EventMatcher: model.TypeMatcher{Any: []string{guinsooKHitEvent}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/true",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &parentDmg},
					CopyableOnHit: true,
				},
				{Operation: "emit_event", Target: "target", EventType: "event/nested", Ref: "event/nested"},
			},
		},
		{
			ListenerKey:  "parent_repeat",
			EventMatcher: model.TypeMatcher{Any: []string{guinsooKHitEvent}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
		{
			ListenerKey:  "nested_copy",
			EventMatcher: model.TypeMatcher{Any: []string{"event/nested"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/true",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &nestedDmg},
					CopyableOnHit: true,
				},
				{
					Operation:       model.OperationKindRepeat,
					RepeatScope:     model.RepeatScopeCopyableOnHit,
					RepeatCount:     1,
					RepeatTag:       "nested_phantom",
					TriggerStateKey: guinsooStackKey,
					Threshold:       4,
				},
			},
		},
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 1000, Max: 1000, Resolved: 1000,
	})
	runReq.StopPolicy.DurationMs = 100
	done := runGuinsooK(t, compileReq, runReq)

	// parent 40+phantom40; nested 7+phantom7; no cross-copy
	wantDealt := parentDmg + parentDmg + nestedDmg + nestedDmg
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v (nested collectors isolated)", done.Summary.SourceDamageDealt, wantDealt)
	}
	wantHP := 1000 - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("hp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}
}

func TestGenericRunGuinsooKPhantomUsesFrozenEntryResistance(t *testing.T) {
	armor := 100.0
	compileReq, runReq := loadBasicFixture(t)
	ensureGuinsooKTypes(&compileReq)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	four := 4.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &four},
		},
		{Operation: "emit_event", Target: "target", EventType: guinsooKHitEvent, Ref: guinsooKHitEvent},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "copy_then_strip",
			EventMatcher: model.TypeMatcher{Any: []string{guinsooKHitEvent}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/physical",
					Amount:        guinsooKConst(100),
					CopyableOnHit: true,
				},
				{
					Operation:    "attribute_change",
					Target:       "target",
					AttributeKey: "armor",
					ValuePolicy:  "set",
					Amount:       guinsooKConst(0),
				},
			},
		},
		guinsooKRepeatListener("phantom"),
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 1000, Max: 1000, Resolved: 1000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: armor, Current: armor, Max: armor, Resolved: armor,
	})
	runReq.StopPolicy.DurationMs = 100
	done := runGuinsooK(t, compileReq, runReq)

	originalMitigated := expectedMitigatedPhysical(100, armor) // 50
	// Original + phantom both use entry armor 100. Polluted live armor 0 would deal 100 on phantom.
	wantDealt := originalMitigated + originalMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v (phantom keeps entry armor; polluted would be %v)",
			done.Summary.SourceDamageDealt, wantDealt, originalMitigated+100)
	}
	wantHP := 1000 - wantDealt
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > 1e-6 {
		t.Fatalf("hp=%v want %v", done.Summary.TargetFinalHp, wantHP)
	}
}

func TestGenericRunGuinsooKDoesNotCopyHealShieldState(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureGuinsooKTypes(&compileReq)
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	four := 4.0
	healAmt := 25.0
	shieldAmt := 40.0
	copyDmg := 10.0
	one := 1.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:   "state_change",
			Target:      "source",
			Ref:         guinsooStackKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &four},
		},
		{Operation: "emit_event", Target: "target", EventType: guinsooKHitEvent, Ref: guinsooKHitEvent},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "mixed_ops",
			EventMatcher: model.TypeMatcher{Any: []string{guinsooKHitEvent}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/true",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyDmg},
					CopyableOnHit: true,
				},
				{
					Operation: "heal",
					Target:    "source",
					Amount:    &model.GenericFormulaExpr{Op: "const", Value: &healAmt},
				},
				{
					Operation: "shield",
					Target:    "source",
					Amount:    &model.GenericFormulaExpr{Op: "const", Value: &shieldAmt},
				},
				{
					Operation:   "state_change",
					Target:      "source",
					Ref:         guinsooStackKey,
					Types:       []string{"state_scope/provider"},
					ValuePolicy: "add",
					Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				},
			},
		},
		guinsooKRepeatListener("phantom"),
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: 500, Current: 500, Max: 1000, Resolved: 500,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 1000, Current: 1000, Max: 1000, Resolved: 1000,
	})
	runReq.StopPolicy.DurationMs = 100
	done := runGuinsooK(t, compileReq, runReq)

	if math.Abs(done.Summary.SourceDamageDealt-20) > 1e-6 {
		t.Fatalf("dealt=%v want 20 (damage+phantom only)", done.Summary.SourceDamageDealt)
	}
	if math.Abs(done.Summary.TargetFinalHp-980) > 1e-6 {
		t.Fatalf("targetHp=%v want 980", done.Summary.TargetFinalHp)
	}
	if math.Abs(done.Summary.SourceFinalHp-(500+healAmt)) > 1e-6 {
		t.Fatalf("sourceHp=%v want %v (heal not phantom-copied)", done.Summary.SourceFinalHp, 500+healAmt)
	}
	state := sourceProviderState(t, done.FinalSnapshot, guinsooProviderRef)["state"].(map[string]interface{})
	if stacks, _ := state[guinsooStackKey].(float64); stacks != 4 {
		t.Fatalf("stacks=%v want 4 capped (phantom must not re-run state_change)", stacks)
	}
	var sourceSnap model.CombatantSnapshot
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key == model.SelectorSource {
			sourceSnap = c
		}
	}
	if len(sourceSnap.Shields) != 1 {
		t.Fatalf("shields=%d want 1 (shield not phantom-copied)", len(sourceSnap.Shields))
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

func evidenceDataBool(data map[string]interface{}, key string) bool {
	v, _ := data[key].(bool)
	return v
}

func evidenceDataString(data map[string]interface{}, key string) string {
	v, _ := data[key].(string)
	return v
}

func evidenceDataFloat(data map[string]interface{}, key string) float64 {
	v, _ := data[key].(float64)
	return v
}

func evidenceDataMap(data map[string]interface{}, key string) map[string]interface{} {
	v, _ := data[key].(map[string]interface{})
	return v
}

func sumDamageEvidenceMitigated(items []model.EvidenceItem, phase string) float64 {
	var sum float64
	for _, item := range items {
		if evidenceDataString(item.Data, "phase") != phase {
			continue
		}
		if evidenceDataString(item.Data, "source") != model.SelectorSource {
			continue
		}
		sum += evidenceDataFloat(item.Data, "mitigatedAmount")
	}
	return sum
}

// TestGenericRunDamageEvidenceOriginalMatchesSummary original damage evidence 与 summary 共用 resolver 结算。
func TestGenericRunDamageEvidenceOriginalMatchesSummary(t *testing.T) {
	listeners := []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true),
	}
	compileReq, runReq := loadGuinsooKFixture(t, listeners, nil, 2)
	abilityRef := "source.provider[" + guinsooProviderRef + "].ability[" + guinsooHitAbility + "]"
	done := runGuinsooK(t, compileReq, runReq)

	items := damageEvidenceItems(done)
	if len(items) == 0 {
		t.Fatal("expected damage evidence")
	}
	var aaOriginal, onHitOriginal int
	var aaMitigated, onHitMitigated float64
	for _, item := range items {
		if evidenceDataBool(item.Data, "phantom") || evidenceDataString(item.Data, "phase") != "original" {
			t.Fatalf("unexpected phantom/phase in no-repeat run: %+v", item.Data)
		}
		if evidenceDataString(item.Data, "source") != model.SelectorSource ||
			evidenceDataString(item.Data, "target") != model.SelectorTarget {
			t.Fatalf("source/target mismatch: %+v", item.Data)
		}
		switch evidenceDataString(item.Data, "damageType") {
		case "damage/physical":
			aaOriginal++
			if evidenceDataFloat(item.Data, "rawAmount") != guinsooKAAAmt {
				t.Fatalf("aa rawAmount=%v want %v", evidenceDataFloat(item.Data, "rawAmount"), guinsooKAAAmt)
			}
			aaMitigated += evidenceDataFloat(item.Data, "mitigatedAmount")
			if evidenceDataString(item.Data, "providerRef") != guinsooProviderRef {
				t.Fatalf("aa providerRef=%q want %q", evidenceDataString(item.Data, "providerRef"), guinsooProviderRef)
			}
			if evidenceDataString(item.Data, "abilityRef") != abilityRef {
				t.Fatalf("aa abilityRef=%q want %q", evidenceDataString(item.Data, "abilityRef"), abilityRef)
			}
		case "damage/magic":
			onHitOriginal++
			if evidenceDataFloat(item.Data, "rawAmount") != guinsooKCopyableAmt {
				t.Fatalf("on-hit rawAmount=%v want %v", evidenceDataFloat(item.Data, "rawAmount"), guinsooKCopyableAmt)
			}
			onHitMitigated += evidenceDataFloat(item.Data, "mitigatedAmount")
			if evidenceDataString(item.Data, "providerRef") != guinsooProviderRef {
				t.Fatalf("on-hit providerRef=%q", evidenceDataString(item.Data, "providerRef"))
			}
			if evidenceDataString(item.Data, "abilityRef") != "listener:guinsoo_wrath" {
				t.Fatalf("on-hit abilityRef=%q want listener:guinsoo_wrath", evidenceDataString(item.Data, "abilityRef"))
			}
		default:
			t.Fatalf("unexpected damageType: %+v", item.Data)
		}
	}
	if aaOriginal != 2 || onHitOriginal != 2 {
		t.Fatalf("original counts aa=%d onHit=%d want 2,2", aaOriginal, onHitOriginal)
	}
	wantDealt := aaMitigated + onHitMitigated
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("summary dealt=%v evidence sum mitigated=%v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if done.Evidence.CountsByKind[string(model.EvidenceKindDamage)] != len(items) {
		t.Fatalf("countsByKind damage=%d items=%d", done.Evidence.CountsByKind[string(model.EvidenceKindDamage)], len(items))
	}
}

// TestGenericRunDamageEvidencePhantomFields phantom evidence 含 phase/phantom/repeatTag/replayedFrom，raw/mitigated 正确。
func TestGenericRunDamageEvidencePhantomFields(t *testing.T) {
	armor := 100.0
	listeners := []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_wrath",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/physical",
					Amount:        guinsooKConst(100),
					CopyableOnHit: true,
					Ref:           "op:guinsoo_copyable",
				},
			},
		},
		guinsooKRepeatListener("guinsoo_phantom"),
	}
	compileReq, runReq := loadGuinsooKFixture(t, listeners, nil, 4)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: armor, Current: armor, Max: armor, Resolved: armor,
	})
	done := runGuinsooK(t, compileReq, runReq)

	wantMitigated := expectedMitigatedPhysical(100, armor)
	var phantoms []model.EvidenceItem
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") || evidenceDataString(item.Data, "phase") == "phantom" {
			phantoms = append(phantoms, item)
		}
	}
	if len(phantoms) != 1 {
		t.Fatalf("phantom evidence count=%d want 1", len(phantoms))
	}
	p := phantoms[0].Data
	if evidenceDataString(p, "phase") != "phantom" || !evidenceDataBool(p, "phantom") {
		t.Fatalf("phase/phantom=%v/%v", evidenceDataString(p, "phase"), evidenceDataBool(p, "phantom"))
	}
	if evidenceDataString(p, "repeatTag") != "phantom_hit" {
		t.Fatalf("repeatTag=%q want phantom_hit", evidenceDataString(p, "repeatTag"))
	}
	if math.Abs(evidenceDataFloat(p, "rawAmount")-100) > 1e-6 {
		t.Fatalf("rawAmount=%v want 100", evidenceDataFloat(p, "rawAmount"))
	}
	if math.Abs(evidenceDataFloat(p, "mitigatedAmount")-wantMitigated) > 1e-6 {
		t.Fatalf("mitigatedAmount=%v want %v", evidenceDataFloat(p, "mitigatedAmount"), wantMitigated)
	}
	if evidenceDataString(p, "operationRef") != "op:guinsoo_copyable" {
		t.Fatalf("operationRef=%q", evidenceDataString(p, "operationRef"))
	}
	from := evidenceDataMap(p, "replayedFrom")
	if evidenceDataString(from, "providerRef") != guinsooProviderRef {
		t.Fatalf("replayedFrom.providerRef=%q", evidenceDataString(from, "providerRef"))
	}
	if evidenceDataString(from, "abilityRef") != "listener:guinsoo_wrath" {
		t.Fatalf("replayedFrom.abilityRef=%q", evidenceDataString(from, "abilityRef"))
	}
	if evidenceDataString(from, "operationRef") != "op:guinsoo_copyable" {
		t.Fatalf("replayedFrom.operationRef=%q", evidenceDataString(from, "operationRef"))
	}

	origSum := sumDamageEvidenceMitigated(damageEvidenceItems(done), "original")
	phantSum := sumDamageEvidenceMitigated(damageEvidenceItems(done), "phantom")
	if math.Abs(done.Summary.SourceDamageDealt-(origSum+phantSum)) > 1e-6 {
		t.Fatalf("summary=%v original+phantom evidence=%v+%v", done.Summary.SourceDamageDealt, origSum, phantSum)
	}
}

// TestGenericRunDamageEvidenceReplayedFromStableAcrossProviders 跨 provider replayedFrom 稳定且顺序无关。
func TestGenericRunDamageEvidenceReplayedFromStableAcrossProviders(t *testing.T) {
	collect := func(t *testing.T, otherFirst bool) (dealt float64, fromKeys []string) {
		t.Helper()
		guinsooListeners := []model.ListenerDefinition{
			{
				ListenerKey:  "guinsoo_wrath",
				EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
				Operations: []model.OperationDefinition{{
					Operation: "damage", Target: "target", DamageType: "damage/magic",
					Amount: guinsooKConst(guinsooKCopyableAmt), CopyableOnHit: true, Ref: "op:guinsoo",
				}},
			},
			guinsooKRepeatListener("guinsoo_phantom"),
		}
		otherListeners := []model.ListenerDefinition{{
			ListenerKey:  "other_wrath",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation: "damage", Target: "target", DamageType: "damage/magic",
				Amount: guinsooKConst(guinsooKOtherAmt), CopyableOnHit: true, Ref: "op:other",
			}},
		}}
		compileReq, runReq := loadGuinsooKFixture(t, guinsooListeners, nil, 4)
		if otherFirst {
			compileReq.Combatants[0].Providers = nil
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorSource {
					runReq.InitialSnapshot.Combatants[i].Providers = nil
				}
			}
			mountGuinsooKOtherProvider(&compileReq, &runReq, otherListeners)
			compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
				ProviderRef: guinsooProviderRef, DefinitionRef: guinsooProviderRef,
			})
			for i := range runReq.InitialSnapshot.Combatants {
				if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
					continue
				}
				runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
					ProviderRef: guinsooProviderRef, DefinitionRef: guinsooProviderRef, Stacks: 1, State: map[string]interface{}{},
				})
			}
		} else {
			mountGuinsooKOtherProvider(&compileReq, &runReq, otherListeners)
		}
		done := runGuinsooK(t, compileReq, runReq)
		for _, item := range damageEvidenceItems(done) {
			if !evidenceDataBool(item.Data, "phantom") {
				continue
			}
			from := evidenceDataMap(item.Data, "replayedFrom")
			key := evidenceDataString(from, "providerRef") + "|" +
				evidenceDataString(from, "abilityRef") + "|" +
				evidenceDataString(from, "operationRef")
			fromKeys = append(fromKeys, key)
		}
		return done.Summary.SourceDamageDealt, fromKeys
	}

	dealtA, keysA := collect(t, false)
	dealtB, keysB := collect(t, true)
	if math.Abs(dealtA-dealtB) > 1e-6 {
		t.Fatalf("dealt unstable: %v vs %v", dealtA, dealtB)
	}
	wantKeys := []string{
		guinsooProviderRef + "|listener:guinsoo_wrath|op:guinsoo",
		guinsooKOtherProvider + "|listener:other_wrath|op:other",
	}
	if len(keysA) != 2 || len(keysB) != 2 {
		t.Fatalf("phantom replayedFrom counts=%d,%d want 2,2; A=%v B=%v", len(keysA), len(keysB), keysA, keysB)
	}
	for i := range wantKeys {
		if keysA[i] != wantKeys[i] || keysB[i] != wantKeys[i] {
			t.Fatalf("replayedFrom order mountNormal=%v mountOtherFirst=%v want %v", keysA, keysB, wantKeys)
		}
	}
}

// TestGenericRunDamageEvidencePhantomNoCastAttempt phantom 增加 damage summary，不增加 ability attempt/cast。
func TestGenericRunDamageEvidencePhantomNoCastAttempt(t *testing.T) {
	listeners := []model.ListenerDefinition{
		guinsooKCopyableListener("guinsoo_wrath", guinsooKCopyableAmt, true),
		guinsooKRepeatListener("guinsoo_phantom"),
	}
	compileReq, runReq := loadGuinsooKFixture(t, listeners, nil, 4)
	done := runGuinsooK(t, compileReq, runReq)

	wantDealt := guinsooKAAAmt*4 + guinsooKCopyableAmt*4 + guinsooKCopyableAmt
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if done.Summary.AbilityAttemptCount != 4 {
		t.Fatalf("abilityAttemptCount=%d want 4", done.Summary.AbilityAttemptCount)
	}
	if done.Summary.AbilityCastCount != 4 {
		t.Fatalf("abilityCastCount=%d want 4 (phantom must not cast)", done.Summary.AbilityCastCount)
	}
	phantoms := 0
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") {
			phantoms++
		}
	}
	if phantoms != 1 {
		t.Fatalf("phantom evidence=%d want 1", phantoms)
	}
	if emittedOnHitCount(done) != 4 {
		t.Fatalf("emitted on_hit=%d want 4 (phantom must not emit)", emittedOnHitCount(done))
	}
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
	done := state.buildDoneResult()
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
