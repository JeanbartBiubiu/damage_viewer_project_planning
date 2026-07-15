package runtime

import (
	"encoding/json"
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	blackCleaverProviderRef   = "provider_item_3071_black_cleaver_carve"
	blackCleaverListenerKey   = "listener_item_3071_carve"
	blackCleaverCarveKey      = "carve_stacks"
	blackCleaverAAAbility     = "basic_attack"
	blackCleaverAADamage      = 100.0
	blackCleaverArmorStart    = 100.0
	blackCleaverShredPerStack = 0.06
	blackCleaverMaxStacks     = 5.0
	blackCleaverDurationMs    = int64(6000)
	blackCleaverHP            = 100000.0
)

func ensureLinkedEffectsTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: "damage/true", Domain: "damage"},
		{Key: eventTypeDamageDealt, Domain: "event"},
		{Key: eventTypeDamageDealtPhysical, Domain: "event"},
		{Key: eventTypeDamageDealtBasicAttack, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "event/source_opponent", Domain: "event"},
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

func blackCleaverCarveSchema() map[string]interface{} {
	return map[string]interface{}{
		blackCleaverCarveKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      blackCleaverMaxStacks,
			"durationMs":    float64(blackCleaverDurationMs),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func blackCleaverArmorModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: "black_cleaver_carve_armor",
		Kind:        "attribute",
		Target:      "opponent.attr.armor",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(-blackCleaverShredPerStack),
				{Op: "read", Path: "provider.target_state." + blackCleaverCarveKey},
			},
		},
	}
}

func blackCleaverCarveListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey: blackCleaverListenerKey,
		EventMatcher: model.TypeMatcher{All: []string{
			eventTypeDamageDealt,
			eventTypeDamageDealtPhysical,
			"event/source_owner",
		}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         blackCleaverCarveKey,
				Types:       []string{"state_scope/provider_target"},
				ValuePolicy: "add",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func blackCleaverProviderDef(extraListeners []model.ListenerDefinition, abilities []model.AbilityDefinition) model.ProviderDefinition {
	listeners := []model.ListenerDefinition{blackCleaverCarveListener()}
	listeners = append(listeners, extraListeners...)
	return model.ProviderDefinition{
		ProviderKey:        blackCleaverProviderRef,
		Kind:               "item",
		StableID:           "3071_black_cleaver_carve",
		InitialStateSchema: blackCleaverCarveSchema(),
		Modifiers:          []model.ModifierDefinition{blackCleaverArmorModifier()},
		Listeners:          listeners,
		Abilities:          abilities,
	}
}

func mountBlackCleaverOn(compileReq *model.CompileRequest, runReq *model.RunRequest, ownerKey string, provider model.ProviderDefinition) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, provider)
	mount := model.CombatantProviderMount{ProviderRef: blackCleaverProviderRef, DefinitionRef: blackCleaverProviderRef}
	snap := model.CombatantProviderSnapshot{
		ProviderRef: blackCleaverProviderRef, DefinitionRef: blackCleaverProviderRef, Stacks: 1, State: map[string]interface{}{},
	}
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key == ownerKey {
			compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, mount)
		}
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == ownerKey {
			runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, snap)
		}
	}
}

func linkedEffectsAAOps(damage float64, refs ...string) []model.OperationDefinition {
	opRef := "op:aa"
	if len(refs) > 0 && refs[0] != "" {
		opRef = refs[0]
	}
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &damage},
			Ref:        opRef,
		},
	}
}

func configureLinkedEffectsChampionAA(compileReq *model.CompileRequest, ops []model.OperationDefinition, types []string) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: blackCleaverAAAbility,
			Kind:       "active",
			Types:      types,
			Operations: ops,
		},
	}
}

func linkedEffectsAARef() string {
	return "source.provider[champion:source_demo].ability[" + blackCleaverAAAbility + "]"
}

func armorAfterCarveStacks(stacks float64) float64 {
	return blackCleaverArmorStart * (1.0 - blackCleaverShredPerStack*stacks)
}

func loadLinkedEffectsFixture(t *testing.T, hits int, opts ...func(*model.CompileRequest, *model.RunRequest)) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureLinkedEffectsTypes(&compileReq)
	configureLinkedEffectsChampionAA(&compileReq, linkedEffectsAAOps(blackCleaverAADamage), []string{"ability/basic_attack"})
	mountBlackCleaverOn(&compileReq, &runReq, model.SelectorSource, blackCleaverProviderDef(nil, nil))
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: blackCleaverHP, Current: blackCleaverHP, Max: blackCleaverHP, Resolved: blackCleaverHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: blackCleaverArmorStart, Current: blackCleaverArmorStart, Max: blackCleaverArmorStart, Resolved: blackCleaverArmorStart,
	})
	for _, opt := range opts {
		opt(&compileReq, &runReq)
	}
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "bc_hit_" + itoaRuntime(i),
			AbilityRef: linkedEffectsAARef(),
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

func runLinkedEffects(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func combatantAttrResolved(t *testing.T, snap model.Snapshot, key, attr string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != key {
			continue
		}
		slot, ok := c.Attributes[attr]
		if !ok {
			t.Fatalf("combatant %s missing attr %s", key, attr)
		}
		return slot.Resolved
	}
	t.Fatalf("combatant %s missing", key)
	return 0
}

