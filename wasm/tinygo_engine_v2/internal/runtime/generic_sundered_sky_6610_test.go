package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

// item_6610 Sundered Sky / 焚天 — Lightshield Strike / 光盾打击 (classic 1v1 damage branch).
//
// Numeric authority (League Wiki item manifest only; no DDragon / legacy DPS):
//   - 数据参考/lol-wiki-current-items/current-items.raw.lua
//   - revid 4030984
//   - SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// Classic panel + Lightshield Strike damage branch only:
//   - static: hp=400, ad=45, ability_haste=10
//   - next basic attack against a champion is a guaranteed crit
//   - absolute total critical damage 160% (Wiki critical damage|60|80 → 60% bonus;
//     template 80% is Infinity Edge ratio, not melee)
//   - per-target cooldown 10000ms (provider_target lightshield_strike_cooldown)
//
// Explicit non-goals (not claimed by these tests):
//   - healing / overheal→bonus health
//   - Infinity Edge or other crit-damage item combinations
//   - Arena / non-champion / long-lived multi-target semantics
//   - live migrate / publish
//
// Path: CompileGeneric → RunGeneric only. No production runtime changes.

const (
	ss6610ProviderRef = "provider_item_6610_lightshield_strike"
	ss6610StableID    = "item_6610"
	ss6610CooldownKey = "lightshield_strike_cooldown"
	ss6610ListenerKey = "listener_item_6610_lightshield_strike_hit"
	ss6610ChanceMod   = "modifier_item_6610_lightshield_strike_crit_chance"
	ss6610NaturalMod  = "modifier_item_6610_lightshield_strike_crit_natural"
	ss6610ForcedMod   = "modifier_item_6610_lightshield_strike_crit_forced"
	ss6610AAKey       = "lightshield_strike_aa"
	ss6610AAOpRef     = "op:lightshield_strike_aa"
	ss6610HitEvent    = spellbladeHitEvent
	ss6610ChampionRef = spellbladeChampionRef

	// Wiki classic static panel (item 6610).
	ss6610WikiHP           = 400.0
	ss6610WikiAD           = 45.0
	ss6610WikiAbilityHaste = 10.0

	ss6610CooldownMs   = 10000.0
	ss6610CritTotal   = 1.60 // absolute total critical damage (60% bonus)
	ss6610BaseRaw     = 100.0
	ss6610TargetHP    = 100000.0
	ss6610Tol         = 1e-9
)

func ss6610Float(v float64) *float64 { return &v }

func ss6610TimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func ss6610StateSchema() map[string]interface{} {
	return map[string]interface{}{
		ss6610CooldownKey: ss6610TimedSlot(0, 1, ss6610CooldownMs),
	}
}

// cooldown_zero: provider.target_state.lightshield_strike_cooldown == 0
// (absent key reads as 0 — ready before first write).
func ss6610CooldownZeroCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.target_state." + ss6610CooldownKey},
			{Op: "const", Value: &zero},
		},
	}
}

func ss6610CritChanceModifier() model.ModifierDefinition {
	one := 1.0
	return model.ModifierDefinition{
		ModifierKey: ss6610ChanceMod,
		Kind:        "pipeline",
		Command:     "crit",
		Channel:     "basic_damage",
		Stage:       "crit_chance_pre_settlement",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "override",
		Value:       model.GenericFormulaExpr{Op: "const", Value: &one},
		Condition:   ss6610CooldownZeroCond(),
	}
}

func ss6610CritNaturalModifier() model.ModifierDefinition {
	mul := ss6610CritTotal
	return model.ModifierDefinition{
		ModifierKey: ss6610NaturalMod,
		Kind:        "pipeline",
		Command:     "crit",
		Channel:     "basic_damage",
		Stage:       "crit_multiplier_natural_branch",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "override",
		Value:       model.GenericFormulaExpr{Op: "const", Value: &mul},
		Condition:   ss6610CooldownZeroCond(),
	}
}

func ss6610CritForcedModifier() model.ModifierDefinition {
	mul := ss6610CritTotal
	return model.ModifierDefinition{
		ModifierKey: ss6610ForcedMod,
		Kind:        "pipeline",
		Command:     "crit",
		Channel:     "basic_damage",
		Stage:       "crit_multiplier_forced_branch",
		Bucket:      "all_instances",
		Priority:    0,
		ValuePolicy: "override",
		Value:       model.GenericFormulaExpr{Op: "const", Value: &mul},
		Condition:   ss6610CooldownZeroCond(),
	}
}

