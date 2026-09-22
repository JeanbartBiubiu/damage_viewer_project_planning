package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

// item_2512 Fiendhunter Bolts / 猎魔人弩箭 — Opening Barrage / 开战弹幕.
//
// Numeric authority (League Wiki item manifest only; no DDragon / legacy DPS):
//   - 数据参考/lol-wiki-current-items/current-items.normalized.json item 2512
//   - revid 4030984
//   - SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// Classic Opening Barrage only (Arena 222512 / Night Vigil ultimate haste excluded):
//   - ultimate cast arms next 3 basic attacks within 8s
//   - +50% bonus attack speed while window>=1 and charges>=1
//   - forced branch: 80% of normal critical-strike damage
//   - natural branch: normal crit + 15% of that attack's pre-mitigation natural
//     branch raw * originalCritChance as true damage
//   - 45s cooldown starts on ultimate cast
//
// Path: CompileGeneric → RunGeneric only. No dedicated runtime branch.

const (
	ob2512ProviderRef   = "item:2512_opening_barrage"
	ob2512StableID      = "item_2512"
	ob2512WindowKey     = "opening_barrage_window"
	ob2512ChargesKey    = "opening_barrage_charges"
	ob2512CooldownKey   = "opening_barrage_cooldown"
	ob2512ArmListener   = "listener_item_2512_opening_barrage_arm"
	ob2512TrueListener  = "listener_item_2512_opening_barrage_true"
	ob2512HitListener   = "listener_item_2512_opening_barrage_hit"
	ob2512ASModKey      = "modifier_item_2512_opening_barrage_as"
	ob2512CritChanceKey = "modifier_item_2512_opening_barrage_crit_chance"
	ob2512CritForcedKey = "modifier_item_2512_opening_barrage_crit_forced"
	ob2512TrueOpRef     = "op:opening_barrage_true"
	ob2512AAOpRef       = "op:opening_barrage_aa"
	ob2512AA2OpRef      = "op:opening_barrage_aa2"
	ob2512UltKey        = "opening_barrage_ultimate"
	ob2512AAKey         = "opening_barrage_aa"
	ob2512MultiKey      = "opening_barrage_multi_aa"
	ob2512HitEvent      = spellbladeHitEvent
	ob2512CastEvent     = spellbladeCastEvent
	ob2512ChampionRef   = spellbladeChampionRef

	ob2512WindowMs   = 8000.0
	ob2512CooldownMs = 45000.0
	ob2512ASBonus    = 0.50
	ob2512TrueRatio  = 0.15
	ob2512ForcedMul  = 0.80
	ob2512BaseRaw    = 100.0
	ob2512CritDamage = 2.0
	ob2512BaseAS     = 0.60
	ob2512ArmedAS    = 0.90 // 0.60 * (1 + 0.50)
	ob2512TargetHP   = 10000.0
	ob2512Armor      = 100.0
	ob2512Tol        = 1e-6
)

func ob2512Float(v float64) *float64 { return &v }

func ob2512TimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func ob2512StateSchema() map[string]interface{} {
	return map[string]interface{}{
		ob2512WindowKey:   ob2512TimedSlot(0, 1, ob2512WindowMs),
		ob2512ChargesKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(3),
			"durationMs":   float64(0),
		},
		ob2512CooldownKey: ob2512TimedSlot(0, 1, ob2512CooldownMs),
	}
}

func ob2512ActiveCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "min",
		Args: []model.GenericFormulaExpr{
			{
				Op: "gte",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "provider.state." + ob2512WindowKey},
					{Op: "const", Value: &one},
				},
			},
			{
				Op: "gte",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "provider.state." + ob2512ChargesKey},
					{Op: "const", Value: &one},
				},
			},
		},
	}
}

func ob2512CooldownZeroCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + ob2512CooldownKey},
			{Op: "const", Value: &zero},
		},
	}
}

func ob2512TrueCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "min",
		Args: []model.GenericFormulaExpr{
			*ob2512ActiveCond(),
			{
				Op: "gt",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "event.damage.originalCritChance"},
					{Op: "const", Value: &zero},
				},
			},
		},
	}
}

func ob2512ASModifier() model.ModifierDefinition {
	one := 1.0
	// Inactive → 0; do not overwrite base AS (percent_add only).
	return model.ModifierDefinition{
		ModifierKey: ob2512ASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(ob2512ASBonus),
				{
					Op: "mul",
					Args: []model.GenericFormulaExpr{
						{Op: "read", Path: "provider.state." + ob2512WindowKey},
						{
							Op: "gte",
							Args: []model.GenericFormulaExpr{
								{Op: "read", Path: "provider.state." + ob2512ChargesKey},
								{Op: "const", Value: &one},
							},
						},
					},
				},
			},
		},
	}
}