func carveStacksFromSnapshot(t *testing.T, snap model.Snapshot, ownerKey, providerRef string) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != ownerKey {
			continue
		}
		bag, ok := c.ProviderState[providerRef].(map[string]interface{})
		if !ok {
			return 0
		}
		ts, ok := bag["targetState"].(map[string]interface{})
		if !ok {
			return 0
		}
		values, ok := ts["values"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := values[blackCleaverCarveKey].(float64)
		return v
	}
	t.Fatalf("combatant %s missing", ownerKey)
	return 0
}

func damageDealtEmittedEvidence(done model.DoneResult) []model.EvidenceItem {
	out := make([]model.EvidenceItem, 0)
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == eventTypeDamageDealt {
			out = append(out, item)
		}
	}
	return out
}

func operationRefsFromEvidence(data map[string]interface{}) []string {
	if raw, ok := data["operationRefs"].([]string); ok {
		return append([]string(nil), raw...)
	}
	if raw, ok := data["operationRefs"].([]interface{}); ok {
		out := make([]string, 0, len(raw))
		for _, v := range raw {
			s, _ := v.(string)
			out = append(out, s)
		}
		return out
	}
	if s, ok := data["operationRef"].(string); ok && s != "" {
		return []string{s}
	}
	return nil
}

func unmountBlackCleaver(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = compileReq.SharedProviders[:1]
	for i := range compileReq.Combatants {
		kept := make([]model.CombatantProviderMount, 0, len(compileReq.Combatants[i].Providers))
		for _, p := range compileReq.Combatants[i].Providers {
			if p.ProviderRef != blackCleaverProviderRef {
				kept = append(kept, p)
			}
		}
		compileReq.Combatants[i].Providers = kept
	}
	for i := range runReq.InitialSnapshot.Combatants {
		kept := make([]model.CombatantProviderSnapshot, 0, len(runReq.InitialSnapshot.Combatants[i].Providers))
		for _, p := range runReq.InitialSnapshot.Combatants[i].Providers {
			if p.ProviderRef != blackCleaverProviderRef {
				kept = append(kept, p)
			}
		}
		runReq.InitialSnapshot.Combatants[i].Providers = kept
	}
}

// TestGenericLinkedEffectsBlackCleaverFirstHitShredAfterDamage: 第一击按 armor=100 结算，叠层在伤害之后。
func TestGenericLinkedEffectsBlackCleaverFirstHitShredAfterDamage(t *testing.T) {
	c, r := loadLinkedEffectsFixture(t, 1)
	done := runLinkedEffects(t, c, r)

	wantMitigated := expectedMitigatedPhysical(blackCleaverAADamage, blackCleaverArmorStart) // 50
	if math.Abs(done.Summary.SourceDamageDealt-wantMitigated) > 1e-9 {
		t.Fatalf("sourceDamageDealt=%v want %v (first hit uses armor 100, not post-shred)", done.Summary.SourceDamageDealt, wantMitigated)
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("armor=%v want %v", armor, armorAfterCarveStacks(1))
	}
	stacks := carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef)
	if stacks != 1 {
		t.Fatalf("carve_stacks=%v want 1", stacks)
	}
}

// TestGenericLinkedEffectsBlackCleaverFifthHitCap: 5 层后护甲 70；第 6 击仍刷新但不超过 5。
func TestGenericLinkedEffectsBlackCleaverFifthHitCap(t *testing.T) {
	c5, r5 := loadLinkedEffectsFixture(t, 5)
	done5 := runLinkedEffects(t, c5, r5)
	armor5 := combatantAttrResolved(t, done5.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor5-70) > 1e-9 {
		t.Fatalf("after 5 hits armor=%v want 70", armor5)
	}
	stacks5 := carveStacksFromSnapshot(t, done5.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef)
	if stacks5 != 5 {
		t.Fatalf("after 5 hits carve_stacks=%v want 5", stacks5)
	}

	c6, r6 := loadLinkedEffectsFixture(t, 6)
	done6 := runLinkedEffects(t, c6, r6)
	armor6 := combatantAttrResolved(t, done6.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor6-70) > 1e-9 {
		t.Fatalf("after 6 hits armor=%v want 70 (refresh at cap)", armor6)
	}
	stacks6 := carveStacksFromSnapshot(t, done6.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef)
	if stacks6 != 5 {
		t.Fatalf("after 6 hits carve_stacks=%v want 5", stacks6)
	}

	// Hits 1..6 mitigate with armor 100,94,88,82,76,70.
	var want float64
	for i := 0; i < 6; i++ {
		want += expectedMitigatedPhysical(blackCleaverAADamage, armorAfterCarveStacks(float64(i)))
	}
	if math.Abs(done6.Summary.SourceDamageDealt-want) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done6.Summary.SourceDamageDealt, want)
	}
}

