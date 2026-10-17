package runtime

import (
	"encoding/json"
	"math"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	"tinygo_engine_v2/internal/scheduler"
)

func elapsedModelValue(initial float64) model.GenericFormulaExpr {
	return model.GenericFormulaExpr{Op: "mul", Args: []model.GenericFormulaExpr{*timedShieldExpr(initial), {Op: "max", Args: []model.GenericFormulaExpr{*timedShieldExpr(0), {Op: "sub", Args: []model.GenericFormulaExpr{*timedShieldExpr(1), {Op: "div", Args: []model.GenericFormulaExpr{{Op: "read", Path: "provider.elapsed_ms"}, *timedShieldExpr(1500)}}}}}}}}
}

func elapsedInput(t *testing.T, definition string, initial float64) (model.CompileRequest, model.RunRequest) {
	t.Helper()
	c, r := timedShieldLoad(t)
	for i := range c.Combatants {
		c.Combatants[i].Attributes["attack_damage"] = authoringSlot(100)
		r.InitialSnapshot.Combatants[i].Attributes["attack_damage"] = authoringSlot(100)
	}
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: definition, StableID: definition, Kind: "buff",
		Lifecycle: &model.ProviderLifecycle{DurationMs: timedShieldExpr(1500), MaxStacks: 1, RefreshPolicy: "replace", InstanceScope: model.InstanceScopeSourceTarget},
		Modifiers: []model.ModifierDefinition{{ModifierKey: "configured_decay", Kind: "attribute", Target: "self.attr.attack_damage", ValuePolicy: "add", Value: elapsedModelValue(initial)}}})
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply", []model.OperationDefinition{{Operation: "apply_provider", Target: "source", ProviderDefinitionRef: definition}}),
		timedShieldAbility("sample", []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: &model.GenericFormulaExpr{Op: "read", Path: "source.attr.attack_damage.resolved"}, DamageType: "damage/physical"}}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "apply", AbilityRef: timedShieldRef("apply"), Source: "source", Target: "target"}}
	r.StopPolicy.DurationMs = 2000
	return c, r
}

func TestProviderElapsedDecaysWithoutIntermediateEventsAndCacheDoesNotFreeze(t *testing.T) {
	for _, initial := range []float64{20, 37.5} {
		t.Run(itoa(uint32(initial*2)), func(t *testing.T) {
			c, r := elapsedInput(t, "configured_decay", initial)
			for _, at := range []int64{0, 750, 1499, 1500} {
				r.DriverPlan.Entries = append(r.DriverPlan.Entries, model.DriverEntry{EntryKey: "sample" + itoa(uint32(at)), AbilityRef: timedShieldRef("sample"), Source: "source", Target: "target", FirstAtMs: at, Priority: 1})
			}
			s := frameCommitState(t, c, r)
			if err := s.runLoop(); err != nil {
				t.Fatal(err)
			}
			done := s.buildDoneResult()
			var amounts []float64
			for _, row := range done.Evidence.Items {
				if row.Kind == model.EvidenceKindDamage {
					amounts = append(amounts, row.Data["mitigatedAmount"].(float64))
				}
			}
			want := []float64{100 + initial, 100 + initial/2, 100 + initial/1500, 100}
			if len(amounts) != 4 {
				t.Fatalf("amounts=%+v", amounts)
			}
			for i := range amounts {
				if math.Abs(amounts[i]-want[i]) > 1e-9 {
					t.Fatalf("sample[%d]=%v want=%v", i, amounts[i], want[i])
				}
			}
			// Only five driver events and one real expiry; no per-millisecond decay timers.
			if s.processedEvents != 6 {
				t.Fatalf("unexpected intermediate events: %+v", done.Summary)
			}
		})
	}
}

