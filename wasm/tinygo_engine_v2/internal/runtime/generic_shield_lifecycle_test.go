package runtime

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"tinygo_engine_v2/internal/compile"
	"tinygo_engine_v2/internal/model"
	planbundle "tinygo_engine_v2/internal/plan"
	"tinygo_engine_v2/internal/scheduler"
)

type linkedShieldNames struct{ shield, provider string }

var linkedShieldCases = []linkedShieldNames{{"configured/barrier", "configured/guard"}, {"other:ward", "other:reaction"}}

func linkedShieldState(t *testing.T, names linkedShieldNames) *genericRunState {
	t.Helper()
	c, r := timedShieldLoad(t)
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: names.provider, StableID: names.provider, Kind: "buff",
		LinkedShieldDefinitionRef: names.shield, InitialStateSchema: map[string]interface{}{"configured_count": float64(0)}})
	c.SharedProviders[0].Abilities = []model.AbilityDefinition{
		timedShieldAbility("apply", []model.OperationDefinition{{Operation: "shield", Target: "target", ShieldRef: names.shield,
			ShieldLifecycleProviderDefinitionRef: names.provider, Amount: timedShieldExpr(75), ShieldDurationMs: timedShieldExpr(200)}}),
		timedShieldAbility("hit", []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: timedShieldExpr(25), DamageType: "damage/physical"}}),
	}
	r.DriverPlan.Entries = []model.DriverEntry{{EntryKey: "apply", AbilityRef: timedShieldRef("apply"), Source: "source", Target: "target"}}
	r.StopPolicy.DurationMs = 1000
	return frameCommitState(t, c, r)
}

func linkedShieldExecute(t *testing.T, s *genericRunState, abilityKey, source, target string) *executionFrame {
	t.Helper()
	var ability planbundle.CompiledAbility
	for _, candidate := range s.compiled.Abilities {
		if candidate.AbilityKey == abilityKey {
			ability = candidate
			break
		}
	}
	f := s.newExecutionFrame(source, target, "configured-test:"+abilityKey)
	f.ownerCombatantKey, f.ownerProviderRef = "source", "champion:source_demo"
	start := int(ability.OperationStart)
	if err := f.executeOperations(ability, s.compiled.Operations[start:start+int(ability.OperationCount)]); err != nil {
		t.Fatalf("execute: %+v", err)
	}
	f.commit()
	if f.fatal {
		t.Fatalf("commit: %+v", f.fatalErr)
	}
	return f
}

func TestLinkedShieldRefreshHasNewIdentitiesAndStaleExpiryIsHarmless(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			s := linkedShieldState(t, names)
			linkedShieldExecute(t, s, "apply", "source", "target")
			old := s.combatants["target"].shields[0]
			owner := s.combatants["target"]
			owner.providerState[old.LifecycleProviderRef] = &providerStateBag{state: map[string]float64{"configured_count": 1}}
			s.combatants["target"] = owner
			s.nowMs = 100
			linkedShieldExecute(t, s, "apply", "source", "target")
			c := s.combatants["target"]
			if len(c.shields) != 1 || len(c.providers) != 1 {
				t.Fatalf("unpaired state: shields=%+v providers=%+v", c.shields, c.providers)
			}
			current := c.shields[0]
			if current.ShieldRef == old.ShieldRef || current.LifecycleProviderRef == old.LifecycleProviderRef || current.DefinitionRef != names.shield || current.ExpireAt != 300 {
				t.Fatalf("refresh reused identity: old=%+v current=%+v", old, current)
			}
			if c.providerState[old.LifecycleProviderRef] != nil || (c.providerState[current.LifecycleProviderRef] != nil && c.providerState[current.LifecycleProviderRef].state["configured_count"] != 0) {
				t.Fatal("old quota leaked into new provider")
			}
			s.nowMs = 200
			s.removeExpiredShieldInstance("target", old.ShieldRef)
			s.expireCleanupPayloads = append(s.expireCleanupPayloads, expireCleanupPayload{kind: "provider", combatantKey: "target", providerRef: old.LifecycleProviderRef})
			s.handleExpireCleanup(scheduler.GenericEvent{DriverEntryIndex: len(s.expireCleanupPayloads) - 1})
			if len(s.combatants["target"].shields) != 1 || s.combatants["target"].shields[0].ShieldRef != current.ShieldRef || len(s.combatants["target"].providers) != 1 {
				t.Fatal("old expiry removed current association")
			}
			s.nowMs = 300
			s.removeExpiredShieldInstance("target", current.ShieldRef)
			if len(s.combatants["target"].providers)+len(s.combatants["target"].shields) != 0 {
				t.Fatal("expiration left one side alive")
			}
		})
	}
}

