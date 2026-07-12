package runtime

import (
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
)

const (
	spellbladeReadyKey       = "spellblade_ready"
	spellbladeICDKey         = "spellblade_icd"
	spellbladeProviderRef    = "item:trinity_spellblade"
	spellbladeChampionRef    = "champion:source_demo"
	spellbladeTumbleKey      = "tumble"
	spellbladeHitAbilityKey  = "basic_attack_hit"
	spellbladeCastEvent      = "event/ability_started"
	spellbladeHitEvent       = "event/basic_attack_hit"
	spellbladeDamageOpRef    = "op:spellblade_damage"
	spellbladeADBase         = 60.0
	spellbladeAADamage       = 10.0
	spellbladeReadyDuration  = 10000
	spellbladeICDDuration    = 1500
)

func ensureSpellbladeTypes(req *model.CompileRequest) {
	need := []model.TypeCatalogEntry{
		{Key: spellbladeCastEvent, Domain: "event"},
		{Key: spellbladeHitEvent, Domain: "event"},
		{Key: "event/source_owner", Domain: "event"},
		{Key: "ability/basic_attack", Domain: "ability"},
		{Key: "damage/physical", Domain: "damage"},
		{Key: "damage/magic", Domain: "damage"},
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

func spellbladeStateSchema() map[string]interface{} {
	return map[string]interface{}{
		spellbladeReadyKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(1),
			"durationMs":    float64(spellbladeReadyDuration),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
		spellbladeICDKey: map[string]interface{}{
			"defaultValue":  float64(0),
			"maxValue":      float64(1),
			"durationMs":    float64(spellbladeICDDuration),
			"refreshPolicy": model.ProviderStateRefreshOnWrite,
		},
	}
}

func spellbladeICDZeroCond() *model.GenericFormulaExpr {
	zero := 0.0
	return &model.GenericFormulaExpr{
		Op: "eq",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + spellbladeICDKey},
			{Op: "const", Value: &zero},
		},
	}
}

func spellbladeReadyArmedCond() *model.GenericFormulaExpr {
	one := 1.0
	return &model.GenericFormulaExpr{
		Op: "gte",
		Args: []model.GenericFormulaExpr{
			{Op: "read", Path: "provider.state." + spellbladeReadyKey},
			{Op: "const", Value: &one},
		},
	}
}

func spellbladeCastArmListener() model.ListenerDefinition {
	one := 1.0
	icdCond := spellbladeICDZeroCond()
	return model.ListenerDefinition{
		ListenerKey:  "spellblade_on_ability_started",
		EventMatcher: model.TypeMatcher{All: []string{spellbladeCastEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         spellbladeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   icdCond,
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         spellbladeICDKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &one},
				Condition:   icdCond,
			},
		},
	}
}

func spellbladeHitConsumeListener() model.ListenerDefinition {
	two := 2.0
	zero := 0.0
	readyCond := spellbladeReadyArmedCond()
	return model.ListenerDefinition{
		ListenerKey:  "spellblade_on_basic_attack_hit",
		EventMatcher: model.TypeMatcher{All: []string{spellbladeHitEvent, "event/source_owner"}},
		Operations: []model.OperationDefinition{
			{
				Operation:     "damage",
				Target:        "target",
				DamageType:    "damage/physical",
				Ref:           spellbladeDamageOpRef,
				CopyableOnHit: false,
				Condition:     readyCond,
				Amount: &model.GenericFormulaExpr{
					Op: "mul",
					Args: []model.GenericFormulaExpr{
						{Op: "const", Value: &two},
						{Op: "read", Path: "event.entry_source.attr.ad.base"},
					},
				},
			},
			{
				Operation:   "state_change",
				Target:      "source",
				Ref:         spellbladeReadyKey,
				Types:       []string{"state_scope/provider"},
				ValuePolicy: "override",
				Amount:      &model.GenericFormulaExpr{Op: "const", Value: &zero},
				Condition:   readyCond,
			},
		},
	}
}

func spellbladeListeners() []model.ListenerDefinition {
	return []model.ListenerDefinition{spellbladeCastArmListener(), spellbladeHitConsumeListener()}
}

func spellbladeAAOps() []model.OperationDefinition {
	aa := spellbladeAADamage
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
			EventType: spellbladeHitEvent,
			Ref:       spellbladeHitEvent,
		},
	}
}

func spellbladeAAOpsWithGuinsooStack() []model.OperationDefinition {
	aa := spellbladeAADamage
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
			EventType: spellbladeHitEvent,
			Ref:       spellbladeHitEvent,
		},
	}
}

