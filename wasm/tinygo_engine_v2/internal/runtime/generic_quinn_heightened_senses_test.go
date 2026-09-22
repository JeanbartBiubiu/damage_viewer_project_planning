package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/model"
)

// hero_quinn W Heightened Senses / 敏锐感知 (generic ABI, rank-5 AS partial).
//
// Local League Wiki quinn-w.json (revision 4024767,
// sha256 d7ac8dad4099a83a2cd898fa4a913fd6700f6dcd459271d2fe93090778b323d3;
// leveling {{ap|28 to 80}}%; rank-5 = 80%):
//   - provider target-scoped state harrier_vulnerable (max1; tests preset=1;
//     P/Q/E mark production is out of scope this batch)
//   - real event/basic_attack_hit + event/source_owner listener
//   - condition: provider.target_state.harrier_vulnerable >= 1
//   - on trigger: owner timed provider state heightened_senses_active=1
//     (max1, durationMs=2000, refresh_on_write / refresh_duration)
//   - owner-self attack_speed percent_add =
//     0.80 * provider.state.heightened_senses_active
//
// Non-goals: W active vision / MS branches (non-damage OOS), vulnerable mark
// produce/consume, Harrier bonus damage (P/Q/E), other ranks, live publish.

const (
	quinnHSProviderRef   = "hero:quinn"
	quinnHSStableID      = "hero_quinn"
	quinnHSHitAbilityKey = "basic_attack_hit"
	quinnHSProbeKey      = "quinn_hs_probe"
	quinnHSVulnerableKey = "harrier_vulnerable"
	quinnHSActiveKey     = "heightened_senses_active"
	quinnHSASModKey      = "heightened_senses_attack_speed"
	quinnHSListenerArm   = "listener_hero_quinn_heightened_senses_arm"
	quinnHSHitEvent      = "event/basic_attack_hit"
	quinnHSAADamage      = 10.0
	quinnHSASBuffDurMs   = 2000.0
	quinnHSASBonus       = 0.80
	quinnHSBaseAS        = 0.60
	quinnHSResolvedAS    = 1.08 // 0.60 * (1 + 0.80)
)

func quinnHSTimedSlot(defaultValue, maxValue, durationMs float64) map[string]interface{} {
	return map[string]interface{}{
		"defaultValue":  defaultValue,
		"maxValue":      maxValue,
		"durationMs":    durationMs,
		"refreshPolicy": model.ProviderStateRefreshOnWrite,
	}
}

func quinnHSStateSchema() map[string]interface{} {
	return map[string]interface{}{
		quinnHSVulnerableKey: map[string]interface{}{
			"defaultValue": float64(0),
			"maxValue":     float64(1),
			"durationMs":   float64(0),
		},
		quinnHSActiveKey: quinnHSTimedSlot(0, 1, quinnHSASBuffDurMs),
	}
}

func quinnHSVulnerableCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.target_state." + quinnHSVulnerableKey},
			{Op: "const", Value: &one},
		},
	}
}

func quinnHSASModifier() model.ModifierDefinition {
	return model.ModifierDefinition{
		ModifierKey: quinnHSASModKey,
		Kind:        "attribute",
		Target:      "attack_speed",
		ValuePolicy: "percent_add",
		Value: model.GenericFormulaExpr{
			Op: "mul",
			Args: []model.GenericFormulaExpr{
				gfConst(quinnHSASBonus),
				{Op: "read", Path: "provider.state." + quinnHSActiveKey},
			},
		},
	}
}

func quinnHSArmListener() model.ListenerDefinition {
	one := 1.0
	return model.ListenerDefinition{
		ListenerKey:  quinnHSListenerArm,
		EventMatcher: model.TypeMatcher{All: []string{quinnHSHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         quinnHSActiveKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   quinnHSVulnerableCond(),
			},
		},
	}
}

func quinnHSAAOps() []model.OperationDefinition {
	aa := quinnHSAADamage
	return []model.OperationDefinition{
		{
			Operation:  "damage",
			Target:     "target",
			DamageType: "damage/physical",
			Amount:     &model.GenericFormulaExpr{Op: "const", Value: &aa},
			Ref:        "op:aa",
		},
		{
			Operation: "emit_event",
			Target:    "target",
			EventType: quinnHSHitEvent,
			Ref:       quinnHSHitEvent,
		},
	}
}

func quinnHSAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := quinnHSAADamage
	one := 1.0
	return []model.OperationDefinition{
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
			EventType: quinnHSHitEvent,
			Ref:       quinnHSHitEvent,
		},
	}
}

