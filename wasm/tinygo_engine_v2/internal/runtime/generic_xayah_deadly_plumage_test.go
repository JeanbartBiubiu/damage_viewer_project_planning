package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

// hero_xayah W Deadly Plumage / 致死羽衣 (generic ABI, Phase-A rank-5 1v1 completed).
//
// League Wiki Template:Data Xayah/Deadly Plumage (NOT Meraki/DataDragon numeric truth):
//   - revision 4010669
//   - contentSha256 09d5476533722311e85c4ca79813cd0bec2cf35d105be894b80dac14478845a7
//   - source: 数据参考/lol-wiki-current-champions/normalized/generic/xayah-w.json
//   - rank5: 40 mana; cooldown 14000 ms; duration 4000 ms; +55% attack speed
//   - additional feather: 25% of triggering attack damage (Phase-A 1v1 approx as
//     source-owned basic_damage * (1 + 0.25 * deadly_plumage_active) at
//     outgoing_pre_mitigation); benefits from triggering attack expected crit
//     exactly once; no Guinsoo Phantom Hit interaction; excludes on-hit/proc
//
// Completed Phase-A boundary (not full live-game fidelity):
//   - W cast / mana / CD / timed AS state / refresh
//   - merged basic_damage ×1.25 while active (not a second missile/damage instance)
//   - expected-crit once, then ×1.25 once; on-hit/proc unmultiplied; phantom non-replay
//
// Explicit exclusions (completed boundary wording, not remainingGap/blockers):
//   - movement speed; Rakan synergy; Runaan/multi-target
//   - projectile / in-flight / ward / blind / dodge / block
//   - separate secondary feather missile / second damage op
//   - other ranks; live migration / publish / E2E

const (
	xayahDPProviderRef = "hero:xayah"
	xayahDPStableID    = "hero_xayah"
	xayahDPWKey        = "deadly_plumage"
	xayahDPProbeKey    = "xayah_deadly_plumage_probe"
	xayahDPActiveKey   = "deadly_plumage_active"
	xayahDPASModKey    = "deadly_plumage_attack_speed"
	xayahDPBasicDmgMod = "deadly_plumage_basic_damage"
	xayahDPListenerArm = "listener_hero_xayah_deadly_plumage_arm"
	xayahDPAbilityType = "ability/xayah_deadly_plumage"
	xayahDPCastEvent   = "event/ability_started"
	xayahDPHitEvent    = "event/on_hit"
	xayahDPAAOpRef     = "op:xayah_deadly_plumage_aa"
	xayahDPOnHitOpRef  = "op:xayah_deadly_plumage_on_hit"
	xayahDPProcOpRef   = "op:xayah_deadly_plumage_proc"

	xayahDPManaCost    = 40.0
	xayahDPCDMs        = 14000.0
	xayahDPASBuffDurMs = 4000.0
	xayahDPASBonus     = 0.55
	xayahDPBaseAS      = 0.60
	xayahDPResolvedAS  = 0.93 // 0.60 * (1 + 0.55)
	xayahDPFixtureMana = 100.0
	xayahDPManaAfter1  = 60.0 // 100 - 40
	xayahDPManaAfter2  = 20.0 // 100 - 40 - 40

	xayahDPAABase      = 100.0
	xayahDPFeatherMul  = 0.25
	xayahDPActiveMul   = 1.25 // 1 + 0.25
	xayahDPOnHitAmt    = 20.0
	xayahDPProcAmt     = 15.0
	xayahDPCopyableAmt = 30.0
	xayahDPCritMult    = 2.3
)

func xayahDPFloat(v float64) *float64 { return &v }

func xayahDPTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func xayahDPStateSchema() map[string]interface{} {
	return map[string]interface{}{
		xayahDPActiveKey: xayahDPTimedSlot(0, 1, xayahDPASBuffDurMs),
	}
}

func xayahDPASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: xayahDPASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(xayahDPASBonus),
				{Op: "read", Path: "provider.state." + xayahDPActiveKey},
			},
		},
	}
}

// Phase-A merged basic-attack multiplier: basic_damage * (1 + 0.25 * deadly_plumage_active)
// at outgoing_pre_mitigation; excludes on-hit/proc. Not a second damage instance.
func xayahDPBasicDamageModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: xayahDPBasicDmgMod,
		Kind:        "pipeline",
		Command:     "damage",
		Channel:     "basic_damage",
		Bucket:      "all_instances",
		Stage:       "outgoing_pre_mitigation",
		Priority:    0,
		ValuePolicy: "multiply",
		Value: model.GenericFormulaExpr{
			Op: "add",
			Args: []model.GenericFormulaExpr{
				gfConst(1),
				{
					Op: "mul",
					Args: []model.GenericFormulaExpr{
						gfConst(xayahDPFeatherMul),
						{Op: "read", Path: "provider.state." + xayahDPActiveKey},
					},
				},
			},
		},
		Condition: &model.GenericFormulaExpr{
			Op: "min",
			Args: []model.GenericFormulaExpr{
				{
					Op: "eq",
					Args: []model.GenericFormulaExpr{
						{Op: "read", Path: "damage.trait.on_hit"},
						{Op: "const", Value: xayahDPFloat(0)},
					},
				},
				{
					Op: "eq",
					Args: []model.GenericFormulaExpr{
						{Op: "read", Path: "damage.trait.proc"},
						{Op: "const", Value: xayahDPFloat(0)},
					},
				},
			},
		},
	}
}

func xayahDPCastArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey: xayahDPListenerArm,
		// AbilityRef must stay empty: a populated abilityRef is a child cast, not a filter.
		// Isolation is via ability-type matcher (ability/xayah_deadly_plumage), not AbilityRef.
		AbilityRef: "",
		EventMatcher: model.TypeMatcher{All: []string{
			xayahDPCastEvent, "event/source_owner", xayahDPAbilityType,
		}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         xayahDPActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
			},
		},
	}
}

func xayahDPWAbility() model.AbilityDefinition {
	cost := xayahDPManaCost
	cd := xayahDPCDMs
	return model.AbilityDefinition{
		AbilityKey: xayahDPWKey,
		Kind:       "active",
		Types:      []string{xayahDPAbilityType},
		Cost: &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &cost},
		},
		Cooldown: &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		},
		// AS arm via ability_started → source-owner + ability-type listener; W itself has no damage ops
		// (Phase-A uses pipeline multiply on basic_damage — not a second missile instance).
		Operations: []model.OperationDefinition{},
	}
}

func xayahDPBasicAttackOps(includeOnHitProc bool) []model.OperationDefinition {
	ops := []model.OperationDefinition{
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: xayahDPFloat(xayahDPAABase)},
			CritEligible: true,
			Ref:          xayahDPAAOpRef,
		},
	}
	if includeOnHitProc {
		ops = append(ops,
			model.OperationDefinition{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Types:      []string{"damage_trait/on_hit"},
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: xayahDPFloat(xayahDPOnHitAmt)},
				Ref:        xayahDPOnHitOpRef,
			},
			model.OperationDefinition{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Types:      []string{"damage_trait/proc"},
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: xayahDPFloat(xayahDPProcAmt)},
				Ref:        xayahDPProcOpRef,
			},
		)
	}
	return ops
}

func xayahDPProbeAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: xayahDPProbeKey,
		Kind:       "active",
		// Typed as basic_attack so the probe does not synthesize ability_started
		// (which would re-arm deadly_plumage_active via the source-owner listener).
		Types:      []string{"ability/basic_attack"},
		Operations: xayahDPBasicAttackOps(false),
	}
}

func ensureXayahDPTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: xayahDPAbilityType, Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: "damage_trait/on_hit", Domain: "damage_trait"},
		{Key: "damage_trait/proc", Domain: "damage_trait"},
		{Key: xayahDPCastEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: xayahDPHitEvent, Domain: "event"},
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

func configureXayahDPProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        xayahDPProviderRef,
		Kind:               "champion",
		StableID:           xayahDPStableID,
		InitialStateSchema: xayahDPStateSchema(),
		Modifiers: []model.ModifierDefinition{
			xayahDPASModifier(),
			xayahDPBasicDamageModifier(),
		},
		Listeners: []model.ListenerDefinition{xayahDPCastArmListener()},
		Abilities: []model.AbilityDefinition{
			xayahDPWAbility(),
			xayahDPProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: xayahDPProviderRef, DefinitionRef: xayahDPProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func xayahDPWRef() string {
	return "source.provider[" + xayahDPProviderRef + "].ability[" + xayahDPWKey + "]"
}

func xayahDPProbeRef() string {
	return "source.provider[" + xayahDPProviderRef + "].ability[" + xayahDPProbeKey + "]"
}

func loadXayahDPFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureXayahDPTypes(&compileReq)
	configureXayahDPProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: xayahDPBaseAS, Current: xayahDPBaseAS, Max: xayahDPBaseAS, Resolved: xayahDPBaseAS,
	})
	setCombatantResource(&compileReq, &runReq, model.SelectorSource, "mana", model.ResourceSlotDef{
		Current: xayahDPFixtureMana, Max: xayahDPFixtureMana,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	// Zero armor so rawAmount == mitigatedAmount (pre-resistance evidence).
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "armor", model.AttributeSlotDef{
		Base: 0, Current: 0, Max: 0, Resolved: 0,
	})
	setSourceCritAttrs(&compileReq, &runReq, 0, xayahDPCritMult)

	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func runXayahDP(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func xayahDPStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[xayahDPProviderRef].(map[string]interface{})
		if !ok {
			// Idle schema fields may be absent from the snapshot until first write.
			return 0
		}
		state, ok := bag["state"].(map[string]interface{})
		if !ok {
			return 0
		}
		v, _ := state[key].(float64)
		return v
	}
	t.Fatal("source combatant missing")
	return 0
}

func xayahDPSourceMana(t *testing.T, snap model.Snapshot) float64 {
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

func xayahDPSourceASSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
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

func xayahDPSkipReasonCount(done model.DoneResult, reason model.AttemptSkipReason) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Data["skipReason"] == string(reason) {
			n++
		}
	}
	return n
}

func xayahDPDamageByOpRef(done model.DoneResult, opRef string, phantomOnly bool) (count int, rawSum float64) {
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataString(item.Data, "operationRef") != opRef {
			continue
		}
		isPhantom := evidenceDataBool(item.Data, "phantom")
		if phantomOnly && !isPhantom {
			continue
		}
		if !phantomOnly && isPhantom {
			continue
		}
		count++
		rawSum += evidenceDataFloat(item.Data, "rawAmount")
	}
	return
}

func xayahDPFirstDamageByOpRef(t *testing.T, done model.DoneResult, opRef string) map[string]interface{} {
	t.Helper()
	for _, item := range damageEvidenceItems(done) {
		if evidenceDataBool(item.Data, "phantom") {
			continue
		}
		if evidenceDataString(item.Data, "operationRef") == opRef {
			return item.Data
		}
	}
	t.Fatalf("missing original damage opRef=%s", opRef)
	return nil
}

func assertXayahDPWHasNoDamageOperations(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var ability *model.AbilityDefinition
	for i := range compileReq.SharedProviders[0].Abilities {
		a := &compileReq.SharedProviders[0].Abilities[i]
		if a.AbilityKey == xayahDPWKey {
			ability = a
			break
		}
	}
	if ability == nil {
		t.Fatal("deadly_plumage ability missing")
	}
	if len(ability.Operations) != 0 {
		t.Fatalf("deadly_plumage operations=%+v want empty (no damage ops / no second missile)", ability.Operations)
	}
	if len(ability.Types) != 1 || ability.Types[0] != xayahDPAbilityType {
		t.Fatalf("W types=%v want [%s]", ability.Types, xayahDPAbilityType)
	}
}

