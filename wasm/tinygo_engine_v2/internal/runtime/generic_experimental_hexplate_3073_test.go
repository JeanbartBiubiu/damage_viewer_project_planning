package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/typeset"
)

// item_3073 Experimental Hexplate / 海克斯注力刚壁 — Overdrive / 过载 (ranged AS branch).
//
// Numeric authority (League Wiki Module:ItemData/data only; no DDragon):
//   - 数据参考/lol-wiki-current-items/manifest.json
//   - revid 4030984
//   - raw Lua SHA256 e7818effb888c6d2474496ee20378ecb57e335ccf9ace16630fda7d0daceac2d
//
// Classic panel (item 3073): ad=40, attack_speed=0.20, hp=450.
// Ranged Overdrive damage branch only:
//   - successful champion ultimate cast arms +0.50 bonus attack speed for [0,8000ms)
//   - cooldown [0,30000ms) starts on ultimate cast
//
// Explicitly outside this damage-branch evidence (not claimed / not modeled here):
//   - Hexcharged 30 ultimate haste
//   - +20% movement speed (ranged) / melee 14% MS
//   - melee 35% attack speed branch
//   - Arena / non-champion / multi-target
//
// Frozen Backend contract modeled as generic provider/ability/listener graph:
//   - provider item:3073_overdrive (stable item_3073)
//   - overdrive_active default0/max1/duration8000/refresh_on_write
//   - overdrive_cooldown default0/max1/duration30000/refresh_on_write
//     (defaults recorded in comments: SQL state table has no default column)
//   - formulas: cooldown_zero; arm active=1; arm cooldown=1; AS=0.50*active
//   - attack_speed percent_add modifier
//   - champion-origin active ability overdrive_ultimate typed ability/ultimate
//   - listener ability_started + ability/ultimate + source_owner; both state writes iff cooldown_zero
//
// Path: CompileGeneric → RunGeneric only. No dedicated runtime branch.

const (
	hex3073ProviderRef   = "item:3073_overdrive"
	hex3073StableID      = "item_3073"
	hex3073ActiveKey     = "overdrive_active"
	hex3073CooldownKey   = "overdrive_cooldown"
	hex3073ArmListener   = "listener_item_3073_overdrive_arm"
	hex3073ASModKey      = "modifier_item_3073_overdrive_as"
	hex3073UltKey        = "overdrive_ultimate"
	hex3073SpellKey      = "overdrive_non_ultimate"
	hex3073ProbeKey      = "overdrive_as_probe"
	hex3073CastEvent     = spellbladeCastEvent
	hex3073ChampionRef   = spellbladeChampionRef

	// Wiki classic panel (Module:ItemData/data, revid 4030984).
	hex3073WikiAD = 40.0
	hex3073WikiAS = 0.20
	hex3073WikiHP = 450.0

	hex3073ActiveMs   = 8000.0
	hex3073CooldownMs = 30000.0
	hex3073ASBonus    = 0.50

	// Independent combat base AS for expected percent_add cross-check (not Wiki panel).
	hex3073BaseAS = 0.60
	hex3073Tol    = 1e-9
)

func hex3073ExpectedAS(active float64) float64 {
	// Independent expected: resolved = base * (1 + 0.50 * active).
	return hex3073BaseAS * (1 + hex3073ASBonus*active)
}

func hex3073TimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func hex3073StateSchema() map[string]interface{} {
	// Defaults are 0 (comment-only; Backend state table has no default column).
	return map[string]interface{}{
		hex3073ActiveKey:   hex3073TimedSlot(0, 1, hex3073ActiveMs),
		hex3073CooldownKey: hex3073TimedSlot(0, 1, hex3073CooldownMs),
	}
}

func hex3073CooldownZeroCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + hex3073CooldownKey},
			{Op: "const", Value: &zero},
		},
	}
}

func hex3073ASModifier() model.ModifierDefinition {
	// Inactive → 0; percent_add must not overwrite base AS.
	return model.ModifierDefinition{
		ModifierKey: hex3073ASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(hex3073ASBonus),
				{Op: "read", Path: "provider.state." + hex3073ActiveKey},
			},
		},
	}
}

