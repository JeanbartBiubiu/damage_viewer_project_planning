package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_graves E Quickdraw / 快速拔枪 — fixed max True Grit Phase-A (generic ABI).
//
// League Wiki Template:Data Graves/Quickdraw (NOT Meraki/DataDragon numeric truth):
//   - revision 4007744
//   - contentSha256 ff4c65c5ce2a0ac1ae757271fbb924b35bf4eca1af0f4d07a69d865db901a4e1
//   - source: 数据参考/lol-wiki-current-champions/normalized/generic/graves-e.json
//
// Rank-5 Phase-A contract (user-approved max-stack approximation):
//   - mana 40; cooldown 12000 ms
//   - one cast writes true_grit_stacks directly 0→8 (override const 8); max 8; untimed
//   - armor and bonus_armor each add 19*stacks (=152 at 8)
//   - magic_resist and bonus_magic_resist each add 19*0.5*stacks (=76 at 8)
//   - panel baseline: armor 33, magic_resist 30, bonus_* 0, mana 325
//
// Explicit exclusions (completed boundary, not remaining blockers):
//   intermediate 0..7 states, 4s refresh/expiry, dash direction/geometry, reload,
//   attack reset, pellet CD reduction, collision/target acquisition, multi-target,
//   damage, full gameplay fidelity.
//
// Path: CompileFrame → session → RunFrame → ReleaseSessionFrame.
// No production runtime/ABI changes; no hero-specific production branches.

const (
	gravesQDProviderRef = "provider_hero_graves_quickdraw_max_stack"
	gravesQDStableID    = "hero_graves_e_quickdraw_max_stack"
	gravesQDAbilityKey  = "ability_hero_graves_quickdraw"
	gravesQDStacksKey   = "true_grit_stacks"

	gravesQDArmorModKey   = "graves_quickdraw_true_grit_armor"
	gravesQDBonusArmorMod = "graves_quickdraw_true_grit_bonus_armor"
	gravesQDMRModKey      = "graves_quickdraw_true_grit_magic_resist"
	gravesQDBonusMRMod    = "graves_quickdraw_true_grit_bonus_magic_resist"

	gravesQDMaxStacks   = 8.0
	gravesQDArmorPer    = 19.0
	gravesQDMRHalf      = 0.5
	gravesQDManaCost    = 40.0
	gravesQCDMs         = 12000.0
	gravesQDFixtureMana = 325.0
	gravesQDManaAfter1  = 285.0 // 325 - 40
	gravesQDManaAfter2  = 245.0 // 325 - 40 - 40

	gravesQDBaseArmor = 33.0
	gravesQDBaseMR    = 30.0
	gravesQDBonusBase = 0.0

	// Independent max-stack algebra (must not re-walk the model formula AST).
	gravesQDWantArmorBonus = 152.0 // 8 * 19
	gravesQDWantMRBonus    = 76.0  // 8 * 19 * 0.5
	gravesQDWantArmorRes   = 185.0 // 33 + 152
	gravesQDWantMRRes      = 106.0 // 30 + 76

	gravesQDTol = 1e-9
)

// Independent expected helpers — must not re-walk the model formula AST.

func gravesQDExpectedArmorBonus(stacks float64) float64 {
	return stacks * gravesQDArmorPer
}

func gravesQDExpectedMRBonus(stacks float64) float64 {
	return stacks * gravesQDArmorPer * gravesQDMRHalf
}

func gravesQDUntimedSlot(defaultValue, maxValue float64) map[string]interface{} {
	// Untimed Phase-A: durationMs=0 and no refreshPolicy (nightstalker-shaped).
	return map[string]interface{}{
		"defaultValue": defaultValue,
		"maxValue":     maxValue,
		"durationMs":   float64(0),
	}
}

func gravesQDStateSchema() map[string]interface{} {
	return map[string]interface{}{
		gravesQDStacksKey: gravesQDUntimedSlot(0, gravesQDMaxStacks),
	}
}

func gravesQDArmorValue() model.GenericFormulaExpr {
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			gfConst(gravesQDArmorPer),
			{Op: "read", Path: "provider.state." + gravesQDStacksKey},
		},
	}
}