func assertXayahDPListenerAbilityTypeIsolation(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	var listener *model.ListenerDefinition
	for i := range compileReq.SharedProviders[0].Listeners {
		l := &compileReq.SharedProviders[0].Listeners[i]
		if l.ListenerKey == xayahDPListenerArm {
			listener = l
			break
		}
	}
	if listener == nil {
		t.Fatal("deadly_plumage arm listener missing")
	}
	if listener.AbilityRef != "" {
		t.Fatalf("AbilityRef=%q want empty (populated abilityRef is child cast, not filter)", listener.AbilityRef)
	}
	want := []string{xayahDPCastEvent, "event/source_owner", xayahDPAbilityType}
	if len(listener.EventMatcher.All) != 3 ||
		listener.EventMatcher.All[0] != want[0] ||
		listener.EventMatcher.All[1] != want[1] ||
		listener.EventMatcher.All[2] != want[2] {
		t.Fatalf("EventMatcher.All=%v want %v", listener.EventMatcher.All, want)
	}
	haveType := false
	for _, e := range compileReq.TypeCatalog.Types {
		if e.Key == xayahDPAbilityType && e.Domain == "ability" {
			haveType = true
			break
		}
	}
	if !haveType {
		t.Fatalf("type catalog missing %s domain=ability", xayahDPAbilityType)
	}
}

func assertXayahDPHasPipelineModifier(t *testing.T, compileReq model.CompileRequest) {
	t.Helper()
	found := false
	for _, m := range compileReq.SharedProviders[0].Modifiers {
		if m.ModifierKey != xayahDPBasicDmgMod {
			continue
		}
		found = true
		if m.Kind != "pipeline" || m.Command != "damage" || m.Channel != "basic_damage" ||
			m.Bucket != "all_instances" || m.Stage != "outgoing_pre_mitigation" ||
			m.Priority != 0 || m.ValuePolicy != "multiply" || m.Condition == nil {
			t.Fatalf("pipeline modifier contract mismatch: %+v", m)
		}
	}
	if !found {
		t.Fatal("deadly_plumage_basic_damage pipeline modifier missing")
	}
}

// TestGenericXayahDeadlyPlumageRank5ASCrossCheck: base AS 0.60 * (1 + 0.55) = 0.93.
func TestGenericXayahDeadlyPlumageRank5ASCrossCheck(t *testing.T) {
	want := xayahDPBaseAS * (1 + xayahDPASBonus)
	if math.Abs(want-xayahDPResolvedAS) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, xayahDPResolvedAS)
	}
	if math.Abs(want-0.93) > 1e-12 {
		t.Fatalf("resolved AS=%v want 0.93", want)
	}
}

// TestGenericXayahDeadlyPlumageBaselineASBeforeCast: no W cast → AS stays base; state idle.
func TestGenericXayahDeadlyPlumageBaselineASBeforeCast(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "probe", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	if countEmittedEvents(done, xayahDPCastEvent) != 0 {
		t.Fatalf("ability_started=%d want 0 before W cast", countEmittedEvents(done, xayahDPCastEvent))
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
		t.Fatalf("deadly_plumage_active=%v want 0 before cast", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, xayahDPBaseAS)
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPFixtureMana) > 1e-9 {
		t.Fatalf("mana=%v want %v (no W cost)", got, xayahDPFixtureMana)
	}
}

