package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

func ensureDamageMagicType(req *model.CompileRequest) {
	for _, t := range req.TypeCatalog.Types {
		if t.Key == "damage/magic" {
			return
		}
	}
	req.TypeCatalog.Types = append(req.TypeCatalog.Types, model.TypeCatalogEntry{Key: "damage/magic", Domain: "damage"})
}

// setCombatantAttr writes attr on both compile definition and run snapshot so materialize keeps it.
func setCombatantAttr(compileReq *model.CompileRequest, runReq *model.RunRequest, key, attr string, slot model.AttributeSlotDef) {
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != key {
			continue
		}
		if compileReq.Combatants[i].Attributes == nil {
			compileReq.Combatants[i].Attributes = map[string]model.AttributeSlotDef{}
		}
		compileReq.Combatants[i].Attributes[attr] = slot
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != key {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].Attributes == nil {
			runReq.InitialSnapshot.Combatants[i].Attributes = map[string]model.AttributeSlotDef{}
		}
		runReq.InitialSnapshot.Combatants[i].Attributes[attr] = slot
	}
}

// setCombatantResource writes resource on both compile definition and run snapshot.
func setCombatantResource(compileReq *model.CompileRequest, runReq *model.RunRequest, key, res string, slot model.ResourceSlotDef) {
	for i := range compileReq.Combatants {
		if compileReq.Combatants[i].Key != key {
			continue
		}
		if compileReq.Combatants[i].Resources == nil {
			compileReq.Combatants[i].Resources = map[string]model.ResourceSlotDef{}
		}
		compileReq.Combatants[i].Resources[res] = slot
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != key {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].Resources == nil {
			runReq.InitialSnapshot.Combatants[i].Resources = map[string]model.ResourceSlotDef{}
		}
		runReq.InitialSnapshot.Combatants[i].Resources[res] = slot
	}
}

func TestGenericRunEventSnapshotEntryVsEmitHP(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/test_hit", Domain: "event"},
	)
	ensureDamageTrueType(&compileReq)
	// Base/Current/Max/Resolved 刻意分叉；无 modifier 时 ResolveAttributes 会把 Resolved 重写为 Base，
	// 因此用 +11 rules modifier 让 resolved 保持 22，以便探针同时校验四字段。
	adGap := 11.0
	compileReq.Rules.Modifiers = []model.ModifierDefinition{
		{
			ModifierKey: "ad_resolved_gap",
			Kind:        "attribute",
			Target:      "source.attr.attack_damage",
			ValuePolicy: "add",
			Value:       model.GenericFormulaExpr{Op: "const", Value: &adGap},
		},
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_damage", model.AttributeSlotDef{
		Base: 11, Current: 22, Max: 33, Resolved: 22,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{Current: 40, Max: 100})
	setCombatantResource(&compileReq, &runReq, model.SelectorTarget, "mana", model.ResourceSlotDef{Current: 20, Max: 80})
	oneHundred := 100.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &oneHundred},
			DamageType: "damage/true",
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/test_hit",
			Ref:       "event/test_hit",
		},
		{
			// Parent mutation after emit must not pollute captured snapshots.
			Operation:    "attribute_change",
			Target:       "source",
			AttributeKey: "attack_damage",
			ValuePolicy:  "set",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: floatPtr(999)},
		},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "inline_probes",
			EventMatcher: model.TypeMatcher{Any: []string{"event/test_hit"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_target.attr.hp.current"},
				},
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.target.attr.hp.current"},
				},
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_source.attr.attack_damage.base"},
				},
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.source.attr.attack_damage.current"},
				},
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.source.attr.attack_damage.max"},
				},
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.source.attr.attack_damage.resolved"},
				},
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_source.resource.mana.max"},
				},
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.target.resource.mana.current"},
				},
			},
		},
	}

	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// damage0→emit1: entry target HP=1000, emit target HP=900.
	// Probes: 1000+900+11+22+33+22+100+20；emit 后父 frame AD→999 不得污染 event.source snapshot。
	wantDealt := 100.0 + 1000 + 900 + 11 + 22 + 33 + 22 + 100 + 20
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
	if done.Summary.TargetFinalHp != 0 {
		t.Fatalf("targetFinalHp=%v want 0 (overkill clipped; summary still mitigated total)", done.Summary.TargetFinalHp)
	}
}

