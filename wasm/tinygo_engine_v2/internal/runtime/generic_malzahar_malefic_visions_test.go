package runtime

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_malzahar E Malefic Visions / 恶咒降临 — generic ABI Phase-A evidence
// (FROZEN_PLAN_REV: malzahar-e-anchored-dot-phase-a-v2).
//
// Self-contained CompileGeneric + RunGeneric fixture shaped like the Backend
// seed contract (provider + active state-write + provider-owned anchored tick):
//   - Rank-5 active: 100 mana / 7000ms cooldown; cast has NO direct damage
//   - Cast overrides provider_target scalar malefic_visions_active → 1
//     (default0 / max1 / duration4000 / refresh_on_write)
//   - Anchored tick interval250 / startDelay0 / anchor provider_target+state key
//   - Exactly 16 magic ticks at 250,500,...,4000 inclusive
//   - Each raw = 13.75 + 0.05*source.ap.resolved; total = 220 + 0.80 AP
//   - Ordinary magic mitigation; ticks do not re-write the anchor or recurse
//
// Wiki identity (EXTRA-only local sidecar, fail-closed in tests):
//   candidateKey hero_skill|hero_malzahar|E|恶咒降临
//   revision 4015185
//   SHA256 9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84
//
// Explicit Phase-A exclusions (fixture must not model these ops; comments only):
//   Q/R refresh, bounce/death spread, mana restore, minion execute, cleanse,
//   multi-target, indirect/spell-effect tags, ranks 1–4, mid-duration AP
//   snapshot fidelity / live actions, cast time/range, live migration/E2E.

const (
	malzaharMVEProviderRef    = "provider_hero_malzahar_malefic_visions"
	malzaharMVEStableID       = "hero_malzahar"
	malzaharMVEStateKey       = "malefic_visions_active"
	malzaharMVEAbilityKey     = "malefic_visions"
	malzaharMVETickAbilityKey = "malefic_visions_tick"
	malzaharMVETickOpRef      = "op:malefic_visions_tick"

	malzaharMVECandidateKey = "hero_skill|hero_malzahar|E|恶咒降临"
	malzaharMVERevisionID   = 4015185
	malzaharMVEContentSHA   = "9098ee2fbe7dfb33d1ca375bbce0c68788fd60378780aa4ddab8afc46736ba84"

	malzaharMVETickFlat   = 13.75
	malzaharMVEAPRatio    = 0.05
	malzaharMVETotalFlat  = 220.0
	malzaharMVETotalAPRat = 0.80
	malzaharMVEManaCost   = 100.0
	malzaharMVECDMs       = 7000.0
	malzaharMVEDurationMs = 4000.0
	malzaharMVEIntervalMs = int64(250)
	malzaharMVETickCount  = 16

	malzaharMVEFixtureMana = 500.0
	malzaharMVETargetHP    = 100000.0
	malzaharMVETol         = 1e-9
)

func malzaharMVEExpectedTickRaw(ap float64) float64 {
	return malzaharMVETickFlat + malzaharMVEAPRatio*ap
}

func malzaharMVEExpectedTotalRaw(ap float64) float64 {
	return malzaharMVETotalFlat + malzaharMVETotalAPRat*ap
}

func malzaharMVEExpectedTickTimes(castAt int64) []int64 {
	out := make([]int64, 0, malzaharMVETickCount)
	for i := 1; i <= malzaharMVETickCount; i++ {
		out = append(out, castAt+int64(i)*malzaharMVEIntervalMs)
	}
	return out
}

func malzaharMVETimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func malzaharMVEStateSchema() map[string]interface{} {
	return map[string]interface{}{
		malzaharMVEStateKey: malzaharMVETimedSlot(0, 1, malzaharMVEDurationMs),
	}
}

func malzaharMVEEnsureTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/tick", Domain: "ability"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
		{Key: "damage/magic", Domain: "damage"},
	}
	have := map[string]bool{}
	for _, t := range req.TypeCatalog.Types {
		have[t.Key] = true
	}
	for _, e := range need {
		if !have[e.Key] {
			req.TypeCatalog.Types = append(req.TypeCatalog.Types, e)
		}
	}
}

func malzaharMVETickAmount() *model.GenericFormulaExpr {
	flat := malzaharMVETickFlat
	ratio := malzaharMVEAPRatio
	return &model.GenericFormulaExpr{
		Op: "add",
		Args: []model.GenericFormulaExpr{
			{Op: "const", Value: &flat},
			{
				Op: "mul",
				Args: []model.GenericFormulaExpr{
					{Op: "const", Value: &ratio},
					{Op: "read", Path: "source.attr.ap.resolved"},
				},
			},
		},
	}
}

func malzaharMVEActiveAbility() model.AbilityDefinition {
	cost := malzaharMVEManaCost
	cd := malzaharMVECDMs
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: malzaharMVEAbilityKey,
		Kind:       "active",
		Types:      []string{},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// Cast: provider_target override only — no direct damage on impact.
		Operations: []model.OperationDefinition{{
			Operation:   "state_change",
			Target:      "source",
			Ref:         malzaharMVEStateKey,
			Types:       []string{"state_scope/provider_target"},
			ValuePolicy: "override",
			Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
		}},
	}
}

func malzaharMVETickAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: malzaharMVETickAbilityKey,
		Kind:       "tick",
		Types:      []string{"ability/tick"},
		TickSpec: &model.TickSpec{
			IntervalMs:     malzaharMVEIntervalMs,
			StartDelayMs:   0,
			AnchorScope:    "state_scope/provider_target",
			AnchorStateKey: malzaharMVEStateKey,
			OnTick: []model.OperationDefinition{{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/magic",
				Ref:        malzaharMVETickOpRef,
				Amount:     malzaharMVETickAmount(),
			}},
		},
	}
}

func malzaharMVEProviderDef() model.ProviderDefinition {
	return model.ProviderDefinition{
		ProviderKey:        malzaharMVEProviderRef,
		Kind:               "passive",
		StableID:           malzaharMVEStableID,
		InitialStateSchema: malzaharMVEStateSchema(),
		Abilities: []model.AbilityDefinition{
			malzaharMVEActiveAbility(),
			malzaharMVETickAbility(),
		},
	}
}

func malzaharMVEMountProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, malzaharMVEProviderDef())
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: malzaharMVEProviderRef, DefinitionRef: malzaharMVEProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(
			runReq.InitialSnapshot.Combatants[i].Providers,
			model.CombatantProviderSnapshot{
				ProviderRef: malzaharMVEProviderRef, DefinitionRef: malzaharMVEProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		)
	}
}

func malzaharMVEAbilityRef() string {
	return "source.provider[" + malzaharMVEProviderRef + "].ability[" + malzaharMVEAbilityKey + "]"
}

type malzaharMVEFixtureOpts struct {
	ap float64
	mr float64
}

func malzaharMVELoadFixture(t *testing.T, opts malzaharMVEFixtureOpts) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	malzaharMVEEnsureTypes(&compileReq)
	malzaharMVEMountProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ap", model.AttributeSlotDef{
		Base: opts.ap, Current: opts.ap, Max: opts.ap, Resolved: opts.ap,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: malzaharMVEFixtureMana, Max: malzaharMVEFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: malzaharMVETargetHP, Current: malzaharMVETargetHP,
		Max: malzaharMVETargetHP, Resolved: malzaharMVETargetHP,
	})
	if opts.mr != 0 {
		setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "magic_resist", model.AttributeSlotDef{
			Base: opts.mr, Current: opts.mr, Max: opts.mr, Resolved: opts.mr,
		})
	}

	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 100
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func malzaharMVERun(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func malzaharMVESetCasts(runReq *model.RunRequest, times []int64) {
	ref := malzaharMVEAbilityRef()
	entries := make([]model.DriverEntry, 0, len(times))
	for i, at := range times {
		entries = append(entries, model.DriverEntry{
			EntryKey:   "e_" + itoaRuntime(i),
			AbilityRef: ref,
			Source:     model.SelectorSource,
			Target:     model.SelectorTarget,
			FirstAtMs:  at,
		})
	}
	runReq.DriverPlan.Entries = entries
}

func malzaharMVEAssertExactTimes(t *testing.T, got, want []int64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("times=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("times=%v want %v", got, want)
		}
	}
}