func ob2512CritChanceModifier() model.ModifierDefinition {
	one := 1.0
	return model.ModifierDefinition{
		ModifierKey: ob2512CritChanceKey,
		Kind:        "pipeline",
		Command:     "crit",
		Channel:     "basic_damage",
		Stage:       "crit_chance_pre_settlement",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "override",
		Value:       model.GenericFormulaExpr{Op: "const", Value: &one},
		Condition:   ob2512ActiveCond(),
	}
}

func ob2512CritForcedModifier() model.ModifierDefinition {
	mul := ob2512ForcedMul
	return model.ModifierDefinition{
		ModifierKey: ob2512CritForcedKey,
		Kind:        "pipeline",
		Command:     "crit",
		Channel:     "basic_damage",
		Stage:       "crit_multiplier_forced_branch",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "multiply",
		Value:       model.GenericFormulaExpr{Op: "const", Value: &mul},
		Condition:   ob2512ActiveCond(),
	}
}

func ob2512MakeArmListener() model.ListenerDefinition {
	one := 1.0
	three := 3.0
	cd0 := ob2512CooldownZeroCond()
	// Deterministic order: window→1, charges→3, cooldown→1. Every op gated on cooldown==0.
	return model.ListenerDefinition{
		ListenerKey:  ob2512ArmListener,
		EventMatcher: model.TypeMatcher{All: []string{ob2512CastEvent, "ability/ultimate", "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         ob2512WindowKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   cd0,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         ob2512ChargesKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &three},
				Condition:   cd0,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         ob2512CooldownKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   cd0,
			},
		},
	}
}

func ob2512TrueAmount() *model.GenericFormulaExpr {
	ratio := ob2512TrueRatio
	return &model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &ratio},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "read", Path: "event.damage.naturalBranchRawAmount"},
					{Op: "read", Path: "event.damage.originalCritChance"},
				},
			},
		},
	}
}

func ob2512MakeTrueListener() model.ListenerDefinition {
	return model.ListenerDefinition{
		ListenerKey:       ob2512TrueListener,
		PerCastThrottleMs: 1,
		EventMatcher: model.TypeMatcher{
			All: []string{"event/damage_instance", "ability/basic_attack", "event/source_owner"},
		},
		Operations: []model.OperationDefinition{{
			Operation:     "damage",
			Target:        "target",
			DamageType:    "damage/true",
			Ref:           ob2512TrueOpRef,
			CopyableOnHit: false,
			Condition:     ob2512TrueCond(),
			Amount:        ob2512TrueAmount(),
		}},
	}
}

func ob2512MakeHitListener() model.ListenerDefinition {
	negOne := -1.0
	return model.ListenerDefinition{
		ListenerKey:  ob2512HitListener,
		EventMatcher: model.TypeMatcher{All: []string{ob2512HitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         ob2512ChargesKey,
			Types:       []string{"state_scope/provider"},
			ValuePolicy: "add",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &negOne},
			Condition:   ob2512ActiveCond(),
		}},
	}
}

func ob2512EnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	ensureDamageTrueType(req)
	need := []model.TypeCatalogEntry{
		{Key: "event/damage_instance", Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/ultimate", Domain: "ability"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "cast_origin/champion", Domain: "cast_origin"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "damage/physical", Domain: "damage"},
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

func ob2512MountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        ob2512ProviderRef,
		Kind:               "item",
		StableID:           ob2512StableID,
		InitialStateSchema: ob2512StateSchema(),
		Modifiers: []model.ModifierDefinition{
			ob2512ASModifier(),
			ob2512CritChanceModifier(),
			ob2512CritForcedModifier(),
		},
		Listeners: []model.ListenerDefinition{
			ob2512MakeArmListener(),
			ob2512MakeTrueListener(),
			ob2512MakeHitListener(),
		},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: ob2512ProviderRef, DefinitionRef: ob2512ProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: ob2512ProviderRef, DefinitionRef: ob2512ProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[ob2512ProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{
				ob2512WindowKey:   float64(0),
				ob2512ChargesKey:  float64(0),
				ob2512CooldownKey: float64(0),
			},
		}
	}
}

func ob2512UltAbility() model.AbilityDefinition {
	// Non-basic, typed ability/ultimate, castOrigin champion → automatic ability_started.
	return model.AbilityDefinition{
		AbilityKey: ob2512UltKey,
		Kind:       "active",
		Types:      []string{"ability/ultimate"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{},
	}
}

func ob2512AAOps(raw float64, critEligible bool) []model.OperationDefinition {
	return []model.OperationDefinition{
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &raw},
			CritEligible: critEligible,
			Ref:          ob2512AAOpRef,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: ob2512HitEvent,
			Ref:       ob2512HitEvent,
		},
	}
}

func ob2512MultiAAOps(raw float64) []model.OperationDefinition {
	raw2 := raw * 0.5
	return []model.OperationDefinition{
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &raw},
			CritEligible: true,
			Ref:          ob2512AAOpRef,
		},
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: &raw2},
			CritEligible: true,
			Ref:          ob2512AA2OpRef,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: ob2512HitEvent,
			Ref:       ob2512HitEvent,
		},
	}
}