// TestGenericLinkedEffectsBlackCleaverExpiryRestoresArmor: +5999 仍 70；+6000 到期回 100（无需再施法）。
func TestGenericLinkedEffectsBlackCleaverExpiryRestoresArmor(t *testing.T) {
	lastHit := int64(400) // 5 hits at 0..400

	c, r := loadLinkedEffectsFixture(t, 5)
	r.StopPolicy.DurationMs = lastHit + blackCleaverDurationMs - 1 // +5999 from last hit
	doneStay := runLinkedEffects(t, c, r)
	if math.Abs(combatantAttrResolved(t, doneStay.FinalSnapshot, model.SelectorTarget, "armor")-70) > 1e-9 {
		t.Fatalf("+5999 armor=%v want 70", combatantAttrResolved(t, doneStay.FinalSnapshot, model.SelectorTarget, "armor"))
	}
	if carveStacksFromSnapshot(t, doneStay.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 5 {
		t.Fatalf("+5999 stacks want 5")
	}

	c2, r2 := loadLinkedEffectsFixture(t, 5)
	r2.StopPolicy.DurationMs = lastHit + blackCleaverDurationMs // exact +6000 expiry
	doneExp := runLinkedEffects(t, c2, r2)
	armor := combatantAttrResolved(t, doneExp.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-blackCleaverArmorStart) > 1e-9 {
		t.Fatalf("after expiry armor=%v want %v", armor, blackCleaverArmorStart)
	}
	if carveStacksFromSnapshot(t, doneExp.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 0 {
		t.Fatalf("after expiry stacks want 0")
	}
}

// TestGenericLinkedEffectsDamageDealtEmittedEventFields: 自动 emitted_event 字段与 provenance。
func TestGenericLinkedEffectsDamageDealtEmittedEventFields(t *testing.T) {
	c, r := loadLinkedEffectsFixture(t, 2)
	done := runLinkedEffects(t, c, r)
	items := damageDealtEmittedEvidence(done)
	if len(items) != 2 {
		t.Fatalf("damage_dealt emits=%d want 2", len(items))
	}
	first := items[0]
	if evidenceDataString(first.Data, "source") != model.SelectorSource {
		t.Fatalf("source=%q", evidenceDataString(first.Data, "source"))
	}
	if evidenceDataString(first.Data, "target") != model.SelectorTarget {
		t.Fatalf("target=%q", evidenceDataString(first.Data, "target"))
	}
	if evidenceDataString(first.Data, "eventType") != eventTypeDamageDealt {
		t.Fatalf("eventType=%q", evidenceDataString(first.Data, "eventType"))
	}
	if evidenceDataString(first.Data, "damageType") != damageTypePhysical {
		t.Fatalf("damageType=%q", evidenceDataString(first.Data, "damageType"))
	}
	if evidenceDataString(first.Data, "abilityRef") != linkedEffectsAARef() {
		t.Fatalf("abilityRef=%q want %q", evidenceDataString(first.Data, "abilityRef"), linkedEffectsAARef())
	}
	if evidenceDataBool(first.Data, "phantom") {
		t.Fatal("phantom want false")
	}
	wantMitigated := expectedMitigatedPhysical(blackCleaverAADamage, blackCleaverArmorStart)
	if math.Abs(evidenceDataFloat(first.Data, "rawAmount")-blackCleaverAADamage) > 1e-9 {
		t.Fatalf("rawAmount=%v want %v", evidenceDataFloat(first.Data, "rawAmount"), blackCleaverAADamage)
	}
	if math.Abs(evidenceDataFloat(first.Data, "mitigatedAmount")-wantMitigated) > 1e-9 {
		t.Fatalf("mitigatedAmount=%v want %v", evidenceDataFloat(first.Data, "mitigatedAmount"), wantMitigated)
	}
	if evidenceDataString(first.Data, "operationRef") != "op:aa" {
		t.Fatalf("operationRef=%q want op:aa", evidenceDataString(first.Data, "operationRef"))
	}
	if _, has := first.Data["operationRefs"]; has {
		t.Fatal("single-op emit must not set operationRefs")
	}
}

// TestGenericLinkedEffectsTwoPhysicalOpsOneEmit: 同一 frame 两 physical ops → 1 emit、1 层、聚合金额。
func TestGenericLinkedEffectsTwoPhysicalOpsOneEmit(t *testing.T) {
	d1, d2 := 60.0, 40.0
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, _ *model.RunRequest) {
		configureLinkedEffectsChampionAA(compileReq, []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &d1},
				Ref:        "op:aa_a",
			},
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &d2},
				Ref:        "op:aa_b",
			},
		}, []string{"ability/basic_attack"})
	})
	done := runLinkedEffects(t, c, r)

	wantMitigated := expectedMitigatedPhysical(d1, blackCleaverArmorStart) + expectedMitigatedPhysical(d2, blackCleaverArmorStart)
	if math.Abs(done.Summary.SourceDamageDealt-wantMitigated) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v (both ops in summary)", done.Summary.SourceDamageDealt, wantMitigated)
	}
	items := damageDealtEmittedEvidence(done)
	if len(items) != 1 {
		t.Fatalf("damage_dealt emits=%d want 1", len(items))
	}
	if math.Abs(evidenceDataFloat(items[0].Data, "rawAmount")-(d1+d2)) > 1e-9 {
		t.Fatalf("rawAmount=%v want %v", evidenceDataFloat(items[0].Data, "rawAmount"), d1+d2)
	}
	if math.Abs(evidenceDataFloat(items[0].Data, "mitigatedAmount")-wantMitigated) > 1e-6 {
		t.Fatalf("mitigatedAmount=%v want %v", evidenceDataFloat(items[0].Data, "mitigatedAmount"), wantMitigated)
	}
	refs := operationRefsFromEvidence(items[0].Data)
	if len(refs) != 2 || refs[0] != "op:aa_a" || refs[1] != "op:aa_b" {
		t.Fatalf("operationRefs=%v want [op:aa_a op:aa_b]", refs)
	}
	if _, has := items[0].Data["operationRef"]; has {
		t.Fatal("multi-op emit must not set single operationRef")
	}
	stacks := carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef)
	if stacks != 1 {
		t.Fatalf("carve_stacks=%v want 1", stacks)
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("armor=%v want %v", armor, armorAfterCarveStacks(1))
	}
}