// TestGenericXayahDeadlyPlumageCastSpendsManaArmsTimedAS: cast → mana 100→60, state armed,
// AS 0.60→0.93; W itself deals no damage; base view unpolluted.
func TestGenericXayahDeadlyPlumageCastSpendsManaArmsTimedAS(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	assertXayahDPWHasNoDamageOperations(t, compileReq)
	assertXayahDPListenerAbilityTypeIsolation(t, compileReq)
	assertXayahDPHasPipelineModifier(t, compileReq)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	if countEmittedEvents(done, xayahDPCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1", countEmittedEvents(done, xayahDPCastEvent))
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPManaAfter1) > 1e-9 {
		t.Fatalf("mana=%v want %v", got, xayahDPManaAfter1)
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("deadly_plumage_active=%v want 1", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v", slot.Resolved, xayahDPResolvedAS)
	}
	if math.Abs(done.Summary.SourceDamageDealt) > 1e-12 {
		t.Fatalf("sourceDamageDealt=%v want 0 (W has no damage ops)", done.Summary.SourceDamageDealt)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1", done.Summary.AbilityCastCount)
	}
}

// TestGenericXayahDeadlyPlumageASExpiresAfter4000ms: timed state expires → AS restores to 0.60.
func TestGenericXayahDeadlyPlumageASExpiresAfter4000ms(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_expired", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 4001},
	}
	runReq.StopPolicy.DurationMs = 4100
	done := runXayahDP(t, compileReq, runReq)

	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
		t.Fatalf("deadly_plumage_active after expiry=%v want 0", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base after expiry=%v want %v", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after expiry=%v want baseline %v", slot.Resolved, xayahDPBaseAS)
	}
}

// TestGenericXayahDeadlyPlumageCooldownSkipDoesNotRecast: during CD, second attempt skips;
// no second cost / state rewrite / ability_started.
func TestGenericXayahDeadlyPlumageCooldownSkipDoesNotRecast(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runXayahDP(t, compileReq, runReq)

	if xayahDPSkipReasonCount(done, model.AttemptSkipCooldownNotReady) < 1 {
		t.Fatal("expected cooldown_not_ready skip for second W during CD")
	}
	if countEmittedEvents(done, xayahDPCastEvent) != 1 {
		t.Fatalf("ability_started=%d want 1 (no second cast event)", countEmittedEvents(done, xayahDPCastEvent))
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPManaAfter1) > 1e-9 {
		t.Fatalf("mana=%v want %v (no second cost)", got, xayahDPManaAfter1)
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("deadly_plumage_active=%v want 1 (still armed once)", got)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (second W skipped)", done.Summary.AbilityCastCount)
	}
}

// TestGenericXayahDeadlyPlumageRecastAfterCDRefreshesAS: after 14000ms CD, second cast succeeds,
// spends another 40 mana, and refresh_on_write re-arms the 4000ms AS window.
func TestGenericXayahDeadlyPlumageRecastAfterCDRefreshesAS(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 14000},
		{EntryKey: "probe_live", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 17999},
	}
	runReq.StopPolicy.DurationMs = 18050
	done := runXayahDP(t, compileReq, runReq)

	if countEmittedEvents(done, xayahDPCastEvent) != 2 {
		t.Fatalf("ability_started=%d want 2 (W only; probe is basic_attack)", countEmittedEvents(done, xayahDPCastEvent))
	}
	// AbilityCastCount includes the basic_attack probe used to force final resolve.
	if done.Summary.AbilityCastCount != 3 {
		t.Fatalf("abilityCastCount=%d want 3 (2 W + 1 probe)", done.Summary.AbilityCastCount)
	}
	if got := xayahDPSourceMana(t, done.FinalSnapshot); math.Abs(got-xayahDPManaAfter2) > 1e-9 {
		t.Fatalf("mana=%v want %v (two successful casts)", got, xayahDPManaAfter2)
	}
	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("deadly_plumage_active after refresh=%v want 1", got)
	}
	slot := xayahDPSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, xayahDPBaseAS)
	}
	if math.Abs(slot.Resolved-xayahDPResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after refresh=%v want %v", slot.Resolved, xayahDPResolvedAS)
	}
}