func hex3073MakeArmListener() model.ListenerDefinition {
	one := 1.0
	cd0 := hex3073CooldownZeroCond()
	// Deterministic order: active→1, cooldown→1. Both gated on cooldown==0.
	return model.ListenerDefinition{
		ListenerKey:  hex3073ArmListener,
		EventMatcher: model.TypeMatcher{All: []string{hex3073CastEvent, "ability/ultimate", "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         hex3073ActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   cd0,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         hex3073CooldownKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   cd0,
			},
		},
	}
}

func hex3073EnsureTypes(req *model.CompileRequest) {
	ensureSpellbladeTypes(req)
	need := []model.TypeCatalogEntry{
		{Key: "ability/ultimate", Domain: "ability"},
		{Key: "ability/spell", Domain: "ability"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "cast_origin/champion", Domain: "cast_origin"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "event/source_owner", Domain: "event"},
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

func hex3073UltAbility() model.AbilityDefinition {
	// Non-basic, typed ability/ultimate, castOrigin champion → automatic ability_started.
	return model.AbilityDefinition{
		AbilityKey: hex3073UltKey,
		Kind:       "active",
		Types:      []string{"ability/ultimate"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{},
	}
}

func hex3073SpellAbility() model.AbilityDefinition {
	// Unrelated non-ultimate active cast: emits ability_started but must not arm Overdrive.
	return model.AbilityDefinition{
		AbilityKey: hex3073SpellKey,
		Kind:       "active",
		Types:      []string{"ability/spell"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{},
	}
}

func hex3073ProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: hex3073ProbeKey,
		Kind:       "active",
		// Typed as basic_attack so probe does not synthesize ability_started.
		Types:      []string{"ability/basic_attack"},
		CastOrigin: model.CastOriginChampion,
		Operations: []model.OperationDefinition{{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
			Ref:        "op:overdrive_as_probe",
		}},
	}
}

func hex3073MountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:        hex3073ProviderRef,
		Kind:               "item",
		StableID:           hex3073StableID,
		InitialStateSchema: hex3073StateSchema(),
		Modifiers:          []model.ModifierDefinition{hex3073ASModifier()},
		Listeners:          []model.ListenerDefinition{hex3073MakeArmListener()},
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: hex3073ProviderRef, DefinitionRef: hex3073ProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: hex3073ProviderRef, DefinitionRef: hex3073ProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[hex3073ProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{
				hex3073ActiveKey:   float64(0),
				hex3073CooldownKey: float64(0),
			},
		}
	}
}

func hex3073UltRef() string {
	return "source.provider[" + hex3073ChampionRef + "].ability[" + hex3073UltKey + "]"
}

func hex3073SpellRef() string {
	return "source.provider[" + hex3073ChampionRef + "].ability[" + hex3073SpellKey + "]"
}

func hex3073ProbeRef() string {
	return "source.provider[" + hex3073ChampionRef + "].ability[" + hex3073ProbeKey + "]"
}

func hex3073LoadFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	hex3073EnsureTypes(&compileReq)
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		hex3073UltAbility(),
		hex3073SpellAbility(),
		hex3073ProbeAbility(),
	}
	hex3073MountProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: hex3073BaseAS, Current: hex3073BaseAS, Max: hex3073BaseAS, Resolved: hex3073BaseAS,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func hex3073Compile(t *testing.T, compileReq model.CompileRequest) compile.GenericCompileResult {
	t.Helper()
	result := compile.CompileGeneric(compileReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	return result
}

func hex3073Run(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := hex3073Compile(t, compileReq)
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}
	return done
}

func hex3073SetDriver(runReq *model.RunRequest, entries []model.DriverEntry, durationMs int64) {
	runReq.DriverPlan.Entries = entries
	runReq.StopPolicy.DurationMs = durationMs
}