func mountSpellbladeProvider(compileReq *model.CompileRequest, runReq *model.RunRequest) {
	compileReq.SharedProviders = append(compileReq.SharedProviders, model.ProviderDefinition{
		ProviderKey:         spellbladeProviderRef,
		Kind:                "item",
		StableID:            "trinity_spellblade",
		InitialStateSchema:  spellbladeStateSchema(),
		Listeners:           spellbladeListeners(),
	})
	compileReq.Combatants[0].Providers = append(compileReq.Combatants[0].Providers, model.CombatantProviderMount{
		ProviderRef: spellbladeProviderRef, DefinitionRef: spellbladeProviderRef,
	})
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].Providers = append(runReq.InitialSnapshot.Combatants[i].Providers, model.CombatantProviderSnapshot{
			ProviderRef: spellbladeProviderRef, DefinitionRef: spellbladeProviderRef, Stacks: 1, State: map[string]interface{}{},
		})
	}
}

func configureSpellbladeChampionAbilities(compileReq *model.CompileRequest) {
	compileReq.SharedProviders[0].Abilities = []model.AbilityDefinition{
		{
			AbilityKey: spellbladeTumbleKey,
			Kind:       "active",
			Types:      []string{},
			Operations: []model.OperationDefinition{},
		},
		{
			AbilityKey: spellbladeHitAbilityKey,
			Kind:       "active",
			Types:      []string{"ability/basic_attack"},
			Operations: spellbladeAAOps(),
		},
	}
}

func loadSpellbladeFixture(t *testing.T) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	compileReq, runReq := loadBasicFixture(t)
	ensureSpellbladeTypes(&compileReq)
	configureSpellbladeChampionAbilities(&compileReq)
	mountSpellbladeProvider(&compileReq, &runReq)
	setCombatantAttr(&compileReq, &runReq, model.SelectorSource, "ad", model.AttributeSlotDef{
		Base: spellbladeADBase, Current: spellbladeADBase, Max: spellbladeADBase, Resolved: spellbladeADBase,
	})
	setCombatantAttr(&compileReq, &runReq, model.SelectorTarget, "hp", model.AttributeSlotDef{
		Base: 100000, Current: 100000, Max: 100000, Resolved: 100000,
	})
	runReq.StopPolicy.StopOnTargetDeath = model.BoolPtr(false)
	runReq.Sampling.SampleEveryMs = 100000
	return compileReq, runReq
}

func tumbleRef() string {
	return "source.provider[" + spellbladeChampionRef + "].ability[" + spellbladeTumbleKey + "]"
}

func aaRef() string {
	return "source.provider[" + spellbladeChampionRef + "].ability[" + spellbladeHitAbilityKey + "]"
}

func runSpellblade(t *testing.T, compileReq model.CompileRequest, runReq model.RunRequest) model.DoneResult {
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

func spellbladeStateValue(t *testing.T, done model.DoneResult, key string) float64 {
	t.Helper()
	for _, c := range done.FinalSnapshot.Combatants {
		if c.Key != model.SelectorSource {
			continue
		}
		bag, ok := c.ProviderState[spellbladeProviderRef].(map[string]interface{})
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
	t.Fatalf("source combatant missing")
	return 0
}

func countEmittedEvents(done model.DoneResult, ref string) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind == model.EvidenceKindEmittedEvent && item.Ref == ref {
			n++
		}
	}
	return n
}

func countDamageByOpRef(done model.DoneResult, opRef string, phantomOnly bool) int {
	n := 0
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage {
			continue
		}
		if evidenceDataString(item.Data, "operationRef") != opRef {
			continue
		}
		isPhantom, _ := item.Data["phantom"].(bool)
		if phantomOnly && !isPhantom {
			continue
		}
		if !phantomOnly && isPhantom {
			continue
		}
		n++
	}
	return n
}

func sumDamageRawByOpRef(done model.DoneResult, opRef string) float64 {
	var sum float64
	for _, item := range done.Evidence.Items {
		if item.Kind != model.EvidenceKindDamage {
			continue
		}
		if evidenceDataString(item.Data, "operationRef") != opRef {
			continue
		}
		if phantom, _ := item.Data["phantom"].(bool); phantom {
			continue
		}
		sum += evidenceDataFloat(item.Data, "rawAmount")
	}
	return sum
}