func TestProviderElapsedRefreshResetsApplicationTimeAndStaleExpiry(t *testing.T) {
	c, r := elapsedInput(t, "configured_refresh_decay", 20)
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	var oldRef string
	for _, p := range s.combatants["source"].providers {
		if p.DefinitionRef == "configured_refresh_decay" {
			oldRef = p.ProviderRef
			if !p.HasAppliedAt || p.AppliedAtMs != 0 {
				t.Fatal(p)
			}
		}
	}
	s.nowMs = 750
	s.refreshProviderAwareAttributes("source", "target")
	if value := s.combatants["source"].attributes.At("attack_damage").Resolved; value != 110 {
		t.Fatal(value)
	}
	linkedShieldExecute(t, s, "apply", "source", "target")
	for _, p := range s.combatants["source"].providers {
		if p.ProviderRef == oldRef && (!p.HasAppliedAt || p.AppliedAtMs != 750 || p.ExpireAt != 2250) {
			t.Fatal(p)
		}
	}
	if value := s.combatants["source"].attributes.At("attack_damage").Resolved; value != 120 {
		t.Fatal("refresh did not reset decay", value)
	}
	s.nowMs = 1500
	s.expireCleanupPayloads = append(s.expireCleanupPayloads, expireCleanupPayload{kind: "provider", combatantKey: "source", providerRef: oldRef})
	s.handleExpireCleanup(scheduler.GenericEvent{DriverEntryIndex: len(s.expireCleanupPayloads) - 1})
	s.refreshProviderAwareAttributes("source", "target")
	if value := s.combatants["source"].attributes.At("attack_damage").Resolved; value != 110 {
		t.Fatal("stale expiry removed refreshed instance", value)
	}
	for _, memo := range s.attributeMemos[0] {
		if memo != nil && memo.cacheable {
			t.Fatal("elapsed provider reused an attribute memo with no clock dependency")
		}
	}
}

func TestProviderElapsedRestoreRequiresActualApplicationTime(t *testing.T) {
	c, r := elapsedInput(t, "configured_resume_decay", 20)
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	snapshot := s.req.InitialSnapshot
	snapshot.TimeMs = 750
	for i := range snapshot.Combatants {
		actor := s.combatants[snapshot.Combatants[i].Key]
		snapshot.Combatants[i].Providers = providersToSnapshot(actor.providers)
	}
	r.InitialSnapshot, r.DriverPlan.Entries = snapshot, nil
	result := compile.CompileGeneric(c)
	restored, err := newGenericRunState(result.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	if value := restored.combatants["source"].attributes.At("attack_damage").Resolved; value != 110 {
		t.Fatal("restore lost elapsed time", value)
	}
	for _, value := range []*int64{nil, int64PtrForElapsed(-1), int64PtrForElapsed(751)} {
		raw, _ := json.Marshal(snapshot)
		var changed model.Snapshot
		if err := json.Unmarshal(raw, &changed); err != nil {
			t.Fatal(err)
		}
		changed.Combatants[0].Providers[len(changed.Combatants[0].Providers)-1].AppliedAtMs = value
		request := r
		request.InitialSnapshot = changed
		if _, err := newGenericRunState(result.Session, request); err == nil {
			t.Fatal("invalid application time restored", value)
		}
	}
}

func int64PtrForElapsed(value int64) *int64 { return &value }

func TestProviderElapsedQuietFinalSnapshotUsesActualEndpoint(t *testing.T) {
	c, r := elapsedInput(t, "configured_quiet_decay", 20)
	r.StopPolicy.DurationMs = 750
	done := timedShieldMustRun(t, c, r)
	if done.FinalSnapshot.TimeMs != 750 || done.FinalSnapshot.Combatants[0].Attributes["attack_damage"].Resolved != 110 {
		t.Fatalf("quiet final view is stale: %+v", done.FinalSnapshot)
	}
	if p := done.FinalSnapshot.Combatants[0].Providers[len(done.FinalSnapshot.Combatants[0].Providers)-1]; p.AppliedAtMs == nil || *p.AppliedAtMs != 0 {
		t.Fatal("legal zero application time omitted", p)
	}
}

func TestProviderElapsedFailedRefreshKeepsOriginalTimeAndPair(t *testing.T) {
	c, r := elapsedInput(t, "configured_failed_decay", 20)
	s := frameCommitState(t, c, r)
	linkedShieldExecute(t, s, "apply", "source", "target")
	s.nowMs = 750
	before, _ := json.Marshal(providersToSnapshot(s.combatants["source"].providers))
	f, ability, operations := frameCommitFrame(s)
	if err := f.executeOperations(ability, operations); err != nil {
		t.Fatal(err)
	}
	s.heap.SetLimit(s.heap.Len())
	f.commit()
	after, _ := json.Marshal(providersToSnapshot(s.combatants["source"].providers))
	if !f.fatal || f.committed || string(before) != string(after) {
		t.Fatalf("failed refresh changed application time: %s -> %s err=%+v", before, after, f.fatalErr)
	}
}