func ss6610HitListener() model.ListenerDefinition {
	one := 1.0
	cd0 := ss6610CooldownZeroCond()
	return model.ListenerDefinition{
		ListenerKey:         ss6610ListenerKey,
		MaxTriggersPerEvent: 1,
		EventMatcher:        model.TypeMatcher{All: []string{ss6610HitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         ss6610CooldownKey,
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			Condition:   cd0,
		}},
	}
}

func ss6610EnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "event/source_owner", Domain: "event"},
		{Key: "event/damage_instance", Domain: "event"}, // negative matcher probe only
		{Key: "state_scope/provider_target", Domain: "state_scope"},
		{Key: "ability/basic_attack", Domain: "ability"},
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

func ss6610AAOps(raw float64) []model.OperationDefinition {
	return []model.OperationDefinition{
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: ss6610Float(raw)},
			CritEligible: true,
			Ref:          ss6610AAOpRef,
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: ss6610HitEvent,
			Ref:       ss6610HitEvent,
		},
	}
}

func ss6610MountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        ss6610ProviderRef,
		Kind:               "item",
		StableID:           ss6610StableID,
		InitialStateSchema: ss6610StateSchema(),
		Modifiers: []model.ModifierDefinition{
			ss6610CritChanceModifier(),
			ss6610CritNaturalModifier(),
			ss6610CritForcedModifier(),
		},
		Listeners: []model.ListenerDefinition{ss6610HitListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: ss6610ProviderRef, DefinitionRef: ss6610ProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: ss6610ProviderRef, DefinitionRef: ss6610ProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[ss6610ProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{},
		}
	}
}

func ss6610AARef() string {
	return "source.provider[" + ss6610ChampionRef + "].ability[" + ss6610AAKey + "]"
}

func ss6610LoadFixture(t *testing.T, critChance, critDamage float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ss6610EnsureTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{{
		AbilityKey: ss6610AAKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		CastOrigin: model.CastOriginChampion,
		Operations: ss6610AAOps(ss6610BaseRaw),
	}}
	ss6610MountProvider(&compileReq, &runReq)

	// Wiki classic panel recorded on source (damage path uses const raw, not AD).
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: ss6610WikiHP, Current: ss6610WikiHP, Max: ss6610WikiHP, Resolved: ss6610WikiHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: ss6610WikiAD, Current: ss6610WikiAD, Max: ss6610WikiAD, Resolved: ss6610WikiAD,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ability_haste", model.AttributeSlotDef{
		Base: ss6610WikiAbilityHaste, Current: ss6610WikiAbilityHaste,
		Max: ss6610WikiAbilityHaste, Resolved: ss6610WikiAbilityHaste,
	})
	setSourceCritAttrs(&compileReq, &runReq, critChance, critDamage)
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: ss6610TargetHP, Current: ss6610TargetHP, Max: ss6610TargetHP, Resolved: ss6610TargetHP,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "mr", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func ss6610Compile(t *testing.T, compileReq model.CompileRequest) compile.GenericCompileResult {
	t.Helper()
	result := compileMigrated(&compileReq, nil)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	return result
}

func ss6610Run(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func ss6610SetDriver(runReq *model.RunRequest, entries []model.DriverEntry, durationMs int64) {
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = durationMs
}

func ss6610Provider(t *testing.T, result compile.GenericCompileResult) *compile.CompiledProvider {
	t.Helper()
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == ss6610ProviderRef {
			return p
		}
	}
	t.Fatal("missing Lightshield Strike provider")
	return nil
}

func ss6610Listener(t *testing.T, p *compile.CompiledProvider) *compile.CompiledListener {
	t.Helper()
	for i := range p.Listeners {
		if p.Listeners[i].ListenerKey == ss6610ListenerKey {
			return &p.Listeners[i]
		}
	}
	t.Fatal("missing Lightshield Strike hit listener")
	return nil
}

func ss6610Modifier(t *testing.T, p *compile.CompiledProvider, key string) *compile.CompiledModifier {
	t.Helper()
	for i := range p.Modifiers {
		if p.Modifiers[i].ModifierKey == key {
			return &p.Modifiers[i]
		}
	}
	t.Fatalf("missing modifier %s", key)
	return nil
}