// TestSpellbladeAbilityStartedArmsReadyAndICD W1: 顶层非普攻 active cast 发 ability_started 并武装。
func TestSpellbladeAbilityStartedArmsReadyAndICD(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 1 {
		t.Fatalf("ability_started count=%d want 1", countEmittedEvents(done, spellbladeCastEvent))
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 1 {
		t.Fatalf("spellblade_ready=%v want 1", got)
	}
	if got := spellbladeStateValue(t, done, spellbladeICDKey); got != 1 {
		t.Fatalf("spellblade_icd=%v want 1", got)
	}
}

// TestSpellbladeBasicAttackDoesNotEmitAbilityStarted W2: 普攻 cast 不发 ability_started、不武装。
func TestSpellbladeBasicAttackDoesNotEmitAbilityStarted(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 0 {
		t.Fatalf("ability_started count=%d want 0 for basic_attack", countEmittedEvents(done, spellbladeCastEvent))
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0", got)
	}
	if got := spellbladeStateValue(t, done, spellbladeICDKey); got != 0 {
		t.Fatalf("spellblade_icd=%v want 0", got)
	}
}

// TestSpellbladeGateCostCooldownSkipDoesNotArm W3: gate/cost/cooldown skip 不武装。
func TestSpellbladeGateCostCooldownSkipDoesNotArm(t *testing.T) {
	t.Run("resource_insufficient", func(t *testing.T) {
		compileReq, runReq := loadSpellbladeFixture(t)
		sixty := 60.0
		compileReq.SharedProviders[0].Abilities[0].Cost = &model.AbilityCost{
			ResourceKey: "mana",
			Amount:      model.GenericFormulaExpr{Op: "const", Value: &sixty},
		}
		compileReq.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 10, Max: 200}
		runReq.InitialSnapshot.Combatants[0].Resources["mana"] = model.ResourceSlotDef{Current: 10, Max: 200}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runSpellblade(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 0 {
			t.Fatalf("abilityCastCount=%d want 0", done.Summary.AbilityCastCount)
		}
		if countEmittedEvents(done, spellbladeCastEvent) != 0 {
			t.Fatalf("ability_started count=%d want 0 on cost skip", countEmittedEvents(done, spellbladeCastEvent))
		}
		if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
			t.Fatalf("spellblade_ready=%v want 0", got)
		}
	})
	t.Run("cooldown_not_ready", func(t *testing.T) {
		compileReq, runReq := loadSpellbladeFixture(t)
		cd := 5000.0
		compileReq.SharedProviders[0].Abilities[0].Cooldown = &model.AbilityCooldown{
			DurationMs: model.GenericFormulaExpr{Op: "const", Value: &cd},
		}
		ref := tumbleRef()
		runReq.InitialSnapshot.Combatants[0].Cooldowns = map[string]interface{}{
			ref: map[string]interface{}{"readyAtMs": float64(5000), "remainingMs": float64(5000)},
		}
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{EntryKey: "tumble", AbilityRef: ref, Source: "source", Target: "target", FirstAtMs: 0},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runSpellblade(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 0 {
			t.Fatalf("abilityCastCount=%d want 0", done.Summary.AbilityCastCount)
		}
		if countEmittedEvents(done, spellbladeCastEvent) != 0 {
			t.Fatalf("ability_started count=%d want 0 on cooldown skip", countEmittedEvents(done, spellbladeCastEvent))
		}
		if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
			t.Fatalf("spellblade_ready=%v want 0", got)
		}
	})
	t.Run("condition_false", func(t *testing.T) {
		compileReq, runReq := loadSpellbladeFixture(t)
		zero := 0.0
		runReq.DriverPlan.Entries = []model.DriverEntry{
			{
				EntryKey:   "tumble",
				AbilityRef: tumbleRef(),
				Source:     "source",
				Target:     "target",
				FirstAtMs:  0,
				Condition:  &model.GenericFormulaExpr{Op: "const", Value: &zero},
			},
		}
		runReq.StopPolicy.DurationMs = 50
		done := runSpellblade(t, compileReq, runReq)
		if done.Summary.AbilityCastCount != 0 {
			t.Fatalf("abilityCastCount=%d want 0", done.Summary.AbilityCastCount)
		}
		if countEmittedEvents(done, spellbladeCastEvent) != 0 {
			t.Fatalf("ability_started count=%d want 0 on condition skip", countEmittedEvents(done, spellbladeCastEvent))
		}
		if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
			t.Fatalf("spellblade_ready=%v want 0", got)
		}
	})
}