func quinnHSProbeAbility() model.AbilityDefinition {
	one := 1.0
	return model.AbilityDefinition{
		AbilityKey: quinnHSProbeKey,
		Kind:       "active",
		// Typed as basic_attack so probe does not synthesize ability_started;
		// no emit of basic_attack_hit so it cannot re-arm heightened_senses.
		Types: []string{"ability/basic_attack"},
		Operations: []model.OperationDefinition{
			{
				Operation:  "damage",
				Target:     "target",
				DamageType: "damage/physical",
				Amount:     &model.GenericFormulaExpr{Op: "const", Value: &one},
				Ref:        "op:quinn_hs_probe",
			},
		},
	}
}

func quinnHSHitAbility() model.AbilityDefinition {
	return model.AbilityDefinition{
		AbilityKey: quinnHSHitAbilityKey,
		Kind:       "active",
		Types:      []string{"ability/basic_attack"},
		Operations: quinnHSAAOps(),
	}
}

func ensureQuinnHSTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
		{Key: quinnHSHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "state_scope/provider", Domain: "state_scope"},
		{Key: "state_scope/provider_target", Domain: "state_scope"},
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

func configureQuinnHSProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders[0] = model.ProviderDefinition{
		ProviderKey:        quinnHSProviderRef,
		Kind:               "champion",
		StableID:           quinnHSStableID,
		InitialStateSchema: quinnHSStateSchema(),
		Modifiers:          []model.ModifierDefinition{quinnHSASModifier()},
		Listeners:          []model.ListenerDefinition{quinnHSArmListener()},
		Abilities: []model.AbilityDefinition{
			quinnHSHitAbility(),
			quinnHSProbeAbility(),
		},
	}
	compileReq.Combatants[0].Providers = []model.CombatantProviderMount{
		{ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef},
	}
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = []model.CombatantProviderSnapshot{
			{
				ProviderRef: quinnHSProviderRef, DefinitionRef: quinnHSProviderRef,
				Stacks: 1, State: map[string]interface{}{},
			},
		}
	}
}

func quinnHSAARef() string {
	return "source.provider[" + quinnHSProviderRef + "].ability[" + quinnHSHitAbilityKey + "]"
}

func quinnHSProbeRef() string {
	return "source.provider[" + quinnHSProviderRef + "].ability[" + quinnHSProbeKey + "]"
}

func seedQuinnHarrierVulnerable(runReq *model.RunRequest, targetKey string, value float64) {
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		if runReq.InitialSnapshot.Combatants[i].ProviderState == nil {
			runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{}
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState[quinnHSProviderRef] = map[string]interface{}{
			"state": map[string]interface{}{},
			"targetState": map[string]interface{}{
				"target": targetKey,
				"values": map[string]interface{}{quinnHSVulnerableKey: value},
			},
		}
	}
}

func loadQuinnHSFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureQuinnHSTypes(&compileReq)
	configureQuinnHSProvider(&compileReq, &runReq)

	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "attack_speed", model.AttributeSlotDef{
		Base: quinnHSBaseAS, Current: quinnHSBaseAS, Max: quinnHSBaseAS, Resolved: quinnHSBaseAS,
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

func runQuinnHS(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
	t.Helper()
	result := compileMigrated(&compileReq, &runReq)
	if !result.OK {
		t.Fatalf("compile failed: %+v", result.Result.Errors)
	}
	done, err := RunGeneric(result.Session, runReq)
	if err != nil {
		t.Fatal(err)
	}
	return done
}

func quinnHSStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[quinnHSProviderRef].(map[string]interface{})
		if !ok {
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

func quinnHSSourceASSlot(t *testing.T, snap model.Snapshot) model.AttributeSlotDef {
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

func quinnHSTargetStateValue(t *testing.T, done model.DoneResult) (targetKey string, vulnerable float64) {
	t.Helper()
	bag := sourceProviderState(t, done.FinalSnapshot, quinnHSProviderRef)
	ts, ok := bag["targetState"].(map[string]interface{})
	if !ok {
		return "", 0
	}
	targetKey, _ = ts["target"].(string)
	values, _ := ts["values"].(map[string]interface{})
	vulnerable, _ = values[quinnHSVulnerableKey].(float64)
	return targetKey, vulnerable
}

// TestGenericQuinnHeightenedSensesRank5ASCrossCheck: base AS 0.60 * (1 + 0.80) = 1.08.
func TestGenericQuinnHeightenedSensesRank5ASCrossCheck(t *testing.T) {
	want := quinnHSBaseAS * (1 + quinnHSASBonus)
	if math.Abs(want-quinnHSResolvedAS) > 1e-12 {
		t.Fatalf("formula=%v want %v", want, quinnHSResolvedAS)
	}
	if math.Abs(want-1.08) > 1e-12 {
		t.Fatalf("resolved AS=%v want 1.08", want)
	}
}

// TestGenericQuinnHeightenedSensesNoVulnerableNoTrigger: without harrier_vulnerable,
// real basic_attack_hit must not arm AS.
func TestGenericQuinnHeightenedSensesNoVulnerableNoTrigger(t *testing.T) {
	compileReq, runReq := loadQuinnHSFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnHS(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, quinnHSHitEvent))
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 0 {
		t.Fatalf("heightened_senses_active=%v want 0 without vulnerable", got)
	}
	slot := quinnHSSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v", slot.Base, quinnHSBaseAS)
	}
	if math.Abs(slot.Resolved-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, quinnHSBaseAS)
	}
}