func malzaharMVETickDamageItems(done model.DoneResult) []model.EvidenceItem {
	var out []model.EvidenceItem
	for _, item := range damageEvidenceItems(done) {
		if phantom, _ := item.Data["phantom"].(bool); phantom {
			continue
		}
		if evidenceDataString(item.Data, "operationRef") != malzaharMVETickOpRef {
			continue
		}
		out = append(out, item)
	}
	return out
}

func malzaharMVETickDamageAt(done model.DoneResult, timeMs int64) (raw, mitigated float64, source, target string, ok bool) {
	for _, item := range malzaharMVETickDamageItems(done) {
		if item.TimeMs != timeMs {
			continue
		}
		return evidenceDataFloat(item.Data, "rawAmount"),
			evidenceDataFloat(item.Data, "mitigatedAmount"),
			evidenceDataString(item.Data, "source"),
			evidenceDataString(item.Data, "target"),
			true
	}
	return 0, 0, "", "", false
}

func malzaharMVEActiveState(t *testing.T, snap model.Snapshot) float64 {
	t.Helper()
	for _, c := range snap.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		raw, ok := c.ProviderState[malzaharMVEProviderRef]
		if !ok {
			return 0
		}
		bag, ok := raw.(map[string]interface{})
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
		v, _ := values[malzaharMVEStateKey].(float64)
		return v
	}
	t.Fatalf("source combatant missing in snapshot")
	return 0
}

func malzaharMVESourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func malzaharMVESkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func malzaharMVEFindProvider(compileReq model.CompileRequest) *model.ProviderDefinition {
	for i := range compileReq.SharedProviders {
		p := &compileReq.SharedProviders[i]
		if p.ProviderKey == malzaharMVEProviderRef {
			return p
		}
	}
	return nil
}

func malzaharMVEWikiSidecarPath(t *testing.T) string {
	t.Helper()
	// runtime → internal → tinygo_engine_v2 → wasm → repo root
	path := filepath.Join("..", "..", "..", "..",
		"数据参考", "lol-wiki-extra-mechanisms", "normalized", "generic", "malzahar-e.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("wiki sidecar missing at %s: %v (fail closed)", path, err)
	}
	return path
}

type malzaharMVEWikiSidecar struct {
	CandidateKey  string `json:"candidateKey"`
	RevisionID    int    `json:"revisionId"`
	ContentSHA256 string `json:"contentSha256"`
	SkillKey      string `json:"skillKey"`
	ZhDisplayName string `json:"zhDisplayName"`
	Fields        struct {
		Description  string `json:"description"`
		Description2 string `json:"description2"`
		Leveling     string `json:"leveling"`
		Cooldown     string `json:"cooldown"`
		Cost         string `json:"cost"`
		Costtype     string `json:"costtype"`
		Damagetype   string `json:"damagetype"`
		Notes        string `json:"notes"`
	} `json:"fields"`
	FieldPresence map[string]bool `json:"fieldPresence"`
}

func malzaharMVELoadWikiSidecar(t *testing.T) malzaharMVEWikiSidecar {
	t.Helper()
	raw, err := os.ReadFile(malzaharMVEWikiSidecarPath(t))
	if err != nil {
		t.Fatalf("read wiki sidecar: %v", err)
	}
	var doc malzaharMVEWikiSidecar
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse wiki sidecar: %v", err)
	}
	return doc
}