func TestGenericRunEventSnapshotChildAbilitySharesContext(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/test_hit", Domain: "event"},
	)
	ensureDamageTrueType(&compileReq)
	fifty := 50.0
	compileReq.SharedProviders[0].Abilities = append(compileReq.SharedProviders[0].Abilities, model.AbilityDefinition{
		AbilityKey: "child_probe",
		Kind:       "active",
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/true",
				Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_target.attr.hp.current"},
			},
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/true",
				Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.target.attr.hp.current"},
			},
		},
	})
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &fifty},
			DamageType: "damage/true",
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/test_hit",
			Ref:       "event/test_hit",
		},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "child_cast",
			EventMatcher: model.TypeMatcher{Any: []string{"event/test_hit"}},
			AbilityRef:   "source.provider[champion:source_demo].ability[child_probe]",
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	want := 50.0 + 1000 + 950
	if math.Abs(done.Summary.SourceDamageDealt-want) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v (child ability shares event snapshot)", done.Summary.SourceDamageDealt, want)
	}
}

// emit_event target=source 时，event.entry_target 必须取原始 event target（source）的父 frame entry，
// 而非固定复制父 frame 的 target entry。
func TestGenericRunEventSnapshotEntryFollowsEmitParticipants(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/test_hit", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_opponent", Domain: "event"},
	)
	ensureDamageTrueType(&compileReq)
	sourceEntryHP := 500.0
	targetEntryHP := 1000.0
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: sourceEntryHP, Current: sourceEntryHP, Max: sourceEntryHP, Resolved: sourceEntryHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: targetEntryHP, Current: targetEntryHP, Max: targetEntryHP, Resolved: targetEntryHP,
	})
	// Target-owned listener：frame source/target 会 owner-relative 重映射，但 event.entry_* 仍跟 emitted participants。
	compileReq.Combatants[1].Providers = []model.CombatantProviderMount{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo"},
	}
	runReq.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Stacks: 1, State: map[string]interface{}{}},
	}
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation: "emit_event",
			Target:    "source",
			EventType: "event/test_hit",
			Ref:       "event/test_hit",
		},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "entry_follow_emit_target",
			EventMatcher: model.TypeMatcher{All: []string{"event/test_hit", "event/source_opponent"}},
			Operations: []model.OperationDefinition{
				{
					// event target 是 source → entry_target 应为 source entry HP(500)，不是父 frame target(1000)。
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_target.attr.hp.current"},
				},
				{
					// event source 也是 source；同时确认 owner remap 未污染 entry_source。
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_source.attr.hp.current"},
				},
			},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// Target-owned listener：frame source=target，damage 记在 TargetDamageDealt。
	// 两次探针都应读到 source entry HP=500（若 bug 仍固定复制父 frame target entry，会得到 1000）。
	want := sourceEntryHP + sourceEntryHP
	if math.Abs(done.Summary.TargetDamageDealt-want) > 1e-6 {
		t.Fatalf("targetDamageDealt=%v want %v (entry maps follow emit participants, not parent frame roles)", done.Summary.TargetDamageDealt, want)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want 0 (owner-relative frame source is target)", done.Summary.SourceDamageDealt)
	}
}

func TestGenericRunEventSnapshotOwnerRemapDoesNotRemapEvent(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types,
		model.TypeCatalogEntry{Key: "event/test_hit", Domain: "event"},
		model.TypeCatalogEntry{Key: "event/source_opponent", Domain: "event"},
	)
	ensureDamageTrueType(&compileReq)
	ensureSourceHP(&compileReq, &runReq)
	compileReq.Combatants[1].Providers = []model.CombatantProviderMount{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo"},
	}
	runReq.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{
		{ProviderRef: "champion:source_demo", DefinitionRef: "champion:source_demo", Stacks: 1, State: map[string]interface{}{}},
	}
	hit := 25.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &hit},
			DamageType: "damage/true",
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: "event/test_hit",
			Ref:       "event/test_hit",
		},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "owner_probe",
			EventMatcher: model.TypeMatcher{All: []string{"event/test_hit", "event/source_opponent"}},
			Operations: []model.OperationDefinition{
				{
					Operation:  "damage",
					Target:     "target",
					DamageType: "damage/true",
					Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_target.attr.hp.current"},
				},
			},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// Target-owned listener remaps frame source→target, but event.entry_target stays original target (1000).
	if math.Abs(done.Summary.SourceDamageDealt-25) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want 25", done.Summary.SourceDamageDealt)
	}
	if math.Abs(done.Summary.TargetDamageDealt-1000) > 1e-6 {
		t.Fatalf("targetDamageDealt=%v want 1000 (event snapshot not remapped)", done.Summary.TargetDamageDealt)
	}
}