// TestGenericLinkedEffectsMagicOnlyBasicAttackNoSynthesis: magic-only 普攻不合成、不叠层。
func TestGenericLinkedEffectsMagicOnlyBasicAttackNoSynthesis(t *testing.T) {
	magic := blackCleaverAADamage
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, _ *model.RunRequest) {
		configureLinkedEffectsChampionAA(compileReq, []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/magic",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &magic},
				Ref:        "op:aa_magic",
			},
		}, []string{"ability/basic_attack"})
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 0 {
		t.Fatalf("damage_dealt emits=%d want 0", len(damageDealtEmittedEvidence(done)))
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 0 {
		t.Fatalf("carve_stacks want 0")
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-blackCleaverArmorStart) > 1e-9 {
		t.Fatalf("armor=%v want unchanged %v", armor, blackCleaverArmorStart)
	}
}

// TestGenericLinkedEffectsNonBasicAbilityPhysicalSynthesizes: 非 basic physical 也合成并叠层，但不标 basic_attack。
func TestGenericLinkedEffectsNonBasicAbilityPhysicalSynthesizes(t *testing.T) {
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, _ *model.RunRequest) {
		configureLinkedEffectsChampionAA(compileReq, linkedEffectsAAOps(blackCleaverAADamage), nil)
	})
	done := runLinkedEffects(t, c, r)
	items := damageDealtEmittedEvidence(done)
	if len(items) != 1 {
		t.Fatalf("damage_dealt emits=%d want 1", len(items))
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 1 {
		t.Fatalf("carve_stacks want 1")
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("armor=%v want %v", armor, armorAfterCarveStacks(1))
	}
	want := expectedMitigatedPhysical(blackCleaverAADamage, blackCleaverArmorStart)
	if math.Abs(done.Summary.SourceDamageDealt-want) > 1e-9 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, want)
	}
}

// TestGenericLinkedEffectsZeroMitigatedNoSynthesis: result.Amount==0 的 physical 不合成。
func TestGenericLinkedEffectsZeroMitigatedNoSynthesis(t *testing.T) {
	zero := 0.0
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, _ *model.RunRequest) {
		configureLinkedEffectsChampionAA(compileReq, []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Ref:        "op:aa_zero",
			},
		}, []string{"ability/basic_attack"})
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 0 {
		t.Fatalf("damage_dealt emits=%d want 0", len(damageDealtEmittedEvidence(done)))
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 0 {
		t.Fatalf("carve_stacks want 0")
	}
	if done.Summary.SourceDamageDealt != 0 {
		t.Fatalf("dealt=%v want 0", done.Summary.SourceDamageDealt)
	}
}

// TestGenericLinkedEffectsMissingCatalogQualifierFailsClosed: 缺 event/damage_dealt/physical 时 fail closed。
func TestGenericLinkedEffectsMissingCatalogQualifierFailsClosed(t *testing.T) {
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, runReq *model.RunRequest) {
		unmountBlackCleaver(compileReq, runReq)
		filtered := make([]model.TypeCatalogEntry, 0, len(compileReq.TypeCatalog.Types))
		for _, entry := range compileReq.TypeCatalog.Types {
			if entry.Key == eventTypeDamageDealtPhysical {
				continue
			}
			filtered = append(filtered, entry)
		}
		compileReq.TypeCatalog.Types = filtered
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 0 {
		t.Fatalf("damage_dealt emits=%d want 0 (fail closed)", len(damageDealtEmittedEvidence(done)))
	}
	want := expectedMitigatedPhysical(blackCleaverAADamage, blackCleaverArmorStart)
	if math.Abs(done.Summary.SourceDamageDealt-want) > 1e-9 {
		t.Fatalf("dealt=%v want %v (damage still applies)", done.Summary.SourceDamageDealt, want)
	}
}

// TestGenericLinkedEffectsTargetMountedListenerIgnored: target 侧黑切依赖 source_owner，不误触发。
func TestGenericLinkedEffectsTargetMountedListenerIgnored(t *testing.T) {
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, runReq *model.RunRequest) {
		unmountBlackCleaver(compileReq, runReq)
		mountBlackCleaverOn(compileReq, runReq, model.SelectorTarget, blackCleaverProviderDef(nil, nil))
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 1 {
		t.Fatalf("damage_dealt emits=%d want 1 (event still synthesized)", len(damageDealtEmittedEvidence(done)))
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorTarget, blackCleaverProviderRef) != 0 {
		t.Fatalf("target-owned carve_stacks want 0")
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-blackCleaverArmorStart) > 1e-9 {
		t.Fatalf("armor=%v want unchanged (target listener ignored)", armor)
	}
}