func malzaharMVEAssertWikiSidecar(t *testing.T) {
	t.Helper()
	doc := malzaharMVELoadWikiSidecar(t)
	if doc.CandidateKey != malzaharMVECandidateKey {
		t.Fatalf("candidateKey=%q want %q", doc.CandidateKey, malzaharMVECandidateKey)
	}
	if doc.RevisionID != malzaharMVERevisionID {
		t.Fatalf("revisionId=%d want %d", doc.RevisionID, malzaharMVERevisionID)
	}
	if doc.ContentSHA256 != malzaharMVEContentSHA {
		t.Fatalf("contentSha256=%q want %q", doc.ContentSHA256, malzaharMVEContentSHA)
	}
	if doc.SkillKey != "E" || doc.ZhDisplayName != "恶咒降临" {
		t.Fatalf("skill/zh=%q/%q want E/恶咒降临", doc.SkillKey, doc.ZhDisplayName)
	}
	tracked := []string{
		"description", "description2", "leveling", "cooldown",
		"cost", "costtype", "damagetype", "notes",
	}
	for _, key := range tracked {
		if !doc.FieldPresence[key] {
			t.Fatalf("fieldPresence[%s]=false want true (fail closed)", key)
		}
	}
	if doc.Fields.Leveling == "" || doc.Fields.Cooldown == "" || doc.Fields.Cost == "" {
		t.Fatal("leveling/cooldown/cost empty (fail closed on tracked numeric-bearing fields)")
	}
	if doc.Fields.Costtype == "" || doc.Fields.Damagetype == "" {
		t.Fatal("costtype/damagetype empty (fail closed)")
	}
	if doc.Fields.Description == "" || doc.Fields.Notes == "" {
		t.Fatal("description/notes empty (fail closed)")
	}
}