// TestGenericQuinnHeightenedSensesVulnerableHitArmsAS: preset vulnerable=1 + real AA
// → heightened_senses_active=1 and +80% AS for 2s; base AS unpolluted.
func TestGenericQuinnHeightenedSensesVulnerableHitArmsAS(t *testing.T) {
	compileReq, runReq := loadQuinnHSFixture(t)
	seedQuinnHarrierVulnerable(&runReq, model.SelectorTarget, 1)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnHS(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, quinnHSHitEvent))
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 1 {
		t.Fatalf("heightened_senses_active=%v want 1", got)
	}
	slot := quinnHSSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v (modifier must not mutate base)", slot.Base, quinnHSBaseAS)
	}
	if math.Abs(slot.Resolved-quinnHSResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want %v", slot.Resolved, quinnHSResolvedAS)
	}
	tgt, vuln := quinnHSTargetStateValue(t, done)
	if tgt != model.SelectorTarget {
		t.Fatalf("targetState.target=%q want %q", tgt, model.SelectorTarget)
	}
	if vuln != 1 {
		t.Fatalf("harrier_vulnerable=%v want 1 (preset retained)", vuln)
	}
}

// TestGenericQuinnHeightenedSensesASExpiresAfter2000ms: timed state expires → AS restores.
func TestGenericQuinnHeightenedSensesASExpiresAfter2000ms(t *testing.T) {
	compileReq, runReq := loadQuinnHSFixture(t)
	seedQuinnHarrierVulnerable(&runReq, model.SelectorTarget, 1)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_expired", AbilityRef: quinnHSProbeRef(), Source: "source", Target: "target", FirstAtMs: 2001},
	}
	runReq.StopPolicy.DurationMs = 2100
	done := runQuinnHS(t, compileReq, runReq)

	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 0 {
		t.Fatalf("heightened_senses_active after expiry=%v want 0", got)
	}
	slot := quinnHSSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base after expiry=%v want %v", slot.Base, quinnHSBaseAS)
	}
	if math.Abs(slot.Resolved-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after expiry=%v want baseline %v", slot.Resolved, quinnHSBaseAS)
	}
}

// TestGenericQuinnHeightenedSensesSecondHitRefreshesAS: second real AA refresh_on_write
// re-arms the 2000ms window from the second hit.
func TestGenericQuinnHeightenedSensesSecondHitRefreshesAS(t *testing.T) {
	compileReq, runReq := loadQuinnHSFixture(t)
	seedQuinnHarrierVulnerable(&runReq, model.SelectorTarget, 1)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa1", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa2", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 1500},
		{EntryKey: "probe_live", AbilityRef: quinnHSProbeRef(), Source: "source", Target: "target", FirstAtMs: 3499},
	}
	runReq.StopPolicy.DurationMs = 3550
	done := runQuinnHS(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 2 {
		t.Fatalf("basic_attack_hit=%d want 2", countEmittedEvents(done, quinnHSHitEvent))
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 1 {
		t.Fatalf("heightened_senses_active after refresh=%v want 1", got)
	}
	slot := quinnHSSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Base-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.base=%v want %v", slot.Base, quinnHSBaseAS)
	}
	if math.Abs(slot.Resolved-quinnHSResolvedAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved after refresh=%v want %v", slot.Resolved, quinnHSResolvedAS)
	}
}

// TestGenericQuinnHeightenedSensesRefreshWindowExpires: second hit at 1500 → expires at 3501.
func TestGenericQuinnHeightenedSensesRefreshWindowExpires(t *testing.T) {
	compileReq, runReq := loadQuinnHSFixture(t)
	seedQuinnHarrierVulnerable(&runReq, model.SelectorTarget, 1)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa1", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa2", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 1500},
		{EntryKey: "probe_expired", AbilityRef: quinnHSProbeRef(), Source: "source", Target: "target", FirstAtMs: 3501},
	}
	runReq.StopPolicy.DurationMs = 3600
	done := runQuinnHS(t, compileReq, runReq)

	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 0 {
		t.Fatalf("heightened_senses_active after refresh expiry=%v want 0", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed after refresh expiry=%v want baseline %v", got, quinnHSBaseAS)
	}
}