// TestSpellbladeChildAbilityDoesNotArm W4: listener child ability（chainDepth>0）不发 ability_started、不武装。
func TestSpellbladeChildAbilityDoesNotArm(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	compileReq.TypeCatalog.Types = append(compileReq.TypeCatalog.Types, model.TypeCatalogEntry{Key: "event/child_proc", Domain: "event"})
	// Parent is basic_attack (no auto ability_started). Listener child-casts tumble at depth>0.
	compileReq.SharedProviders[0].Abilities[1].Operations = []model.OperationDefinition{
		{Operation: "emit_event", Target: "target", EventType: "event/child_proc", Ref: "event/child_proc"},
	}
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "cast_tumble_child",
			EventMatcher: model.TypeMatcher{Any: []string{"event/child_proc"}},
			AbilityRef:   tumbleRef(),
		},
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 0 {
		t.Fatalf("ability_started count=%d want 0 for child ability", countEmittedEvents(done, spellbladeCastEvent))
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 (child must not arm)", got)
	}
	// Child tumble still cast successfully.
	var childStat *model.AbilityStat
	for i := range done.Summary.AbilityStats {
		if done.Summary.AbilityStats[i].AbilityRef == tumbleRef() {
			childStat = &done.Summary.AbilityStats[i]
			break
		}
	}
	if childStat == nil || childStat.CastCount != 1 {
		t.Fatalf("child tumble castCount=%v want 1", childStat)
	}
}

// TestSpellbladeFirstHitConsumesReadySecondHitNoProc W5+W6: 首刀 2*ad.base 后 ready=0；第二刀无 Spellblade。
func TestSpellbladeFirstHitConsumesReadySecondHitNoProc(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa1", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
		{EntryKey: "aa2", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 200},
	}
	runReq.StopPolicy.DurationMs = 300
	done := runSpellblade(t, compileReq, runReq)
	wantSpellblade := 2 * spellbladeADBase
	if got := sumDamageRawByOpRef(done, spellbladeDamageOpRef); math.Abs(got-wantSpellblade) > 1e-6 {
		t.Fatalf("spellblade raw=%v want %v", got, wantSpellblade)
	}
	if countDamageByOpRef(done, spellbladeDamageOpRef, false) != 1 {
		t.Fatalf("spellblade damage count=%d want 1", countDamageByOpRef(done, spellbladeDamageOpRef, false))
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 after consume", got)
	}
	// AA 10 + Spellblade 120 + AA 10 = 140
	wantDealt := spellbladeAADamage*2 + wantSpellblade
	if math.Abs(done.Summary.SourceDamageDealt-wantDealt) > 1e-6 {
		t.Fatalf("sourceDamageDealt=%v want %v", done.Summary.SourceDamageDealt, wantDealt)
	}
}

// TestSpellbladeReadyExpiresWithoutProc W7: ready 10000ms 到期后命中不触发。
func TestSpellbladeReadyExpiresWithoutProc(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: spellbladeReadyDuration},
	}
	runReq.StopPolicy.DurationMs = spellbladeReadyDuration + 50
	done := runSpellblade(t, compileReq, runReq)
	if countDamageByOpRef(done, spellbladeDamageOpRef, false) != 0 {
		t.Fatalf("spellblade damage after ready expiry=%d want 0", countDamageByOpRef(done, spellbladeDamageOpRef, false))
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 after expiry", got)
	}
}

// TestSpellbladeICDBlocksRearmAndReadyRefresh W8: ICD 内再次 cast 不重武装、不刷新 ready。
func TestSpellbladeICDBlocksRearmAndReadyRefresh(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble1", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "tumble2", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 500},
		// If second cast refreshed ready, expireAt would be 10500 and this hit would still proc.
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: spellbladeReadyDuration},
	}
	runReq.StopPolicy.DurationMs = spellbladeReadyDuration + 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 2 {
		t.Fatalf("ability_started count=%d want 2 (both top-level casts emit)", countEmittedEvents(done, spellbladeCastEvent))
	}
	if countDamageByOpRef(done, spellbladeDamageOpRef, false) != 0 {
		t.Fatalf("spellblade damage=%d want 0 (ICD must not refresh ready window)", countDamageByOpRef(done, spellbladeDamageOpRef, false))
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0", got)
	}
}