// Nested binary mul: (19 * 0.5) * stacks — encodes Wiki 50% of bonus armor, not a baked 9.5.
func gravesQDMRValue() model.GenericFormulaExpr {
	nineteen := gravesQDArmorPer
	half := gravesQDMRHalf
	return model.GenericFormulaExpr{
		Op: "mul",
		Args: []model.GenericFormulaExpr{
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &nineteen},
					{Op: "const", Value: &half},
				},
			},
			{Op: "read", Path: "provider.state." + gravesQDStacksKey},
		},
	}
}

func gravesQDFlatAddModifier(modKey, target string, value model.GenericFormulaExpr) model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: modKey,
		Kind:        "attribute",
		Target:      target,
		ValuePolicy: "add",
		Value:       value,
	}
}

func gravesQDModifiers() []model.ModifierDefinition {
	armor := gravesQDArmorValue()
	mr := gravesQDMRValue()
	return []model.ModifierDefinition{
		gravesQDFlatAddModifier(gravesQDArmorModKey, "armor", armor),
		gravesQDFlatAddModifier(gravesQDBonusArmorMod, "bonus_armor", armor),
		gravesQDFlatAddModifier(gravesQDMRModKey, "magic_resist", mr),
		gravesQDFlatAddModifier(gravesQDBonusMRMod, "bonus_magic_resist", mr),
	}
}

func gravesQDAbility() model.AbilityDefinition {
	cost := gravesQDManaCost
	cd := gravesQCDMs
	eight := gravesQDMaxStacks
	return model.AbilityDefinition{
		AbilityKey: gravesQDAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Phase-A: one impact writes max stacks directly (no intermediate 0..7).
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         gravesQDStacksKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &eight},
			},
		},
	}
}

func gravesQDProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        gravesQDProviderRef,
		Kind:               "passive",
		StableID:           gravesQDStableID,
		InitialStateSchema: gravesQDStateSchema(),
		Modifiers:          gravesQDModifiers(),
		Abilities:          []model.AbilityDefinition{gravesQDAbility()},
	}
}

func ensureGravesQDTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "state_scope/provider", Domain: "state_scope"},
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

func configureGravesQDProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = []model.ProviderDefinition{gravesQDProviderDef()}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: gravesQDProviderRef, DefinitionRef: gravesQDProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: gravesQDProviderRef, DefinitionRef: gravesQDProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func gravesQDAbilityRef() string {
	return "source.provider[" + gravesQDProviderRef + "].ability[" + gravesQDAbilityKey + "]"
}

func loadGravesQDFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	compileReq.RulesHash = "rules.graves_quickdraw_max_stack"
	runReq.InitialSnapshot.SchemaHash = compileReq.SchemaHash
	runReq.InitialSnapshot.RulesHash = compileReq.RulesHash
	ensureGravesQDTypes(&compileReq)
	configureGravesQDProvider(&compileReq, &runReq)

	// hero_graves level-1 panel bootstrap (graves-champion-data.json) + bonus_* ensure at 0.
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "armor", model.AttributeSlotDef{
		Base: gravesQDBaseArmor, Current: gravesQDBaseArmor, Max: gravesQDBaseArmor, Resolved: gravesQDBaseArmor,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "magic_resist", model.AttributeSlotDef{
		Base: gravesQDBaseMR, Current: gravesQDBaseMR, Max: gravesQDBaseMR, Resolved: gravesQDBaseMR,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "bonus_armor", model.AttributeSlotDef{
		Base: gravesQDBonusBase, Current: gravesQDBonusBase, Max: gravesQDBonusBase, Resolved: gravesQDBonusBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "bonus_magic_resist", model.AttributeSlotDef{
		Base: gravesQDBonusBase, Current: gravesQDBonusBase, Max: gravesQDBonusBase, Resolved: gravesQDBonusBase,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: gravesQDFixtureMana, Max: gravesQDFixtureMana,
	})

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func assertGravesQDProviderShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	if len(compileReq.SharedProviders) != 1 {
		t.Fatalf("SharedProviders=%d want 1", len(compileReq.SharedProviders))
	}
	p := compileReq.SharedProviders[0]
	if p.ProviderKey != gravesQDProviderRef {
		t.Fatalf("providerKey=%q want %q", p.ProviderKey, gravesQDProviderRef)
	}
	if len(p.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no reload/geometry/timed listeners)", len(p.Listeners))
	}
	if len(p.InitialStateSchema) != 1 {
		t.Fatalf("InitialStateSchema keys=%d want 1 (true_grit_stacks only)", len(p.InitialStateSchema))
	}
	schema, ok := p.InitialStateSchema[gravesQDStacksKey].(map[string]interface{})
	if !ok {
		t.Fatalf("initialStateSchema missing %s: %+v", gravesQDStacksKey, p.InitialStateSchema)
	}
	if _, hasRefresh := schema["refreshPolicy"]; hasRefresh {
		t.Fatalf("true_grit_stacks must be untimed (no refreshPolicy): %+v", schema)
	}
	if math.Abs(schema["defaultValue"].(float64)) > 1e-12 ||
		math.Abs(schema["maxValue"].(float64)-gravesQDMaxStacks) > 1e-12 ||
		math.Abs(schema["durationMs"].(float64)) > 1e-12 {
		t.Fatalf("true_grit_stacks schema=%+v want default0/max8/duration0", schema)
	}

	if len(p.Modifiers) != 4 {
		t.Fatalf("modifiers=%d want 4 (armor/bonus_armor/MR/bonus_MR)", len(p.Modifiers))
	}
	wantMods := []struct {
		key, target string
		nestedMR    bool
	}{
		{gravesQDArmorModKey, "armor", false},
		{gravesQDBonusArmorMod, "bonus_armor", false},
		{gravesQDMRModKey, "magic_resist", true},
		{gravesQDBonusMRMod, "bonus_magic_resist", true},
	}
	for i, want := range wantMods {
		mod := p.Modifiers[i]
		if mod.ModifierKey != want.key || mod.Kind != "attribute" ||
			mod.Target != want.target || mod.ValuePolicy != "add" {
			t.Fatalf("modifier[%d]=%+v want key=%s target=%s add", i, mod, want.key, want.target)
		}
		if want.nestedMR {
			if mod.Value.Op != "mul" || len(mod.Value.Args) != 2 || mod.Value.Args[0].Op != "mul" {
				t.Fatalf("MR modifier[%d] value=%+v want nested mul(mul(19,0.5), stacks)", i, mod.Value)
			}
			inner := mod.Value.Args[0]
			if len(inner.Args) != 2 ||
				inner.Args[0].Op != "const" || inner.Args[0].Value == nil ||
				math.Abs(*inner.Args[0].Value-gravesQDArmorPer) > 1e-12 ||
				inner.Args[1].Op != "const" || inner.Args[1].Value == nil ||
				math.Abs(*inner.Args[1].Value-gravesQDMRHalf) > 1e-12 {
				t.Fatalf("MR nested const pair=%+v want 19 and 0.5", inner)
			}
			if mod.Value.Args[1].Op != "read" ||
				mod.Value.Args[1].Path != "provider.state."+gravesQDStacksKey {
				t.Fatalf("MR read=%+v want provider.state.%s", mod.Value.Args[1], gravesQDStacksKey)
			}
		} else {
			if mod.Value.Op != "mul" || len(mod.Value.Args) != 2 {
				t.Fatalf("armor modifier[%d] value=%+v want mul(19, stacks)", i, mod.Value)
			}
			if mod.Value.Args[0].Op != "const" || mod.Value.Args[0].Value == nil ||
				math.Abs(*mod.Value.Args[0].Value-gravesQDArmorPer) > 1e-12 {
				t.Fatalf("armor per-stack const=%+v want 19", mod.Value.Args[0])
			}
			if mod.Value.Args[1].Op != "read" ||
				mod.Value.Args[1].Path != "provider.state."+gravesQDStacksKey {
				t.Fatalf("armor read=%+v want provider.state.%s", mod.Value.Args[1], gravesQDStacksKey)
			}
		}
	}

	if len(p.Abilities) != 1 {
		t.Fatalf("abilities=%d want 1", len(p.Abilities))
	}
	ab := p.Abilities[0]
	if ab.AbilityKey != gravesQDAbilityKey || ab.Kind != "active" {
		t.Fatalf("ability=%+v want %s active", ab, gravesQDAbilityKey)
	}
	if ab.Cost == nil || ab.Cost.ResourceKey != "mana" ||
		ab.Cost.Amount.Op != "const" || ab.Cost.Amount.Value == nil ||
		math.Abs(*ab.Cost.Amount.Value-gravesQDManaCost) > 1e-12 {
		t.Fatalf("cost=%+v want mana const 40", ab.Cost)
	}
	if ab.Cooldown == nil || ab.Cooldown.DurationMs.Op != "const" || ab.Cooldown.DurationMs.Value == nil ||
		math.Abs(*ab.Cooldown.DurationMs.Value-gravesQCDMs) > 1e-12 {
		t.Fatalf("cooldown=%+v want const 12000", ab.Cooldown)
	}
	if len(ab.Operations) != 1 {
		t.Fatalf("ops=%d want 1 (state_change override 8)", len(ab.Operations))
	}
	op := ab.Operations[0]
	if op.Operation != "state_change" || op.Ref != gravesQDStacksKey ||
		op.ValuePolicy != "override" ||
		len(op.Types) != 1 || op.Types[0] != "state_scope/provider" ||
		op.Amount == nil || op.Amount.Op != "const" || op.Amount.Value == nil ||
		math.Abs(*op.Amount.Value-gravesQDMaxStacks) > 1e-12 {
		t.Fatalf("op=%+v want state_change provider override const 8", op)
	}
	assertGravesQDNoExcludedGraph(t, p)
}