// TestGenericLinkedEffectsTwoSidedSameProviderRefIsolation: 两侧同 providerRef 互不卸、互不读错 bag。
func TestGenericLinkedEffectsTwoSidedSameProviderRefIsolation(t *testing.T) {
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, runReq *model.RunRequest) {
		// Keep source BC; also mount identical providerRef on target.
		mount := model.CombatantProviderMount{ProviderRef: blackCleaverProviderRef, DefinitionRef: blackCleaverProviderRef}
		snap := model.CombatantProviderSnapshot{
			ProviderRef: blackCleaverProviderRef, DefinitionRef: blackCleaverProviderRef, Stacks: 1, State: map[string]interface{}{},
		}
		for i := range compileReq.Combatants {
			if compileReq.Combatants[i].Key == model.SelectorTarget {
				compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, mount)
			}
		}
		for i := range runReq.InitialSnapshot.Combatants {
			if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorTarget {
				runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, snap)
			}
		}
	})
	done := runLinkedEffects(t, c, r)
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 1 {
		t.Fatalf("source stacks want 1")
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorTarget, blackCleaverProviderRef) != 0 {
		t.Fatalf("target stacks want 0 (source_owner gated)")
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("armor=%v want %v from source-owned modifier", armor, armorAfterCarveStacks(1))
	}
	// Target still has its provider mounted after source activity.
	for _, comb := range done.FinalSnapshot.Combatants {
		if comb.Key != model.SelectorTarget {
			continue
		}
		found := false
		for _, p := range comb.Providers {
			if p.ProviderRef == blackCleaverProviderRef {
				found = true
			}
		}
		if !found {
			t.Fatal("target-owned same providerRef must remain mounted")
		}
	}
}

// TestGenericLinkedEffectsListenerChildNoRecursion: listener child physical damage 不递归合成。
func TestGenericLinkedEffectsListenerChildNoRecursion(t *testing.T) {
	childAmt := 25.0
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, runReq *model.RunRequest) {
		unmountBlackCleaver(compileReq, runReq)
		childListener := model.ListenerDefinition{
			ListenerKey: "listener_child_physical",
			EventMatcher: model.TypeMatcher{All: []string{
				eventTypeDamageDealt,
				eventTypeDamageDealtPhysical,
				"event/source_owner",
			}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/physical",
					Amount:     &model.GenericFormulaExpr{Op: "const", Value: &childAmt},
					Ref:        "op:child_physical",
				},
			},
		}
		mountBlackCleaverOn(compileReq, runReq, model.SelectorSource, blackCleaverProviderDef(
			[]model.ListenerDefinition{childListener}, nil,
		))
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 1 {
		t.Fatalf("damage_dealt emits=%d want 1 (no recursion)", len(damageDealtEmittedEvidence(done)))
	}
	stacks := carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef)
	if stacks != 1 {
		t.Fatalf("carve_stacks=%v want 1", stacks)
	}
	want := expectedMitigatedPhysical(blackCleaverAADamage, blackCleaverArmorStart) +
		expectedMitigatedPhysical(childAmt, armorAfterCarveStacks(1))
	if math.Abs(done.Summary.SourceDamageDealt-want) > 1e-6 {
		t.Fatalf("dealt=%v want %v", done.Summary.SourceDamageDealt, want)
	}
}

// TestGenericLinkedEffectsPhantomNoSynthesis: Guinsoo phantom 不合成 damage_dealt、不叠层。
func TestGenericLinkedEffectsPhantomNoSynthesis(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureLinkedEffectsTypes(&compileReq)
	ensureGuinsooKTypes(&compileReq)

	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[0].AbilityKey = guinsooHitAbility
	compileReq.SharedProviders[0].Abilities[0].Types = []string{"ability/basic_attack"}
	one := 1.0
	aa := blackCleaverAADamage
	copyable := 30.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        "op:aa",
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
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable_physical",
			EventMatcher: model.TypeMatcher{All: []string{guinsooKHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/physical",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyable},
					CopyableOnHit: true,
					Ref:           "op:guinsoo_phys",
				},
			},
		},
		guinsooKRepeatListener("guinsoo_phantom"),
	}
	mountBlackCleaverOn(&compileReq, &runReq, model.SelectorSource, blackCleaverProviderDef(nil, nil))
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: blackCleaverHP, Current: blackCleaverHP, Max: blackCleaverHP, Resolved: blackCleaverHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: blackCleaverArmorStart, Current: blackCleaverArmorStart, Max: blackCleaverArmorStart, Resolved: blackCleaverArmorStart,
	})

	abilityRef := "source.provider[" + guinsooProviderRef + "].ability[" + guinsooHitAbility + "]"
	hits := 4
	entries := make([]model.DriverEntry, 0, hits)
	for i := 0; i < hits; i++ {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "ph_hit_" + itoaRuntime(i),
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

	done := runLinkedEffects(t, compileReq, runReq)
	if got := len(damageDealtEmittedEvidence(done)); got != 4 {
		t.Fatalf("damage_dealt emits=%d want 4 (phantom must not synthesize)", got)
	}
	stacks := carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef)
	if stacks != 4 {
		t.Fatalf("carve_stacks=%v want 4 (phantom must not stack)", stacks)
	}
	phantoms := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindDamage {
			if evidenceDataBool(item.Data, "phantom") {
				phantoms++
			}
		}
	}
	if phantoms != 1 {
		t.Fatalf("phantom damage evidence=%d want 1", phantoms)
	}
}

// TestGenericLinkedEffectsMaxCommandsPerEvent: 单 command listener 下 MaxCommandsPerEvent=1 通过。
func TestGenericLinkedEffectsMaxCommandsPerEvent(t *testing.T) {
	cOK, rOK := loadLinkedEffectsFixture(t, 1)
	_ = runLinkedEffects(t, cOK, rOK)

	cOne, rOne := loadLinkedEffectsFixture(t, 1)
	rOne.SafetyBudget = &model.RunSafetyBudget{MaxCommandsPerEvent: 1}
	_ = runLinkedEffects(t, cOne, rOne)
}