// TestSpellbladePhantomDoesNotCopyOrConsume W9: Guinsoo phantom 不复制/触发/消费 Spellblade。
func TestSpellbladePhantomDoesNotCopyOrConsume(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	// Champion owns AA + Guinsoo stack/repeat; Spellblade item listens to cast/hit.
	compileReq.SharedProviders[0].InitialStateSchema = guinsooKStackSchema()
	compileReq.SharedProviders[0].Abilities[1].Operations = spellbladeAAOpsWithGuinsooStack()
	copyableAmt := 30.0
	compileReq.SharedProviders[0].Listeners = []model.ListenerDefinition{
		{
			ListenerKey:  "guinsoo_copyable",
			EventMatcher: model.TypeMatcher{All: []string{spellbladeHitEvent, "event/source_owner"}},
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
		{
			ListenerKey:  "guinsoo_repeat",
			EventMatcher: model.TypeMatcher{All: []string{spellbladeHitEvent, "event/source_owner"}},
			Operations:   []model.OperationDefinition{guinsooKRepeatOp()},
		},
	}
	// Pre-seed 3 stacks so the armed AA both consumes Spellblade and triggers phantom.
	for i := range runReq.InitialSnapshot.Combatants {
		if runReq.InitialSnapshot.Combatants[i].Key != model.SelectorSource {
			continue
		}
		runReq.InitialSnapshot.Combatants[i].ProviderState = map[string]interface{}{
			spellbladeChampionRef: map[string]interface{}{
				"state": map[string]interface{}{guinsooStackKey: float64(3)},
			},
		}
	}
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
		{EntryKey: "aa", AbilityRef: aaRef(), Source: "source", Target: "target", FirstAtMs: 100},
	}
	runReq.StopPolicy.DurationMs = 200
	done := runSpellblade(t, compileReq, runReq)

	if countDamageByOpRef(done, spellbladeDamageOpRef, false) != 1 {
		t.Fatalf("original spellblade damage count=%d want 1", countDamageByOpRef(done, spellbladeDamageOpRef, false))
	}
	if countDamageByOpRef(done, spellbladeDamageOpRef, true) != 0 {
		t.Fatalf("phantom spellblade damage count=%d want 0", countDamageByOpRef(done, spellbladeDamageOpRef, true))
	}
	if got := sumDamageRawByOpRef(done, spellbladeDamageOpRef); math.Abs(got-2*spellbladeADBase) > 1e-6 {
		t.Fatalf("spellblade raw=%v want %v", got, 2*spellbladeADBase)
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0 (consumed once by real hit)", got)
	}
	if got := spellbladeStateValue(t, done, spellbladeICDKey); got != 1 {
		t.Fatalf("spellblade_icd=%v want 1 (phantom must not touch ICD)", got)
	}
	// Phantom must replay copyable Guinsoo damage once.
	if countDamageByOpRef(done, "op:guinsoo_copyable", true) != 1 {
		t.Fatalf("phantom guinsoo copyable count=%d want 1", countDamageByOpRef(done, "op:guinsoo_copyable", true))
	}
}

// TestSpellbladeMissingBasicAttackTypeFailsClosed catalog 缺 ability/basic_attack 时不合成 ability_started。
func TestSpellbladeMissingBasicAttackTypeFailsClosed(t *testing.T) {
	compileReq, runReq := loadSpellbladeFixture(t)
	filtered := make([]model.TypeCatalogEntry, 0, len(compileReq.TypeCatalog.Types))
	for _, entry := range compileReq.TypeCatalog.Types {
		if entry.Key == "ability/basic_attack" {
			continue
		}
		filtered = append(filtered, entry)
	}
	compileReq.TypeCatalog.Types = filtered
	// Strip basic_attack type from AA so compile can succeed without the catalog entry.
	compileReq.SharedProviders[0].Abilities[1].Types = nil
	runReq.DriverPlan.Entries = []model.DriverEntry{
		{EntryKey: "tumble", AbilityRef: tumbleRef(), Source: "source", Target: "target", FirstAtMs: 0},
	}
	runReq.StopPolicy.DurationMs = 50
	done := runSpellblade(t, compileReq, runReq)
	if countEmittedEvents(done, spellbladeCastEvent) != 0 {
		t.Fatalf("ability_started count=%d want 0 (fail closed without ability/basic_attack)", countEmittedEvents(done, spellbladeCastEvent))
	}
	if got := spellbladeStateValue(t, done, spellbladeReadyKey); got != 0 {
		t.Fatalf("spellblade_ready=%v want 0", got)
	}
	if done.Summary.AbilityCastCount != 1 {
		t.Fatalf("abilityCastCount=%d want 1 (cast itself still succeeds)", done.Summary.AbilityCastCount)
	}
}