func ss6610TypeSet(t *testing.T, result compile.GenericCompileResult, keys ...string) typeset.TypeSet {
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

func ss6610TargetCooldown(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[ss6610ProviderRef].(map[string]interface{})
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
		v, _ := values[ss6610CooldownKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func ss6610AADamages(done model.DoneResult) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		if item.Ref == ss6610AAOpRef || evidenceDataString(item.Data, "operationRef") == ss6610AAOpRef {
			out = append(out, item)
		}
	}
	return out
}

func ss6610AssertEmpowered(t *testing.T, data map[string]interface{}, p, baseCritDamage float64) {
	t.Helper()
	// Absolute override must ignore base crit_damage. Cases with crit_damage=1.75 are
	// decisive (1.75*0.80=1.40 ≠ 1.60); crit_damage=2.0 alone would be ambiguous with ×0.80.
	if math.Abs(evidenceDataFloat(data, "originalCritChance")-clamp01(p)) > ss6610Tol {
		t.Fatalf("p=%v want %v", evidenceDataFloat(data, "originalCritChance"), clamp01(p))
	}
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-1) > ss6610Tol {
		t.Fatalf("chanceEffective=%v want 1", evidenceDataFloat(data, "chanceEffective"))
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritWeight")-clamp01(p)) > ss6610Tol {
		t.Fatalf("naturalCritWeight=%v want p=%v", evidenceDataFloat(data, "naturalCritWeight"), clamp01(p))
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritWeight")-(1-clamp01(p))) > ss6610Tol {
		t.Fatalf("forcedCritWeight=%v want 1-p=%v", evidenceDataFloat(data, "forcedCritWeight"), 1-clamp01(p))
	}
	if math.Abs(evidenceDataFloat(data, "naturalCritMultiplier")-ss6610CritTotal) > ss6610Tol {
		t.Fatalf("naturalCritMultiplier=%v want %v (absolute; base crit_damage was %v)",
			evidenceDataFloat(data, "naturalCritMultiplier"), ss6610CritTotal, baseCritDamage)
	}
	if math.Abs(evidenceDataFloat(data, "forcedCritMultiplier")-ss6610CritTotal) > ss6610Tol {
		t.Fatalf("forcedCritMultiplier=%v want %v (absolute; base crit_damage was %v)",
			evidenceDataFloat(data, "forcedCritMultiplier"), ss6610CritTotal, baseCritDamage)
	}
	wantRaw := ss6610BaseRaw * ss6610CritTotal
	if math.Abs(evidenceDataFloat(data, "rawAmount")-wantRaw) > ss6610Tol {
		t.Fatalf("rawAmount=%v want %v (1.60*base)", evidenceDataFloat(data, "rawAmount"), wantRaw)
	}
	if math.Abs(evidenceDataFloat(data, "critAdjustedRawAmount")-wantRaw) > ss6610Tol {
		t.Fatalf("critAdjustedRawAmount=%v want %v", evidenceDataFloat(data, "critAdjustedRawAmount"), wantRaw)
	}
}

func ss6610AssertBaseExpectedCrit(t *testing.T, data map[string]interface{}, p, critDamage float64) {
	t.Helper()
	_, mult, normal, critPart, adjusted := wantExpectedCrit(ss6610BaseRaw, p, critDamage)
	chanceEff := clamp01(p)
	if math.Abs(evidenceDataFloat(data, "chanceEffective")-chanceEff) > ss6610Tol {
		t.Fatalf("cooled chanceEffective=%v want %v", evidenceDataFloat(data, "chanceEffective"), chanceEff)
	}
	if math.Abs(evidenceDataFloat(data, "multiplier")-mult) > ss6610Tol {
		t.Fatalf("cooled multiplier=%v want %v", evidenceDataFloat(data, "multiplier"), mult)
	}
	if math.Abs(evidenceDataFloat(data, "rawAmount")-adjusted) > ss6610Tol {
		t.Fatalf("cooled raw=%v want base expected-crit %v (normal=%v critPart=%v)",
			evidenceDataFloat(data, "rawAmount"), adjusted, normal, critPart)
	}
}

// TestSunderedSky6610WikiStaticPanel: Wiki classic panel constants cross-check.
func TestSunderedSky6610WikiStaticPanel(t *testing.T) {
	if ss6610WikiHP != 400 || ss6610WikiAD != 45 || ss6610WikiAbilityHaste != 10 {
		t.Fatalf("wiki panel hp/ad/ah=%v/%v/%v want 400/45/10",
			ss6610WikiHP, ss6610WikiAD, ss6610WikiAbilityHaste)
	}
	if ss6610CritTotal != 1.60 || ss6610CooldownMs != 10000 {
		t.Fatalf("critTotal/cd=%v/%v want 1.60/10000", ss6610CritTotal, ss6610CooldownMs)
	}
	compileReq, runReq := ss6610LoadFixture(t, 0, 1.75)
	done := ss6610Run(t, compileReq, runReq)
	if got := sourceAttrResolved(t, done.FinalSnapshot, "hp"); math.Abs(got-ss6610WikiHP) > ss6610Tol {
		t.Fatalf("source hp=%v want wiki %v", got, ss6610WikiHP)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ad"); math.Abs(got-ss6610WikiAD) > ss6610Tol {
		t.Fatalf("source ad=%v want wiki %v", got, ss6610WikiAD)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "ability_haste"); math.Abs(got-ss6610WikiAbilityHaste) > ss6610Tol {
		t.Fatalf("source ability_haste=%v want wiki %v", got, ss6610WikiAbilityHaste)
	}
}