// TestGenericQuinnHeightenedSensesTargetStateIsolation: provider.target_state is gated by
// the active target binding. Vulnerable bound to "source" must not arm on AA vs "target".
func TestGenericQuinnHeightenedSensesTargetStateIsolation(t *testing.T) {
	compileReq, runReq := loadQuinnHSFixture(t)
	// Bind harrier_vulnerable to source; cast target is "target" → formula overlay empty.
	seedQuinnHarrierVulnerable(&runReq, model.SelectorSource, 1)

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runQuinnHS(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 1 {
		t.Fatalf("basic_attack_hit=%d want 1", countEmittedEvents(done, quinnHSHitEvent))
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 0 {
		t.Fatalf("heightened_senses_active=%v want 0 (bound target mismatch)", got)
	}
	slot := quinnHSSourceASSlot(t, done.FinalSnapshot)
	if math.Abs(slot.Resolved-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed.resolved=%v want baseline %v", slot.Resolved, quinnHSBaseAS)
	}
	tgt, vuln := quinnHSTargetStateValue(t, done)
	if tgt != model.SelectorSource {
		t.Fatalf("targetState.target=%q want %q (preset binding retained)", tgt, model.SelectorSource)
	}
	if vuln != 1 {
		t.Fatalf("harrier_vulnerable=%v want 1 (still stored under source binding)", vuln)
	}
}

// TestGenericQuinnHeightenedSensesPhantomDoesNotRefresh: Guinsoo phantom/copied hit must
// not re-emit basic_attack_hit or extend the 2000ms AS window.
func TestGenericQuinnHeightenedSensesPhantomDoesNotRefresh(t *testing.T) {
	compileReq, runReq := loadQuinnHSFixture(t)

	schema := quinnHSStateSchema()
	for k, v := range guinsooKStackSchema() {
		schema[k] = v
	}
	compileReq.SharedProviders[0].InitialStateSchema = schema
	compileReq.SharedProviders[0].Abilities[0].Operations = quinnHSAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	// Match Yun Tal phantom fixture: repeat listener on basic_attack_hit (not event/on_hit).
	compileReq.SharedProviders[0].Listeners = append(compileReq.SharedProviders[0].Listeners,
		model.ListenerDefinition{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{quinnHSHitEvent, "event/source_owner"}},
			Operations: []model.OperationDefinition{
				{
					Operation:     "damage",
					Target:        "target",
					DamageType:    "damage/magic",
					Amount:        &model.GenericFormulaExpr{Op: "const", Value: &copyableAmt},
					CopyableOnHit: true,
					Ref:           "op:guinsoo_copyable",
				},
			},
		},
		model.ListenerDefinition{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{quinnHSHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	)

	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			quinnHSProviderRef: map[string]interface{}{
				"state":    map[string]interface{}{guinsooStackKey: float64(3)},
				"expireAt": map[string]interface{}{guinsooStackKey: float64(10000)},
				"targetState": map[string]interface{}{
					"target": model.SelectorTarget,
					"values": map[string]interface{}{quinnHSVulnerableKey: float64(1)},
				},
			},
		}
	}

	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: quinnHSAARef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "probe_expired", AbilityRef: quinnHSProbeRef(), Source: "source", Target: "target", FirstAtMs: 2001},
	}
	runReq.StopPolicy.DurationMs = 2100
	done := runQuinnHS(t, compileReq, runReq)

	if countEmittedEvents(done, quinnHSHitEvent) != 1 {
		t.Fatalf("basic_attack_hit emits=%d want 1 (phantom must not re-emit)", countEmittedEvents(done, quinnHSHitEvent))
	}
	if n := countPhantomDamageByOpRef(done, "op:guinsoo_copyable"); n != 1 {
		t.Fatalf("phantom guinsoo copyable=%d want 1 (fixture must fire phantom)", n)
	}
	if got := quinnHSStateValue(t, done, quinnHSActiveKey); got != 0 {
		t.Fatalf("heightened_senses_active=%v want 0 (phantom must not refresh past 2000)", got)
	}
	if got := sourceAttrResolved(t, done.FinalSnapshot, "attack_speed"); math.Abs(got-quinnHSBaseAS) > 1e-9 {
		t.Fatalf("attack_speed=%v want baseline %v", got, quinnHSBaseAS)
	}
}