func ob2512UltRef() string {
	return "source.provider[" + ob2512ChampionRef + "].ability[" + ob2512UltKey + "]"
}

func ob2512AARef() string {
	return "source.provider[" + ob2512ChampionRef + "].ability[" + ob2512AAKey + "]"
}

func ob2512MultiRef() string {
	return "source.provider[" + ob2512ChampionRef + "].ability[" + ob2512MultiKey + "]"
}

func ob2512LoadFixture(t *testing.T, critChance float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ob2512EnsureTypes(&compileReq)
	raw := ob2512BaseRaw
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		ob2512UltAbility(),
		{
			AbilityKey: ob2512AAKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			CastOrigin: model.CastOriginChampion,
			Operations: ob2512AAOps(raw, true),
		},
		{
			AbilityKey: ob2512MultiKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			CastOrigin: model.CastOriginChampion,
			Operations: ob2512MultiAAOps(raw),
		},
	}
	ob2512MountProvider(&compileReq, &runReq)
	setSourceCritAttrs(&compileReq, &runReq, critChance, ob2512CritDamage)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: ob2512BaseAS, Current: ob2512BaseAS, Max: ob2512BaseAS, Resolved: ob2512BaseAS,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: ob2512TargetHP, Current: ob2512TargetHP, Max: ob2512TargetHP, Resolved: ob2512TargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: ob2512Armor, Current: ob2512Armor, Max: ob2512Armor, Resolved: ob2512Armor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "mr", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func ob2512Compile(t *testing.T, compileReq model.CompileRequest) compile.GenericCompileResult {
	t.Helper()
	result := compileMigrated(&compileReq, nil)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	return result
}

func ob2512Run(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}
	return done
}

func ob2512SetDriver(runReq *model.RunRequest, entries []model.DriverEntry, durationMs int64) {
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = durationMs
}

func ob2512Provider(t *testing.T, result compile.GenericCompileResult) *compile.CompiledProvider {
	t.Helper()
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == ob2512ProviderRef {
			return p
		}
	}
	t.Fatal("missing Opening Barrage provider")
	return nil
}

func ob2512Listener(t *testing.T, p *compile.CompiledProvider, key string) *compile.CompiledListener {
	t.Helper()
	for i := range p.Listeners {
		if p.Listeners[i].ListenerKey == key {
			return &p.Listeners[i]
		}
	}
	t.Fatalf("missing listener %s", key)
	return nil
}

func ob2512Modifier(t *testing.T, p *compile.CompiledProvider, key string) *compile.CompiledModifier {
	t.Helper()
	for i := range p.Modifiers {
		if p.Modifiers[i].ModifierKey == key {
			return &p.Modifiers[i]
		}
	}
	t.Fatalf("missing modifier %s", key)
	return nil
}

func ob2512TypeSet(t *testing.T, result compile.GenericCompileResult, keys ...string) typeset.TypeSet {
	t.Helper()
	var set typeset.TypeSet
	for _, key := range keys {
		id, ok := result.Session.Types.Registry.Lookup(key)
		if !ok {
			t.Fatalf("missing type key %q", key)
		}
		set.Add(id)
	}
	return set
}

func ob2512State(t *testing.T, done model.DoneResult) (window, charges, cooldown float64) {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, ob2512ProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("state bag missing: %+v", bag)
	}
	window, _ = state[ob2512WindowKey].(float64)
	charges, _ = state[ob2512ChargesKey].(float64)
	cooldown, _ = state[ob2512CooldownKey].(float64)
	return
}

func ob2512TargetShieldRemaining(done model.DoneResult) float64 {
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorTarget {
			continue
		}
		var sum float64
		for _, s := range c.Shields {
			sum += s.Remaining
		}
		return sum
	}
	return 0
}

func ob2512ExpectedPhysical(p float64) (preMitigation, mitigated, naturalBranch, trueRaw float64) {
	q := 1.0
	naturalWeight := p
	forcedWeight := q - p
	mNatural := ob2512CritDamage
	mForced := ob2512CritDamage * ob2512ForcedMul
	preMitigation = ob2512BaseRaw * (naturalWeight*mNatural + forcedWeight*mForced)
	mitigated = expectedMitigatedPhysical(preMitigation, ob2512Armor)
	naturalBranch = ob2512BaseRaw * mNatural
	trueRaw = ob2512TrueRatio * naturalBranch * p
	return
}