// TestGenericLinkedEffectsDeterministic: 同输入重复运行 summary/evidence/finalSnapshot 一致。
func TestGenericLinkedEffectsDeterministic(t *testing.T) {
	runOnce := func() (string, string, string) {
		c, r := loadLinkedEffectsFixture(t, 3)
		done := runLinkedEffects(t, c, r)
		sum, err := json.Marshal(done.Summary)
		if err != nil {
			t.Fatal(err)
		}
		ev, err := json.Marshal(done.Evidence)
		if err != nil {
			t.Fatal(err)
		}
		snap, err := json.Marshal(done.FinalSnapshot)
		if err != nil {
			t.Fatal(err)
		}
		return string(sum), string(ev), string(snap)
	}
	s1, e1, f1 := runOnce()
	s2, e2, f2 := runOnce()
	if s1 != s2 {
		t.Fatal("summary unstable across runs")
	}
	if e1 != e2 {
		t.Fatal("evidence unstable across runs")
	}
	if f1 != f2 {
		t.Fatal("finalSnapshot unstable across runs")
	}
}

// TestGenericLinkedEffectsMissingOptionalBasicQualifierStillEmitsAndCarves: 缺 optional
// event/damage_dealt/basic_attack 时仍 emit 核心 physical 事件并叠 Carve。
func TestGenericLinkedEffectsMissingOptionalBasicQualifierStillEmitsAndCarves(t *testing.T) {
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, _ *model.RunRequest) {
		filtered := make([]model.TypeCatalogEntry, 0, len(compileReq.TypeCatalog.Types))
		for _, entry := range compileReq.TypeCatalog.Types {
			if entry.Key == eventTypeDamageDealtBasicAttack {
				continue
			}
			filtered = append(filtered, entry)
		}
		compileReq.TypeCatalog.Types = filtered
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 1 {
		t.Fatalf("damage_dealt emits=%d want 1 (core emit must not depend on optional basic qualifier)", len(damageDealtEmittedEvidence(done)))
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 1 {
		t.Fatalf("carve_stacks want 1")
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("armor=%v want %v", armor, armorAfterCarveStacks(1))
	}
}

// TestGenericLinkedEffectsNonBasicPhysicalSkipsBasicOnlyListener: 非 basic physical 合成核心
// 事件，但不匹配仅监听 basic_attack qualifier 的 listener。
func TestGenericLinkedEffectsNonBasicPhysicalSkipsBasicOnlyListener(t *testing.T) {
	one := 1.0
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, runReq *model.RunRequest) {
		unmountBlackCleaver(compileReq, runReq)
		basicOnly := model.ListenerDefinition{
			ListenerKey: "listener_basic_only_carve",
			EventMatcher: model.TypeMatcher{All: []string{
				eventTypeDamageDealt,
				eventTypeDamageDealtPhysical,
				eventTypeDamageDealtBasicAttack,
				"event/source_owner",
			}},
			Operations: []model.OperationDefinition{
				{
					Operation:   "state_change",
					Target:      "source",
					Ref:         blackCleaverCarveKey,
					Types:       []string{"state_scope/provider_target"},
					ValuePolicy: "add",
					Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				},
			},
		}
		prov := blackCleaverProviderDef(nil, nil)
		prov.Listeners = []model.ListenerDefinition{basicOnly}
		mountBlackCleaverOn(compileReq, runReq, model.SelectorSource, prov)
		configureLinkedEffectsChampionAA(compileReq, linkedEffectsAAOps(blackCleaverAADamage), nil)
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 1 {
		t.Fatalf("damage_dealt emits=%d want 1", len(damageDealtEmittedEvidence(done)))
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 0 {
		t.Fatalf("carve_stacks want 0 (basic-only listener must not match)")
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-blackCleaverArmorStart) > 1e-9 {
		t.Fatalf("armor=%v want unchanged", armor)
	}
}

// TestGenericLinkedEffectsTrueDamageNoSynthesisNoCarve: true damage 不合成、不叠层。
func TestGenericLinkedEffectsTrueDamageNoSynthesisNoCarve(t *testing.T) {
	amt := blackCleaverAADamage
	c, r := loadLinkedEffectsFixture(t, 1, func(compileReq *model.CompileRequest, _ *model.RunRequest) {
		configureLinkedEffectsChampionAA(compileReq, []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/true",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &amt},
				Ref:        "op:true",
			},
		}, []string{"ability/basic_attack"})
	})
	done := runLinkedEffects(t, c, r)
	if len(damageDealtEmittedEvidence(done)) != 0 {
		t.Fatalf("damage_dealt emits=%d want 0", len(damageDealtEmittedEvidence(done)))
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 0 {
		t.Fatalf("carve_stacks want 0")
	}
	if math.Abs(done.Summary.SourceDamageDealt-amt) > 1e-9 {
		t.Fatalf("dealt=%v want %v (true still applies)", done.Summary.SourceDamageDealt, amt)
	}
}

// TestGenericLinkedEffectsSixthHitAtCapRefreshesDuration: 第 6 击在 cap 刷新时长；
// 自第 6 击起 +5999 仍 5/70，恰好 +6000 回 0/100。
func TestGenericLinkedEffectsSixthHitAtCapRefreshesDuration(t *testing.T) {
	sixthAt := int64(500) // hits at 0..500

	cStay, rStay := loadLinkedEffectsFixture(t, 6)
	rStay.StopPolicy.DurationMs = sixthAt + blackCleaverDurationMs - 1
	doneStay := runLinkedEffects(t, cStay, rStay)
	if carveStacksFromSnapshot(t, doneStay.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 5 {
		t.Fatalf("+5999 from 6th hit stacks want 5")
	}
	if math.Abs(combatantAttrResolved(t, doneStay.FinalSnapshot, model.SelectorTarget, "armor")-70) > 1e-9 {
		t.Fatalf("+5999 armor=%v want 70", combatantAttrResolved(t, doneStay.FinalSnapshot, model.SelectorTarget, "armor"))
	}

	cExp, rExp := loadLinkedEffectsFixture(t, 6)
	rExp.StopPolicy.DurationMs = sixthAt + blackCleaverDurationMs
	doneExp := runLinkedEffects(t, cExp, rExp)
	if carveStacksFromSnapshot(t, doneExp.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 0 {
		t.Fatalf("+6000 from 6th hit stacks want 0")
	}
	if math.Abs(combatantAttrResolved(t, doneExp.FinalSnapshot, model.SelectorTarget, "armor")-blackCleaverArmorStart) > 1e-9 {
		t.Fatalf("+6000 armor=%v want %v", combatantAttrResolved(t, doneExp.FinalSnapshot, model.SelectorTarget, "armor"), blackCleaverArmorStart)
	}
}

// TestGenericLinkedEffectsExpiryThenHitSameTimestamp: 到期清理与 ability 同刻；清理先跑，
// 命中使用恢复护甲，再叠恰好 1 层。
func TestGenericLinkedEffectsExpiryThenHitSameTimestamp(t *testing.T) {
	lastStackAt := int64(0)
	expireAt := lastStackAt + blackCleaverDurationMs
	c, r := loadLinkedEffectsFixture(t, 1)
	r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{
		EntryKey:   "after_expire",
		AbilityRef: linkedEffectsAARef(),
		Source:     model.SelectorSource,
		Target:     model.SelectorTarget,
		FirstAtMs:  expireAt,
	})
	r.StopPolicy.DurationMs = expireAt + 100
	done := runLinkedEffects(t, c, r)

	// First hit at 0: armor 100 → stack 1. Expiry at 6000 restores armor. Hit at 6000 uses 100 then stacks to 1.
	wantDealt := expectedMitigatedPhysical(blackCleaverAADamage, blackCleaverArmorStart) +
		expectedMitigatedPhysical(blackCleaverAADamage, blackCleaverArmorStart)
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("dealt=%v want %v (both hits at armor 100)", done.Summary.SourceDamageDealt, wantDealt)
	}
	if carveStacksFromSnapshot(t, done.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 1 {
		t.Fatalf("after same-timestamp expiry+hit stacks want 1")
	}
	armor := combatantAttrResolved(t, done.FinalSnapshot, model.SelectorTarget, "armor")
	if math.Abs(armor-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("armor=%v want %v", armor, armorAfterCarveStacks(1))
	}
}

const targetDemoChampRef = "champion:target_demo"

// mountTwoSidedBlackCleaver mounts BC on both combatants and a target-owned AA that damages opponent
// (so driver Source=target/Target=target yields a real target→source hit without selector swap).
func mountTwoSidedBlackCleaver(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	mount := model.CombatantProviderMount{ProviderRef: blackCleaverProviderRef, DefinitionRef: blackCleaverProviderRef}
	snap := model.CombatantProviderSnapshot{
		ProviderRef: blackCleaverProviderRef, DefinitionRef: blackCleaverProviderRef, Stacks: 1, State: map[string]interface{}{},
	}
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key == model.SelectorTarget {
			compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, mount)
		}
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorTarget {
			runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, snap)
		}
	}
	dmg := blackCleaverAADamage
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey: targetDemoChampRef,
		Kind:        "champion",
		StableID:    "target_demo",
		Abilities: []model.AbilityDefinition{
			{
				AbilityKey: blackCleaverAAAbility,
				Kind:       "active",
				Types:      []string{"ability/basic_attack"},
				Operations: []model.OperationDefinition{
					{
						Operation:  "damage",
						Target:     "opponent",
						DamageType: "damage/physical",
						Amount:     &model.GenericFormulaExpr{Op: "const", Value: &dmg},
						Ref:        "op:target_aa",
					},
				},
			},
		},
	})
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key == model.SelectorTarget {
			compileReq.Combatants[i].Providers = append(compileReq.Combatants[i].Providers, model.CombatantProviderMount{
				ProviderRef: targetDemoChampRef, DefinitionRef: targetDemoChampRef,
			})
		}
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key == model.SelectorTarget {
			runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
				ProviderRef: targetDemoChampRef, DefinitionRef: targetDemoChampRef, Stacks: 1, State: map[string]interface{}{},
			})
		}
	}
	setCombatantAttr(compileReq, runReq, model.SelectorSource, "armor", model.AttributeSlotDef{
		Base: blackCleaverArmorStart, Current: blackCleaverArmorStart, Max: blackCleaverArmorStart, Resolved: blackCleaverArmorStart,
	})
	setCombatantAttr(compileReq, runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: blackCleaverHP, Current: blackCleaverHP, Max: blackCleaverHP, Resolved: blackCleaverHP,
	})
}