func TestLinkedShieldDifferentSourcesCoexistAndUnboundShieldsStillAppend(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			s := linkedShieldState(t, names)
			linkedShieldExecute(t, s, "apply", "source", "target")
			linkedShieldExecute(t, s, "apply", "target", "target")
			if c := s.combatants["target"]; len(c.shields) != 2 || len(c.providers) != 2 || c.shields[0].Source == c.shields[1].Source {
				t.Fatalf("sources were combined: %+v", c.shields)
			}
			f, ability, ops := frameCommitFrame(s)
			op := ops[0]
			op.HasShieldLifecycleProvider = false
			for i := 0; i < 2; i++ {
				if err := f.executeOperation(ability, &op); err != nil {
					t.Fatal(err)
				}
			}
			f.commit()
			if f.fatal || len(s.combatants["target"].shields) != 4 {
				t.Fatalf("unbound append changed: %+v", s.combatants["target"].shields)
			}
		})
	}
}

func TestLinkedShieldDepletionAndExplicitProviderRemovalAreBidirectional(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			for _, amount := range []float64{25, 75, 100} {
				s := linkedShieldState(t, names)
				linkedShieldExecute(t, s, "apply", "source", "target")
				f := s.newExecutionFrame("source", "target", "configured-damage")
				ability := s.compiled.Abilities[1]
				op := s.compiled.Operations[ability.OperationStart]
				// The compiled damage amount is 25; repeat operations to reach the test amount.
				for v := float64(0); v < amount; v += 25 {
					if err := f.executeOperation(ability, &op); err != nil {
						t.Fatal(err)
					}
				}
				f.commit()
				want := 0
				if amount < 75 {
					want = 1
				}
				if f.fatal || len(s.combatants["target"].providers) != want || len(s.combatants["target"].shields) != want {
					t.Fatalf("depletion amount=%v providers=%+v shields=%+v err=%+v", amount, s.combatants["target"].providers, s.combatants["target"].shields, f.fatalErr)
				}
			}
			s := linkedShieldState(t, names)
			linkedShieldExecute(t, s, "apply", "source", "target")
			ref := s.combatants["target"].shields[0].LifecycleProviderRef
			s.removeProviderInstance("target", ref, s.evalContextForCombatants("source", "target"), model.EvidenceKindProviderRemove)
			s.removeProviderInstance("target", ref, s.evalContextForCombatants("source", "target"), model.EvidenceKindProviderRemove)
			if len(s.combatants["target"].shields)+len(s.combatants["target"].providers) != 0 {
				t.Fatal("provider removal retained shield")
			}
		})
	}
}

func TestLinkedShieldSnapshotRestoreAndRejection(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			s := linkedShieldState(t, names)
			linkedShieldExecute(t, s, "apply", "source", "target")
			snapshot := s.req.InitialSnapshot
			for i := range snapshot.Combatants {
				c := s.combatants[snapshot.Combatants[i].Key]
				snapshot.Combatants[i].Shields = shieldsToSnapshot(c.shields)
				snapshot.Combatants[i].Providers = providersToSnapshot(c.providers)
			}
			r := s.req
			r.InitialSnapshot = snapshot
			restored, err := newGenericRunState(s.compiled, r)
			if err != nil {
				t.Fatal(err)
			}
			old := restored.combatants["target"].shields[0]
			linkedShieldExecute(t, restored, "apply", "source", "target")
			if sh := restored.combatants["target"].shields[0]; sh.ShieldRef == old.ShieldRef || sh.LifecycleProviderRef == old.LifecycleProviderRef {
				t.Fatal("restored IDs collided")
			}
			cases := []struct {
				name   string
				change func(*model.Snapshot)
			}{
				{"missing_provider", func(s *model.Snapshot) { s.Combatants[1].Providers = nil }},
				{"missing_shield", func(s *model.Snapshot) { s.Combatants[1].Shields = nil }},
				{"wrong_definition", func(s *model.Snapshot) { s.Combatants[1].Shields[0].DefinitionRef = "unknown" }},
				{"wrong_source", func(s *model.Snapshot) { s.Combatants[1].Shields[0].Source = "target" }},
				{"wrong_owner", func(s *model.Snapshot) { s.Combatants[1].Shields[0].Owner = "source" }},
				{"duplicate_shield", func(s *model.Snapshot) {
					s.Combatants[1].Shields = append(s.Combatants[1].Shields, s.Combatants[1].Shields[0])
				}},
				{"wrong_expiry", func(s *model.Snapshot) { x := int64(250); s.Combatants[1].Shields[0].ExpireAt = &x }},
				{"nonfinite_remaining", func(s *model.Snapshot) { s.Combatants[1].Shields[0].Remaining = math.Inf(1) }},
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					raw, _ := json.Marshal(snapshot)
					var altered model.Snapshot
					if err := json.Unmarshal(raw, &altered); err != nil {
						t.Fatal(err)
					}
					tc.change(&altered)
					req := r
					req.InitialSnapshot = altered
					if _, err := newGenericRunState(s.compiled, req); err == nil {
						t.Fatal("malformed association restored")
					}
				})
			}
		})
	}
}