// TestGenericXayahDeadlyPlumageRefreshWindowExpires: second cast at 14000ms → AS expires at 18001.
func TestGenericXayahDeadlyPlumageRefreshWindowExpires(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w1", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "w2", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 14000},
		{EntryKey: "probe_expired", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 18001},
	}
	runReq.StopPolicy.DurationMs = 18100
	done := runXayahDP(t, compileReq, runReq)

	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
		t.Fatalf("deadly_plumage_active after refresh expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-xayahDPBaseAS) > 1e-9 {
		t.Fatalf("attack_speed after refresh expiry=%v want baseline %v", got, xayahDPBaseAS)
	}
}

// TestGenericXayahDeadlyPlumageInactiveBasicDamageUnmultiplied: idle state → base AA ×1.00 before resist.
func TestGenericXayahDeadlyPlumageInactiveBasicDamageUnmultiplied(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 0 {
		t.Fatalf("deadly_plumage_active=%v want 0", got)
	}
	data := xayahDPFirstDamageByOpRef(t, done, xayahDPAAOpRef)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-xayahDPAABase) > 1e-9 {
		t.Fatalf("inactive rawAmount=%v want %v (×1.00)", evidenceDataFloat(data, "rawAmount"), xayahDPAABase)
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-xayahDPAABase) > 1e-9 {
		t.Fatalf("inactive mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), xayahDPAABase)
	}
	// Formula still evaluates (1 + 0.25*0)=1 while idle; identity multiply is OK.
	for _, m := range damageEvidenceModifiers(data) {
		if evidenceDataString(m, "modifierKey") != xayahDPBasicDmgMod {
			continue
		}
		if math.Abs(evidenceDataFloat(m, "value")-1) > 1e-12 {
			t.Fatalf("inactive %s value=%v want 1", xayahDPBasicDmgMod, evidenceDataFloat(m, "value"))
		}
	}
}

// TestGenericXayahDeadlyPlumageActiveBasicDamageMultiplied: armed → base AA ×1.25 before resist.
func TestGenericXayahDeadlyPlumageActiveBasicDamageMultiplied(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	assertXayahDPWHasNoDamageOperations(t, compileReq)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 10},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	if got := xayahDPStateValue(t, done, xayahDPActiveKey); got != 1 {
		t.Fatalf("deadly_plumage_active=%v want 1", got)
	}
	want := xayahDPAABase * xayahDPActiveMul
	data := xayahDPFirstDamageByOpRef(t, done, xayahDPAAOpRef)
	if math.Abs(evidenceDataFloat(data, "rawAmount")-want) > 1e-9 {
		t.Fatalf("active rawAmount=%v want %v (×1.25)", evidenceDataFloat(data, "rawAmount"), want)
	}
	if math.Abs(evidenceDataFloat(data, "mitigatedAmount")-want) > 1e-9 {
		t.Fatalf("active mitigated=%v want %v", evidenceDataFloat(data, "mitigatedAmount"), want)
	}
	mods := damageEvidenceModifiers(data)
	found := false
	for _, m := range mods {
		if evidenceDataString(m, "modifierKey") == xayahDPBasicDmgMod {
			found = true
			if evidenceDataString(m, "stage") != "outgoing_pre_mitigation" {
				t.Fatalf("stage=%v want outgoing_pre_mitigation", m["stage"])
			}
		}
	}
	if !found {
		t.Fatalf("active AA must apply %s once: %+v", xayahDPBasicDmgMod, mods)
	}
	// W itself still has no separate second damage instance.
	nAA, _ := xayahDPDamageByOpRef(done, xayahDPAAOpRef, false)
	if nAA != 1 {
		t.Fatalf("original AA damage count=%d want 1 (merged multiply, not second instance)", nAA)
	}
}