func malzaharMVEAssertCompileShape(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	found := malzaharMVEFindProvider(compileReq)
	if found == nil {
		t.Fatal("provider_hero_malzahar_malefic_visions missing from SharedProviders")
	}
	if found.StableID != malzaharMVEStableID {
		t.Fatalf("stableID=%q want %q", found.StableID, malzaharMVEStableID)
	}

	schema, ok := found.InitialStateSchema[malzaharMVEStateKey].(map[string]interface{})
	if !ok {
		t.Fatalf("initialStateSchema missing %s: %+v", malzaharMVEStateKey, found.InitialStateSchema)
	}
	if schema["refreshPolicy"] != model.ProviderStateRefreshOnWrite {
		t.Fatalf("refreshPolicy=%v want %v", schema["refreshPolicy"], model.ProviderStateRefreshOnWrite)
	}
	if math.Abs(schema["defaultValue"].(float64)) > malzaharMVETol ||
		math.Abs(schema["maxValue"].(float64)-1) > malzaharMVETol {
		t.Fatalf("state default/max=%v/%v want 0/1", schema["defaultValue"], schema["maxValue"])
	}
	if math.Abs(schema["durationMs"].(float64)-malzaharMVEDurationMs) > malzaharMVETol {
		t.Fatalf("durationMs=%v want %v", schema["durationMs"], malzaharMVEDurationMs)
	}

	var active, tick *model.AbilityDefinition
	for i := range found.Abilities {
		switch found.Abilities[i].AbilityKey {
		case malzaharMVEAbilityKey:
			active = &found.Abilities[i]
		case malzaharMVETickAbilityKey:
			tick = &found.Abilities[i]
		}
	}
	if active == nil {
		t.Fatal("active malefic_visions missing")
	}
	if tick == nil {
		t.Fatal("tick malefic_visions_tick missing")
	}

	if active.Kind != "active" {
		t.Fatalf("active kind=%q want active", active.Kind)
	}
	if active.Cost == nil || active.Cost.ResourceKey != "mana" ||
		active.Cost.Amount.Op != "const" || active.Cost.Amount.Value == nil ||
		math.Abs(*active.Cost.Amount.Value-malzaharMVEManaCost) > malzaharMVETol {
		t.Fatalf("active cost=%+v want mana const 100", active.Cost)
	}
	if active.Cooldown == nil || active.Cooldown.DurationMs.Op != "const" ||
		active.Cooldown.DurationMs.Value == nil ||
		math.Abs(*active.Cooldown.DurationMs.Value-malzaharMVECDMs) > malzaharMVETol {
		t.Fatalf("active cooldown=%+v want const 7000", active.Cooldown)
	}
	if len(active.Operations) != 1 {
		t.Fatalf("active operations=%d want 1 (state_change only; no direct damage)", len(active.Operations))
	}
	op := active.Operations[0]
	if op.Operation != "state_change" || op.ValuePolicy != "override" ||
		op.Ref != malzaharMVEStateKey ||
		len(op.Types) != 1 || op.Types[0] != "state_scope/provider_target" {
		t.Fatalf("active op=%+v want state_change provider_target override malefic_visions_active", op)
	}
	for _, o := range active.Operations {
		if o.Operation == "damage" {
			t.Fatalf("active must not deal direct damage: %+v", o)
		}
	}

	if tick.Kind != "tick" || tick.TickSpec == nil {
		t.Fatalf("tick ability=%+v want kind tick with TickSpec", tick)
	}
	ts := tick.TickSpec
	if ts.IntervalMs != malzaharMVEIntervalMs || ts.StartDelayMs != 0 {
		t.Fatalf("tick interval/startDelay=%d/%d want 250/0", ts.IntervalMs, ts.StartDelayMs)
	}
	if ts.AnchorScope != "state_scope/provider_target" || ts.AnchorStateKey != malzaharMVEStateKey {
		t.Fatalf("anchor=%q/%q want provider_target/%s", ts.AnchorScope, ts.AnchorStateKey, malzaharMVEStateKey)
	}
	if len(ts.OnTick) != 1 {
		t.Fatalf("onTick ops=%d want exactly 1 magic damage", len(ts.OnTick))
	}
	dmg := ts.OnTick[0]
	if dmg.Operation != "damage" || dmg.DamageType != "damage/magic" || dmg.Ref != malzaharMVETickOpRef {
		t.Fatalf("onTick[0]=%+v want damage/magic %s", dmg, malzaharMVETickOpRef)
	}

	// Excluded Phase-A operations must be absent from the fixture.
	excludedOps := map[string]bool{
		"slow": true, "projectile": true, "multi_target": true,
		"execute_threshold": true, "resource_change": true,
		"state_duration_change": true, "emit_event": true,
		"apply_status": true, "repeat": true,
	}
	checkOps := func(ops []model.OperationDefinition, where string) {
		for _, o := range ops {
			if excludedOps[o.Operation] {
				t.Fatalf("%s must not include excluded op %q: %+v", where, o.Operation, o)
			}
			// No Q/R refresh listeners, bounce, cleanse, ranks 1–4 bands, etc.
			for _, typ := range o.Types {
				if typ == "damage_trait/indirect" || typ == "spell_effect" {
					t.Fatalf("%s must not tag indirect/spell_effect: %q", where, typ)
				}
			}
		}
	}
	checkOps(active.Operations, "active")
	checkOps(ts.OnTick, "onTick")
	if len(found.Listeners) != 0 {
		t.Fatalf("listeners=%d want 0 (no Q/R refresh / bounce listeners in Phase-A)", len(found.Listeners))
	}
	if len(found.Modifiers) != 0 {
		t.Fatalf("modifiers=%d want 0 (no cleanse/resist shred/etc in Phase-A)", len(found.Modifiers))
	}
	if len(found.Abilities) != 2 {
		t.Fatalf("abilities=%d want 2 (active + tick only; no ranks1-4 / multi-target helpers)", len(found.Abilities))
	}
}

// ---------------------------------------------------------------------------
// Evidence tests
// ---------------------------------------------------------------------------