func TestLinkedShieldFailureDoesNotReplaceExistingPair(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			s := linkedShieldState(t, names)
			linkedShieldExecute(t, s, "apply", "source", "target")
			before, _ := json.Marshal(s.combatants["target"].shields)
			beforeProvider := s.combatants["target"].providers[0].ProviderRef
			f, ability, ops := frameCommitFrame(s)
			if err := f.executeOperations(ability, ops); err != nil {
				t.Fatal(err)
			}
			s.heap.SetLimit(s.heap.Len())
			f.commit()
			after, _ := json.Marshal(s.combatants["target"].shields)
			if f.fatalErr == nil || f.fatalErr.BudgetCause != model.BudgetCauseMaxQueueEvents || f.committed || string(before) != string(after) || s.combatants["target"].providers[0].ProviderRef != beforeProvider {
				t.Fatalf("failed frame leaked: %+v", f.fatalErr)
			}
		})
	}
}

func TestLinkedShieldPresenceIsExplicitAndReadsActualPair(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			s := linkedShieldState(t, names)
			// Target's original provider is made concrete as a restored authoring owner.
			owner := s.combatants["target"]
			owner.providers = append(owner.providers, s.combatants["source"].providers[0])
			owner.providers[0].Owner, owner.providers[0].Source, owner.providers[0].ProviderRef = "target", "target", "configured_original"
			s.combatants["target"] = owner
			f := s.newExecutionFrame("target", "source", "read")
			f.ownerCombatantKey, f.ownerProviderRef = "target", "configured_original"
			index, _ := s.findProviderDefinitionIndex(names.provider)
			if v, err := f.LinkedShieldPresent(index); err != nil || v != 0 {
				t.Fatal(v, err)
			}
			linkedShieldExecute(t, s, "apply", "target", "target")
			f = s.newExecutionFrame("target", "source", "read")
			f.ownerCombatantKey, f.ownerProviderRef = "target", "configured_original"
			if v, err := f.LinkedShieldPresent(index); err != nil || v != 1 {
				t.Fatal(v, err)
			}
			f.ownerProviderRef = "missing"
			if _, err := f.LinkedShieldPresent(index); err == nil || !strings.Contains(err.Error(), "provider") {
				t.Fatal("missing actual context silently read")
			}
		})
	}
}

func TestLinkedShieldRunGenericDamageTakenReadsSettledShield(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			for _, damage := range []float64{25, 75, 100} {
				t.Run(itoa(uint32(damage)), func(t *testing.T) {
					c, r := timedShieldLoad(t)
					receivedEquipmentTypes(&c)
					c.SharedProviders[0].InitialStateSchema = map[string]interface{}{"observed": float64(0)}
					c.SharedProviders[0].Abilities = []model.AbilityDefinition{
						timedShieldAbility("apply", []model.OperationDefinition{{Operation: "shield", Target: "target", ShieldRef: names.shield,
							ShieldLifecycleProviderDefinitionRef: names.provider, Amount: timedShieldExpr(75), ShieldDurationMs: timedShieldExpr(200)}}),
						timedShieldAbility("hit", []model.OperationDefinition{{Operation: "damage", Target: "target", Amount: timedShieldExpr(damage), DamageType: "damage/physical"}}),
					}
					c.SharedProviders[0].Listeners = []model.ListenerDefinition{{ListenerKey: "observe_real_shield", EventMatcher: model.TypeMatcher{All: []string{model.EventTypeDamageTaken, eventTargetOwner}},
						Condition: &model.GenericFormulaExpr{Op: "read", Path: "provider.linked_shield[" + names.shield + "].present"}, Operations: []model.OperationDefinition{cadenceStateOperation("observed", "add", 1, nil)}}}
					c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: names.provider, StableID: names.provider, Kind: "buff", LinkedShieldDefinitionRef: names.shield})
					c.Combatants[1].Providers = []model.CombatantProviderMount{{ProviderRef: "configured_original", DefinitionRef: c.SharedProviders[0].ProviderKey}}
					r.InitialSnapshot.Combatants[1].Providers = []model.CombatantProviderSnapshot{{ProviderRef: "configured_original", DefinitionRef: c.SharedProviders[0].ProviderKey, Source: "target", Owner: "target", Stacks: 1}}
					r.DriverPlan.Entries = []model.DriverEntry{
						{EntryKey: "apply", AbilityRef: "target.provider[configured_original].ability[apply]", Source: "target", Target: "target"},
						{EntryKey: "damage", AbilityRef: timedShieldRef("hit"), Source: "source", Target: "target", FirstAtMs: 10},
					}
					r.StopPolicy.DurationMs = 50
					done := timedShieldMustRun(t, c, r)
					observed := cadenceStateValue(t, done, 1, "configured_original", "observed")
					want := float64(0)
					if damage < 75 {
						want = 1
					}
					if observed != want {
						t.Fatalf("damage=%v observed=%v want=%v", damage, observed, want)
					}
					target := timedTarget(t, done)
					if damage >= 75 && (len(target.Shields) != 0 || len(target.Providers) != 1) {
						t.Fatalf("broken shield still live in final snapshot: %+v", target)
					}
				})
			}
		})
	}
}