// TestGenericXayahDeadlyPlumageExpectedCritOnceThenMultiply: expected crit then ×1.25 exactly once.
func TestGenericXayahDeadlyPlumageExpectedCritOnceThenMultiply(t *testing.T) {
	cases := []struct {
		name   string
		chance float64
	}{
		{"p0", 0},
		{"p025", 0.25},
		{"p1", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			compileReq, runReq := loadXayahDPFixture(t)
			setSourceCritAttrs(&compileReq, &runReq, tc.chance, xayahDPCritMult)
			// No crit pipeline modifiers — only attribute crit_chance/crit_damage.
			runReq.DriverPlan.Entries = []model.DriverEntry{
				{EntryKey: "w", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
				{EntryKey: "aa", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 10},
			}
			runReq.StopPolicy.DurationMs = 50
			done := runXayahDP(t, compileReq, runReq)

			_, _, normal, critPart, adjusted := wantExpectedCrit(xayahDPAABase, tc.chance, xayahDPCritMult)
			want := adjusted * xayahDPActiveMul
			data := xayahDPFirstDamageByOpRef(t, done, xayahDPAAOpRef)
			if math.Abs(evidenceDataFloat(data, "rawAmount")-want) > 1e-9 {
				t.Fatalf("p=%v raw=%v want expectedCrit(%v)+×1.25=%v (normal=%v critPart=%v)",
					tc.chance, evidenceDataFloat(data, "rawAmount"), adjusted, want, normal, critPart)
			}
			xayahMods := 0
			for _, m := range damageEvidenceModifiers(data) {
				if evidenceDataString(m, "modifierKey") == xayahDPBasicDmgMod {
					xayahMods++
				}
				if evidenceDataString(m, "command") == "crit" {
					t.Fatalf("must not mount crit pipeline modifiers: %+v", m)
				}
			}
			if xayahMods != 1 {
				t.Fatalf("deadly_plumage_basic_damage apply count=%d want 1", xayahMods)
			}
		})
	}
}

// TestGenericXayahDeadlyPlumageOnHitAndProcExcluded: on-hit/proc stay unmultiplied; base AA ×1.25.
func TestGenericXayahDeadlyPlumageOnHitAndProcExcluded(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)
	compileReq.SharedProviders[0].Abilities[1].Operations = xayahDPBasicAttackOps(true)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "w", AbilityRef: xayahDPWRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 10},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	aa := xayahDPFirstDamageByOpRef(t, done, xayahDPAAOpRef)
	wantAA := xayahDPAABase * xayahDPActiveMul
	if math.Abs(evidenceDataFloat(aa, "rawAmount")-wantAA) > 1e-9 {
		t.Fatalf("base AA raw=%v want %v", evidenceDataFloat(aa, "rawAmount"), wantAA)
	}

	onHit := xayahDPFirstDamageByOpRef(t, done, xayahDPOnHitOpRef)
	if math.Abs(evidenceDataFloat(onHit, "rawAmount")-xayahDPOnHitAmt) > 1e-9 {
		t.Fatalf("on_hit raw=%v want unmultiplied %v", evidenceDataFloat(onHit, "rawAmount"), xayahDPOnHitAmt)
	}
	for _, m := range damageEvidenceModifiers(onHit) {
		if evidenceDataString(m, "modifierKey") == xayahDPBasicDmgMod {
			t.Fatalf("on_hit must not apply %s", xayahDPBasicDmgMod)
		}
	}

	proc := xayahDPFirstDamageByOpRef(t, done, xayahDPProcOpRef)
	if math.Abs(evidenceDataFloat(proc, "rawAmount")-xayahDPProcAmt) > 1e-9 {
		t.Fatalf("proc raw=%v want unmultiplied %v", evidenceDataFloat(proc, "rawAmount"), xayahDPProcAmt)
	}
	for _, m := range damageEvidenceModifiers(proc) {
		if evidenceDataString(m, "modifierKey") == xayahDPBasicDmgMod {
			t.Fatalf("proc must not apply %s", xayahDPBasicDmgMod)
		}
	}
}