func TestGenericMalzaharMaleficVisionsWikiSidecarIdentity(t *testing.T) {
	malzaharMVEAssertWikiSidecar(t)
}

func TestGenericMalzaharMaleficVisionsCompileShape(t *testing.T) {
	malzaharMVEAssertWikiSidecar(t)
	compileReq, runReq := malzaharMVELoadFixture(t, malzaharMVEFixtureOpts{})
	malzaharMVEAssertCompileShape(t, compileReq)
	done := malzaharMVERun(t, compileReq, runReq)
	if math.Abs(done.Summary.SourceDamageDealt) > malzaharMVETol {
		t.Fatalf("sourceDamageDealt=%v want 0 (shape-only; no cast)", done.Summary.SourceDamageDealt)
	}
}

func TestGenericMalzaharMaleficVisionsNoCastNoTicks(t *testing.T) {
	compileReq, runReq := malzaharMVELoadFixture(t, malzaharMVEFixtureOpts{ap: 0})
	runReq.DriverPlan.Entries = nil
	runReq.StopPolicy.DurationMs = 5000
	done := malzaharMVERun(t, compileReq, runReq)

	if n := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]; n != 0 {
		t.Fatalf("provider_tick=%d want 0 before cast/write", n)
	}
	if n := len(malzaharMVETickDamageItems(done)); n != 0 {
		t.Fatalf("malefic damage count=%d want 0", n)
	}
	if got := malzaharMVEActiveState(t, done.FinalSnapshot); got != 0 {
		t.Fatalf("malefic_visions_active=%v want 0", got)
	}
	if math.Abs(done.Summary.TargetFinalHp-malzaharMVETargetHP) > malzaharMVETol {
		t.Fatalf("targetFinalHp=%v want %v", done.Summary.TargetFinalHp, malzaharMVETargetHP)
	}
	if got := malzaharMVESourceMana(t, done.FinalSnapshot); math.Abs(got-malzaharMVEFixtureMana) > malzaharMVETol {
		t.Fatalf("mana=%v want %v (no cast)", got, malzaharMVEFixtureMana)
	}
}

func TestGenericMalzaharMaleficVisionsAP0Resist0SixteenTicks(t *testing.T) {
	malzaharMVEAssertWikiSidecar(t)
	compileReq, runReq := malzaharMVELoadFixture(t, malzaharMVEFixtureOpts{ap: 0, mr: 0})
	malzaharMVEAssertCompileShape(t, compileReq)
	malzaharMVESetCasts(&runReq, []int64{0})
	runReq.StopPolicy.DurationMs = 4500
	done := malzaharMVERun(t, compileReq, runReq)

	wantTimes := malzaharMVEExpectedTickTimes(0)
	malzaharMVEAssertExactTimes(t, anchoredTickTimes(done), wantTimes)
	if len(wantTimes) != malzaharMVETickCount || wantTimes[0] != 250 || wantTimes[len(wantTimes)-1] != 4000 {
		t.Fatalf("helper times=%v want 16 ticks 250..4000", wantTimes)
	}

	wantRaw := malzaharMVEExpectedTickRaw(0) // 13.75
	var rawSum, mitSum float64
	for _, at := range wantTimes {
		raw, mit, source, target, ok := malzaharMVETickDamageAt(done, at)
		if !ok {
			t.Fatalf("missing tick damage at %d", at)
		}
		if math.Abs(raw-wantRaw) > malzaharMVETol || math.Abs(mit-wantRaw) > malzaharMVETol {
			t.Fatalf("at %d raw/mit=%v/%v want %v/%v (MR0)", at, raw, mit, wantRaw, wantRaw)
		}
		if source != model.SelectorSource || target != model.SelectorTarget {
			t.Fatalf("at %d source/target=%q/%q want source/target", at, source, target)
		}
		rawSum += raw
		mitSum += mit
	}
	wantTotal := malzaharMVEExpectedTotalRaw(0) // 220
	if math.Abs(rawSum-wantTotal) > malzaharMVETol || math.Abs(mitSum-wantTotal) > malzaharMVETol {
		t.Fatalf("total raw/mit=%v/%v want %v", rawSum, mitSum, wantTotal)
	}
	// Inclusive final tick at 4000 executes; expire cleanup clears state afterward.
	if got := malzaharMVEActiveState(t, done.FinalSnapshot); got != 0 {
		t.Fatalf("after cleanup malefic_visions_active=%v want 0", got)
	}
	if n := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]; n != malzaharMVETickCount {
		t.Fatalf("provider_tick=%d want %d", n, malzaharMVETickCount)
	}
	if n := len(malzaharMVETickDamageItems(done)); n != malzaharMVETickCount {
		t.Fatalf("damage evidence=%d want %d", n, malzaharMVETickCount)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (single successful cast; ticks must not cast)", done.Summary.AbilityCastCount)
	}
}