// TestFiendhunterBolts2512CompileContract: schema, matchers, throttle, crit stages/channels, formulas.
func TestFiendhunterBolts2512CompileContract(t *testing.T) {
	compileReq, _ := ob2512LoadFixture(t, 0.25)
	result := ob2512Compile(t, compileReq)
	p := ob2512Provider(t, result)

	win := p.StateFields[ob2512WindowKey]
	if win.DefaultValue != 0 || !win.HasCap || win.MaxValue != 1 ||
		win.DurationMs != int64(ob2512WindowMs) || win.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("window=%+v want default0/max1/8000/refresh_on_write", win)
	}
	ch := p.StateFields[ob2512ChargesKey]
	if ch.DefaultValue != 0 || !ch.HasCap || ch.MaxValue != 3 || ch.DurationMs != 0 || ch.RefreshPolicy != "" {
		t.Fatalf("charges=%+v want default0/max3/untimed", ch)
	}
	cd := p.StateFields[ob2512CooldownKey]
	if cd.DefaultValue != 0 || !cd.HasCap || cd.MaxValue != 1 ||
		cd.DurationMs != int64(ob2512CooldownMs) || cd.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("cooldown=%+v want default0/max1/45000/refresh_on_write", cd)
	}

	arm := ob2512Listener(t, p, ob2512ArmListener)
	if !arm.EventMatcher.Match(ob2512TypeSet(t, result, ob2512CastEvent, "ability/ultimate", "event/source_owner")) {
		t.Fatal("arm matcher must accept ability_started+ultimate+source_owner")
	}
	if arm.EventMatcher.Match(ob2512TypeSet(t, result, ob2512CastEvent, "event/source_owner")) {
		t.Fatal("arm matcher must require ability/ultimate")
	}
	if arm.OperationCount != 3 {
		t.Fatalf("arm ops=%d want 3 (window,charges,cooldown)", arm.OperationCount)
	}

	trueL := ob2512Listener(t, p, ob2512TrueListener)
	if trueL.PerCastThrottleMs != 1 {
		t.Fatalf("true PerCastThrottleMs=%d want 1", trueL.PerCastThrottleMs)
	}
	if !trueL.EventMatcher.Match(ob2512TypeSet(t, result, "event/damage_instance", "ability/basic_attack", "event/source_owner")) {
		t.Fatal("true matcher must accept damage_instance+basic_attack+source_owner")
	}

	hit := ob2512Listener(t, p, ob2512HitListener)
	if !hit.EventMatcher.Match(ob2512TypeSet(t, result, ob2512HitEvent, "event/source_owner")) {
		t.Fatal("hit matcher must accept basic_attack_hit+source_owner")
	}

	asMod := ob2512Modifier(t, p, ob2512ASModKey)
	if asMod.Kind != "attribute" || asMod.Target != "attack_speed" || asMod.ValuePolicy != "percent_add" {
		t.Fatalf("AS mod=%+v", asMod)
	}

	chance := ob2512Modifier(t, p, ob2512CritChanceKey)
	if chance.Command != "crit" || chance.Channel != "basic_damage" ||
		chance.Stage != "crit_chance_pre_settlement" || chance.ValuePolicy != "override" || !chance.HasCondition {
		t.Fatalf("crit chance mod=%+v", chance)
	}
	forced := ob2512Modifier(t, p, ob2512CritForcedKey)
	if forced.Command != "crit" || forced.Channel != "basic_damage" ||
		forced.Stage != "crit_multiplier_forced_branch" || forced.ValuePolicy != "multiply" || !forced.HasCondition {
		t.Fatalf("forced crit mod=%+v", forced)
	}
	for _, m := range p.Modifiers {
		if m.Stage == "crit_multiplier_natural_branch" {
			t.Fatal("must not override natural crit multiplier")
		}
	}

	// Fixture-level formula: true amount = 0.15 * naturalBranchRawAmount * originalCritChance.
	var foundProv *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == ob2512ProviderRef {
			foundProv = &compileReq.SharedProviders[i]
			break
		}
	}
	if foundProv == nil {
		t.Fatal("fixture provider missing")
	}
	var trueOp *model.OperationDefinition
	for _, l := range foundProv.Listeners {
		if l.ListenerKey != ob2512TrueListener {
			continue
		}
		trueOp = &l.Operations[0]
	}
	if trueOp == nil || trueOp.Amount == nil || trueOp.Amount.Op != "mul" {
		t.Fatalf("true amount formula=%+v", trueOp)
	}
	if trueOp.CopyableOnHit || len(trueOp.Types) != 0 {
		t.Fatalf("true child must be CopyableOnHit=false with empty Types, got %+v", trueOp)
	}
}