func hex3073Provider(t *testing.T, result compile.GenericCompileResult) *compile.CompiledProvider {
	t.Helper()
	for i := range result.Session.Providers {
		p := &result.Session.Providers[i]
		if p.ProviderKey == hex3073ProviderRef {
			return p
		}
	}
	t.Fatal("missing Overdrive provider")
	return nil
}

func hex3073Listener(t *testing.T, p *compile.CompiledProvider, key string) *compile.CompiledListener {
	t.Helper()
	for i := range p.Listeners {
		if p.Listeners[i].ListenerKey == key {
			return &p.Listeners[i]
		}
	}
	t.Fatalf("missing listener %s", key)
	return nil
}

func hex3073Modifier(t *testing.T, p *compile.CompiledProvider, key string) *compile.CompiledModifier {
	t.Helper()
	for i := range p.Modifiers {
		if p.Modifiers[i].ModifierKey == key {
			return &p.Modifiers[i]
		}
	}
	t.Fatalf("missing modifier %s", key)
	return nil
}

func hex3073TypeSet(t *testing.T, result compile.GenericCompileResult, keys ...string) typeset.TypeSet {
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

func hex3073FindAbility(t *testing.T, result compile.GenericCompileResult, abilityKey string) compile.CompiledAbility {
	t.Helper()
	for i := range result.Session.Abilities {
		a := result.Session.Abilities[i]
		if a.AbilityKey == abilityKey {
			return a
		}
	}
	t.Fatalf("missing ability %q", abilityKey)
	return compile.CompiledAbility{}
}

func hex3073State(t *testing.T, done model.DoneResult) (active, cooldown float64) {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, hex3073ProviderRef)
	state, ok := bag["state"].(map[string]interface{})
	if !ok {
		t.Fatalf("state bag missing: %+v", bag)
	}
	active, _ = state[hex3073ActiveKey].(float64)
	cooldown, _ = state[hex3073CooldownKey].(float64)
	return
}

func hex3073SourceASSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Attributes["attack_speed"]
		if !ok {
			t.Fatal("source attack_speed missing")
		}
		return slot
	}
	t.Fatal("source missing")
	return model.AttributeSlotDef{}
}

// TestExperimentalHexplate3073WikiConstantsAndCompileSchema: Wiki panel + state schema + AS modifier.
func TestExperimentalHexplate3073WikiConstantsAndCompileSchema(t *testing.T) {
	if hex3073WikiAD != 40 || hex3073WikiAS != 0.20 || hex3073WikiHP != 450 {
		t.Fatalf("wiki panel ad/as/hp=%v/%v/%v want 40/0.20/450", hex3073WikiAD, hex3073WikiAS, hex3073WikiHP)
	}
	if hex3073ASBonus != 0.50 || hex3073ActiveMs != 8000 || hex3073CooldownMs != 30000 {
		t.Fatalf("overdrive constants AS/activeMs/cdMs=%v/%v/%v want 0.50/8000/30000",
			hex3073ASBonus, hex3073ActiveMs, hex3073CooldownMs)
	}
	// Explicit non-goals for this damage branch (must not be claimed complete):
	// movement speed, Hexcharged ultimate haste, melee 35%/14%, Arena, non-champion/multi-target.

	compileReq, _ := hex3073LoadFixture(t)
	result := hex3073Compile(t, compileReq)
	p := hex3073Provider(t, result)

	active := p.StateFields[hex3073ActiveKey]
	if active.DefaultValue != 0 || !active.HasCap || active.MaxValue != 1 ||
		active.DurationMs != int64(hex3073ActiveMs) || active.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("overdrive_active=%+v want default0/max1/8000/refresh_on_write", active)
	}
	cd := p.StateFields[hex3073CooldownKey]
	if cd.DefaultValue != 0 || !cd.HasCap || cd.MaxValue != 1 ||
		cd.DurationMs != int64(hex3073CooldownMs) || cd.RefreshPolicy != model.ProviderStateRefreshOnWrite {
		t.Fatalf("overdrive_cooldown=%+v want default0/max1/30000/refresh_on_write", cd)
	}

	asMod := hex3073Modifier(t, p, hex3073ASModKey)
	if asMod.Kind != "attribute" || asMod.Target != "attack_speed" || asMod.ValuePolicy != "percent_add" {
		t.Fatalf("AS mod=%+v want attribute/attack_speed/percent_add", asMod)
	}

	arm := hex3073Listener(t, p, hex3073ArmListener)
	if arm.OperationCount != 2 {
		t.Fatalf("arm ops=%d want 2 (active,cooldown)", arm.OperationCount)
	}
	ops := result.Session.Operations[arm.OperationStart : arm.OperationStart+arm.OperationCount]
	for i, op := range ops {
		if !op.HasCondition {
			t.Fatalf("arm op[%d] missing cooldown_zero condition", i)
		}
	}
}