func TestGenericMalzaharMaleficVisionsAP100MR100OrdinaryMitigation(t *testing.T) {
	const ap, mr = 100.0, 100.0
	compileReq, runReq := malzaharMVELoadFixture(t, malzaharMVEFixtureOpts{ap: ap, mr: mr})
	malzaharMVESetCasts(&runReq, []int64{0})
	runReq.StopPolicy.DurationMs = 4500
	done := malzaharMVERun(t, compileReq, runReq)

	wantTimes := malzaharMVEExpectedTickTimes(0)
	malzaharMVEAssertExactTimes(t, anchoredTickTimes(done), wantTimes)

	wantRaw := malzaharMVEExpectedTickRaw(ap)      // 18.75
	wantMit := expectedMitigatedMagic(wantRaw, mr) // ordinary 100/(100+MR)
	if math.Abs(wantRaw-18.75) > malzaharMVETol || math.Abs(wantMit-9.375) > malzaharMVETol {
		t.Fatalf("algebra raw/mit=%v/%v want 18.75/9.375", wantRaw, wantMit)
	}

	var rawSum, mitSum float64
	for _, at := range wantTimes {
		raw, mit, source, target, ok := malzaharMVETickDamageAt(done, at)
		if !ok {
			t.Fatalf("missing tick damage at %d", at)
		}
		if math.Abs(raw-wantRaw) > malzaharMVETol {
			t.Fatalf("at %d raw=%v want %v", at, raw, wantRaw)
		}
		if math.Abs(mit-wantMit) > malzaharMVETol {
			t.Fatalf("at %d mitigated=%v want %v (ordinary magic mitigation)", at, mit, wantMit)
		}
		if source != model.SelectorSource || target != model.SelectorTarget {
			t.Fatalf("at %d source/target=%q/%q", at, source, target)
		}
		rawSum += raw
		mitSum += mit
	}
	wantTotalRaw := malzaharMVEExpectedTotalRaw(ap)          // 300
	wantTotalMit := expectedMitigatedMagic(wantTotalRaw, mr) // 150
	if math.Abs(rawSum-wantTotalRaw) > malzaharMVETol {
		t.Fatalf("total raw=%v want %v", rawSum, wantTotalRaw)
	}
	if math.Abs(mitSum-wantTotalMit) > malzaharMVETol {
		t.Fatalf("total mitigated=%v want %v", mitSum, wantTotalMit)
	}
	if math.Abs(mitSum-150) > malzaharMVETol {
		t.Fatalf("total mitigated=%v want 150", mitSum)
	}
}