// TestGenericXayahDeadlyPlumagePhantomDoesNotReplayBaseOrRerunMul: Guinsoo phantom copies only
// CopyableOnHit peers; non-copyable base AA is not replayed; Xayah basic_damage mul not re-run.
func TestGenericXayahDeadlyPlumagePhantomDoesNotReplayBaseOrRerunMul(t *testing.T) {
	compileReq, runReq := loadXayahDPFixture(t)

	schema := xayahDPStateSchema()
	for k, v := range guinsooKStackSchema() {
		schema[k] = v
	}
	compileReq.SharedProviders[0].InitialStateSchema = schema

	one := 1.0
	compileReq.SharedProviders[0].Abilities[1].Operations = []model.OperationDefinition{
		{
			Operation:    "damage",
			Target:       "target",
			DamageType:   "damage/physical",
			Amount:       &model.GenericFormulaExpr{Op: "const", Value: xayahDPFloat(xayahDPAABase)},
			CritEligible: true,
			// CopyableOnHit defaults false — base attack must not phantom-replay.
			Ref: xayahDPAAOpRef,
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
			EventType: xayahDPHitEvent,
			Ref:       xayahDPHitEvent,
		},
	}
	compileReq.SharedProviders[0].Listeners = append(compileReq.SharedProviders[0].Listeners,
		model.ListenerDefinition{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{xayahDPHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/magic",
				Amount:        &model.GenericFormulaExpr{Op: "const", Value: xayahDPFloat(xayahDPCopyableAmt)},
				CopyableOnHit: true,
				Ref:           "op:guinsoo_copyable",
			}},
		},
		model.ListenerDefinition{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{xayahDPHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	)

	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			xayahDPProviderRef: map[string]interface{}{
				"state": map[string]interface{}{
					guinsooStackKey:  float64(3),
					xayahDPActiveKey: float64(1),
				},
			},
		}
	}

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: xayahDPProbeRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runXayahDP(t, compileReq, runReq)

	if n := countEmittedEvents(done, xayahDPHitEvent); n != 1 {
		t.Fatalf("on_hit emits=%d want 1 (phantom must not re-emit)", n)
	}

	nAA, rawAA := xayahDPDamageByOpRef(done, xayahDPAAOpRef, false)
	if nAA != 1 {
		t.Fatalf("original base AA count=%d want 1", nAA)
	}
	wantAA := xayahDPAABase * xayahDPActiveMul
	if math.Abs(rawAA-wantAA) > 1e-9 {
		t.Fatalf("original base AA raw=%v want %v", rawAA, wantAA)
	}
	if n := countPhantomDamageByOpRef(done, xayahDPAAOpRef); n != 0 {
		t.Fatalf("phantom base AA=%d want 0 (non-copyable; mul must not re-run via phantom)", n)
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1 (fixture must fire phantom)", n)
	}
	// Copyable peer is magic listener damage (not basic_damage channel) — stays 30, no ×1.25.
	for _, item := range damageEvidenceItems(done) {
		if !evidenceDataBool(item.Data, "phantom") {
			continue
		}
		if evidenceDataString(item.Data, "operationRef") != "op:guinsoo_copyable" {
			continue
		}
		if math.Abs(evidenceDataFloat(item.Data, "rawAmount")-xayahDPCopyableAmt) > 1e-9 {
			t.Fatalf("phantom copyable raw=%v want %v (Xayah mul must not re-run)",
				evidenceDataFloat(item.Data, "rawAmount"), xayahDPCopyableAmt)
		}
		for _, m := range damageEvidenceModifiers(item.Data) {
			if evidenceDataString(m, "modifierKey") == xayahDPBasicDmgMod {
				t.Fatalf("phantom settlement must not re-apply %s", xayahDPBasicDmgMod)
			}
		}
	}
}