// TestFiendhunterBolts2512ArmAndAttackSpeed: inactive before ult; arm sets window/3/cd; AS base*(1+0.50).
func TestFiendhunterBolts2512ArmAndAttackSpeed(t *testing.T) {
	compileReq, runReq := ob2512LoadFixture(t, 0.25)
	ob2512SetDriver(&runReq, nil, 50)
	doneIdle := ob2512Run(t, compileReq, runReq)
	w, c, cd := ob2512State(t, doneIdle)
	if w != 0 || c != 0 || cd != 0 {
		t.Fatalf("before ult state window/charges/cd=%v/%v/%v want 0/0/0", w, c, cd)
	}
	if got := sourceAttrResolved(t, doneIdle.FinalSnapshot, "attack_speed"); math.Abs(got-ob2512BaseAS) > ob2512Tol {
		t.Fatalf("AS before ult=%v want baseline %v", got, ob2512BaseAS)
	}

	compileReq2, runReq2 := ob2512LoadFixture(t, 0.25)
	ob2512SetDriver(&runReq2, []model.DriverEntry{{
		EntryKey: "ult", AbilityRef: ob2512UltRef(),
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 100)
	done := ob2512Run(t, compileReq2, runReq2)
	if n := countEmittedEvents(done, ob2512CastEvent); n != 1 {
		t.Fatalf("ability_started=%d want 1", n)
	}
	w, c, cd = ob2512State(t, done)
	if w != 1 || c != 3 || cd != 1 {
		t.Fatalf("after ult window/charges/cd=%v/%v/%v want 1/3/1", w, c, cd)
	}
	for _, combatant := range done.FinalSnapshot.Combatants {
		if combatant.Key != model.SelectorSource {
			continue
		}
		slot := combatant.Attributes["attack_speed"]
		if math.Abs(slot.Base-ob2512BaseAS) > ob2512Tol {
			t.Fatalf("AS.base=%v want %v (must not overwrite base)", slot.Base, ob2512BaseAS)
		}
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-ob2512ArmedAS) > ob2512Tol {
		t.Fatalf("AS after arm=%v want %v", got, ob2512ArmedAS)
	}
}

// TestOpeningBarrage2512ThreeEnhancedFourthNormal: 3 charged hits; 4th normal expected crit, no true, AS baseline.
func TestOpeningBarrage2512ThreeEnhancedFourthNormal(t *testing.T) {
	const p = 0.25
	compileReq, runReq := ob2512LoadFixture(t, p)
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 200},
		{EntryKey: "aa3", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 300},
		{EntryKey: "aa4", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 400},
	}, 500)
	done := ob2512Run(t, compileReq, runReq)

	if n := countDamageByOpRef(done, ob2512TrueOpRef, false); n != 3 {
		t.Fatalf("true procs=%d want 3", n)
	}
	if n := countEmittedEvents(done, ob2512HitEvent); n != 4 {
		t.Fatalf("basic_attack_hit=%d want 4", n)
	}
	_, charges, _ := ob2512State(t, done)
	if charges != 0 {
		t.Fatalf("charges after 3 hits=%v want 0", charges)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-ob2512BaseAS) > ob2512Tol {
		t.Fatalf("AS after third hit=%v want baseline %v", got, ob2512BaseAS)
	}

	var aaItems []model.EvidenceItem
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != ob2512AAOpRef {
			continue
		}
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		aaItems = append(aaItems, item)
	}
	if len(aaItems) != 4 {
		t.Fatalf("AA damage items=%d want 4", len(aaItems))
	}
	pre, _, _, _ := ob2512ExpectedPhysical(p)
	for i := 0; i < 3; i++ {
		if math.Abs(evidenceDataFloat(aaItems[i].Data, "chanceEffective")-1) > ob2512Tol {
			t.Fatalf("aa[%d] q=%v want 1", i, evidenceDataFloat(aaItems[i].Data, "chanceEffective"))
		}
		if math.Abs(evidenceDataFloat(aaItems[i].Data, "rawAmount")-pre) > ob2512Tol {
			t.Fatalf("aa[%d] raw=%v want enhanced %v", i, evidenceDataFloat(aaItems[i].Data, "rawAmount"), pre)
		}
	}
	_, _, normal, critPart, adjusted := wantExpectedCrit(ob2512BaseRaw, p, ob2512CritDamage)
	_ = normal
	_ = critPart
	fourth := aaItems[3].Data
	if math.Abs(evidenceDataFloat(fourth, "chanceEffective")-p) > ob2512Tol {
		t.Fatalf("4th q=%v want p=%v (no force)", evidenceDataFloat(fourth, "chanceEffective"), p)
	}
	if math.Abs(evidenceDataFloat(fourth, "critAdjustedRawAmount")-adjusted) > ob2512Tol {
		t.Fatalf("4th adjusted=%v want normal expected %v", evidenceDataFloat(fourth, "critAdjustedRawAmount"), adjusted)
	}
}