func assertGravesQDNoExcludedGraph(t *testing.T, p model.ProviderDefinition) {
	t.Helper()
	for _, op := range p.Abilities[0].Operations {
		switch op.Operation {
		case "damage", "reload", "projectile", "dash", "multi_target", "geometry", "move":
			t.Fatalf("ability must not include excluded op %q: %+v", op.Operation, op)
		}
		if op.DamageType != "" {
			t.Fatalf("ability must not carry damageType: %+v", op)
		}
	}
	for _, mod := range p.Modifiers {
		if mod.Kind == "pipeline" || mod.Command == "damage" {
			t.Fatalf("must not include damage pipeline modifier: %+v", mod)
		}
	}
	for key, raw := range p.InitialStateSchema {
		if key != gravesQDStacksKey {
			t.Fatalf("unexpected state key %q (no intermediate/timed auxiliary states)", key)
		}
		obj, _ := raw.(map[string]interface{})
		if obj != nil {
			if dur, ok := obj["durationMs"].(float64); ok && dur != 0 {
				t.Fatalf("state %q durationMs=%v want 0 (no timed expiry)", key, dur)
			}
		}
	}
}

func gravesQDSourceMana(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		slot, ok := c.Resources["mana"]
		if !ok {
			t.Fatal("source mana missing")
		}
		return slot.Current
	}
	t.Fatal("source missing")
	return 0
}