func TestGenericRunEventPathErrorsWithoutContext(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageTrueType(&compileReq)
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/true",
			Amount:     &model.GenericFormulaExpr{Op: "read", Path: "event.entry_target.attr.hp.current"},
		},
	}
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	_, err := RunGeneric(result.Session, runReq)
	if err == nil {
		t.Fatal("expected formula error for event.* without event context")
	}
	if err.Code != model.GenericErrFormulaTypeError {
		t.Fatalf("code=%q want formula_type_error msg=%q", err.Code, err.Message)
	}
}

func TestGenericRunPhysicalResistanceSummary(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	hundred := 100.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &hundred},
			DamageType: "damage/physical",
		},
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{Base: 100, Current: 100, Max: 100, Resolved: 100})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{Base: 200, Current: 200, Max: 200, Resolved: 200})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_flat", model.AttributeSlotDef{Base: 100, Current: 100, Max: 100, Resolved: 100})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor_pen_pct", model.AttributeSlotDef{Base: 1, Current: 1, Max: 1, Resolved: 1})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	// 100 armor, 100% pct + 100 flat → effective 0 → mitigated 100；MR 无效。
	if done.Summary.TargetFinalHp != 900 {
		t.Fatalf("targetFinalHp=%v want 900", done.Summary.TargetFinalHp)
	}
	if done.Summary.SourceDamageDealt != 100 {
		t.Fatalf("sourceDamageDealt=%v want 100 (full pen)", done.Summary.SourceDamageDealt)
	}
	data := firstOriginalDamage(t, done)
	if math.Abs(evidenceDataFloat(data, "penetrationPercent")-1) > 1e-12 {
		t.Fatalf("penetrationPercent=%v want 1", evidenceDataFloat(data, "penetrationPercent"))
	}
	if math.Abs(evidenceDataFloat(data, "penetrationFlat")-100) > 1e-12 {
		t.Fatalf("penetrationFlat=%v want 100", evidenceDataFloat(data, "penetrationFlat"))
	}
	if math.Abs(evidenceDataFloat(data, "effectiveResistance")) > 1e-12 {
		t.Fatalf("effectiveResistance=%v want 0", evidenceDataFloat(data, "effectiveResistance"))
	}
	if math.Abs(evidenceDataFloat(data, "resistanceFactor")-1) > 1e-12 {
		t.Fatalf("resistanceFactor=%v want 1", evidenceDataFloat(data, "resistanceFactor"))
	}
}

func TestGenericRunPhysicalResistanceNoSourceCompat(t *testing.T) {
	// No source pen attrs: same mitigated result as pre-C3 armor-only path.
	compileReq, runReq := loadBasicFixture(t)
	hundred := 100.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &hundred},
			DamageType: "damage/physical",
		},
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{Base: 100, Current: 100, Max: 100, Resolved: 100})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 950 || done.Summary.SourceDamageDealt != 50 {
		t.Fatalf("hp=%v dealt=%v want 950/50", done.Summary.TargetFinalHp, done.Summary.SourceDamageDealt)
	}
}

func TestGenericRunMagicResistanceSummary(t *testing.T) {
	compileReq, runReq := loadBasicFixture(t)
	ensureDamageMagicType(&compileReq)
	hundred := 100.0
	compileReq.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &hundred},
			DamageType: "damage/magic",
		},
	}
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{Base: 200, Current: 200, Max: 200, Resolved: 200})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{Base: 100, Current: 100, Max: 100, Resolved: 100})
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if done.Summary.TargetFinalHp != 950 || done.Summary.SourceDamageDealt != 50 {
		t.Fatalf("hp=%v dealt=%v want 950/50", done.Summary.TargetFinalHp, done.Summary.SourceDamageDealt)
	}
}