// TestOpeningBarrage2512ForcedOnlyP0: p=0 → forced multiplier 0.8*crit_damage, no true damage.
func TestOpeningBarrage2512ForcedOnlyP0(t *testing.T) {
	compileReq, runReq := ob2512LoadFixture(t, 0)
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	}, 200)
	done := ob2512Run(t, compileReq, runReq)
	if n := countDamageByOpRef(done, ob2512TrueOpRef, false); n != 0 {
		t.Fatalf("true procs=%d want 0 when p=0", n)
	}
	data := firstDamageEvidenceByOpRef(done, ob2512AAOpRef).Data
	if math.Abs(evidenceDataFloat(data, "originalCritChance")) > ob2512Tol {
		t.Fatalf("p=%v want 0", evidenceDataFloat(data, "originalCritChance"))
	}
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-1) > ob2512Tol {
		t.Fatalf("q=%v want 1", evidenceDataFloat(data, "chanceEffective"))
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritWeight")-1) > ob2512Tol {
		t.Fatalf("forcedWeight=%v want 1", evidenceDataFloat(data, "forcedCritWeight"))
	}
	wantForced := ob2512CritDamage * ob2512ForcedMul
	if math.Abs(evidenceDataFloat(data, "forcedCritMultiplier")-wantForced) > ob2512Tol {
		t.Fatalf("M_forced=%v want %v", evidenceDataFloat(data, "forcedCritMultiplier"), wantForced)
	}
	wantPre := ob2512BaseRaw * wantForced
	if math.Abs(evidenceDataFloat(data, "rawAmount")-wantPre) > ob2512Tol {
		t.Fatalf("raw=%v want %v", evidenceDataFloat(data, "rawAmount"), wantPre)
	}
}

// TestOpeningBarrage2512CrossCheckP025: Wiki cross-check with base=100,p=0.25,crit=2,armor=100 → total 92.5.
func TestOpeningBarrage2512CrossCheckP025(t *testing.T) {
	const p = 0.25
	compileReq, runReq := ob2512LoadFixture(t, p)
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	}, 200)
	done := ob2512Run(t, compileReq, runReq)

	data := firstDamageEvidenceByOpRef(done, ob2512AAOpRef).Data
	if math.Abs(evidenceDataFloat(data, "originalCritChance")-p) > ob2512Tol {
		t.Fatalf("p=%v", evidenceDataFloat(data, "originalCritChance"))
	}
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-1) > ob2512Tol {
		t.Fatalf("q=%v want 1", evidenceDataFloat(data, "chanceEffective"))
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritWeight")-p) > ob2512Tol {
		t.Fatalf("naturalWeight=%v want %v", evidenceDataFloat(data, "naturalCritWeight"), p)
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritWeight")-(1-p)) > ob2512Tol {
		t.Fatalf("forcedWeight=%v want %v", evidenceDataFloat(data, "forcedCritWeight"), 1-p)
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritMultiplier")-1.6) > ob2512Tol {
		t.Fatalf("M_forced=%v want 1.6", evidenceDataFloat(data, "forcedCritMultiplier"))
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritMultiplier")-2) > ob2512Tol {
		t.Fatalf("M_natural=%v want 2", evidenceDataFloat(data, "naturalCritMultiplier"))
	}
	if math.Abs(evidenceDataFloat(data, "rawAmount")-170) > ob2512Tol {
		t.Fatalf("physical pre-mitigation=%v want 170", evidenceDataFloat(data, "rawAmount"))
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-85) > ob2512Tol {
		t.Fatalf("physical mitigated=%v want 85", evidenceDataFloat(data, "mitigatedAmount"))
	}

	evs := emittedEventsByRef(done, eventTypeDamageInstance)
	if len(evs) < 1 {
		t.Fatal("missing damage_instance")
	}
	snap, ok := evs[0].Data["damage"].(map[string]interface{})
	if !ok {
		t.Fatalf("damage snapshot missing: %+v", evs[0].Data)
	}
	if math.Abs(evidenceDataFloat(snap, "naturalBranchRawAmount")-200) > ob2512Tol {
		t.Fatalf("naturalBranchRawAmount=%v want 200", evidenceDataFloat(snap, "naturalBranchRawAmount"))
	}

	if n := countDamageByOpRef(done, ob2512TrueOpRef, false); n != 1 {
		t.Fatalf("true procs=%d want 1", n)
	}
	trueItem := firstDamageEvidenceByOpRef(done, ob2512TrueOpRef)
	if math.Abs(evidenceDataFloat(trueItem.Data, "rawAmount")-7.5) > ob2512Tol {
		t.Fatalf("true raw=%v want 7.5", evidenceDataFloat(trueItem.Data, "rawAmount"))
	}
	if math.Abs(evidenceDataFloat(trueItem.Data, "mitigatedAmount")-7.5) > ob2512Tol {
		t.Fatalf("true mitigated=%v want 7.5", evidenceDataFloat(trueItem.Data, "mitigatedAmount"))
	}
	wantHP := ob2512TargetHP - 92.5
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > ob2512Tol {
		t.Fatalf("targetFinalHp=%v want %v (85+7.5)", done.Summary.TargetFinalHp, wantHP)
	}
}