func TestGenericMalzaharMaleficVisionsManaCooldownGate(t *testing.T) {
	compileReq, runReq := malzaharMVELoadFixture(t, malzaharMVEFixtureOpts{ap: 0})
	malzaharMVEAssertCompileShape(t, compileReq)
	// Cast at 0 succeeds; early cast at 3500 rejected; cast at exactly 7000 succeeds.
	malzaharMVESetCasts(&runReq, []int64{0, 3500, 7000})
	runReq.StopPolicy.DurationMs = 11500
	done := malzaharMVERun(t, compileReq, runReq)

	if malzaharMVESkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for cast before 7000ms")
	}
	// Two successful casts: 500 - 100 - 100 = 300; early cast must not cost mana.
	if got := malzaharMVESourceMana(t, done.FinalSnapshot); math.Abs(got-300) > malzaharMVETol {
		t.Fatalf("mana=%v want 300 (two successful casts; early skipped)", got)
	}
	if done.Summary.AbilityCastCount != 2 {
		t.Fatalf("abilityCastCount=%d want 2 (early cast skipped; no second cost)", done.Summary.AbilityCastCount)
	}

	// gen1 from t=0: 250..4000; gen2 from t=7000: 7250..11000. Early cast must not spawn ticks.
	want := append(malzaharMVEExpectedTickTimes(0), malzaharMVEExpectedTickTimes(7000)...)
	malzaharMVEAssertExactTimes(t, anchoredTickTimes(done), want)
	if n := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]; n != 2*malzaharMVETickCount {
		t.Fatalf("provider_tick=%d want %d", n, 2*malzaharMVETickCount)
	}
	if n := len(malzaharMVETickDamageItems(done)); n != 2*malzaharMVETickCount {
		t.Fatalf("damage evidence=%d want %d", n, 2*malzaharMVETickCount)
	}
	// Second cast's inclusive final tick then cleanup.
	if got := malzaharMVEActiveState(t, done.FinalSnapshot); got != 0 {
		t.Fatalf("after second-gen cleanup malefic_visions_active=%v want 0", got)
	}
}

func TestGenericMalzaharMaleficVisionsNoRecursiveTickOrStateRewrite(t *testing.T) {
	compileReq, runReq := malzaharMVELoadFixture(t, malzaharMVEFixtureOpts{ap: 50})
	malzaharMVESetCasts(&runReq, []int64{0})
	runReq.StopPolicy.DurationMs = 4500
	done := malzaharMVERun(t, compileReq, runReq)

	// One successful cast → exactly 16 provider ticks and 16 damages.
	// If ticks re-wrote the anchor, refresh would spawn extra generations (>16 ticks).
	malzaharMVEAssertExactTimes(t, anchoredTickTimes(done), malzaharMVEExpectedTickTimes(0))
	if n := done.Evidence.CountsByKind[string(model.EvidenceKindProviderTick)]; n != malzaharMVETickCount {
		t.Fatalf("provider_tick=%d want %d (no recursive reschedule)", n, malzaharMVETickCount)
	}
	if n := len(malzaharMVETickDamageItems(done)); n != malzaharMVETickCount {
		t.Fatalf("damage evidence=%d want %d", n, malzaharMVETickCount)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (ticks must not re-cast / re-write via active)", done.Summary.AbilityCastCount)
	}
	// State evidence: after inclusive expiry cleanup the scalar is cleared (not re-armed by ticks).
	if got := malzaharMVEActiveState(t, done.FinalSnapshot); got != 0 {
		t.Fatalf("final malefic_visions_active=%v want 0 (ticks must not re-write anchor)", got)
	}
	wantRaw := malzaharMVEExpectedTickRaw(50) // 13.75 + 2.5 = 16.25
	for _, item := range malzaharMVETickDamageItems(done) {
		raw := evidenceDataFloat(item.Data, "rawAmount")
		if math.Abs(raw-wantRaw) > malzaharMVETol {
			t.Fatalf("at %d raw=%v want %v", item.TimeMs, raw, wantRaw)
		}
		if evidenceDataString(item.Data, "source") != model.SelectorSource {
			t.Fatalf("damage source=%q want source", evidenceDataString(item.Data, "source"))
		}
		if evidenceDataString(item.Data, "target") != model.SelectorTarget {
			t.Fatalf("damage target=%q want target", evidenceDataString(item.Data, "target"))
		}
	}
}