func gravesQDStacks(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[gravesQDProviderRef].(map[string]interface{})
		if !ok {
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[gravesQDStacksKey].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func gravesQDSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

type gravesQDRunBundle struct {
	done      model.DoneResult
	sessionID string
	rulesHash string
	session   *Session
}

// runGravesQD exercises CompileFrame → session → RunFrame → ReleaseSessionFrame,
// then proves the released session cannot be run again.
func runGravesQD(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) gravesQDRunBundle {
	t.Helper()
	session := NewSession()
	session.ClearOutbox()
	if code := session.CompileFrame(encodeGenericFrame(model.FrameKindGenericCompile, compileReq)); code != 0 {
		t.Fatalf("CompileFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	compiled := lastGenericCompileResult(session.OutboxBytes())
	if !compiled.OK || compiled.SessionID == "" {
		t.Fatalf("compile failed: %+v", compiled)
	}
	entry, ok := session.genericSessions[compiled.SessionID]
	if !ok {
		t.Fatal("compiled session not registered")
	}
	var found bool
	for _, p := range entry.compiled.Providers {
		if p.ProviderKey != gravesQDProviderRef {
			continue
		}
		field, ok := p.StateFields[gravesQDStacksKey]
		if !ok {
			t.Fatal("true_grit_stacks state field missing after compile")
		}
		if !field.HasCap || field.MaxValue != gravesQDMaxStacks || field.DurationMs != 0 || field.RefreshPolicy != "" {
			t.Fatalf("compiled true_grit_stacks=%+v want max=8 untimed(duration0,no refresh)", field)
		}
		if math.Abs(field.DefaultValue) > 1e-12 {
			t.Fatalf("defaultValue=%v want 0", field.DefaultValue)
		}
		if len(p.Listeners) != 0 {
			t.Fatalf("compiled Listeners=%d want 0", len(p.Listeners))
		}
		found = true
		break
	}
	if !found {
		t.Fatal("graves quickdraw provider missing from compiled session")
	}

	runReq.SessionID = compiled.SessionID
	runReq.ExpectedRulesHash = compiled.RulesHash
	session.ClearOutbox()
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, runReq)); code != 0 {
		t.Fatalf("RunFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	done := lastGenericRunDone(session.OutboxBytes())
	if !done.OK {
		t.Fatalf("done.ok=false stop=%q", done.Summary.StopReason)
	}

	session.ClearOutbox()
	releaseReq := model.ReleaseSessionRequest{
		SessionID:         compiled.SessionID,
		ExpectedRulesHash: compiled.RulesHash,
	}
	if code := session.ReleaseSessionFrame(encodeGenericFrame(model.FrameKindGenericReleaseSession, releaseReq)); code != 0 {
		t.Fatalf("ReleaseSessionFrame code=%d err=%+v", code, lastGenericError(session.OutboxBytes()))
	}
	released := lastGenericReleaseDone(session.OutboxBytes())
	if !released.OK || !released.Released || released.SessionID != compiled.SessionID {
		t.Fatalf("release=%+v want ok released session %q", released, compiled.SessionID)
	}

	// Released session cannot be run again.
	session.ClearOutbox()
	rerun := runReq
	rerun.SessionID = compiled.SessionID
	rerun.ExpectedRulesHash = compiled.RulesHash
	if code := session.RunFrame(encodeGenericFrame(model.FrameKindGenericRun, rerun)); code != -1 {
		t.Fatalf("RunFrame after release code=%d want -1", code)
	}
	errPayload := lastGenericError(session.OutboxBytes())
	if errPayload.Code != model.GenericErrSessionNotFound {
		t.Fatalf("after release err=%q want %q", errPayload.Code, model.GenericErrSessionNotFound)
	}

	return gravesQDRunBundle{
		done: done, sessionID: compiled.SessionID, rulesHash: compiled.RulesHash, session: session,
	}
}

// TestGravesQuickdrawMaxStackAlgebraCrossCheck: independent 8*19 / 8*19*0.5 probes.
func TestGravesQuickdrawMaxStackAlgebraCrossCheck(t *testing.T) {
	armor := gravesQDExpectedArmorBonus(gravesQDMaxStacks)
	mr := gravesQDExpectedMRBonus(gravesQDMaxStacks)
	if math.Abs(armor-gravesQDWantArmorBonus) > 1e-12 || math.Abs(armor-152.0) > 1e-12 {
		t.Fatalf("armor bonus algebra=%v want 152 (8*19)", armor)
	}
	if math.Abs(mr-gravesQDWantMRBonus) > 1e-12 || math.Abs(mr-76.0) > 1e-12 {
		t.Fatalf("MR bonus algebra=%v want 76 (8*19*0.5)", mr)
	}
	if math.Abs(gravesQDBaseArmor+armor-gravesQDWantArmorRes) > 1e-12 {
		t.Fatalf("armor resolved algebra=%v want 185", gravesQDBaseArmor+armor)
	}
	if math.Abs(gravesQDBaseMR+mr-gravesQDWantMRRes) > 1e-12 {
		t.Fatalf("MR resolved algebra=%v want 106", gravesQDBaseMR+mr)
	}
}

// TestGravesQuickdrawMaxStackCompileFrameShape: CompileFrame exposes provider/state/ability/modifier
// shape and excludes damage/reload/geometry/intermediate/timed/multi-target graph.
func TestGravesQuickdrawMaxStackCompileFrameShape(t *testing.T) {
	compileReq, runReq := loadGravesQDFixture(t)
	assertGravesQDProviderShape(t, compileReq)
	bundle := runGravesQD(t, compileReq, runReq)
	if math.Abs(bundle.done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (no damage ops)", bundle.done.Summary.SourceDamageDealt)
	}
	if got := gravesQDStacks(t, bundle.done.FinalSnapshot); math.Abs(got) > gravesQDTol {
		t.Fatalf("stacks without cast=%v want 0", got)
	}
}

// TestGravesQuickdrawMaxStackCastManaAttrsCapCDRelease: first cast spends 40 mana and
// transitions 0→8; attrs resolve to 185/152/106/76; second cast after CD keeps cap 8;
// early cast is cooldown-rejected; ReleaseSessionFrame succeeds and session cannot rerun.
func TestGravesQuickdrawMaxStackCastManaAttrsCapCDRelease(t *testing.T) {
	compileReq, runReq := loadGravesQDFixture(t)
	assertGravesQDProviderShape(t, compileReq)

	ref := gravesQDAbilityRef()
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e1", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "e_early", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 1000},
		{EntryKey: "e2", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 12000},
	}
	runReq.StopPolicy.DurationMs = 12100

	bundle := runGravesQD(t, compileReq, runReq)
	done := bundle.done

	if got := gravesQDStacks(t, done.FinalSnapshot); math.Abs(got-gravesQDMaxStacks) > gravesQDTol {
		t.Fatalf("true_grit_stacks=%v want 8 (direct 0→8; capped after second cast)", got)
	}
	if got := gravesQDSourceMana(t, done.FinalSnapshot); math.Abs(got-gravesQDManaAfter2) > gravesQDTol {
		t.Fatalf("mana=%v want %v (two successful casts; early skipped; cost not bypassed)", got, gravesQDManaAfter2)
	}
	if gravesQDSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for early E during 12000ms CD")
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2 (e1+e2; early skipped)", done.Summary.AbilityCastCount)
	}

	armor := sourceAttrResolved(t, done.FinalSnapshot, "armor")
	bonusArmor := sourceAttrResolved(t, done.FinalSnapshot, "bonus_armor")
	mr := sourceAttrResolved(t, done.FinalSnapshot, "magic_resist")
	bonusMR := sourceAttrResolved(t, done.FinalSnapshot, "bonus_magic_resist")
	wantArmorBonus := gravesQDExpectedArmorBonus(gravesQDMaxStacks)
	wantMRBonus := gravesQDExpectedMRBonus(gravesQDMaxStacks)
	if math.Abs(wantArmorBonus-152.0) > 1e-12 || math.Abs(wantMRBonus-76.0) > 1e-12 {
		t.Fatalf("independent probes drifted: armorBonus=%v mrBonus=%v", wantArmorBonus, wantMRBonus)
	}
	if math.Abs(armor-(gravesQDBaseArmor+wantArmorBonus)) > gravesQDTol || math.Abs(armor-185.0) > gravesQDTol {
		t.Fatalf("armor.resolved=%v want 185 (33+152)", armor)
	}
	if math.Abs(bonusArmor-wantArmorBonus) > gravesQDTol || math.Abs(bonusArmor-152.0) > gravesQDTol {
		t.Fatalf("bonus_armor.resolved=%v want 152", bonusArmor)
	}
	if math.Abs(mr-(gravesQDBaseMR+wantMRBonus)) > gravesQDTol || math.Abs(mr-106.0) > gravesQDTol {
		t.Fatalf("magic_resist.resolved=%v want 106 (30+76)", mr)
	}
	if math.Abs(bonusMR-wantMRBonus) > gravesQDTol || math.Abs(bonusMR-76.0) > gravesQDTol {
		t.Fatalf("bonus_magic_resist.resolved=%v want 76", bonusMR)
	}
}

// TestGravesQuickdrawMaxStackFirstCastOnly: single cast proves mana −40 and direct 0→8
// without relying on the dual-cast CD fixture.
func TestGravesQuickdrawMaxStackFirstCastOnly(t *testing.T) {
	compileReq, runReq := loadGravesQDFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "e1", AbilityRef: gravesQDAbilityRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	bundle := runGravesQD(t, compileReq, runReq)
	done := bundle.done

	if got := gravesQDStacks(t, done.FinalSnapshot); math.Abs(got-gravesQDMaxStacks) > gravesQDTol {
		t.Fatalf("true_grit_stacks=%v want 8 after one cast", got)
	}
	if got := gravesQDSourceMana(t, done.FinalSnapshot); math.Abs(got-gravesQDManaAfter1) > gravesQDTol {
		t.Fatalf("mana=%v want %v", got, gravesQDManaAfter1)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
	if math.Abs(sourceAttrResolved(t, done.FinalSnapshot, "armor")-gravesQDWantArmorRes) > gravesQDTol {
		t.Fatalf("armor=%v want %v", sourceAttrResolved(t, done.FinalSnapshot, "armor"), gravesQDWantArmorRes)
	}
}