// TestSunderedSky6610CompileContract: provider_target CD schema + gated C2 mods + hit listener.
func TestSunderedSky6610CompileContract(t *testing.T) {
	compileReq, _ := ss6610LoadFixture(t, 0.25, 1.75)
	result := ss6610Compile(t, compileReq)
	p := ss6610Provider(t, result)

	if p.StableID != ss6610StableID {
		t.Fatalf("StableID=%q want %q", p.StableID, ss6610StableID)
	}
	cd := p.StateFields[ss6610CooldownKey]
	if cd.DefaultValue != 0 || !cd.HasCap || cd.MaxValue != 1 ||
		cd.DurationMs != int64(ss6610CooldownMs) || cd.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("lightshield_strike_cooldown=%+v want default0/max1/10000/refresh_on_write", cd)
	}

	hit := ss6610Listener(t, p)
	if !hit.EventMatcher.Match(ss6610TypeSet(t, result, ss6610HitEvent, "event/source_owner")) {
		t.Fatal("hit matcher must accept basic_attack_hit + source_owner")
	}
	if hit.EventMatcher.Match(ss6610TypeSet(t, result, ss6610HitEvent)) {
		t.Fatal("hit matcher must require event/source_owner")
	}
	if hit.EventMatcher.Match(ss6610TypeSet(t, result, "event/damage_instance", "event/source_owner")) {
		t.Fatal("hit matcher must require event/basic_attack_hit")
	}
	if hit.MaxTriggersPerEvent != 1 {
		t.Fatalf("MaxTriggersPerEvent=%d want 1", hit.MaxTriggersPerEvent)
	}
	if hit.OperationCount != 1 {
		t.Fatalf("hit ops=%d want 1 (provider_target cooldown write)", hit.OperationCount)
	}
	op := &result.Session.Operations[hit.OperationStart]
	if op.Operation != "state_change" || op.StateScope != "state_scope/provider_target" ||
		op.ValuePolicy != "override" || !op.HasCondition {
		t.Fatalf("hit op=%+v want state_change provider_target override + cooldown_zero", op)
	}

	chance := ss6610Modifier(t, p, ss6610ChanceMod)
	if chance.Command != "crit" || chance.Channel != "basic_damage" ||
		chance.Stage != "crit_chance_pre_settlement" || chance.ValuePolicy != "override" || !chance.HasCondition {
		t.Fatalf("crit chance mod=%+v", chance)
	}
	natural := ss6610Modifier(t, p, ss6610NaturalMod)
	if natural.Command != "crit" || natural.Channel != "basic_damage" ||
		natural.Stage != "crit_multiplier_natural_branch" || natural.ValuePolicy != "override" || !natural.HasCondition {
		t.Fatalf("natural crit mod=%+v (must be absolute override 1.60, not 2512-style multiply)", natural)
	}
	forced := ss6610Modifier(t, p, ss6610ForcedMod)
	if forced.Command != "crit" || forced.Channel != "basic_damage" ||
		forced.Stage != "crit_multiplier_forced_branch" || forced.ValuePolicy != "override" || !forced.HasCondition {
		t.Fatalf("forced crit mod=%+v (must be absolute override 1.60, not multiply 0.80)", forced)
	}

	// Fixture-level formula: all three mods + listener share cooldown_zero on provider.target_state.
	var found *model.ProviderDefinition
	for i := range compileReq.SharedProviders {
		if compileReq.SharedProviders[i].ProviderKey == ss6610ProviderRef {
			found = &compileReq.SharedProviders[i]
			break
		}
	}
	if found == nil {
		t.Fatal("fixture provider missing")
	}
	wantPath := "provider.target_state." + ss6610CooldownKey
	for _, m := range found.Modifiers {
		if m.Condition == nil || m.Condition.Op != "eq" || len(m.Condition.Args) != 2 ||
			m.Condition.Args[0].Path != wantPath {
			t.Fatalf("modifier %s condition=%+v want eq read %s == 0", m.ModifierKey, m.Condition, wantPath)
		}
	}
	if found.Listeners[0].Operations[0].Condition == nil ||
		found.Listeners[0].Operations[0].Condition.Op != "eq" ||
		found.Listeners[0].Operations[0].Condition.Args[0].Path != wantPath {
		t.Fatalf("listener condition=%+v want eq read %s == 0", found.Listeners[0].Operations[0].Condition, wantPath)
	}
}