func targetDemoAARef() string {
	return "target.provider[" + targetDemoChampRef + "].ability[" + blackCleaverAAAbility + "]"
}

// targetSelfDriverEntry casts from target (Source=Target=target) so resolveCombatantKey yields
// sourceKey=target; ability ops use opponent to hit source.
func targetSelfDriverEntry(key string, atMs int64) model.DriverEntry {
	return model.DriverEntry{
		EntryKey:   key,
		AbilityRef: targetDemoAARef(),
		Source:     model.SelectorTarget,
		Target:     model.SelectorTarget,
		FirstAtMs:  atMs,
	}
}

// TestGenericLinkedEffectsTwoSidedOppositeCastContextStable: 两侧同 providerRef 反向叠层后，
// 无关/反向施法不得漂移；一侧到期后另一侧仍挂载且 bag/护甲正确。
func TestGenericLinkedEffectsTwoSidedOppositeCastContextStable(t *testing.T) {
	// Mid-run: both sides hold stacks after opposite-direction casts.
	cMid, rMid := loadLinkedEffectsFixture(t, 0, mountTwoSidedBlackCleaver)
	rMid.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "s2t", AbilityRef: linkedEffectsAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		targetSelfDriverEntry("t2s", 100),
		targetSelfDriverEntry("t2s2", 200),
	}
	rMid.StopPolicy.DurationMs = 300
	doneMid := runLinkedEffects(t, cMid, rMid)
	if carveStacksFromSnapshot(t, doneMid.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 1 {
		t.Fatalf("source-owned stacks want 1 after opposite casts, got %v", carveStacksFromSnapshot(t, doneMid.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef))
	}
	if carveStacksFromSnapshot(t, doneMid.FinalSnapshot, model.SelectorTarget, blackCleaverProviderRef) != 2 {
		t.Fatalf("target-owned stacks want 2 after two reverse hits, got %v", carveStacksFromSnapshot(t, doneMid.FinalSnapshot, model.SelectorTarget, blackCleaverProviderRef))
	}
	if math.Abs(combatantAttrResolved(t, doneMid.FinalSnapshot, model.SelectorTarget, "armor")-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("target armor=%v want %v (source carve must not drift)", combatantAttrResolved(t, doneMid.FinalSnapshot, model.SelectorTarget, "armor"), armorAfterCarveStacks(1))
	}
	if math.Abs(combatantAttrResolved(t, doneMid.FinalSnapshot, model.SelectorSource, "armor")-armorAfterCarveStacks(2)) > 1e-9 {
		t.Fatalf("source armor=%v want %v", combatantAttrResolved(t, doneMid.FinalSnapshot, model.SelectorSource, "armor"), armorAfterCarveStacks(2))
	}
	foundSourceBC, foundTargetBC := false, false
	for _, comb := range doneMid.FinalSnapshot.Combatants {
		for _, p := range comb.Providers {
			if p.ProviderRef != blackCleaverProviderRef {
				continue
			}
			if comb.Key == model.SelectorSource {
				foundSourceBC = true
			}
			if comb.Key == model.SelectorTarget {
				foundTargetBC = true
			}
		}
	}
	if !foundSourceBC || !foundTargetBC {
		t.Fatalf("both sides must remain mounted source=%v target=%v", foundSourceBC, foundTargetBC)
	}

	// Expire only source-owned carve at t=6000; target-owned (written at 100) still active.
	cExp, rExp := loadLinkedEffectsFixture(t, 0, mountTwoSidedBlackCleaver)
	rExp.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "s2t", AbilityRef: linkedEffectsAARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		targetSelfDriverEntry("t2s", 100),
	}
	rExp.StopPolicy.DurationMs = 6000
	doneExp := runLinkedEffects(t, cExp, rExp)
	if carveStacksFromSnapshot(t, doneExp.FinalSnapshot, model.SelectorSource, blackCleaverProviderRef) != 0 {
		t.Fatalf("source-owned stacks after its expiry want 0")
	}
	if carveStacksFromSnapshot(t, doneExp.FinalSnapshot, model.SelectorTarget, blackCleaverProviderRef) != 1 {
		t.Fatalf("target-owned stacks must remain 1 after source-side expiry")
	}
	if math.Abs(combatantAttrResolved(t, doneExp.FinalSnapshot, model.SelectorTarget, "armor")-blackCleaverArmorStart) > 1e-9 {
		t.Fatalf("target armor after source carve expiry=%v want %v", combatantAttrResolved(t, doneExp.FinalSnapshot, model.SelectorTarget, "armor"), blackCleaverArmorStart)
	}
	if math.Abs(combatantAttrResolved(t, doneExp.FinalSnapshot, model.SelectorSource, "armor")-armorAfterCarveStacks(1)) > 1e-9 {
		t.Fatalf("source armor=%v want %v (target-owned modifier unaffected)", combatantAttrResolved(t, doneExp.FinalSnapshot, model.SelectorSource, "armor"), armorAfterCarveStacks(1))
	}
	stillMounted := false
	for _, comb := range doneExp.FinalSnapshot.Combatants {
		if comb.Key != model.SelectorTarget {
			continue
		}
		for _, p := range comb.Providers {
			if p.ProviderRef == blackCleaverProviderRef {
				stillMounted = true
			}
		}
	}
	if !stillMounted {
		t.Fatal("target-owned same providerRef must remain mounted after source-side state expiry")
	}
}