// TestExperimentalHexplate3073AbilityCatalogAndArmMatcher: kind/castOrigin/types + matcher All three.
func TestExperimentalHexplate3073AbilityCatalogAndArmMatcher(t *testing.T) {
	compileReq, _ := hex3073LoadFixture(t)
	result := hex3073Compile(t, compileReq)

	ult := hex3073FindAbility(t, result, hex3073UltKey)
	if ult.Kind != "active" {
		t.Fatalf("ultimate kind=%q want active", ult.Kind)
	}
	if ult.CastOrigin != model.CastOriginChampion {
		t.Fatalf("ultimate castOrigin=%q want champion", ult.CastOrigin)
	}
	ultTypeID, ok := result.Session.Types.Registry.Lookup("ability/ultimate")
	if !ok {
		t.Fatal("missing ability/ultimate in type catalog")
	}
	if !ult.TypeSet.Contains(ultTypeID) {
		t.Fatal("ultimate TypeSet must include ability/ultimate")
	}

	spell := hex3073FindAbility(t, result, hex3073SpellKey)
	if spell.Kind != "active" || spell.CastOrigin != model.CastOriginChampion {
		t.Fatalf("spell ability=%+v want active/champion", spell)
	}
	spellTypeID, ok := result.Session.Types.Registry.Lookup("ability/spell")
	if !ok {
		t.Fatal("missing ability/spell in type catalog")
	}
	if !spell.TypeSet.Contains(spellTypeID) {
		t.Fatal("non-ultimate TypeSet must include ability/spell")
	}
	if spell.TypeSet.Contains(ultTypeID) {
		t.Fatal("non-ultimate must not be typed ability/ultimate")
	}

	p := hex3073Provider(t, result)
	arm := hex3073Listener(t, p, hex3073ArmListener)
	if !arm.EventMatcher.Match(hex3073TypeSet(t, result, hex3073CastEvent, "ability/ultimate", "event/source_owner")) {
		t.Fatal("arm matcher must accept ability_started+ultimate+source_owner")
	}
	if arm.EventMatcher.Match(hex3073TypeSet(t, result, hex3073CastEvent, "event/source_owner")) {
		t.Fatal("arm matcher must require ability/ultimate")
	}
	if arm.EventMatcher.Match(hex3073TypeSet(t, result, hex3073CastEvent, "ability/ultimate")) {
		t.Fatal("arm matcher must require event/source_owner")
	}
	if arm.EventMatcher.Match(hex3073TypeSet(t, result, "ability/ultimate", "event/source_owner")) {
		t.Fatal("arm matcher must require event/ability_started")
	}
	if arm.EventMatcher.Match(hex3073TypeSet(t, result, hex3073CastEvent, "ability/spell", "event/source_owner")) {
		t.Fatal("arm matcher must reject ability/spell (non-ultimate)")
	}
}