// TestOpeningBarrage2512NaturalOnlyP1: p=1 → normal crit multiplier + 15% natural pre-mitigation true.
func TestOpeningBarrage2512NaturalOnlyP1(t *testing.T) {
	const p = 1.0
	compileReq, runReq := ob2512LoadFixture(t, p)
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	}, 200)
	done := ob2512Run(t, compileReq, runReq)
	data := firstDamageEvidenceByOpRef(done, ob2512AAOpRef).Data
	if math.Abs(evidenceDataFloat(data, "naturalCritWeight")-1) > ob2512Tol {
		t.Fatalf("naturalWeight=%v want 1", evidenceDataFloat(data, "naturalCritWeight"))
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritWeight")) > ob2512Tol {
		t.Fatalf("forcedWeight=%v want 0", evidenceDataFloat(data, "forcedCritWeight"))
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritMultiplier")-ob2512CritDamage) > ob2512Tol {
		t.Fatalf("M_natural=%v want %v", evidenceDataFloat(data, "naturalCritMultiplier"), ob2512CritDamage)
	}
	if math.Abs(evidenceDataFloat(data, "rawAmount")-200) > ob2512Tol {
		t.Fatalf("physical pre=%v want 200", evidenceDataFloat(data, "rawAmount"))
	}
	trueItem := firstDamageEvidenceByOpRef(done, ob2512TrueOpRef)
	if trueItem == nil {
		t.Fatal("missing true damage")
	}
	if math.Abs(evidenceDataFloat(trueItem.Data, "rawAmount")-30) > ob2512Tol {
		t.Fatalf("true=%v want 30 (0.15*200*1)", evidenceDataFloat(trueItem.Data, "rawAmount"))
	}
}

// TestOpeningBarrage2512WindowExactBoundary: [0,8000) — 7999 enhanced; 8000 not; charge write does not refresh window.
func TestOpeningBarrage2512WindowExactBoundary(t *testing.T) {
	const p = 0.25
	compileReq, runReq := ob2512LoadFixture(t, p)
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "early", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 1000},
		{EntryKey: "edge", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 7999},
		{EntryKey: "past", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 8000},
	}, 8100)
	done := ob2512Run(t, compileReq, runReq)

	var aa []model.EvidenceItem
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != ob2512AAOpRef || evidenceDataBool(item.Data, "phantom") {
			continue
		}
		aa = append(aa, item)
	}
	if len(aa) != 3 {
		t.Fatalf("AA items=%d want 3", len(aa))
	}
	pre, _, _, _ := ob2512ExpectedPhysical(p)
	_, _, _, _, normalAdj := wantExpectedCrit(ob2512BaseRaw, p, ob2512CritDamage)
	if math.Abs(evidenceDataFloat(aa[0].Data, "rawAmount")-pre) > ob2512Tol {
		t.Fatalf("t=1000 raw=%v want enhanced %v", evidenceDataFloat(aa[0].Data, "rawAmount"), pre)
	}
	if math.Abs(evidenceDataFloat(aa[1].Data, "rawAmount")-pre) > ob2512Tol {
		t.Fatalf("t=7999 raw=%v want enhanced %v (window still open)", evidenceDataFloat(aa[1].Data, "rawAmount"), pre)
	}
	if math.Abs(evidenceDataFloat(aa[2].Data, "critAdjustedRawAmount")-normalAdj) > ob2512Tol {
		t.Fatalf("t=8000 adjusted=%v want normal %v (window expired; charge write must not refresh)", evidenceDataFloat(aa[2].Data, "critAdjustedRawAmount"), normalAdj)
	}
	if n := countDamageByOpRef(done, ob2512TrueOpRef, false); n != 2 {
		t.Fatalf("true procs=%d want 2 (1000+7999 only)", n)
	}
}

// TestOpeningBarrage2512CooldownExactBoundary: [0,45000) blocks re-arm; 45000 can arm again.
func TestOpeningBarrage2512CooldownExactBoundary(t *testing.T) {
	compileReq, runReq := ob2512LoadFixture(t, 0.25)
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult0", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 200},
		{EntryKey: "aa3", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 300},
		{EntryKey: "ult_blocked", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 44999},
	}, 45050)
	doneBlocked := ob2512Run(t, compileReq, runReq)
	w, c, _ := ob2512State(t, doneBlocked)
	if w != 0 || c != 0 {
		t.Fatalf("after blocked re-ult window/charges=%v/%v want 0/0", w, c)
	}
	if n := countEmittedEvents(doneBlocked, ob2512CastEvent); n != 2 {
		t.Fatalf("ability_started=%d want 2 (ult0 + blocked attempt)", n)
	}
	// Charges never refilled by blocked ult: only the first three hits consumed the original 3.
	if n := countDamageByOpRef(doneBlocked, ob2512TrueOpRef, false); n != 3 {
		t.Fatalf("true procs=%d want 3 (no re-arm at 44999)", n)
	}

	compileReq2, runReq2 := ob2512LoadFixture(t, 0.25)
	ob2512SetDriver(&runReq2, []model.DriverEntry{
		{EntryKey: "ult0", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 200},
		{EntryKey: "aa3", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 300},
		{EntryKey: "ult_ready", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 45000},
	}, 45100)
	doneReady := ob2512Run(t, compileReq2, runReq2)
	w, c, cd := ob2512State(t, doneReady)
	if w != 1 || c != 3 || cd != 1 {
		t.Fatalf("after ult at 45000 window/charges/cd=%v/%v/%v want 1/3/1", w, c, cd)
	}
}