func TestLinkedShieldSameFrameAndFormulaFailuresAreAtomic(t *testing.T) {
	for _, names := range linkedShieldCases {
		t.Run(names.shield, func(t *testing.T) {
			s := linkedShieldState(t, names)
			f, ability, ops := frameCommitFrame(s)
			if err := f.executeOperations(ability, ops); err != nil {
				t.Fatal(err)
			}
			hit := s.compiled.Abilities[1]
			damage := s.compiled.Operations[hit.OperationStart]
			for i := 0; i < 3; i++ {
				if err := f.executeOperation(hit, &damage); err != nil {
					t.Fatal(err)
				}
			}
			f.commit()
			if f.fatal || len(s.combatants["target"].shields)+len(s.combatants["target"].providers) != 0 {
				t.Fatalf("same-frame depletion left pair: %+v", f.fatalErr)
			}
			linkedShieldExecute(t, s, "apply", "source", "target")
			before := s.combatants["target"].shields[0]
			f, ability, ops = frameCommitFrame(s)
			op := ops[0]
			if err := f.stageLifecycleShield(op, ability, "target", math.Inf(1)); err == nil {
				t.Fatal("nonfinite shield accepted")
			}
			if current := s.combatants["target"].shields[0]; current.ShieldRef != before.ShieldRef || current.LifecycleProviderRef != before.LifecycleProviderRef {
				t.Fatal("failed formula replaced existing pair")
			}
			f = s.newExecutionFrame("source", "target", "failed-after-stage")
			if err := f.executeOperations(ability, ops); err != nil {
				t.Fatal(err)
			}
			f.fatal, f.fatalErr = true, engineErrorPtr(model.GenericPhaseRun, model.GenericErrFormulaTypeError, "synthetic later operation failure", s.compiled.SchemaHash, s.compiled.RulesHash, s.req.SessionID)
			f.commit()
			if current := s.combatants["target"].shields[0]; current.ShieldRef != before.ShieldRef || current.LifecycleProviderRef != before.LifecycleProviderRef || len(s.combatants["target"].providers) != 1 {
				t.Fatal("failed frame replaced pair")
			}
		})
	}
}

func TestLinkedShieldDeclaredWithoutApplyReadsZeroThroughRunGeneric(t *testing.T) {
	c, r := timedShieldLoad(t)
	c.SharedProviders = append(c.SharedProviders, model.ProviderDefinition{ProviderKey: "configured_lifetime", StableID: "configured_lifetime", Kind: "buff", LinkedShieldDefinitionRef: "configured_unused"})
	c.SharedProviders[0].Abilities[0].Operations = []model.OperationDefinition{{Operation: "heal", Target: "source", Amount: timedShieldExpr(100), Condition: &model.GenericFormulaExpr{Op: "read", Path: "provider.linked_shield[configured_unused].present"}}}
	r.InitialSnapshot.Combatants[0].Attributes["hp"] = model.AttributeSlotDef{Base: 1000, Current: 500, Resolved: 1000, Max: 1000}
	done := timedShieldMustRun(t, c, r)
	if done.Summary.SourceFinalHp != 500 {
		t.Fatal("absent shield did not read zero", done.Summary)
	}
	// Discarded/foreign frame provider contexts cannot turn an unknown reference into zero.
	result := compile.CompileGeneric(c)
	state, err := newGenericRunState(result.Session, r)
	if err != nil {
		t.Fatal(err)
	}
	frame := state.newExecutionFrame("source", "target", "unowned")
	index, _ := state.findProviderDefinitionIndex("configured_lifetime")
	if _, err := frame.LinkedShieldPresent(index); err == nil {
		t.Fatal("unowned linked presence read accepted")
	}
}