// TestExperimentalHexplate3073BaselineAndArmedAttackSpeed: baseline AS; +50% while active.
func TestExperimentalHexplate3073BaselineAndArmedAttackSpeed(t *testing.T) {
	wantBaseline := hex3073ExpectedAS(0)
	wantArmed := hex3073ExpectedAS(1)
	if math.Abs(wantBaseline-hex3073BaseAS) > hex3073Tol {
		t.Fatalf("expected baseline=%v want %v", wantBaseline, hex3073BaseAS)
	}
	if math.Abs(wantArmed-0.90) > hex3073Tol {
		t.Fatalf("expected armed AS=%v want 0.90 (0.60*(1+0.50))", wantArmed)
	}

	compileReq, runReq := hex3073LoadFixture(t)
	hex3073SetDriver(&runReq, nil, 50)
	doneIdle := hex3073Run(t, compileReq, runReq)
	active, cd := hex3073State(t, doneIdle)
	if active != 0 || cd != 0 {
		t.Fatalf("before ult active/cd=%v/%v want 0/0", active, cd)
	}
	slot := hex3073SourceASSlot(t, doneIdle.FinalSnapshot)
	if math.Abs(slot.Base-hex3073BaseAS) > hex3073Tol {
		t.Fatalf("AS.base idle=%v want %v", slot.Base, hex3073BaseAS)
	}
	if math.Abs(slot.Resolved-wantBaseline) > hex3073Tol {
		t.Fatalf("AS.resolved idle=%v want baseline %v", slot.Resolved, wantBaseline)
	}

	compileReq2, runReq2 := hex3073LoadFixture(t)
	hex3073SetDriver(&runReq2, []model.DriverEntry{{
		EntryKey: "ult", AbilityRef: hex3073UltRef(),
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 100)
	done := hex3073Run(t, compileReq2, runReq2)
	if n := countEmittedEvents(done, hex3073CastEvent); n != 1 {
		t.Fatalf("ability_started=%d want 1", n)
	}
	active, cd = hex3073State(t, done)
	if active != 1 || cd != 1 {
		t.Fatalf("after ult active/cd=%v/%v want 1/1", active, cd)
	}
	slot = hex3073SourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-hex3073BaseAS) > hex3073Tol {
		t.Fatalf("AS.base after arm=%v want %v (must not overwrite base)", slot.Base, hex3073BaseAS)
	}
	if math.Abs(slot.Resolved-wantArmed) > hex3073Tol {
		t.Fatalf("AS.resolved after arm=%v want %v", slot.Resolved, wantArmed)
	}
}

// TestExperimentalHexplate3073NonUltimateCastDoesNotArm: unrelated/non-ultimate cast must not arm.
func TestExperimentalHexplate3073NonUltimateCastDoesNotArm(t *testing.T) {
	compileReq, runReq := hex3073LoadFixture(t)
	hex3073SetDriver(&runReq, []model.DriverEntry{{
		EntryKey: "spell", AbilityRef: hex3073SpellRef(),
		Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0,
	}}, 50)
	done := hex3073Run(t, compileReq, runReq)
	if n := countEmittedEvents(done, hex3073CastEvent); n != 1 {
		t.Fatalf("ability_started=%d want 1 (spell still emits cast event)", n)
	}
	active, cd := hex3073State(t, done)
	if active != 0 || cd != 0 {
		t.Fatalf("after non-ultimate active/cd=%v/%v want 0/0", active, cd)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-hex3073ExpectedAS(0)) > hex3073Tol {
		t.Fatalf("AS after non-ultimate=%v want baseline %v", got, hex3073ExpectedAS(0))
	}
}

// TestExperimentalHexplate3073ActiveExactBoundary: active at 7999ms; baseline at 8000ms.
func TestExperimentalHexplate3073ActiveExactBoundary(t *testing.T) {
	wantArmed := hex3073ExpectedAS(1)
	wantBaseline := hex3073ExpectedAS(0)

	compileReq, runReq := hex3073LoadFixture(t)
	hex3073SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: hex3073UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe_live", AbilityRef: hex3073ProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 7999},
	}, 7999)
	doneLive := hex3073Run(t, compileReq, runReq)
	active, _ := hex3073State(t, doneLive)
	if active != 1 {
		t.Fatalf("overdrive_active@7999=%v want 1 (still in [0,8000))", active)
	}
	if got := sourceAttrResolved(t, doneLive.FinalSnapshot, "attack_speed"); math.Abs(got-wantArmed) > hex3073Tol {
		t.Fatalf("AS@7999=%v want armed %v", got, wantArmed)
	}

	compileReq2, runReq2 := hex3073LoadFixture(t)
	hex3073SetDriver(&runReq2, []model.DriverEntry{
		{EntryKey: "ult", AbilityRef: hex3073UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "probe_expired", AbilityRef: hex3073ProbeRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 8000},
	}, 8000)
	doneExpired := hex3073Run(t, compileReq2, runReq2)
	active, cd := hex3073State(t, doneExpired)
	if active != 0 {
		t.Fatalf("overdrive_active@8000=%v want 0 (exact expiry)", active)
	}
	if cd != 1 {
		t.Fatalf("overdrive_cooldown@8000=%v want 1 (CD still live until 30000)", cd)
	}
	if got := sourceAttrResolved(t, doneExpired.FinalSnapshot, "attack_speed"); math.Abs(got-wantBaseline) > hex3073Tol {
		t.Fatalf("AS@8000=%v want baseline %v", got, wantBaseline)
	}
}