// TestOpeningBarrage2512MultiOpSingleCast: CritEligible roots stay enhanced until hit; true once; charge once.
func TestOpeningBarrage2512MultiOpSingleCast(t *testing.T) {
	const p = 0.25
	compileReq, runReq := ob2512LoadFixture(t, p)
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "multi", AbilityRef: ob2512MultiRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	}, 200)
	done := ob2512Run(t, compileReq, runReq)

	main := firstDamageEvidenceByOpRef(done, ob2512AAOpRef)
	sec := firstDamageEvidenceByOpRef(done, ob2512AA2OpRef)
	if main == nil || sec == nil {
		t.Fatal("missing multi-op AA damage")
	}
	if math.Abs(evidenceDataFloat(main.Data, "chanceEffective")-1) > ob2512Tol {
		t.Fatalf("main q=%v want 1", evidenceDataFloat(main.Data, "chanceEffective"))
	}
	if math.Abs(evidenceDataFloat(sec.Data, "chanceEffective")-1) > ob2512Tol {
		t.Fatalf("second CritEligible q=%v want 1 (charges not yet consumed)", evidenceDataFloat(sec.Data, "chanceEffective"))
	}
	if n := countDamageByOpRef(done, ob2512TrueOpRef, false); n != 1 {
		t.Fatalf("true procs=%d want 1 (per-cast throttle)", n)
	}
	_, charges, _ := ob2512State(t, done)
	if charges != 2 {
		t.Fatalf("charges=%v want 2 (decrement once)", charges)
	}
	if n := countEmittedEvents(done, ob2512HitEvent); n != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", n)
	}
	trueItem := firstDamageEvidenceByOpRef(done, ob2512TrueOpRef)
	if evidenceDataBool(trueItem.Data, "copyableOnHit") {
		t.Fatal("child true must not be copyable")
	}
	// Child true damage_instance must not re-fire Opening Barrage (no ability/basic_attack on empty listener ability).
	trueEvs := 0
	for _, ev := range emittedEventsByRef(done, eventTypeDamageInstance) {
		if evidenceDataString(ev.Data, "operationRef") == ob2512TrueOpRef {
			trueEvs++
		}
	}
	if trueEvs != 1 {
		t.Fatalf("true damage_instance emits=%d want 1 (no recurse)", trueEvs)
	}
}

// TestOpeningBarrage2512TrueBypassesResistShieldAbsorbs: true ignores armor; shields absorb via pipeline.
func TestOpeningBarrage2512TrueBypassesResistShieldAbsorbs(t *testing.T) {
	const p = 0.25
	compileReq, runReq := ob2512LoadFixture(t, p)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 300, Current: 300, Max: 300, Resolved: 300,
	})
	shieldAmt := 5.0
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorTarget {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Shields = []model.CombatantShieldSnapshot{{
			ShieldRef: "keep", Source: model.SelectorSource, Owner: model.SelectorTarget,
			Remaining: shieldAmt, Priority: 1, State: map[string]interface{}{},
		}}
	}
	ob2512SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: ob2512UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: ob2512AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 100},
	}, 200)
	done := ob2512Run(t, compileReq, runReq)

	pre, _, _, trueRaw := ob2512ExpectedPhysical(p)
	physMit := expectedMitigatedPhysical(pre, 300)
	trueItem := firstDamageEvidenceByOpRef(done, ob2512TrueOpRef)
	if math.Abs(evidenceDataFloat(trueItem.Data, "rawAmount")-trueRaw) > ob2512Tol {
		t.Fatalf("true raw=%v want %v", evidenceDataFloat(trueItem.Data, "rawAmount"), trueRaw)
	}
	if math.Abs(evidenceDataFloat(trueItem.Data, "mitigatedAmount")-trueRaw) > ob2512Tol {
		t.Fatalf("true mitigated=%v want %v (bypass resist)", evidenceDataFloat(trueItem.Data, "mitigatedAmount"), trueRaw)
	}
	if math.Abs(evidenceDataFloat(trueItem.Data, "resistanceFactor")-1) > ob2512Tol {
		t.Fatalf("true resistanceFactor=%v want 1", evidenceDataFloat(trueItem.Data, "resistanceFactor"))
	}
	// Independent expected: physical mit + true - shield.
	wantHP := ob2512TargetHP - (physMit + trueRaw - shieldAmt)
	if math.Abs(done.Summary.TargetFinalHp-wantHP) > ob2512Tol {
		t.Fatalf("targetFinalHp=%v want %v (physMit=%v true=%v shield=%v)", done.Summary.TargetFinalHp, wantHP, physMit, trueRaw, shieldAmt)
	}
	if got := ob2512TargetShieldRemaining(done); math.Abs(got) > ob2512Tol {
		t.Fatalf("shield remaining=%v want 0", got)
	}
}