// TestSunderedSky6610EmpoweredAbsoluteCritOverride: p=0/0.25/1 × base crit_damage 1.75|2.0
// all yield chanceEffective=1 and raw=1.60*base (absolute override, not ×0.80).
func TestSunderedSky6610EmpoweredAbsoluteCritOverride(t *testing.T) {
	cases := []struct {
		name       string
		p          float64
		critDamage float64
	}{
		{"p0_crit175", 0, 1.75},
		{"p025_crit175", 0.25, 1.75},
		{"p1_crit175", 1, 1.75},
		{"p0_crit20", 0, 2.0},
		{"p025_crit20", 0.25, 2.0},
		{"p1_crit20", 1, 2.0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := ss6610LoadFixture(t, tc.p, tc.critDamage)
			ss6610SetDriver(&runReq, []model.DriverEntry{{
				EntryKey: "aa0", AbilityRef: ss6610AARef(),
				Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
			}}, 100)
			done := ss6610Run(t, compileReq, runReq)
			aas := ss6610AADamages(done)
			if len(aas) != 1 {
				t.Fatalf("aa damages=%d want 1", len(aas))
			}
			ss6610AssertEmpowered(t, aas[0].Data, tc.p, tc.critDamage)
			if got := ss6610TargetCooldown(t, done.FinalSnapshot); got != 1 {
				t.Fatalf("provider_target cooldown after first hit=%v want 1", got)
			}
			if n := countEmittedEvents(done, ss6610HitEvent); n != 1 {
				t.Fatalf("basic_attack_hit=%d want 1", n)
			}
		})
	}
}

// TestSunderedSky6610PerTargetCooldownWriteAndExpiry: first hit arms CD; 9999ms still cooled
// (base expected-crit); exact 10000ms expires and re-arms empowered strike.
// Healing / multi-target / IE combinations are out of scope and not asserted here.
func TestSunderedSky6610PerTargetCooldownWriteAndExpiry(t *testing.T) {
	const (
		p          = 0.25
		critDamage = 1.75
	)

	// Blocked window: second AA at 9999 must stay on base expected-crit.
	compileReq, runReq := ss6610LoadFixture(t, p, critDamage)
	ss6610SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: ss6610AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa_cooled", AbilityRef: ss6610AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 9999},
	}, 9999)
	doneCooled := ss6610Run(t, compileReq, runReq)
	aas := ss6610AADamages(doneCooled)
	if len(aas) != 2 {
		t.Fatalf("aa damages=%d want 2", len(aas))
	}
	ss6610AssertEmpowered(t, aas[0].Data, p, critDamage)
	ss6610AssertBaseExpectedCrit(t, aas[1].Data, p, critDamage)
	if got := ss6610TargetCooldown(t, doneCooled.FinalSnapshot); got != 1 {
		t.Fatalf("cooldown@9999=%v want 1 (still in [0,10000))", got)
	}
	if n := countEmittedEvents(doneCooled, ss6610HitEvent); n != 2 {
		t.Fatalf("basic_attack_hit=%d want 2", n)
	}

	// Exact expiry rearms: AA at 10000 is empowered again and rewrites cooldown=1.
	compileReq2, runReq2 := ss6610LoadFixture(t, p, critDamage)
	ss6610SetDriver(&runReq2, []model.DriverEntry{
		{EntryKey: "aa0", AbilityRef: ss6610AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "aa_ready", AbilityRef: ss6610AARef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 10000},
	}, 10050)
	doneReady := ss6610Run(t, compileReq2, runReq2)
	aas2 := ss6610AADamages(doneReady)
	if len(aas2) != 2 {
		t.Fatalf("aa damages=%d want 2", len(aas2))
	}
	ss6610AssertEmpowered(t, aas2[0].Data, p, critDamage)
	ss6610AssertEmpowered(t, aas2[1].Data, p, critDamage)
	if got := ss6610TargetCooldown(t, doneReady.FinalSnapshot); got != 1 {
		t.Fatalf("cooldown after rearm hit@10000=%v want 1", got)
	}
}