// TestExperimentalHexplate3073CooldownExactBoundaryAndRearm: CD from ult cast; 29999 blocks; 30000 rearms.
func TestExperimentalHexplate3073CooldownExactBoundaryAndRearm(t *testing.T) {
	wantBaseline := hex3073ExpectedAS(0)
	wantArmed := hex3073ExpectedAS(1)

	// Blocked re-arm: second ultimate before 30000ms must not refresh/rearm active.
	// Prove via provider state + cast evidence, not only final AS.
	compileReq, runReq := hex3073LoadFixture(t)
	hex3073SetDriver(&runReq, []model.DriverEntry{
		{EntryKey: "ult0", AbilityRef: hex3073UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "ult_blocked", AbilityRef: hex3073UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 29999},
	}, 29999)
	doneBlocked := hex3073Run(t, compileReq, runReq)
	if n := countEmittedEvents(doneBlocked, hex3073CastEvent); n != 2 {
		t.Fatalf("ability_started=%d want 2 (ult0 + blocked attempt)", n)
	}
	active, cd := hex3073State(t, doneBlocked)
	if active != 0 {
		t.Fatalf("active after blocked re-ult=%v want 0 (cooldown_zero blocked arm)", active)
	}
	if cd != 1 {
		t.Fatalf("cooldown after blocked re-ult=%v want 1 (still in [0,30000); condition not only AS)", cd)
	}
	if got := sourceAttrResolved(t, doneBlocked.FinalSnapshot, "attack_speed"); math.Abs(got-wantBaseline) > hex3073Tol {
		t.Fatalf("AS after blocked re-ult=%v want baseline %v", got, wantBaseline)
	}

	// Exact 30000ms allows rearm; active AS returns.
	compileReq2, runReq2 := hex3073LoadFixture(t)
	hex3073SetDriver(&runReq2, []model.DriverEntry{
		{EntryKey: "ult0", AbilityRef: hex3073UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 0},
		{EntryKey: "ult_ready", AbilityRef: hex3073UltRef(), Source: model.SelectorSource, Target: model.SelectorTarget, FirstAtMs: 30000},
	}, 30050)
	doneReady := hex3073Run(t, compileReq2, runReq2)
	if n := countEmittedEvents(doneReady, hex3073CastEvent); n != 2 {
		t.Fatalf("ability_started=%d want 2 (ult0 + rearm)", n)
	}
	active, cd = hex3073State(t, doneReady)
	if active != 1 || cd != 1 {
		t.Fatalf("after ult@30000 active/cd=%v/%v want 1/1", active, cd)
	}
	slot := hex3073SourceASSlot(t, doneReady.FinalSnapshot)
	if math.Abs(slot.Base-hex3073BaseAS) > hex3073Tol {
		t.Fatalf("AS.base after rearm=%v want %v", slot.Base, hex3073BaseAS)
	}
	if math.Abs(slot.Resolved-wantArmed) > hex3073Tol {
		t.Fatalf("AS.resolved after rearm=%v want %v", slot.Resolved, wantArmed)
	}
}
